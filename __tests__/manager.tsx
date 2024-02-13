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
});
