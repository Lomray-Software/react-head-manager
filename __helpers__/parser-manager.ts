import htmlParser from 'html-react-parser';
import Manager from '../src/manager';
import TagStatus from '../src/tag-status';

/**
 * Frozen parser-based client analysis from origin/prod at 62948d6 (2.1.2).
 * Its index-based DOM attachment is intentionally retained; oracle tests compare
 * snapshot metadata separately from the corrected live element identities.
 */
class ParserManager extends Manager {
  public analyzeClientHead(): void {
    if (this.isServer) {
      return;
    }

    // parse default attributes for root tags
    for (const tagName of ['html', 'body']) {
      // @ts-ignore
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

export default ParserManager;
