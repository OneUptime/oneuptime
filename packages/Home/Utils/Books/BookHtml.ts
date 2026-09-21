import { escapeHtml, MarkupToken, tokenizeMarkup } from "./Markup";

/*
 * Turns an EPUB content document into HTML that is safe to insert into
 * oneuptime.com.
 *
 * The book is fetched from another origin at runtime, so its markup is
 * untrusted: whatever it contains ends up in innerHTML on the books page. This
 * is therefore an allow-list, not a block-list. Only structural text elements
 * survive; every attribute is rebuilt from a validated value; class names and
 * ids are namespaced so the book can never collide with the site's own CSS,
 * scripts or anchors; and links are either rewritten to in-book targets,
 * limited to http(s)/mailto, or removed.
 */

export interface InternalBookLink {
  kind: "internal";
  sectionId: string;
  // The fragment inside the target section, as written in the book.
  fragment?: string | undefined;
}

export interface ExternalBookLink {
  kind: "external";
  href: string;
}

export type ResolvedBookLink = InternalBookLink | ExternalBookLink;

export interface BookHtmlOptions {
  // The section being sanitized; ids inside it are namespaced with it.
  sectionId: string;
  /*
   * Resolves a relative href (already known not to carry a scheme) to a
   * section of the book. Returning null removes the link.
   */
  resolveRelativeLink?: (href: string) => InternalBookLink | null;
}

// Elements whose content is removed together with the element.
const DROPPED_WITH_CONTENT: Set<string> = new Set<string>([
  "applet",
  "area",
  "audio",
  "base",
  "button",
  "canvas",
  "datalist",
  "dialog",
  "embed",
  "form",
  "frame",
  "frameset",
  "head",
  "iframe",
  "img",
  "input",
  "link",
  "map",
  "math",
  "meta",
  "noembed",
  "noframes",
  "noscript",
  "object",
  "option",
  "param",
  "picture",
  "portal",
  "script",
  "select",
  "slot",
  "source",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
  "track",
  "video",
  "xmp",
  "plaintext",
]);

const VOID_OUTPUT_ELEMENTS: Set<string> = new Set<string>(["br", "hr"]);

// HTML void elements never have content, with or without a closing slash.
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

// Allowed elements and the element-specific attributes each may keep.
const ALLOWED_ELEMENTS: Record<string, Array<string>> = {
  a: ["href"],
  abbr: ["title"],
  article: [],
  aside: [],
  b: [],
  blockquote: [],
  br: [],
  caption: [],
  cite: [],
  code: [],
  dd: [],
  del: [],
  dfn: [],
  div: [],
  dl: [],
  dt: [],
  em: [],
  figcaption: [],
  figure: [],
  footer: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  header: [],
  hr: [],
  i: [],
  ins: [],
  kbd: [],
  li: ["value"],
  mark: [],
  ol: ["start", "reversed"],
  p: [],
  pre: [],
  q: [],
  s: [],
  samp: [],
  section: [],
  small: [],
  span: [],
  strong: [],
  sub: [],
  sup: [],
  table: [],
  tbody: [],
  td: ["colspan", "rowspan"],
  tfoot: [],
  th: ["colspan", "rowspan", "scope"],
  thead: [],
  tr: [],
  u: [],
  ul: [],
  var: [],
};

const MAX_DEPTH: number = 48;
const MAX_CLASSES: number = 8;
const CLASS_TOKEN_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const ID_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
const SECTION_ID_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LANG_PATTERN: RegExp = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/;
const INTEGER_PATTERN: RegExp = /^[0-9]{1,4}$/;
const SCHEME_PATTERN: RegExp = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const SCOPE_VALUES: Set<string> = new Set<string>([
  "row",
  "col",
  "rowgroup",
  "colgroup",
]);

export const isValidSectionId: (sectionId: string) => boolean = (
  sectionId: string,
): boolean => {
  return SECTION_ID_PATTERN.test(sectionId);
};

/*
 * The id an element with `id` inside section `sectionId` is given on the
 * page. The reader uses the same function (via data-book-anchor) to find the
 * page a link points at.
 */
export const bookAnchorId: (sectionId: string, id: string) => string | null = (
  sectionId: string,
  id: string,
): string | null => {
  const trimmed: string = id.trim();

  if (!ID_PATTERN.test(trimmed) || !isValidSectionId(sectionId)) {
    return null;
  }

  return `bk-${sectionId}--${trimmed.replace(/[.:]/g, "-")}`;
};

const bookClassNames: (value: string) => string = (value: string): string => {
  const classes: Array<string> = [];

  for (const token of value.split(/\s+/)) {
    if (CLASS_TOKEN_PATTERN.test(token)) {
      const className: string = `bk-${token.toLowerCase()}`;

      if (!classes.includes(className)) {
        classes.push(className);
      }
    }

    if (classes.length >= MAX_CLASSES) {
      break;
    }
  }

  return classes.join(" ");
};

/*
 * Browsers ignore ASCII whitespace and control characters inside a URL
 * scheme ("java\tscript:"), so they are removed before the scheme is read.
 */
const schemeOf: (href: string) => string | null = (
  href: string,
): string | null => {
  // eslint-disable-next-line no-control-regex
  const compact: string = href.replace(/[\u0000-\u0020\u007f]/g, "");
  const match: RegExpExecArray | null = SCHEME_PATTERN.exec(compact);
  return match ? match[1]!.toLowerCase() : null;
};

export const safeExternalHref: (href: string) => string | null = (
  href: string,
): string | null => {
  const scheme: string | null = schemeOf(href);

  if (scheme !== "http" && scheme !== "https" && scheme !== "mailto") {
    return null;
  }

  try {
    const url: URL = new URL(href.trim());

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:" &&
      url.protocol !== "mailto:"
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

export const resolveBookLink: (
  href: string,
  options: BookHtmlOptions,
) => ResolvedBookLink | null = (
  href: string,
  options: BookHtmlOptions,
): ResolvedBookLink | null => {
  const trimmed: string = href.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("#")) {
    return {
      kind: "internal",
      sectionId: options.sectionId,
      fragment: trimmed.slice(1) || undefined,
    };
  }

  if (schemeOf(trimmed) !== null || trimmed.startsWith("//")) {
    const external: string | null = safeExternalHref(trimmed);
    return external ? { kind: "external", href: external } : null;
  }

  return options.resolveRelativeLink
    ? options.resolveRelativeLink(trimmed)
    : null;
};

interface OpenElement {
  // The element name in the source document.
  sourceName: string;
  // The element name written to the output, or null when it was unwrapped.
  outputName: string | null;
}

const buildAttributes: (
  name: string,
  attributes: Record<string, string>,
  options: BookHtmlOptions,
) => { outputName: string; html: string } = (
  name: string,
  attributes: Record<string, string>,
  options: BookHtmlOptions,
): { outputName: string; html: string } => {
  const output: Array<[string, string]> = [];
  let outputName: string = name;

  if (attributes["class"]) {
    const classes: string = bookClassNames(attributes["class"]);

    if (classes) {
      output.push(["class", classes]);
    }
  }

  if (attributes["id"]) {
    const id: string | null = bookAnchorId(options.sectionId, attributes["id"]);

    if (id) {
      output.push(["id", id]);
    }
  }

  const lang: string | undefined = attributes["lang"] || attributes["xml:lang"];

  if (lang && LANG_PATTERN.test(lang)) {
    output.push(["lang", lang]);
  }

  for (const attribute of ALLOWED_ELEMENTS[name] || []) {
    const value: string | undefined = attributes[attribute];

    if (value === undefined || attribute === "href") {
      continue;
    }

    if (
      (attribute === "colspan" ||
        attribute === "rowspan" ||
        attribute === "start" ||
        attribute === "value") &&
      INTEGER_PATTERN.test(value.trim())
    ) {
      output.push([attribute, String(parseInt(value.trim(), 10))]);
    } else if (attribute === "scope" && SCOPE_VALUES.has(value.trim())) {
      output.push([attribute, value.trim()]);
    } else if (attribute === "reversed") {
      output.push([attribute, "reversed"]);
    } else if (attribute === "title") {
      output.push([attribute, value.slice(0, 200)]);
    }
  }

  if (name === "a") {
    const link: ResolvedBookLink | null = attributes["href"]
      ? resolveBookLink(attributes["href"], options)
      : null;

    if (!link) {
      // A link that goes nowhere safe keeps its text and loses its behaviour.
      outputName = "span";
    } else if (link.kind === "external") {
      output.push(["href", link.href]);
      output.push(["rel", "noopener noreferrer"]);
      output.push(["target", "_blank"]);
    } else if (isValidSectionId(link.sectionId)) {
      output.push(["href", `#read/${link.sectionId}`]);
      output.push(["data-book-section", link.sectionId]);

      const anchor: string | null = link.fragment
        ? bookAnchorId(link.sectionId, link.fragment)
        : null;

      if (anchor) {
        output.push(["data-book-anchor", anchor]);
      }
    } else {
      outputName = "span";
    }
  }

  const html: string = output
    .map(([attribute, value]: [string, string]): string => {
      return ` ${attribute}="${escapeHtml(value)}"`;
    })
    .join("");

  return { outputName, html };
};

export const sanitizeBookHtml: (
  markup: string,
  options: BookHtmlOptions,
) => string = (markup: string, options: BookHtmlOptions): string => {
  const tokens: Array<MarkupToken> = tokenizeMarkup(markup);
  const stack: Array<OpenElement> = [];
  let html: string = "";
  let outputDepth: number = 0;

  // While set, tokens are skipped until the matching close tag.
  let dropping: { name: string; depth: number } | null = null;

  for (const token of tokens) {
    if (dropping) {
      if (token.type === "open" && token.name === dropping.name) {
        if (!token.selfClosing) {
          dropping.depth++;
        }
      } else if (token.type === "close" && token.name === dropping.name) {
        dropping.depth--;

        if (dropping.depth === 0) {
          dropping = null;
        }
      }

      continue;
    }

    if (token.type === "text") {
      html += escapeHtml(token.text);
      continue;
    }

    if (token.type === "open") {
      const isHidden: boolean = Object.prototype.hasOwnProperty.call(
        token.attributes,
        "hidden",
      );

      if (DROPPED_WITH_CONTENT.has(token.name) || isHidden) {
        if (!token.selfClosing && !VOID_ELEMENTS.has(token.name)) {
          dropping = { name: token.name, depth: 1 };
        }

        continue;
      }

      const allowed: boolean =
        Object.prototype.hasOwnProperty.call(ALLOWED_ELEMENTS, token.name) &&
        outputDepth < MAX_DEPTH;

      if (VOID_OUTPUT_ELEMENTS.has(token.name)) {
        if (allowed) {
          const attributes: { outputName: string; html: string } =
            buildAttributes(token.name, token.attributes, options);
          html += `<${token.name}${attributes.html}>`;
        }

        continue;
      }

      if (!allowed) {
        // Unknown or too deeply nested: keep the content, lose the element.
        if (!token.selfClosing && !VOID_ELEMENTS.has(token.name)) {
          stack.push({ sourceName: token.name, outputName: null });
        }

        continue;
      }

      const attributes: { outputName: string; html: string } = buildAttributes(
        token.name,
        token.attributes,
        options,
      );

      html += `<${attributes.outputName}${attributes.html}>`;

      if (token.selfClosing) {
        html += `</${attributes.outputName}>`;
      } else {
        stack.push({
          sourceName: token.name,
          outputName: attributes.outputName,
        });
        outputDepth++;
      }

      continue;
    }

    // A close tag: close everything opened since its matching open tag.
    let match: number = -1;

    for (let index: number = stack.length - 1; index >= 0; index--) {
      if (stack[index]!.sourceName === token.name) {
        match = index;
        break;
      }
    }

    if (match < 0) {
      continue;
    }

    while (stack.length > match) {
      const element: OpenElement = stack.pop()!;

      if (element.outputName) {
        html += `</${element.outputName}>`;
        outputDepth--;
      }
    }
  }

  while (stack.length > 0) {
    const element: OpenElement = stack.pop()!;

    if (element.outputName) {
      html += `</${element.outputName}>`;
    }
  }

  return html.trim();
};
