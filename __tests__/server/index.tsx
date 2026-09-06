import { expect } from 'chai';
import React from 'react';
import { describe, it } from 'vitest';
import { Manager } from '../../src';
import ServerManager from '../../src/server';

describe('ServerManager', () => {
  const containerId = 'container-id';

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
      containerId,
    );

    const result = ServerManager.inject(htmlStr, manager);

    expect(result).to.equal(
      '<html lang="en-EN" data-id="html-id"><head><meta charSet="UTF-8"/><title>Changed</title><meta data-test="1"/></head><body data-test="body-test" data-id="body-id"></body></html>',
    );
  });

  it.each([
    {
      source: 'manager',
      htmlStr:
        '<html lang="en"><head><title>Original</title></head><body class="original"></body></html>',
      tags: (
        <>
          {/* eslint-disable-next-line jsx-a11y/html-has-lang -- lang comes from the input HTML. */}
          <html dir="rtl" className="x" />
          <body className="y" />
        </>
      ),
    },
    {
      source: 'input HTML',
      htmlStr:
        '<html lang="fr" dir="rtl" class="x"><head><title>Original</title></head><body class="y"></body></html>',
      tags: <html lang="en" />,
    },
  ])(
    'should merge root attributes from $source and inject meta into a single head',
    ({ htmlStr, tags }) => {
      const manager = new Manager();

      manager.isServer = true;
      manager.pushTags(tags, containerId);
      manager.pushTags(
        <>
          <title>Changed</title>
          <meta name="description" content="Inside the head" />
        </>,
        containerId,
      );

      const result = ServerManager.inject(htmlStr, manager);

      expect(result.match(/<head/g)).to.have.lengthOf(1);
      expect(result).to.equal(
        '<html lang="en" dir="rtl" class="x"><head><title>Changed</title><meta name="description" content="Inside the head"/></head><body class="y"></body></html>',
      );
    },
  );

  it('should preserve React attribute serialization on root tags', () => {
    const htmlStr =
      '<html title="A &amp; &quot;B&quot; &lt;C&gt; &#x27;D&#x27;" style="margin-top:2px"><head>\n<title>Test</title></head><body class="original" hidden style="padding-top:3px"></body></html>';
    const manager = new Manager();

    manager.isServer = true;
    manager.pushTags(
      <>
        <html lang="en" className="x" hidden draggable={false} />
        <body
          className="y"
          hidden={false}
          style={{ marginTop: 4, lineHeight: 1.5 }}
          data-label={'A & "B" <C> \'D\''}
          aria-hidden={false}
        />
      </>,
      containerId,
    );

    const result = ServerManager.inject(htmlStr, manager);

    expect(result.match(/<head/g)).to.have.lengthOf(1);
    expect(result).to.equal(
      '<html title="A &amp; &quot;B&quot; &lt;C&gt; &#x27;D&#x27;" style="margin-top:2px" lang="en" class="x" hidden="" draggable="false"><head><title>Test</title></head><body class="y" style="margin-top:4px;line-height:1.5" data-label="A &amp; &quot;B&quot; &lt;C&gt; &#x27;D&#x27;" aria-hidden="false"></body></html>',
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

  /**
   * Preserve string-parser attribute casing even when a browser DOM is available.
   */
  it('should preserve custom element attribute casing and raw head content', () => {
    const manager = new Manager();

    manager.isServer = true;

    const result = ServerManager.inject(
      '<html lang="en"><head>\n<title>A &amp; B</title>' +
        '<custom-meta buildId="Worker"></custom-meta>' +
        '<script type="application/ld+json">{"value":"<tag>&"}</script>' +
        '<style>.test > a { color: red; }</style></head><body></body></html>',
      manager,
    );

    expect(result).to.equal(
      '<html lang="en"><head><title>A &amp; B</title>' +
        '<script type="application/ld+json">{"value":"<tag>&"}</script>' +
        '<style>.test > a { color: red; }</style>' +
        '<custom-meta buildId="Worker"></custom-meta></head><body></body></html>',
    );
  });
});
