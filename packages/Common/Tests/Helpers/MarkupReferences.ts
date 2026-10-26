import { replaceHtmlMarkup } from "../../Types/HtmlMarkup";

/*
 * EVERY ADDRESS A PAGE OR AN EMAIL REFERS TO, AND WHETHER IT IS LOADED.
 *
 * For the guards that keep server-rendered pages and emails from loading
 * anything from another host (OfflineAssetHygiene.test.ts; issue #5124: the
 * header of every email loaded its logo from res.cloudinary.com, which no
 * mail client on a network without the internet reaches, and which told a
 * third party who opened which email, and when).
 *
 * A browser or a mail client fetches what an element loads as the page is
 * shown: an image's src or srcset, a background, a poster, an object's
 * data, a stylesheet or an icon a <link> names, an SVG image, a url() or an
 * @import in CSS - in a style attribute or a <style> element. It fetches
 * nothing a link points at until someone follows it (<a href>, <area href>,
 * a <form>'s action), nor an address that is only text.
 *
 * The markup is read by the walk product code reads markup with
 * (replaceHtmlMarkup, Common/Types/HtmlMarkup), never by a pattern over the
 * HTML: each tag, comment, <style> and <script> comes whole, and a tag's
 * attributes are read a character at a time. Outlook's conditional
 * comments ("<!--[if mso]> ... <![endif]-->") are read as markup, because
 * Outlook shows what they hold; any other comment is not. Template syntax
 * stays as it is: an attribute whose value is "{{logoUrl}}" or
 * "<%= logoUrl %>" names no address of its own.
 */

export interface MarkupReference {
  // In lower case: "img", "link", "a"; "style" for CSS, "#text" for text.
  element: string;
  // In lower case: "src", "href", "style"; "url()" or "@import" in CSS.
  attribute: string;
  // The address as written, quotes left out.
  value: string;
  // Whether a browser or a mail client fetches it to show the page.
  loads: boolean;
}

// Attributes whose address is fetched, whatever the element.
const LOADING_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  "src",
  "srcset",
  "background",
  "poster",
  "lowsrc",
  "dynsrc",
]);

// SVG elements whose href (or xlink:href) is fetched.
const LOADING_HREF_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "image",
  "use",
  "feimage",
]);

/*
 * A <link> fetches what it names - a stylesheet, an icon, a preload, a
 * manifest, or a connection to its host (preconnect) - unless it only says
 * where something else is.
 */
const NON_FETCHING_LINK_RELATIONS: ReadonlySet<string> = new Set<string>([
  "alternate",
  "author",
  "bookmark",
  "canonical",
  "external",
  "help",
  "license",
  "me",
  "next",
  "prev",
  "search",
  "tag",
]);

// What a raw-text element (rawTextElements) is: its name and its CSS, if any.
const RAW_TEXT_ELEMENTS: ReadonlyArray<string> = [
  "style",
  "script",
  "iframe",
  "noembed",
  "noframes",
];

const CONDITIONAL_COMMENT_OPEN: string = "<!--[if";
const CONDITIONAL_COMMENT_END: string = "<![endif]";

type IsCharacterFunction = (character: string | undefined) => boolean;

const isSpace: IsCharacterFunction = (
  character: string | undefined,
): boolean => {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === "\f"
  );
};

// Where a tag or attribute name ends, as a browser reads one.
const isNameEnd: IsCharacterFunction = (
  character: string | undefined,
): boolean => {
  return (
    character === undefined ||
    isSpace(character) ||
    character === "/" ||
    character === ">" ||
    character === "="
  );
};

export interface TagAttribute {
  name: string;
  value: string;
}

export interface StartTag {
  name: string;
  attributes: Array<TagAttribute>;
  // Where the start tag ends: past its ">".
  end: number;
}

/*
 * The start tag at the beginning of `markup`: its name and attributes, read
 * a character at a time, to the first ">" outside a quoted value. Names in
 * lower case; values as written, quotes left out. ScreenReaderText reads
 * tags with it too.
 */
export const readStartTag: (markup: string) => StartTag = (
  markup: string,
): StartTag => {
  let index: number = 1;
  let name: string = "";

  while (index < markup.length && !isNameEnd(markup[index])) {
    name += markup[index];
    index++;
  }

  const attributes: Array<TagAttribute> = [];

  while (index < markup.length && markup[index] !== ">") {
    if (isSpace(markup[index]) || markup[index] === "/") {
      index++;
      continue;
    }

    let attributeName: string = "";

    while (index < markup.length && !isNameEnd(markup[index])) {
      attributeName += markup[index];
      index++;
    }

    while (index < markup.length && isSpace(markup[index])) {
      index++;
    }

    let value: string = "";

    if (markup[index] === "=") {
      index++;

      while (index < markup.length && isSpace(markup[index])) {
        index++;
      }

      const quote: string | undefined = markup[index];

      if (quote === '"' || quote === "'") {
        const close: number = markup.indexOf(quote, index + 1);
        const valueEnd: number = close === -1 ? markup.length : close;

        value = markup.slice(index + 1, valueEnd);
        index = valueEnd + 1;
      } else {
        while (
          index < markup.length &&
          !isSpace(markup[index]) &&
          markup[index] !== ">"
        ) {
          value += markup[index];
          index++;
        }
      }
    }

    if (attributeName) {
      attributes.push({ name: attributeName.toLowerCase(), value: value });
    } else {
      // Nothing a name can start with: step past it.
      index++;
    }
  }

  return {
    name: name.toLowerCase(),
    attributes: attributes,
    end: Math.min(index + 1, markup.length),
  };
};

// `value` without the quotes around it, and without the space inside them.
const unquote: (value: string) => string = (value: string): string => {
  const trimmed: string = value.trim();
  const first: string | undefined = trimmed[0];

  if (
    trimmed.length >= 2 &&
    (first === '"' || first === "'") &&
    trimmed[trimmed.length - 1] === first
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
};

// CSS with its comments taken out: an address in a comment loads nothing.
const withoutCssComments: (css: string) => string = (css: string): string => {
  let result: string = "";
  let at: number = 0;

  while (at < css.length) {
    const open: number = css.indexOf("/*", at);

    if (open === -1) {
      result += css.slice(at);
      break;
    }

    result += css.slice(at, open);

    const close: number = css.indexOf("*/", open + 2);

    at = close === -1 ? css.length : close + 2;
  }

  return result;
};

/**
 * Every address CSS loads: each url(), and each @import of a quoted
 * address (an @import of a url() is one of those already).
 */
export const readCssReferences: (
  css: string,
  element: string,
) => Array<MarkupReference> = (
  css: string,
  element: string,
): Array<MarkupReference> => {
  const references: Array<MarkupReference> = [];
  const code: string = withoutCssComments(css);
  const lower: string = code.toLowerCase();

  // Each search goes on from where the last one ended: linear in the CSS.
  let at: number = lower.indexOf("url(");

  while (at !== -1) {
    const close: number = code.indexOf(")", at + 4);
    const end: number = close === -1 ? code.length : close;

    references.push({
      element: element,
      attribute: "url()",
      value: unquote(code.slice(at + 4, end)),
      loads: true,
    });

    at = lower.indexOf("url(", end);
  }

  at = lower.indexOf("@import");

  while (at !== -1) {
    let start: number = at + "@import".length;

    while (start < code.length && isSpace(code[start])) {
      start++;
    }

    const quote: string | undefined = code[start];
    let end: number = start;

    if (quote === '"' || quote === "'") {
      const close: number = code.indexOf(quote, start + 1);

      end = close === -1 ? code.length : close;

      references.push({
        element: element,
        attribute: "@import",
        value: code.slice(start + 1, end),
        loads: true,
      });
    }

    at = lower.indexOf("@import", end);
  }

  return references;
};

// Where an address written in text ends.
const isAddressEnd: IsCharacterFunction = (
  character: string | undefined,
): boolean => {
  return (
    character === undefined ||
    isSpace(character) ||
    character === "<" ||
    character === ">" ||
    character === '"' ||
    character === "'" ||
    character === "`" ||
    character === ")"
  );
};

const TRAILING_PUNCTUATION: string = ".,;:!?";

/**
 * Every http(s) address written in `text`, as text: linked by a mail
 * client, perhaps, but fetched by nobody.
 */
export const readTextAddresses: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const addresses: Array<string> = [];
  const lower: string = text.toLowerCase();

  // Each search goes on from where the last address ended: linear in the text.
  let at: number = lower.indexOf("http");

  while (at !== -1) {
    const scheme: string | null = lower.startsWith("http://", at)
      ? "http://"
      : lower.startsWith("https://", at)
        ? "https://"
        : null;

    if (scheme === null) {
      at = lower.indexOf("http", at + 4);
      continue;
    }

    let end: number = at + scheme.length;

    while (!isAddressEnd(text[end])) {
      end++;
    }

    const next: number = end;

    while (
      end > at + scheme.length &&
      TRAILING_PUNCTUATION.includes(text[end - 1]!)
    ) {
      end--;
    }

    addresses.push(text.slice(at, end));

    at = lower.indexOf("http", next);
  }

  return addresses;
};

// Whether a value is an address of the web, written out: http(s) or "//".
export const isAbsoluteWebAddress: (value: string) => boolean = (
  value: string,
): boolean => {
  const lower: string = value.trim().toLowerCase();

  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("//")
  );
};

/**
 * The host an address written out names, in lower case - "//cdn.example"
 * names one too - or null for an address that names none: a path, a data:
 * or cid: address, mailto:, or a template's value. An address whose host
 * cannot be read is "(unreadable)", never null: a guard must not take it
 * for one that names no host.
 */
export const addressHost: (value: string) => string | null = (
  value: string,
): string | null => {
  if (!isAbsoluteWebAddress(value)) {
    return null;
  }

  const trimmed: string = value.trim();
  const absolute: string = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : trimmed;

  try {
    const host: string = new URL(absolute).host.toLowerCase();

    return host || "(unreadable)";
  } catch {
    return "(unreadable)";
  }
};

// The addresses in a srcset: each candidate's first word.
const srcsetAddresses: (srcset: string) => Array<string> = (
  srcset: string,
): Array<string> => {
  return srcset
    .split(",")
    .map((candidate: string): string => {
      const trimmed: string = candidate.trim();
      let end: number = 0;

      while (end < trimmed.length && !isSpace(trimmed[end])) {
        end++;
      }

      return trimmed.slice(0, end);
    })
    .filter((address: string): boolean => {
      return address.length > 0;
    });
};

// What one attribute of an element refers to.
const attributeReferences: (
  element: string,
  attribute: TagAttribute,
  linkRelation: string,
) => Array<MarkupReference> = (
  element: string,
  attribute: TagAttribute,
  linkRelation: string,
): Array<MarkupReference> => {
  const name: string = attribute.name;
  const value: string = attribute.value.trim();

  // A namespace is a name, never fetched.
  if (name === "xmlns" || name.startsWith("xmlns:")) {
    return [];
  }

  if (name === "style") {
    return readCssReferences(value, element);
  }

  if (name === "srcset") {
    return srcsetAddresses(value).map((address: string): MarkupReference => {
      return {
        element: element,
        attribute: name,
        value: address,
        loads: true,
      };
    });
  }

  const loads: boolean =
    LOADING_ATTRIBUTES.has(name) ||
    (name === "data" && element === "object") ||
    ((name === "href" || name === "xlink:href") &&
      LOADING_HREF_ELEMENTS.has(element)) ||
    (name === "href" &&
      element === "link" &&
      !linkRelation
        .split(" ")
        .filter((relation: string): boolean => {
          return relation.length > 0;
        })
        .every((relation: string): boolean => {
          return NON_FETCHING_LINK_RELATIONS.has(relation);
        }));

  if (loads) {
    return [{ element: element, attribute: name, value: value, loads: true }];
  }

  // A link, or any other attribute, matters only when it names a host.
  if (isAbsoluteWebAddress(value)) {
    return [{ element: element, attribute: name, value: value, loads: false }];
  }

  return [];
};

// What a start tag refers to.
const tagReferences: (tag: StartTag) => Array<MarkupReference> = (
  tag: StartTag,
): Array<MarkupReference> => {
  const relation: string = (
    tag.attributes.find((attribute: TagAttribute): boolean => {
      return attribute.name === "rel";
    })?.value || ""
  ).toLowerCase();

  return tag.attributes.flatMap(
    (attribute: TagAttribute): Array<MarkupReference> => {
      return attributeReferences(tag.name, attribute, relation);
    },
  );
};

// The raw-text element `markup` starts, or null.
const rawTextElementOf: (markup: string) => string | null = (
  markup: string,
): string | null => {
  const lower: string = markup.toLowerCase();

  for (const name of RAW_TEXT_ELEMENTS) {
    if (lower.startsWith(`<${name}`) && isNameEnd(lower[name.length + 1])) {
      // Whole only when it has its end tag; else an ordinary start tag.
      return lower.lastIndexOf(`</${name}`) > 0 ? name : null;
    }
  }

  return null;
};

/**
 * Every address `markup` refers to, in the order it is written: what its
 * elements load, the addresses its links and other attributes name, and the
 * addresses written in its text. See the top of this file.
 */
export const readMarkupReferences: (
  markup: string,
) => Array<MarkupReference> = (markup: string): Array<MarkupReference> => {
  const references: Array<MarkupReference> = [];
  const pieces: Array<string> = [];

  const text: string = replaceHtmlMarkup(
    markup,
    (piece: string): string => {
      pieces.push(piece);
      return " ";
    },
    { rawTextElements: true },
  );

  for (const piece of pieces) {
    if (piece.startsWith(CONDITIONAL_COMMENT_OPEN)) {
      // Outlook shows what it holds: read it as markup.
      const open: number = piece.indexOf("]>");
      const close: number = piece.lastIndexOf(CONDITIONAL_COMMENT_END);

      if (open !== -1) {
        references.push(
          ...readMarkupReferences(
            piece.slice(open + 2, close > open ? close : piece.length),
          ),
        );
      }

      continue;
    }

    if (piece.startsWith("<!") || piece.startsWith("<?")) {
      // A comment, the doctype or a processing instruction.
      continue;
    }

    if (piece.startsWith("</")) {
      continue;
    }

    const tag: StartTag = readStartTag(piece);

    references.push(...tagReferences(tag));

    if (rawTextElementOf(piece) === "style") {
      const close: number = piece.toLowerCase().lastIndexOf("</style");

      references.push(
        ...readCssReferences(piece.slice(tag.end, close), "style"),
      );
    }
  }

  for (const address of readTextAddresses(text)) {
    references.push({
      element: "#text",
      attribute: "",
      value: address,
      loads: false,
    });
  }

  return references;
};

// How a reference is named in a guard's message.
export const describeReference: (reference: MarkupReference) => string = (
  reference: MarkupReference,
): string => {
  const where: string = reference.attribute
    ? `${reference.element} ${reference.attribute}`
    : reference.element;

  return `${where} "${reference.value}"`;
};

// A value a template is given: the whole of it, or the start of it.
const isTemplateValue: (value: string) => boolean = (
  value: string,
): boolean => {
  return value.startsWith("{{") || value.startsWith("<%");
};

const INLINE_IMAGE_SCHEMES: ReadonlyArray<string> = ["cid:", "data:"];

/**
 * What is wrong with an email template's source, one message a problem:
 *
 *   - an element that loads anything but a value the template is given
 *     ({{...}} or <%= ... %>) or an image the email carries itself (cid:,
 *     data:). An address the template writes itself loads from another
 *     host, or - a path - from nowhere a mail client can find;
 *   - an address of a link or of text whose host is not in `linkHosts`.
 *
 * Comments the template's language takes out of what it renders are not
 * read (withoutTemplateComments).
 */
export const emailTemplateProblems: (
  source: string,
  linkHosts: ReadonlyArray<string>,
) => Array<string> = (
  source: string,
  linkHosts: ReadonlyArray<string>,
): Array<string> => {
  const problems: Array<string> = [];

  for (const reference of readMarkupReferences(
    withoutTemplateComments(source),
  )) {
    const value: string = reference.value.trim();

    if (reference.loads) {
      const isInline: boolean = INLINE_IMAGE_SCHEMES.some(
        (scheme: string): boolean => {
          return value.toLowerCase().startsWith(scheme);
        },
      );

      if (!isTemplateValue(value) && !isInline) {
        problems.push(
          `${describeReference(reference)} loads an address the template writes itself`,
        );
      }

      continue;
    }

    const host: string | null = addressHost(value);

    if (host !== null && !linkHosts.includes(host)) {
      problems.push(
        `${describeReference(reference)} names ${host}, a host outside the installation`,
      );
    }
  }

  return problems;
};

/**
 * What a server-rendered page loads from a host not in `allowedHosts`, one
 * message an address. A path is this installation's own; links and text
 * load nothing.
 */
export const pageLoadProblems: (
  source: string,
  allowedHosts: ReadonlyArray<string>,
) => Array<string> = (
  source: string,
  allowedHosts: ReadonlyArray<string>,
): Array<string> => {
  return readMarkupReferences(withoutTemplateComments(source))
    .filter((reference: MarkupReference): boolean => {
      const host: string | null = addressHost(reference.value);

      return reference.loads && host !== null && !allowedHosts.includes(host);
    })
    .map((reference: MarkupReference): string => {
      return `${describeReference(reference)} loads from ${addressHost(
        reference.value,
      )}`;
    });
};

/**
 * A template's source without its comments, which never reach what it
 * renders: Handlebars' {{!-- ... --}} and {{! ... }}, and EJS's <%# ... %>.
 * Read with indexOf, a comment at a time.
 */
export const withoutTemplateComments: (source: string) => string = (
  source: string,
): string => {
  const syntaxes: ReadonlyArray<[string, string]> = [
    ["{{!--", "--}}"],
    ["{{!", "}}"],
    ["<%#", "%>"],
  ];
  let result: string = source;

  for (const [open, close] of syntaxes) {
    let kept: string = "";
    let at: number = 0;

    while (at < result.length) {
      const start: number = result.indexOf(open, at);

      if (start === -1) {
        kept += result.slice(at);
        break;
      }

      kept += result.slice(at, start);

      const end: number = result.indexOf(close, start + open.length);

      at = end === -1 ? result.length : end + close.length;
    }

    result = kept;
  }

  return result;
};
