import { expect } from 'chai';
import React from 'react';
import { describe, it } from 'vitest';
import { Manager } from '../../src';
import ServerManager from '../../src/server';

describe('ServerManager', () => {
  it('should inject meta tags into HTML string', () => {
    const htmlStr =
      '<html lang="en"><head><title>Test 1</title></head><body data-test="body-test"></body></html>';
    const manager = new Manager();

    manager.isServer = true;

    manager.pushTags(
      <>
        <html data-id="html-id" lang="en-EN" />
        <body data-id="body-id" />
        <title>Changed</title>
        <meta charSet="UTF-8" />
        <meta data-test="2" />
        <meta data-test="1" />
      </>,
      'container-id',
    );

    const result = ServerManager.inject(htmlStr, manager);

    expect(result).to.equal(
      '<html lang="en-EN" data-id="html-id"><head><meta charSet="UTF-8"/><title>Changed</title><meta data-test="1"/></head><body data-test="body-test" data-id="body-id"></body></html>',
    );
  });

  it('should return meta manager state', () => {
    const manager = new Manager();

    manager.pushTags(<html lang="en-EN" />, 'custom');
    manager.pushTags(<html lang="en" />, Manager.rootContainerId, false);

    manager.pushTags(<body data-id="body-id-1" />, 'custom');
    manager.pushTags(<body data-test="body-test" />, Manager.rootContainerId, false);
    manager.pushTags(<body data-id="body-id-2" />, 'custom');

    manager.pushTags(<meta data-test="1" />, 'custom');
    manager.pushTags(<meta data-test="2" />, 'custom');

    const state = ServerManager.getState(manager);

    expect(state).to.deep.equal({
      html: [
        ['root', { props: { lang: 'en' }, order: 1 }],
        ['custom', { props: { lang: 'en-EN' }, order: 1000 }],
      ],
      body: [
        ['root', { props: { 'data-test': 'body-test' }, order: 1 }],
        ['custom', { props: { 'data-id': 'body-id-2' }, order: 1000 }],
      ],
      containers: ['custom', 'root'],
    });
  });
});
