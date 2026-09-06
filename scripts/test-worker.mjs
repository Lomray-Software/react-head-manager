import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { renderHead } from './fixtures/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const expected = [renderHead(), renderHead(true)];

/**
 * Run with Worker web APIs and release any message ports opened by React.
 */
const runWithoutDOM = (bundle) => {
  const channels = [];

  /**
   * Track browser messaging resources so the check can exit after rendering.
   */
  function createMessageChannel() {
    const channel = new MessageChannel();

    channels.push(channel);

    return channel;
  }

  const context = { atob, TextEncoder, ReadableStream, MessageChannel: createMessageChannel };

  try {
    // The evaluated code is this repository's own esbuild output, not external input.
    const result = runInNewContext(`${bundle}\nserverResult;`, context, { timeout: 5000 }); // NOSONAR

    for (const name of ['document', 'window', 'DOMParser', 'process', 'Buffer']) {
      assert.equal(runInNewContext(`typeof ${name}`, context), 'undefined'); // NOSONAR
    }

    return JSON.parse(result);
  } finally {
    for (const { port1, port2 } of channels) {
      port1.close();
      port2.close();
    }
  }
};

for (const { isServer, html, state } of expected) {
  assert.equal(isServer, true);
  assert.match(html, /<meta charSet="UTF-8"\/>/);
  assert.match(html, /<script type="application\/ld\+json">{"value":"<tag>&"}<\/script>/);
  assert.match(html, /<style>\.test > a { color: red; }<\/style>/);
  assert.match(html, /<main>Unchanged &amp; body<\/main>/);
  assert.deepEqual(state.html[0], [
    'root',
    { props: { lang: 'en', style: { marginTop: '2px' } }, order: 1 },
  ]);
  assert.deepEqual(state.body[0], [
    'root',
    { props: { className: 'page', hidden: true }, order: 1 },
  ]);
}

assert.match(expected[0].html, /<title>Original &amp; title<\/title>/);
assert.match(expected[1].html, /<title>Worker &amp; Node<\/title>/);
assert.match(expected[1].html, /<html lang="fr" style="margin-top:2px" dir="rtl">/);
assert.match(expected[1].html, /<body class="app">/);
assert.deepEqual(expected[1].state.containers, ['app', 'root']);
console.info('[worker] Node: inject() and getState() passed for parsed markup and overrides.');

for (const conditions of [undefined, ['worker'], ['workerd'], ['worker', 'workerd']]) {
  const label = conditions?.join(',') ?? 'default';
  const { outputFiles, metafile } = await build({
    absWorkingDir: root,
    stdin: {
      contents:
        "import { renderHead } from './scripts/fixtures/server.mjs';" +
        'globalThis.serverResult = JSON.stringify([renderHead(), renderHead(true)]);',
      resolveDir: root,
      sourcefile: 'worker-check.mjs',
    },
    bundle: true,
    platform: 'browser',
    conditions,
    format: 'iife',
    write: false,
    metafile: true,
  });
  const [{ text: bundle }] = outputFiles;
  const inputs = Object.keys(metafile.inputs).join('\n');

  assert.deepEqual(runWithoutDOM(bundle), expected);
  assert.doesNotMatch(
    inputs,
    /html-dom-parser\/(?:lib|esm)\/index\./,
    'The server bundle must bypass the environment-dependent parser entry.',
  );
  assert.doesNotMatch(
    inputs,
    /html-dom-parser\/(?:lib|esm)\/client\//,
    'The server bundle must exclude the DOM parser.',
  );
  console.info(`[worker] platform=browser conditions=${label}: DOM-less output matches Node.`);
}

console.info('[worker] All checks passed; no aliases or DOM parser.');
