import { expect } from 'chai';
import React from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { Manager } from '../src';

const themeAttribute = 'data-theme';
const orderAttribute = 'data-order';
const classContainer = 'class-owner';
const styleContainer = 'style-owner';

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

  it('preserves runtime root attributes across navigation and delayed synchronization', () => {
    vi.useFakeTimers();
    document.documentElement.setAttribute('lang', 'en');
    const manager = new ClientManager();

    manager.analyzeClientHead();
    document.documentElement.classList.add('dark');
    document.body.setAttribute(themeAttribute, 'runtime');
    manager.pushTags(<title>Home</title>, 'home');

    const expectRuntimeAttributes = () => {
      expect(document.documentElement.getAttribute('class')).to.equal('dark');
      expect(document.body.getAttribute(themeAttribute)).to.equal('runtime');
      expect(document.documentElement.getAttribute('lang')).to.equal('en');
    };

    expectRuntimeAttributes();
    manager.removeTags('home');
    manager.pushTags(<title>About</title>, 'about');
    vi.advanceTimersByTime(500);
    expectRuntimeAttributes();
    manager.removeTags('about');
    vi.advanceTimersByTime(500);
    expectRuntimeAttributes();
  });

  it.each(['before', 'after'])('preserves runtime class tokens added %s a Meta class', (timing) => {
    vi.useFakeTimers();
    document.documentElement.setAttribute('lang', 'en');
    const manager = new ClientManager();

    manager.analyzeClientHead();

    if (timing === 'before') {
      document.documentElement.classList.add('dark');
    }

    manager.pushTags(<html lang="en" className="from-meta" />, classContainer);

    if (timing === 'after') {
      document.documentElement.classList.add('dark');
    }

    manager.pushTags(<title>About</title>, 'about');

    expect(document.documentElement.classList.contains('dark')).to.equal(true);
    expect(document.documentElement.classList.contains('from-meta')).to.equal(true);
    manager.removeTags(classContainer);
    vi.advanceTimersByTime(500);

    expect(document.documentElement.getAttribute('class')).to.equal('dark');
    expect(document.documentElement.getAttribute('lang')).to.equal('en');
  });

  it('removes a class written only by Meta and leaves unrelated runtime attributes', () => {
    vi.useFakeTimers();
    document.documentElement.setAttribute('lang', 'en');
    const manager = new ClientManager();

    manager.analyzeClientHead();
    manager.pushTags(<html lang="en" className="from-meta" data-page="about" />, classContainer);
    document.documentElement.setAttribute('data-runtime', 'keep');
    manager.removeTags(classContainer);
    vi.advanceTimersByTime(500);

    expect(document.documentElement.hasAttribute('class')).to.equal(false);
    expect(document.documentElement.hasAttribute('data-page')).to.equal(false);
    expect(document.documentElement.getAttribute('data-runtime')).to.equal('keep');
    expect(document.documentElement.getAttribute('lang')).to.equal('en');
  });

  it('merges owned styles and restores snapshot properties without deleting runtime styles', () => {
    vi.useFakeTimers();
    document.documentElement.setAttribute('lang', 'en');
    document.documentElement.style.color = 'red';
    document.documentElement.style.marginTop = '2px';
    const manager = new ClientManager();

    manager.analyzeClientHead();
    document.documentElement.style.paddingTop = '3px';
    manager.pushTags(
      <html lang="en" style={{ color: 'blue', backgroundColor: 'black' }} />,
      styleContainer,
    );

    expect(document.documentElement.style.color).to.equal('blue');
    expect(document.documentElement.style.marginTop).to.equal('2px');
    expect(document.documentElement.style.paddingTop).to.equal('3px');
    document.documentElement.style.borderTopWidth = '4px';
    manager.removeTags(styleContainer);
    vi.advanceTimersByTime(500);

    expect(document.documentElement.style.color).to.equal('red');
    expect(document.documentElement.style.backgroundColor).to.equal('');
    expect(document.documentElement.style.marginTop).to.equal('2px');
    expect(document.documentElement.style.paddingTop).to.equal('3px');
    expect(document.documentElement.style.borderTopWidth).to.equal('4px');
    expect(document.documentElement.getAttribute('lang')).to.equal('en');
  });

  it('removes a style attribute created only by Meta', () => {
    vi.useFakeTimers();
    const manager = new ClientManager();

    manager.analyzeClientHead();
    manager.pushTags(<body style={{ color: 'red' }} />, styleContainer);
    manager.removeTags(styleContainer);
    vi.advanceTimersByTime(500);

    expect(document.body.hasAttribute('style')).to.equal(false);
  });

  it('keeps runtime edits to snapshot attributes when the requested props are unchanged', () => {
    vi.useFakeTimers();
    setupDocument();
    const manager = new ClientManager();

    manager.analyzeClientHead();
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    document.body.setAttribute('data-id', 'runtime');
    manager.pushTags(<title>About</title>, 'about');
    manager.removeTags('about');
    vi.advanceTimersByTime(500);

    expect(document.documentElement.getAttribute('class')).to.equal('light');
    expect(document.body.getAttribute('data-id')).to.equal('runtime');
    expect(document.documentElement.getAttribute('lang')).to.equal('en');
  });

  it('restores runtime values temporarily overridden by Meta and keeps subsequent external edits', () => {
    vi.useFakeTimers();
    const manager = new ClientManager();

    manager.analyzeClientHead();
    document.body.setAttribute(themeAttribute, 'runtime');
    document.body.style.color = 'red';
    manager.pushTags(<body data-theme="meta" style={{ color: 'blue' }} />, styleContainer);

    expect(document.body.getAttribute(themeAttribute)).to.equal('meta');
    expect(document.body.style.color).to.equal('blue');
    manager.removeTags(styleContainer);
    vi.advanceTimersByTime(500);

    expect(document.body.getAttribute(themeAttribute)).to.equal('runtime');
    expect(document.body.style.color).to.equal('red');
    manager.pushTags(<body data-theme="meta" style={{ color: 'blue' }} />, styleContainer);
    document.body.setAttribute(themeAttribute, 'external');
    document.body.style.color = 'green';
    manager.removeTags(styleContainer);
    vi.advanceTimersByTime(500);

    expect(document.body.getAttribute(themeAttribute)).to.equal('external');
    expect(document.body.style.color).to.equal('green');
  });

  it('restores earlier style contributions including custom properties and priorities', () => {
    vi.useFakeTimers();
    const manager = new ClientManager();

    manager.analyzeClientHead();
    manager.pushTags(<body style={{ color: 'red' }} />, 'layout');
    document.body.style.paddingTop = '3px';
    manager.pushTags(
      <body style={{ color: 'blue', '--accent': 'black !important' } as React.CSSProperties} />,
      styleContainer,
    );

    expect(document.body.style.getPropertyValue('--accent')).to.equal('black');
    expect(document.body.style.getPropertyPriority('--accent')).to.equal('important');
    manager.removeTags(styleContainer);
    vi.advanceTimersByTime(500);

    expect(document.body.style.color).to.equal('red');
    expect(document.body.style.getPropertyValue('--accent')).to.equal('');
    manager.removeTags('layout');
    vi.advanceTimersByTime(500);

    expect(document.body.style.color).to.equal('');
    expect(document.body.style.paddingTop).to.equal('3px');
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
