import htmlParser from 'html-react-parser';
import type { ReactElement, ReactNode } from 'react';
import React, { Children } from 'react';

enum TagStatus {
  init = 'init',
  synced = 'synced',
  drain = 'drain',
}

export interface IMetaManagerTags {
  html: Map<string, Record<string, any>>; // containerId => styles
  body: Map<string, Record<string, any>>; // containerId => styles
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
   * Get meta tags
   */
  public getTags(): IMetaManagerTags {
    const { meta, body, html, containers } = this.tags;
    const sortedMeta = new Map(
      [...meta.entries()].sort(([, tagA], [, tagB]) => tagA.order - tagB.order),
    );

    return {
      body,
      html,
      meta: sortedMeta,
      containers,
    };
  }

  /**
   * Replace react attribute to valid DOM attribute
   */
  protected replaceAttribute(tagName: string, attribute: string): string {
    if (tagName === 'meta' && attribute.toLowerCase() === 'httpequiv') {
      return 'http-equiv';
    }

    return attribute;
  }

  /**
   * Create DOM element from React element
   */
  protected createDomElement(element: ReactElement): HTMLElement | undefined {
    if (this.isServer) {
      return;
    }

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
    for (const uniqueAttr of ['id', 'name', 'href', 'src']) {
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
   * Push react elements to meta state
   */
  protected pushElements(
    elements: ReactNode,
    containerId: string,
    isReplace = true,
    status = TagStatus.init,
  ): void {
    Children.forEach(elements, (child, index) => {
      // skip unsupported elements
      if (!child || typeof child !== 'object' || !('type' in child) || !child.type) {
        return;
      }

      const { type, props } = child;
      const elementProps: Record<string, any> = props ?? {};

      let order = this.tagsDefinitions[type as string]?.order ?? 1000;
      let key = this.tagsDefinitions[type as string]?.key ?? (type as string);
      let element = child;

      switch (type) {
        case 'title':
          const { children } = elementProps;

          // fix multiple nodes
          element = Array.isArray(children)
            ? React.cloneElement(child, { children: children.join('') })
            : child;
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

          this.tags[type].set(containerId, Manager.cleanupElementProps(elementProps));

          return;

        case 'link':
        case 'script':
        case 'noscript':
        case 'style':
        default:
          key =
            this.buildKeyByProps(type as string, elementProps, true) ??
            this.getDefaultKey(type as string, containerId, index);
          break;
      }

      // skip replace existed meta tag (e.g. for push existed tags from parsed html, @see ServerManager)
      if (!isReplace && this.tags.meta.has(key)) {
        return;
      }

      // skip push already existed in head not unique tags
      if (this.isNotUniqueTag(key) && this.tags.meta.get(key)?.status === TagStatus.synced) {
        return;
      }

      // custom order
      if (this.tagsDefinitions[key]?.order) {
        order = this.tagsDefinitions[key]?.order;
      }

      this.tags.meta.set(key, {
        element: this.isServer ? element : undefined, // keep element only for server render
        domElement:
          /**
           * create DOM element only for client side
           * generate DOM element for root container inside @see this.analyzeClientHead
           */
          containerId === Manager.rootContainerId ? undefined : this.createDomElement(element),
        order,
        containerId,
        status,
      });
    });

    this.tags.containers.add(containerId);
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
        ...val,
      }),
      {},
    );
  }

  /**
   * Apply props to dom element
   */
  protected applyDomElementAttributes(element: Element, props: Record<string, any> = {}): void {
    const tagName = element.tagName.toLowerCase();

    // apply attributes
    Object.entries(props).forEach(([name, value]) => {
      if (name === 'children') {
        element.innerHTML = value;

        return;
      }

      if (name === 'style') {
        return Object.entries(value as Record<string, string>).forEach(
          ([styleName, styleValue]) => {
            element['style'][styleName] = styleValue;
          },
        );
      }

      element.setAttribute(this.replaceAttribute(tagName, name), value as string);
    });
  }

  /**
   * Synchronize local meta tags with head meta tags
   */
  protected syncMeta(containerId?: string): void {
    const { meta, html, body } = this.getTags();

    // apply html, body props
    for (const { name, value } of [
      { name: 'html', value: html },
      { name: 'body', value: body },
    ]) {
      const tagProps = this.getRootTagProps(value);
      const domElement = document.querySelector(name);
      const existAttributes = domElement?.getAttributeNames() ?? [];

      // remove drained props
      existAttributes.forEach((attrName) => {
        if (tagProps[attrName]) {
          return;
        }

        domElement!.removeAttribute(attrName);
      });

      if (!Object.keys(tagProps).length || !domElement) {
        continue;
      }

      this.applyDomElementAttributes(domElement, tagProps);
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
  }

  /**
   * Initial analyze client head meta tags
   */
  public analyzeClientHead(): void {
    if (this.isServer) {
      return;
    }

    // parse default attributes for root tags
    for (const tagName of ['html', 'body']) {
      const htmlTag = document.getElementsByTagName(tagName)?.[0].cloneNode(false)?.[
        'outerHTML'
      ] as string;

      this.pushElements(htmlParser(htmlTag), Manager.rootContainerId, false);
    }

    // parse default meta tags
    const head = document.getElementsByTagName('head')?.[0];
    const reactElements = htmlParser(head?.innerHTML ?? '');

    this.pushElements(reactElements, Manager.rootContainerId, false, TagStatus.synced);

    const meta = [...this.tags.meta.values()];

    // attach real dom node to virtual tags
    head.childNodes.forEach((node, i) => {
      const existedElem = meta[i];

      if (!existedElem) {
        return;
      }

      existedElem.domElement = node as HTMLElement;
    });
  }
}

export default Manager;
