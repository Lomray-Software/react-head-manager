import { createElement } from 'react';
import { Manager } from '../../lib/index.js';
import MetaServer from '../../lib/server/index.js';

/**
 * Exercise parsed markup and rendered overrides through the built server entry.
 */
export const renderHead = (withOverrides = false) => {
  const manager = new Manager();
  const source =
    '<html lang="en" style="margin-top:2px"><head>\n' +
    '<meta charset="UTF-8"><title>Original &amp; title</title>' +
    '<meta name="description" content="A &amp; &quot;B&quot;">' +
    '<link rel="icon" href="/favicon.ico">' +
    '<script type="application/ld+json">{"value":"<tag>&"}</script>' +
    '<noscript>Enable JavaScript</noscript><style>.test > a { color: red; }</style>' +
    '</head><body class="page" hidden><main>Unchanged &amp; body</main></body></html>';

  if (withOverrides) {
    manager.pushTags(
      [
        createElement('html', { lang: 'fr', dir: 'rtl' }),
        createElement('body', { className: 'app', hidden: false }),
        createElement('title', null, 'Worker & Node'),
        createElement('meta', { name: 'description', content: 'Updated & description' }),
      ],
      'app',
    );
  }

  const html = MetaServer.inject(source, manager);
  const state = MetaServer.getState(manager);

  return { isServer: manager.isServer, html, state };
};
