import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), 'react-head-manager-package-'));
const env = { ...process.env };

delete env.NO_COLOR;

const npm = (args, cwd, capture = false) =>
  execFileSync('npm', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });

try {
  let buildNode = process.version;

  try {
    npm(['run', 'build'], root);
  } catch {
    console.info(`[package] Build failed on Node ${buildNode}; retrying with Node v20.18.3.`);
    npm(['exec', '--yes', '--package=node@20.18.3', '--', 'npm', 'run', 'build'], root);
    buildNode = 'v20.18.3';
  }

  console.info(`[package] Built with Node ${buildNode}.`);
  const lib = path.join(root, 'lib');

  // Match release preparation without changing the working tree's manifest or running Husky.
  npm(['pkg', 'delete', 'scripts.prepare'], lib);
  const packed = npm(['pack', '--pack-destination', temporary], lib, true)
    .trim()
    .split(/\r?\n/)
    .at(-1);

  assert.ok(packed?.endsWith('.tgz'), `Expected an archive filename from npm pack: ${packed}`);
  const archive = path.join(temporary, packed);
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const peers = Object.fromEntries(
    Object.keys(manifest.peerDependencies).map((name) => [
      name,
      JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'))
        .version,
    ]),
  );

  writeFileSync(
    path.join(temporary, 'package.json'),
    JSON.stringify({
      name: 'head-manager-consumer',
      private: true,
      type: 'module',
      dependencies: peers,
    }),
  );
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], temporary);

  const require = createRequire(path.join(temporary, 'package.json'));
  const entry = require.resolve('@lomray/react-head-manager');
  const packageRoot = path.dirname(entry);
  const installed = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

  assert.equal(installed.sideEffects, false);
  assert.ok(
    installed.dependencies['html-react-parser'],
    'The server parser must remain a runtime dependency.',
  );
  const forbidden =
    /html-react-parser|html-dom-parser|htmlparser2|domhandler|entities|style-to-js|inline-style-parser|react-dom\/server/;
  const visited = new Set();

  const inspect = (filename) => {
    if (visited.has(filename)) {
      return;
    }

    visited.add(filename);
    const source = readFileSync(filename, 'utf8');

    assert.doesNotMatch(source, forbidden, `Parser/server reference in client module ${filename}`);
    const parsed = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const localRequire = createRequire(filename);
    const inspectSpecifier = (specifier) => {
      assert.ok(ts.isStringLiteralLike(specifier), `Nonliteral module import in ${filename}`);
      if (specifier.text.startsWith('.')) {
        const resolved = localRequire.resolve(specifier.text);

        assert.ok(
          resolved.startsWith(`${packageRoot}${path.sep}`),
          `Import escaped the installed package: ${resolved}`,
        );
        inspect(resolved);
      }
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          inspectSpecifier(node.moduleSpecifier);
        }
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        assert.equal(node.arguments.length, 1);
        inspectSpecifier(node.arguments[0]);
      }

      ts.forEachChild(node, visit);
    };

    visit(parsed);
  };

  inspect(entry);
  console.info(
    `[package] Client graph: ${[...visited]
      .map((filename) => path.relative(packageRoot, filename))
      .sort()
      .join(', ')}`,
  );
  console.info('[package] Forbidden client references: []');

  // Resolve the existing directory entry just as consumers of the /server deep import do.
  // Keep the published module layout: no exports map or new entry point is required.
  const consumer = String.raw`
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { Manager } from '@lomray/react-head-manager';

const require = createRequire(import.meta.url);
const serverPath = require.resolve('@lomray/react-head-manager/server');
const { default: ServerManager } = await import(pathToFileURL(serverPath).href);
const manager = new Manager();

assert.equal(manager.isServer, true);
manager.pushTags(React.createElement('title', null, 'Packed server works'), 'consumer');
const result = ServerManager.inject(
  '<html lang="en"><head>\n<meta charset="UTF-8"><title>Original</title><link rel="icon" href="/favicon.ico"></head><body class="page"></body></html>',
  manager,
);

assert.equal(result, '<html lang="en"><head><meta charSet="UTF-8"/><title>Packed server works</title><link rel="icon" href="/favicon.ico"/></head><body class="page"></body></html>');
assert.deepEqual(ServerManager.getState(manager), {
  html: [['root', { props: { lang: 'en' }, order: 1 }]],
  body: [['root', { props: { className: 'page' }, order: 1 }]],
  containers: ['consumer', 'root'],
});
console.info('[package] @lomray/react-head-manager/server resolves; inject() and getState() passed.');
`;

  writeFileSync(path.join(temporary, 'verify.mjs'), consumer);
  execFileSync(process.execPath, ['verify.mjs'], { cwd: temporary, env, stdio: 'inherit' });
  console.info('[package] All checks passed.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
