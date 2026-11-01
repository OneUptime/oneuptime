/*
 * A SMALL XML READER FOR AWS'S QUERY PROTOCOL ANSWERS.
 *
 * EC2, RDS, Auto Scaling and Elastic Load Balancing answer in XML, and
 * Common has no XML parser (AwsApi's readXmlTag reads one tag's first
 * occurrence, enough for STS). This one reads the part of XML those
 * answers use into a tree of elements:
 *
 *   - elements, nested, with their text (the five named entities and
 *     numeric character references decoded) and CDATA sections (as they
 *     are);
 *   - attributes are skipped (AWS puts only xmlns there), and a namespace
 *     prefix is dropped from an element's name;
 *   - the XML declaration, processing instructions and comments are
 *     skipped; a DOCTYPE is refused, so no entity a document declares is
 *     ever expanded.
 *
 * It reads in one pass, finding each "<" and ">" with indexOf and never a
 * regular expression, so its time is linear in the answer whatever its
 * shape; and it refuses an answer longer, deeper or with more elements
 * than a describe call's ever is (AwsXmlError), rather than holding it.
 */

export interface AwsXmlElement {
  // The element's name without its namespace prefix: "DBInstance", "item".
  name: string;
  children: Array<AwsXmlElement>;
  // Its own text, entities decoded and trimmed ("" for an element of elements).
  text: string;
}

export const AWS_XML_MAX_LENGTH: number = 16 * 1024 * 1024;
export const AWS_XML_MAX_DEPTH: number = 64;
export const AWS_XML_MAX_ELEMENTS: number = 200000;
// The longest entity read ("&#x10FFFF;" is the longest one decoded).
const MAX_ENTITY_LENGTH: number = 12;

export class AwsXmlError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AwsXmlError";
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/*
 * Text with its entities decoded: the five named ones and numeric
 * references; anything else that starts with "&" stays as it is.
 */
export function decodeXmlEntities(text: string): string {
  let ampersand: number = text.indexOf("&");

  if (ampersand < 0) {
    return text;
  }

  const parts: Array<string> = [];
  let from: number = 0;

  while (ampersand >= 0) {
    // Looked for only as far as an entity can run: never a scan to the end per "&".
    const within: number = text
      .slice(ampersand + 1, ampersand + 1 + MAX_ENTITY_LENGTH)
      .indexOf(";");

    if (within < 0) {
      ampersand = text.indexOf("&", ampersand + 1);
      continue;
    }

    const semicolon: number = ampersand + 1 + within;
    const entity: string = text.slice(ampersand + 1, semicolon);
    const decoded: string | null = decodeEntity(entity);

    if (decoded !== null) {
      parts.push(text.slice(from, ampersand), decoded);
      from = semicolon + 1;
    }

    ampersand = text.indexOf("&", decoded !== null ? from : ampersand + 1);
  }

  parts.push(text.slice(from));

  return parts.join("");
}

function decodeEntity(entity: string): string | null {
  if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, entity)) {
    return NAMED_ENTITIES[entity] || null;
  }

  if (entity.length < 2 || entity.charAt(0) !== "#") {
    return null;
  }

  const isHex: boolean = entity.charAt(1) === "x" || entity.charAt(1) === "X";
  const digits: string = entity.slice(isHex ? 2 : 1);

  if (!digits || !isDigits(digits, isHex)) {
    return null;
  }

  const codePoint: number = parseInt(digits, isHex ? 16 : 10);

  if (
    !Number.isFinite(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return null;
  }

  return String.fromCodePoint(codePoint);
}

function isDigits(text: string, isHex: boolean): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const char: string = text.charAt(index).toLowerCase();
    const isDecimal: boolean = char >= "0" && char <= "9";

    if (!isDecimal && !(isHex && char >= "a" && char <= "f")) {
      return false;
    }
  }

  return true;
}

// The index of the ">" that ends the tag starting at `from`, outside quotes; -1 when none.
function findTagEnd(xml: string, from: number): number {
  let quote: string = "";

  for (let index: number = from; index < xml.length; index++) {
    const char: string = xml.charAt(index);

    if (quote) {
      if (char === quote) {
        quote = "";
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    } else if (char === "<") {
      return -1;
    }
  }

  return -1;
}

// "ns:DBInstance attr='x'" -> "DBInstance"; "" when it names nothing.
function readTagName(inner: string): string {
  let end: number = 0;

  while (end < inner.length) {
    const char: string = inner.charAt(end);

    if (
      char === " " ||
      char === "\t" ||
      char === "\n" ||
      char === "\r" ||
      char === "/"
    ) {
      break;
    }

    end++;
  }

  const name: string = inner.slice(0, end);
  const colon: number = name.lastIndexOf(":");

  return colon >= 0 ? name.slice(colon + 1) : name;
}

interface OpenElement {
  element: AwsXmlElement;
  text: Array<string>;
}

/*
 * The document's one top element, read whole. Throws AwsXmlError for
 * anything that is not a well-formed answer within the bounds.
 */
export function parseAwsXml(xml: string): AwsXmlElement {
  if (typeof xml !== "string" || !xml.trim()) {
    throw new AwsXmlError("The answer is empty.");
  }

  if (xml.length > AWS_XML_MAX_LENGTH) {
    throw new AwsXmlError(
      `The answer is ${xml.length} characters long; the most read is ${AWS_XML_MAX_LENGTH}.`,
    );
  }

  const document: AwsXmlElement = { name: "", children: [], text: "" };
  const stack: Array<OpenElement> = [{ element: document, text: [] }];
  let elements: number = 0;
  let index: number = 0;

  while (index < xml.length) {
    const open: number = xml.indexOf("<", index);
    const top: OpenElement = stack[stack.length - 1]!;

    if (open < 0) {
      top.text.push(decodeXmlEntities(xml.slice(index)));
      break;
    }

    if (open > index) {
      top.text.push(decodeXmlEntities(xml.slice(index, open)));
    }

    if (xml.startsWith("<!--", open)) {
      const end: number = xml.indexOf("-->", open + 4);

      if (end < 0) {
        throw new AwsXmlError("A comment is not closed.");
      }

      index = end + 3;
      continue;
    }

    if (xml.startsWith("<![CDATA[", open)) {
      const end: number = xml.indexOf("]]>", open + 9);

      if (end < 0) {
        throw new AwsXmlError("A CDATA section is not closed.");
      }

      top.text.push(xml.slice(open + 9, end));
      index = end + 3;
      continue;
    }

    if (xml.startsWith("<?", open)) {
      const end: number = xml.indexOf("?>", open + 2);

      if (end < 0) {
        throw new AwsXmlError("A declaration is not closed.");
      }

      index = end + 2;
      continue;
    }

    if (xml.startsWith("<!", open)) {
      throw new AwsXmlError("A DOCTYPE or other declaration is not read.");
    }

    if (xml.charAt(open + 1) === "/") {
      const end: number = xml.indexOf(">", open + 2);

      if (end < 0) {
        throw new AwsXmlError("A closing tag is not closed.");
      }

      const name: string = readTagName(xml.slice(open + 2, end).trim());
      const closing: OpenElement | undefined = stack.pop();

      if (!closing || stack.length === 0 || closing.element.name !== name) {
        throw new AwsXmlError(
          `A closing tag does not match the element it closes ("${name.slice(0, 64)}").`,
        );
      }

      closing.element.text = closing.text.join("").trim();
      index = end + 1;
      continue;
    }

    const end: number = findTagEnd(xml, open + 1);

    if (end < 0) {
      throw new AwsXmlError("A tag is not closed.");
    }

    const inner: string = xml.slice(open + 1, end);
    const name: string = readTagName(inner);

    if (!name) {
      throw new AwsXmlError("A tag has no name.");
    }

    elements++;

    if (elements > AWS_XML_MAX_ELEMENTS) {
      throw new AwsXmlError(
        `The answer has more than ${AWS_XML_MAX_ELEMENTS} elements.`,
      );
    }

    const element: AwsXmlElement = { name, children: [], text: "" };
    top.element.children.push(element);

    if (!inner.endsWith("/")) {
      if (stack.length > AWS_XML_MAX_DEPTH) {
        throw new AwsXmlError(
          `The answer nests deeper than ${AWS_XML_MAX_DEPTH} elements.`,
        );
      }

      stack.push({ element, text: [] });
    }

    index = end + 1;
  }

  if (stack.length !== 1) {
    throw new AwsXmlError("An element is not closed.");
  }

  if (document.children.length !== 1) {
    throw new AwsXmlError("The answer does not have exactly one top element.");
  }

  return document.children[0]!;
}

// The first child of that name, or null.
export function xmlChild(
  element: AwsXmlElement | null | undefined,
  name: string,
): AwsXmlElement | null {
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

// The element at a path of child names ("instanceState/name"), or null.
export function xmlAt(
  element: AwsXmlElement | null | undefined,
  path: string,
): AwsXmlElement | null {
  let current: AwsXmlElement | null = element || null;

  for (const part of path.split("/")) {
    if (!part) {
      continue;
    }

    current = xmlChild(current, part);

    if (!current) {
      return null;
    }
  }

  return current;
}

// The text at a path of child names, "" when it is absent.
export function xmlText(
  element: AwsXmlElement | null | undefined,
  path: string,
): string {
  const found: AwsXmlElement | null = xmlAt(element, path);
  return found ? found.text : "";
}

/*
 * The items of the list at a path: its element children, whatever AWS
 * names them ("member", "item", "DBInstance"). [] when it is absent.
 */
export function xmlList(
  element: AwsXmlElement | null | undefined,
  path: string,
): Array<AwsXmlElement> {
  const found: AwsXmlElement | null = xmlAt(element, path);
  return found ? found.children : [];
}

/*
 * The first element of that name at any depth, the element itself
 * included, depth first: the list an answer holds, whether or not it is
 * wrapped in an ...Result element. Iterative, so a deep tree is no deep
 * stack.
 */
export function xmlFind(
  element: AwsXmlElement | null | undefined,
  name: string,
): AwsXmlElement | null {
  if (!element) {
    return null;
  }

  const pending: Array<AwsXmlElement> = [element];

  while (pending.length > 0) {
    const current: AwsXmlElement = pending.pop()!;

    if (current.name === name) {
      return current;
    }

    for (let index: number = current.children.length - 1; index >= 0; index--) {
      pending.push(current.children[index]!);
    }
  }

  return null;
}
