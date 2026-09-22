// noinspection HtmlRequiredTitleElement

import htmlToDOM from 'html-dom-parser/lib/server/html-to-dom';
import domToReact from 'html-react-parser/lib/dom-to-react';
import type { ReactElement, ReactNode } from 'react';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import Manager from '../manager';

interface IMetaManagerState {
  html: [string, Record<string, any>][];
  body: [string, Record<string, any>][];
  containers: string[];
}

interface IParsedHead {
  elements: ReactNode[];
  sources: (string | undefined)[];
}

interface IMatch {
  index: number;
  end: number;
  text: string;
}

/**
 * Parse markup without a DOM while preserving React attribute conversion.
 */
const htmlParser = (html: string): ReturnType<typeof domToReact> =>
  domToReact(htmlToDOM(html, { lowerCaseAttributeNames: false }));

// The old pattern consumed the first character after <head>, losing a tag that followed it directly.
const HEAD = /<head(?:\s[^>]*)?>(?<meta>.*?)<\/head>/s;
const HTML_TAG = /<html[^>]*?>/gs;
const BODY_TAG = /<body[^>]*?>/gs;

const parserOptions = {
  lowerCaseAttributeNames: false,
  withStartIndices: true,
  withEndIndices: true,
};

/**
 * A server renders a handful of distinct templates: their static parts are parsed once.
 * Parsed elements are never mutated (the manager copies props), so sharing them is safe.
 */
const TEMPLATE_CACHE_LIMIT = 16;
const headCache = new Map<string, IParsedHead>();
const rootTagCache = new Map<string, ReturnType<typeof domToReact>>();

const memoize = <T>(cache: Map<string, T>, key: string, parse: (key: string) => T): T => {
  const cached = cache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const value = parse(key);

  if (cache.size >= TEMPLATE_CACHE_LIMIT) {
    const [oldest] = cache.keys();

    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }

  cache.set(key, value);

  return value;
};

/**
 * Parse the static head, keeping the original markup of every tag.
 * React drops what it does not accept as a prop (inline handlers, comments, unknown casing),
 * so untouched tags are served from their source instead of being rendered again.
 */
const parseHead = (html: string): IParsedHead => {
  const elements: ReactNode[] = [];
  const sources: (string | undefined)[] = [];
  let comments = '';

  for (const node of htmlToDOM(html, parserOptions)) {
    const markup = html.slice(node.startIndex ?? 0, (node.endIndex ?? -1) + 1);

    if ((node.type as string) === 'comment') {
      // Comments have no position of their own after sorting: keep them with the next tag.
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

  // Comments after the last tag stay at the end of the head.
  if (comments) {
    elements.push(React.createElement('noscript'));
    sources.push(comments);
  }

  return { elements, sources };
};

/**
 * Find the first opening tag that is not part of the head markup.
 */
const findRootTag = (
  regexp: RegExp,
  html: string,
  head: IMatch | undefined,
): IMatch | undefined => {
  regexp.lastIndex = 0;

  for (let match = regexp.exec(html); match; match = regexp.exec(html)) {
    const { index } = match;
    const [text] = match;

    if (!head || index >= head.end || index + text.length <= head.index) {
      return { index, end: index + text.length, text };
    }
  }

  return undefined;
};

/**
 * Render root tag props into an opening tag.
 * A neutral element is rendered so React 19 does not insert document structure.
 */
const renderRootTag = (type: string, props: Record<string, any>): string => {
  const [tag] = ReactDOMServer.renderToStaticMarkup(React.createElement('div', props))
    .replace(/^<div/, `<${type}`)
    .split('</div>');

  return tag;
};

/**
 * Helpers for server side
 */
class ServerManager {
  /**
   * Parse existing head tags from html and merge with tags received at the render stage (from manager)
   *
   * @return new html with actual meta tags
   */
  public static inject(htmlStr: string, manager: Manager): string {
    const matchedHead = HEAD.exec(htmlStr);
    const head: IMatch | undefined = matchedHead
      ? { index: matchedHead.index, end: matchedHead.index + matchedHead[0].length, text: '' }
      : undefined;
    const htmlTag = findRootTag(HTML_TAG, htmlStr, head);
    const bodyTag = findRootTag(BODY_TAG, htmlStr, head);
    const { elements: rootTags, sources } = memoize(
      headCache,
      matchedHead?.groups?.meta.trim() ?? '',
      parseHead,
    );

    // add root html props
    manager.pushTags(
      htmlTag ? memoize(rootTagCache, `${htmlTag.text.trim()}</html>`, htmlParser) : '',
      Manager.rootContainerId,
      false,
    );
    // add root body props
    manager.pushTags(
      bodyTag ? memoize(rootTagCache, `${bodyTag.text.trim()}</body>`, htmlParser) : '',
      Manager.rootContainerId,
      false,
    );
    // add root meta tags to manager
    manager.pushTags(rootTags, Manager.rootContainerId, false, sources);

    const { meta, html, body } = manager.getTags();
    let htmlMeta = '';
    let rendered: ReactElement[] = [];

    /**
     * Tags from the application still go through React, in one pass per run of neighbours.
     */
    const flush = (): void => {
      if (rendered.length) {
        htmlMeta += ReactDOMServer.renderToString(rendered);
        rendered = [];
      }
    };

    for (const { element, source } of meta.values()) {
      if (source === undefined) {
        rendered.push(element!);
      } else {
        flush();
        htmlMeta += source;
      }
    }

    flush();

    if (head) {
      head.text = `<head>${htmlMeta}</head>`;
    }

    if (htmlTag) {
      htmlTag.text = renderRootTag('html', manager.getRootTagProps(html));
    }

    if (bodyTag) {
      bodyTag.text = renderRootTag('body', manager.getRootTagProps(body));
    }

    // Splice every replacement in one pass instead of copying the document per tag.
    const replacements = [head, htmlTag, bodyTag]
      .filter((match): match is IMatch => match !== undefined)
      .sort((matchA, matchB) => matchA.index - matchB.index);
    let result = '';
    let position = 0;

    for (const { index, end, text } of replacements) {
      result += htmlStr.slice(position, index) + text;
      position = end;
    }

    return result + htmlStr.slice(position);
  }

  /**
   * Get meta manager state to pass on client
   */
  public static getState(manager: Manager): IMetaManagerState {
    const { html, body, containers } = manager.getTags();

    return {
      html: [...html.entries()],
      body: [...body.entries()],
      containers: [...containers],
    };
  }
}

export default ServerManager;
