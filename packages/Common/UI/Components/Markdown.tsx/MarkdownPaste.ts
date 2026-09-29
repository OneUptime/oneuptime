/*
 * Clipboard -> markdown for the MarkdownEditor's paste handlers.
 *
 * Markdown is the editor's source of truth, so a paste is turned into
 * markdown first and only then rendered into the visual editor (or inserted
 * into the source textarea). What is on the clipboard decides how:
 *
 *   - text/html -- from Word, Outlook, Google Docs, a web page, or a note
 *     rendered by OneUptime itself -- is cleaned up as a DOM tree: lists are
 *     rebuilt with their nesting, bold / italic / strikethrough are read off
 *     inline styles, links and images are kept only for safe schemes, and
 *     whatever is not content (styles, buttons, icons) is dropped. The editor's
 *     own serializer then writes it out, so the result is markdown the editor
 *     already round-trips;
 *   - plain text is taken as markdown, as it always was, once the bullet
 *     characters other apps write ("•", "◦", Word's "o" and "§" before a
 *     tab) have become markdown list items at the right depth.
 *
 * Clipboard HTML is never assigned to innerHTML: Chromium runs an <img>'s
 * onerror handler for markup parsed into a detached element. It is parsed
 * with DOMParser, whose document is inert -- nothing in it loads or runs --
 * and nothing from it reaches the page except the markdown written here.
 */

import { domToMarkdown } from "./MarkdownConverters";
import {
  TAB_ONLY_BULLET_GLYPHS,
  TEXT_BULLET_GLYPHS,
} from "./MarkdownListEditing";

// What the paste handlers read from a ClipboardEvent's DataTransfer.
export interface PastedClipboard {
  getData: (format: string) => string;
  types?: ReadonlyArray<string> | undefined;
}

export interface ClipboardToMarkdownOptions {
  /*
   * Whether the caller has image files from this paste that it can upload.
   * Defaults to whether the clipboard lists any files at all.
   */
  hasImageFiles?: boolean | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Plain text
 * ---------------------------------------------------------------------------
 */

const RE_GLYPH_BULLET_LINE: RegExp = new RegExp(
  `^([ \\t]*)(?:([${TEXT_BULLET_GLYPHS}])|([${TAB_ONLY_BULLET_GLYPHS}])(?=\\t))[ \\t\\u00a0]+(.*)$`,
);
const RE_PAREN_NUMBER_LINE: RegExp = /^([ \t]*)(\d{1,9})\)[ \t]+(.*)$/;
const RE_TEXT_FENCE: RegExp = /^[ \t]*(`{3,}|~{3,})/;
const RE_LINE_BREAKS: RegExp = /\r\n?/g;

// A tab advances to the next multiple of four columns, as in CommonMark.
const TAB_WIDTH: number = 4;

const indentColumns: (whitespace: string) => number = (
  whitespace: string,
): number => {
  let column: number = 0;
  for (const ch of whitespace) {
    column += ch === "\t" ? TAB_WIDTH - (column % TAB_WIDTH) : 1;
  }
  return column;
};

/*
 * Word writes a nested bullet's level only through its character -- "•",
 * then "o", then "§" -- with no indentation in its plain text. These are
 * the depths those characters (and the second and third level bullets of
 * Slack and Google Docs) stand for when no indentation says otherwise.
 */
const GLYPH_DEPTH: { [glyph: string]: number } = {
  o: 1,
  "◦": 1,
  "○": 1,
  "§": 2,
  "\uF0A7": 2,
  "▪": 2,
  "■": 2,
};

interface BulletLine {
  index: number;
  indent: number;
  glyph: string;
  text: string;
}

/*
 * Turns the bullet characters other apps put in their plain text into
 * markdown list items, nested by their indentation -- or, for Word, which
 * does not indent its plain text, by which of its bullet characters a line
 * uses. "1) step" becomes "1. step", the only ordered form the editor's
 * parser reads. Lines inside a fenced code block are left alone, and so is
 * text with no such line at all, so prose like "price • quality" or an
 * ordinary markdown document comes back exactly as it went in.
 */
export const normalizePlainTextListMarkers: (text: string) => string = (
  text: string,
): string => {
  const lines: Array<string> = text.replace(RE_LINE_BREAKS, "\n").split("\n");
  const bullets: Array<BulletLine> = [];
  let found: boolean = false;
  let fence: string | null = null;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index] || "";
    const fenceMatch: RegExpMatchArray | null = line.match(RE_TEXT_FENCE);
    if (fence !== null) {
      if (fenceMatch && (fenceMatch[1] || "").charAt(0) === fence.charAt(0)) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1] || "```";
      continue;
    }
    const bullet: RegExpMatchArray | null = line.match(RE_GLYPH_BULLET_LINE);
    if (bullet) {
      found = true;
      bullets.push({
        index,
        indent: indentColumns(bullet[1] || ""),
        glyph: bullet[2] || bullet[3] || "",
        text: bullet[4] || "",
      });
      continue;
    }
    const numbered: RegExpMatchArray | null = line.match(RE_PAREN_NUMBER_LINE);
    if (numbered) {
      found = true;
      lines[index] =
        `${numbered[1] || ""}${numbered[2] || ""}. ${numbered[3] || ""}`;
    }
  }

  if (!found) {
    return text;
  }

  const indented: boolean = bullets.some((bullet: BulletLine): boolean => {
    return bullet.indent > 0;
  });

  /*
   * Depth by indentation: each distinct indent deeper than the one above
   * opens a level, and a shallower one closes levels back down to it. A
   * paragraph between two bullets ends the list, so the next bullet starts
   * again at the top.
   */
  const open: Array<number> = [];
  let depth: number = 0;
  let previousIndex: number = -2;
  for (const bullet of bullets) {
    const gap: Array<string> = lines.slice(previousIndex + 1, bullet.index);
    const listInterrupted: boolean =
      previousIndex < 0 ||
      gap.some((line: string): boolean => {
        return line.trim().length > 0;
      });
    if (listInterrupted) {
      open.length = 0;
      depth = 0;
    }

    if (indented) {
      while (
        open.length > 0 &&
        (open[open.length - 1] as number) > bullet.indent
      ) {
        open.pop();
      }
      if (
        open.length === 0 ||
        (open[open.length - 1] as number) < bullet.indent
      ) {
        open.push(bullet.indent);
      }
      depth = open.length - 1;
    } else {
      const wanted: number = GLYPH_DEPTH[bullet.glyph] ?? 0;
      // A level can only open one deeper than the item above it.
      depth = listInterrupted ? 0 : Math.min(wanted, depth + 1);
    }

    lines[bullet.index] = `${"  ".repeat(depth)}- ${bullet.text}`;
    previousIndex = bullet.index;
  }

  return lines.join("\n");
};

/*
 * ---------------------------------------------------------------------------
 * HTML
 * ---------------------------------------------------------------------------
 */

// Never content: dropped with everything inside them.
const NON_CONTENT_SELECTOR: string = [
  "script",
  "style",
  "meta",
  "link",
  "title",
  "template",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "canvas",
  "audio",
  "video",
  "source",
  "track",
  "svg",
  "math",
  "button",
  "select",
  "textarea",
  "datalist",
  "dialog",
  "xml",
  /*
   * MarkdownViewer marks the parts of its output that are chrome rather than
   * the document -- a code block's language label and Copy button.
   */
  "[data-markdown-ignore]",
].join(", ");

const BLOCK_TAGS: Set<string> = new Set<string>([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "br",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

// Formatting the serializer writes as markdown, and that is noise when empty.
const INLINE_FORMATTING_SELECTOR: string =
  "strong, b, em, i, s, del, strike, u, sub, sup";

/*
 * What makes clipboard HTML worth converting rather than taking the plain
 * text beside it: structure or formatting that the plain text loses.
 */
const RICH_CONTENT_SELECTOR: string = [
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "table",
  "hr",
  "img",
  "a[href]",
  "strong",
  "b",
  "em",
  "i",
  "s",
  "del",
  "strike",
  "u",
  "sub",
  "sup",
  "code",
].join(", ");

const LINK_SCHEMES: Array<string> = ["http", "https", "mailto", "tel"];
const IMAGE_SCHEMES: Array<string> = ["http", "https"];

const RE_URL_SCHEME: RegExp = /^([a-z][a-z0-9+.-]*):/i;
const RE_WHITESPACE_RUN: RegExp = /[ \t\n\r\f]+/g;
const RE_NBSP: RegExp = /\u00a0/g;
// Docusaurus writes a zero-width space as its heading permalink's only text.
const RE_ZERO_WIDTH: RegExp = /[\u200b-\u200d\u2060\ufeff]/g;
const RE_NOT_WHITESPACE: RegExp = /\S/;
const RE_LEADING_SPACE: RegExp = /^\s+/;
const RE_TRAILING_SPACE: RegExp = /\s+$/;
const RE_URL_BREAKING: RegExp = /[\s()]/g;
const RE_SESSION_RETRY: RegExp = /([?&])sessionRetry=[^&#]*(&?)/;
const RE_WORD_LIST_STYLE: RegExp = /mso-list:\s*l\d+\s+level(\d+)/i;
const RE_WORD_ORDERED_MARKER: RegExp = /^\(?[0-9a-zA-Z]{1,5}[.)]/;
const RE_WORD_MARKER_SPAN: RegExp = /mso-list:\s*ignore/i;
const RE_HIDDEN_STYLE: RegExp = /mso-hide:\s*all/i;
const RE_LANGUAGE: RegExp = /^[\w-]+$/;
const RE_VIEWER_TIMESTAMP: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const RE_DOCS_GUID: RegExp = /^docs-internal-guid/;

const tagOf: (node: Node | null | undefined) => string = (
  node: Node | null | undefined,
): string => {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  return (node as Element).localName.toLowerCase();
};

const isBlock: (node: Node | null | undefined) => boolean = (
  node: Node | null | undefined,
): boolean => {
  return BLOCK_TAGS.has(tagOf(node));
};

const isList: (node: Node | null | undefined) => boolean = (
  node: Node | null | undefined,
): boolean => {
  const tag: string = tagOf(node);
  return tag === "ul" || tag === "ol";
};

// Replaces an element with its children.
const unwrap: (element: Element) => void = (element: Element): void => {
  const parent: ParentNode | null = element.parentNode;
  if (!parent) {
    return;
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  element.remove();
};

const elementsOf: (root: ParentNode, selector: string) => Array<HTMLElement> = (
  root: ParentNode,
  selector: string,
): Array<HTMLElement> => {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
};

const commentsOf: (root: Node) => Array<Comment> = (
  root: Node,
): Array<Comment> => {
  const comments: Array<Comment> = [];
  const walk: (node: Node) => void = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        comments.push(child as Comment);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(root);
  return comments;
};

const textNodesOf: (root: Node) => Array<Text> = (root: Node): Array<Text> => {
  const texts: Array<Text> = [];
  const walk: (node: Node) => void = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        texts.push(child as Text);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(root);
  return texts;
};

const isBoldWeight: (weight: string) => boolean = (weight: string): boolean => {
  if (weight === "bold" || weight === "bolder") {
    return true;
  }
  const numeric: number = parseInt(weight, 10);
  return !isNaN(numeric) && numeric >= 600;
};

const isNormalWeight: (weight: string) => boolean = (
  weight: string,
): boolean => {
  if (weight === "normal" || weight === "lighter") {
    return true;
  }
  const numeric: number = parseInt(weight, 10);
  return !isNaN(numeric) && numeric < 600;
};

/*
 * ---- 1. Things that are not content ---------------------------------------
 */

const removeNonContent: (body: HTMLElement) => void = (
  body: HTMLElement,
): void => {
  for (const element of elementsOf(body, NON_CONTENT_SELECTOR)) {
    element.remove();
  }
  // A task list's checkbox is content; every other form control is not.
  for (const input of elementsOf(body, "input")) {
    if ((input.getAttribute("type") || "").toLowerCase() !== "checkbox") {
      input.remove();
    }
  }
  for (const element of elementsOf(body, "[style]")) {
    const style: string = element.getAttribute("style") || "";
    if (element.style.display === "none" || RE_HIDDEN_STYLE.test(style)) {
      element.remove();
    }
  }
  /*
   * Word ends every paragraph with an <o:p>, empty or holding a &nbsp; for
   * an empty paragraph. Anything else in one is kept as text.
   */
  for (const element of elementsOf(body, "o\\:p")) {
    if (
      RE_NOT_WHITESPACE.test((element.textContent || "").replace(RE_NBSP, ""))
    ) {
      unwrap(element);
    } else {
      element.remove();
    }
  }
};

/*
 * ---- 2. Word's list paragraphs --------------------------------------------
 */

/*
 * Word writes a list as one paragraph per item, each with a
 * "mso-list:l0 level2 lfo1" style and its bullet or number as text between
 * <![if !supportLists]> and <![endif]> (which parse as comments), or in a
 * span styled "mso-list:Ignore". Takes that marker out of the element and
 * returns its text.
 */
const takeWordListMarker: (element: HTMLElement) => string = (
  element: HTMLElement,
): string => {
  let marker: string = "";
  for (const comment of commentsOf(element)) {
    if (comment.data.trim() !== "[if !supportLists]" || !comment.parentNode) {
      continue;
    }
    let node: ChildNode | null = comment.nextSibling;
    while (
      node &&
      !(
        node.nodeType === Node.COMMENT_NODE &&
        (node as Comment).data.trim() === "[endif]"
      )
    ) {
      const next: ChildNode | null = node.nextSibling;
      marker += node.textContent || "";
      node.remove();
      node = next;
    }
    if (node) {
      node.remove();
    }
    comment.remove();
  }
  for (const span of elementsOf(element, "span[style]")) {
    if (
      span.isConnected &&
      RE_WORD_MARKER_SPAN.test(span.getAttribute("style") || "")
    ) {
      marker += span.textContent || "";
      span.remove();
    }
  }
  return marker.replace(RE_NBSP, " ").trim();
};

interface NestedListEntry {
  // 0 for a top-level item.
  depth: number;
  ordered: boolean;
  // The nodes that make up the item.
  content: Array<Node>;
}

/*
 * Builds nested <ul>/<ol> elements out of a flat run of items that each know
 * their depth. An item can only be one level deeper than the one before it;
 * a change between ordered and unordered at the same depth starts a new list
 * there, as it would in markdown.
 */
const buildNestedLists: (
  doc: Document,
  entries: Array<NestedListEntry>,
) => DocumentFragment = (
  doc: Document,
  entries: Array<NestedListEntry>,
): DocumentFragment => {
  const fragment: DocumentFragment = doc.createDocumentFragment();
  const levels: Array<{ list: HTMLElement; lastItem: HTMLElement | null }> = [];
  for (const entry of entries) {
    const depth: number = Math.min(entry.depth, levels.length);
    while (levels.length > depth + 1) {
      levels.pop();
    }
    const tag: string = entry.ordered ? "ol" : "ul";
    const current:
      | { list: HTMLElement; lastItem: HTMLElement | null }
      | undefined = levels[depth];
    if (!current || tagOf(current.list) !== tag) {
      const list: HTMLElement = doc.createElement(tag);
      const parent:
        | { list: HTMLElement; lastItem: HTMLElement | null }
        | undefined = levels[depth - 1];
      if (depth === 0 || !parent) {
        fragment.appendChild(list);
      } else {
        if (!parent.lastItem) {
          parent.lastItem = doc.createElement("li");
          parent.list.appendChild(parent.lastItem);
        }
        parent.lastItem.appendChild(list);
      }
      levels.length = depth;
      levels.push({ list, lastItem: null });
    }
    const level: { list: HTMLElement; lastItem: HTMLElement | null } = levels[
      depth
    ] as { list: HTMLElement; lastItem: HTMLElement | null };
    const item: HTMLElement = doc.createElement("li");
    for (const node of entry.content) {
      item.appendChild(node);
    }
    level.list.appendChild(item);
    level.lastItem = item;
  }
  return fragment;
};

const wordListLevel: (element: Element) => number = (
  element: Element,
): number => {
  if (tagOf(element) !== "p") {
    return 0;
  }
  const match: RegExpMatchArray | null = (
    element.getAttribute("style") || ""
  ).match(RE_WORD_LIST_STYLE);
  return match ? parseInt(match[1] || "1", 10) : 0;
};

// The next element sibling, stepping over whitespace and comments only.
const nextElementOnlyAfterGap: (node: Element) => Element | null = (
  node: Element,
): Element | null => {
  let next: ChildNode | null = node.nextSibling;
  while (next) {
    if (next.nodeType === Node.ELEMENT_NODE) {
      return next as Element;
    }
    if (
      next.nodeType === Node.TEXT_NODE &&
      RE_NOT_WHITESPACE.test((next.textContent || "").replace(RE_NBSP, ""))
    ) {
      return null;
    }
    next = next.nextSibling;
  }
  return null;
};

const rebuildWordListParagraphs: (body: HTMLElement) => void = (
  body: HTMLElement,
): void => {
  const doc: Document = body.ownerDocument;
  for (const paragraph of elementsOf(body, "p[style]")) {
    if (!paragraph.isConnected || wordListLevel(paragraph) === 0) {
      continue;
    }
    const run: Array<HTMLElement> = [paragraph];
    let next: Element | null = nextElementOnlyAfterGap(paragraph);
    while (next && wordListLevel(next) > 0) {
      run.push(next as HTMLElement);
      next = nextElementOnlyAfterGap(next);
    }
    const entries: Array<NestedListEntry> = run.map(
      (item: HTMLElement): NestedListEntry => {
        const marker: string = takeWordListMarker(item);
        return {
          depth: wordListLevel(item) - 1,
          ordered: RE_WORD_ORDERED_MARKER.test(marker.replace(/\s+/g, "")),
          content: Array.from(item.childNodes),
        };
      },
    );
    const first: HTMLElement = run[0] as HTMLElement;
    first.parentNode?.insertBefore(buildNestedLists(doc, entries), first);
    run.forEach((item: HTMLElement, position: number): void => {
      // The whitespace between two of the paragraphs goes with them.
      let gap: ChildNode | null = position > 0 ? item.previousSibling : null;
      while (gap && gap.nodeType !== Node.ELEMENT_NODE) {
        const before: ChildNode | null = gap.previousSibling;
        gap.remove();
        gap = before;
      }
      item.remove();
    });
  }
  // Markers Word left anywhere else (a list written as <li>s, say).
  for (const element of elementsOf(body, "li, p")) {
    if (
      commentsOf(element).length > 0 ||
      element.querySelector("span[style]")
    ) {
      takeWordListMarker(element);
    }
  }
};

/*
 * ---- 3. Formatting written as styles (Google Docs, Word, browsers) --------
 */

const wrapIn: (element: Element, tag: string) => void = (
  element: Element,
  tag: string,
): void => {
  const wrapper: HTMLElement = element.ownerDocument.createElement(tag);
  element.parentNode?.insertBefore(wrapper, element);
  wrapper.appendChild(element);
};

const readStyledFormatting: (body: HTMLElement) => void = (
  body: HTMLElement,
): void => {
  /*
   * Google Docs wraps the whole copy in <b style="font-weight:normal"
   * id="docs-internal-guid-...">. Taken at its tag, the entire paste came
   * out as one bold run with stray "**" lines around it. A <b> or <strong>
   * whose own style says normal weight is not bold either.
   */
  for (const element of elementsOf(body, "b, strong")) {
    if (
      RE_DOCS_GUID.test(element.id) ||
      isNormalWeight(element.style.fontWeight)
    ) {
      unwrap(element);
    }
  }
  /*
   * Docs, and a browser copying part of a styled element, write formatting
   * as span styles rather than tags. Only the three kinds markdown has are
   * read, and only where the text is not already inside that formatting.
   */
  for (const span of elementsOf(body, "span[style], font[style]")) {
    const style: CSSStyleDeclaration = span.style;
    const decoration: string = `${style.textDecorationLine || ""} ${style.textDecoration || ""}`;
    if (
      decoration.includes("line-through") &&
      !span.closest("s, del, strike")
    ) {
      wrapIn(span, "s");
    }
    if (
      (style.fontStyle === "italic" || style.fontStyle === "oblique") &&
      !span.closest("em, i")
    ) {
      wrapIn(span, "em");
    }
    if (
      isBoldWeight(style.fontWeight) &&
      !span.closest("strong, b, h1, h2, h3, h4, h5, h6, th")
    ) {
      wrapIn(span, "strong");
    }
  }
};

/*
 * ---- 4. What MarkdownViewer renders ---------------------------------------
 */

/*
 * The text of a preformatted element, with a line break for each <br> and
 * for each block inside it -- an editor that writes one <div> per line.
 */
const preformattedText: (element: Element) => string = (
  element: Element,
): string => {
  let text: string = "";
  const walk: (node: Node) => void = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += (child as Text).data;
      } else if (tagOf(child) === "br") {
        text += "\n";
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const block: boolean = isBlock(child);
        if (block && text.length > 0 && !text.endsWith("\n")) {
          text += "\n";
        }
        walk(child);
        if (block && !text.endsWith("\n")) {
          text += "\n";
        }
      }
    }
  };
  walk(element);
  return text;
};

const restoreViewerMarkup: (body: HTMLElement) => void = (
  body: HTMLElement,
): void => {
  const doc: Document = body.ownerDocument;
  /*
   * A code block renders as a syntax-highlighted <div> with no <pre> and no
   * language class, so on its own it would paste as highlighted spans of
   * plain text. The viewer marks its root with the language instead.
   */
  for (const block of elementsOf(body, "[data-markdown-code-block]")) {
    if (!block.isConnected) {
      continue;
    }
    const language: string = (block.getAttribute("data-language") || "").trim();
    const source: Element = block.querySelector("code") || block;
    const code: HTMLElement = doc.createElement("code");
    if (language && language !== "text" && RE_LANGUAGE.test(language)) {
      code.className = `language-${language}`;
    }
    code.textContent = preformattedText(source);
    const pre: HTMLElement = doc.createElement("pre");
    pre.appendChild(code);
    block.parentNode?.insertBefore(pre, block);
    block.remove();
  }
  /*
   * A timestamp the viewer localized ("Apr 20, 2026 11:21 AM" for the
   * reader) came from an inline-code ISO timestamp, which is what is put
   * back, so it is localized again for whoever reads the new note.
   */
  for (const time of elementsOf(body, "time[datetime]")) {
    const iso: string = (time.getAttribute("datetime") || "").trim();
    if (RE_VIEWER_TIMESTAMP.test(iso)) {
      const code: HTMLElement = doc.createElement("code");
      code.textContent = iso;
      time.parentNode?.insertBefore(code, time);
      time.remove();
    }
  }
};

/*
 * ---- 5. Links and images ---------------------------------------------------
 */

/*
 * The URL with its scheme checked against `schemes`, or null when it is not
 * allowed. Browsers ignore control characters and whitespace in a scheme
 * ("java\tscript:"), so they are dropped before the check. Scheme-less URLs
 * (relative, or "//host/path") are allowed. Spaces and parentheses are
 * encoded: either one ends a markdown link's URL early.
 */
const safeUrl: (raw: string, schemes: Array<string>) => string | null = (
  raw: string,
  schemes: Array<string>,
): string | null => {
  let url: string = "";
  for (const ch of raw) {
    const code: number = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) {
      url += ch;
    }
  }
  url = url.trim();
  if (!url) {
    return null;
  }
  const scheme: RegExpMatchArray | null = url
    .replace(/\s+/g, "")
    .match(RE_URL_SCHEME);
  if (scheme && !schemes.includes((scheme[1] || "").toLowerCase())) {
    return null;
  }
  return url.replace(RE_URL_BREAKING, (ch: string): string => {
    return encodeURIComponent(ch) === ch
      ? `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
      : encodeURIComponent(ch);
  });
};

/*
 * SessionAwareImage retries a private image with a "sessionRetry" cache
 * buster; a copy of the rendered note carries it along, and it means nothing
 * in the new one.
 */
const withoutSessionRetry: (url: string) => string = (url: string): string => {
  return url.replace(
    RE_SESSION_RETRY,
    (_match: string, separator: string, more: string): string => {
      return more ? separator : "";
    },
  );
};

const sanitizeLinksAndImages: (body: HTMLElement) => void = (
  body: HTMLElement,
): void => {
  for (const link of elementsOf(body, "a[href]")) {
    const href: string | null = safeUrl(
      link.getAttribute("href") || "",
      LINK_SCHEMES,
    );
    if (href === null) {
      unwrap(link);
    } else {
      link.setAttribute("href", href);
    }
  }
  for (const image of elementsOf(body, "img")) {
    const src: string | null = safeUrl(
      withoutSessionRetry(image.getAttribute("src") || ""),
      IMAGE_SCHEMES,
    );
    if (src === null) {
      // data:, blob:, file: and cid: images are not uploaded -- dropped.
      image.remove();
      continue;
    }
    image.setAttribute("src", src);
    image.setAttribute(
      "alt",
      (image.getAttribute("alt") || "").replace(/[[\]\s]+/g, " ").trim(),
    );
    image.removeAttribute("title");
  }
  /*
   * A link left with nothing to read -- the permalink icon GitHub puts
   * beside every heading, a row of social icons, once their <svg>s are gone,
   * or the empty or zero-width-space anchors of GitLab and Docusaurus --
   * would be written out with its URL as its text: every heading copied from
   * a README gained a line of "[https://github.com/...#install](...)". It is
   * not content, so it is unwrapped. Whatever space it held stays, so the
   * words either side of it do not run together. The URLs browsers put on
   * the clipboard are absolute, so the link is known by its emptiness, not
   * by an href starting with "#". This runs after the images are checked,
   * so a link whose only image was dropped goes too.
   */
  for (const link of elementsOf(body, "a[href]")) {
    const text: string = (link.textContent || "")
      .replace(RE_NBSP, "")
      .replace(RE_ZERO_WIDTH, "");
    if (RE_NOT_WHITESPACE.test(text) || link.querySelector("img")) {
      continue;
    }
    for (const node of textNodesOf(link)) {
      node.data = node.data.replace(RE_ZERO_WIDTH, "");
    }
    unwrap(link);
  }
};

/*
 * ---- 6. Lists --------------------------------------------------------------
 */

/*
 * Outlook, and every browser's execCommand("indent"), write a nested list
 * as a <ul> directly inside a <ul> -- invalid, and the serializer, which
 * reads only a list's <li> children, dropped it and everything in it. It is
 * moved into the item before it, as markdown nests it. Anything else loose
 * in a list is wrapped in an item of its own rather than lost.
 */
const repairLists: (body: HTMLElement) => void = (body: HTMLElement): void => {
  const doc: Document = body.ownerDocument;
  for (const list of elementsOf(body, "ul, ol")) {
    let loose: HTMLElement | null = null;
    for (const child of Array.from(list.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        continue;
      }
      if (
        child.nodeType === Node.TEXT_NODE &&
        !RE_NOT_WHITESPACE.test((child.textContent || "").replace(RE_NBSP, ""))
      ) {
        child.remove();
        continue;
      }
      if (tagOf(child) === "li") {
        loose = null;
        continue;
      }
      if (isList(child)) {
        const previous: Element | null = (child as Element)
          .previousElementSibling;
        if (previous && tagOf(previous) === "li") {
          previous.appendChild(child);
          loose = null;
          continue;
        }
      }
      if (!loose) {
        loose = doc.createElement("li");
        list.insertBefore(loose, child);
      }
      loose.appendChild(child);
    }
  }
  /*
   * Google Docs puts each item's text in a <p>, which made every item a
   * separate paragraph -- a blank line inside the item. An item with a
   * single paragraph is tight, so the paragraph goes.
   */
  for (const item of elementsOf(body, "li")) {
    const paragraphs: Array<Element> = Array.from(item.children).filter(
      (child: Element): boolean => {
        return tagOf(child) === "p";
      },
    );
    if (paragraphs.length === 1 && paragraphs[0]) {
      unwrap(paragraphs[0]);
    }
  }
};

/*
 * ---- 7. Whitespace ---------------------------------------------------------
 */

// A sibling that renders as nothing: a comment, or text that is only whitespace.
const rendersNothing: (node: Node) => boolean = (node: Node): boolean => {
  return (
    node.nodeType === Node.COMMENT_NODE ||
    (node.nodeType === Node.TEXT_NODE &&
      !RE_NOT_WHITESPACE.test((node.textContent || "").replace(RE_NBSP, "")))
  );
};

// Whether `node` is the last thing in its block (or comes right before a block or a <br>).
const endsBlock: (node: Node) => boolean = (node: Node): boolean => {
  let current: Node = node;
  for (;;) {
    let next: Node | null = current.nextSibling;
    while (next && rendersNothing(next)) {
      next = next.nextSibling;
    }
    if (next) {
      return isBlock(next);
    }
    const parent: Node | null = current.parentNode;
    if (!parent || isBlock(parent) || parent.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }
    current = parent;
  }
};

/*
 * HTML ignores the line breaks and runs of spaces in its source; markdown
 * does not. Word hard-wraps its HTML ("Service\n     is currently
 * unavailable"), so without this a pasted item came back as two lines.
 * Walking the text in order, a space is dropped where the browser would not
 * show one: at the start or end of a block, beside a <br>, and after a space
 * already written. Text in a <pre> is left exactly as it is.
 */
const collapseWhitespace: (body: HTMLElement) => void = (
  body: HTMLElement,
): void => {
  // Whether the text so far ends in a space, or a block has just begun.
  let atSpace: boolean = true;
  const walk: (node: Node) => void = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text: Text = child as Text;
        let value: string = text.data
          .replace(RE_NBSP, " ")
          .replace(RE_WHITESPACE_RUN, " ");
        if (atSpace && value.startsWith(" ")) {
          value = value.slice(1);
        }
        if (value.endsWith(" ") && endsBlock(text)) {
          value = value.slice(0, -1);
        }
        if (value.length === 0) {
          text.remove();
          continue;
        }
        text.data = value;
        atSpace = value.endsWith(" ");
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      const tag: string = tagOf(child);
      if (tag === "pre") {
        atSpace = true;
      } else if (isBlock(child)) {
        atSpace = true;
        walk(child);
        atSpace = true;
      } else if (tag === "img" || tag === "input") {
        atSpace = false;
      } else {
        walk(child);
      }
    }
  };
  walk(body);
};

/*
 * "**bold **text" is not bold in CommonMark -- a closing "**" after a space
 * does not close anything -- so whitespace at either edge of a formatting
 * element moves outside it. A formatting element with no text at all would
 * come out as "****" and is replaced by the whitespace it held, if any.
 * Runs before the whitespace is collapsed, which tidies what this moves.
 */
const tidyInlineFormatting: (body: HTMLElement) => void = (
  body: HTMLElement,
): void => {
  const doc: Document = body.ownerDocument;
  for (const element of elementsOf(
    body,
    INLINE_FORMATTING_SELECTOR,
  ).reverse()) {
    const parent: ParentNode | null = element.parentNode;
    if (!parent) {
      continue;
    }
    const content: string = element.textContent || "";
    if (!RE_NOT_WHITESPACE.test(content) && !element.querySelector("img, br")) {
      if (content) {
        parent.insertBefore(doc.createTextNode(" "), element);
      }
      element.remove();
      continue;
    }
    const texts: Array<Text> = textNodesOf(element);
    const first: Text | undefined = texts[0];
    const last: Text | undefined = texts[texts.length - 1];
    if (first && RE_LEADING_SPACE.test(first.data)) {
      first.data = first.data.replace(RE_LEADING_SPACE, "");
      parent.insertBefore(doc.createTextNode(" "), element);
    }
    if (last && RE_TRAILING_SPACE.test(last.data)) {
      last.data = last.data.replace(RE_TRAILING_SPACE, "");
      parent.insertBefore(doc.createTextNode(" "), element.nextSibling);
    }
  }
  body.normalize();
};

/*
 * ---------------------------------------------------------------------------
 * Pipeline
 * ---------------------------------------------------------------------------
 */

/*
 * A <div> that keeps its whitespace ("white-space: pre") is what code
 * editors put on the clipboard -- VS Code writes one such <div> holding a
 * <div> of coloured spans per line. Its plain text is the real content
 * (often markdown source itself), so that is what gets pasted, as before.
 *
 * Only that <div> counts, and not inside a <pre> or a list item. Google Docs
 * puts "white-space:pre" on every list item it copies, and Chromium, Safari
 * and Docs wrap each tab in a <span class="Apple-tab-span"> styled the same
 * way; taken for a code editor's copy, any Docs copy with a list or a tab
 * lost its lists, links and formatting to its plain text -- bare lines.
 */
const isCodeEditorCopy: (body: HTMLElement) => boolean = (
  body: HTMLElement,
): boolean => {
  return elementsOf(body, "div[style]").some(
    (element: HTMLElement): boolean => {
      return element.style.whiteSpace === "pre" && !element.closest("pre, li");
    },
  );
};

const parseInertly: (html: string) => HTMLElement | null = (
  html: string,
): HTMLElement | null => {
  if (typeof DOMParser === "undefined") {
    return null;
  }
  return new DOMParser().parseFromString(html, "text/html").body;
};

// The clipboard HTML parsed and cleaned, ready for the serializer.
const cleanPastedHtml: (html: string) => HTMLElement | null = (
  html: string,
): HTMLElement | null => {
  if (!html) {
    return null;
  }
  const body: HTMLElement | null = parseInertly(html);
  if (!body) {
    return null;
  }
  removeNonContent(body);
  rebuildWordListParagraphs(body);
  readStyledFormatting(body);
  restoreViewerMarkup(body);
  sanitizeLinksAndImages(body);
  repairLists(body);
  tidyInlineFormatting(body);
  collapseWhitespace(body);
  return body;
};

const hasRichContent: (body: HTMLElement) => boolean = (
  body: HTMLElement,
): boolean => {
  return (
    body.querySelector(RICH_CONTENT_SELECTOR) !== null &&
    !isCodeEditorCopy(body)
  );
};

const hasText: (body: HTMLElement) => boolean = (
  body: HTMLElement,
): boolean => {
  return RE_NOT_WHITESPACE.test(body.textContent || "");
};

/*
 * Whether clipboard HTML carries structure or formatting its plain text
 * loses -- lists, headings, links, emphasis, tables, code, images -- and so
 * is worth converting. A plain paragraph is not: its plain text says the
 * same, and is what the editor has always pasted.
 */
export const isRichClipboardHtml: (html: string) => boolean = (
  html: string,
): boolean => {
  const body: HTMLElement | null = cleanPastedHtml(html);
  return body !== null && hasRichContent(body);
};

// Clipboard HTML as the markdown the editor writes.
export const pastedHtmlToMarkdown: (html: string) => string = (
  html: string,
): string => {
  const body: HTMLElement | null = cleanPastedHtml(html);
  return body ? domToMarkdown(body) : "";
};

const readClipboard: (clipboard: PastedClipboard, format: string) => string = (
  clipboard: PastedClipboard,
  format: string,
): string => {
  try {
    return clipboard.getData(format) || "";
  } catch {
    return "";
  }
};

// Whether a DataTransfer's `types` (an array, or a DOMStringList in older browsers) lists `format`.
const listsType: (
  types: ReadonlyArray<string> | undefined,
  format: string,
) => boolean = (
  types: ReadonlyArray<string> | undefined,
  format: string,
): boolean => {
  if (!types) {
    return false;
  }
  for (let i: number = 0; i < types.length; i++) {
    if (types[i] === format) {
      return true;
    }
  }
  return false;
};

const RE_STARTS_WITH_SPACE: RegExp = /^[ \t]/;
const RE_ENDS_WITH_SPACE: RegExp = /[ \t]$/;

/*
 * A few words copied out of a line ("very " with its space) are pasted into
 * the middle of another, where the space between them and the next word
 * matters -- but as HTML the space sits at the edge of the document, where
 * it is trimmed like any block's. When the converted text is a single line,
 * the spaces at the plain text's edges are put back.
 */
const withEdgeSpacesOf: (plain: string, markdown: string) => string = (
  plain: string,
  markdown: string,
): string => {
  if (!markdown || markdown.includes("\n")) {
    return markdown;
  }
  const leading: string = RE_STARTS_WITH_SPACE.test(plain) ? " " : "";
  const trailing: string = RE_ENDS_WITH_SPACE.test(plain) ? " " : "";
  return `${leading}${markdown}${trailing}`;
};

/*
 * The markdown to paste, or null to leave the paste to the caller -- to
 * upload the image files on the clipboard, or to let the browser do what it
 * does natively.
 *
 * Rich HTML with text in it wins, even over image files: Word and Excel put
 * a picture of the copied text on the clipboard beside the text itself.
 * HTML that is nothing but images ("Copy image" in a browser) gives way to
 * the files, since an upload beats a link to someone else's server; so does
 * plain text, which beside a file is its name (a file copied in Finder).
 * Otherwise the plain text is used, with other apps' bullets made markdown.
 */
export const clipboardToMarkdown: (
  clipboard: PastedClipboard,
  options?: ClipboardToMarkdownOptions,
) => string | null = (
  clipboard: PastedClipboard,
  options?: ClipboardToMarkdownOptions,
): string | null => {
  const preferFiles: boolean =
    options?.hasImageFiles ?? listsType(clipboard.types, "Files");
  // Line breaks as a textarea holds them, so a caller can compare the two.
  const plain: string = readClipboard(clipboard, "text/plain").replace(
    RE_LINE_BREAKS,
    "\n",
  );

  const html: string = readClipboard(clipboard, "text/html");
  const body: HTMLElement | null = cleanPastedHtml(html);
  if (body && hasRichContent(body)) {
    const markdown: string = withEdgeSpacesOf(plain, domToMarkdown(body));
    if (hasText(body)) {
      return markdown;
    }
    if (!preferFiles && markdown) {
      return markdown;
    }
  }

  if (preferFiles) {
    return null;
  }

  if (plain) {
    return normalizePlainTextListMarkers(plain);
  }
  if (body && hasText(body)) {
    return domToMarkdown(body);
  }
  return null;
};
