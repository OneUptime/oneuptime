/*
 * A small XML reader for the answers of AWS's Query-protocol APIs (STS,
 * EC2, RDS, Auto Scaling): elements, their text and their children, nothing
 * else. One pass from start to end with indexOf — never a regular
 * expression over the body — so it reads in time linear in the answer, and
 * it is bounded: at most MAX_XML_DEPTH levels and MAX_XML_ELEMENTS
 * elements. Anything it cannot read for certain (a tag that does not
 * close, a closing tag that does not match, a DOCTYPE — AWS never sends
 * one, and entities it would declare are not expanded) makes the whole
 * answer unreadable (null), never partly read.
 *
 * Namespace prefixes are dropped from names (AWS answers carry none), and
 * attributes are skipped: no AWS answer the agent reads keeps data in them.
 */

export const MAX_XML_DEPTH: number = 64;
export const MAX_XML_ELEMENTS: number = 100_000;

// The digits of a numeric character reference.
const HEX_REFERENCE_PATTERN: RegExp = /^[0-9A-Fa-f]{1,6}$/;
const DECIMAL_REFERENCE_PATTERN: RegExp = /^[0-9]{1,7}$/;

export interface XmlElement {
  // The local name (without a namespace prefix).
  name: string;
  children: Array<XmlElement>;
  // The element's own text (its CDATA included), entity-decoded, untrimmed.
  text: string;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function isNameCharacter(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2d ||
    code === 0x5f ||
    code === 0x2e ||
    code === 0x3a ||
    code > 0x7f
  );
}

function localName(name: string): string {
  const colon: number = name.lastIndexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

/*
 * Text with &lt; &gt; &amp; &quot; &apos; and numeric references decoded;
 * null when it holds an "&" that is none of these.
 */
export function decodeXmlText(raw: string): string | null {
  let decoded: string = "";
  let index: number = 0;

  while (index < raw.length) {
    const amp: number = raw.indexOf("&", index);

    if (amp < 0) {
      decoded += raw.slice(index);
      break;
    }

    decoded += raw.slice(index, amp);

    const semicolon: number = raw.indexOf(";", amp);

    // Entity names are short: a far ";" belongs to something else.
    if (semicolon < 0 || semicolon - amp > 12) {
      return null;
    }

    const entity: string = raw.slice(amp + 1, semicolon);

    if (entity.startsWith("#")) {
      const hex: boolean = entity.startsWith("#x") || entity.startsWith("#X");
      const digits: string = entity.slice(hex ? 2 : 1);
      const valid: boolean =
        digits.length > 0 &&
        (hex ? HEX_REFERENCE_PATTERN : DECIMAL_REFERENCE_PATTERN).test(digits);
      const code: number = valid ? parseInt(digits, hex ? 16 : 10) : NaN;

      if (!valid || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return null;
      }

      decoded += String.fromCodePoint(code);
    } else if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, entity)) {
      decoded += NAMED_ENTITIES[entity] || "";
    } else {
      return null;
    }

    index = semicolon + 1;
  }

  return decoded;
}

/*
 * The index just past a tag's closing ">", skipping quoted attribute
 * values (which may hold ">"), or -1 when the tag never closes.
 */
function findTagEnd(text: string, from: number): number {
  let index: number = from;

  while (index < text.length) {
    const code: number = text.charCodeAt(index);

    if (code === 0x22 || code === 0x27) {
      const close: number = text.indexOf(code === 0x22 ? '"' : "'", index + 1);

      if (close < 0) {
        return -1;
      }

      index = close + 1;
      continue;
    }

    if (code === 0x3e) {
      return index + 1;
    }

    index++;
  }

  return -1;
}

// The document's root element, or null when the text is not XML this reader trusts.
export function parseXml(text: string): XmlElement | null {
  if (typeof text !== "string") {
    return null;
  }

  const stack: Array<XmlElement> = [];
  let root: XmlElement | null = null;
  let elements: number = 0;
  let index: number = 0;

  const appendText: (raw: string) => boolean = (raw: string): boolean => {
    const current: XmlElement | undefined = stack[stack.length - 1];

    if (!current) {
      // Only whitespace may stand outside the root element.
      return raw.trim() === "";
    }

    const decoded: string | null = decodeXmlText(raw);

    if (decoded === null) {
      return false;
    }

    current.text += decoded;
    return true;
  };

  while (index < text.length) {
    const open: number = text.indexOf("<", index);

    if (open < 0) {
      if (!appendText(text.slice(index))) {
        return null;
      }
      break;
    }

    if (open > index && !appendText(text.slice(index, open))) {
      return null;
    }

    if (text.startsWith("<?", open)) {
      const end: number = text.indexOf("?>", open + 2);

      if (end < 0) {
        return null;
      }

      index = end + 2;
      continue;
    }

    if (text.startsWith("<!--", open)) {
      const end: number = text.indexOf("-->", open + 4);

      if (end < 0) {
        return null;
      }

      index = end + 3;
      continue;
    }

    if (text.startsWith("<![CDATA[", open)) {
      const end: number = text.indexOf("]]>", open + 9);
      const current: XmlElement | undefined = stack[stack.length - 1];

      if (end < 0 || !current) {
        return null;
      }

      current.text += text.slice(open + 9, end);
      index = end + 3;
      continue;
    }

    // A DOCTYPE (and any other declaration) is refused.
    if (text.startsWith("<!", open)) {
      return null;
    }

    if (text.startsWith("</", open)) {
      const end: number = text.indexOf(">", open + 2);
      const current: XmlElement | undefined = stack.pop();

      if (
        end < 0 ||
        !current ||
        localName(text.slice(open + 2, end).trim()) !== current.name
      ) {
        return null;
      }

      index = end + 1;
      continue;
    }

    let nameEnd: number = open + 1;

    while (nameEnd < text.length && isNameCharacter(text.charCodeAt(nameEnd))) {
      nameEnd++;
    }

    const name: string = localName(text.slice(open + 1, nameEnd));
    const tagEnd: number = findTagEnd(text, nameEnd);

    if (!name || tagEnd < 0) {
      return null;
    }

    if (root !== null && stack.length === 0) {
      // A second root element.
      return null;
    }

    elements++;

    if (elements > MAX_XML_ELEMENTS || stack.length >= MAX_XML_DEPTH) {
      return null;
    }

    const element: XmlElement = { name, children: [], text: "" };
    const parent: XmlElement | undefined = stack[stack.length - 1];

    if (parent) {
      parent.children.push(element);
    } else {
      root = element;
    }

    // <name/> closes itself.
    if (text.charCodeAt(tagEnd - 2) !== 0x2f) {
      stack.push(element);
    }

    index = tagEnd;
  }

  return stack.length === 0 ? root : null;
}

// The first child with this name, or null.
export function xmlChild(
  element: XmlElement | null,
  name: string,
): XmlElement | null {
  if (!element) {
    return null;
  }

  for (const child of element.children) {
    if (child.name === name) {
      return child;
    }
  }

  return null;
}

// Every child with this name.
export function xmlChildren(
  element: XmlElement | null,
  name: string,
): Array<XmlElement> {
  return element
    ? element.children.filter((child: XmlElement): boolean => {
        return child.name === name;
      })
    : [];
}

// The element down this path of child names, or null.
export function xmlPath(
  element: XmlElement | null,
  ...names: Array<string>
): XmlElement | null {
  let current: XmlElement | null = element;

  for (const name of names) {
    current = xmlChild(current, name);
  }

  return current;
}

// The trimmed text down this path of child names, or null when it is not there.
export function xmlText(
  element: XmlElement | null,
  ...names: Array<string>
): string | null {
  const found: XmlElement | null = xmlPath(element, ...names);
  return found ? found.text.trim() : null;
}

/*
 * The first element with this name anywhere below (or at) element, depth
 * first — iterative, so a deep answer cannot exhaust the stack.
 */
export function xmlFind(
  element: XmlElement | null,
  name: string,
): XmlElement | null {
  const pending: Array<XmlElement> = element ? [element] : [];

  while (pending.length > 0) {
    const current: XmlElement | undefined = pending.pop();

    if (!current) {
      break;
    }

    if (current.name === name) {
      return current;
    }

    for (let child: number = current.children.length - 1; child >= 0; child--) {
      const next: XmlElement | undefined = current.children[child];

      if (next) {
        pending.push(next);
      }
    }
  }

  return null;
}
