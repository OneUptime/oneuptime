import { replaceHtmlMarkup } from "../../../../Types/HtmlMarkup";
import { JSONObject } from "../../../../Types/JSON";
import WorkspaceChannelLinkUtil from "../../../../Types/Workspace/WorkspaceChannelLink";
import MicrosoftTeamsCloudUtil from "../../../../Types/Workspace/MicrosoftTeamsCloud";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ArrayUtil from "../../../../Utils/Array";
import {
  ChatBlock,
  ChatInline,
  ChatListBlock,
  ChatMessageContent,
  ChatTextStyle,
} from "../../../../Utils/Markdown/ChatMessageMarkdown";

/*
 * A MICROSOFT TEAMS MESSAGE, READ AS WHAT IT SHOWS.
 *
 * Microsoft Graph hands a channel message over as HTML - the body Teams
 * draws - with its files, cards and the message it quotes as attachments.
 * This reads it into a ChatMessageContent - paragraphs, lists, quotes,
 * code, and runs of styled text and links - that ChatMessageMarkdown writes
 * as a note, as Teams showed it: bold, italics, strikethrough and code
 * kept, mentions as "@" and the name, emoji as the characters, a post's
 * subject as its first line in bold, and files and images as links.
 *
 * Every tag and comment is read through replaceHtmlMarkup (Common/Types/
 * HtmlMarkup) - one walk that ends a tag only at a ">" outside a quoted
 * value, leaves no "<" of the HTML behind, and reads a script or a style
 * element whole - so a broken or hostile tag is never read as anything but
 * the markup it is. The walk hands each tag over in order; what each one
 * means here (a paragraph's end, a list, a link) is read from its name and
 * attributes, character by character. Entities are read only in the text
 * between tags, once: "&lt;b&gt;" is the text "<b>", never a tag. White
 * space runs are one space, as Teams draws them, except in code.
 *
 * An image Teams keeps inside the message (its "hosted content", which only
 * an app with a token can read) is a link to the message in Teams, where it
 * shows; an image elsewhere on the web is a link to it.
 *
 * Pure, with no database or network imports.
 */

// Who wrote a message, as Graph says.
export interface MicrosoftTeamsMessageAuthor {
  // A person: their Microsoft Entra object id.
  teamsUserId?: string | undefined;
  // The name Teams shows for them, or for the app that posted.
  name?: string | undefined;
  // Whether an app or a bot posted it.
  isApp?: boolean | undefined;
}

// Marks where each tag was, around its number in the walk's text.
const TAG_MARK_START: string = "";
const TAG_MARK_END: string = "";

// A tag's name, "/" first for an end tag.
const TAG_NAME: RegExp = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/;

const BLOCK_TAGS: ReadonlySet<string> = new Set<string>([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "tr",
  "table",
  "tbody",
  "thead",
  "hr",
  "section",
  "article",
  "header",
  "footer",
]);

const HEADING_TAGS: ReadonlySet<string> = new Set<string>([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/*
 * A card or file attached to a Teams message, with what it holds: its text
 * is read from the message's attachments (readAttachments). An element runs
 * from its start tag's first ">" to the first end tag after it.
 */
const ATTACHMENT_START: RegExp = /<attachment\b/i;
const ATTACHMENT_END: RegExp = /<\/attachment>/i;
const ATTACHMENT_END_LENGTH: number = "</attachment>".length;

export type WithoutAttachmentElementsFunction = (html: string) => string;

/*
 * The HTML with every attachment element taken out, read in one pass: the
 * end tags are found once, and a start tag with no ">" or no end tag after
 * it leaves the rest of the HTML as it is. matchAll starts each search at
 * its pattern's lastIndex, so every call makes its own global patterns.
 */
export const withoutAttachmentElements: WithoutAttachmentElementsFunction = (
  html: string,
): string => {
  const ends: Array<number> = [];

  for (const end of html.matchAll(new RegExp(ATTACHMENT_END, "gi"))) {
    ends.push(end.index);
  }

  let text: string = "";
  let at: number = 0;
  let nextEnd: number = 0;

  for (const start of html.matchAll(new RegExp(ATTACHMENT_START, "gi"))) {
    // A start tag inside an element already taken out is part of it.
    if (start.index < at) {
      continue;
    }

    const startTagEnd: number = html.indexOf(">", start.index);

    if (startTagEnd === -1) {
      break;
    }

    while (nextEnd < ends.length && ends[nextEnd]! <= startTagEnd) {
      nextEnd++;
    }

    if (nextEnd === ends.length) {
      break;
    }

    text += html.slice(at, start.index);
    at = ends[nextEnd]! + ATTACHMENT_END_LENGTH;
  }

  return text + html.slice(at);
};

const asString: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const asObject: (value: unknown) => JSONObject | null = (
  value: unknown,
): JSONObject | null => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
};

const asArray: (value: unknown) => Array<unknown> = (
  value: unknown,
): Array<unknown> => {
  return Array.isArray(value) ? value : [];
};

type IsHtmlWhitespaceFunction = (character: string) => boolean;

const isHtmlWhitespace: IsHtmlWhitespaceFunction = (
  character: string,
): boolean => {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === "\f"
  );
};

// What a browser shows for a reference that names no character.
const REPLACEMENT_CHARACTER: string = "�";

/*
 * A numeric character reference's character, as a browser reads it: one
 * that names none - nothing, half of a surrogate pair, past the last code
 * point - is the replacement character, never half a character.
 */
const fromCodePoint: (codePoint: number) => string = (
  codePoint: number,
): string => {
  if (
    !Number.isInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return REPLACEMENT_CHARACTER;
  }

  return String.fromCodePoint(codePoint);
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// The longest character reference read: "&#x10FFFF;" and the named ones.
const MAX_ENTITY_LENGTH: number = 10;

/*
 * The text between tags with its character references read, once - so
 * "&amp;lt;" is the text "&lt;" - in one walk: a reference is "&", a name
 * or a number, and ";", read only where it is no longer than any is.
 */
const decodeHtmlEntities: (text: string) => string = (text: string): string => {
  if (text.indexOf("&") === -1) {
    return text;
  }

  let decoded: string = "";
  let index: number = 0;

  while (index < text.length) {
    const character: string = text[index]!;

    if (character !== "&") {
      decoded += character;
      index++;
      continue;
    }

    // A reference is short: its ";" is looked for only that far.
    let end: number = -1;

    for (
      let probe: number = index + 1;
      probe < text.length && probe <= index + MAX_ENTITY_LENGTH;
      probe++
    ) {
      if (text[probe] === ";") {
        end = probe;
        break;
      }
    }

    if (end === -1) {
      decoded += character;
      index++;
      continue;
    }

    const body: string = text.slice(index + 1, end);
    let value: string | null = null;

    if (body.startsWith("#x") || body.startsWith("#X")) {
      const hex: string = body.slice(2);
      value =
        hex && HEX_DIGITS.test(hex) ? fromCodePoint(parseInt(hex, 16)) : null;
    } else if (body.startsWith("#")) {
      const digits: string = body.slice(1);
      value =
        digits && DECIMAL_DIGITS.test(digits)
          ? fromCodePoint(parseInt(digits, 10))
          : null;
    } else {
      value = NAMED_ENTITIES[body.toLowerCase()] ?? null;
    }

    if (value === null) {
      decoded += character;
      index++;
      continue;
    }

    decoded += value;
    index = end + 1;
  }

  return decoded;
};

const HEX_DIGITS: RegExp = /^[0-9a-fA-F]{1,6}$/;
const DECIMAL_DIGITS: RegExp = /^[0-9]{1,7}$/;

/*
 * One attribute's value in a tag's markup - `href="..."`, `alt='...'`,
 * `id=0` - with its references read; null when the tag has none. Read
 * character by character from after the tag's name.
 */
const readAttribute: (markup: string, name: string) => string | null = (
  markup: string,
  name: string,
): string | null => {
  let index: number = markup.indexOf(" ");

  if (index === -1) {
    return null;
  }

  const wanted: string = name.toLowerCase();

  while (index < markup.length) {
    while (
      index < markup.length &&
      (isHtmlWhitespace(markup[index]!) || markup[index] === "/")
    ) {
      index++;
    }

    if (index >= markup.length || markup[index] === ">") {
      return null;
    }

    const nameStart: number = index;

    while (
      index < markup.length &&
      !isHtmlWhitespace(markup[index]!) &&
      markup[index] !== "=" &&
      markup[index] !== ">" &&
      markup[index] !== "/"
    ) {
      index++;
    }

    const attributeName: string = markup.slice(nameStart, index).toLowerCase();

    while (index < markup.length && isHtmlWhitespace(markup[index]!)) {
      index++;
    }

    let value: string = "";

    if (markup[index] === "=") {
      index++;

      while (index < markup.length && isHtmlWhitespace(markup[index]!)) {
        index++;
      }

      const quote: string = markup[index] || "";

      if (quote === '"' || quote === "'") {
        const end: number = markup.indexOf(quote, index + 1);
        const valueEnd: number = end === -1 ? markup.length : end;
        value = markup.slice(index + 1, valueEnd);
        index = valueEnd + 1;
      } else {
        const valueStart: number = index;

        while (
          index < markup.length &&
          !isHtmlWhitespace(markup[index]!) &&
          markup[index] !== ">"
        ) {
          index++;
        }

        value = markup.slice(valueStart, index);
      }
    }

    if (attributeName === wanted) {
      return decodeHtmlEntities(value);
    }

    if (!attributeName) {
      index++;
    }
  }

  return null;
};

// A list being read: its items so far, and the number its next item has.
interface OpenList {
  ordered: boolean;
  indent: number;
  // The number of the first item not written out yet.
  start: number;
  items: Array<Array<ChatInline>>;
  // Whether an item is open: its text goes into the last of items.
  isItemOpen: boolean;
  // Whether its items hold text not written out yet (pendingLists).
  isPending: boolean;
}

// A link being read: where it goes, and where its words start.
interface OpenLink {
  url: string | null;
  firstInline: number;
}

/*
 * The walk over a message's tags and text, building its blocks: what is
 * open (a paragraph's runs, lists, a quote, code, a link) and how text is
 * styled where the walk is.
 */
class TeamsHtmlWalk {
  public blocks: Array<ChatBlock> = [];

  private inlines: Array<ChatInline> = [];
  private lists: Array<OpenList> = [];
  /*
   * The open lists whose items hold text not written out yet, in the order
   * they got it: written out (flushListItems) without looking at the
   * others - a message of thousands of nested lists looked at every open
   * list for each one, and took minutes.
   */
  private pendingLists: Array<OpenList> = [];
  private quoteDepth: number = 0;
  private quoteInlines: Array<ChatInline> = [];
  private preDepth: number = 0;
  private codeText: string = "";
  private links: Array<OpenLink> = [];
  private bold: number = 0;
  private italic: number = 0;
  private strike: number = 0;
  private code: number = 0;
  private headingDepth: number = 0;
  private cellsInRow: number = 0;
  // An image's link, where an image cannot be linked to itself.
  private readonly messageUrl: string | null;

  public constructor(messageUrl: string | null) {
    this.messageUrl = messageUrl;
  }

  public text(text: string): void {
    if (!text) {
      return;
    }

    if (this.preDepth > 0) {
      this.codeText += decodeHtmlEntities(text);
      return;
    }

    // White space runs are one space, as Teams draws them.
    let collapsed: string = "";
    let lastWasSpace: boolean = false;

    for (const character of text) {
      if (isHtmlWhitespace(character)) {
        if (!lastWasSpace) {
          collapsed += " ";
        }
        lastWasSpace = true;
        continue;
      }

      collapsed += character;
      lastWasSpace = false;
    }

    const decoded: string = decodeHtmlEntities(collapsed).split(" ").join(" ");

    if (decoded) {
      this.pushText(decoded);
    }
  }

  public tag(markup: string): void {
    const match: RegExpExecArray | null = TAG_NAME.exec(markup);

    if (!match) {
      // A comment or a declaration: nothing.
      return;
    }

    const isEnd: boolean = match[1] === "/";
    const name: string = match[2]!.toLowerCase();

    if (this.preDepth > 0 && name !== "pre" && name !== "codeblock") {
      if (name === "br") {
        this.codeText += "\n";
      } else if (!isEnd && (name === "p" || name === "div") && this.codeText) {
        this.codeText += "\n";
      }
      return;
    }

    switch (name) {
      case "br":
        this.pushText("\n");
        return;
      case "b":
      case "strong":
        this.bold += isEnd ? -1 : 1;
        this.bold = Math.max(this.bold, 0);
        return;
      case "i":
      case "em":
        this.italic += isEnd ? -1 : 1;
        this.italic = Math.max(this.italic, 0);
        return;
      case "s":
      case "strike":
      case "del":
        this.strike += isEnd ? -1 : 1;
        this.strike = Math.max(this.strike, 0);
        return;
      case "code":
        this.code += isEnd ? -1 : 1;
        this.code = Math.max(this.code, 0);
        return;
      case "pre":
      case "codeblock":
        if (isEnd) {
          this.endCode();
        } else {
          this.endParagraph();
          this.preDepth++;
        }
        return;
      case "a":
        if (isEnd) {
          this.endLink();
        } else {
          // A link inside a link ends the first, as a browser reads it.
          this.endLink();
          this.links.push({
            url: readAttribute(markup, "href"),
            firstInline: this.inlines.length,
          });
        }
        return;
      case "at":
        if (!isEnd) {
          this.pushText("@");
        }
        return;
      case "emoji":
        if (!isEnd) {
          const emoji: string | null = readAttribute(markup, "alt");

          if (emoji) {
            this.pushText(emoji);
          }
        }
        return;
      case "img":
        this.image(markup);
        return;
      case "li":
        if (isEnd) {
          this.endItem();
        } else {
          this.startItem();
        }
        return;
      case "ul":
      case "ol":
        if (isEnd) {
          this.endList();
        } else {
          this.startList(name === "ol", readAttribute(markup, "start"));
        }
        return;
      case "blockquote":
        if (isEnd) {
          this.endQuote();
        } else {
          this.endParagraph();
          this.quoteDepth++;
        }
        return;
      case "td":
      case "th":
        if (!isEnd) {
          if (this.cellsInRow > 0) {
            this.pushText(" | ");
          }
          this.cellsInRow++;
        }
        return;
      default:
        break;
    }

    if (BLOCK_TAGS.has(name)) {
      if (name === "tr") {
        this.cellsInRow = 0;
      }

      if (HEADING_TAGS.has(name)) {
        this.endParagraph();
        this.headingDepth = Math.max(this.headingDepth + (isEnd ? -1 : 1), 0);
        return;
      }

      this.endParagraph();
    }
  }

  // Whatever is still open, written out.
  public end(): void {
    while (this.links.length > 0) {
      this.endLink();
    }

    if (this.preDepth > 0) {
      this.endCode();
    }

    while (this.lists.length > 0) {
      this.endList();
    }

    this.endParagraph();

    if (this.quoteDepth > 0) {
      this.quoteDepth = 1;
      this.endQuote();
    }
  }

  private getStyle(): ChatTextStyle | undefined {
    const style: ChatTextStyle = {};

    if (this.bold > 0 || this.headingDepth > 0) {
      style.bold = true;
    }

    if (this.italic > 0) {
      style.italic = true;
    }

    if (this.strike > 0) {
      style.strike = true;
    }

    if (this.code > 0) {
      style.code = true;
    }

    return Object.keys(style).length > 0 ? style : undefined;
  }

  private pushText(text: string): void {
    this.inlines.push({ type: "text", text: text, style: this.getStyle() });
  }

  /*
   * An image: a link to it on the web; one Teams keeps inside the message
   * links to the message in Teams, or is "(image)" when that is not known.
   */
  private image(markup: string): void {
    const source: string = (readAttribute(markup, "src") || "").trim();
    const alt: string = (readAttribute(markup, "alt") || "").trim();
    const name: string = alt && alt.toLowerCase() !== "image" ? alt : "image";

    let host: string = "";

    try {
      host = new URL(source).host.toLowerCase();
    } catch {
      host = "";
    }

    /*
     * Where Graph keeps an image a message carries - Microsoft Graph, in any
     * cloud - is readable with a token only: the message's own link instead.
     */
    const url: string | null =
      source && host && !MicrosoftTeamsCloudUtil.isGraphHost(host)
        ? source
        : this.messageUrl;

    if (url) {
      this.inlines.push({
        type: "link",
        url: url,
        text: name,
        isAttachment: true,
      });
      return;
    }

    this.pushText(`(${name})`);
  }

  // The runs since the link opened become one link, with their words.
  private endLink(): void {
    const link: OpenLink | undefined = this.links.pop();

    if (!link) {
      return;
    }

    const words: Array<ChatInline> = this.inlines.splice(link.firstInline);
    const text: string = words
      .map((inline: ChatInline): string => {
        return inline.type === "text" ? inline.text : inline.text || "";
      })
      .join("")
      .trim();

    const url: string = (link.url || "").trim();

    if (!url) {
      ArrayUtil.append(this.inlines, words);
      return;
    }

    const first: ChatInline | undefined = words[0];

    this.inlines.push({
      type: "link",
      url: url,
      text: text || undefined,
      style: first?.style,
    });
  }

  private endCode(): void {
    if (this.preDepth === 0) {
      return;
    }

    this.preDepth = 0;
    const text: string = this.codeText;
    this.codeText = "";

    if (text.trim()) {
      this.pushBlock({ type: "code", text: text });
    }
  }

  /*
   * The runs so far, as a block of what they are in: a list item's text, a
   * quote's paragraph, or a paragraph.
   */
  private endParagraph(): void {
    if (this.inlines.length === 0) {
      return;
    }

    const inlines: Array<ChatInline> = this.inlines;
    this.inlines = [];

    const list: OpenList | undefined = this.lists[this.lists.length - 1];

    if (list && list.isItemOpen) {
      const item: Array<ChatInline> = list.items[list.items.length - 1]!;

      if (item.length > 0) {
        item.push({ type: "text", text: "\n" });
      }

      ArrayUtil.append(item, inlines);

      if (!list.isPending) {
        list.isPending = true;
        this.pendingLists.push(list);
      }
      return;
    }

    if (this.quoteDepth > 0) {
      if (this.quoteInlines.length > 0) {
        this.quoteInlines.push({ type: "text", text: "\n\n" });
      }

      ArrayUtil.append(this.quoteInlines, inlines);
      return;
    }

    this.blocks.push({ type: "paragraph", inlines: inlines });
  }

  private endQuote(): void {
    this.endParagraph();

    if (this.quoteDepth === 0) {
      return;
    }

    this.quoteDepth--;

    if (this.quoteDepth > 0) {
      return;
    }

    const inlines: Array<ChatInline> = this.quoteInlines;
    this.quoteInlines = [];

    if (inlines.length > 0) {
      this.blocks.push({ type: "quote", inlines: inlines });
    }
  }

  // A block that stands on its own - code - written where the walk is.
  private pushBlock(block: ChatBlock): void {
    this.flushListItems();
    this.blocks.push(block);
  }

  private startList(ordered: boolean, start: string | null): void {
    this.endParagraph();

    const parent: OpenList | undefined = this.lists[this.lists.length - 1];
    // "start" when the list has one: Number(null) would be 0.
    const startNumber: number =
      start !== null && start.trim() !== "" ? Number(start) : 1;

    // The parent's items so far come before the nested list.
    this.flushListItems();

    this.lists.push({
      ordered: ordered,
      indent: parent ? parent.indent + 1 : 0,
      start:
        ordered && Number.isFinite(startNumber) && startNumber >= 0
          ? Math.floor(startNumber)
          : 1,
      items: [],
      isItemOpen: false,
      isPending: false,
    });
  }

  private endList(): void {
    this.endParagraph();
    this.flushListItems();
    this.lists.pop();
  }

  private startItem(): void {
    this.endParagraph();

    const list: OpenList | undefined = this.lists[this.lists.length - 1];

    if (!list) {
      // An item outside a list: a list of its own.
      this.startList(false, null);
      this.startItem();
      return;
    }

    list.items.push([]);
    list.isItemOpen = true;
  }

  private endItem(): void {
    this.endParagraph();

    const list: OpenList | undefined = this.lists[this.lists.length - 1];

    if (list) {
      list.isItemOpen = false;
    }
  }

  /*
   * Every open list's items so far, written out as list blocks - outer ones
   * first - so a nested list, or a code block, comes after them.
   */
  private flushListItems(): void {
    const pending: Array<OpenList> = this.pendingLists;
    this.pendingLists = [];

    // Outer ones first.
    pending.sort((a: OpenList, b: OpenList): number => {
      return a.indent - b.indent;
    });

    for (const list of pending) {
      list.isPending = false;

      const items: Array<Array<ChatInline>> = list.items.filter(
        (item: Array<ChatInline>): boolean => {
          return item.length > 0;
        },
      );

      if (items.length === 0) {
        continue;
      }

      const block: ChatListBlock = {
        type: "list",
        ordered: list.ordered,
        start: list.start,
        indent: list.indent,
        items: items,
      };

      this.blocks.push(block);
      list.start += items.length;
      list.items = list.isItemOpen ? [[]] : [];
    }
  }
}

export default class MicrosoftTeamsMessageReader {
  // When the message was posted: its createdDateTime. Null if unreadable.
  public static getPostedAt(message: JSONObject | null): Date | null {
    const value: string = asString(message?.["createdDateTime"]);

    if (!value) {
      return null;
    }

    const date: Date = new Date(value);

    return isNaN(date.getTime()) ? null : date;
  }

  // Who wrote a message: a person's Entra object id and name, or an app's name.
  public static getAuthor(
    message: JSONObject | null,
  ): MicrosoftTeamsMessageAuthor {
    const from: JSONObject | null = asObject(message?.["from"]);
    const user: JSONObject | null = asObject(from?.["user"]);
    const application: JSONObject | null = asObject(from?.["application"]);

    if (user) {
      const author: MicrosoftTeamsMessageAuthor = {};
      const id: string = asString(user["id"]).trim();
      const name: string = asString(user["displayName"]).trim();

      if (id) {
        author.teamsUserId = id;
      }

      if (name) {
        author.name = name;
      }

      return author;
    }

    if (application) {
      const name: string = asString(application["displayName"]).trim();

      return name ? { name: name, isApp: true } : { isApp: true };
    }

    return {};
  }

  /*
   * The message's own link in Teams (its webUrl), when it is one on Teams'
   * host: where an image Teams keeps inside the message can be seen.
   */
  public static getMessageUrl(message: JSONObject | null): string | null {
    const url: string = asString(message?.["webUrl"]).trim();

    if (
      url &&
      WorkspaceChannelLinkUtil.isOnWorkspaceHost({
        workspaceType: WorkspaceType.MicrosoftTeams,
        url: url,
      })
    ) {
      return url;
    }

    return null;
  }

  /*
   * The message as content: a post's subject, its body, then what it
   * attached - the message it quotes, files, cards.
   */
  public static read(message: JSONObject | null): ChatMessageContent {
    const content: ChatMessageContent = { blocks: [] };

    if (!message) {
      return content;
    }

    const subject: string = asString(message["subject"]).trim();

    if (subject) {
      content.blocks.push({
        type: "paragraph",
        inlines: [{ type: "text", text: subject, style: { bold: true } }],
      });
    }

    const body: JSONObject | null = asObject(message["body"]);
    const bodyContent: string = asString(body?.["content"]);
    const contentType: string = (
      asString(body?.["contentType"]) || "html"
    ).toLowerCase();

    if (contentType === "text") {
      if (bodyContent.trim()) {
        content.blocks.push({
          type: "paragraph",
          inlines: [{ type: "text", text: bodyContent }],
        });
      }
    } else {
      ArrayUtil.append(
        content.blocks,
        MicrosoftTeamsMessageReader.readHtml(
          bodyContent,
          MicrosoftTeamsMessageReader.getMessageUrl(message),
        ),
      );
    }

    ArrayUtil.append(
      content.blocks,
      MicrosoftTeamsMessageReader.readAttachments(
        asArray(message["attachments"]),
      ),
    );

    return content;
  }

  // A message body's HTML as blocks (see the top of this file).
  public static readHtml(
    html: string,
    messageUrl: string | null,
  ): Array<ChatBlock> {
    if (!html) {
      return [];
    }

    const walk: TeamsHtmlWalk = new TeamsHtmlWalk(messageUrl);
    const tags: Array<string> = [];

    // The marks stand for tags: any already in the text are taken out.
    const marked: string = replaceHtmlMarkup(
      withoutAttachmentElements(
        html.split(TAG_MARK_START).join("").split(TAG_MARK_END).join(""),
      ),
      (markup: string): string => {
        tags.push(markup);
        return `${TAG_MARK_START}${tags.length - 1}${TAG_MARK_END}`;
      },
      { rawTextElements: true },
    );

    let index: number = 0;

    while (index < marked.length) {
      const start: number = marked.indexOf(TAG_MARK_START, index);

      if (start === -1) {
        walk.text(marked.slice(index));
        break;
      }

      walk.text(marked.slice(index, start));

      const end: number = marked.indexOf(TAG_MARK_END, start + 1);
      const tag: string | undefined =
        tags[Number(marked.slice(start + 1, end))];

      if (tag !== undefined) {
        walk.tag(tag);
      }

      index = end + 1;
    }

    walk.end();

    return walk.blocks;
  }

  /*
   * What a message attached: the message it quotes (Teams' "reply with
   * quote") as a quote of who said what; files as links to them; a card's
   * visible text, one element a line.
   */
  private static readAttachments(
    attachments: Array<unknown>,
  ): Array<ChatBlock> {
    const blocks: Array<ChatBlock> = [];

    for (const value of attachments) {
      const attachment: JSONObject | null = asObject(value);

      if (!attachment) {
        continue;
      }

      const contentType: string = asString(attachment["contentType"]);

      if (contentType === "reference") {
        const url: string = asString(attachment["contentUrl"]).trim();
        const name: string = asString(attachment["name"]).trim() || "file";

        blocks.push({
          type: "paragraph",
          inlines: url
            ? [{ type: "link", url: url, text: name, isAttachment: true }]
            : [{ type: "text", text: `📎 ${name}` }],
        });
        continue;
      }

      const card: JSONObject | null = MicrosoftTeamsMessageReader.parseContent(
        attachment["content"],
      );

      if (!card) {
        continue;
      }

      if (contentType === "messageReference") {
        const sender: string = asString(
          asObject(asObject(card["messageSender"])?.["user"])?.["displayName"],
        ).trim();
        const preview: string = asString(card["messagePreview"]).trim();

        if (preview) {
          blocks.push({
            type: "quote",
            inlines: sender
              ? [
                  { type: "text", text: sender, style: { bold: true } },
                  { type: "text", text: `\n${preview}` },
                ]
              : [{ type: "text", text: preview }],
          });
        }
        continue;
      }

      if (contentType === "application/vnd.microsoft.card.adaptive") {
        const lines: Array<string> =
          MicrosoftTeamsMessageReader.getAdaptiveCardLines(card);

        if (lines.length > 0) {
          blocks.push({
            type: "paragraph",
            inlines: [{ type: "text", text: lines.join("\n") }],
          });
        }
      }
    }

    return blocks;
  }

  private static parseContent(content: unknown): JSONObject | null {
    if (typeof content === "string") {
      try {
        return asObject(JSON.parse(content));
      } catch {
        return null;
      }
    }

    return asObject(content);
  }

  /*
   * The visible text of an adaptive card, one element per line, in the
   * order the card shows them. Read with a list of what is left to read,
   * not by calling itself: a card nested deeper than the call stack is
   * read too.
   */
  public static getAdaptiveCardLines(card: JSONObject): Array<string> {
    const lines: Array<string> = [];
    // What is left to read, the next one last.
    const left: Array<unknown> = [card];

    while (left.length > 0) {
      const element: unknown = left.pop();

      if (!element || typeof element !== "object") {
        continue;
      }

      if (Array.isArray(element)) {
        for (let index: number = element.length - 1; index >= 0; index--) {
          left.push(element[index]);
        }
        continue;
      }

      const node: JSONObject = element as JSONObject;
      const type: string = asString(node["type"]);

      if (type === "TextBlock") {
        lines.push(asString(node["text"]));
      }

      if (type === "RichTextBlock") {
        lines.push(
          asArray(node["inlines"])
            .map((inline: unknown): string => {
              return typeof inline === "string"
                ? inline
                : asString(asObject(inline)?.["text"]);
            })
            .join(""),
        );
      }

      if (type === "FactSet") {
        for (const fact of asArray(node["facts"])) {
          const title: string = asString(asObject(fact)?.["title"]);
          const value: string = asString(asObject(fact)?.["value"]);

          if (title || value) {
            lines.push(title ? `${title} ${value}`.trim() : value);
          }
        }
      }

      // Its body, then its items, then its columns: pushed last first.
      for (const key of ["columns", "items", "body"]) {
        if (node[key]) {
          left.push(node[key]);
        }
      }
    }

    return lines
      .map((line: string): string => {
        return line.trim();
      })
      .filter((line: string): boolean => {
        return Boolean(line);
      });
  }
}
