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

/**
 * Parse markup without a DOM while preserving React attribute conversion.
 */
const htmlParser = (html: string): ReturnType<typeof domToReact> =>
  domToReact(htmlToDOM(html, { lowerCaseAttributeNames: false }));

// The old pattern consumed the first character after <head>, losing a tag that followed it directly.
const HEAD = /<head(?:\s[^>]*)?>(?<meta>.*?)<\/head>/s;

const parserOptions = {
  lowerCaseAttributeNames: false,
  withStartIndices: true,
  withEndIndices: true,
};

/**
 * Parse the static head, keeping the original markup of every tag.
 * React drops what it does not accept as a prop (inline handlers, comments, unknown casing),
 * so untouched tags are served from their source instead of being rendered again.
 */
const parseHead = (html: string): { elements: ReactNode[]; sources: (string | undefined)[] } => {
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
 * Helpers for server side
 */
class ServerManager {
  /**
   * Parse existing head tags from html and merge with tags received at the render stage (from manager)
   *
   * @return new html with actual meta tags
   */
  public static inject(htmlStr: string, manager: Manager): string {
    const matchedMetaHtml = htmlStr.match(HEAD);
    const matchedHtmlAttr = htmlStr.match(/<html[^>]*?>/s);
    const matchedBodyAttr = htmlStr.match(/<body[^>]*?>/s);
    const { elements: rootTags, sources } = parseHead(matchedMetaHtml?.groups?.meta.trim() ?? '');
    const htmlTag = htmlParser(matchedHtmlAttr?.[0] ? `${matchedHtmlAttr?.[0].trim()}</html>` : '');
    const bodyTag = htmlParser(matchedBodyAttr?.[0] ? `${matchedBodyAttr?.[0].trim()}</body>` : '');

    // add root html props
    manager.pushTags(htmlTag, Manager.rootContainerId, false);
    // add root body props
    manager.pushTags(bodyTag, Manager.rootContainerId, false);
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
        htmlMeta += ReactDOMServer.renderToString(rendered as unknown as ReactElement);
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
    // Render a neutral element so React 19 does not insert document structure.
    const [htmlTagWithProps] = ReactDOMServer.renderToStaticMarkup(
      React.createElement('div', manager.getRootTagProps(html)),
    )
      .replace(/^<div/, '<html')
      .split('</div>');
    const [bodyTagWithProps] = ReactDOMServer.renderToStaticMarkup(
      React.createElement('div', manager.getRootTagProps(body)),
    )
      .replace(/^<div/, '<body')
      .split('</div>');

    return htmlStr
      .replace(HEAD, () => `<head>${htmlMeta}</head>`)
      .replace(/<html[^>]*?>/s, () => htmlTagWithProps)
      .replace(/<body[^>]*?>/s, () => bodyTagWithProps);
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
