import React from 'react';
import { describe, expect, it } from 'vitest';
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
          {/* eslint-disable-next-line jsx-a11y-x/html-has-lang -- lang comes from the input HTML. */}
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

  describe('static head passthrough', () => {
    const font =
      '<link rel="stylesheet" href="https://fonts.example/css2?family=Inter&display=swap" media="print" onload="this.media=\'all\'" />';
    const script = '<script onerror="x()" src="a.js" async></script>';
    const page = (head: string) => `<html lang="en"><head>${head}</head><body></body></html>`;
    const inject = (head: string, tags?: React.ReactNode) => {
      const manager = new Manager();

      manager.isServer = true;

      if (tags) {
        manager.pushTags(tags, containerId);
      }

      return { manager, result: ServerManager.inject(page(head), manager) };
    };

    it('should serve untouched tags verbatim, including inline handlers and boolean attributes', () => {
      const { result } = inject(`\n  ${font}\n  ${script}\n  <meta charset="utf-8">\n`);

      expect(result).to.contain(font);
      expect(result).to.contain(script);
      expect(result).to.contain('<meta charset="utf-8">');
    });

    it('should replace a static tag overridden by the application without duplicating it', () => {
      const { result } = inject(
        `<meta name="description" content="static">${font}<title>Static</title>`,
        <>
          <title>App</title>
          <meta name="description" content="app" />
        </>,
      );

      expect(result).to.contain('<meta name="description" content="app"/>');
      expect(result).to.contain('<title>App</title>');
      expect(result).to.not.contain('static');
      expect(result).to.not.contain('Static');
      expect(result.match(/name="description"/g)).to.have.length(1);
      expect(result).to.contain(font);
    });

    it('should keep the manager order for untouched tags', () => {
      const head = `<meta name="a" content="1">${script}<meta name="b" content="2">`;
      const before = inject(head).result;
      const { result } = inject(head, <meta name="c" content="3" />);

      expect(before).to.equal(
        page(`<meta name="a" content="1"><meta name="b" content="2">${script}`),
      );
      expect(result.indexOf('name="a"')).to.be.below(result.indexOf('name="b"'));
      expect(result.indexOf('name="b"')).to.be.below(result.indexOf('a.js'));
    });

    it('should keep head comments next to the following tag, and trailing ones at the end', () => {
      const { result } = inject(
        `<!-- fonts -->${font}<!--[if IE]><meta name="ie" content="1"><![endif]--><title>T</title><!-- end -->`,
      );

      expect(result).to.contain(`<!-- fonts -->${font}`);
      expect(result).to.contain(
        '<!--[if IE]><meta name="ie" content="1"><![endif]--><title>T</title>',
      );
      expect(result).to.match(/<!-- end --><\/head>/);
    });

    it('should keep a tag that directly follows <head> and replacement patterns in its content', () => {
      const inline = "<script>window.price = '$1 $& $$';</script>";
      const { result } = inject(`<meta name="first" content="1">${inline}`);

      expect(result).to.contain('<meta name="first" content="1">');
      expect(result).to.contain(inline);
    });

    it('should adopt the verbatim tags on the client without recreating them', () => {
      const { result } = inject(`${font}${script}<meta name="description" content="static">`);
      const [, head] = /<head>(.*)<\/head>/s.exec(result)!;

      document.head.innerHTML = head;

      const link = document.head.querySelector('link')!;
      const client = new Manager();

      client.isServer = false;
      client.analyzeClientHead();
      client.pushTags(<meta name="description" content="client" />, containerId);

      expect(document.head.querySelector('link')).to.equal(link);
      expect(link.getAttribute('onload')).to.equal("this.media='all'");
      expect(document.head.querySelectorAll('link, script')).to.have.length(2);
      expect(document.head.querySelectorAll('meta[name="description"]')).to.have.length(1);
      expect(
        document.head.querySelector('meta[name="description"]')!.getAttribute('content'),
      ).to.equal('client');
      document.head.innerHTML = '';
    });
  });

  describe('template reuse', () => {
    const template =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Static</title>' +
      '<script>window.tpl = "<body class=\\"fake\\">";</script></head>' +
      '<body class="site"><div id="root"></div></body></html>';

    it('should keep managers independent when the same template is injected repeatedly', () => {
      const results = ['one', 'two', 'one'].map((title) => {
        const manager = new Manager();

        manager.isServer = true;
        manager.pushTags(
          <>
            {/* eslint-disable-next-line jsx-a11y-x/html-has-lang -- lang comes from the template. */}
            <html data-page={title} />
            <title>{title}</title>
          </>,
          containerId,
        );

        return ServerManager.inject(template, manager);
      });

      expect(results[0]).to.equal(results[2]);
      expect(results[0]).to.contain('<html lang="en" data-page="one">');
      expect(results[1]).to.contain('<html lang="en" data-page="two">');
      expect(results[0]).to.contain('<title>one</title>');
      expect(results[1]).to.contain('<title>two</title>');
      expect(results[0]).to.not.contain('two');
    });

    it('should replace the real root tags, not markup inside the head', () => {
      const manager = new Manager();

      manager.isServer = true;
      manager.pushTags(<body data-theme="dark" />, containerId);

      const result = ServerManager.inject(template, manager);

      expect(result).to.contain('<script>window.tpl = "<body class=\\"fake\\">";</script>');
      expect(result).to.contain(
        '<body class="site" data-theme="dark"><div id="root"></div></body>',
      );
      expect(result.match(/<body/g)).to.have.length(2);
    });
  });
});
