/**
 * Named references that HTML decodes even without the trailing semicolon.
 */
const legacyEntities = new Map<string, string>(
  Object.entries({
    AElig: 'Æ',
    AMP: '&',
    Aacute: 'Á',
    Acirc: 'Â',
    Agrave: 'À',
    Aring: 'Å',
    Atilde: 'Ã',
    Auml: 'Ä',
    COPY: '©',
    Ccedil: 'Ç',
    ETH: 'Ð',
    Eacute: 'É',
    Ecirc: 'Ê',
    Egrave: 'È',
    Euml: 'Ë',
    GT: '>',
    Iacute: 'Í',
    Icirc: 'Î',
    Igrave: 'Ì',
    Iuml: 'Ï',
    LT: '<',
    Ntilde: 'Ñ',
    Oacute: 'Ó',
    Ocirc: 'Ô',
    Ograve: 'Ò',
    Oslash: 'Ø',
    Otilde: 'Õ',
    Ouml: 'Ö',
    QUOT: '"',
    REG: '®',
    THORN: 'Þ',
    Uacute: 'Ú',
    Ucirc: 'Û',
    Ugrave: 'Ù',
    Uuml: 'Ü',
    Yacute: 'Ý',
    aacute: 'á',
    acirc: 'â',
    acute: '´',
    aelig: 'æ',
    agrave: 'à',
    amp: '&',
    aring: 'å',
    atilde: 'ã',
    auml: 'ä',
    brvbar: '¦',
    ccedil: 'ç',
    cedil: '¸',
    cent: '¢',
    copy: '©',
    curren: '¤',
    deg: '°',
    divide: '÷',
    eacute: 'é',
    ecirc: 'ê',
    egrave: 'è',
    eth: 'ð',
    euml: 'ë',
    frac12: '½',
    frac14: '¼',
    frac34: '¾',
    gt: '>',
    iacute: 'í',
    icirc: 'î',
    iexcl: '¡',
    igrave: 'ì',
    iquest: '¿',
    iuml: 'ï',
    laquo: '«',
    lt: '<',
    macr: '¯',
    micro: 'µ',
    middot: '·',
    nbsp: ' ',
    not: '¬',
    ntilde: 'ñ',
    oacute: 'ó',
    ocirc: 'ô',
    ograve: 'ò',
    ordf: 'ª',
    ordm: 'º',
    oslash: 'ø',
    otilde: 'õ',
    ouml: 'ö',
    para: '¶',
    plusmn: '±',
    pound: '£',
    quot: '"',
    raquo: '»',
    reg: '®',
    sect: '§',
    shy: '­',
    sup1: '¹',
    sup2: '²',
    sup3: '³',
    szlig: 'ß',
    thorn: 'þ',
    times: '×',
    uacute: 'ú',
    ucirc: 'û',
    ugrave: 'ù',
    uml: '¨',
    uuml: 'ü',
    yacute: 'ý',
    yen: '¥',
    yuml: 'ÿ',
  }),
);

/**
 * Common references that require the semicolon. Rarer names are left as written.
 */
const namedEntities = new Map<string, string>([
  ...legacyEntities,
  ...Object.entries({
    apos: "'",
    hellip: '…',
    mdash: '—',
    ndash: '–',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    sbquo: '‚',
    bdquo: '„',
    bull: '•',
    trade: '™',
    euro: '€',
    larr: '←',
    rarr: '→',
    uarr: '↑',
    darr: '↓',
    harr: '↔',
    dagger: '†',
    Dagger: '‡',
    permil: '‰',
    lsaquo: '‹',
    rsaquo: '›',
    oelig: 'œ',
    OElig: 'Œ',
    scaron: 'š',
    Scaron: 'Š',
    Yuml: 'Ÿ',
    fnof: 'ƒ',
    circ: 'ˆ',
    tilde: '˜',
    ensp: ' ',
    emsp: ' ',
    thinsp: ' ',
    zwnj: '‌',
    zwj: '‍',
    lrm: '‎',
    rlm: '‏',
    minus: '−',
    infin: '∞',
    ne: '≠',
    le: '≤',
    ge: '≥',
    prime: '′',
    Prime: '″',
    hearts: '♥',
    spades: '♠',
    clubs: '♣',
    diams: '♦',
    loz: '◊',
  }),
]);

/**
 * Numeric references in the C1 range decode as windows-1252, NUL as the replacement character.
 */
const windows1252 = new Map<number, number>([
  [0x00, 0xfffd],
  [0x80, 0x20ac],
  [0x82, 0x201a],
  [0x83, 0x0192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02c6],
  [0x89, 0x2030],
  [0x8a, 0x0160],
  [0x8b, 0x2039],
  [0x8c, 0x0152],
  [0x8e, 0x017d],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02dc],
  [0x99, 0x2122],
  [0x9a, 0x0161],
  [0x9b, 0x203a],
  [0x9c, 0x0153],
  [0x9e, 0x017e],
  [0x9f, 0x0178],
]);

const MAX_LEGACY_LENGTH = 6;
const MAX_CODE_POINT = 0x10ffff;
const SEMICOLON = ';';
const NAME = /[\da-z]+/iy;
const DECIMAL = /\d+/y;
const HEX = /[\da-f]+/iy;

interface IEntityMatch {
  value: string;
  end: number;
}

/**
 * Surrogates and out-of-range values become the replacement character.
 */
const decodeCodePoint = (codePoint: number): string => {
  if ((codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > MAX_CODE_POINT) {
    return '�';
  }

  return String.fromCodePoint(windows1252.get(codePoint) ?? codePoint);
};

/**
 * Numeric reference: `start` points right after `&#`. The semicolon is optional.
 */
const matchNumeric = (input: string, start: number): IEntityMatch | undefined => {
  const isHex = input[start] === 'x' || input[start] === 'X';
  const digits = isHex ? HEX : DECIMAL;

  digits.lastIndex = isHex ? start + 1 : start;

  const match = digits.exec(input);

  if (!match) {
    return undefined;
  }

  const end = digits.lastIndex;

  return {
    value: decodeCodePoint(Number.parseInt(match[0], isHex ? 16 : 10)),
    end: input[end] === SEMICOLON ? end + 1 : end,
  };
};

/**
 * Named reference: `start` points right after `&`.
 * Without a semicolon only a legacy name is decoded, and inside attribute values
 * only when it is not followed by an alphanumeric or `=` (HTML tokenizer rule).
 */
const matchNamed = (
  input: string,
  start: number,
  isAttribute: boolean,
): IEntityMatch | undefined => {
  NAME.lastIndex = start;

  const run = NAME.exec(input)?.[0];

  if (!run) {
    return undefined;
  }

  const end = start + run.length;

  if (input[end] === SEMICOLON) {
    const value = namedEntities.get(run);

    // A name outside the table stays as written rather than being cut at a legacy prefix.
    return value === undefined ? undefined : { value, end: end + 1 };
  }

  for (let length = Math.min(run.length, MAX_LEGACY_LENGTH); length > 0; length -= 1) {
    const value = legacyEntities.get(run.slice(0, length));

    if (value === undefined) {
      continue;
    }

    if (isAttribute && (length < run.length || input[end] === '=')) {
      return undefined;
    }

    return { value, end: start + length };
  }

  return undefined;
};

/**
 * Decode character references the way the HTML tokenizer does for text and attribute values.
 */
const decodeEntities = (input: string, isAttribute = false): string => {
  let ampersand = input.indexOf('&');

  if (ampersand === -1) {
    return input;
  }

  let result = '';
  let position = 0;

  while (ampersand !== -1) {
    const match =
      input[ampersand + 1] === '#'
        ? matchNumeric(input, ampersand + 2)
        : matchNamed(input, ampersand + 1, isAttribute);

    if (match) {
      result += input.slice(position, ampersand) + match.value;
      position = match.end;
      ampersand = input.indexOf('&', position);
    } else {
      ampersand = input.indexOf('&', ampersand + 1);
    }
  }

  return result + input.slice(position);
};

export default decodeEntities;
