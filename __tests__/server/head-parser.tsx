import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import htmlToDOM from 'html-dom-parser/lib/server/html-to-dom';
import domToReact from 'html-react-parser/lib/dom-to-react';
import type { ReactNode } from 'react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { Manager } from '../../src';
import ServerManager from '../../src/server';
import type { IParsedHead } from '../../src/server/head-parser';
import { parseHead, parseRootTag } from '../../src/server/head-parser';

type TStack = {
  parseHead: (html: string) => IParsedHead;
  parseRootTag: (html: string) => ReactNode;
};

const UNDEFINED = '<undefined>';
const HEAD = /<head(?:\s[^>]*)?>(?<meta>.*?)<\/head>/s;
const ROOT_TAG = /<(html|body)[^>]*?>/g;
const parserOptions = {
  lowerCaseAttributeNames: false,
  withStartIndices: true,
  withEndIndices: true,
};

/**
 * The parser stack the server entry used before: html-dom-parser and html-react-parser.
 */
const previous: TStack = {
  parseHead: (html) => {
    const elements: ReactNode[] = [];
    const sources: (string | undefined)[] = [];
    let comments = '';

    for (const node of htmlToDOM(html, parserOptions)) {
      const markup = html.slice(node.startIndex ?? 0, (node.endIndex ?? -1) + 1);

      if ((node.type as string) === 'comment') {
        comments += markup;

        continue;
      }

      const element = domToReact([node]) as ReactNode;
      const isTag =
        typeof element === 'object' && 'name' in node && markup.startsWith(`<${node.name}`);

      elements.push(element);
      sources.push(isTag ? comments + markup : undefined);

      if (isTag) {
        comments = '';
      }
    }

    if (comments) {
      elements.push(React.createElement('noscript'));
      sources.push(comments);
    }

    return { elements, sources };
  },
  parseRootTag: (html) => domToReact(htmlToDOM(html, { lowerCaseAttributeNames: false })),
};

const current: TStack = { parseHead, parseRootTag };

/**
 * Plain data for a React tree: type, key and props in insertion order, `undefined` made visible.
 */
const plain = (node: ReactNode): unknown => {
  if (Array.isArray(node)) {
    return node.map(plain);
  }

  if (React.isValidElement(node)) {
    const props = Object.entries(node.props as Record<string, unknown>).map(
      ([name, value]): [string, unknown] => {
        if (value === undefined) {
          return [name, UNDEFINED];
        }

        return [name, name === 'children' ? plain(value as ReactNode) : value];
      },
    );

    return { type: node.type, key: node.key, props: Object.fromEntries(props) };
  }

  return node;
};

const parsed = (stack: TStack, html: string): string =>
  JSON.stringify({
    head: {
      elements: plain(stack.parseHead(html).elements),
      sources: stack.parseHead(html).sources,
    },
    root: plain(stack.parseRootTag(html)),
  });

/**
 * Deterministic pseudo random generator, so the corpus is the same on every run.
 */
const random = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state * 1103515245 + 12345) % 0x80000000;

    return state / 0x80000000;
  };
};

const attributeNames = [
  'name',
  'content',
  'class',
  'CLASS',
  'id',
  'data-x',
  'Data-Y',
  'aria-label',
  'onload',
  'http-equiv',
  'for',
  'tabindex',
  'hidden',
  'async',
  'defer',
  'nomodule',
  'download',
  'capture',
  'style',
  'STYLE',
  'charset',
  'CHARSET',
  'rel',
  'href',
  'src',
  'type',
  'is',
  'contenteditable',
  'spellcheck',
  'value',
  'checked',
  'xml:lang',
  'xmlns:xlink',
  'accept-charset',
  'crossorigin',
  'fetchpriority',
  'imagesrcset',
  'readonly',
  'itemscope',
  'itemprop',
  'property',
  'lang',
];
const attributeValues = [
  'a',
  'b c',
  'utf-8',
  'utf-8/',
  'x>y',
  'a&amp;b',
  '&amp=x',
  '&copy2',
  '&#65',
  '&#x41;',
  '&nbsp;',
  '&#128;',
  '&quot;q',
  "it's",
  'https://x/y?a=1&b=2',
  'a\nb',
  '',
  'false',
  'true',
  '0',
  '  ',
  'color:red',
  'color:red;background:url(a;b)',
  '-webkit-line-clamp:2;-ms-flex:1;--x-Y:1',
  'COLOR:Red',
  'a:',
  ':b',
  '/*c*/x:y',
  'color:red !important',
  "content:'a;b'",
  '&AMP;',
  '&LT',
  '&hellip;',
  '&apos;',
  'é',
  '&#xD800;',
  '&#0;',
  '&#;',
];
const tagNames = [
  'meta',
  'link',
  'title',
  'script',
  'style',
  'noscript',
  'base',
  'template',
  'div',
  'span',
  'p',
  'br',
  'textarea',
  'input',
  'custom-el',
  'svg',
  'META',
  'TITLE',
  'Link',
  'a',
  'li',
  'tr',
  'td',
  'select',
  'option',
];
const voidTags = new Set(['meta', 'link', 'base', 'br', 'input']);
const rawTags = new Set(['script', 'style', 'title', 'textarea']);
const texts = [
  '',
  ' ',
  '\n',
  '\n  ',
  'text',
  'a & b',
  'a &amp; b',
  '&copy2',
  '&notin ',
  '&amp=x',
  '<',
  ' < ',
  '</>',
  '</ >',
  'x<3',
  '&#65 y',
  'é',
];
const rawTexts = [
  '',
  'x',
  'a</scr',
  'a</scr' + 'ipt',
  '<!-- x -->',
  '<!-- <script> -->',
  'if (a < b && c > d) {}',
  '</style',
  '"$1 $& $$"',
  'a &amp; b',
  '\n  body { color: red; }\n',
  '</SCRIPT',
];
const comments = [
  '<!-- a -->',
  '<!--x-->',
  '<!---->',
  '<!-->',
  '<!--[if IE]><link rel=x><![endif]-->',
  '<![CDATA[x]]>',
  '<!-- a\n b -->',
];

/**
 * Random head markup: nested elements, comments, text, raw text, attribute spellings and
 * entities in every combination the parser has to agree on.
 */
const corpus = (seed: number, size: number): string[] => {
  const next = random(seed);
  const pick = <T,>(items: T[]): T => items[Math.floor(next() * items.length)];
  const maybe = (chance: number): boolean => next() < chance;
  const attribute = (): string => {
    const name = pick(attributeNames);

    if (maybe(0.15)) {
      return name;
    }

    const value = pick(attributeValues);
    const quote = pick(['"', "'", '']);

    if (quote === '') {
      return `${name}=${value.replace(/[\s>"']/g, 'z') || 'z'}`;
    }

    return `${name}=${quote}${value.split(quote).join('z')}${quote}`;
  };
  const openTag = (name: string): string => {
    const attributes = Array.from({ length: Math.floor(next() * 4) }, attribute);
    const duplicated =
      maybe(0.1) && attributes.length ? [...attributes, attributes[0]] : attributes;
    const space = pick([' ', '  ', '\n ', '\t']);
    const closing = maybe(0.2) ? `${pick([' ', ''])}/` : '';

    return `<${name}${duplicated.length ? space + duplicated.join(space) : ''}${closing}>`;
  };
  const element = (depth: number): string => {
    const name = pick(tagNames);
    const lower = name.toLowerCase();
    const open = openTag(name);

    if (voidTags.has(lower)) {
      return open + (maybe(0.1) ? `</${name}>` : '');
    }

    if (rawTags.has(lower)) {
      if (open.endsWith('/>')) {
        return open;
      }

      return (
        open + pick(rawTexts) + (maybe(0.9) ? `</${pick([lower, name, lower.toUpperCase()])}>` : '')
      );
    }

    let inner = '';

    for (let count = Math.floor(next() * 3); count > 0; count -= 1) {
      if (depth < 2 && maybe(0.6)) {
        inner += element(depth + 1);
      } else {
        inner += maybe(0.3) ? pick(comments) : pick(texts);
      }
    }

    return open + inner + (maybe(0.9) ? `</${name}>` : '');
  };
  const head = (): string => {
    let out = '';

    for (let count = 1 + Math.floor(next() * 6); count > 0; count -= 1) {
      const kind = next();

      if (kind < 0.6) {
        out += element(0);
      } else {
        out += kind < 0.75 ? pick(comments) : pick(texts);
      }
    }

    return out;
  };

  return Array.from({ length: size }, head);
};

/**
 * The head and the root opening tags of a document, as the server entry extracts them.
 */
const documentParts = (document: string): string[] => {
  const head = HEAD.exec(document)?.groups?.meta.trim() ?? '';
  const roots = [...document.matchAll(ROOT_TAG)].map(([tag, name]) => `${tag.trim()}</${name}>`);

  return [head, ...roots];
};

const fixture = (name: string): string => readFileSync(`__helpers__/fixtures/${name}.html`, 'utf8');
const font =
  '<link rel="stylesheet" href="https://fonts.example/css2?family=Inter&display=swap" media="print" onload="this.media=\'all\'" />';
const script = '<script onerror="x()" src="a.js" async></script>';
const templates = [
  '<html lang="en"><head><title>Test 1</title></head><body data-test="body-test"></body></html>',
  '<html lang="en"><head><title>Original</title></head><body class="original"></body></html>',
  '<html lang="fr" dir="rtl" class="x"><head><title>Original</title></head><body class="y"></body></html>',
  '<html title="A &amp; &quot;B&quot; &lt;C&gt; &#x27;D&#x27;" style="margin-top:2px"><head>\n<title>Test</title></head><body class="original" hidden style="padding-top:3px"></body></html>',
  '<html lang="en"><head>\n<title>A &amp; B</title>' +
    '<custom-meta buildId="Worker"></custom-meta>' +
    '<script type="application/ld+json">{"value":"<tag>&"}</script>' +
    '<style>.test > a { color: red; }</style></head><body></body></html>',
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Static</title>' +
    '<script>window.tpl = "<body class=\\"fake\\">";</script></head>' +
    '<body class="site"><div id="root"></div></body></html>',
  fixture('head'),
  fixture('vite-template-about'),
];
const staticHeads = [
  `\n  ${font}\n  ${script}\n  <meta charset="utf-8">\n`,
  `<meta name="description" content="static">${font}<title>Static</title>`,
  `<meta name="a" content="1">${script}<meta name="b" content="2">`,
  `<!-- fonts -->${font}<!--[if IE]><meta name="ie" content="1"><![endif]--><title>T</title><!-- end -->`,
  `<meta name="first" content="1"><script>window.price = '$1 $& $$';</script>`,
];
const generated = corpus(7, 400);
const generatedRoots = corpus(11, 60).map(
  (head, index) => `<${index % 2 ? 'body' : 'html'}${head.slice(head.indexOf(' '))}`,
);

const element = (type: string, props: Record<string, unknown>): unknown => ({
  type,
  key: null,
  props: { ...props, children: UNDEFINED },
});

/**
 * Where the output differs on purpose, with what the previous stack produced.
 */
const divergences = [
  {
    reason:
      'a doctype or processing instruction is kept with the next tag instead of an empty entry',
    html: '<!doctype html><meta charset=x>',
    previous: {
      elements: [[], element('meta', { charSet: 'x' })],
      sources: ['<!doctype html>', '<meta charset=x>'],
    },
    current: {
      elements: [element('meta', { charSet: 'x' })],
      sources: ['<!doctype html><meta charset=x>'],
    },
  },
  {
    reason: 'a closing tag with whitespace before its bracket no longer cuts the source',
    html: '<style>a</style ><meta name=b>',
    previous: {
      elements: [
        element('style', { dangerouslySetInnerHTML: { __html: 'a' } }),
        element('meta', { name: 'b' }),
      ],
      sources: ['<style>a</style ', undefined],
    },
    current: {
      elements: [
        element('style', { dangerouslySetInnerHTML: { __html: 'a' } }),
        element('meta', { name: 'b' }),
      ],
      sources: ['<style>a</style >', '<meta name=b>'],
    },
  },
  {
    reason: 'an element left open at the end of the input keeps its whole markup',
    html: '<noscript><meta name="a',
    previous: { elements: [element('noscript', {})], sources: ['<noscript><meta n'] },
    current: { elements: [element('noscript', {})], sources: ['<noscript><meta name="a'] },
  },
  {
    reason: 'input ending inside a tag after a slash no longer yields its last character as text',
    html: '<meta name=a><link rel=b /',
    previous: {
      elements: [element('meta', { name: 'a' }), '/'],
      sources: ['<meta name=a>', undefined],
    },
    current: { elements: [element('meta', { name: 'a' })], sources: ['<meta name=a>'] },
  },
  {
    reason: 'input ending after a closing tag name no longer yields its last character as text',
    html: '<meta name=a></x ',
    previous: {
      elements: [element('meta', { name: 'a' }), ' '],
      sources: ['<meta name=a>', undefined],
    },
    current: { elements: [element('meta', { name: 'a' })], sources: ['<meta name=a>'] },
  },
  {
    reason: 'an unterminated raw text tag name at the end of the input is not text',
    html: '<meta name=a><title',
    previous: {
      elements: [element('meta', { name: 'a' }), 'title'],
      sources: ['<meta name=a>', undefined],
    },
    current: { elements: [element('meta', { name: 'a' })], sources: ['<meta name=a>'] },
  },
  {
    reason: 'named references outside the legacy and typographic set are left as written',
    html: '<meta name=a>&notin;<meta content="&notin;">',
    previous: {
      elements: [element('meta', { name: 'a' }), '∉', element('meta', { content: '∉' })],
      sources: ['<meta name=a>', undefined, '<meta content="&notin;">'],
    },
    current: {
      elements: [
        element('meta', { name: 'a' }),
        '&notin;',
        element('meta', { content: '&notin;' }),
      ],
      sources: ['<meta name=a>', undefined, '<meta content="&notin;">'],
    },
  },
  {
    reason: 'only HTML attribute names are mapped to React props, SVG ones pass through',
    html: '<svg viewbox="0 0 1 1"></svg>',
    previous: {
      elements: [element('svg', { viewBox: '0 0 1 1' })],
      sources: ['<svg viewbox="0 0 1 1"></svg>'],
    },
    current: {
      elements: [element('svg', { viewbox: '0 0 1 1' })],
      sources: ['<svg viewbox="0 0 1 1"></svg>'],
    },
  },
];

describe('head parser', () => {
  const cases = [
    ...templates.flatMap(documentParts),
    ...staticHeads,
    ...generated,
    ...generatedRoots,
  ];

  it('should produce what html-react-parser produced', () => {
    expect(cases.length).to.be.above(400);

    for (const html of cases) {
      expect(parsed(current, html), html).to.equal(parsed(previous, html));
    }
  });

  it.each(divergences)('$reason', ({ html, previous: before, current: after }) => {
    const headOf = (stack: TStack) => {
      const { elements, sources } = stack.parseHead(html);

      return { elements: plain(elements), sources };
    };

    expect(headOf(previous)).to.deep.equal(before);
    expect(headOf(current)).to.deep.equal(after);
  });
});

const prodLib = path.resolve('.prod-lib');

describe.skipIf(!existsSync(prodLib))('server entry parity with the released build', () => {
  const containerId = 'container-id';
  const tags = (
    <>
      <html data-id="html-id" lang="en-EN" />
      <body data-id="body-id" />
      <title>Changed</title>
      <meta charSet="UTF-8" />
      <meta name="description" content="app" />
      <meta data-test="2" />
      <meta data-test="1" />
    </>
  );
  const page = (head: string): string =>
    `<html lang="en" class="page"><head>${head}</head><body class="site" style="margin:0"></body></html>`;
  const documents = [...templates, ...staticHeads.map(page), ...generated.map(page)];
  const attempt = (render: () => string): string => {
    try {
      return render();
    } catch (error) {
      return `throws ${(error as Error).message}`;
    }
  };

  it('should inject and serialise state byte for byte like before', async () => {
    const { Manager: ReleasedManager } = (await import(
      pathToFileURL(path.join(prodLib, 'index.js')).href
    )) as { Manager: typeof Manager };
    const { default: ReleasedServer } = (await import(
      pathToFileURL(path.join(prodLib, 'server/index.js')).href
    )) as { default: typeof ServerManager };
    const render = (
      Klass: typeof Manager,
      Server: typeof ServerManager,
      document: string,
      hasTags: boolean,
    ): string =>
      attempt(() => {
        const manager = new Klass();

        manager.isServer = true;

        if (hasTags) {
          manager.pushTags(tags, containerId);
        }

        const html = Server.inject(document, manager);

        return `${html}\n${JSON.stringify(Server.getState(manager))}`;
      });

    for (const document of documents) {
      for (const hasTags of [false, true]) {
        expect(render(Manager, ServerManager, document, hasTags), document).to.equal(
          render(ReleasedManager, ReleasedServer, document, hasTags),
        );
      }
    }
  });
});
