import EventManager from '@lomray/event-manager';
import type { ReactElement, ReactNode } from 'react';
import React, { Fragment, Children } from 'react';
import Events from './events';
import RootAttributes from './root-attributes';
import type { TStyleValue } from './root-attributes';
import TagStatus from './tag-status';

// One source of truth for React prop names and their HTML attribute names.
const attributeNames = new Map([
  ['className', 'class'],
  ['htmlFor', 'for'],
  ['httpEquiv', 'http-equiv'],
  ['charSet', 'charset'],
  ['crossOrigin', 'crossorigin'],
  ['referrerPolicy', 'referrerpolicy'],
  ['tabIndex', 'tabindex'],
  ['hrefLang', 'hreflang'],
  ['imageSrcSet', 'imagesrcset'],
  ['imageSizes', 'imagesizes'],
  ['fetchPriority', 'fetchpriority'],
  ['noModule', 'nomodule'],
  ['srcSet', 'srcset'],
  ['acceptCharset', 'accept-charset'],
  ['itemProp', 'itemprop'],
  ['itemScope', 'itemscope'],
  ['itemType', 'itemtype'],
  ['itemID', 'itemid'],
  ['itemRef', 'itemref'],
]);
const propNames = new Map([...attributeNames].map(([prop, attribute]) => [attribute, prop]));

const textEscapes = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#x27;'],
]);

/**
 * Text as React writes it into a raw text element (script, style): the browser keeps it escaped.
 */
const escapeText = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => textEscapes.get(char) ?? char);

/**
 * Text content the children of a tag stand for; undefined when they are not plain text.
 */
const getChildrenText = (children: unknown): string | undefined => {
  const nodes = (Array.isArray(children) ? children : [children]).filter(
    (node) => node != null && typeof node !== 'boolean',
  ) as unknown[];

  return nodes.every((node) => typeof node === 'string' || typeof node === 'number')
    ? nodes.join('')
    : undefined;
};

interface IDomAttributes {
  attributes: Map<string, string>;
  style?: Record<string, string>;
  text?: string;
  html?: string;
}

// Presence means true for HTML boolean attributes, regardless of their text value.
export const booleanAttributes = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'disablepictureinpicture',
  'disableremoteplayback',
  'formnovalidate',
  'hidden',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'scoped',
  'seamless',
  'selected',
]);

export interface IMetaManagerTags {
  html: Map<
    string,
    {
      props: Record<string, any>;
      order: number;
    }
  >;
  body: Map<
    string,
    {
      props: Record<string, any>;
      order: number;
    }
  >; // containerId => styles
  meta: Map<
    string,
    {
      element?: ReactElement;
      domElement?: HTMLElement;
      /** Original markup of an untouched static tag, emitted verbatim by the server. */
      source?: string;
      order: number;
      containerId: string;
      status: TagStatus;
    }
  >;
  containers: Set<string>;
}

export interface IMetaManagerTagsDefinitions {
  [type: string]: {
    key?: string;
    order: number;
  };
}

/**
 * Meta tags manager
 */
class Manager {
  /**
   * Root container id
   */
  public static rootContainerId = 'root';

  /**
   * Detect server side
   */
  public isServer = typeof window === 'undefined';

  /**
   * Meta tags state
   */
  protected tags: IMetaManagerTags;

  /**
   * Tags definitions
   */
  protected tagsDefinitions: IMetaManagerTagsDefinitions = {
    'meta[charset]': {
      order: 10,
    },
    "meta[name='viewport']": {
      order: 20,
    },
    title: {
      order: 100,
    },
    base: {
      order: 110,
    },
    meta: {
      order: 200,
    },
    link: {
      order: 300,
    },
    script: {
      order: 400,
    },
    noscript: {
      order: 500,
    },
    style: {
      order: 600,
    },
  };

  /**
   * System tag attributes
   */
  protected reservedAttributes = {
    order: 'data-order',
  };

  /**
   * Scheduled synchronization
   */
  protected syncTimerId: null | NodeJS.Timeout = null;

  /** DOM ownership is private client state, separate from the public tag snapshot. */
  private rootAttributes = new WeakMap<HTMLElement, RootAttributes>();

  /** Live head nodes have been adopted, see analyzeClientHead. */
  private isHeadAnalyzed = false;

  /**
   * @constructor
   */
  constructor(tags: Partial<Manager['tags']> = {}) {
    this.tags = {
      html: new Map(tags?.html),
      body: new Map(tags?.body),
      meta: new Map(tags?.meta),
      containers: new Set(tags?.containers),
    };
  }

  /**
   * Set tags definitions
   */
  public setTagsDefinitions(definitions: IMetaManagerTagsDefinitions): void {
    this.tagsDefinitions = { ...this.tagsDefinitions, ...definitions };
  }

  /**
   * Remove children, dangerouslySetInnerHTML etc.
   */
  public static cleanupElementProps(props: Record<string, any>): Record<string, any> {
    const { children: _, dangerouslySetInnerHTML: __, ...restProps } = props;

    return restProps;
  }

  /**
   * Sort elements or props
   */
  protected sortTags<T extends Map<string, { order: number }>>(elements: T): T {
    return new Map(
      [...elements.entries()].sort(([, tagA], [, tagB]) => tagA.order - tagB.order),
    ) as T;
  }

  /**
   * Get meta tags
   */
  public getTags(): IMetaManagerTags {
    const { meta, body, html, containers } = this.tags;

    return {
      html: this.sortTags(html),
      body: this.sortTags(body),
      meta: this.sortTags(meta),
      containers,
    };
  }

  /**
   * Replace react attribute to valid DOM attribute
   */
  protected replaceAttribute(tagName: string, attribute: string): string {
    return attributeNames.get(attribute) ?? attribute;
  }

  /**
   * Create DOM element from React element
   */
  protected createDomElement(
    element: Pick<ReactElement, 'type' | 'props'>,
  ): HTMLElement | undefined {
    if (this.isServer) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { type, props } = element;
    const domElement = document.createElement(type as string);

    this.applyDomElementAttributes(domElement, props as Record<string, string>);

    return domElement;
  }

  /**
   * Make element key by element props
   */
  protected buildKeyByProps(
    type: string,
    props: Record<string, any> = {},
    isSkipProps = false,
  ): string | undefined {
    let key = '';

    // try to build unique key by unique props
    for (const uniqueAttr of ['id', 'name', 'property', 'href', 'src']) {
      if (props[uniqueAttr]) {
        key = `[${uniqueAttr}='${props[uniqueAttr] as string}']`;

        break;
      }
    }

    // try to build by props
    if (!key && !isSkipProps) {
      for (const name of Object.keys(props)) {
        if (typeof props[name] === 'string') {
          key += `[${name}]`;
        }
      }
    }

    if (!key) {
      return undefined;
    }

    return `${type}${key}`;
  }

  /**
   * Get default tag key for not unique elements
   */
  protected getDefaultKey(type: string, containerId: string, index: number): string {
    return `${type}-${containerId}-${index}-not-unique`;
  }

  /**
   * Check if tag is not unique
   */
  protected isNotUniqueTag(key: string): boolean {
    return key.endsWith('-not-unique');
  }

  /**
   * Clone react element
   *
   * @param isRender the element itself is only built when the server renders it
   */
  protected cloneElement(
    element: Pick<ReactElement, 'type' | 'props'>,
    isRender = true,
  ): {
    element?: ReactElement;
    elementProps: Record<string, any>;
  } {
    const { type } = element;
    const props = { ...(element?.props ?? {}) } as Record<string, any>;

    // remove system attributes
    for (const attrName of Object.values(this.reservedAttributes)) {
      if (props[attrName]) {
        delete props[attrName];
      }
    }

    // fix multiple nodes for title
    if (type === 'title' && Array.isArray(props.children)) {
      props.children = props.children.join('');
    }

    return {
      element: isRender ? React.createElement(type, props) : undefined,
      elementProps: props,
    };
  }

  /**
   * Get element order
   */
  protected getElementOrder(
    elementProps: Record<string, any>,
    type: string,
    key: string = 'unknown',
  ): number {
    const elementOrder = elementProps[this.reservedAttributes.order]
      ? Number(elementProps[this.reservedAttributes.order])
      : undefined;

    return (
      elementOrder ?? this.tagsDefinitions[key]?.order ?? this.tagsDefinitions[type]?.order ?? 1000
    );
  }

  /**
   * Push react elements to meta state
   *
   * @returns true when a pushed tag still has to reach the DOM
   */
  protected pushElements(
    elements: ReactNode,
    containerId: string,
    isReplace = true,
    status = TagStatus.init,
    sources?: (string | undefined)[],
  ): boolean {
    let isPending = false;

    // unwrap fragment
    const clearElements: ReactNode =
      elements && typeof elements === 'object' && 'type' in elements && elements.type === Fragment
        ? ((elements.props as Record<string, any>).children as ReactNode)
        : elements;

    Children.forEach(clearElements, (child, index) => {
      // skip unsupported elements
      if (
        !child ||
        typeof child !== 'object' ||
        !('type' in child) ||
        !child.type ||
        typeof child.type !== 'string'
      ) {
        return;
      }

      isPending =
        this.pushElement(
          { type: child.type, props: child.props as Record<string, any> },
          index,
          containerId,
          isReplace,
          status,
          undefined,
          sources?.[index],
        ) || isPending;
    });

    this.tags.containers.add(containerId);

    return isPending;
  }

  /**
   * Register a React element or a snapshot of a live DOM element.
   *
   * @returns true when the tag still has to reach the DOM
   */
  protected pushElement(
    child: { type: string; props: Record<string, any> },
    index: number,
    containerId: string,
    isReplace: boolean,
    status: TagStatus,
    domElement?: HTMLElement,
    source?: string,
  ): boolean {
    const { type } = child;
    const isRender = this.isServer && source === undefined && type !== 'html' && type !== 'body';
    const { element, elementProps } = this.cloneElement(child, isRender);
    let key = this.tagsDefinitions[type]?.key ?? type;

    switch (type) {
      case 'title':
        break;

      case 'meta':
        const { charSet, httpEquiv } = elementProps;

        if (charSet) {
          key = `meta[charset]`;
        } else if (httpEquiv) {
          key = `meta[httpEquiv]`;
        } else {
          key = this.buildKeyByProps(type, elementProps)!;
        }

        break;

      case 'html':
      case 'body':
        if (!isReplace && this.tags[type].has(key)) {
          return false;
        }

        this.tags[type].set(containerId, {
          props: Manager.cleanupElementProps(elementProps),
          order:
            containerId === Manager.rootContainerId
              ? 1
              : this.getElementOrder(elementProps, type, key),
        });

        return false;

      case 'link':
      case 'script':
      case 'noscript':
      case 'style':
      default:
        key =
          this.buildKeyByProps(type, elementProps, true) ??
          this.getDefaultKey(type, containerId, index);
        break;
    }

    // skip replace existed meta tag (e.g. for push existed tags from parsed html, @see ServerManager)
    const existedTag = this.tags.meta.get(key);

    if (!isReplace && existedTag) {
      // Hydration may register a detached node before analysis. Keep the first live duplicate.
      if (domElement && existedTag.domElement?.parentNode !== domElement.parentNode) {
        existedTag.domElement = domElement;
      }

      return false;
    }

    const isNotUnique = this.isNotUniqueTag(key);

    // skip push already existed in head not unique tags
    if (isNotUnique && existedTag?.status === TagStatus.synced) {
      return false;
    }

    let tagStatus = status;
    let tagElement = domElement;

    /**
     * A live tag with the same key is updated in place instead of being re-created.
     * On hydration (status synced) the server rendered every tag of the container: not unique tags
     * adopt their live node by content, a tag the server did not render is inserted like any other.
     */
    if (!this.isServer && !domElement && containerId !== Manager.rootContainerId) {
      if (isNotUnique) {
        tagElement =
          status === TagStatus.synced ? this.takeRootElement(type, elementProps) : undefined;
      } else if (existedTag?.domElement?.isConnected) {
        tagElement = existedTag.domElement;
        this.applyDomElementAttributes(tagElement, elementProps);
      } else {
        tagElement = undefined;
      }

      tagStatus = tagElement ? TagStatus.synced : TagStatus.init;
    }

    this.tags.meta.set(key, {
      element: this.isServer ? element : undefined, // keep element only for server render
      domElement:
        /**
         * create DOM element only for client side
         * generate DOM element for root container inside @see this.analyzeClientHead
         */
        tagElement ??
        (containerId === Manager.rootContainerId
          ? undefined
          : this.createDomElement({ type, props: elementProps })),
      order: this.getElementOrder(elementProps, type, key),
      containerId,
      status: tagStatus,
      ...(source === undefined ? {} : { source }),
    });

    return tagStatus === TagStatus.init;
  }

  /**
   * Adopt the live not unique tag with the same type and content, still owned by the root container.
   */
  private takeRootElement(type: string, props: Record<string, any>): HTMLElement | undefined {
    for (const [key, { domElement, containerId }] of this.tags.meta) {
      if (
        containerId === Manager.rootContainerId &&
        this.isNotUniqueTag(key) &&
        domElement?.isConnected &&
        domElement.tagName.toLowerCase() === type &&
        this.isSameDomElement(domElement, props)
      ) {
        this.tags.meta.delete(key);

        return domElement;
      }
    }

    return undefined;
  }

  /**
   * Get html or body props
   */
  public getRootTagProps(props: Manager['tags']['html']): Record<string, any> {
    if (!props.size) {
      return {};
    }

    const result: Record<string, any> = {};

    for (const { props: tagProps } of props.values()) {
      Object.assign(result, tagProps);
    }

    return result;
  }

  /**
   * DOM attributes, inline style, text and markup the props of a tag stand for
   */
  private getDomAttributes(tagName: string, props: Record<string, any>): IDomAttributes {
    const reservedAttributes = Object.values(this.reservedAttributes);
    const result: IDomAttributes = { attributes: new Map() };

    for (const [name, value] of Object.entries(props)) {
      if (reservedAttributes.includes(name) || value === false || value == null) {
        continue;
      }

      if (name === 'children') {
        result.text = getChildrenText(value);
      } else if (name === 'dangerouslySetInnerHTML') {
        result.html = (value as { __html?: string })?.__html ?? '';
      } else if (name === 'style' && typeof value === 'object') {
        result.style = value as Record<string, string>;
      } else {
        result.attributes.set(
          this.replaceAttribute(tagName, name),
          value === true ? '' : String(value),
        );
      }
    }

    return result;
  }

  /**
   * Whether a live element already carries the attributes and text of the props
   */
  private isSameDomElement(element: HTMLElement, props: Record<string, any>): boolean {
    const { attributes, text, html } = this.getDomAttributes(element.tagName.toLowerCase(), props);

    if (element.attributes.length !== attributes.size) {
      return false;
    }

    for (const [name, value] of attributes) {
      if (element.getAttribute(name) !== value) {
        return false;
      }
    }

    if (html !== undefined) {
      return element.innerHTML === html;
    }

    return (
      text === undefined || element.textContent === text || element.textContent === escapeText(text)
    );
  }

  /**
   * Apply props to dom element: only what differs is touched, attributes not in the props are removed.
   */
  protected applyDomElementAttributes(element: Element, props: Record<string, any> = {}): void {
    const { attributes, style, text, html } = this.getDomAttributes(
      element.tagName.toLowerCase(),
      props,
    );

    for (const { name } of Array.from(element.attributes)) {
      if (!attributes.has(name)) {
        element.removeAttribute(name);
      }
    }

    for (const [name, value] of attributes) {
      if (element.getAttribute(name) !== value) {
        element.setAttribute(name, value);
      }
    }

    if (style) {
      Object.assign((element as HTMLElement).style, style);
    }

    if (html !== undefined) {
      if (element.innerHTML !== html) {
        element.innerHTML = html;
      }
    } else if (
      text !== undefined &&
      element.textContent !== text &&
      element.textContent !== escapeText(text)
    ) {
      element.textContent = text;
    }
  }

  /** Merge root style objects while retaining ownership of each contributed property. */
  private syncRootAttributes(
    element: HTMLElement,
    tags: IMetaManagerTags['html'],
    seed = false,
  ): void {
    const props = this.getRootTagProps(tags);
    const reservedAttributes = Object.values(this.reservedAttributes);
    const tagName = element.tagName.toLowerCase();
    const attributes = new Map(
      Object.entries(props)
        .filter(([name]) => !reservedAttributes.includes(name))
        .map(([name, value]) => [
          this.replaceAttribute(tagName, name),
          value === false || value == null ? null : value === true ? '' : String(value),
        ]),
    );
    const style = [...tags.values()].reduce<Record<string, TStyleValue>>(
      (result, { props: tagProps }) => {
        if (!('style' in tagProps)) {
          return result;
        }

        return tagProps.style && typeof tagProps.style === 'object'
          ? { ...result, ...(tagProps.style as Record<string, TStyleValue>) }
          : {};
      },
      {},
    );
    let ownership = this.rootAttributes.get(element);

    if (!ownership) {
      ownership = new RootAttributes();
      this.rootAttributes.set(element, ownership);
    }

    ownership.sync(element, attributes, style, seed);
  }

  /**
   * Synchronize local meta tags with head meta tags
   */
  protected syncMeta(containerId?: string): void {
    const { meta, html, body } = this.getTags();

    if (this.syncTimerId) {
      clearTimeout(this.syncTimerId);
    }

    // apply html, body props
    for (const { name, value } of [
      { name: 'html', value: html },
      { name: 'body', value: body },
    ]) {
      const domElement = document.querySelector<HTMLElement>(name);

      if (domElement) {
        this.syncRootAttributes(domElement, value);
      }
    }

    if (!meta.size || this.isServer) {
      return;
    }

    const head = document.getElementsByTagName('head')?.[0];
    let prevElement: HTMLElement | ChildNode | null | undefined;

    meta.forEach((metaTag, key) => {
      const { status, domElement } = metaTag;

      if (
        status === TagStatus.synced ||
        !domElement ||
        (containerId && containerId !== metaTag.containerId)
      ) {
        prevElement = domElement;

        return;
      }

      // remove tags
      if (status === TagStatus.drain) {
        prevElement = domElement.previousSibling;
        domElement?.remove();
        // `meta` is a sorted copy: drop the drained entry from the state, or it is kept forever.
        this.tags.meta.delete(key);

        return;
      }

      metaTag.status = TagStatus.synced;

      if (!this.isNotUniqueTag(key)) {
        const exist = document.querySelector(key);

        if (exist) {
          prevElement = domElement;
          exist.replaceWith(domElement);

          return;
        }
      }

      const beforeElement = prevElement && prevElement.nextSibling;

      if (beforeElement) {
        head.insertBefore(domElement, beforeElement);
      } else {
        head.append(domElement);
      }

      prevElement = domElement;
    });

    EventManager.publish(Events.SYNC_META, {});
  }

  /**
   * Push new meta tags
   *
   * @param sources original markup per child index; a tag stored with one is served verbatim
   */
  public pushTags(
    elements: ReactNode,
    containerId: string,
    isReplace = true,
    sources?: (string | undefined)[],
  ): void {
    const isAdded = this.tags.containers.has(containerId);

    // live head nodes must be known before the tags of a server rendered container adopt them
    if (!this.isServer && !this.isHeadAnalyzed) {
      this.analyzeClientHead();
    }

    const isPending = this.pushElements(
      elements,
      containerId,
      isReplace,
      isAdded ? TagStatus.synced : TagStatus.init,
      sources,
    );

    EventManager.publish(Events.PUSH_TAGS, { elements, containerId });

    // skip sync already synced tags
    if (this.isServer || (isAdded && !isPending)) {
      return;
    }

    this.syncMeta();
  }

  /**
   * Remove meta tags
   */
  public removeTags(containerId: string): void {
    this.tags.meta.forEach((metaTag, key) => {
      if (metaTag.containerId !== containerId || metaTag.containerId === Manager.rootContainerId) {
        return;
      }

      // remove immediately not unique tags
      if (this.isNotUniqueTag(key)) {
        metaTag.domElement?.remove();
        this.tags.meta.delete(key);

        return;
      }

      metaTag.status = TagStatus.drain;
    });

    if (containerId === Manager.rootContainerId) {
      return;
    }

    this.tags.body.delete(containerId);
    this.tags.html.delete(containerId);
    this.tags.containers.delete(containerId);
    this.syncTimerId = setTimeout(() => this.syncMeta(), 500);
  }

  /**
   * Read attributes and text from the live DOM without serializing markup.
   */
  protected getDomElementProps(element: HTMLElement): Record<string, any> {
    const props: Record<string, any> = Object.fromEntries(
      Array.from(element.attributes, ({ name, value }) => [
        propNames.get(name) ?? name,
        booleanAttributes.has(name) || (['capture', 'download'].includes(name) && value === '')
          ? true
          : value,
      ]),
    );

    if (element.hasAttribute('style')) {
      // The DOM already parsed inline CSS; keep the React style object used by root tags.
      props.style = Object.fromEntries(
        Array.from(element.style, (name) => {
          const propName = name.startsWith('--')
            ? name
            : name
                .replace(/^-ms-/, 'ms-')
                .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
          const priority = element.style.getPropertyPriority(name);
          const value = element.style.getPropertyValue(name);

          return [propName, priority ? `${value} !${priority}` : value];
        }),
      );
    }

    if (['title', 'style', 'script', 'noscript'].includes(element.tagName.toLowerCase())) {
      props.children = element.textContent ?? '';
    }

    return props;
  }

  /**
   * Initial analyze client head meta tags
   */
  public analyzeClientHead(): void {
    if (this.isServer || this.isHeadAnalyzed) {
      return;
    }

    this.isHeadAnalyzed = true;

    for (const element of [document.documentElement, document.body]) {
      if (element) {
        const type = element.tagName.toLowerCase() as 'html' | 'body';

        this.pushElement(
          { type, props: this.getDomElementProps(element) },
          0,
          Manager.rootContainerId,
          false,
          TagStatus.init,
        );

        if (!this.rootAttributes.has(element)) {
          this.syncRootAttributes(
            element,
            new Map([[Manager.rootContainerId, this.tags[type].get(Manager.rootContainerId)!]]),
            true,
          );
        }
      }
    }

    let index = 0;
    let isPreviousText = false;

    document.head?.childNodes.forEach((node) => {
      // Text occupied React child positions in the old snapshot, but never made tags.
      // Adjacent text nodes serialize as one; comments separate them without taking a position.
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) {
          if (!isPreviousText) {
            index += 1;
          }

          isPreviousText = true;
        }

        return;
      }

      isPreviousText = false;

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const element = node as HTMLElement;

      this.pushElement(
        { type: element.tagName.toLowerCase(), props: this.getDomElementProps(element) },
        index,
        Manager.rootContainerId,
        false,
        TagStatus.synced,
        element,
      );
      index += 1;
    });

    this.tags.containers.add(Manager.rootContainerId);
  }
}

export default Manager;
