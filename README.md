# React meta tags manager with SSR and Suspense support

![npm](https://img.shields.io/npm/v/@lomray/react-head-manager)
![GitHub](https://img.shields.io/github/license/Lomray-Software/react-head-manager)

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=react-head-manager&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=react-head-manager)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=react-head-manager&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=react-head-manager)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=react-head-manager&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=react-head-manager)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=react-head-manager&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=react-head-manager)
[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=react-head-manager&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=react-head-manager)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=react-head-manager&metric=coverage)](https://sonarcloud.io/summary/new_code?id=react-head-manager)

## Getting started

The package is distributed using [npm](https://www.npmjs.com/), the node package manager.

```
npm i --save @lomray/react-head-manager
```

__WARNING:__ this package use [@lomray/consistent-suspense](https://github.com/Lomray-Software/consistent-suspense) for generate stable id's inside Suspense.

## Usage

Pass a manager into your application rather than sharing a module-level instance across server requests.

```tsx
import React from 'react';
import { ConsistentSuspenseProvider } from '@lomray/consistent-suspense';
import { MetaManagerProvider, Manager, Meta } from '@lomray/react-head-manager';

export const App = ({ manager }: { manager: Manager }) => (
  <ConsistentSuspenseProvider>
    <MetaManagerProvider manager={manager}>
      <Meta>
        <title>Example</title>
        <meta name="description" content="Description example" />
        <body data-id="test" />
      </Meta>
      <main>Example page</main>
    </MetaManagerProvider>
  </ConsistentSuspenseProvider>
);
```

For a client-rendered app, create one manager when mounting the application:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Manager } from '@lomray/react-head-manager';
import { App } from './app';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(<App manager={new Manager()} />);
```

### Server rendering

Create a fresh manager for **each request** and pass it to both your application and the server helpers. Do not reuse one server manager across requests: it holds the tags and container state for that render.

The server helpers are the default export from `@lomray/react-head-manager/server`. `MetaServer.inject(html, manager)` inserts the collected tags into your HTML; `MetaServer.getState(manager)` returns state for the client manager. SSR also needs the corresponding hydration and Suspense setup; the client-only mount above is not an SSR hydration example.

The [minimal SSR template](https://github.com/Lomray-Software/vite-template/tree/example/minimal) shows the complete integration:

- [`src/server.ts`](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/server.ts) creates a manager per request and uses the server helpers.
- [`src/client.ts`](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/client.ts) constructs the client manager from the server state.
- [`src/app.tsx`](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/app.tsx) supplies that manager to the provider.

Change tags order:
```typescript jsx
/**
 * Way 1
 */
const manager = new Manager();
manager.setTagsDefinitions({
  title: 1, // change order for title tag
  "meta[name='viewport']": 2, // change order for meta viewport tag
  meta: 100, // change for all meta tags
  script: 200, // change for all script tags
});

/**
 * Way 2
 */
<Meta>
  <title data-order={1}>Example</title>
  <meta data-order={3} name="description" content="Description example" />
  <meta data-order={2} name="keywords" content="test,key" />
</Meta>

/**
 * You can also use both...
 */
```

Explore [demo app](https://github.com/Lomray-Software/vite-template) to more understand.

## Workers and edge rendering

`MetaServer.inject` serves the static `<head>` of your HTML template as written. A tag the application does not override reaches the client verbatim, so inline handlers (`<link rel="stylesheet" media="print" onload="this.media='all'">`, `<script onerror="...">`), attribute casing and boolean attributes survive. Comments stay with the tag that follows them. Only tags replaced by a `<Meta>` from the application are rendered through React. Tags are still ordered by the manager (charset, viewport, title, base, meta, link, script, noscript, style; override with `data-order`). On hydration the client adopts existing head nodes and only touches the tags it owns.

The `@lomray/react-head-manager/server` entry supports Cloudflare Workers and other non-DOM edge bundles, including Vite SSR with `ssr.target: 'webworker'`. `MetaServer.inject` and `MetaServer.getState` work without a `document` global or bundler aliases for `html-dom-parser`.

## Bundle size

The browser build reads the existing head from the DOM and ships no HTML parser. `html-react-parser` is used only by the server helper.

## Bugs and feature requests

Bug or a feature request, [please open a new issue](https://github.com/Lomray-Software/react-head-manager/issues/new).

## License
Made with 💚

Published under [MIT License](./LICENSE).
