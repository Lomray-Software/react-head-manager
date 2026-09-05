import { expect } from 'chai';
import React from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { Manager } from '../src';

const themeAttribute = 'data-theme';
const orderAttribute = 'data-order';

class ClientManager extends Manager {
  public sync(): void {
    this.syncMeta();
  }

  public read(element: HTMLElement): Record<string, any> {
    return this.getDomElementProps(element);
  }

  public apply(element: HTMLElement, props: Record<string, any>): void {
    this.applyDomElementAttributes(element, props);
  }
}

const setupDocument = () => {
  document.documentElement.setAttribute('lang', 'en');
  document.documentElement.setAttribute('class', 'dark');
  document.documentElement.setAttribute(themeAttribute, 'x');
  document.head.innerHTML = '<title>Initial</title>';
  document.body.setAttribute('class', 'app');
  document.body.setAttribute('data-id', 'test');
};

describe('Root attribute synchronization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const element of [document.documentElement, document.body]) {
      element.getAttributeNames().forEach((name) => element.removeAttribute(name));
    }
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('preserves root classes and attributes after a Meta title push and sync', () => {
    setupDocument();
    const manager = new ClientManager();

    manager.analyzeClientHead();
    manager.pushTags(<title>t</title>, 'title');
    manager.sync();

    expect(document.documentElement.getAttribute('class')).to.equal('dark');
    expect(document.documentElement.getAttribute('lang')).to.equal('en');
    expect(document.documentElement.getAttribute(themeAttribute)).to.equal('x');
    expect(document.body.getAttribute('class')).to.equal('app');
    expect(document.body.getAttribute('data-id')).to.equal('test');
    expect(document.querySelector('[classname]')).to.equal(null);
    expect(document.title).to.equal('t');
  });

  it('merges a Meta body class override and restores the root class on removal', () => {
    vi.useFakeTimers();
    setupDocument();
    document.body.setAttribute('hidden', '');
    document.body.setAttribute('itemscope', '');
    const manager = new ClientManager();

    manager.analyzeClientHead();
    manager.pushTags(<body className="b" hidden={false} itemScope={false} />, 'body-override');

    expect(document.body.getAttribute('class')).to.equal('b');
    expect(document.body.hasAttribute('hidden')).to.equal(false);
    expect(document.body.hasAttribute('itemscope')).to.equal(false);
    expect(document.body.getAttribute('data-id')).to.equal('test');
    expect(document.documentElement.getAttribute('class')).to.equal('dark');

    manager.removeTags('body-override');
    vi.advanceTimersByTime(500);

    expect(document.body.getAttribute('class')).to.equal('app');
    expect(document.body.getAttribute('hidden')).to.equal('');
    expect(document.body.getAttribute('itemscope')).to.equal('');
    expect(document.body.getAttribute('data-id')).to.equal('test');
    expect(document.querySelector('[classname]')).to.equal(null);
  });

  it('keeps reserved and empty attributes but removes props whose container disappeared', () => {
    vi.useFakeTimers();
    setupDocument();
    document.documentElement.setAttribute(orderAttribute, '5');
    document.body.setAttribute(orderAttribute, '6');
    const manager = new ClientManager();

    manager.analyzeClientHead();
    const remove = vi.spyOn(document.documentElement, 'removeAttribute');

    manager.pushTags(
      <>
        <html lang="fr" data-theme="" tabIndex={-1} data-temporary="active" />
        <body {...{ htmlFor: 'target' }} title="temporary" />
      </>,
      'attributes',
    );
    manager.sync();

    expect(document.documentElement.getAttribute('class')).to.equal('dark');
    expect(document.documentElement.getAttribute('lang')).to.equal('fr');
    expect(document.documentElement.getAttribute(themeAttribute)).to.equal('');
    expect(document.documentElement.getAttribute('tabindex')).to.equal('-1');
    expect(document.documentElement.getAttribute(orderAttribute)).to.equal('5');
    expect(document.body.getAttribute(orderAttribute)).to.equal('6');
    expect(document.body.getAttribute('for')).to.equal('target');
    expect(document.body.hasAttribute('htmlfor')).to.equal(false);
    expect(remove.mock.calls).to.deep.equal([]);

    manager.removeTags('attributes');
    vi.advanceTimersByTime(500);

    expect(document.documentElement.getAttribute('lang')).to.equal('en');
    expect(document.documentElement.getAttribute(themeAttribute)).to.equal('x');
    expect(document.documentElement.hasAttribute('tabindex')).to.equal(false);
    expect(document.documentElement.hasAttribute('data-temporary')).to.equal(false);
    expect(document.body.hasAttribute('for')).to.equal(false);
    expect(document.body.hasAttribute('title')).to.equal(false);
    expect(document.body.getAttribute('class')).to.equal('app');
    expect(document.documentElement.getAttribute(orderAttribute)).to.equal('5');
    expect(document.body.getAttribute(orderAttribute)).to.equal('6');
  });

  it('reads and writes every attribute alias using inverse names', () => {
    document.head.innerHTML = `<link class="asset" for="target" http-equiv="refresh"
      charset="utf-8" crossorigin="anonymous" referrerpolicy="no-referrer" tabindex="0"
      hreflang="en" imagesrcset="/image.png 1x" imagesizes="100vw" fetchpriority="high"
      nomodule srcset="/image.png 1x" accept-charset="utf-8" itemprop="image" itemscope
      itemtype="https://schema.org/ImageObject" itemid="image" itemref="description"
      data-label="custom" aria-label="Image">`;
    const source = document.head.querySelector('link')!;
    const manager = new ClientManager();
    const props = manager.read(source);

    expect(props).to.deep.equal({
      className: 'asset',
      htmlFor: 'target',
      httpEquiv: 'refresh',
      charSet: 'utf-8',
      crossOrigin: 'anonymous',
      referrerPolicy: 'no-referrer',
      tabIndex: '0',
      hrefLang: 'en',
      imageSrcSet: '/image.png 1x',
      imageSizes: '100vw',
      fetchPriority: 'high',
      noModule: true,
      srcSet: '/image.png 1x',
      acceptCharset: 'utf-8',
      itemProp: 'image',
      itemScope: true,
      itemType: 'https://schema.org/ImageObject',
      itemID: 'image',
      itemRef: 'description',
      'data-label': 'custom',
      'aria-label': 'Image',
    });

    const target = document.createElement('link');
    const set = vi.spyOn(target, 'setAttribute');

    manager.apply(target, props);

    expect(target.isEqualNode(source)).to.equal(true);
    // Check the actual API arguments; HTML lowercases charSet/crossOrigin even without a map.
    expect(set.mock.calls.map(([name]) => name)).to.deep.equal(source.getAttributeNames());
    expect(manager.read(target)).to.deep.equal(props);
  });

  it('writes canonical meta and link attributes through Meta pushes', () => {
    setupDocument();
    const manager = new ClientManager();

    manager.analyzeClientHead();
    const set = vi.spyOn(Element.prototype, 'setAttribute');

    manager.pushTags(
      <>
        <meta charSet="utf-8" />
        <meta httpEquiv="refresh" content="30" />
        <link crossOrigin="anonymous" href="/x.css" rel="stylesheet" />
        <script src="/app.js" noModule async={false} defer />
      </>,
      'head-attributes',
    );

    expect(document.head.querySelector('meta[charset]')!.getAttribute('charset')).to.equal('utf-8');
    expect(document.head.querySelector('meta[http-equiv]')!.getAttribute('http-equiv')).to.equal(
      'refresh',
    );
    expect(document.head.querySelector('link')!.getAttribute('crossorigin')).to.equal('anonymous');
    expect(set.mock.calls).to.deep.include(['charset', 'utf-8']);
    expect(set.mock.calls).to.deep.include(['crossorigin', 'anonymous']);
    const script = document.head.querySelector('script')!;

    expect(script.getAttribute('nomodule')).to.equal('');
    expect(script.getAttribute('defer')).to.equal('');
    expect(script.hasAttribute('async')).to.equal(false);
  });

  it.each([false, null, undefined])('removes boolean and mapped attributes for %s', (value) => {
    const manager = new ClientManager();
    const element = document.createElement('link');

    element.setAttribute('disabled', 'true');
    element.setAttribute('crossorigin', 'anonymous');
    element.setAttribute('style', 'color:red');
    manager.apply(element, { disabled: value, crossOrigin: value, style: value });

    expect(element.getAttributeNames()).to.deep.equal([]);
    manager.apply(element, { disabled: true, itemScope: true, tabIndex: 0, 'data-empty': '' });

    expect(element.getAttribute('disabled')).to.equal('');
    expect(element.getAttribute('itemscope')).to.equal('');
    expect(element.getAttribute('tabindex')).to.equal('0');
    expect(element.getAttribute('data-empty')).to.equal('');
  });
});
