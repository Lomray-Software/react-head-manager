/**
 * Grammar of an inline style attribute (CSS 2.1 declarations), as html-react-parser reads it.
 */
const COMMENT = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g;
const LEADING_WHITESPACE = /^\s*/;
const PROPERTY = /^(\*?[-#/*\\\w]+(\[[\da-z_-]+\])?)\s*/;
const COLON = /^:\s*/;
const SEPARATOR = /^[;\s]*/;
const CUSTOM_PROPERTY = /^--[\da-z-]+$/i;
const MS_PREFIX = /^-(ms)-/;
const HYPHEN_LETTER = /-([a-z])/g;

const isLineTerminator = (char: string): boolean =>
  char === '\n' || char === '\r' || char === ' ' || char === ' ';

/**
 * End of a quoted string that starts at `start`, as the original grammar
 * `'(?:\\'|.)*?'` finds it: the first unescaped quote on the same line, or, when there is
 * none, the last escaped quote on that line. -1 when the string is unterminated.
 */
const findQuoteEnd = (value: string, start: number): number => {
  const quote = value[start];
  let lastEscaped = -1;

  for (let position = start + 1; position < value.length; position += 1) {
    const char = value[position];

    if (isLineTerminator(char)) {
      break;
    }

    if (char === quote) {
      return position;
    }

    if (char === '\\' && value[position + 1] === quote) {
      position += 1;
      lastEscaped = position;
    }
  }

  return lastEscaped;
};

/**
 * Length of a declaration value: everything up to the first `;` or `}`, where quoted strings
 * and parentheses are read as a whole. A quote or a parenthesis without a closing counterpart
 * is an ordinary character.
 */
const matchValueLength = (value: string): number => {
  let position = 0;

  while (position < value.length) {
    const char = value[position];

    if (char === ';' || char === '}') {
      break;
    }

    if (char === "'" || char === '"') {
      const end = findQuoteEnd(value, position);

      position = end === -1 ? position + 1 : end + 1;
    } else if (char === '(') {
      const end = value.indexOf(')', position + 1);

      position = end === -1 ? position + 1 : end + 1;
    } else {
      position += 1;
    }
  }

  return position;
};

/**
 * React style key: custom properties and single words stay as they are,
 * `-webkit-` becomes `Webkit`, `-ms-` stays lowercase `ms`.
 */
const toStyleKey = (property: string): string => {
  if (!property.includes('-') || CUSTOM_PROPERTY.test(property)) {
    return property;
  }

  return property
    .toLowerCase()
    .replace(MS_PREFIX, 'ms-')
    .replace(HYPHEN_LETTER, (_, letter: string) => letter.toUpperCase());
};

/**
 * Read declarations left to right; parsing stops at the first token that is not a property
 * and a property without a colon or an unterminated comment invalidates the whole attribute.
 */
const parseDeclarations = (style: string): Record<string, string> => {
  const result: Record<string, string> = {};
  let rest = style.replace(LEADING_WHITESPACE, '');

  const match = (regexp: RegExp): string | undefined => {
    const matched = regexp.exec(rest);

    if (!matched) {
      return undefined;
    }

    rest = rest.slice(matched[0].length);

    return matched[0];
  };

  const skipComment = (): boolean => {
    if (!rest.startsWith('/*')) {
      return false;
    }

    const end = rest.indexOf('*/', 2);

    if (end === -1) {
      throw new Error('End of comment missing');
    }

    rest = rest.slice(end + 2).replace(LEADING_WHITESPACE, '');

    return true;
  };

  const skipComments = (): void => {
    let isSkipped = skipComment();

    while (isSkipped) {
      isSkipped = skipComment();
    }
  };

  skipComments();

  for (let property = match(PROPERTY); property !== undefined; property = match(PROPERTY)) {
    skipComment();

    if (!match(COLON)) {
      throw new Error("property missing ':'");
    }

    const value = rest.slice(0, matchValueLength(rest));

    rest = rest.slice(value.length).replace(LEADING_WHITESPACE, '');
    match(SEPARATOR);

    const name = property.replace(COMMENT, '').trim();
    const text = value.replace(COMMENT, '').trim();

    if (name && text) {
      result[toStyleKey(name)] = text;
    }

    skipComments();
  }

  return result;
};

/**
 * Convert an inline style attribute into the React style object html-react-parser produces.
 * Invalid CSS yields an empty object, as it did there.
 */
const parseInlineStyle = (style: string): Record<string, string> => {
  if (!style.trim()) {
    return {};
  }

  try {
    return parseDeclarations(style);
  } catch {
    return {};
  }
};

export default parseInlineStyle;
