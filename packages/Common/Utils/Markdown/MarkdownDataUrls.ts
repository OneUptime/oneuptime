import {
  InlineImageDataUri,
  parseInlineImageDataUri,
} from "./InlineImageDataUri";

/*
 * WHERE A MARKDOWN TEXT USES A data: URL.
 *
 * A synthetic monitor's screenshot reaches an incident's or an alert's
 * description as an image that carries itself (see InlineImageDataUri):
 *
 *   ![Login page](data:image/png;base64,iVBORw0KGgo...)
 *
 * The dashboard and the emails show it. Slack and Microsoft Teams cannot
 * show a data: URL at all - Slack's Markdown conversion turns the image into
 * a link to it, <data:image/png;base64,...|Login page>, and a screenshot is
 * 30 KB to 2 MB of base64 - so before the same Markdown goes to a chat, every
 * image, link, autolink and link reference definition whose address is a
 * data: URL has to be found, and found exactly where a Markdown renderer
 * finds it:
 *
 *   - never in code. ![x](data:...) in a code span or a code block is code
 *     somebody wrote, and it stays byte for byte as it was written;
 *   - by reference too: ![Login page][login], ![login][] and ![login] take
 *     their address from a "[login]: data:..." definition anywhere in the
 *     text, which is how a template keeps the base64 out of the way.
 *
 * So the text is read the way CommonMark reads it, in its two passes. The
 * block structure first - block quotes, lists, fenced and indented code, HTML
 * blocks, headings, thematic breaks, GitHub's tables and link reference
 * definitions, with the specification's rules for which lines continue,
 * interrupt or lazily continue which block - then the inline content of every
 * paragraph, heading and table cell: backslash escapes, code spans, autolinks
 * and raw HTML, then links and images, their brackets matched as the
 * specification matches them. Emphasis, entities and the rest of Markdown
 * change nothing about where an image or a code span is, and are not read.
 *
 * Each use is reported with where it is in the text, the plain text of its
 * alt text or link text, and where the top-level block it is in ends - where
 * a chat message can show the image, after the text it was part of - and, in
 * a top-level paragraph, the line it is on.
 *
 * LINEAR IN THE LENGTH OF THE TEXT. A screenshot is megabytes, and the text
 * is anybody's who may write a description. Every scan goes forward, and
 * every look ahead that a later one could repeat - for a closing backtick
 * string, a title's closing quote, the end of an HTML comment - is
 * remembered, so no part of the text is read more than a few times, whatever
 * it holds.
 *
 * Pure, with no Node or browser APIs.
 */

export enum DataUrlUseKind {
  // ![alt](data:...), or ![alt][label] by a definition.
  Image = "Image",
  // [text](data:...), or [text][label] by a definition.
  Link = "Link",
  // <data:...>
  Autolink = "Autolink",
  // [label]: data:...
  Definition = "Definition",
}

// The line of a top-level paragraph a use starts on.
export interface ParagraphLine {
  // The line's first character that is not a space or a tab.
  start: number;
  // Where the line ends, before its line ending.
  end: number;
  // Where the paragraph's line before ends, or null on its first line.
  previousLineEnd: number | null;
  /*
   * Where the paragraph's next line starts (its first character that is not
   * a space or a tab), or null on its last line.
   */
  nextLineStart: number | null;
  /*
   * Whether that next line, read where a text starts, would start something
   * other than a paragraph: a list, a quote, a heading, a code block, HTML,
   * a thematic break, or a table row. In the paragraph it is only text.
   */
  nextLineStartsBlock: boolean;
}

export interface DataUrlUse {
  kind: DataUrlUseKind;
  // Where the whole construct is in the text: from its "!" or "[" or "<" ...
  start: number;
  // ... to just after its ")" or "]" or ">", or a definition's line.
  end: number;
  // The address, as Markdown reads it (backslash escapes undone).
  url: string;
  // The image the address carries, when it is an inline raster image.
  image: InlineImageDataUri | null;
  /*
   * An image's alt text or a link's text, as plain text: code spans as their
   * code, nested images and links as their own text, escapes undone, and
   * white space collapsed. Empty for an autolink or a definition.
   */
  text: string;
  /*
   * Where the top-level block the use is in ends: the end of that block's
   * last line, before its line ending.
   */
  topLevelBlockEnd: number;
  // The line it starts on, when it is in a paragraph at the top level.
  paragraphLine: ParagraphLine | null;
}

// A link reference definition whose address is not a data: URL.
export interface LinkDefinition {
  // Where it is: from its "[" to the end of its last line.
  start: number;
  end: number;
  // Its label, as written between the brackets.
  label: string;
  // Its destination, as written (in angle brackets when it was).
  destination: string;
}

export interface MarkdownDataUrlUses {
  // Every use, in the order they start; one may be inside another.
  uses: Array<DataUrlUse>;
  /*
   * The text's other link reference definitions, in order, for a renderer
   * that reads parts of the text on their own and needs them to resolve
   * references.
   */
  linkDefinitions: Array<LinkDefinition>;
}

// The longest plain text kept for an alt text or a link's text.
export const MAX_DATA_URL_USE_TEXT_LENGTH: number = 2000;

const DATA_SCHEME_PATTERN: RegExp = /^data:/i;

const DATA_SCHEME_ANYWHERE_PATTERN: RegExp = /data:/i;

/*
 * CHARACTERS.
 */

const CHAR_TAB: number = 0x09;
const CHAR_LINE_FEED: number = 0x0a;
const CHAR_CARRIAGE_RETURN: number = 0x0d;
const CHAR_SPACE: number = 0x20;
const CHAR_EXCLAMATION_MARK: number = 0x21;
const CHAR_QUOTATION_MARK: number = 0x22;
const CHAR_APOSTROPHE: number = 0x27;
const CHAR_LEFT_PARENTHESIS: number = 0x28;
const CHAR_RIGHT_PARENTHESIS: number = 0x29;
const CHAR_SLASH: number = 0x2f;
const CHAR_COLON: number = 0x3a;
const CHAR_LESS_THAN: number = 0x3c;
const CHAR_EQUALS: number = 0x3d;
const CHAR_GREATER_THAN: number = 0x3e;
const CHAR_QUESTION_MARK: number = 0x3f;
const CHAR_LEFT_BRACKET: number = 0x5b;
const CHAR_BACKSLASH: number = 0x5c;
const CHAR_RIGHT_BRACKET: number = 0x5d;
const CHAR_BACKTICK: number = 0x60;
const CHAR_PIPE: number = 0x7c;
const CHAR_TILDE: number = 0x7e;
const CHAR_DELETE: number = 0x7f;

// Tab stops are four columns apart, and code is indented four columns.
const TAB_STOP: number = 4;
const CODE_INDENT: number = 4;

// CommonMark's limits on a link label and on parentheses in a destination.
const MAX_LINK_LABEL_LENGTH: number = 999;
const MAX_DESTINATION_PARENTHESIS_DEPTH: number = 32;

type CharacterTestFunction = (code: number) => boolean;

const isSpaceOrTab: CharacterTestFunction = (code: number): boolean => {
  return code === CHAR_SPACE || code === CHAR_TAB;
};

const isLineEnding: CharacterTestFunction = (code: number): boolean => {
  return code === CHAR_LINE_FEED || code === CHAR_CARRIAGE_RETURN;
};

const isWhitespace: CharacterTestFunction = (code: number): boolean => {
  return isSpaceOrTab(code) || isLineEnding(code);
};

const isAsciiPunctuation: CharacterTestFunction = (code: number): boolean => {
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
};

const isAsciiLetter: CharacterTestFunction = (code: number): boolean => {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
};

const isAsciiDigit: CharacterTestFunction = (code: number): boolean => {
  return code >= 0x30 && code <= 0x39;
};

const isAsciiAlphanumeric: CharacterTestFunction = (code: number): boolean => {
  return isAsciiLetter(code) || isAsciiDigit(code);
};

type IsDataUrlFunction = (url: string) => boolean;

// Whether an address is a data: URL, whatever it carries.
export const isDataUrl: IsDataUrlFunction = (url: string): boolean => {
  return DATA_SCHEME_PATTERN.test(url);
};

type UnescapeFunction = (text: string) => string;

/*
 * Text with its backslash escapes undone: a backslash before ASCII
 * punctuation stands for that character.
 */
const unescapeBackslashes: UnescapeFunction = (text: string): string => {
  if (text.indexOf("\\") === -1) {
    return text;
  }

  let result: string = "";
  let index: number = 0;

  while (index < text.length) {
    const code: number = text.charCodeAt(index);

    if (
      code === CHAR_BACKSLASH &&
      index + 1 < text.length &&
      isAsciiPunctuation(text.charCodeAt(index + 1))
    ) {
      result += text[index + 1];
      index += 2;
      continue;
    }

    result += text[index];
    index++;
  }

  return result;
};

type NormalizeLabelFunction = (label: string) => string;

/*
 * A link label as CommonMark matches it: case folded, without the white
 * space around it, and with white space inside collapsed to one space.
 */
const normalizeLabel: NormalizeLabelFunction = (label: string): string => {
  return label
    .replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "")
    .replace(/[ \t\r\n]+/g, " ")
    .toLowerCase()
    .toUpperCase();
};

/*
 * LINES.
 */

interface SourceLine {
  start: number;
  // Before the line ending.
  end: number;
}

type SplitLinesFunction = (source: string) => Array<SourceLine>;

// The text's lines; "\r\n", "\r" and "\n" each end one, as in CommonMark.
const splitLines: SplitLinesFunction = (source: string): Array<SourceLine> => {
  const lines: Array<SourceLine> = [];
  const lineEndingPattern: RegExp = /\r\n?|\n/g;
  let start: number = 0;

  for (
    let match: RegExpExecArray | null = lineEndingPattern.exec(source);
    match !== null;
    match = lineEndingPattern.exec(source)
  ) {
    lines.push({ start: start, end: match.index });
    start = match.index + match[0].length;
  }

  lines.push({ start: start, end: source.length });

  return lines;
};

/*
 * LOOKING AHEAD WITHOUT LOOKING TWICE.
 *
 * Where the next occurrence of a string is, from a position that only moves
 * forward between calls - the inline scan's position. The answer for one
 * position holds for every later one up to it, so each part of the text is
 * searched once.
 */
class ForwardSearch {
  private searchedFrom: number = -1;
  private found: number = -1;

  public constructor(
    private readonly text: string,
    private readonly needle: string,
  ) {}

  public next(from: number): number {
    if (
      this.searchedFrom >= 0 &&
      from >= this.searchedFrom &&
      (this.found === -1 || from <= this.found)
    ) {
      return this.found;
    }

    this.searchedFrom = from;
    this.found = this.text.indexOf(this.needle, from);

    return this.found;
  }
}

/*
 * RAW HTML.
 *
 * An HTML tag, comment, processing instruction, declaration or CDATA
 * section, as CommonMark recognizes one: in inline content, where it hides
 * the brackets and backticks inside it, and at the start of a line, where a
 * complete tag alone on its line starts an HTML block.
 */
class HtmlMatcher {
  private readonly commentEnd: ForwardSearch;
  private readonly instructionEnd: ForwardSearch;
  private readonly declarationEnd: ForwardSearch;
  private readonly cdataEnd: ForwardSearch;

  /*
   * Where an attribute value's closing quote is, by where its opening quote
   * is. Two opening quotes of the same kind never search the same text.
   */
  private readonly closingQuotes: Map<number, number> = new Map<
    number,
    number
  >();

  public constructor(
    private readonly text: string,
    // Where the text the matcher may read ends.
    private readonly limit: number,
  ) {
    this.commentEnd = new ForwardSearch(text, "-->");
    this.instructionEnd = new ForwardSearch(text, "?>");
    this.declarationEnd = new ForwardSearch(text, ">");
    this.cdataEnd = new ForwardSearch(text, "]]>");
  }

  // Where the raw HTML starting at this "<" ends, or -1 when it is not any.
  public match(position: number): number {
    const next: number = this.code(position + 1);

    if (isAsciiLetter(next)) {
      return this.matchOpenTag(position);
    }

    if (next === CHAR_SLASH) {
      return this.matchClosingTag(position);
    }

    if (next === CHAR_QUESTION_MARK) {
      return this.within(this.instructionEnd.next(position + 2), 2);
    }

    if (next !== CHAR_EXCLAMATION_MARK) {
      return -1;
    }

    if (this.text.startsWith("<!--", position)) {
      if (this.text.startsWith("<!-->", position)) {
        return this.within(position + 4, 1);
      }

      if (this.text.startsWith("<!--->", position)) {
        return this.within(position + 5, 1);
      }

      return this.within(this.commentEnd.next(position + 4), 3);
    }

    if (this.text.startsWith("<![CDATA[", position)) {
      return this.within(this.cdataEnd.next(position + 9), 3);
    }

    if (isAsciiLetter(this.code(position + 2))) {
      return this.within(this.declarationEnd.next(position + 2), 1);
    }

    return -1;
  }

  // An open tag: "<", a tag name, attributes, "/" maybe, then ">".
  public matchOpenTag(position: number): number {
    let index: number = this.skipTagName(position + 1);

    if (index === position + 1) {
      return -1;
    }

    for (;;) {
      const afterWhitespace: number = this.skipWhitespace(index);

      if (
        afterWhitespace === index ||
        !this.isAttributeNameStart(this.code(afterWhitespace))
      ) {
        index = afterWhitespace;
        break;
      }

      index = this.skipAttributeName(afterWhitespace);

      const beforeEquals: number = this.skipWhitespace(index);

      if (this.code(beforeEquals) !== CHAR_EQUALS) {
        continue;
      }

      const valueStart: number = this.skipWhitespace(beforeEquals + 1);
      const valueEnd: number = this.skipAttributeValue(valueStart);

      if (valueEnd === -1) {
        return -1;
      }

      index = valueEnd;
    }

    if (this.code(index) === CHAR_SLASH) {
      index++;
    }

    return this.code(index) === CHAR_GREATER_THAN ? index + 1 : -1;
  }

  // A closing tag: "</", a tag name, white space maybe, then ">".
  public matchClosingTag(position: number): number {
    const nameEnd: number = this.skipTagName(position + 2);

    if (nameEnd === position + 2) {
      return -1;
    }

    const index: number = this.skipWhitespace(nameEnd);

    return this.code(index) === CHAR_GREATER_THAN ? index + 1 : -1;
  }

  // The tag name that starts here, if it is one: its end.
  public tagNameEnd(position: number): number {
    return this.skipTagName(position);
  }

  private code(position: number): number {
    return position < this.limit ? this.text.charCodeAt(position) : -1;
  }

  // The end of a terminator found at `found`, when it is inside the limit.
  private within(found: number, length: number): number {
    return found >= 0 && found + length <= this.limit ? found + length : -1;
  }

  private skipTagName(position: number): number {
    if (!isAsciiLetter(this.code(position))) {
      return position;
    }

    let index: number = position + 1;

    while (
      isAsciiAlphanumeric(this.code(index)) ||
      this.code(index) === 0x2d // -
    ) {
      index++;
    }

    return index;
  }

  private isAttributeNameStart(code: number): boolean {
    return isAsciiLetter(code) || code === 0x5f /* _ */ || code === CHAR_COLON;
  }

  private skipAttributeName(position: number): number {
    let index: number = position + 1;

    for (;;) {
      const code: number = this.code(index);

      if (
        isAsciiAlphanumeric(code) ||
        code === 0x5f || // _
        code === 0x2e || // .
        code === CHAR_COLON ||
        code === 0x2d // -
      ) {
        index++;
        continue;
      }

      return index;
    }
  }

  private skipAttributeValue(position: number): number {
    const quote: number = this.code(position);

    if (quote === CHAR_QUOTATION_MARK || quote === CHAR_APOSTROPHE) {
      let closing: number | undefined = this.closingQuotes.get(position);

      if (closing === undefined) {
        closing = this.text.indexOf(String.fromCharCode(quote), position + 1);
        this.closingQuotes.set(position, closing);
      }

      return closing >= 0 && closing < this.limit ? closing + 1 : -1;
    }

    let index: number = position;

    for (;;) {
      const code: number = this.code(index);

      if (
        code === -1 ||
        isWhitespace(code) ||
        code === CHAR_QUOTATION_MARK ||
        code === CHAR_APOSTROPHE ||
        code === CHAR_EQUALS ||
        code === CHAR_LESS_THAN ||
        code === CHAR_GREATER_THAN ||
        code === CHAR_BACKTICK
      ) {
        break;
      }

      index++;
    }

    return index > position ? index : -1;
  }

  private skipWhitespace(position: number): number {
    let index: number = position;

    while (isWhitespace(this.code(index))) {
      index++;
    }

    return index;
  }
}

/*
 * BLOCKS.
 */

enum BlockKind {
  Document = "Document",
  BlockQuote = "BlockQuote",
  List = "List",
  Item = "Item",
  Paragraph = "Paragraph",
  Heading = "Heading",
  FencedCode = "FencedCode",
  IndentedCode = "IndentedCode",
  HtmlBlock = "HtmlBlock",
  ThematicBreak = "ThematicBreak",
  Table = "Table",
}

interface ListMarker {
  isOrdered: boolean;
  // A bullet ("-", "+" or "*"), or the "." or ")" after an ordered number.
  character: string;
  markerOffset: number;
  padding: number;
}

// One block at the top of the text, shared by everything inside it.
interface TopLevelBlock {
  // The end of its last line that is not blank.
  end: number;
}

// A line of a paragraph, a heading or a table, or a table's cell.
interface ContentLine {
  start: number;
  end: number;
}

class Block {
  public isOpen: boolean = true;
  public lastChild: Block | null = null;
  public childCount: number = 0;
  public listMarker: ListMarker | null = null;
  public fenceCharacter: number = 0;
  public fenceLength: number = 0;
  public htmlBlockType: number = 0;
  public lines: Array<ContentLine> = [];
  public isFirstChildOfItem: boolean = false;
  public areDefinitionsRead: boolean = false;

  public constructor(
    public kind: BlockKind,
    public readonly parent: Block | null,
    public readonly topLevel: TopLevelBlock,
  ) {}
}

// Text whose inline content is read: a paragraph, a heading, a table cell.
interface InlineLeaf {
  lines: Array<ContentLine>;
  topLevel: TopLevelBlock;
  isTopLevelParagraph: boolean;
  // A GitHub task list item's "[ ]" or "[x]" starts the text: not a link.
  startsWithTaskMarker: boolean;
}

interface Definition {
  label: string;
  destination: string;
  url: string;
}

const ATX_HEADING_PATTERN: RegExp = /#{1,6}(?=[ \t]|$|[\r\n])/y;
const SETEXT_UNDERLINE_PATTERN: RegExp = /(?:=+|-+)[ \t]*(?=$|[\r\n])/y;
const BULLET_MARKER_PATTERN: RegExp = /[*+-]/y;
const ORDERED_MARKER_PATTERN: RegExp = /(\d{1,9})([.)])/y;
const BLANK_REST_PATTERN: RegExp = /[ \t]*(?=$|[\r\n])/y;

const HTML_BLOCK_START_PATTERNS: Array<RegExp | null> = [
  null,
  /<(?:script|pre|textarea|style)(?=[ \t>]|$|[\r\n])/iy,
  /<!--/y,
  /<\?/y,
  /<![A-Za-z]/y,
  /<!\[CDATA\[/y,
  /<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[ \t]|\/?>|$|[\r\n])/iy,
];

const HTML_BLOCK_END_PATTERNS: Array<RegExp | null> = [
  null,
  /<\/(?:script|pre|textarea|style)>/i,
  /-->/,
  /\?>/,
  />/,
  /\]\]>/,
];

// Raw HTML that a type 7 HTML block may not start with.
const HTML_BLOCK_RAW_TEXT_TAG_PATTERN: RegExp =
  /^(?:script|style|pre|textarea)$/i;

// A table's delimiter row: cells of hyphens, maybe with a colon either side.
const TABLE_DELIMITER_CELL_PATTERN: RegExp = /^[ \t]*:?-+:?[ \t]*$/;

const CHAR_ASTERISK: number = 0x2a;
const CHAR_HYPHEN: number = 0x2d;
const CHAR_UNDERSCORE: number = 0x5f;

// The run of white space and one of "*", "-" or "_" that ends a line.
interface ThematicTail {
  // Where it starts.
  start: number;
  // Its marker character, or 0 when the line ends in none.
  character: number;
}

type GetThematicTailFunction = (
  source: string,
  lineStart: number,
  lineEnd: number,
) => ThematicTail;

/*
 * A thematic break is three or more of one of "*", "-" or "_", with nothing
 * but spaces and tabs between them, up to the end of the line - so it can
 * only start in the part of a line that is made of one such character and
 * white space. Found once per line, from its end: a line of nested list
 * markers ("- - - - ...") is checked at each of them.
 */
const getThematicTail: GetThematicTailFunction = (
  source: string,
  lineStart: number,
  lineEnd: number,
): ThematicTail => {
  let start: number = lineEnd;
  let character: number = 0;

  while (start > lineStart) {
    const code: number = source.charCodeAt(start - 1);

    if (isSpaceOrTab(code) || (character !== 0 && code === character)) {
      start--;
      continue;
    }

    if (
      character === 0 &&
      (code === CHAR_ASTERISK ||
        code === CHAR_HYPHEN ||
        code === CHAR_UNDERSCORE)
    ) {
      character = code;
      start--;
      continue;
    }

    break;
  }

  return { start: start, character: character };
};

type IsThematicBreakFunction = (
  source: string,
  position: number,
  lineEnd: number,
  tail: ThematicTail,
) => boolean;

// Whether a thematic break starts at this position of its line.
const isThematicBreakAt: IsThematicBreakFunction = (
  source: string,
  position: number,
  lineEnd: number,
  tail: ThematicTail,
): boolean => {
  const code: number = position < lineEnd ? source.charCodeAt(position) : -1;

  if (code !== tail.character || position < tail.start) {
    return false;
  }

  let markers: number = 0;

  for (let index: number = position; index < lineEnd && markers < 3; index++) {
    if (source.charCodeAt(index) === code) {
      markers++;
    }
  }

  return markers >= 3;
};

type MatchAtFunction = (
  pattern: RegExp,
  source: string,
  position: number,
) => RegExpExecArray | null;

// The pattern matched at exactly this position (it must be sticky).
const matchAt: MatchAtFunction = (
  pattern: RegExp,
  source: string,
  position: number,
): RegExpExecArray | null => {
  pattern.lastIndex = position;
  return pattern.exec(source);
};

type SplitTableRowFunction = (
  source: string,
  start: number,
  end: number,
) => Array<ContentLine>;

/*
 * A table row's cells, at every "|" that is not escaped (inside a code span
 * too, as in GitHub's tables), each without the white space around it. The
 * pipes at either end of the row only mark it.
 */
const splitTableRow: SplitTableRowFunction = (
  source: string,
  start: number,
  end: number,
): Array<ContentLine> => {
  const cells: Array<ContentLine> = [];
  let cellStart: number = start;
  let index: number = start;

  while (index < end) {
    const code: number = source.charCodeAt(index);

    if (code === CHAR_BACKSLASH) {
      index += 2;
      continue;
    }

    if (code === CHAR_PIPE) {
      cells.push({ start: cellStart, end: index });
      cellStart = index + 1;
    }

    index++;
  }

  cells.push({ start: cellStart, end: end });

  const trimmed: Array<ContentLine> = cells.map(
    (cell: ContentLine): ContentLine => {
      let cellStartTrimmed: number = cell.start;
      let cellEndTrimmed: number = Math.min(cell.end, end);

      while (
        cellStartTrimmed < cellEndTrimmed &&
        isSpaceOrTab(source.charCodeAt(cellStartTrimmed))
      ) {
        cellStartTrimmed++;
      }

      while (
        cellEndTrimmed > cellStartTrimmed &&
        isSpaceOrTab(source.charCodeAt(cellEndTrimmed - 1))
      ) {
        cellEndTrimmed--;
      }

      return { start: cellStartTrimmed, end: cellEndTrimmed };
    },
  );

  // The pipes that open and close the row leave an empty cell outside them.
  if (trimmed.length > 1 && trimmed[0]!.start === trimmed[0]!.end) {
    trimmed.shift();
  }

  if (
    trimmed.length > 1 &&
    trimmed[trimmed.length - 1]!.start === trimmed[trimmed.length - 1]!.end
  ) {
    trimmed.pop();
  }

  return trimmed;
};

/*
 * The block structure of a text, as CommonMark builds it line by line (the
 * reference implementation's algorithm): which open blocks a line continues,
 * which new blocks it starts, and whether it lazily continues a paragraph.
 * What it keeps is what the inline pass needs: the content of every
 * paragraph, heading and table cell, the link reference definitions, and
 * where each top-level block ends.
 */
class BlockParser {
  public readonly leaves: Array<InlineLeaf> = [];
  public readonly definitions: Map<string, Definition> = new Map<
    string,
    Definition
  >();
  public readonly dataDefinitions: Array<{
    start: number;
    end: number;
    url: string;
    topLevel: TopLevelBlock;
  }> = [];
  public readonly otherDefinitions: Array<LinkDefinition> = [];

  private readonly document: Block;
  private tip: Block;
  private oldTip: Block;
  private lastMatchedContainer: Block;
  private allClosed: boolean = true;
  /*
   * Whether the line goes on a paragraph it could interrupt, or follows an
   * indented code block. Every list item that starts on it then counts as
   * interrupting, nested ones included, as micromark (the dashboard's and
   * Slack's parser) reads it: it must not be empty, and an ordered one must
   * start at 1.
   */
  private interruptsParagraph: boolean = false;

  private line: SourceLine = { start: 0, end: 0 };
  private offset: number = 0;
  private column: number = 0;
  private nextNonspace: number = 0;
  private nextNonspaceColumn: number = 0;
  private indent: number = 0;
  private indented: boolean = false;
  private blank: boolean = false;
  private partiallyConsumedTab: boolean = false;
  private thematicTail: ThematicTail | null = null;

  public constructor(private readonly source: string) {
    this.document = new Block(BlockKind.Document, null, { end: 0 });
    this.tip = this.document;
    this.oldTip = this.document;
    this.lastMatchedContainer = this.document;
  }

  public parse(): void {
    for (const line of splitLines(this.source)) {
      this.incorporateLine(line);
    }

    while (this.tip !== this.document) {
      this.finalize(this.tip);
    }
  }

  private incorporateLine(line: SourceLine): void {
    this.line = line;
    this.offset = line.start;
    this.column = 0;
    this.blank = false;
    this.partiallyConsumedTab = false;
    this.thematicTail = null;
    this.oldTip = this.tip;

    let container: Block = this.document;

    // Which open blocks does the line continue?
    for (
      let lastChild: Block | null = container.lastChild;
      lastChild && lastChild.isOpen;
      lastChild = container.lastChild
    ) {
      container = lastChild;
      this.findNextNonspace();

      const result: number = this.continueBlock(container);

      if (result === 1) {
        container = container.parent!;
        break;
      }

      if (result === 2) {
        // A closing fence: the line is the code block's, and done.
        this.markLineInTopLevel(container);
        return;
      }
    }

    this.allClosed = container === this.oldTip;
    this.lastMatchedContainer = container;
    this.interruptsParagraph =
      container.kind === BlockKind.Paragraph ||
      this.oldTip.kind === BlockKind.IndentedCode;

    let matchedLeaf: boolean =
      container.kind === BlockKind.FencedCode ||
      container.kind === BlockKind.IndentedCode ||
      container.kind === BlockKind.HtmlBlock;

    // Does it start new blocks?
    while (!matchedLeaf) {
      this.findNextNonspace();

      if (!this.indented && !this.mayStartBlock(this.nextNonspace)) {
        this.advanceNextNonspace();
        break;
      }

      const result: number = this.tryBlockStarts(container);

      if (result === 0) {
        this.advanceNextNonspace();
        break;
      }

      container = this.tip;

      if (result === 2) {
        matchedLeaf = true;
      }
    }

    // What is left of the line is text.
    if (
      !this.allClosed &&
      !this.blank &&
      this.tip.kind === BlockKind.Paragraph
    ) {
      // A lazy continuation of the paragraph.
      this.addLine(this.tip);
    } else {
      this.closeUnmatchedBlocks();

      const kind: BlockKind = container.kind;

      if (kind === BlockKind.Paragraph && this.becomesTable(container)) {
        // The line was the table's delimiter row.
      } else if (
        kind === BlockKind.Paragraph ||
        kind === BlockKind.Table ||
        kind === BlockKind.FencedCode ||
        kind === BlockKind.IndentedCode ||
        kind === BlockKind.HtmlBlock
      ) {
        this.addLine(container);

        if (
          kind === BlockKind.HtmlBlock &&
          container.htmlBlockType >= 1 &&
          container.htmlBlockType <= 5 &&
          HTML_BLOCK_END_PATTERNS[container.htmlBlockType]!.test(
            this.source.slice(this.offset, this.line.end),
          )
        ) {
          this.markLineInTopLevel(container);
          this.finalize(container);
          return;
        }
      } else if (this.offset < this.line.end && !this.blank) {
        container = this.addChild(BlockKind.Paragraph);
        this.advanceNextNonspace();
        this.addLine(container);
      }
    }

    this.markLineInTopLevel(this.tip);
  }

  // A line that is not blank ends, for now, the top-level block it is in.
  private markLineInTopLevel(block: Block): void {
    if (block === this.document) {
      return;
    }

    if (!matchAt(BLANK_REST_PATTERN, this.source, this.line.start)) {
      block.topLevel.end = this.line.end;
    }
  }

  // 0: the line continues the block; 1: it does not; 2: it closed it.
  private continueBlock(block: Block): number {
    switch (block.kind) {
      case BlockKind.BlockQuote:
        if (
          !this.indented &&
          this.peek(this.nextNonspace) === CHAR_GREATER_THAN
        ) {
          this.advanceNextNonspace();
          this.advanceOffset(1, false);

          if (isSpaceOrTab(this.peek(this.offset))) {
            this.advanceOffset(1, true);
          }

          return 0;
        }

        return 1;
      case BlockKind.Item: {
        const marker: ListMarker = block.listMarker!;

        if (this.blank) {
          if (block.childCount === 0) {
            // A list item can start with at most one blank line.
            return 1;
          }

          this.advanceNextNonspace();
        } else if (this.indent >= marker.markerOffset + marker.padding) {
          this.advanceOffset(marker.markerOffset + marker.padding, true);
        } else {
          return 1;
        }

        return 0;
      }
      case BlockKind.List:
        return 0;
      case BlockKind.FencedCode:
        if (
          this.indent <= 3 &&
          this.peek(this.nextNonspace) === block.fenceCharacter &&
          this.closesFence(block)
        ) {
          this.finalize(block);
          return 2;
        }

        return 0;
      case BlockKind.IndentedCode:
        if (this.indent >= CODE_INDENT) {
          this.advanceOffset(CODE_INDENT, true);
        } else if (this.blank) {
          this.advanceNextNonspace();
        } else {
          return 1;
        }

        return 0;
      case BlockKind.HtmlBlock:
        return this.blank &&
          (block.htmlBlockType === 6 || block.htmlBlockType === 7)
          ? 1
          : 0;
      case BlockKind.Paragraph:
      case BlockKind.Table:
        return this.blank ? 1 : 0;
      default:
        // Headings and thematic breaks are one line long.
        return 1;
    }
  }

  // Whether the line (from its first non-space character) closes the fence.
  private closesFence(block: Block): boolean {
    let index: number = this.nextNonspace;

    while (
      index < this.line.end &&
      this.source.charCodeAt(index) === block.fenceCharacter
    ) {
      index++;
    }

    return (
      index - this.nextNonspace >= block.fenceLength &&
      matchAt(BLANK_REST_PATTERN, this.source, index) !== null
    );
  }

  // 0: nothing starts here; 1: a container started; 2: a leaf started.
  private tryBlockStarts(container: Block): number {
    const position: number = this.nextNonspace;
    const code: number = this.peek(position);

    // A block quote.
    if (!this.indented && code === CHAR_GREATER_THAN) {
      this.advanceNextNonspace();
      this.advanceOffset(1, false);

      if (isSpaceOrTab(this.peek(this.offset))) {
        this.advanceOffset(1, true);
      }

      this.closeUnmatchedBlocks();
      this.addChild(BlockKind.BlockQuote);
      return 1;
    }

    // An ATX heading.
    if (!this.indented && matchAt(ATX_HEADING_PATTERN, this.source, position)) {
      this.closeUnmatchedBlocks();

      const heading: Block = this.addChild(BlockKind.Heading);

      heading.lines.push(this.getHeadingContent(position));
      this.offset = this.line.end;
      return 2;
    }

    // A fenced code block.
    if (!this.indented) {
      const fenceLength: number = this.getOpeningFenceLength(position);

      if (fenceLength > 0) {
        this.closeUnmatchedBlocks();

        const fence: Block = this.addChild(BlockKind.FencedCode);

        fence.fenceCharacter = code;
        fence.fenceLength = fenceLength;
        this.offset = this.line.end;
        return 2;
      }
    }

    // An HTML block.
    if (!this.indented && code === CHAR_LESS_THAN) {
      const htmlBlockType: number = this.getHtmlBlockStart(position, container);

      if (
        htmlBlockType === 7 &&
        !this.allClosed &&
        this.tip.kind === BlockKind.Paragraph
      ) {
        /*
         * A complete tag on a line that would lazily continue a paragraph:
         * micromark ends the paragraph there and starts the HTML block in
         * its place, inside the blocks the line did not continue, which
         * stay open.
         */
        this.finalize(this.tip);
        this.allClosed = true;

        const html: Block = this.addChild(BlockKind.HtmlBlock);

        html.htmlBlockType = htmlBlockType;
        return 2;
      }

      if (htmlBlockType > 0) {
        this.closeUnmatchedBlocks();

        const html: Block = this.addChild(BlockKind.HtmlBlock);

        html.htmlBlockType = htmlBlockType;
        return 2;
      }
    }

    // A setext heading's underline, under a paragraph.
    if (
      !this.indented &&
      container.kind === BlockKind.Paragraph &&
      matchAt(SETEXT_UNDERLINE_PATTERN, this.source, position)
    ) {
      this.closeUnmatchedBlocks();
      this.readDefinitions(container);

      if (container.lines.length > 0) {
        container.kind = BlockKind.Heading;
        this.offset = this.line.end;
        return 2;
      }
    }

    // A thematic break.
    if (!this.indented && this.isThematicBreak(position)) {
      this.closeUnmatchedBlocks();
      this.addChild(BlockKind.ThematicBreak);
      this.offset = this.line.end;
      return 2;
    }

    // A list item.
    if (!this.indented || container.kind === BlockKind.List) {
      const marker: ListMarker | null = this.parseListMarker(container);

      if (marker) {
        this.closeUnmatchedBlocks();

        if (
          this.tip.kind !== BlockKind.List ||
          !this.listsMatch(container.listMarker, marker)
        ) {
          const list: Block = this.addChild(BlockKind.List);

          list.listMarker = marker;
        }

        const item: Block = this.addChild(BlockKind.Item);

        item.listMarker = marker;
        return 1;
      }
    }

    // An indented code block. It cannot interrupt a paragraph.
    if (
      this.indented &&
      this.tip.kind !== BlockKind.Paragraph &&
      this.tip.kind !== BlockKind.Table &&
      !this.blank
    ) {
      this.advanceOffset(CODE_INDENT, true);
      this.closeUnmatchedBlocks();
      this.addChild(BlockKind.IndentedCode);
      return 2;
    }

    return 0;
  }

  private isThematicBreak(position: number): boolean {
    if (!this.thematicTail) {
      this.thematicTail = getThematicTail(
        this.source,
        this.line.start,
        this.line.end,
      );
    }

    return isThematicBreakAt(
      this.source,
      position,
      this.line.end,
      this.thematicTail,
    );
  }

  // Whether a block could start with this character at all.
  private mayStartBlock(position: number): boolean {
    const code: number = this.peek(position);

    return (
      code === 0x23 || // #
      code === CHAR_BACKTICK ||
      code === CHAR_TILDE ||
      code === CHAR_ASTERISK ||
      code === 0x2b || // +
      code === CHAR_UNDERSCORE ||
      code === CHAR_EQUALS ||
      code === CHAR_LESS_THAN ||
      code === CHAR_GREATER_THAN ||
      code === CHAR_HYPHEN ||
      isAsciiDigit(code)
    );
  }

  // A heading's text: after its #s, without a closing run of #s.
  private getHeadingContent(position: number): ContentLine {
    let start: number = position;

    while (start < this.line.end && this.source.charCodeAt(start) === 0x23) {
      start++;
    }

    while (
      start < this.line.end &&
      isSpaceOrTab(this.source.charCodeAt(start))
    ) {
      start++;
    }

    let end: number = this.line.end;

    while (end > start && isSpaceOrTab(this.source.charCodeAt(end - 1))) {
      end--;
    }

    let closingStart: number = end;

    while (
      closingStart > start &&
      this.source.charCodeAt(closingStart - 1) === 0x23
    ) {
      closingStart--;
    }

    if (closingStart === start) {
      end = start;
    } else if (
      closingStart < end &&
      isSpaceOrTab(this.source.charCodeAt(closingStart - 1))
    ) {
      end = closingStart;

      while (end > start && isSpaceOrTab(this.source.charCodeAt(end - 1))) {
        end--;
      }
    }

    return { start: start, end: end };
  }

  /*
   * The length of the fence that opens here, or 0: three or more backticks
   * with no backtick in the rest of the line, or three or more tildes.
   */
  private getOpeningFenceLength(position: number): number {
    const code: number = this.peek(position);

    if (code !== CHAR_BACKTICK && code !== CHAR_TILDE) {
      return 0;
    }

    let index: number = position;

    while (index < this.line.end && this.source.charCodeAt(index) === code) {
      index++;
    }

    const length: number = index - position;

    if (length < 3) {
      return 0;
    }

    if (code === CHAR_BACKTICK) {
      for (let rest: number = index; rest < this.line.end; rest++) {
        if (this.source.charCodeAt(rest) === CHAR_BACKTICK) {
          return 0;
        }
      }
    }

    return length;
  }

  // The HTML block that starts here (1 to 7), or 0.
  private getHtmlBlockStart(position: number, container: Block): number {
    for (let type: number = 1; type <= 6; type++) {
      if (matchAt(HTML_BLOCK_START_PATTERNS[type]!, this.source, position)) {
        return type;
      }
    }

    /*
     * A type 7 block cannot interrupt a paragraph the line continues. A
     * paragraph the line would only lazily continue is another matter (see
     * tryBlockStarts).
     */
    if (container.kind === BlockKind.Paragraph) {
      return 0;
    }

    const matcher: HtmlMatcher = new HtmlMatcher(this.source, this.line.end);
    const isClosing: boolean = this.peek(position + 1) === CHAR_SLASH;
    const nameStart: number = position + (isClosing ? 2 : 1);
    const name: string = this.source.slice(
      nameStart,
      matcher.tagNameEnd(nameStart),
    );

    // <pre> and the like open a type 1 block; their closing tags are type 7.
    if (!name || (!isClosing && HTML_BLOCK_RAW_TEXT_TAG_PATTERN.test(name))) {
      return 0;
    }

    const end: number = isClosing
      ? matcher.matchClosingTag(position)
      : matcher.matchOpenTag(position);

    if (end === -1 || !matchAt(BLANK_REST_PATTERN, this.source, end)) {
      return 0;
    }

    return 7;
  }

  private parseListMarker(container: Block): ListMarker | null {
    if (this.indent >= CODE_INDENT) {
      return null;
    }

    const interrupts: boolean =
      container.kind === BlockKind.Paragraph || this.interruptsParagraph;
    const position: number = this.nextNonspace;
    let markerLength: number;
    let marker: ListMarker;

    const bullet: RegExpExecArray | null = matchAt(
      BULLET_MARKER_PATTERN,
      this.source,
      position,
    );

    if (bullet && position < this.line.end) {
      markerLength = 1;
      marker = {
        isOrdered: false,
        character: bullet[0],
        markerOffset: this.indent,
        padding: 0,
      };
    } else {
      const ordered: RegExpExecArray | null = matchAt(
        ORDERED_MARKER_PATTERN,
        this.source,
        position,
      );

      if (
        !ordered ||
        ordered.index + ordered[0].length > this.line.end ||
        (interrupts && parseInt(ordered[1]!, 10) !== 1)
      ) {
        return null;
      }

      markerLength = ordered[0].length;
      marker = {
        isOrdered: true,
        character: ordered[2]!,
        markerOffset: this.indent,
        padding: 0,
      };
    }

    const next: number = this.peek(position + markerLength);

    if (!(next === -1 || isSpaceOrTab(next))) {
      return null;
    }

    // An empty list item cannot interrupt a paragraph.
    if (
      interrupts &&
      matchAt(BLANK_REST_PATTERN, this.source, position + markerLength)
    ) {
      return null;
    }

    this.advanceNextNonspace();
    this.advanceOffset(markerLength, true);

    const spacesStartColumn: number = this.column;
    const spacesStartOffset: number = this.offset;

    do {
      this.advanceOffset(1, true);
    } while (
      this.column - spacesStartColumn < 5 &&
      isSpaceOrTab(this.peek(this.offset))
    );

    const isBlankItem: boolean = this.peek(this.offset) === -1;
    const spacesAfterMarker: number = this.column - spacesStartColumn;

    if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || isBlankItem) {
      marker.padding = markerLength + 1;
      this.column = spacesStartColumn;
      this.offset = spacesStartOffset;

      if (isSpaceOrTab(this.peek(this.offset))) {
        this.advanceOffset(1, true);
      }
    } else {
      marker.padding = markerLength + spacesAfterMarker;
    }

    return marker;
  }

  private listsMatch(
    listMarker: ListMarker | null,
    itemMarker: ListMarker,
  ): boolean {
    return (
      listMarker !== null &&
      listMarker.isOrdered === itemMarker.isOrdered &&
      listMarker.character === itemMarker.character
    );
  }

  /*
   * A paragraph whose one line is a table's header, followed by its
   * delimiter row with as many cells, is a table: true when that happened.
   */
  private becomesTable(paragraph: Block): boolean {
    if (paragraph.lines.length !== 1) {
      return false;
    }

    const header: ContentLine = paragraph.lines[0]!;

    // A delimiter row holds pipes, colons, hyphens and white space only.
    let hasPipe: boolean = false;

    for (let index: number = this.offset; index < this.line.end; index++) {
      const code: number = this.source.charCodeAt(index);

      if (code === CHAR_PIPE) {
        hasPipe = true;
      } else if (
        code !== CHAR_COLON &&
        code !== 0x2d && // -
        !isSpaceOrTab(code)
      ) {
        return false;
      }
    }

    if (!hasPipe || !this.hasPipe(header.start, header.end)) {
      return false;
    }

    const delimiterCells: Array<ContentLine> = splitTableRow(
      this.source,
      this.offset,
      this.line.end,
    );

    for (const cell of delimiterCells) {
      if (
        !TABLE_DELIMITER_CELL_PATTERN.test(
          this.source.slice(cell.start, cell.end),
        )
      ) {
        return false;
      }
    }

    if (
      delimiterCells.length !==
      splitTableRow(this.source, header.start, header.end).length
    ) {
      return false;
    }

    paragraph.kind = BlockKind.Table;
    return true;
  }

  private hasPipe(start: number, end: number): boolean {
    for (let index: number = start; index < end; index++) {
      if (this.source.charCodeAt(index) === CHAR_PIPE) {
        return true;
      }
    }

    return false;
  }

  private addLine(block: Block): void {
    if (block.kind === BlockKind.Paragraph || block.kind === BlockKind.Table) {
      block.lines.push({
        start: this.partiallyConsumedTab ? this.offset + 1 : this.offset,
        end: this.line.end,
      });
    }
  }

  private addChild(kind: BlockKind): Block {
    while (!this.canContain(this.tip.kind, kind)) {
      this.finalize(this.tip);
    }

    const parent: Block = this.tip;
    const block: Block = new Block(
      kind,
      parent,
      parent === this.document ? { end: this.line.end } : parent.topLevel,
    );

    block.isFirstChildOfItem =
      parent.kind === BlockKind.Item && parent.childCount === 0;
    parent.lastChild = block;
    parent.childCount++;
    this.tip = block;

    return block;
  }

  private canContain(parentKind: BlockKind, childKind: BlockKind): boolean {
    switch (parentKind) {
      case BlockKind.Document:
      case BlockKind.BlockQuote:
      case BlockKind.Item:
        return childKind !== BlockKind.Item;
      case BlockKind.List:
        return childKind === BlockKind.Item;
      default:
        return false;
    }
  }

  private closeUnmatchedBlocks(): void {
    if (this.allClosed) {
      return;
    }

    while (this.oldTip !== this.lastMatchedContainer) {
      const parent: Block = this.oldTip.parent!;

      this.finalize(this.oldTip);
      this.oldTip = parent;
    }

    this.allClosed = true;
  }

  private finalize(block: Block): void {
    block.isOpen = false;

    if (block.kind === BlockKind.Paragraph) {
      this.readDefinitions(block);
    }

    if (
      (block.kind === BlockKind.Paragraph ||
        block.kind === BlockKind.Heading) &&
      block.lines.length > 0
    ) {
      this.leaves.push({
        lines: block.lines,
        topLevel: block.topLevel,
        isTopLevelParagraph:
          block.kind === BlockKind.Paragraph && block.parent === this.document,
        startsWithTaskMarker:
          block.kind === BlockKind.Paragraph && block.isFirstChildOfItem,
      });
    }

    if (block.kind === BlockKind.Table) {
      block.lines.forEach((row: ContentLine): void => {
        for (const cell of splitTableRow(this.source, row.start, row.end)) {
          this.leaves.push({
            lines: [cell],
            topLevel: block.topLevel,
            isTopLevelParagraph: false,
            startsWithTaskMarker: false,
          });
        }
      });
    }

    if (this.tip === block) {
      this.tip = block.parent || this.document;
    }
  }

  /*
   * The link reference definitions a paragraph starts with, which are taken
   * out of it. A paragraph that was nothing else is left with no lines.
   */
  private readDefinitions(paragraph: Block): void {
    if (
      paragraph.areDefinitionsRead ||
      paragraph.lines.length === 0 ||
      this.source.charCodeAt(paragraph.lines[0]!.start) !== CHAR_LEFT_BRACKET
    ) {
      paragraph.areDefinitionsRead = true;
      return;
    }

    paragraph.areDefinitionsRead = true;

    const content: LeafText = new LeafText(this.source, paragraph.lines);
    let position: number = 0;

    while (content.text.charCodeAt(position) === CHAR_LEFT_BRACKET) {
      const definition: ParsedDefinition | null = parseDefinition(
        content.text,
        position,
      );

      if (!definition) {
        break;
      }

      const label: string = content.text.slice(
        definition.labelStart,
        definition.labelEnd,
      );
      const destination: string = content.text.slice(
        definition.destinationStart,
        definition.destinationEnd,
      );
      const url: string = definition.url;
      const start: number = content.toSource(position);
      const end: number = content.toSource(definition.lastLineEnd);

      if (isDataUrl(url)) {
        this.dataDefinitions.push({
          start: start,
          end: end,
          url: url,
          topLevel: paragraph.topLevel,
        });
      } else {
        this.otherDefinitions.push({
          start: start,
          end: end,
          label: label,
          destination: destination,
        });
      }

      const normalized: string = normalizeLabel(label);

      if (!this.definitions.has(normalized)) {
        this.definitions.set(normalized, {
          label: label,
          destination: destination,
          url: url,
        });
      }

      position = definition.end;
    }

    if (position > 0) {
      paragraph.lines = content.linesFrom(position);
    }
  }

  private peek(position: number): number {
    return position < this.line.end ? this.source.charCodeAt(position) : -1;
  }

  private findNextNonspace(): void {
    let index: number = this.offset;
    let column: number = this.column;

    while (index < this.line.end) {
      const code: number = this.source.charCodeAt(index);

      if (code === CHAR_SPACE) {
        index++;
        column++;
      } else if (code === CHAR_TAB) {
        index++;
        column += TAB_STOP - (column % TAB_STOP);
      } else {
        break;
      }
    }

    this.blank = index >= this.line.end;
    this.nextNonspace = index;
    this.nextNonspaceColumn = column;
    this.indent = column - this.column;
    this.indented = this.indent >= CODE_INDENT;
  }

  private advanceNextNonspace(): void {
    this.offset = this.nextNonspace;
    this.column = this.nextNonspaceColumn;
    this.partiallyConsumedTab = false;
  }

  /*
   * Moves past `count` characters, or `count` columns when `columns` is
   * set: a tab then counts for the columns to the next tab stop, and one
   * only partly passed is partly consumed.
   */
  private advanceOffset(count: number, columns: boolean): void {
    let remaining: number = count;

    while (remaining > 0 && this.offset < this.line.end) {
      if (this.source.charCodeAt(this.offset) === CHAR_TAB) {
        const charactersToTab: number = TAB_STOP - (this.column % TAB_STOP);

        if (columns) {
          this.partiallyConsumedTab = charactersToTab > remaining;

          const advance: number = Math.min(charactersToTab, remaining);

          this.column += advance;
          this.offset += this.partiallyConsumedTab ? 0 : 1;
          remaining -= advance;
        } else {
          this.partiallyConsumedTab = false;
          this.column += charactersToTab;
          this.offset++;
          remaining--;
        }
      } else {
        this.partiallyConsumedTab = false;
        this.offset++;
        this.column++;
        remaining--;
      }
    }
  }
}

/*
 * A LEAF'S TEXT.
 *
 * The lines of a paragraph, a heading or a table cell, joined by "\n" as
 * CommonMark reads them, and the way back from a position in that text to
 * where it is in the whole text.
 */
class LeafText {
  public readonly text: string;
  private readonly lineStarts: Array<number> = [];

  public constructor(
    source: string,
    private readonly lines: Array<ContentLine>,
  ) {
    const parts: Array<string> = [];
    let length: number = 0;

    for (const line of lines) {
      this.lineStarts.push(length);
      parts.push(source.slice(line.start, line.end));
      length += line.end - line.start + 1;
    }

    this.text = parts.join("\n");
  }

  // Where a position in the leaf's text is in the whole text.
  public toSource(position: number): number {
    const index: number = this.lineIndexOf(position);
    const line: ContentLine = this.lines[index]!;

    return Math.min(
      line.start + (position - this.lineStarts[index]!),
      line.end,
    );
  }

  // The leaf's lines from the one that starts at this position.
  public linesFrom(position: number): Array<ContentLine> {
    if (position >= this.text.length) {
      return [];
    }

    return this.lines.slice(this.lineIndexOf(position));
  }

  // The index of the line the position is on.
  public lineIndexOf(position: number): number {
    let low: number = 0;
    let high: number = this.lineStarts.length - 1;

    while (low < high) {
      const middle: number = (low + high + 1) >> 1;

      if (this.lineStarts[middle]! <= position) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return low;
  }
}

/*
 * LINK LABELS, DESTINATIONS AND TITLES, shared by link reference definitions
 * and inline links.
 */

interface ScannedLabel {
  // Inside the brackets.
  contentStart: number;
  contentEnd: number;
  // After the closing bracket.
  end: number;
}

type ScanLinkLabelFunction = (
  text: string,
  position: number,
) => ScannedLabel | null;

/*
 * The link label that starts at this "[": up to the first "]" that is not
 * escaped, with no "[" that is not escaped before it, at most 999
 * characters. Null when there is none. "[]" is returned, empty, for the
 * caller to decide.
 */
const scanLinkLabel: ScanLinkLabelFunction = (
  text: string,
  position: number,
): ScannedLabel | null => {
  let index: number = position + 1;
  const limit: number = Math.min(
    text.length,
    position + 1 + MAX_LINK_LABEL_LENGTH + 1,
  );

  while (index < limit) {
    const code: number = text.charCodeAt(index);

    if (code === CHAR_BACKSLASH && index + 1 < text.length) {
      index += isAsciiPunctuation(text.charCodeAt(index + 1)) ? 2 : 1;
      continue;
    }

    if (code === CHAR_LEFT_BRACKET) {
      return null;
    }

    if (code === CHAR_RIGHT_BRACKET) {
      if (index - (position + 1) > MAX_LINK_LABEL_LENGTH) {
        return null;
      }

      return { contentStart: position + 1, contentEnd: index, end: index + 1 };
    }

    index++;
  }

  return null;
};

type IsValidLabelFunction = (
  text: string,
  start: number,
  end: number,
) => boolean;

/*
 * Whether the text between `start` and `end` can be a link label: at most
 * 999 characters, not only white space, and no bracket that is not escaped.
 * Read where it is, and only as far as the first thing that rules it out.
 */
const isValidLabel: IsValidLabelFunction = (
  text: string,
  start: number,
  end: number,
): boolean => {
  if (end - start > MAX_LINK_LABEL_LENGTH) {
    return false;
  }

  let hasContent: boolean = false;

  for (let index: number = start; index < end; index++) {
    const code: number = text.charCodeAt(index);

    if (code === CHAR_BACKSLASH) {
      hasContent = true;
      index++;
      continue;
    }

    if (code === CHAR_LEFT_BRACKET || code === CHAR_RIGHT_BRACKET) {
      return false;
    }

    if (!isWhitespace(code)) {
      hasContent = true;
    }
  }

  return hasContent;
};

type SkipFunction = (text: string, position: number) => number;

const skipSpacesAndTabs: SkipFunction = (
  text: string,
  position: number,
): number => {
  let index: number = position;

  while (index < text.length && isSpaceOrTab(text.charCodeAt(index))) {
    index++;
  }

  return index;
};

// Spaces and tabs, and at most one line ending among them.
const skipSpacesTabsAndOneLineEnding: SkipFunction = (
  text: string,
  position: number,
): number => {
  let index: number = skipSpacesAndTabs(text, position);

  if (index < text.length && text.charCodeAt(index) === CHAR_LINE_FEED) {
    index = skipSpacesAndTabs(text, index + 1);
  }

  return index;
};

interface ScannedDestination {
  // As written, in its angle brackets when it has them.
  start: number;
  end: number;
  // The address it stands for.
  url: string;
}

type ScanDestinationFunction = (
  text: string,
  position: number,
) => ScannedDestination | null;

/*
 * The link destination that starts here: in angle brackets, on one line,
 * with no "<" or ">" that is not escaped; or else a run of characters that
 * are not spaces or controls, with its parentheses balanced (to the depth
 * CommonMark lets an implementation stop at). Null when there is none.
 */
const scanDestination: ScanDestinationFunction = (
  text: string,
  position: number,
): ScannedDestination | null => {
  if (text.charCodeAt(position) === CHAR_LESS_THAN) {
    let index: number = position + 1;

    while (index < text.length) {
      const code: number = text.charCodeAt(index);

      if (code === CHAR_BACKSLASH && index + 1 < text.length) {
        index += isAsciiPunctuation(text.charCodeAt(index + 1)) ? 2 : 1;
        continue;
      }

      if (code === CHAR_GREATER_THAN) {
        return {
          start: position,
          end: index + 1,
          url: unescapeBackslashes(text.slice(position + 1, index)),
        };
      }

      if (code === CHAR_LESS_THAN || isLineEnding(code)) {
        return null;
      }

      index++;
    }

    return null;
  }

  let index: number = position;
  let depth: number = 0;

  while (index < text.length) {
    const code: number = text.charCodeAt(index);

    if (
      code === CHAR_BACKSLASH &&
      index + 1 < text.length &&
      isAsciiPunctuation(text.charCodeAt(index + 1))
    ) {
      index += 2;
      continue;
    }

    if (code === CHAR_LEFT_PARENTHESIS) {
      depth++;

      if (depth > MAX_DESTINATION_PARENTHESIS_DEPTH) {
        return null;
      }
    } else if (code === CHAR_RIGHT_PARENTHESIS) {
      if (depth === 0) {
        break;
      }

      depth--;
    } else if (code <= CHAR_SPACE || code === CHAR_DELETE) {
      break;
    }

    index++;
  }

  if (index === position || depth !== 0) {
    return null;
  }

  return {
    start: position,
    end: index,
    url: unescapeBackslashes(text.slice(position, index)),
  };
};

/*
 * Where a link title that starts here ends (after its closing quote or
 * parenthesis), or -1. A title in parentheses ends at the first ")" that is
 * not escaped, a "(" before it included, as micromark reads one. `closers`
 * remembers, by opening position, where each title closes, so a title
 * opened twice is looked for once.
 */
class TitleScanner {
  private readonly closers: Map<number, number> = new Map<number, number>();

  public constructor(private readonly text: string) {}

  public scan(position: number): number {
    const opener: number = this.text.charCodeAt(position);

    if (
      opener !== CHAR_QUOTATION_MARK &&
      opener !== CHAR_APOSTROPHE &&
      opener !== CHAR_LEFT_PARENTHESIS
    ) {
      return -1;
    }

    const remembered: number | undefined = this.closers.get(position);

    if (remembered !== undefined) {
      return remembered;
    }

    const closer: number =
      opener === CHAR_LEFT_PARENTHESIS ? CHAR_RIGHT_PARENTHESIS : opener;
    let end: number = -1;
    let index: number = position + 1;

    while (index < this.text.length) {
      const code: number = this.text.charCodeAt(index);

      if (code === CHAR_BACKSLASH && index + 1 < this.text.length) {
        index += isAsciiPunctuation(this.text.charCodeAt(index + 1)) ? 2 : 1;
        continue;
      }

      if (code === closer) {
        end = index + 1;
        break;
      }

      index++;
    }

    this.closers.set(position, end);

    return end;
  }
}

interface ParsedDefinition {
  labelStart: number;
  labelEnd: number;
  destinationStart: number;
  destinationEnd: number;
  url: string;
  // The end of the definition's last line, before its line ending.
  lastLineEnd: number;
  // Where the text after the definition starts.
  end: number;
}

type ParseDefinitionFunction = (
  text: string,
  position: number,
) => ParsedDefinition | null;

/*
 * The link reference definition that starts a paragraph's text here:
 * "[label]:", a destination, maybe a title, and nothing else on the line it
 * ends on. Null when there is none.
 */
const parseDefinition: ParseDefinitionFunction = (
  text: string,
  position: number,
): ParsedDefinition | null => {
  const label: ScannedLabel | null = scanLinkLabel(text, position);

  if (
    !label ||
    !isValidLabel(text, label.contentStart, label.contentEnd) ||
    text.charCodeAt(label.end) !== CHAR_COLON
  ) {
    return null;
  }

  const destinationStart: number = skipSpacesTabsAndOneLineEnding(
    text,
    label.end + 1,
  );
  const destination: ScannedDestination | null = scanDestination(
    text,
    destinationStart,
  );

  if (!destination) {
    return null;
  }

  const lineEndAfter: (from: number) => number | null = (
    from: number,
  ): number | null => {
    const end: number = skipSpacesAndTabs(text, from);

    return end >= text.length || text.charCodeAt(end) === CHAR_LINE_FEED
      ? end
      : null;
  };

  const titleStart: number = skipSpacesTabsAndOneLineEnding(
    text,
    destination.end,
  );
  let lastLineEnd: number | null = null;

  if (titleStart > destination.end) {
    const titleEnd: number = new TitleScanner(text).scan(titleStart);

    if (titleEnd >= 0) {
      lastLineEnd = lineEndAfter(titleEnd);
    }
  }

  if (lastLineEnd === null) {
    lastLineEnd = lineEndAfter(destination.end);
  }

  if (lastLineEnd === null) {
    return null;
  }

  return {
    labelStart: label.contentStart,
    labelEnd: label.contentEnd,
    destinationStart: destination.start,
    destinationEnd: destination.end,
    url: destination.url,
    lastLineEnd: lastLineEnd,
    end: Math.min(lastLineEnd + 1, text.length),
  };
};

/*
 * INLINE CONTENT.
 */

enum AtomKind {
  CodeSpan = "CodeSpan",
  Html = "Html",
  Autolink = "Autolink",
  Link = "Link",
  Image = "Image",
}

// Something in inline content that is read as a whole.
interface Atom {
  kind: AtomKind;
  start: number;
  end: number;
  // A code span's code; a link's or an image's text.
  innerStart: number;
  innerEnd: number;
  // A link's, an image's or an autolink's address.
  url: string;
  // A link's or an image's plain text, once it is known.
  plainText: string | null;
}

interface Opener {
  position: number;
  isImage: boolean;
}

const INLINE_SPECIAL_PATTERN: RegExp = /[\\`<!\][]/g;

const EMAIL_AUTOLINK_PATTERN: RegExp =
  /<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>/y;

/*
 * The inline content of one leaf, read as CommonMark reads it: escapes, then
 * code spans, autolinks and raw HTML as they come, and links and images by
 * their brackets ("look for link or image" in the specification).
 */
class InlineScanner {
  public readonly atoms: Array<Atom> = [];

  private readonly openers: Array<Opener> = [];
  /*
   * Openers below this index that are "[" are inactive: a link was found
   * after them, and links do not nest.
   */
  private inactiveBelow: number = 0;

  private readonly titles: TitleScanner;
  private readonly html: HtmlMatcher;

  /*
   * Backtick strings by length (their start positions, in order), and where
   * the search for a closer of each length has got to.
   */
  private backtickRuns: Map<number, Array<number>> | null = null;
  private readonly backtickRunCursors: Map<number, number> = new Map<
    number,
    number
  >();

  public constructor(
    private readonly text: string,
    private readonly definitions: Map<string, Definition>,
  ) {
    this.titles = new TitleScanner(text);
    this.html = new HtmlMatcher(text, text.length);
  }

  public scan(start: number): void {
    const text: string = this.text;
    let position: number = start;

    while (position < text.length) {
      INLINE_SPECIAL_PATTERN.lastIndex = position;

      const special: RegExpExecArray | null = INLINE_SPECIAL_PATTERN.exec(text);

      if (!special) {
        break;
      }

      position = special.index;

      switch (text.charCodeAt(position)) {
        case CHAR_BACKSLASH:
          position +=
            position + 1 < text.length &&
            isAsciiPunctuation(text.charCodeAt(position + 1))
              ? 2
              : 1;
          break;
        case CHAR_BACKTICK:
          position = this.readBackticks(position);
          break;
        case CHAR_LESS_THAN:
          position = this.readAngleBracket(position);
          break;
        case CHAR_EXCLAMATION_MARK:
          if (text.charCodeAt(position + 1) === CHAR_LEFT_BRACKET) {
            this.openers.push({ position: position, isImage: true });
            position += 2;
          } else {
            position++;
          }
          break;
        case CHAR_LEFT_BRACKET:
          this.openers.push({ position: position, isImage: false });
          position++;
          break;
        default:
          position = this.readClosingBracket(position);
          break;
      }
    }

    this.atoms.sort((first: Atom, second: Atom): number => {
      return first.start - second.start;
    });
  }

  /*
   * A backtick string opens a code span that ends at the next backtick
   * string of the same length; with none, it is text.
   */
  private readBackticks(position: number): number {
    let runEnd: number = position;

    while (
      runEnd < this.text.length &&
      this.text.charCodeAt(runEnd) === CHAR_BACKTICK
    ) {
      runEnd++;
    }

    const length: number = runEnd - position;
    const closer: number = this.findBacktickRun(length, runEnd);

    if (closer === -1) {
      return runEnd;
    }

    this.atoms.push({
      kind: AtomKind.CodeSpan,
      start: position,
      end: closer + length,
      innerStart: runEnd,
      innerEnd: closer,
      url: "",
      plainText: null,
    });

    return closer + length;
  }

  // The first backtick string of exactly this length at or after `from`.
  private findBacktickRun(length: number, from: number): number {
    if (!this.backtickRuns) {
      this.backtickRuns = new Map<number, Array<number>>();

      for (let index: number = 0; index < this.text.length; ) {
        if (this.text.charCodeAt(index) !== CHAR_BACKTICK) {
          index++;
          continue;
        }

        let runEnd: number = index;

        while (
          runEnd < this.text.length &&
          this.text.charCodeAt(runEnd) === CHAR_BACKTICK
        ) {
          runEnd++;
        }

        const runs: Array<number> = this.backtickRuns.get(runEnd - index) || [];

        runs.push(index);
        this.backtickRuns.set(runEnd - index, runs);
        index = runEnd;
      }
    }

    const runs: Array<number> | undefined = this.backtickRuns.get(length);

    if (!runs) {
      return -1;
    }

    let cursor: number = this.backtickRunCursors.get(length) || 0;

    while (cursor < runs.length && runs[cursor]! < from) {
      cursor++;
    }

    this.backtickRunCursors.set(length, cursor);

    return cursor < runs.length ? runs[cursor]! : -1;
  }

  // An autolink or raw HTML hides what is inside it; anything else is text.
  private readAngleBracket(position: number): number {
    const uriAutolinkEnd: number = this.matchUriAutolink(position);

    if (uriAutolinkEnd >= 0) {
      this.atoms.push({
        kind: AtomKind.Autolink,
        start: position,
        end: uriAutolinkEnd,
        innerStart: position + 1,
        innerEnd: uriAutolinkEnd - 1,
        url: this.text.slice(position + 1, uriAutolinkEnd - 1),
        plainText: null,
      });

      return uriAutolinkEnd;
    }

    const email: RegExpExecArray | null = matchAt(
      EMAIL_AUTOLINK_PATTERN,
      this.text,
      position,
    );

    if (email) {
      const end: number = position + email[0].length;

      this.atoms.push({
        kind: AtomKind.Autolink,
        start: position,
        end: end,
        innerStart: position + 1,
        innerEnd: end - 1,
        url: "mailto:" + this.text.slice(position + 1, end - 1),
        plainText: null,
      });

      return end;
    }

    const htmlEnd: number = this.html.match(position);

    if (htmlEnd >= 0) {
      this.atoms.push({
        kind: AtomKind.Html,
        start: position,
        end: htmlEnd,
        innerStart: position,
        innerEnd: htmlEnd,
        url: "",
        plainText: null,
      });

      return htmlEnd;
    }

    return position + 1;
  }

  /*
   * "<", a scheme of 2 to 32 letters, digits, "+", "." or "-" starting with
   * a letter, ":", then anything but white space, controls, "<" and ">", up
   * to ">".
   */
  private matchUriAutolink(position: number): number {
    const text: string = this.text;
    let index: number = position + 1;

    if (!isAsciiLetter(text.charCodeAt(index))) {
      return -1;
    }

    index++;

    while (index < text.length && index - position - 1 < 33) {
      const code: number = text.charCodeAt(index);

      if (
        isAsciiAlphanumeric(code) ||
        code === 0x2b || // +
        code === 0x2e || // .
        code === 0x2d // -
      ) {
        index++;
        continue;
      }

      break;
    }

    const schemeLength: number = index - position - 1;

    if (
      schemeLength < 2 ||
      schemeLength > 32 ||
      text.charCodeAt(index) !== CHAR_COLON
    ) {
      return -1;
    }

    index++;

    while (index < text.length) {
      const code: number = text.charCodeAt(index);

      if (code === CHAR_GREATER_THAN) {
        return index + 1;
      }

      if (
        code <= CHAR_SPACE ||
        code === CHAR_LESS_THAN ||
        code === CHAR_DELETE
      ) {
        return -1;
      }

      index++;
    }

    return -1;
  }

  /*
   * "]" closes the nearest opener when what follows makes a link or an
   * image of it: an inline destination in parentheses, or a reference to a
   * definition - [text][label], [text][] or [text] alone.
   */
  private readClosingBracket(position: number): number {
    const opener: Opener | undefined = this.openers[this.openers.length - 1];

    if (!opener) {
      return position + 1;
    }

    const openerIndex: number = this.openers.length - 1;

    if (!opener.isImage && openerIndex < this.inactiveBelow) {
      this.removeTopOpener();
      return position + 1;
    }

    const textStart: number = opener.position + (opener.isImage ? 2 : 1);
    let end: number = -1;
    let url: string = "";

    if (this.text.charCodeAt(position + 1) === CHAR_LEFT_PARENTHESIS) {
      const inline: { end: number; url: string } | null =
        this.readInlineDestination(position + 2);

      if (inline) {
        end = inline.end;
        url = inline.url;
      }
    }

    if (end === -1 && this.definitions.size > 0) {
      /*
       * [text][label] takes the label; [text][] and [text] alone, the text.
       * A "[" after the text that starts neither is no reference at all, as
       * micromark reads it.
       */
      let labelStart: number = textStart;
      let labelEnd: number = position;
      let referenceEnd: number = position + 1;
      let isReference: boolean = true;

      if (this.text.charCodeAt(position + 1) === CHAR_LEFT_BRACKET) {
        const scanned: ScannedLabel | null = scanLinkLabel(
          this.text,
          position + 1,
        );

        if (scanned && scanned.contentEnd === scanned.contentStart) {
          referenceEnd = scanned.end;
        } else if (
          scanned &&
          isValidLabel(this.text, scanned.contentStart, scanned.contentEnd)
        ) {
          labelStart = scanned.contentStart;
          labelEnd = scanned.contentEnd;
          referenceEnd = scanned.end;
        } else {
          isReference = false;
        }
      }

      const definition: Definition | undefined =
        isReference && isValidLabel(this.text, labelStart, labelEnd)
          ? this.definitions.get(
              normalizeLabel(this.text.slice(labelStart, labelEnd)),
            )
          : undefined;

      if (definition) {
        end = referenceEnd;
        url = definition.url;
      }
    }

    if (end === -1) {
      this.removeTopOpener();
      return position + 1;
    }

    this.atoms.push({
      kind: opener.isImage ? AtomKind.Image : AtomKind.Link,
      start: opener.position,
      end: end,
      innerStart: textStart,
      innerEnd: position,
      url: url,
      plainText: null,
    });

    this.removeTopOpener();

    if (!opener.isImage) {
      // Every "[" before a link is inactive: links do not nest.
      this.inactiveBelow = this.openers.length;
    }

    return end;
  }

  private removeTopOpener(): void {
    this.openers.pop();
    this.inactiveBelow = Math.min(this.inactiveBelow, this.openers.length);
  }

  /*
   * After "](": white space, a destination (or none), white space, maybe a
   * title, white space, then ")". Null when the parentheses do not hold
   * one.
   */
  private readInlineDestination(
    position: number,
  ): { end: number; url: string } | null {
    const text: string = this.text;
    const destinationStart: number = skipSpacesTabsAndOneLineEnding(
      text,
      position,
    );

    if (text.charCodeAt(destinationStart) === CHAR_RIGHT_PARENTHESIS) {
      return { end: destinationStart + 1, url: "" };
    }

    const destination: ScannedDestination | null = scanDestination(
      text,
      destinationStart,
    );

    if (!destination) {
      return null;
    }

    const afterDestination: number = skipSpacesTabsAndOneLineEnding(
      text,
      destination.end,
    );

    if (afterDestination > destination.end) {
      const titleEnd: number = this.titles.scan(afterDestination);

      if (titleEnd >= 0) {
        const close: number = skipSpacesTabsAndOneLineEnding(text, titleEnd);

        if (text.charCodeAt(close) === CHAR_RIGHT_PARENTHESIS) {
          return { end: close + 1, url: destination.url };
        }
      }
    }

    if (text.charCodeAt(afterDestination) === CHAR_RIGHT_PARENTHESIS) {
      return { end: afterDestination + 1, url: destination.url };
    }

    return null;
  }
}

/*
 * PLAIN TEXT.
 *
 * An image's alt text or a link's text as a reader sees it: code spans as
 * their code, autolinks as their address (but nothing for a data: URL),
 * raw HTML as written, nested images and links as their own plain text,
 * escapes undone, white space collapsed. Each atom's is worked out once.
 */
class PlainText {
  public constructor(
    private readonly text: string,
    private readonly atoms: Array<Atom>,
  ) {}

  public of(atom: Atom): string {
    if (atom.plainText === null) {
      atom.plainText = this.between(atom.innerStart, atom.innerEnd);
    }

    return atom.plainText;
  }

  private between(start: number, end: number): string {
    let result: string = "";
    let position: number = start;
    let atomIndex: number = this.firstAtomAtOrAfter(position);

    while (position < end && result.length < MAX_DATA_URL_USE_TEXT_LENGTH) {
      const atom: Atom | undefined = this.atoms[atomIndex];
      const stop: number = atom && atom.start < end ? atom.start : end;

      result += unescapeBackslashes(this.text.slice(position, stop));

      if (!atom || atom.start >= end) {
        break;
      }

      switch (atom.kind) {
        case AtomKind.CodeSpan:
          result += this.text.slice(atom.innerStart, atom.innerEnd);
          break;
        case AtomKind.Html:
          result += this.text.slice(atom.start, atom.end);
          break;
        case AtomKind.Autolink:
          // A data: URL's address is its data, which nobody reads.
          if (!isDataUrl(atom.url)) {
            result += this.text.slice(atom.innerStart, atom.innerEnd);
          }
          break;
        default:
          result += this.of(atom);
          break;
      }

      position = atom.end;
      atomIndex = this.firstAtomAtOrAfter(position);
    }

    return result
      .replace(/[ \t\r\n]+/g, " ")
      .trim()
      .slice(0, MAX_DATA_URL_USE_TEXT_LENGTH);
  }

  private firstAtomAtOrAfter(position: number): number {
    let low: number = 0;
    let high: number = this.atoms.length;

    while (low < high) {
      const middle: number = (low + high) >> 1;

      if (this.atoms[middle]!.start < position) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }
}

/*
 * A LINE READ ON ITS OWN.
 */

const LIST_MARKER_START_PATTERN: RegExp =
  /(?:[*+-]|\d{1,9}[.)])(?=[ \t]|$|[\r\n])/y;
const BLOCK_START_CHARACTER_PATTERN: RegExp = /[>#`~<]/y;

// A GitHub task list item's checkbox, which is not a link.
const TASK_LIST_MARKER_PATTERN: RegExp = /^\[[ \txX]\](?=[ \t\n]|$)/;

type StartsBlockFunction = (
  source: string,
  start: number,
  end: number,
) => boolean;

/*
 * Whether a line, if it were where a text starts, could start something
 * other than a paragraph. A paragraph's later line is only text in it, but
 * "2. ...", an empty "-", a lone HTML tag or a table row would start a list,
 * HTML or a table there. Generous: when in doubt, it could.
 */
const startsBlockOnItsOwn: StartsBlockFunction = (
  source: string,
  start: number,
  end: number,
): boolean => {
  return (
    matchAt(LIST_MARKER_START_PATTERN, source, start) !== null ||
    matchAt(BLOCK_START_CHARACTER_PATTERN, source, start) !== null ||
    isThematicBreakAt(
      source,
      start,
      end,
      getThematicTail(source, start, end),
    ) ||
    source.slice(start, end).indexOf("|") !== -1
  );
};

export default class MarkdownDataUrls {
  // Whether a text could use a data: URL at all - a quick check.
  public static mayHaveDataUrl(markdown: string | null | undefined): boolean {
    return Boolean(markdown) && DATA_SCHEME_ANYWHERE_PATTERN.test(markdown!);
  }

  /**
   * Every image, link, autolink and link reference definition in the text
   * whose address is a data: URL, and the text's other link reference
   * definitions (see above).
   */
  public static find(markdown: string): MarkdownDataUrlUses {
    if (!MarkdownDataUrls.mayHaveDataUrl(markdown)) {
      return { uses: [], linkDefinitions: [] };
    }

    const parser: BlockParser = new BlockParser(markdown);

    parser.parse();

    const uses: Array<DataUrlUse> = [];

    for (const definition of parser.dataDefinitions) {
      uses.push({
        kind: DataUrlUseKind.Definition,
        start: definition.start,
        end: definition.end,
        url: definition.url,
        image: parseInlineImageDataUri(definition.url),
        text: "",
        topLevelBlockEnd: definition.topLevel.end,
        paragraphLine: null,
      });
    }

    const hasDataDefinition: boolean = parser.dataDefinitions.length > 0;

    for (const leaf of parser.leaves) {
      MarkdownDataUrls.findInLeaf({
        source: markdown,
        leaf: leaf,
        definitions: parser.definitions,
        hasDataDefinition: hasDataDefinition,
        uses: uses,
      });
    }

    uses.sort((first: DataUrlUse, second: DataUrlUse): number => {
      return first.start - second.start || second.end - first.end;
    });

    return {
      uses: uses,
      linkDefinitions: parser.otherDefinitions.sort(
        (first: LinkDefinition, second: LinkDefinition): number => {
          return first.start - second.start;
        },
      ),
    };
  }

  private static findInLeaf(data: {
    source: string;
    leaf: InlineLeaf;
    definitions: Map<string, Definition>;
    hasDataDefinition: boolean;
    uses: Array<DataUrlUse>;
  }): void {
    const leaf: InlineLeaf = data.leaf;

    // Without "data:" in it or a definition to point at one, nothing to find.
    if (!data.hasDataDefinition) {
      const hasDataScheme: boolean = leaf.lines.some(
        (line: ContentLine): boolean => {
          return DATA_SCHEME_ANYWHERE_PATTERN.test(
            data.source.slice(line.start, line.end),
          );
        },
      );

      if (!hasDataScheme) {
        return;
      }
    }

    const content: LeafText = new LeafText(data.source, leaf.lines);
    const scanner: InlineScanner = new InlineScanner(
      content.text,
      data.definitions,
    );

    scanner.scan(
      leaf.startsWithTaskMarker && TASK_LIST_MARKER_PATTERN.test(content.text)
        ? 3
        : 0,
    );

    const plainText: PlainText = new PlainText(content.text, scanner.atoms);

    for (const atom of scanner.atoms) {
      if (
        (atom.kind !== AtomKind.Image &&
          atom.kind !== AtomKind.Link &&
          atom.kind !== AtomKind.Autolink) ||
        !isDataUrl(atom.url)
      ) {
        continue;
      }

      const start: number = content.toSource(atom.start);

      data.uses.push({
        kind:
          atom.kind === AtomKind.Image
            ? DataUrlUseKind.Image
            : atom.kind === AtomKind.Link
              ? DataUrlUseKind.Link
              : DataUrlUseKind.Autolink,
        start: start,
        end: content.toSource(atom.end),
        url: atom.url,
        image: parseInlineImageDataUri(atom.url),
        text: atom.kind === AtomKind.Autolink ? "" : plainText.of(atom),
        topLevelBlockEnd: leaf.topLevel.end,
        paragraphLine: leaf.isTopLevelParagraph
          ? MarkdownDataUrls.getParagraphLine({
              source: data.source,
              lines: leaf.lines,
              lineIndex: content.lineIndexOf(atom.start),
            })
          : null,
      });
    }
  }

  private static getParagraphLine(data: {
    source: string;
    lines: Array<ContentLine>;
    lineIndex: number;
  }): ParagraphLine {
    const line: ContentLine = data.lines[data.lineIndex]!;
    const previous: ContentLine | undefined = data.lines[data.lineIndex - 1];
    const next: ContentLine | undefined = data.lines[data.lineIndex + 1];

    return {
      start: line.start,
      end: line.end,
      previousLineEnd: previous ? previous.end : null,
      nextLineStart: next ? next.start : null,
      nextLineStartsBlock: next
        ? startsBlockOnItsOwn(data.source, next.start, next.end)
        : false,
    };
  }
}
