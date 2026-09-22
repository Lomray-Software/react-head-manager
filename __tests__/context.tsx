import { ConsistentSuspenseProvider } from '@lomray/consistent-suspense';
import type { FC } from 'react';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Manager, Meta, MetaManagerProvider } from '../src';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('Meta', () => {
  let rerender!: () => void;
  let setPage!: (page: string) => void;

  const Page: FC = () => {
    const [, setTick] = useState(0);
    const [page, setPageState] = useState('home');

    rerender = () => setTick((tick) => tick + 1);
    setPage = setPageState;

    return (
      <Meta>
        <title>{page}</title>
        <meta name="description" content={`${page} description`} />
        {/* eslint-disable-next-line jsx-a11y-x/html-has-lang -- only the style is under test. */}
        <html style={{ marginTop: 0 }} />
      </Meta>
    );
  };

  const mount = () => {
    const manager = new Manager();
    const container = document.createElement('div');
    const root = createRoot(container);

    manager.isServer = false;
    document.body.append(container);

    act(() => {
      root.render(
        <ConsistentSuspenseProvider>
          <MetaManagerProvider manager={manager}>
            <Page />
          </MetaManagerProvider>
        </ConsistentSuspenseProvider>,
      );
    });

    return { manager, root, container };
  };

  afterEach(() => {
    vi.useRealTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('should keep the head untouched when the parent re-renders the same tags', () => {
    const { root } = mount();
    const description = document.head.querySelector('meta[name="description"]')!;
    const title = document.head.querySelector('title')!;

    expect(title.textContent).to.equal('home');

    act(() => rerender());
    act(() => rerender());

    expect(document.head.querySelector('meta[name="description"]')).to.equal(description);
    expect(document.head.querySelector('title')).to.equal(title);
    expect(document.head.querySelectorAll('meta[name="description"]')).to.have.length(1);

    act(() => setPage('about'));

    expect(document.head.querySelector('title')!.textContent).to.equal('about');
    expect(
      document.head.querySelector('meta[name="description"]')!.getAttribute('content'),
    ).to.equal('about description');
    expect(document.head.querySelectorAll('meta[name="description"]')).to.have.length(1);

    act(() => root.unmount());
  });

  it('should drop drained tags from the manager state', () => {
    vi.useFakeTimers();

    const { manager, root } = mount();

    expect(manager.getTags().meta.has("meta[name='description']")).to.equal(true);

    act(() => root.unmount());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(document.head.querySelector('meta[name="description"]')).to.equal(null);
    expect(manager.getTags().meta.size).to.equal(0);
  });
});
