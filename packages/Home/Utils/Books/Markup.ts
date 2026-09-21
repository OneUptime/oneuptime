/*
 * A forgiving tokenizer for the XHTML and XML inside an EPUB.
 *
 * EPUB content documents are well-formed XHTML, but the books page treats the
 * book as untrusted input, so this never assumes well-formedness: a stray "<"
 * becomes text, an unterminated tag or comment swallows the rest of the input
 * rather than leaking it through as markup, and attribute values are decoded
 * here so the sanitizer only ever sees plain strings. Nothing in this file
 * produces HTML; see BookHtml.ts for the allow-list that does.
 */

export interface TextToken {
  type: "text";
  // Decoded text: entities have already been resolved.
  text: string;
}

export interface OpenTagToken {
  type: "open";
  // Lower-case local name, without any namespace prefix.
  name: string;
  // Lower-case qualified name, e.g. "epub:type" or "dc:title".
  qualifiedName: string;
  attributes: Record<string, string>;
  selfClosing: boolean;
}

export interface CloseTagToken {
  type: "close";
  name: string;
  qualifiedName: string;
}

export type MarkupToken = TextToken | OpenTagToken | CloseTagToken;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  shy: "\u00ad",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  deg: "\u00b0",
  plusmn: "\u00b1",
  times: "\u00d7",
  divide: "\u00f7",
  middot: "\u00b7",
  para: "\u00b6",
  sect: "\u00a7",
  laquo: "\u00ab",
  raquo: "\u00bb",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201a",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bdquo: "\u201e",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  bull: "\u2022",
  prime: "\u2032",
  Prime: "\u2033",
  euro: "\u20ac",
  pound: "\u00a3",
  yen: "\u00a5",
  cent: "\u00a2",
  larr: "\u2190",
  rarr: "\u2192",
  uarr: "\u2191",
  darr: "\u2193",
  harr: "\u2194",
  le: "\u2264",
  ge: "\u2265",
  ne: "\u2260",
  asymp: "\u2248",
  minus: "\u2212",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  sup2: "\u00b2",
  sup3: "\u00b3",
  micro: "\u00b5",
  thinsp: "\u2009",
  ensp: "\u2002",
  emsp: "\u2003",
  zwnj: "\u200c",
  zwj: "\u200d",
};

const isAllowedCodePoint: (codePoint: number) => boolean = (
  codePoint: number,
): boolean => {
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
    return false;
  }

  // Lone surrogates cannot be encoded; C0 controls other than whitespace are noise.
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return false;
  }

  if (
    codePoint < 0x20 &&
    codePoint !== 0x09 &&
    codePoint !== 0x0a &&
    codePoint !== 0x0d
  ) {
    return false;
  }

  return true;
};

const ENTITY_PATTERN: RegExp =
  /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;

export const decodeEntities: (value: string) => string = (
  value: string,
): string => {
  if (!value.includes("&")) {
    return value;
  }

  return value.replace(ENTITY_PATTERN, (match: string, body: string) => {
    if (body.startsWith("#")) {
      const codePoint: number =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);

      return isAllowedCodePoint(codePoint)
        ? String.fromCodePoint(codePoint)
        : "\ufffd";
    }

    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
      ? NAMED_ENTITIES[body]!
      : match;
  });
};

export const escapeHtml: (value: string) => string = (
  value: string,
): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const TAG_NAME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_.:-]*/;
const SELF_CLOSING_PATTERN: RegExp = /\/\s*$/;
const ATTRIBUTE_PATTERN: RegExp =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const localName: (qualifiedName: string) => string = (
  qualifiedName: string,
): string => {
  const colon: number = qualifiedName.lastIndexOf(":");
  return colon >= 0 ? qualifiedName.slice(colon + 1) : qualifiedName;
};

const parseAttributes: (source: string) => Record<string, string> = (
  source: string,
): Record<string, string> => {
  const attributes: Record<string, string> = {};

  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name: string = match[1]!.toLowerCase();
    const value: string = match[2] ?? match[3] ?? match[4] ?? "";

    // The first occurrence wins, as it does in browsers.
    if (!Object.prototype.hasOwnProperty.call(attributes, name)) {
      attributes[name] = decodeEntities(value);
    }
  }

  return attributes;
};

/*
 * Finds the ">" that ends a tag starting at `start`, skipping over quoted
 * attribute values so that `title="a>b"` does not end the tag early.
 */
const findTagEnd: (source: string, start: number) => number = (
  source: string,
  start: number,
): number => {
  let quote: string | null = null;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source[index]!;

    if (quote) {
      if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }

  return -1;
};

export const tokenizeMarkup: (source: string) => Array<MarkupToken> = (
  source: string,
): Array<MarkupToken> => {
  const tokens: Array<MarkupToken> = [];
  let text: string = "";
  let index: number = 0;

  const flushText: () => void = (): void => {
    if (text) {
      tokens.push({ type: "text", text: decodeEntities(text) });
      text = "";
    }
  };

  while (index < source.length) {
    const lessThan: number = source.indexOf("<", index);

    if (lessThan < 0) {
      text += source.slice(index);
      break;
    }

    text += source.slice(index, lessThan);

    if (source.startsWith("<!--", lessThan)) {
      const end: number = source.indexOf("-->", lessThan + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }

    if (source.startsWith("<![CDATA[", lessThan)) {
      const end: number = source.indexOf("]]>", lessThan + 9);
      const content: string = source.slice(
        lessThan + 9,
        end < 0 ? source.length : end,
      );

      // CDATA is literal text; escape its entities so decoding leaves it intact.
      text += content.replace(/&/g, "&amp;");
      index = end < 0 ? source.length : end + 3;
      continue;
    }

    if (source[lessThan + 1] === "!" || source[lessThan + 1] === "?") {
      // Doctype, processing instruction or XML declaration: dropped.
      const end: number = source.indexOf(">", lessThan + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }

    const isClose: boolean = source[lessThan + 1] === "/";
    const nameStart: number = lessThan + (isClose ? 2 : 1);
    const nameMatch: RegExpExecArray | null = TAG_NAME_PATTERN.exec(
      source.slice(nameStart, nameStart + 128),
    );

    if (!nameMatch) {
      // Not a tag: keep the "<" as text.
      text += "<";
      index = lessThan + 1;
      continue;
    }

    const end: number = findTagEnd(source, nameStart + nameMatch[0].length);

    if (end < 0) {
      // An unterminated tag: drop the remainder rather than emit it as text.
      index = source.length;
      break;
    }

    flushText();

    const qualifiedName: string = nameMatch[0].toLowerCase();
    const name: string = localName(qualifiedName);

    if (isClose) {
      tokens.push({ type: "close", name, qualifiedName });
    } else {
      let attributeSource: string = source.slice(
        nameStart + nameMatch[0].length,
        end,
      );
      const selfClosing: boolean = SELF_CLOSING_PATTERN.test(attributeSource);

      if (selfClosing) {
        attributeSource = attributeSource.replace(SELF_CLOSING_PATTERN, "");
      }

      tokens.push({
        type: "open",
        name,
        qualifiedName,
        attributes: parseAttributes(attributeSource),
        selfClosing,
      });
    }

    index = end + 1;
  }

  flushText();
  return tokens;
};

/*
 * A minimal element tree, used for the EPUB package documents (container.xml,
 * the OPF and the navigation document) where structure matters more than
 * content. Unbalanced close tags are tolerated.
 *
 * In "xml" mode every element needs an explicit close or a self-closing slash,
 * as XML requires (an OPF <meta> has text content). In "html" mode the HTML
 * void elements (<br>, <img>, <meta>...) never take children.
 */
export type MarkupTreeMode = "xml" | "html";
export interface MarkupElement {
  name: string;
  qualifiedName: string;
  attributes: Record<string, string>;
  children: Array<MarkupNode>;
}

export type MarkupNode = MarkupElement | string;

const VOID_ELEMENTS: Set<string> = new Set<string>([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export const parseMarkupTree: (
  source: string,
  mode?: MarkupTreeMode,
) => MarkupElement = (
  source: string,
  mode: MarkupTreeMode = "xml",
): MarkupElement => {
  const root: MarkupElement = {
    name: "#root",
    qualifiedName: "#root",
    attributes: {},
    children: [],
  };
  const stack: Array<MarkupElement> = [root];

  for (const token of tokenizeMarkup(source)) {
    const parent: MarkupElement = stack[stack.length - 1]!;

    if (token.type === "text") {
      parent.children.push(token.text);
    } else if (token.type === "open") {
      const element: MarkupElement = {
        name: token.name,
        qualifiedName: token.qualifiedName,
        attributes: token.attributes,
        children: [],
      };

      parent.children.push(element);

      if (
        !token.selfClosing &&
        !(mode === "html" && VOID_ELEMENTS.has(token.name))
      ) {
        stack.push(element);
      }
    } else {
      for (let depth: number = stack.length - 1; depth > 0; depth--) {
        if (stack[depth]!.qualifiedName === token.qualifiedName) {
          stack.length = depth;
          break;
        }
      }
    }
  }

  return root;
};

export const findElements: (
  node: MarkupElement,
  predicate: (element: MarkupElement) => boolean,
) => Array<MarkupElement> = (
  node: MarkupElement,
  predicate: (element: MarkupElement) => boolean,
): Array<MarkupElement> => {
  const found: Array<MarkupElement> = [];

  const visit: (element: MarkupElement) => void = (
    element: MarkupElement,
  ): void => {
    for (const child of element.children) {
      if (typeof child !== "string") {
        if (predicate(child)) {
          found.push(child);
        }

        visit(child);
      }
    }
  };

  visit(node);
  return found;
};

export const findFirstElement: (
  node: MarkupElement,
  predicate: (element: MarkupElement) => boolean,
) => MarkupElement | null = (
  node: MarkupElement,
  predicate: (element: MarkupElement) => boolean,
): MarkupElement | null => {
  return findElements(node, predicate)[0] || null;
};

export const childElements: (
  node: MarkupElement,
  name?: string,
) => Array<MarkupElement> = (
  node: MarkupElement,
  name?: string,
): Array<MarkupElement> => {
  return node.children.filter((child: MarkupNode): child is MarkupElement => {
    return typeof child !== "string" && (!name || child.name === name);
  });
};

export const textContent: (node: MarkupNode) => string = (
  node: MarkupNode,
): string => {
  if (typeof node === "string") {
    return node;
  }

  return node.children.map(textContent).join("");
};

export const normalizeWhitespace: (value: string) => string = (
  value: string,
): string => {
  return value.replace(/\s+/g, " ").trim();
};
