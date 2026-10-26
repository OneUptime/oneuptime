import { replaceHtmlMarkup } from "../../../Types/HtmlMarkup";
import { EMAIL_TRUNCATED_TEXT_NOTE } from "./EmailSize";

/*
 * THE PLAIN-TEXT PART OF AN EMAIL: THE SAME EMAIL, AS TEXT.
 *
 * Every email OneUptime sent was HTML alone. A mail client that shows text
 * - a terminal client, a watch, a mail gateway's preview, a reader who
 * turned HTML off - got nothing to read, and spam filters count an email
 * with no text part against it (SpamAssassin's MIME_HTML_ONLY). Now every
 * email goes out as multipart/alternative over SMTP and SendGrid: this text,
 * and the HTML it is written from, so the two always say the same. (A
 * Microsoft Graph sendMail request takes one body: the HTML, as before.)
 *
 * The text is what a reader reads in the HTML, the way a screen reader says
 * it:
 *
 *   - paragraphs, headings, list items, rows and line breaks on lines of
 *     their own, a blank line between blocks;
 *   - a detail card's label and its value on one line, "Severity: Critical";
 *   - a data table (one with header cells) a row a line, its cells parted by
 *     " | "; a table that only lays the email out, its cells by a space;
 *   - a link's words, then its address in brackets - once, when the words
 *     are the address;
 *   - an image's alt text where the image is, and nothing for one whose alt
 *     is empty (decoration): never an image's own data;
 *   - nothing of what is never shown: the head, styles, scripts, comments
 *     (Outlook's conditional ones say again what the email says for Outlook),
 *     an element styled display:none (the inbox preview line) or marked
 *     hidden, and what aria-hidden hides (the name beside OneUptime's logo,
 *     which its alt text already says). What only Outlook hides
 *     (mso-hide:all) every other client shows, and so does the text;
 *   - character references decoded, every run of spaces one space, and a
 *     <pre> block's spaces and lines as they are.
 *
 * A text longer than MAX_EMAIL_TEXT_PART_LENGTH - far more than an email is
 * read for - is cut at a line and ends with the note a cut email ends with.
 * Read with the walk product code reads markup with (replaceHtmlMarkup),
 * every tag a character at a time, and each element's end found without
 * searching what is open: linear in the HTML, however long or deep - a
 * screenshot's megabytes of base64 in an attribute included.
 */

/*
 * The longest text part, in characters: half a megabyte of reading. Beside
 * the most an email's HTML and images are (MAX_EMAIL_BYTES), an email stays
 * well under the 10 MB a mail server takes by default (EmailSize).
 */
export const MAX_EMAIL_TEXT_PART_LENGTH: number = 512 * 1024;

// What the walk leaves where each tag was: a character no email holds.
const TAG_MARK: string = "\u{0000}";

// Elements whose whole content is never shown.
const NEVER_SHOWN: ReadonlySet<string> = new Set<string>([
  "head",
  "title",
  "style",
  "script",
  "template",
  "noscript",
]);

// Elements a walk hands over whole, start tag to end tag (rawTextElements).
const READ_WHOLE: ReadonlySet<string> = new Set<string>([
  "style",
  "script",
  "iframe",
  "noembed",
  "noframes",
]);

// Elements with no end tag.
const VOID_ELEMENTS: ReadonlySet<string> = new Set<string>([
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
  "source",
  "track",
  "wbr",
]);

// Blocks set apart by a blank line.
const PARAGRAPHS: ReadonlySet<string> = new Set<string>([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "table",
]);

// Blocks that start and end a line of their own.
const LINES: ReadonlySet<string> = new Set<string>([
  "div",
  "tr",
  "li",
  "dt",
  "dd",
  "section",
  "article",
  "header",
  "footer",
  "center",
  "tbody",
  "thead",
  "tfoot",
]);

const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "\u{00B7}",
  copy: "\u{00A9}",
  reg: "\u{00AE}",
  trade: "\u{2122}",
  hellip: "\u{2026}",
  mdash: "\u{2014}",
  ndash: "\u{2013}",
  bull: "\u{2022}",
  rarr: "\u{2192}",
  larr: "\u{2190}",
  lsquo: "\u{2018}",
  rsquo: "\u{2019}",
  ldquo: "\u{201C}",
  rdquo: "\u{201D}",
  laquo: "\u{00AB}",
  raquo: "\u{00BB}",
  times: "\u{00D7}",
  deg: "\u{00B0}",
  zwnj: "\u{200C}",
  zwj: "\u{200D}",
};

// The last code point Unicode has; a reference past it is left as written.
const LAST_CODE_POINT: number = 0x10ffff;

// The longest reference read: "&#x10FFFF;" and the longest name above.
const MAX_REFERENCE_LENGTH: number = 12;

const DECIMAL_DIGITS: RegExp = /^[0-9]+$/;
const HEX_DIGITS: RegExp = /^[0-9a-fA-F]+$/;

// The character a reference stands for, or undefined for none.
const characterOf: (name: string) => string | undefined = (
  name: string,
): string | undefined => {
  if (!name.startsWith("#")) {
    return NAMED_REFERENCES[name.toLowerCase()];
  }

  const isHex: boolean = name.charAt(1).toLowerCase() === "x";
  const digits: string = name.slice(isHex ? 2 : 1);

  if (!(isHex ? HEX_DIGITS : DECIMAL_DIGITS).test(digits)) {
    return undefined;
  }

  const codePoint: number = parseInt(digits, isHex ? 16 : 10);

  return codePoint > 0 && codePoint <= LAST_CODE_POINT
    ? String.fromCodePoint(codePoint)
    : undefined;
};

/*
 * The text with its character references decoded once, as a browser reads
 * a text node: "&amp;lt;" is "&lt;", never "<". Names it does not know, and
 * numbers that are no character, stay as they are written.
 */
export const decodeCharacterReferences: (text: string) => string = (
  text: string,
): string => {
  let decoded: string = "";
  let copiedUpTo: number = 0;
  let at: number = text.indexOf("&");

  while (at !== -1) {
    const end: number = text.indexOf(";", at + 1);

    if (end === -1) {
      break;
    }

    const character: string | undefined =
      end - at <= MAX_REFERENCE_LENGTH
        ? characterOf(text.slice(at + 1, end))
        : undefined;

    if (character === undefined) {
      at = text.indexOf("&", at + 1);
      continue;
    }

    decoded += text.slice(copiedUpTo, at) + character;
    copiedUpTo = end + 1;
    at = text.indexOf("&", copiedUpTo);
  }

  return decoded + text.slice(copiedUpTo);
};

interface StartTag {
  name: string;
  attributes: Map<string, string>;
  isSelfClosing: boolean;
}

const isSpace: (character: string | undefined) => boolean = (
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

const isNameEnd: (character: string | undefined) => boolean = (
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

// The attributes the text reads; every other one is passed over.
const READ_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  "href",
  "alt",
  "style",
  "class",
  "aria-hidden",
  "hidden",
  "start",
]);

/*
 * A detail card's label (Partials/DetailBoxField): its value follows on the
 * same line - "Severity: Critical" - as a text email writes it. A label
 * written without its colon (the status page emails' "Severity") gets one.
 */
const LABEL_CLASS: string = "st-DetailCard-label";

// A label's last character after which it takes a colon: a word's.
const WORD_ENDING: RegExp = /[\p{L}\p{N})\]"'\u{2019}\u{201D}]/u;

// What parts a data table's cells on their line.
const CELL_SEPARATOR: string = "|";

// Whether an element's class attribute names `className`.
const hasClass: (tag: StartTag, className: string) => boolean = (
  tag: StartTag,
  className: string,
): boolean => {
  return (tag.attributes.get("class") || "")
    .split(" ")
    .some((name: string): boolean => {
      return name.trim() === className;
    });
};

/*
 * A start tag: its name and the attributes above, read a character at a
 * time to the first ">" outside a quoted value.
 */
const readStartTag: (markup: string) => StartTag = (
  markup: string,
): StartTag => {
  let index: number = 1;
  let name: string = "";

  while (index < markup.length && !isNameEnd(markup[index])) {
    name += markup[index];
    index++;
  }

  const attributes: Map<string, string> = new Map<string, string>();

  while (index < markup.length && markup[index] !== ">") {
    if (isSpace(markup[index]) || markup[index] === "/") {
      index++;
      continue;
    }

    const nameStart: number = index;

    while (index < markup.length && !isNameEnd(markup[index])) {
      index++;
    }

    const attributeName: string = markup.slice(nameStart, index).toLowerCase();

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
      let valueStart: number = index;
      let valueEnd: number;

      if (quote === '"' || quote === "'") {
        const close: number = markup.indexOf(quote, index + 1);
        valueStart = index + 1;
        valueEnd = close === -1 ? markup.length : close;
        index = valueEnd + 1;
      } else {
        while (
          index < markup.length &&
          !isSpace(markup[index]) &&
          markup[index] !== ">"
        ) {
          index++;
        }

        valueEnd = index;
      }

      if (READ_ATTRIBUTES.has(attributeName)) {
        value = markup.slice(valueStart, valueEnd);
      }
    }

    if (!attributeName) {
      // Nothing a name can start with: step past it.
      index++;
      continue;
    }

    if (READ_ATTRIBUTES.has(attributeName)) {
      attributes.set(attributeName, value);
    }
  }

  return {
    name: name.toLowerCase(),
    attributes: attributes,
    isSelfClosing: markup.endsWith("/>"),
  };
};

// The name of the end tag `markup` is ("</td >" is "td").
const endTagName: (markup: string) => string = (markup: string): string => {
  let index: number = 2;

  while (
    index < markup.length &&
    markup[index] !== ">" &&
    markup[index] !== "/" &&
    !isSpace(markup[index])
  ) {
    index++;
  }

  return markup.slice(2, index).toLowerCase();
};

const CSS_SPACES: RegExp = /\s+/g;

// Whether an element's own attributes or style keep it from being shown.
const isHiddenByItself: (tag: StartTag) => boolean = (
  tag: StartTag,
): boolean => {
  if (tag.attributes.has("hidden")) {
    return true;
  }

  if (
    (tag.attributes.get("aria-hidden") || "").trim().toLowerCase() === "true"
  ) {
    return true;
  }

  const style: string = (tag.attributes.get("style") || "")
    .toLowerCase()
    .replace(CSS_SPACES, "");

  return style.includes("display:none");
};

// A link's address as a reader is told it: web and mail addresses only.
const shownAddress: (href: string) => string | null = (
  href: string,
): string | null => {
  const address: string = decodeCharacterReferences(href.trim());
  const lower: string = address.toLowerCase();

  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return address;
  }

  if (lower.startsWith("mailto:")) {
    return address.slice("mailto:".length);
  }

  return null;
};

interface OpenElement {
  name: string;
  isHidden: boolean;
  isPre: boolean;
  // A list: whether it numbers its items, and the next number.
  isOrderedList: boolean;
  nextItem: number;
  /*
   * A link: its address, and where its words start in the text - the piece
   * and the character.
   */
  address: string | null;
  wordsFromPiece: number;
  wordsFromLength: number;
  // A row: whether a cell of it was written.
  hasCell: boolean;
  // A table: whether it holds data (has header cells), not only layout.
  isDataTable: boolean;
  // A cell of a data table: what is in it stays on the row's line.
  isDataCell: boolean;
  // A detail card's label: its value follows on its line.
  isLabel: boolean;
}

/*
 * The text, built a piece at a time: spaces held until a word shows they
 * part words, and the line breaks between blocks held until there is a
 * line to break.
 */
class TextWriter {
  private pieces: Array<string> = [];
  private writtenLength: number = 0;
  private pendingSpace: boolean = false;
  // Line breaks owed before the next words (1: a new line, 2: a blank line).
  private pendingBreaks: number = 0;
  private isAtLineStart: boolean = true;
  private isEmpty: boolean = true;
  // After a label: the block breaks before its value are a space.
  private isJoining: boolean = false;
  private lastCharacter: string = "";

  // How many pieces there are: where words written next start.
  public get pieceCount(): number {
    return this.pieces.length;
  }

  // How many characters were written.
  public get length(): number {
    return this.writtenLength;
  }

  public text(): string {
    return this.pieces.join("");
  }

  // What was written from piece `from` on.
  public writtenSince(from: number): string {
    return this.pieces.slice(from).join("");
  }

  private push(piece: string): void {
    this.pieces.push(piece);
    this.writtenLength += piece.length;
    this.lastCharacter = piece.charAt(piece.length - 1);
  }

  // A label's words end with a colon, unless they end in one already.
  public endLabel(): void {
    if (WORD_ENDING.test(this.lastCharacter)) {
      this.push(":");
    }
  }

  public breakLine(breaks: number): void {
    if (this.isEmpty || this.isJoining) {
      return;
    }

    this.pendingBreaks = Math.max(this.pendingBreaks, breaks);
    this.pendingSpace = false;
  }

  // A line break written where it is: a <br>.
  public hardBreak(): void {
    if (this.isEmpty) {
      return;
    }

    this.flushBreaks();
    this.push("\n");
    this.isAtLineStart = true;
    this.pendingSpace = false;
  }

  public space(): void {
    if (!this.isAtLineStart) {
      this.pendingSpace = true;
    }
  }

  // What is written next goes on this line, after a space: a label's value.
  public joinNextBlock(): void {
    this.pendingBreaks = 0;
    this.isJoining = true;
    this.space();
  }

  public write(words: string): void {
    if (!words) {
      return;
    }

    this.flushBreaks();

    if (this.pendingSpace && !this.isAtLineStart) {
      this.push(" ");
    }

    this.pendingSpace = false;
    this.push(words);
    this.isEmpty = false;
    this.isJoining = false;
    this.isAtLineStart = words.endsWith("\n");
  }

  private flushBreaks(): void {
    if (this.pendingBreaks > 0 && !this.isEmpty) {
      this.push("\n".repeat(this.pendingBreaks));
      this.isAtLineStart = true;
      this.pendingSpace = false;
    }

    this.pendingBreaks = 0;
  }
}

const WHITESPACE_RUN: RegExp = /[ \t\n\r\f]+/g;

/*
 * Text as a reader sees it: a run of spaces, tabs and line breaks is one
 * space, and the writer places the spaces at its ends.
 */
const writeCollapsed: (writer: TextWriter, text: string) => void = (
  writer: TextWriter,
  text: string,
): void => {
  const collapsed: string = text.replace(WHITESPACE_RUN, " ");

  if (collapsed.startsWith(" ")) {
    writer.space();
  }

  const words: string = collapsed.trim();

  if (words) {
    writer.write(words);

    if (collapsed.endsWith(" ")) {
      writer.space();
    }
  }
};

const TRAILING_SPACES: RegExp = /[ \t]+$/;

/*
 * The finished text: no spaces at the end of a line, at most one blank line
 * in a row, and none at either end.
 */
const tidy: (text: string) => string = (text: string): string => {
  const kept: Array<string> = [];
  let blankLines: number = 0;

  for (const line of text.split("\n")) {
    const trimmed: string = line.replace(TRAILING_SPACES, "");

    if (trimmed === "") {
      blankLines++;

      if (blankLines > 1) {
        continue;
      }
    } else {
      blankLines = 0;
    }

    kept.push(trimmed);
  }

  return kept.join("\n").trim();
};

/*
 * A text longer than `maxLength`, cut at the last line break in its second
 * half (or at the length) and ending with the note a cut email ends with.
 */
const cutToLength: (text: string, maxLength: number) => string = (
  text: string,
  maxLength: number,
): string => {
  if (text.length <= maxLength) {
    return text;
  }

  const room: number = Math.max(
    0,
    maxLength - EMAIL_TRUNCATED_TEXT_NOTE.length - 2,
  );
  const lineBreak: number = text.lastIndexOf("\n", room);
  const cut: number = lineBreak > room / 2 ? lineBreak : room;

  return text.slice(0, cut).trimEnd() + "\n\n" + EMAIL_TRUNCATED_TEXT_NOTE;
};

export default class EmailPlainText {
  // The plain-text part of the email whose HTML is `html` (see the top).
  public static fromHtml(
    html: string | null | undefined,
    maxLength: number = MAX_EMAIL_TEXT_PART_LENGTH,
  ): string {
    if (!html) {
      return "";
    }

    const tags: Array<string> = [];
    const texts: Array<string> = replaceHtmlMarkup(
      html,
      (markup: string): string => {
        tags.push(markup);
        return TAG_MARK;
      },
      { rawTextElements: true },
    ).split(TAG_MARK);

    const writer: TextWriter = new TextWriter();
    // What is open, outermost first, and how many of each name.
    const open: Array<OpenElement> = [];
    const openNames: Map<string, number> = new Map<string, number>();
    /*
     * The open tables, rows and lists, innermost last: a cell's table and
     * row, an item's list.
     */
    const tables: Array<OpenElement> = [];
    const rows: Array<OpenElement> = [];
    const lists: Array<OpenElement> = [];
    // How many data table cells are open: inside one, blocks part no lines.
    let dataCellsOpen: number = 0;

    const isHidden: () => boolean = (): boolean => {
      return open.length > 0 && open[open.length - 1]!.isHidden;
    };

    const isPre: () => boolean = (): boolean => {
      return open.length > 0 && open[open.length - 1]!.isPre;
    };

    // A block starts or ends: a line of its own, or a space in a data cell.
    const breakLine: (breaks: number) => void = (breaks: number): void => {
      if (dataCellsOpen > 0) {
        writer.space();
      } else {
        writer.breakLine(breaks);
      }
    };

    const popIfLast: (
      stack: Array<OpenElement>,
      element: OpenElement,
    ) => void = (stack: Array<OpenElement>, element: OpenElement): void => {
      if (stack.length > 0 && stack[stack.length - 1] === element) {
        stack.pop();
      }
    };

    // An element ends: what it leaves after itself.
    const closeLast: () => void = (): void => {
      const element: OpenElement = open.pop()!;

      openNames.set(element.name, (openNames.get(element.name) || 1) - 1);

      popIfLast(tables, element);
      popIfLast(rows, element);
      popIfLast(lists, element);

      if (element.isDataCell) {
        dataCellsOpen--;
      }

      if (element.isHidden) {
        return;
      }

      if (element.name === "a" && element.address) {
        /*
         * Its words are read back only when they are about as long as the
         * address, the only words that can be it: a link around a whole
         * table of links is never read back again for each of them.
         */
        const wordsLength: number = writer.length - element.wordsFromLength;
        const words: string | null =
          wordsLength <= element.address.length + 2
            ? writer.writtenSince(element.wordsFromPiece).trim()
            : null;

        if (words !== element.address) {
          writer.space();
          writer.write(
            words === "" ? element.address : "(" + element.address + ")",
          );
        }
      }

      if (element.isLabel) {
        if (writer.length > element.wordsFromLength) {
          writer.endLabel();
        }

        writer.joinNextBlock();
      } else if (PARAGRAPHS.has(element.name)) {
        breakLine(2);
      } else if (LINES.has(element.name)) {
        breakLine(1);
      }
    };

    for (let index: number = 0; index < texts.length; index++) {
      const text: string = texts[index]!;

      if (text && !isHidden()) {
        if (isPre()) {
          writer.write(decodeCharacterReferences(text));
        } else {
          writeCollapsed(writer, decodeCharacterReferences(text));
        }
      }

      const markup: string | undefined = tags[index];

      if (markup === undefined || markup.startsWith("<!")) {
        // The end, a comment, a conditional comment or a doctype.
        continue;
      }

      if (markup.startsWith("</")) {
        const name: string = endTagName(markup);

        // An end tag with nothing of its name open ends nothing.
        if ((openNames.get(name) || 0) === 0) {
          continue;
        }

        // It ends every element left open inside it, and itself.
        for (;;) {
          const isTheOne: boolean = open[open.length - 1]!.name === name;

          closeLast();

          if (isTheOne) {
            break;
          }
        }

        continue;
      }

      const tag: StartTag = readStartTag(markup);

      if (!tag.name || READ_WHOLE.has(tag.name)) {
        continue;
      }

      const hidden: boolean =
        isHidden() || NEVER_SHOWN.has(tag.name) || isHiddenByItself(tag);

      // Header cells: the table holds data, a row a line.
      if ((tag.name === "th" || tag.name === "thead") && tables.length > 0) {
        tables[tables.length - 1]!.isDataTable = true;
      }

      const isDataCell: boolean =
        !hidden &&
        (tag.name === "td" || tag.name === "th") &&
        tables.length > 0 &&
        tables[tables.length - 1]!.isDataTable;

      if (!hidden) {
        if (tag.name === "br") {
          if (dataCellsOpen > 0) {
            writer.space();
          } else {
            writer.hardBreak();
          }

          continue;
        }

        if (tag.name === "hr") {
          breakLine(2);
          writer.write("---");
          breakLine(2);
          continue;
        }

        if (tag.name === "img") {
          const alt: string = decodeCharacterReferences(
            tag.attributes.get("alt") || "",
          )
            .replace(WHITESPACE_RUN, " ")
            .trim();

          writer.write(alt);
          continue;
        }

        if (hasClass(tag, LABEL_CLASS)) {
          // A detail card's rows are lines, label and value on each.
          breakLine(1);
        } else if (PARAGRAPHS.has(tag.name)) {
          breakLine(2);
        } else if (LINES.has(tag.name)) {
          breakLine(1);
        }

        if (tag.name === "td" || tag.name === "th") {
          const row: OpenElement | undefined = rows[rows.length - 1];

          if (row?.hasCell) {
            writer.space();

            if (isDataCell) {
              writer.write(CELL_SEPARATOR);
              writer.space();
            }
          }

          if (row) {
            row.hasCell = true;
          }
        }

        if (tag.name === "li") {
          const list: OpenElement | undefined = lists[lists.length - 1];

          if (list?.isOrderedList) {
            writer.write(String(list.nextItem) + ". ");
            list.nextItem++;
          } else {
            writer.write("- ");
          }
        }
      }

      if (VOID_ELEMENTS.has(tag.name) || tag.isSelfClosing) {
        continue;
      }

      const start: number = parseInt(tag.attributes.get("start") || "1", 10);
      const element: OpenElement = {
        name: tag.name,
        isHidden: hidden,
        isPre: !hidden && (tag.name === "pre" || isPre()),
        isOrderedList: tag.name === "ol",
        nextItem: isNaN(start) ? 1 : start,
        address:
          tag.name === "a"
            ? shownAddress(tag.attributes.get("href") || "")
            : null,
        wordsFromPiece: writer.pieceCount,
        wordsFromLength: writer.length,
        hasCell: false,
        isDataTable: false,
        isDataCell: isDataCell,
        isLabel: !hidden && hasClass(tag, LABEL_CLASS),
      };

      open.push(element);
      openNames.set(tag.name, (openNames.get(tag.name) || 0) + 1);

      if (isDataCell) {
        dataCellsOpen++;
      }

      if (tag.name === "table") {
        tables.push(element);
      }

      if (tag.name === "tr") {
        rows.push(element);
      }

      if (tag.name === "ul" || tag.name === "ol") {
        lists.push(element);
      }
    }

    while (open.length > 0) {
      closeLast();
    }

    return cutToLength(tidy(writer.text()), maxLength);
  }
}
