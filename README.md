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

## Usage
```typescript jsx
import { MetaManagerProvider, Manager, Meta } from '@lomray/react-head-manager';

const manager = new Manager();

/**
 * Root component container
 */
const App = ({ children }) => {
    const [state] = useState();

    return (
      <MetaManagerProvider manager={manager}>
        <MyComponent />
      </MetaManagerProvider>
    )
}

/**
 * Some component
 */
const MyComponent = () => {
    return (
      <>
        <Meta>
          <title>Example</title>
          <meta name="description" content="Description example" />
          <meta name="keywords" content="test,key" />
          <body data-id="test" />
        </Meta>
        <div>Some component....</div>
      </>
    )
}
```

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

__NOTE:__ this package use [@lomray/consistent-suspense](https://github.com/Lomray-Software/consistent-suspense) for generate stable id's. 

See [demo app](https://github.com/Lomray-Software/vite-template) to more understand.

## Bugs and feature requests

Bug or a feature request, [please open a new issue](https://github.com/Lomray-Software/react-head-manager/issues/new).

## License
Made with 💚

Published under [MIT License](./LICENSE).
