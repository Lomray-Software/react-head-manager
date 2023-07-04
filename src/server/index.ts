// noinspection HtmlRequiredTitleElement

import htmlParser from 'html-react-parser';
import type { ReactElement } from 'react';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import Manager from '../manager';

interface IMetaManagerState {
  html: [string, Record<string, any>][];
  body: [string, Record<string, any>][];
  containers: string[];
}

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
    const matchedMetaHtml = htmlStr.match(/<head[^/].+?>?(?<meta>.+)<\/head>/s);
    const matchedHtmlAttr = htmlStr.match(/<html[^>]*?>/s);
    const matchedBodyAttr = htmlStr.match(/<body[^>]*?>/s);
    const rootTags = htmlParser(matchedMetaHtml?.groups?.meta.trim() ?? '');
    const htmlTag = htmlParser(matchedHtmlAttr?.[0] ? `${matchedHtmlAttr?.[0].trim()}</html>` : '');
    const bodyTag = htmlParser(matchedBodyAttr?.[0] ? `${matchedBodyAttr?.[0].trim()}</body>` : '');

    // add root html props
    manager.pushTags(htmlTag, Manager.rootContainerId, false);
    // add root body props
    manager.pushTags(bodyTag, Manager.rootContainerId, false);
    // add root meta tags to manager
    manager.pushTags(rootTags, Manager.rootContainerId, false);

    const { meta, html, body } = manager.getTags();
    const htmlMeta = ReactDOMServer.renderToString(
      [...meta.values()].map(({ element }) => element) as unknown as ReactElement,
    );
    const [htmlTagWithProps] = ReactDOMServer.renderToString(
      React.createElement('html', manager.getRootTagProps(html)),
    ).split('</html>');
    const [bodyTagWithProps] = ReactDOMServer.renderToString(
      React.createElement('body', manager.getRootTagProps(body)),
    ).split('</body>');

    return htmlStr
      .replace(/<head[^/].+?>?(?<meta>.+)<\/head>/s, `<head>${htmlMeta}</head>`)
      .replace(/<html[^>]*?>/s, htmlTagWithProps)
      .replace(/<body[^>]*?>/s, bodyTagWithProps);
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
