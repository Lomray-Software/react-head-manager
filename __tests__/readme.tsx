import { readFileSync } from 'node:fs';
import { ConsistentSuspenseProvider } from '@lomray/consistent-suspense';
import ts from 'typescript';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as HeadManager from '../src';
import MetaServer from '../src/server';

const readApp = () => {
  const readme = readFileSync('README.md', 'utf8');
  const source = readme.match(/```tsx\n([\s\S]*?)```/)?.[1];

  if (!source) {
    throw new Error('README must contain the application example');
  }

  const { outputText: code } = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const imports: Record<string, unknown> = {
    react: React,
    '@lomray/consistent-suspense': { ConsistentSuspenseProvider },
    '@lomray/react-head-manager': HeadManager,
  };
  const module = { exports: {} as { App: React.FC<{ manager: HeadManager.Manager }> } };
  const requireExample = (name: string) => {
    if (!(name in imports)) {
      throw new Error(`Unexpected README import: ${name}`);
    }

    return imports[name];
  };

  // Execute the documented example rather than a separately maintained copy.
  new Function('require', 'module', 'exports', code)(requireExample, module, module.exports);

  return module.exports.App;
};

describe('README example', () => {
  it('collects tags with the manager supplied by the caller', () => {
    const App = readApp();
    const manager = new HeadManager.Manager();

    manager.isServer = true;
    const body = renderToString(<App manager={manager} />);
    const html = MetaServer.inject(`<html><head></head><body>${body}</body></html>`, manager);

    expect(html).toContain('<title>Example</title>');
    expect(html).toContain('content="Description example"');
    expect(html).toContain('data-id="test"');
    expect(html).toContain('<main>Example page</main>');
  });

  it('does not populate a different request manager', () => {
    const App = readApp();
    const first = new HeadManager.Manager();
    const second = new HeadManager.Manager();

    first.isServer = true;
    second.isServer = true;
    renderToString(<App manager={first} />);

    expect(first.getTags().meta.size).toBeGreaterThan(0);
    expect(second.getTags().meta.size).toBe(0);
    expect(second.getTags().body.size).toBe(0);
  });
});
