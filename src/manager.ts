import EventManager from '@lomray/event-manager';
import type { ReactElement, ReactNode } from 'react';
import React, { Fragment, Children } from 'react';
import Events from './events';
import RootAttributes from './root-attributes';
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

// Presence means true for HTML boolean attributes, regardless of their text value.
const booleanAttributes = new Set([
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
  protected createDomElement(element: ReactElement): HTMLElement | undefined {
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
      key = Object.entries(props)
        .map(([k, v]) => {
          if (typeof v === 'string') {
            return `[${k}]`;
          }

          return false;
        })
        .filter(Boolean)
        .join('');
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
   */
  protected cloneElement(element: Pick<ReactElement, 'type' | 'props'>): {
    element: ReactElement;
    elementProps: Record<string, any>;
  } {
    const { type } = element;
    const props = { ...(element?.props ?? {}) } as Record<string, any>;

    // remove system attributes
    Object.values(this.reservedAttributes).forEach((attrName) => {
      if (props[attrName]) {
        delete props[attrName];
      }
    });

    // fix multiple nodes for title
    if (type === 'title' && Array.isArray(props.children)) {
      props.children = props.children.join('');
    }

    return {
      element: React.createElement(type, props),
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
   */
  protected pushElements(
    elements: ReactNode,
    containerId: string,
    isReplace = true,
    status = TagStatus.init,
  ): void {
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

      this.pushElement(
        { type: child.type, props: child.props as Record<string, any> },
        index,
        containerId,
        isReplace,
        status,
      );
    });

    this.tags.containers.add(containerId);
  }

  /**
   * Register a React element or a snapshot of a live DOM element.
   */
  protected pushElement(
    child: { type: string; props: Record<string, any> },
    index: number,
    containerId: string,
    isReplace: boolean,
    status: TagStatus,
    domElement?: HTMLElement,
  ): void {
    const { type } = child;
    const { element, elementProps } = this.cloneElement(child);
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
          return;
        }

        this.tags[type].set(containerId, {
          props: Manager.cleanupElementProps(elementProps),
          order:
            containerId === Manager.rootContainerId
              ? 1
              : this.getElementOrder(elementProps, type, key),
        });

        return;

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

      return;
    }

    // skip push already existed in head not unique tags
    if (this.isNotUniqueTag(key) && existedTag?.status === TagStatus.synced) {
      return;
    }

    this.tags.meta.set(key, {
      element: this.isServer ? element : undefined, // keep element only for server render
      domElement:
        /**
         * create DOM element only for client side
         * generate DOM element for root container inside @see this.analyzeClientHead
         */
        domElement ??
        (containerId === Manager.rootContainerId ? undefined : this.createDomElement(element)),
      order: this.getElementOrder(elementProps, type, key),
      containerId,
      status,
    });
  }

  /**
   * Get html or body props
   */
  public getRootTagProps(props: Manager['tags']['html']): Record<string, any> {
    if (!props.size) {
      return {};
    }

    return [...props.values()].reduce(
      (res, val) => ({
        ...res,
        ...val.props,
      }),
      {},
    );
  }

  /**
   * Apply props to dom element
   */
  protected applyDomElementAttributes(element: Element, props: Record<string, any> = {}): void {
    const tagName = element.tagName.toLowerCase();
    const reservedAttributes = Object.values(this.reservedAttributes);

    // apply attributes
    Object.entries(props).forEach(([name, value]) => {
      if (reservedAttributes.includes(name)) {
        return;
      }

      if (name === 'children') {
        element.innerHTML = value === false || value == null ? '' : (value as string);

        return;
      }

      const attribute = this.replaceAttribute(tagName, name);

      if (value === false || value == null) {
        element.removeAttribute(attribute);

        return;
      }

      if (name === 'style' && typeof value === 'object') {
        return Object.entries(value as Record<string, string>).forEach(
          ([styleName, styleValue]) => {
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            element['style'][styleName] = styleValue;
          },
        );
      }

      element.setAttribute(attribute, value === true ? '' : (value as string));
    });
  }

  /** Merge root style objects while retaining ownership of each contributed property. */
  private syncRootAttributes(
    element: HTMLElement,
    tags: IMetaManagerTags['html'],
    seed = false,
  ): void {
    const props = this.getRootTagProps(tags);
    const attributes = new Map(
      Object.entries(props)
        .filter(([name]) => !Object.values(this.reservedAttributes).includes(name))
        .map(([name, value]) => [
          this.replaceAttribute(element.tagName.toLowerCase(), name),
          value === false || value == null ? null : value === true ? '' : String(value),
        ]),
    );
    const style = [...tags.values()].reduce<Record<string, unknown>>(
      (result, { props: tagProps }) => {
        if (!('style' in tagProps)) {
          return result;
        }

        return tagProps.style && typeof tagProps.style === 'object'
          ? { ...result, ...(tagProps.style as Record<string, unknown>) }
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
        meta.delete(key);

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
   */
  public pushTags(elements: ReactNode, containerId: string, isReplace = true): void {
    const isAdded = this.tags.containers.has(containerId);

    this.pushElements(
      elements,
      containerId,
      isReplace,
      isAdded ? TagStatus.synced : TagStatus.init,
    );

    EventManager.publish(Events.PUSH_TAGS, { elements, containerId });

    // skip sync already synced tags
    if (this.isServer || isAdded) {
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
    if (this.isServer) {
      return;
    }

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
