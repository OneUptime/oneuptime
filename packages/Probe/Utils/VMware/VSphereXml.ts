/*
 * A small, strict XML reader for vSphere's SOAP answers.
 *
 * vSphere's web services API (vim25, and vSAN's urn:vsan) answers in SOAP:
 * plain, well-formed XML without a DOCTYPE, where what matters is element
 * names, a value's xsi:type, a managed object reference's "type" attribute,
 * and text - exactly, spaces included, because inventory names are text.
 * This reads exactly that into a tree, scanning with indexOf (never a
 * regular expression over the whole document - a page of inventory is
 * megabytes), with bounds on size, depth and element count, and refuses a
 * DOCTYPE outright: a SOAP answer never has one, and an entity definition
 * is the only way XML can make itself larger than it is.
 *
 * Names are kept with their prefix and read by local name: vCenter writes
 * xsi:type, the govmomi simulator writes _XMLSchema-instance:type, and both
 * are the same attribute.
 */

export interface XmlElement {
  // Local name, without a namespace prefix.
  name: string;
  attributes: Record<string, string>;
  children: Array<XmlElement>;
  // The element's own text, entity-decoded, exactly as written.
  text: string;
}

export interface XmlLimits {
  maxLength: number;
  maxDepth: number;
  maxElements: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxLength: 64 * 1024 * 1024,
  maxDepth: 64,
  maxElements: 4_000_000,
};

export class XmlParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function localName(qualifiedName: string): string {
  const colon: number = qualifiedName.indexOf(":");
  return colon === -1 ? qualifiedName : qualifiedName.substring(colon + 1);
}

function isNameCharacter(code: number): boolean {
  return !(
    (
      code === 32 ||
      code === 9 ||
      code === 10 ||
      code === 13 ||
      code === 47 || // "/"
      code === 62 || // ">"
      code === 61
    ) // "="
  );
}

export function decodeXmlEntities(value: string): string {
  if (value.indexOf("&") === -1) {
    return value;
  }

  let result: string = "";
  let index: number = 0;

  while (index < value.length) {
    const ampersand: number = value.indexOf("&", index);

    if (ampersand === -1) {
      result += value.substring(index);
      break;
    }

    result += value.substring(index, ampersand);
    const semicolon: number = value.indexOf(";", ampersand);

    if (semicolon === -1 || semicolon - ampersand > 12) {
      result += "&";
      index = ampersand + 1;
      continue;
    }

    const entity: string = value.substring(ampersand + 1, semicolon);
    let decoded: string | null = null;

    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint: number = Number.parseInt(entity.substring(2), 16);
      decoded = Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : null;
    } else if (entity.startsWith("#")) {
      const codePoint: number = Number.parseInt(entity.substring(1), 10);
      decoded = Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : null;
    } else if (NAMED_ENTITIES[entity] !== undefined) {
      decoded = NAMED_ENTITIES[entity]!;
    }

    if (decoded === null) {
      result += value.substring(ampersand, semicolon + 1);
    } else {
      result += decoded;
    }

    index = semicolon + 1;
  }

  return result;
}

export function escapeXml(value: string): string {
  let result: string = "";

  for (const character of value) {
    switch (character) {
      case "&":
        result += "&amp;";
        break;
      case "<":
        result += "&lt;";
        break;
      case ">":
        result += "&gt;";
        break;
      case '"':
        result += "&quot;";
        break;
      case "'":
        result += "&apos;";
        break;
      default:
        result += character;
    }
  }

  return result;
}

// Reads the attributes of a start tag, between its name and its ">".
function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let index: number = 0;

  while (index < source.length) {
    while (
      index < source.length &&
      !isNameCharacter(source.charCodeAt(index))
    ) {
      index++;
    }

    if (index >= source.length) {
      break;
    }

    const nameStart: number = index;

    while (index < source.length && isNameCharacter(source.charCodeAt(index))) {
      index++;
    }

    const name: string = source.substring(nameStart, index);

    while (index < source.length && source.charCodeAt(index) <= 32) {
      index++;
    }

    if (source[index] !== "=") {
      // An attribute without a value: not XML, and nothing vSphere writes.
      continue;
    }

    index++;

    while (index < source.length && source.charCodeAt(index) <= 32) {
      index++;
    }

    const quote: string | undefined = source[index];

    if (quote !== '"' && quote !== "'") {
      throw new XmlParseError(`Attribute ${name} has no quoted value.`);
    }

    const valueEnd: number = source.indexOf(quote, index + 1);

    if (valueEnd === -1) {
      throw new XmlParseError(`Attribute ${name} is not closed.`);
    }

    attributes[name] = decodeXmlEntities(source.substring(index + 1, valueEnd));
    index = valueEnd + 1;
  }

  return attributes;
}

// The index of the ">" that ends a start tag, skipping quoted attribute values.
function findTagEnd(xml: string, from: number): number {
  let index: number = from;
  let quote: string | null = null;

  while (index < xml.length) {
    const character: string = xml[index]!;

    if (quote) {
      if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }

    index++;
  }

  return -1;
}

export function parseXml(
  xml: string,
  limits: XmlLimits = DEFAULT_XML_LIMITS,
): XmlElement {
  if (xml.length > limits.maxLength) {
    throw new XmlParseError(
      `The answer is ${xml.length} characters long, more than the ${limits.maxLength} read.`,
    );
  }

  const root: XmlElement = {
    name: "#document",
    attributes: {},
    children: [],
    text: "",
  };

  const stack: Array<XmlElement> = [root];
  let elementCount: number = 0;
  let index: number = xml.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (index < xml.length) {
    const tagStart: number = xml.indexOf("<", index);
    const current: XmlElement = stack[stack.length - 1]!;

    if (tagStart === -1) {
      if (stack.length > 1) {
        current.text += decodeXmlEntities(xml.substring(index));
      }
      break;
    }

    if (tagStart > index && stack.length > 1) {
      current.text += decodeXmlEntities(xml.substring(index, tagStart));
    }

    if (xml.startsWith("<?", tagStart)) {
      const end: number = xml.indexOf("?>", tagStart + 2);

      if (end === -1) {
        throw new XmlParseError("A processing instruction is not closed.");
      }

      index = end + 2;
      continue;
    }

    if (xml.startsWith("<!--", tagStart)) {
      const end: number = xml.indexOf("-->", tagStart + 4);

      if (end === -1) {
        throw new XmlParseError("A comment is not closed.");
      }

      index = end + 3;
      continue;
    }

    if (xml.startsWith("<![CDATA[", tagStart)) {
      const end: number = xml.indexOf("]]>", tagStart + 9);

      if (end === -1) {
        throw new XmlParseError("A CDATA section is not closed.");
      }

      if (stack.length > 1) {
        current.text += xml.substring(tagStart + 9, end);
      }

      index = end + 3;
      continue;
    }

    if (xml.startsWith("<!", tagStart)) {
      throw new XmlParseError(
        "The answer declares a DOCTYPE, which a vSphere answer never does.",
      );
    }

    if (xml.startsWith("</", tagStart)) {
      const end: number = xml.indexOf(">", tagStart + 2);

      if (end === -1) {
        throw new XmlParseError("A closing tag is not closed.");
      }

      const name: string = localName(xml.substring(tagStart + 2, end).trim());

      if (stack.length <= 1 || current.name !== name) {
        throw new XmlParseError(
          `Closing tag </${name}> does not match <${current.name}>.`,
        );
      }

      stack.pop();
      index = end + 1;
      continue;
    }

    const tagEnd: number = findTagEnd(xml, tagStart + 1);

    if (tagEnd === -1) {
      throw new XmlParseError("A start tag is not closed.");
    }

    const isSelfClosing: boolean = xml.charCodeAt(tagEnd - 1) === 47;
    const content: string = xml.substring(
      tagStart + 1,
      isSelfClosing ? tagEnd - 1 : tagEnd,
    );

    let nameEnd: number = 0;

    while (
      nameEnd < content.length &&
      isNameCharacter(content.charCodeAt(nameEnd))
    ) {
      nameEnd++;
    }

    const qualifiedName: string = content.substring(0, nameEnd);

    if (!qualifiedName) {
      throw new XmlParseError("A start tag has no name.");
    }

    elementCount++;

    if (elementCount > limits.maxElements) {
      throw new XmlParseError(
        `The answer has more than ${limits.maxElements} elements.`,
      );
    }

    const element: XmlElement = {
      name: localName(qualifiedName),
      attributes: parseAttributes(content.substring(nameEnd)),
      children: [],
      text: "",
    };

    current.children.push(element);

    if (!isSelfClosing) {
      if (stack.length > limits.maxDepth) {
        throw new XmlParseError(
          `The answer nests deeper than ${limits.maxDepth} elements.`,
        );
      }

      stack.push(element);
    }

    index = tagEnd + 1;
  }

  if (stack.length > 1) {
    throw new XmlParseError(
      `The answer ends inside <${stack[stack.length - 1]!.name}>.`,
    );
  }

  const documentElement: XmlElement | undefined = root.children[0];

  if (!documentElement) {
    throw new XmlParseError("The answer is not XML.");
  }

  return documentElement;
}

export default class VSphereXml {
  public static child(
    element: XmlElement | null | undefined,
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

  public static children(
    element: XmlElement | null | undefined,
    name: string,
  ): Array<XmlElement> {
    if (!element) {
      return [];
    }

    return element.children.filter((child: XmlElement): boolean => {
      return child.name === name;
    });
  }

  // The element at a path of child names, e.g. ["Body", "LoginResponse"].
  public static path(
    element: XmlElement | null | undefined,
    names: Array<string>,
  ): XmlElement | null {
    let current: XmlElement | null = element || null;

    for (const name of names) {
      current = VSphereXml.child(current, name);

      if (!current) {
        return null;
      }
    }

    return current;
  }

  public static childText(
    element: XmlElement | null | undefined,
    name: string,
  ): string | null {
    const child: XmlElement | null = VSphereXml.child(element, name);
    return child ? child.text : null;
  }

  /*
   * The xsi:type of an element, by local name and whatever its prefix - the
   * one "type" attribute that has a prefix. The unprefixed "type" is a
   * managed object reference's own.
   */
  public static xsiType(element: XmlElement | null | undefined): string | null {
    if (!element) {
      return null;
    }

    for (const key of Object.keys(element.attributes)) {
      const colon: number = key.indexOf(":");

      if (colon !== -1 && key.substring(colon + 1) === "type") {
        const value: string = element.attributes[key] || "";
        return localName(value);
      }
    }

    return null;
  }
}
