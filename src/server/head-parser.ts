import type { ReactNode } from 'react';
import { createElement } from 'react';
import attributesToProps from './attributes';
import decodeEntities from './entities';

export interface IParsedHead {
  elements: ReactNode[];
  sources: (string | undefined)[];
}

interface INode {
  start: number;
  end: number;
}

interface ITextNode extends INode {
  type: 'text';
  data: string;
}

interface ICommentNode extends INode {
  type: 'comment';
  data: string;
}

interface ITagNode extends INode {
  type: 'tag';
  name: string;
  attributes: Record<string, string>;
  children: TNode[];
}

type TNode = ITextNode | ICommentNode | ITagNode;

interface ITagEnd {
  gt: number;
  isSelfClosing: boolean;
}

enum AttributeState {
  beforeName,
  inName,
  afterName,
  beforeValue,
  unquotedValue,
  selfClosing,
}

/**
 * HTML tokenizer rules: void elements, raw text elements and the tags an opening tag closes.
 */
const voidElements = new Set([
  'area',
  'base',
  'basefont',
  'br',
  'col',
  'command',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'isindex',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const rawTextEnds = new Map(
  ['script', 'style', 'title', 'textarea'].map((name) => [
    name,
    new RegExp(String.raw`</${name}(?=[\t\n\f\r >])`, 'gi'),
  ]),
);
const decodedRawText = new Set(['title']);

/**
 * Inside svg and math `/>` closes the element; their integration points switch back to HTML rules.
 */
const foreignElements = new Set(['math', 'svg']);
const integrationElements = new Set([
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'annotation-xml',
  'foreignobject',
  'desc',
  'title',
]);
const formTags = 'input option optgroup select button datalist textarea';
const impliedClose = new Map(
  Object.entries({
    tr: 'tr th td',
    th: 'th',
    td: 'thead th td',
    body: 'head link script',
    li: 'li',
    option: 'option',
    optgroup: 'optgroup option',
    dd: 'dd dt',
    dt: 'dd dt',
    rt: 'rt rp',
    rp: 'rt rp',
    tbody: 'thead tbody',
    tfoot: 'thead tbody',
    select: formTags,
    input: formTags,
    output: formTags,
    button: formTags,
    datalist: formTags,
    textarea: formTags,
    ...Object.fromEntries(
      (
        'p h1 h2 h3 h4 h5 h6 address article aside blockquote details div dl fieldset ' +
        'figcaption figure footer form header hr main nav ol pre section table ul'
      )
        .split(' ')
        .map((name) => [name, 'p']),
    ),
  }).map(([name, closes]) => [name, new Set(closes.split(' '))]),
);

/**
 * React drops whitespace-only text inside these, as their DOM cannot hold text nodes.
 */
const noTextChildren = new Set([
  'tr',
  'tbody',
  'thead',
  'tfoot',
  'colgroup',
  'table',
  'head',
  'html',
  'frameset',
]);

const isWhitespace = (char: string): boolean =>
  char === ' ' || char === '\n' || char === '\t' || char === '\f' || char === '\r';
const isTagSectionEnd = (char: string): boolean =>
  char === '/' || char === '>' || isWhitespace(char);
const isAlpha = (char: string): boolean => /[a-z]/i.test(char);

/**
 * Tokenizer and tree builder for a head fragment or a root tag.
 * It follows the html tokenizer of the previous parser: node boundaries are the
 * original markup positions, so untouched tags can be served verbatim.
 */
class MarkupParser {
  /**
   * Markup being read
   */
  private readonly input: string;

  /**
   * Read position
   */
  private index = 0;

  /**
   * Top-level nodes
   */
  private readonly roots: TNode[] = [];

  /**
   * Open elements, innermost last
   */
  private readonly stack: ITagNode[] = [];

  /**
   * Adjacent text merges into the previous node when that was text
   */
  private lastNode: TNode | null = null;

  /**
   * Whether the innermost namespace is foreign content, one entry per svg, math or integration element
   */
  private readonly foreignContext: boolean[] = [false];

  /**
   * @constructor
   */
  constructor(input: string) {
    this.input = input;
  }

  /**
   * Build the node tree
   */
  public parse(): TNode[] {
    const { input } = this;

    while (this.index < input.length) {
      const lt = input.indexOf('<', this.index);

      if (lt === -1) {
        this.addText(this.index, input.length);

        break;
      }

      if (lt > this.index) {
        this.addText(this.index, lt);
      }

      this.index = lt;
      this.parseMarkup();
    }

    for (const node of this.stack) {
      node.end = input.length - 1;
    }

    return this.roots;
  }

  /**
   * Dispatch on the character after `<`
   */
  private parseMarkup(): void {
    const next = this.input[this.index + 1] ?? '';

    if (next === '!') {
      this.parseDeclaration();
    } else if (next === '?') {
      this.parseInstruction();
    } else if (next === '/') {
      this.parseClosingTag();
    } else if (isAlpha(next)) {
      this.parseOpenTag();
    } else {
      // A lone `<` is text.
      this.addText(this.index, this.index + 1);
    }
  }

  /**
   * Comments, CDATA sections (also comments in HTML) and declarations such as a doctype.
   */
  private parseDeclaration(): void {
    const { input } = this;
    const start = this.index;

    if (input.startsWith('--', start + 2)) {
      // `<!-->` and `<!--->` are complete comments.
      let dashes = start + 4;

      while (input[dashes] === '-') {
        dashes += 1;
      }

      const closing = input[dashes] === '>' ? dashes - 2 : input.indexOf('-->', dashes);

      this.addUnclosableComment(start, start + 4, closing);

      return;
    }

    if (input.startsWith('[CDATA[', start + 2)) {
      this.addUnclosableComment(start, start + 9, input.indexOf(']]>', start + 9), ']]');

      return;
    }

    this.parseInstruction();
  }

  /**
   * A comment or CDATA section that may run to the end of the input; an empty one there is dropped.
   */
  private addUnclosableComment(
    start: number,
    contentStart: number,
    closing: number,
    suffix = '',
  ): void {
    const { input } = this;

    if (closing !== -1) {
      this.addComment(start, closing + 2, input.slice(contentStart, closing) + suffix);
    } else if (contentStart < input.length) {
      this.addComment(start, input.length - 1, input.slice(contentStart) + suffix);
    } else {
      this.index = input.length;
    }
  }

  /**
   * `<!…>` and `<?…>`: kept as comments, their markup stays with the following tag.
   * Unterminated ones become text, as the html tokenizer does at the end of input.
   */
  private parseInstruction(): void {
    const start = this.index;
    const gt = this.input.indexOf('>', start + 2);

    if (gt === -1) {
      this.addText(start + 2, this.input.length, false);

      return;
    }

    this.addComment(start, gt, this.input.slice(start + 1, gt));
  }

  /**
   * `</name …>` closes the innermost open element with that name; `</>` is text,
   * `</3>` is a bogus comment, an unmatched `</br>` or `</p>` creates the element.
   */
  private parseClosingTag(): void {
    const { input } = this;
    const start = this.index;
    let position = start + 2;

    while (isWhitespace(input[position] ?? '')) {
      position += 1;
    }

    const char = input[position] ?? '';

    if (char === '>' || position >= input.length) {
      this.addText(start, position + 1);

      return;
    }

    if (!isAlpha(char)) {
      const gt = input.indexOf('>', position);

      if (gt === -1) {
        this.addText(position, input.length, false);
      } else {
        this.addComment(start, gt, input.slice(position, gt));
      }

      return;
    }

    let nameEnd = position;

    while (nameEnd < input.length && !isWhitespace(input[nameEnd]) && input[nameEnd] !== '>') {
      nameEnd += 1;
    }

    const gt = input[nameEnd] === '>' ? nameEnd : input.indexOf('>', nameEnd);

    if (gt === -1) {
      this.index = input.length;

      return;
    }

    this.closeTag(input.slice(position, nameEnd).toLowerCase(), start, gt);
  }

  /**
   * `<name attributes>` with optional raw text content; unterminated tags are dropped.
   */
  private parseOpenTag(): void {
    const { input } = this;
    const start = this.index;
    let nameEnd = start + 1;

    while (nameEnd < input.length && !isTagSectionEnd(input[nameEnd])) {
      nameEnd += 1;
    }

    const attributes: Record<string, string> = {};
    const end = this.parseAttributes(nameEnd, attributes);

    if (!end) {
      this.index = input.length;

      return;
    }

    const name = input.slice(start + 1, nameEnd).toLowerCase();

    this.index = end.gt + 1;
    this.openTag(name, attributes, start, end.gt, nameEnd);

    if (!end.isSelfClosing) {
      if (rawTextEnds.has(name)) {
        this.parseRawText(name);
      }

      return;
    }

    // Only foreign content honours `/>`: in HTML the element stays open, but it is never raw text.
    if (this.foreignContext[this.foreignContext.length - 1] && !voidElements.has(name)) {
      this.stack.pop();
    }
  }

  /**
   * Attribute state machine of the html tokenizer. The first character of a name is never
   * inspected, quoted values may contain `>`, unquoted ones end at whitespace or `>`.
   */
  private parseAttributes(from: number, attributes: Record<string, string>): ITagEnd | undefined {
    const { input } = this;
    let state = AttributeState.beforeName;
    let name = '';
    let sectionStart = from;
    let position = from;

    const setAttribute = (value: string): void => {
      if (!Object.prototype.hasOwnProperty.call(attributes, name)) {
        attributes[name] = value;
      }
    };

    while (position < input.length) {
      const char = input[position];

      switch (state) {
        case AttributeState.beforeName:
          if (char === '>') {
            return { gt: position, isSelfClosing: false };
          }

          if (char === '/') {
            state = AttributeState.selfClosing;
          } else if (!isWhitespace(char)) {
            state = AttributeState.inName;
            sectionStart = position;
          }

          break;

        case AttributeState.selfClosing:
          if (char === '>') {
            return { gt: position, isSelfClosing: true };
          }

          if (!isWhitespace(char)) {
            state = AttributeState.beforeName;

            continue;
          }

          break;

        case AttributeState.inName:
          if (char === '=' || isTagSectionEnd(char)) {
            name = input.slice(sectionStart, position);
            state = AttributeState.afterName;

            continue;
          }

          break;

        case AttributeState.afterName:
          if (char === '=') {
            state = AttributeState.beforeValue;
          } else if (char === '/' || char === '>') {
            setAttribute('');
            state = AttributeState.beforeName;

            continue;
          } else if (!isWhitespace(char)) {
            setAttribute('');
            state = AttributeState.inName;
            sectionStart = position;
          }

          break;

        case AttributeState.beforeValue:
          if (char === '"' || char === "'") {
            const closing = input.indexOf(char, position + 1);

            if (closing === -1) {
              return undefined;
            }

            setAttribute(decodeEntities(input.slice(position + 1, closing), true));
            state = AttributeState.beforeName;
            position = closing;
          } else if (!isWhitespace(char)) {
            state = AttributeState.unquotedValue;
            sectionStart = position;

            continue;
          }

          break;

        case AttributeState.unquotedValue:
          if (char === '>' || isWhitespace(char)) {
            setAttribute(decodeEntities(input.slice(sectionStart, position), true));
            state = AttributeState.beforeName;

            continue;
          }

          break;
      }

      position += 1;
    }

    return undefined;
  }

  /**
   * Content of script, style, title and textarea up to the matching closing tag:
   * only the title decodes entities. Without a closing tag it runs to the end.
   */
  private parseRawText(name: string): void {
    const { input } = this;
    const regexp = rawTextEnds.get(name)!;

    regexp.lastIndex = this.index;

    const match = regexp.exec(input);
    const contentEnd = match ? match.index : input.length;

    if (contentEnd > this.index) {
      this.addText(this.index, contentEnd, decodedRawText.has(name));
    }

    if (!match) {
      this.index = input.length;

      return;
    }

    const afterName = match.index + match[0].length;
    const gt = input[afterName] === '>' ? afterName : input.indexOf('>', afterName);

    this.closeTag(name, match.index, gt === -1 ? input.length - 1 : gt);
  }

  /**
   * Open an element: close what it implies, register it and keep non-void ones open.
   */
  private openTag(
    name: string,
    attributes: Record<string, string>,
    start: number,
    end: number,
    nameEnd: number,
  ): void {
    const implied = impliedClose.get(name);

    while (implied && this.stack.length && implied.has(this.stack[this.stack.length - 1].name)) {
      this.stack.pop()!.end = nameEnd;
    }

    const node: ITagNode = { type: 'tag', name, attributes, children: [], start, end };

    this.append(node);

    if (voidElements.has(name)) {
      return;
    }

    this.stack.push(node);

    if (foreignElements.has(name)) {
      this.foreignContext.push(true);
    } else if (integrationElements.has(name)) {
      this.foreignContext.push(false);
    }
  }

  /**
   * Close the innermost element with that name together with everything opened inside it.
   */
  private closeTag(name: string, start: number, end: number): void {
    this.index = end + 1;

    if (foreignElements.has(name) || integrationElements.has(name)) {
      this.foreignContext.pop();
    }

    if (voidElements.has(name)) {
      if (name === 'br') {
        this.append({ type: 'tag', name, attributes: {}, children: [], start, end });
      }

      return;
    }

    let position = this.stack.length - 1;

    while (position >= 0 && this.stack[position].name !== name) {
      position -= 1;
    }

    if (position === -1) {
      if (name === 'p') {
        this.append({ type: 'tag', name, attributes: {}, children: [], start, end });
      }

      return;
    }

    for (const node of this.stack.splice(position)) {
      node.end = end;
    }

    this.lastNode = null;
  }

  /**
   * Attach a node to the innermost open element or the root list.
   */
  private append(node: TNode): void {
    const parent = this.stack[this.stack.length - 1];

    (parent ? parent.children : this.roots).push(node);
    this.lastNode = node.type === 'tag' ? null : node;
  }

  /**
   * Text node, merged into the previous text node when they are adjacent.
   */
  private addText(start: number, end: number, isDecoded = true): void {
    const raw = this.input.slice(start, end);
    const data = isDecoded ? decodeEntities(raw) : raw;

    this.index = end;

    if (!data) {
      return;
    }

    if (this.lastNode?.type === 'text') {
      this.lastNode.data += data;
      this.lastNode.end = end - 1;
    } else {
      this.append({ type: 'text', data, start, end: end - 1 });
    }
  }

  /**
   * Comment-like node: it only matters as the first child of a self-closed script or style.
   */
  private addComment(start: number, end: number, data: string): void {
    this.index = end + 1;
    this.append({ type: 'comment', data, start, end });
  }
}

/**
 * Text of a data node, `undefined` for a tag: what `dangerouslySetInnerHTML` gets for the
 * first child of a script or style.
 */
const dataOf = (node: TNode): string | undefined => (node.type === 'tag' ? undefined : node.data);

/**
 * Build React elements the way html-react-parser does: siblings get index keys, comments are
 * skipped, script and style children become `dangerouslySetInnerHTML`.
 */
const toReact = (nodes: TNode[], parentName?: string): ReactNode => {
  const elements: ReactNode[] = [];

  nodes.forEach((node, index) => {
    if (node.type === 'comment') {
      return;
    }

    if (node.type === 'text') {
      if (parentName === undefined || !noTextChildren.has(parentName) || node.data.trim()) {
        elements.push(node.data);
      }

      return;
    }

    const { name, attributes, children } = node;
    const props = attributesToProps(attributes, name);
    const [firstChild] = children;
    let reactChildren: ReactNode;

    if (name === 'script' || name === 'style') {
      if (firstChild) {
        props.dangerouslySetInnerHTML = { __html: dataOf(firstChild) };
      }
    } else if (name === 'textarea' && firstChild) {
      props.defaultValue = dataOf(firstChild);
    } else if (children.length) {
      reactChildren = toReact(children, name);
    }

    if (nodes.length > 1) {
      props.key = index;
    }

    elements.push(createElement(name, props, reactChildren));
  });

  return elements.length === 1 ? elements[0] : elements;
};

/**
 * Parse the static head, keeping the original markup of every tag.
 * React drops what it does not accept as a prop (inline handlers, comments, unknown casing),
 * so untouched tags are served from their source instead of being rendered again.
 * Text keeps its position: child indices must match the client's head analysis.
 */
export const parseHead = (html: string): IParsedHead => {
  const elements: ReactNode[] = [];
  const sources: (string | undefined)[] = [];
  let comments = '';

  for (const node of new MarkupParser(html).parse()) {
    if (node.type === 'comment') {
      // Comments have no position of their own after sorting: keep them with the next tag.
      comments += html.slice(node.start, node.end + 1);

      continue;
    }

    if (node.type === 'text') {
      elements.push(node.data);
      sources.push(undefined);

      continue;
    }

    const markup = html.slice(node.start, node.end + 1);
    // Only a lowercase source tag can be served verbatim; others are rendered by React.
    const isVerbatim = markup.startsWith(`<${node.name}`);

    elements.push(toReact([node]));
    sources.push(isVerbatim ? comments + markup : undefined);

    if (isVerbatim) {
      comments = '';
    }
  }

  // Comments after the last tag stay at the end of the head.
  if (comments) {
    elements.push(createElement('noscript'));
    sources.push(comments);
  }

  return { elements, sources };
};

/**
 * Parse markup without a DOM while preserving React attribute conversion.
 */
export const parseRootTag = (html: string): ReactNode => toReact(new MarkupParser(html).parse());
