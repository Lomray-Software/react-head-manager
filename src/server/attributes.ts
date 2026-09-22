import { booleanAttributes } from '../manager';
import parseInlineStyle from './inline-style';

/**
 * React props whose HTML attribute is the lowercase spelling (the HTML part of React's table).
 */
const camelCaseProps =
  'acceptCharset accessKey allowFullScreen autoCapitalize autoComplete autoCorrect autoFocus ' +
  'autoPlay autoSave cellPadding cellSpacing charSet classID className colSpan contentEditable ' +
  'contextMenu controlsList crossOrigin dangerouslySetInnerHTML dateTime defaultChecked ' +
  'defaultValue disablePictureInPicture disableRemotePlayback encType enterKeyHint formAction ' +
  'formEncType formMethod formNoValidate formTarget frameBorder hrefLang htmlFor httpEquiv ' +
  'innerHTML inputMode itemID itemProp itemRef itemScope itemType keyParams keyType marginHeight ' +
  'marginWidth maxLength mediaGroup minLength noModule noValidate playsInline radioGroup readOnly ' +
  'referrerPolicy rowSpan spellCheck srcDoc srcLang srcSet tabIndex useMap xlinkActuate ' +
  'xlinkArcrole xlinkHref xlinkRole xlinkShow xlinkTitle xlinkType xmlBase xmlLang xmlnsXlink xmlSpace';

/**
 * Attributes React keeps as they are; listed so that uppercase spellings are normalised too.
 */
const plainProps =
  'about accept action alt as async capture challenge checked children cite cols content ' +
  'controls coords data datatype default defer dir disabled download draggable form headers ' +
  'height hidden high href icon id inlist integrity is kind label lang list loop low manifest ' +
  'max media method min multiple muted name nonce open optimum pattern placeholder poster prefix ' +
  'preload profile property rel required resource reversed role rows sandbox scope scoped ' +
  'scrolling seamless selected shape size sizes span src start step style summary target title ' +
  'type typeof value vocab width wmode wrap xmlns';

/**
 * Lowercase attribute name to React prop name.
 */
const propNames = new Map<string, string>([
  ...camelCaseProps.split(' ').map((name): [string, string] => [name.toLowerCase(), name]),
  ...plainProps.split(' ').map((name): [string, string] => [name, name]),
  ['accept-charset', 'acceptCharset'],
  ['class', 'className'],
  ['for', 'htmlFor'],
  ['http-equiv', 'httpEquiv'],
  ['xlink:actuate', 'xlinkActuate'],
  ['xlink:arcrole', 'xlinkArcrole'],
  ['xlink:href', 'xlinkHref'],
  ['xlink:role', 'xlinkRole'],
  ['xlink:show', 'xlinkShow'],
  ['xlink:title', 'xlinkTitle'],
  ['xlink:type', 'xlinkType'],
  ['xml:base', 'xmlBase'],
  ['xml:lang', 'xmlLang'],
  ['xml:space', 'xmlSpace'],
  ['xmlns:xlink', 'xmlnsXlink'],
]);

/**
 * An empty value means true for these, any other value is kept.
 */
const overloadedBooleanProps = new Set(['capture', 'download']);

/**
 * Form controls get the uncontrolled variant of these props.
 */
const uncontrolledProps = new Set(['checked', 'value']);
const uncontrolledElements = new Set(['input', 'select', 'textarea']);
const valueOnlyInputs = new Set(['reset', 'submit']);

/**
 * Hyphenated names that are SVG or MathML elements, not custom elements.
 */
const reservedElements = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);

/**
 * Custom elements keep their attributes untouched, only the style is parsed.
 * Script and style are never treated as custom, whatever their attributes say.
 */
const isCustomElement = (tagName: string, attributes: Record<string, string>): boolean => {
  if (tagName === 'script' || tagName === 'style') {
    return false;
  }

  return tagName.includes('-') ? !reservedElements.has(tagName) : typeof attributes.is === 'string';
};

/**
 * Replace a `style` attribute by the React style object; other spellings stay strings.
 */
const withStyle = (props: Record<string, any>, style: string | undefined): Record<string, any> => {
  if (typeof style === 'string') {
    props.style = parseInlineStyle(style);
  }

  return props;
};

/**
 * Convert parsed HTML attributes into React props, as html-react-parser does.
 */
const attributesToProps = (
  attributes: Record<string, string>,
  tagName: string,
): Record<string, any> => {
  if (isCustomElement(tagName, attributes)) {
    return withStyle({ ...attributes }, attributes.style);
  }

  const props: Record<string, any> = {};
  const isValueOnly = valueOnlyInputs.has(attributes.type);

  for (const [name, value] of Object.entries(attributes)) {
    const lowerName = name.toLowerCase();
    let propName = propNames.get(lowerName);

    if (propName === undefined) {
      props[name] = value;

      continue;
    }

    const isBoolean = booleanAttributes.has(lowerName);

    if (uncontrolledProps.has(propName) && uncontrolledElements.has(tagName) && !isValueOnly) {
      propName = propNames.get(`default${lowerName}`)!;
    }

    props[propName] =
      isBoolean || (overloadedBooleanProps.has(propName) && value === '') ? true : value;
  }

  return withStyle(props, attributes.style);
};

export default attributesToProps;
