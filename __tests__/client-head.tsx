import { readFileSync } from 'node:fs';
import { expect } from 'chai';
import { afterEach, describe, it, vi } from 'vitest';
import ParserManager from '../__helpers__/parser-manager';
import { Manager, TagStatus } from '../src';
import type { IMetaManagerTags } from '../src/manager';

const charsetSelector = 'meta[charset]';
const fixture = (name: string): string => readFileSync(`__helpers__/fixtures/${name}.html`, 'utf8');

const snapshot = ({ meta, html, body, containers }: IMetaManagerTags) => ({
  html: [...html],
  body: [...body],
  containers: [...containers],
  meta: [...meta].map(([key, { element, order, containerId, status }]) => [
    key,
    { element, order, containerId, status },
  ]),
});

const loadDocument = (html: string) => {
  document.documentElement.innerHTML = html;
  // Setting innerHTML on <html> preserves that element's attributes.
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  document.documentElement.getAttributeNames().forEach((name) => {
    document.documentElement.removeAttribute(name);
  });
  Array.from(parsed.documentElement.attributes).forEach(({ name, value }) => {
    document.documentElement.setAttribute(name, value);
  });
};

const fixtures = [
  {
    name: 'vite-template /about SSR (published 2.1.2)',
    html: fixture('vite-template-about'),
    // Captured from origin/example/minimal at 25a17c14fba85d44987689d98922ddffcaafea7a:
    // npm ci --ignore-scripts; env -u NO_COLOR npm run build; SSR GET /about.
    selectors: [
      charsetSelector,
      'meta[name="viewport"]',
      'title',
      'meta[name="description"]',
      'link[rel="icon"]',
      'link[rel="stylesheet"]:nth-of-type(2)',
      'link[rel="stylesheet"]:nth-of-type(3)',
      'script[src]',
    ],
  },
  {
    name: 'head tags, duplicates, whitespace, comments and root attributes',
    html: fixture('head'),
    selectors: [
      charsetSelector,
      'meta[name="viewport"]',
      'title',
      'base[href]',
      'base:nth-of-type(2)',
      'base:nth-of-type(3)',
      'meta[http-equiv]',
      'meta[name="description"]',
      'meta[name="keywords"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[property="og:url"]',
      'meta[property="og:image"]',
      'meta[class]',
      'link[rel="stylesheet"]',
      'link[rel="icon"]',
      'script[src]',
      'script:nth-of-type(2)',
      'script:nth-of-type(3)',
      'noscript',
      'style:nth-of-type(1)',
      'style:nth-of-type(2)',
    ],
  },
  {
    name: 'compact duplicate tags and empty text tags',
    html: '<html><head><title></title><base><base><script></script><script></script><style></style><style></style><noscript></noscript></head><body></body></html>',
    selectors: [
      'title',
      'base:nth-of-type(1)',
      'base:nth-of-type(2)',
      'script:nth-of-type(1)',
      'script:nth-of-type(2)',
      'noscript',
      'style:nth-of-type(1)',
      'style:nth-of-type(2)',
    ],
  },
  {
    name: 'empty head',
    html: '<html lang="en"><head></head><body class="empty" data-id="empty"></body></html>',
    selectors: [],
  },
  {
    name: 'boolean attribute keys and mapped HTML names',
    html: `<html lang="en" class="dark" itemscope><head>
      <meta content="boolean" hidden="false" itemscope nomodule async defer disabled scoped download>
      <meta name="aliases" itemprop="description" itemref="other" itemid="item">
      <link rel="preload" href="/images" imagesrcset="/hero.png 1x" imagesizes="100vw"
        fetchpriority="high" crossorigin="anonymous" referrerpolicy="no-referrer">
      <script src="/app.js" nomodule async defer></script>
      <style scoped>.app { color: red; }</style>
      </head><body class="app" hidden itemscope></body></html>`,
    selectors: ['meta[content="boolean"]', 'meta[name="aliases"]', 'link', 'script', 'style'],
  },
];

describe('DOM client head snapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    loadDocument('<html><head></head><body></body></html>');
  });

  it.each(fixtures)('matches the parser oracle: $name', ({ html, selectors }) => {
    loadDocument(html);
    const expectedNodes = selectors.map((selector) => document.head.querySelector(selector));
    const originalNodes = Array.from(document.head.childNodes);
    const originalMarkup = document.documentElement.outerHTML;
    const oracle = new ParserManager();
    const manager = new Manager();

    oracle.analyzeClientHead();
    manager.analyzeClientHead();

    expect(snapshot(manager.getTags())).to.deep.equal(snapshot(oracle.getTags()));
    const entries = [...manager.getTags().meta.values()];

    expect(entries).to.have.lengthOf(expectedNodes.length);
    entries.forEach((entry, index) => {
      expect(expectedNodes[index]).not.to.equal(null);
      expect(entry.domElement).to.equal(expectedNodes[index]);
      expect(entry.containerId).to.equal(Manager.rootContainerId);
      expect(entry.status).to.equal(TagStatus.synced);
    });
    expect(Array.from(document.head.childNodes)).to.deep.equal(originalNodes);
    expect(document.documentElement.outerHTML).to.equal(originalMarkup);

    const firstSnapshot = manager.getTags();

    manager.analyzeClientHead();
    expect(manager.getTags()).to.deep.equal(firstSnapshot);
  });

  it('reads mapped attributes, inline styles and literal text directly from the live nodes', () => {
    class InspectManager extends Manager {
      public readProps(element: HTMLElement) {
        return this.getDomElementProps(element);
      }
    }

    loadDocument(fixture('head'));
    const manager = new InspectManager();

    expect(manager.readProps(document.documentElement)).to.deep.equal({
      lang: 'fr',
      className: 'theme-dark',
      'data-x': 'root',
      style: { marginTop: '2px', lineHeight: '1.5', '--accent': 'teal', WebkitLineClamp: '2' },
    });
    expect(manager.readProps(document.body)).to.deep.equal({
      className: 'page',
      'data-id': 'about',
    });
    expect(manager.readProps(document.head.querySelector(charsetSelector)!)).to.deep.equal({
      charSet: 'UTF-8',
      'data-order': '99',
    });
    expect(manager.readProps(document.head.querySelector('meta[http-equiv]')!)).to.deep.equal({
      httpEquiv: 'content-security-policy',
      content: "default-src 'self'",
    });
    expect(manager.readProps(document.head.querySelector('meta[class]')!)).to.deep.equal({
      className: 'custom',
      htmlFor: 'other',
      content: 'Fallback key',
      style: { color: 'red' },
    });
    expect(manager.readProps(document.head.querySelector('link[crossorigin]')!)).to.deep.equal({
      rel: 'stylesheet',
      href: '/main.css',
      crossOrigin: 'anonymous',
    });
    document.head
      .querySelectorAll<HTMLElement>('title, style, script, noscript')
      .forEach((node) => {
        expect(manager.readProps(node).children).to.equal(node.textContent);
        expect(manager.readProps(node).children).to.be.a('string');
      });
  });

  it('preserves fallback keys with adjacent text nodes and comments without reading HTML', () => {
    loadDocument('<html><head><style>a { color: red; }</style></head><body></body></html>');
    const style = document.head.querySelector('style')!;

    document.head.prepend(
      document.createTextNode(' '),
      document.createTextNode(''),
      document.createTextNode('\n'),
      document.createComment('separator'),
      document.createTextNode('\t'),
    );
    const oracle = new ParserManager();

    oracle.analyzeClientHead();
    const fail = () => {
      throw new Error('Client analysis must not serialize or parse HTML');
    };

    vi.spyOn(Element.prototype, 'innerHTML', 'get').mockImplementation(fail);
    vi.spyOn(Element.prototype, 'outerHTML', 'get').mockImplementation(fail);
    vi.spyOn(Node.prototype, 'cloneNode').mockImplementation(fail);
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(fail);
    const manager = new Manager();

    manager.analyzeClientHead();

    expect(snapshot(manager.getTags())).to.deep.equal(snapshot(oracle.getTags()));
    expect([...manager.getTags().meta.keys()]).to.deep.equal(['style-root-2-not-unique']);
    expect(manager.getTags().meta.get('style-root-2-not-unique')!.domElement).to.equal(style);
  });

  it.each(['live', 'detached', 'missing'])(
    'preserves existing entries with a %s DOM node, container ownership and custom definition order',
    (nodeState) => {
      loadDocument(fixture('head'));
      const liveTitle = document.head.querySelector('title')!;
      const initialTags = (): Partial<IMetaManagerTags> => ({
        meta: new Map([
          [
            'title',
            {
              element: undefined,
              domElement:
                nodeState === 'live'
                  ? liveTitle
                  : nodeState === 'detached'
                    ? (liveTitle.cloneNode(true) as HTMLElement)
                    : undefined,
              order: 100,
              containerId: 'mounted',
              status: TagStatus.synced,
            },
          ],
        ]),
        containers: new Set(['mounted']),
      });
      const manager = new Manager(initialTags());
      const oracle = new ParserManager(initialTags());

      for (const instance of [manager, oracle]) {
        instance.setTagsDefinitions({ 'meta[httpEquiv]': { order: 5 }, style: { order: 15 } });
      }

      const mounted = manager.getTags().meta.get('title')!;

      manager.analyzeClientHead();
      oracle.analyzeClientHead();

      expect(snapshot(manager.getTags())).to.deep.equal(snapshot(oracle.getTags()));
      expect(manager.getTags().meta.get('title')).to.equal(mounted);
      expect(mounted.domElement).to.equal(liveTitle);
      expect(mounted.containerId).to.equal('mounted');
      expect([...manager.getTags().meta.keys()][0]).to.equal('meta[httpEquiv]');
    },
  );

  it('does nothing on the server', () => {
    const manager = new Manager();

    manager.isServer = true;
    const before = manager.getTags();

    manager.analyzeClientHead();

    expect(manager.getTags()).to.deep.equal(before);
  });
});
