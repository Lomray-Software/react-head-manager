import { expect } from 'chai';
import React, { type ReactElement } from 'react';
import ReactDOMServer from 'react-dom/server';
import sinon from 'sinon';
import { afterEach, describe, it } from 'vitest';
import { Manager } from '../src';
import type { IMetaManagerTags } from '../src/manager';

const containerId = 'container-id';
const renderServerMeta = (meta: IMetaManagerTags['meta']): string =>
  ReactDOMServer.renderToString(
    [...meta.values()].map(({ element }) => element) as unknown as ReactElement,
  );
const renderClientMeta = (meta: IMetaManagerTags['meta']): string => {
  const root = document.createElement('div');

  [...meta.values()].forEach(({ domElement }) => {
    root.append(domElement!);
  });

  return root.innerHTML;
};

describe('Manager', () => {
  const sandbox = sinon.createSandbox();
  const defaultTags = () => (
    <>
      <meta charSet="UTF-8" data-order={1} />
      <meta data-test="2" style={{ color: 'black' }} />
      <style>{`#test { color: red; }`}</style>
    </>
  );

  afterEach(() => {
    sandbox.restore();
  });

  it('should correctly render meta (server side)', () => {
    const manager = new Manager();

    manager.isServer = true;

    manager.pushTags(defaultTags(), containerId);

    const { meta } = manager.getTags();
    const htmlMeta = renderServerMeta(meta);

    expect(htmlMeta).to.equal(
      '<meta charSet="UTF-8"/><meta data-test="2" style="color:black"/><style>#test { color: red; }</style>',
    );
  });

  it('should correctly apply dom element attributes (client side)', () => {
    const manager = new Manager();

    manager.pushTags(defaultTags(), containerId);

    const { meta } = manager.getTags();
    const htmlMeta = renderClientMeta(meta);

    expect(htmlMeta).to.equal(
      '<meta charset="UTF-8"><meta data-test="2" style="color: black;"><style>#test { color: red; }</style>',
    );
  });

  it('should keep og:* meta tags distinct by property (regression: property collapse)', () => {
    const manager = new Manager();

    manager.isServer = true;

    manager.pushTags(
      <>
        <meta property="og:title" content="Title A" />
        <meta property="og:description" content="Desc B" />
        <meta property="og:url" content="https://example.com/page" />
        <meta property="og:image" content="https://example.com/img.png" />
      </>,
      containerId,
    );

    const { meta } = manager.getTags();
    const htmlMeta = renderServerMeta(meta);
    const ogCount = (htmlMeta.match(/property="og:/g) ?? []).length;

    expect(ogCount).to.equal(4);
    expect(htmlMeta).to.contain('property="og:title"');
    expect(htmlMeta).to.contain('property="og:description"');
    expect(htmlMeta).to.contain('property="og:url"');
    expect(htmlMeta).to.contain('property="og:image"');
  });
});
