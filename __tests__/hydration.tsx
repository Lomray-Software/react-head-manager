import { ConsistentSuspenseProvider } from '@lomray/consistent-suspense';
import type { FC, ReactElement, ReactNode } from 'react';
import React, { Suspense, useState } from 'react';
import type { Root } from 'react-dom/client';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Manager, Meta, MetaManagerProvider, useMetaManager } from '../src';
import MetaServer from '../src/server';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TEMPLATE =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Template</title>' +
  '<link rel="icon" href="/favicon.ico"><script src="/template.js"></script>' +
  '</head><body><div id="root"><!--app--></div></body></html>';

// Meta reads its direct children, so every page is a flat list of tags.
const pages: Record<string, ReactElement[]> = {
  home: [
    <title key="title">Home</title>,
    <meta key="description" name="description" content="Home description" />,
    <meta key="robots" name="robots" content="index" />,
    <meta key="og:url" property="og:url" content="https://example.com/" />,
    <link key="canonical" rel="canonical" href="https://example.com/" />,
    <link key="preconnect" rel="preconnect" href="https://cdn.example.com" />,
    <script key="ld" type="application/ld+json">
      {'{"@type":"WebSite","name":"Home"}'}
    </script>,
  ],
  about: [
    <title key="title">About</title>,
    <meta key="description" name="description" content="About description" />,
    <link key="canonical" rel="canonical" href="https://example.com/about" />,
    <script key="ld" type="application/ld+json">
      {'{"@type":"AboutPage","name":"About"}'}
    </script>,
  ],
};

let setPage!: (page: string) => void;

let root: Root | undefined;
/** Streamed content: hydration of the boundary is delayed until the stream resolves. */
let stream: { promise: Promise<void>; resolve: () => void; isReady: boolean } | undefined;

const createStream = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = () => {
      stream!.isReady = true;
      done();
    };
  });

  stream = { promise, resolve, isReady: false };
};

const Stream: FC<{ children: ReactNode }> = ({ children }) => {
  const { manager } = useMetaManager();

  if (!manager.isServer && !stream!.isReady) {
    throw stream!.promise;
  }

  return <>{children}</>;
};

/** The current page's tags, either in the shell or inside a Suspense boundary. */
const Page: FC<{ isStreamed?: boolean; extra?: ReactElement[] }> = ({ isStreamed, extra }) => {
  const [page, setPageState] = useState('home');

  setPage = setPageState;

  const meta = <Meta>{[...pages[page], ...(extra ?? [])]}</Meta>;

  return isStreamed ? (
    <Suspense fallback={null}>
      <Stream>{meta}</Stream>
    </Suspense>
  ) : (
    meta
  );
};

const app = (manager: Manager, content: ReactNode) => (
  <ConsistentSuspenseProvider>
    <MetaManagerProvider manager={manager}>{content}</MetaManagerProvider>
  </ConsistentSuspenseProvider>
);

/** Server render, then hydrate the same tree against the injected document. */
const hydrate = (serverContent: ReactNode, clientContent = serverContent) => {
  const serverManager = new Manager();

  serverManager.isServer = true;

  const html = MetaServer.inject(
    TEMPLATE.replace('<!--app-->', renderToString(app(serverManager, serverContent))),
    serverManager,
  );

  document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html><html[^>]*>|<\/html>$/g, '');

  const manager = new Manager(
    MetaServer.getState(serverManager) as unknown as ConstructorParameters<typeof Manager>[0],
  );

  manager.isServer = false;

  const serverTags = headTags();
  const observer = new MutationObserver(() => undefined);

  observer.observe(document.head, { childList: true, attributes: true, subtree: true });

  act(() => {
    root = hydrateRoot(document.getElementById('root')!, app(manager, clientContent));
  });

  return { manager, observer, html, serverTags };
};

const headTags = () =>
  Array.from(document.head.children, (element) => element.outerHTML.replace(/ data-[^ >]+/g, ''));

const expectPage = (page: 'home' | 'about') => {
  const isHome = page === 'home';

  expect(document.head.querySelectorAll('title')).to.have.length(1);
  expect(document.title).to.equal(isHome ? 'Home' : 'About');
  expect(document.head.querySelectorAll('link[rel="canonical"]')).to.have.length(1);
  expect(document.head.querySelector('link[rel="canonical"]')!.getAttribute('href')).to.equal(
    isHome ? 'https://example.com/' : 'https://example.com/about',
  );
  expect(document.head.querySelectorAll('meta[name="description"]')).to.have.length(1);
  expect(document.head.querySelector('meta[name="description"]')!.getAttribute('content')).to.equal(
    isHome ? 'Home description' : 'About description',
  );
  expect(document.head.querySelectorAll('meta[name="robots"]')).to.have.length(isHome ? 1 : 0);
  expect(document.head.querySelectorAll('meta[property="og:url"]')).to.have.length(isHome ? 1 : 0);
  expect(document.head.querySelectorAll('link[rel="preconnect"]')).to.have.length(isHome ? 1 : 0);

  const jsonLd = document.head.querySelectorAll('script[type="application/ld+json"]');

  expect(jsonLd).to.have.length(1);
  expect(jsonLd[0].textContent).to.contain(isHome ? 'WebSite' : 'AboutPage');
  // template tags survive navigation
  expect(document.head.querySelectorAll('meta[charset]')).to.have.length(1);
  expect(document.head.querySelectorAll('script[src="/template.js"]')).to.have.length(1);
};

describe('hydration', () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    stream = undefined;
    vi.useRealTimers();
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('renders the page tags once on the server', () => {
    vi.useFakeTimers();

    const { html } = hydrate(<Page />);

    expect(html.match(/<title>/g)).to.have.length(1);
    expect(html.match(/rel="canonical"/g)).to.have.length(1);
    expect(html.match(/rel="icon"/g)).to.have.length(1);
    expectPage('home');
  });

  it.each([
    ['in the shell', false],
    ['in a streamed Suspense boundary', true],
  ])('adopts the server tags %s and removes them on navigation', async (_, isStreamed) => {
    vi.useFakeTimers();

    createStream();

    const { manager, observer, serverTags } = hydrate(<Page isStreamed={isStreamed} />);

    if (isStreamed) {
      // the boundary hydrates after the provider analyzed the head
      expect(manager.getTags().meta.get("link[href='https://example.com/']")!.containerId).to.equal(
        Manager.rootContainerId,
      );
      await act(async () => {
        stream!.resolve();
        await stream!.promise;
      });
    }

    // hydration reuses the live nodes: no DOM changes, the records own the head elements
    expect(headTags()).to.deep.equal(serverTags);
    expect(observer.takeRecords()).to.have.length(0);

    const tags = manager.getTags().meta;
    const canonical = tags.get("link[href='https://example.com/']")!;

    expect(canonical.containerId).not.to.equal(Manager.rootContainerId);
    expect(canonical.domElement).to.equal(document.head.querySelector('link[rel="canonical"]'));
    // the JSON-LD script moved from the root container to the page container
    expect(
      [...tags.entries()].filter(
        ([key, { containerId }]) =>
          key.endsWith('-not-unique') && containerId === Manager.rootContainerId,
      ),
    ).to.have.length(0);

    const title = document.head.querySelector('title');
    const description = document.head.querySelector('meta[name="description"]');

    act(() => setPage('about'));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expectPage('about');
    // tags with the same key are updated in place, the rest is replaced
    expect(document.head.querySelector('title')).to.equal(title);
    expect(document.head.querySelector('meta[name="description"]')).to.equal(description);

    act(() => setPage('home'));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expectPage('home');
  });

  it('updates a hydrated tag in place when the client renders different props', () => {
    vi.useFakeTimers();

    const { observer } = hydrate(
      <Page />,
      <Page
        extra={[
          <meta key="robots" name="robots" content="noindex" />,
          <meta key="client-only" name="client-only" content="yes" />,
        ]}
      />,
    );
    const robots = document.head.querySelector('meta[name="robots"]')!;

    expect(document.head.querySelectorAll('meta[name="robots"]')).to.have.length(1);
    expect(robots.getAttribute('content')).to.equal('noindex');
    expect(document.head.querySelectorAll('meta[name="client-only"]')).to.have.length(1);
    // one attribute update and one insertion, nothing else re-created
    const mutations = observer.takeRecords();

    expect(mutations.filter(({ type }) => type === 'attributes')).to.have.length(1);
    expect(mutations.filter(({ type }) => type === 'childList')).to.have.length(1);

    act(() => setPage('about'));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(document.head.querySelector('meta[name="robots"]')).to.equal(robots);
    expect(document.head.querySelectorAll('meta[name="client-only"]')).to.have.length(1);
  });
});
