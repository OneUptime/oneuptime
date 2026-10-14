import { JSONObject } from "../../../../Types/JSON";
import {
  ChatBlock,
  ChatInline,
  ChatMessageContent,
  ChatTextStyle,
} from "../../../../Utils/Markdown/ChatMessageMarkdown";

/*
 * A SLACK MESSAGE, READ AS WHAT IT SHOWS.
 *
 * What conversations.history (or conversations.replies) hands over for a
 * message, turned into a ChatMessageContent - paragraphs, lists, quotes,
 * code, and runs of styled text and links - that ChatMessageMarkdown writes
 * as a note. Mentions read as the names Slack shows ("@Aidil Rahman",
 * "#incident-8", "@here"), emoji as the characters, dates as their text,
 * and the files and images a message carried as links to them.
 *
 * A message typed in Slack's composer comes with "rich_text" blocks, which
 * say exactly how it looked, and a top-level `text` in Slack's mrkdwn as
 * its fallback. Messages from apps and bots, older clients and the API may
 * have only `text`, other kinds of blocks (sections, headers, context), or
 * legacy attachments. Each is read: the blocks when they show anything,
 * else the text; then the attachments that are not link previews; then the
 * files.
 *
 * The names of the people, channels and groups a message mentions are not
 * in it: getReferences says which ids to look up, and read takes what was
 * found (SlackMessageNames). Anything not found reads as Slack's own label
 * in the message where there is one, else a plain "@someone".
 *
 * Every reader here walks its input once, character by character or
 * element by element: no pattern reads the message.
 *
 * Pure, with no database or network imports.
 */

export interface SlackMessageNames {
  // Slack user id -> the name Slack shows: "Aidil Rahman".
  users: Map<string, string>;
  // Channel id -> its name, without "#": "incident-8".
  channels: Map<string, string>;
  // User group id -> its handle, without "@": "oncall-team".
  userGroups: Map<string, string>;
}

// The ids a message mentions, to look their names up.
export interface SlackMessageReferences {
  userIds: Array<string>;
  channelIds: Array<string>;
  userGroupIds: Array<string>;
}

// Who wrote a message, as Slack says.
export interface SlackMessageAuthor {
  // A person: their Slack user id.
  slackUserId?: string | undefined;
  // An app or a bot: the name it posts as.
  botName?: string | undefined;
}

// At most this many people's and channels' names are looked up.
export const SLACK_MESSAGE_MAX_LOOKUPS: number = 25;

// Slack ids: letters and digits only ("U0123ABC", "C0456DEF", "S0789").
const SLACK_ID_CHARACTER: RegExp = /^[A-Za-z0-9]$/;

// One code point of an emoji, in hex: "1f44b".
const HEX_CODE_POINT: RegExp = /^[0-9a-fA-F]{1,6}$/;

// The longest `<...>` Slack writes that is read as one.
const MAX_ANGLE_TOKEN_LENGTH: number = 3000;

// A link Slack shows as a preview of one in the message, not content.
const UNFURL_KEYS: ReadonlyArray<string> = [
  "from_url",
  "original_url",
  "is_msg_unfurl",
  "is_app_unfurl",
  "is_share",
];

type IsWhitespaceFunction = (character: string) => boolean;

const isWhitespace: IsWhitespaceFunction = (character: string): boolean => {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === " "
  );
};

type IsWordCharacterFunction = (character: string) => boolean;

// A letter or a digit: what Slack's emphasis markers may not touch outside.
const LETTER_OR_DIGIT: RegExp = /[\p{L}\p{N}]/u;

const isWordCharacter: IsWordCharacterFunction = (
  character: string,
): boolean => {
  return character !== "" && LETTER_OR_DIGIT.test(character);
};

// A Slack id: letters and digits, of a sensible length.
const isSlackId: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  if (typeof value !== "string" || value.length < 2 || value.length > 40) {
    return false;
  }

  for (const character of value) {
    if (!SLACK_ID_CHARACTER.test(character)) {
      return false;
    }
  }

  return true;
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

/*
 * Slack's three character references in mrkdwn - "&amp;", "&lt;" and
 * "&gt;" - read back, in one pass: "&amp;lt;" is the text "&lt;".
 */
const decodeSlackEntities: (text: string) => string = (
  text: string,
): string => {
  if (text.indexOf("&") === -1) {
    return text;
  }

  let decoded: string = "";
  let index: number = 0;

  while (index < text.length) {
    const character: string = text[index]!;

    if (character === "&") {
      if (text.startsWith("&amp;", index)) {
        decoded += "&";
        index += 5;
        continue;
      }

      if (text.startsWith("&lt;", index)) {
        decoded += "<";
        index += 4;
        continue;
      }

      if (text.startsWith("&gt;", index)) {
        decoded += ">";
        index += 4;
        continue;
      }
    }

    decoded += character;
    index++;
  }

  return decoded;
};

/*
 * An emoji's characters from Slack's code points ("1f44b", or
 * "1f468-200d-1f4bb" for a sequence); null when they are not code points.
 */
const emojiFromCodePoints: (unicode: string) => string | null = (
  unicode: string,
): string | null => {
  if (!unicode || unicode.length > 100) {
    return null;
  }

  let emoji: string = "";

  for (const part of unicode.split("-")) {
    if (!HEX_CODE_POINT.test(part)) {
      return null;
    }

    try {
      emoji += String.fromCodePoint(parseInt(part, 16));
    } catch {
      return null;
    }
  }

  return emoji || null;
};

/*
 * Where a character is next found in a text, from a place that only moves
 * forward: looked for again only once the place has passed the last one
 * found, so a walk asking at every character reads the text once.
 */
interface NextFinder {
  find: (from: number) => number;
}

const nextFinder: (text: string, character: string) => NextFinder = (
  text: string,
  character: string,
): NextFinder => {
  // Not looked for yet; -1 once there is none left.
  let position: number = -2;

  return {
    find: (from: number): number => {
      if (position === -1 || position >= from) {
        return position;
      }

      position = text.indexOf(character, from);
      return position;
    },
  };
};

// What a style flag of Slack's rich text says.
const readRichTextStyle: (value: unknown) => ChatTextStyle | undefined = (
  value: unknown,
): ChatTextStyle | undefined => {
  const style: JSONObject | null = asObject(value);

  if (!style) {
    return undefined;
  }

  const read: ChatTextStyle = {};

  if (style["bold"] === true) {
    read.bold = true;
  }

  if (style["italic"] === true) {
    read.italic = true;
  }

  if (style["strike"] === true) {
    read.strike = true;
  }

  if (style["code"] === true) {
    read.code = true;
  }

  return Object.keys(read).length > 0 ? read : undefined;
};

/*
 * A run of mrkdwn read as text: where Slack's emphasis markers open and
 * close, worked out once over the whole run.
 */
interface MrkdwnPiece {
  // The characters, with markers and tokens already read.
  kind: "text" | "token" | "code";
  text: string;
  // A token's link, when it is one.
  url?: string | undefined;
}

export default class SlackMessageReader {
  // When the message was posted: its ts, seconds since 1970. Null if unreadable.
  public static getPostedAt(message: JSONObject | null): Date | null {
    const ts: string = asString(message?.["ts"]);
    const seconds: number = Number(ts);

    if (!ts || !Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }

    return new Date(Math.round(seconds * 1000));
  }

  // Who wrote a message: a person's Slack id, or an app's name.
  public static getAuthor(message: JSONObject | null): SlackMessageAuthor {
    if (!message) {
      return {};
    }

    const author: SlackMessageAuthor = {};
    const userId: string = asString(message["user"]);

    if (isSlackId(userId)) {
      author.slackUserId = userId;
    }

    const botProfile: JSONObject | null = asObject(message["bot_profile"]);
    const botName: string = (
      asString(botProfile?.["name"]) ||
      asString(message["username"]) ||
      ""
    ).trim();

    if (botName && (message["bot_id"] || message["subtype"] === "bot_message")) {
      author.botName = botName;
    }

    return author;
  }

  /*
   * The people, channels and groups the message mentions, by id, first
   * seen first, at most SLACK_MESSAGE_MAX_LOOKUPS of each. The author is
   * not among them unless the message mentions them.
   */
  public static getReferences(message: JSONObject | null): SlackMessageReferences {
    const users: Set<string> = new Set<string>();
    const channels: Set<string> = new Set<string>();
    const userGroups: Set<string> = new Set<string>();

    const add: (set: Set<string>, id: unknown) => void = (
      set: Set<string>,
      id: unknown,
    ): void => {
      if (isSlackId(id) && set.size < SLACK_MESSAGE_MAX_LOOKUPS) {
        set.add(id);
      }
    };

    const visitRichText: (element: unknown) => void = (
      element: unknown,
    ): void => {
      const node: JSONObject | null = asObject(element);

      if (!node) {
        return;
      }

      switch (node["type"]) {
        case "user":
          add(users, node["user_id"]);
          return;
        case "channel":
          add(channels, node["channel_id"]);
          return;
        case "usergroup":
          add(userGroups, node["usergroup_id"]);
          return;
      }

      for (const child of asArray(node["elements"])) {
        visitRichText(child);
      }
    };

    const visitMrkdwn: (text: string) => void = (text: string): void => {
      SlackMessageReader.forEachAngleToken(text, (token: string): void => {
        if (token.startsWith("@")) {
          add(users, SlackMessageReader.tokenId(token.slice(1)));
        } else if (token.startsWith("#")) {
          add(channels, SlackMessageReader.tokenId(token.slice(1)));
        } else if (token.startsWith("!subteam^")) {
          add(userGroups, SlackMessageReader.tokenId(token.slice(9)));
        }
      });
    };

    if (!message) {
      return { userIds: [], channelIds: [], userGroupIds: [] };
    }

    for (const block of asArray(message["blocks"])) {
      const node: JSONObject | null = asObject(block);

      if (node?.["type"] === "rich_text") {
        visitRichText(node);
      }
    }

    for (const text of SlackMessageReader.getMrkdwnTexts(message)) {
      visitMrkdwn(text);
    }

    return {
      userIds: Array.from(users),
      channelIds: Array.from(channels),
      userGroupIds: Array.from(userGroups),
    };
  }

  /*
   * The message as content: its blocks, else its text; its attachments that
   * are not link previews; its files.
   */
  public static read(
    message: JSONObject | null,
    names: SlackMessageNames,
  ): ChatMessageContent {
    const content: ChatMessageContent = { blocks: [] };

    if (!message) {
      return content;
    }

    const labels: Map<string, string> = SlackMessageReader.getTokenLabels(
      asString(message["text"]),
    );

    const fromBlocks: Array<ChatBlock> = SlackMessageReader.readBlocks(
      asArray(message["blocks"]),
      names,
      labels,
    );

    if (SlackMessageReader.hasText(fromBlocks)) {
      content.blocks.push(...fromBlocks);
    } else {
      content.blocks.push(
        ...SlackMessageReader.readMrkdwn(
          asString(message["text"]),
          names,
          labels,
        ),
      );
    }

    for (const attachment of asArray(message["attachments"])) {
      content.blocks.push(
        ...SlackMessageReader.readAttachment(attachment, names, labels),
      );
    }

    const files: Array<ChatInline> = SlackMessageReader.readFiles(
      asArray(message["files"]),
    );

    for (const file of files) {
      content.blocks.push({ type: "paragraph", inlines: [file] });
    }

    return content;
  }

  /*
   * Every mrkdwn text of a message whose mentions need names: its text,
   * its non-rich-text blocks' text, its attachments'.
   */
  private static getMrkdwnTexts(message: JSONObject): Array<string> {
    const texts: Array<string> = [asString(message["text"])];

    const addTextObject: (value: unknown) => void = (value: unknown): void => {
      const textObject: JSONObject | null = asObject(value);

      if (textObject && textObject["type"] === "mrkdwn") {
        texts.push(asString(textObject["text"]));
      }
    };

    for (const block of asArray(message["blocks"])) {
      const node: JSONObject | null = asObject(block);

      if (!node) {
        continue;
      }

      addTextObject(node["text"]);

      for (const field of asArray(node["fields"])) {
        addTextObject(field);
      }

      for (const element of asArray(node["elements"])) {
        addTextObject(element);
      }
    }

    for (const attachment of asArray(message["attachments"])) {
      const node: JSONObject | null = asObject(attachment);

      if (!node || SlackMessageReader.isUnfurl(node)) {
        continue;
      }

      texts.push(asString(node["pretext"]), asString(node["text"]));

      for (const field of asArray(node["fields"])) {
        texts.push(asString(asObject(field)?.["value"]));
      }
    }

    return texts.filter((text: string): boolean => {
      return Boolean(text);
    });
  }

  // Whether the blocks hold any text or link.
  private static hasText(blocks: Array<ChatBlock>): boolean {
    for (const block of blocks) {
      if (block.type === "code") {
        if (block.text.trim()) {
          return true;
        }
        continue;
      }

      const groups: Array<Array<ChatInline>> =
        block.type === "list" ? block.items : [block.inlines];

      for (const inlines of groups) {
        for (const inline of inlines) {
          if (inline.type === "link" || inline.text.trim()) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /*
   * The labels Slack wrote in a message's mrkdwn for what its rich text
   * names by id alone: "<#C0123|incident-8>", "<!subteam^S0123|@oncall>".
   */
  private static getTokenLabels(text: string): Map<string, string> {
    const labels: Map<string, string> = new Map<string, string>();

    SlackMessageReader.forEachAngleToken(text, (token: string): void => {
      const bar: number = token.indexOf("|");

      if (bar === -1) {
        return;
      }

      const label: string = decodeSlackEntities(token.slice(bar + 1)).trim();

      if (label) {
        labels.set(token.slice(0, bar), label);
      }
    });

    return labels;
  }

  /*
   * Each `<...>` in a mrkdwn text, without its brackets: from a "<" to the
   * first ">" after it with no "<" between (nextFinder: a text of many "<"
   * before one ">" is read once).
   */
  private static forEachAngleToken(
    text: string,
    visit: (token: string) => void,
  ): void {
    const closes: NextFinder = nextFinder(text, ">");
    const opens: NextFinder = nextFinder(text, "<");
    let index: number = opens.find(0);

    while (index !== -1) {
      const end: number = closes.find(index + 1);

      if (end === -1) {
        return;
      }

      const next: number = opens.find(index + 1);

      // A "<" before the ">" starts the token instead.
      if (next !== -1 && next < end) {
        index = next;
        continue;
      }

      if (end - index <= MAX_ANGLE_TOKEN_LENGTH) {
        visit(text.slice(index + 1, end));
      }

      index = opens.find(end + 1);
    }
  }

  // The id at the start of a token's body: "U0123|jane" -> "U0123".
  private static tokenId(body: string): string {
    const bar: number = body.indexOf("|");
    return bar === -1 ? body : body.slice(0, bar);
  }

  private static isUnfurl(attachment: JSONObject): boolean {
    return UNFURL_KEYS.some((key: string): boolean => {
      return Boolean(attachment[key]);
    });
  }

  // ---- Blocks ----

  private static readBlocks(
    blocks: Array<unknown>,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): Array<ChatBlock> {
    const read: Array<ChatBlock> = [];

    for (const block of blocks) {
      const node: JSONObject | null = asObject(block);

      if (!node) {
        continue;
      }

      switch (node["type"]) {
        case "rich_text":
          read.push(...SlackMessageReader.readRichText(node, names, labels));
          break;
        case "header":
          read.push({
            type: "paragraph",
            inlines: [
              {
                type: "text",
                text: asString(asObject(node["text"])?.["text"]),
                style: { bold: true },
              },
            ],
          });
          break;
        case "section":
          read.push(
            ...SlackMessageReader.readTextObject(node["text"], names, labels),
          );

          for (const field of asArray(node["fields"])) {
            read.push(
              ...SlackMessageReader.readTextObject(field, names, labels),
            );
          }
          break;
        case "context":
          for (const element of asArray(node["elements"])) {
            read.push(
              ...SlackMessageReader.readTextObject(element, names, labels),
            );
          }
          break;
        case "markdown":
          // Markdown an app wrote: shown here as the text it is.
          read.push({
            type: "paragraph",
            inlines: [{ type: "text", text: asString(node["text"]) }],
          });
          break;
        case "image": {
          const link: ChatInline | null = SlackMessageReader.attachmentLink(
            node["image_url"],
            asString(asObject(node["title"])?.["text"]) ||
              asString(node["alt_text"]) ||
              "image",
          );

          if (link) {
            read.push({ type: "paragraph", inlines: [link] });
          }
          break;
        }
        case "video": {
          const link: ChatInline | null = SlackMessageReader.attachmentLink(
            node["title_url"] || node["video_url"],
            asString(asObject(node["title"])?.["text"]) || "video",
          );

          if (link) {
            read.push({ type: "paragraph", inlines: [link] });
          }
          break;
        }
        default:
          // Buttons, inputs, dividers, remote files: nothing to read.
          break;
      }
    }

    return read;
  }

  // A text object: "mrkdwn" read as mrkdwn, "plain_text" as text.
  private static readTextObject(
    value: unknown,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): Array<ChatBlock> {
    const textObject: JSONObject | null = asObject(value);

    if (!textObject) {
      return [];
    }

    const text: string = asString(textObject["text"]);

    if (textObject["type"] === "mrkdwn") {
      return SlackMessageReader.readMrkdwn(text, names, labels);
    }

    if (textObject["type"] === "plain_text") {
      return [{ type: "paragraph", inlines: [{ type: "text", text: text }] }];
    }

    // An image in a context block: a link to it.
    if (textObject["type"] === "image") {
      const link: ChatInline | null = SlackMessageReader.attachmentLink(
        textObject["image_url"],
        asString(textObject["alt_text"]) || "image",
      );

      return link ? [{ type: "paragraph", inlines: [link] }] : [];
    }

    return [];
  }

  // ---- Rich text: what Slack's composer writes ----

  private static readRichText(
    block: JSONObject,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): Array<ChatBlock> {
    const read: Array<ChatBlock> = [];

    for (const element of asArray(block["elements"])) {
      const node: JSONObject | null = asObject(element);

      if (!node) {
        continue;
      }

      switch (node["type"]) {
        case "rich_text_section":
          read.push({
            type: "paragraph",
            inlines: SlackMessageReader.readRichTextInlines(
              asArray(node["elements"]),
              names,
              labels,
            ),
          });
          break;
        case "rich_text_quote":
          read.push({
            type: "quote",
            inlines: SlackMessageReader.readRichTextInlines(
              asArray(node["elements"]),
              names,
              labels,
            ),
          });
          break;
        case "rich_text_preformatted":
          read.push({
            type: "code",
            text: SlackMessageReader.readRichTextInlines(
              asArray(node["elements"]),
              names,
              labels,
            )
              .map((inline: ChatInline): string => {
                return inline.type === "text"
                  ? inline.text
                  : inline.text || inline.url;
              })
              .join(""),
          });
          break;
        case "rich_text_list": {
          const ordered: boolean = node["style"] === "ordered";
          const offset: number = Number(node["offset"]);

          read.push({
            type: "list",
            ordered: ordered,
            start:
              ordered && Number.isFinite(offset) && offset > 0
                ? Math.floor(offset) + 1
                : 1,
            indent: Number(node["indent"]) || 0,
            items: asArray(node["elements"]).map(
              (item: unknown): Array<ChatInline> => {
                return SlackMessageReader.readRichTextInlines(
                  asArray(asObject(item)?.["elements"]),
                  names,
                  labels,
                );
              },
            ),
          });
          break;
        }
        default:
          break;
      }
    }

    return read;
  }

  private static readRichTextInlines(
    elements: Array<unknown>,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): Array<ChatInline> {
    const inlines: Array<ChatInline> = [];

    for (const element of elements) {
      const node: JSONObject | null = asObject(element);

      if (!node) {
        continue;
      }

      const style: ChatTextStyle | undefined = readRichTextStyle(node["style"]);

      switch (node["type"]) {
        case "text":
          inlines.push({
            type: "text",
            text: asString(node["text"]),
            style: style,
          });
          break;
        case "link": {
          const url: string = asString(node["url"]);
          const text: string = asString(node["text"]);

          if (url) {
            inlines.push({
              type: "link",
              url: url,
              text: text || undefined,
              style: style,
            });
          } else if (text) {
            inlines.push({ type: "text", text: text, style: style });
          }
          break;
        }
        case "user":
          inlines.push({
            type: "text",
            text: `@${SlackMessageReader.getUserName(
              asString(node["user_id"]),
              names,
              labels,
            )}`,
            style: style,
          });
          break;
        case "channel":
          inlines.push({
            type: "text",
            text: `#${SlackMessageReader.getChannelName(
              asString(node["channel_id"]),
              names,
              labels,
            )}`,
            style: style,
          });
          break;
        case "usergroup":
          inlines.push({
            type: "text",
            text: SlackMessageReader.getUserGroupHandle(
              asString(node["usergroup_id"]),
              names,
              labels,
            ),
            style: style,
          });
          break;
        case "broadcast":
          inlines.push({
            type: "text",
            text: `@${asString(node["range"]) || "here"}`,
            style: style,
          });
          break;
        case "emoji": {
          const emoji: string | null = emojiFromCodePoints(
            asString(node["unicode"]),
          );
          inlines.push({
            type: "text",
            text: emoji || `:${asString(node["name"]) || "emoji"}:`,
            style: style,
          });
          break;
        }
        case "date":
          inlines.push({
            type: "text",
            text:
              asString(node["fallback"]) ||
              SlackMessageReader.dateText(node["timestamp"]),
            style: style,
          });
          break;
        case "color":
          inlines.push({
            type: "text",
            text: asString(node["value"]),
            style: style,
          });
          break;
        default:
          break;
      }
    }

    return inlines;
  }

  private static dateText(timestamp: unknown): string {
    const seconds: number = Number(timestamp);

    if (!Number.isFinite(seconds)) {
      return "";
    }

    try {
      return new Date(seconds * 1000).toISOString();
    } catch {
      return "";
    }
  }

  private static getUserName(
    userId: string,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): string {
    return (
      names.users.get(userId) ||
      SlackMessageReader.withoutLeading(labels.get(`@${userId}`), "@") ||
      "someone"
    );
  }

  private static getChannelName(
    channelId: string,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): string {
    return (
      names.channels.get(channelId) ||
      SlackMessageReader.withoutLeading(labels.get(`#${channelId}`), "#") ||
      "channel"
    );
  }

  // A user group as Slack shows it: "@oncall-team".
  private static getUserGroupHandle(
    userGroupId: string,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): string {
    const handle: string =
      names.userGroups.get(userGroupId) ||
      SlackMessageReader.withoutLeading(
        labels.get(`!subteam^${userGroupId}`),
        "@",
      ) ||
      "group";

    return `@${handle}`;
  }

  private static withoutLeading(
    value: string | undefined,
    character: string,
  ): string {
    const text: string = (value || "").trim();
    return text.startsWith(character) ? text.slice(1).trim() : text;
  }

  // ---- mrkdwn: Slack's own markup, in text, sections and attachments ----

  /*
   * mrkdwn as blocks: code between "```" fences, quoted lines (">") as a
   * quote, every other line as a paragraph's.
   */
  private static readMrkdwn(
    mrkdwn: string,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): Array<ChatBlock> {
    const blocks: Array<ChatBlock> = [];

    if (!mrkdwn) {
      return blocks;
    }

    let index: number = 0;

    while (index < mrkdwn.length) {
      const fence: number = mrkdwn.indexOf("```", index);
      const close: number = fence === -1 ? -1 : mrkdwn.indexOf("```", fence + 3);

      if (fence === -1 || close === -1) {
        blocks.push(
          ...SlackMessageReader.readMrkdwnLines(
            mrkdwn.slice(index),
            names,
            labels,
          ),
        );
        break;
      }

      blocks.push(
        ...SlackMessageReader.readMrkdwnLines(
          mrkdwn.slice(index, fence),
          names,
          labels,
        ),
      );
      blocks.push({
        type: "code",
        text: SlackMessageReader.readMrkdwnCode(
          mrkdwn.slice(fence + 3, close),
          names,
          labels,
        ),
      });
      index = close + 3;
    }

    return blocks;
  }

  // Code as it reads: tokens as their names and addresses, entities read.
  private static readMrkdwnCode(
    code: string,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): string {
    return SlackMessageReader.readMrkdwnPieces(code, names, labels)
      .map((piece: MrkdwnPiece): string => {
        return piece.text;
      })
      .join("");
  }

  // Lines of mrkdwn: runs of quoted lines as quotes, the rest as paragraphs.
  private static readMrkdwnLines(
    text: string,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): Array<ChatBlock> {
    const blocks: Array<ChatBlock> = [];
    let paragraph: Array<string> = [];
    let quote: Array<string> = [];

    const flushParagraph: () => void = (): void => {
      if (paragraph.length > 0) {
        blocks.push({
          type: "paragraph",
          inlines: SlackMessageReader.readMrkdwnInlines(
            paragraph.join("\n"),
            names,
            labels,
          ),
        });
        paragraph = [];
      }
    };

    const flushQuote: () => void = (): void => {
      if (quote.length > 0) {
        blocks.push({
          type: "quote",
          inlines: SlackMessageReader.readMrkdwnInlines(
            quote.join("\n"),
            names,
            labels,
          ),
        });
        quote = [];
      }
    };

    for (const line of text.split("\n")) {
      const quoted: string | null = line.startsWith("&gt;")
        ? line.slice(4)
        : line.startsWith(">")
          ? line.slice(1)
          : null;

      if (quoted !== null) {
        flushParagraph();
        quote.push(quoted.startsWith(" ") ? quoted.slice(1) : quoted);
        continue;
      }

      flushQuote();
      paragraph.push(line);
    }

    flushParagraph();
    flushQuote();

    return blocks;
  }

  /*
   * mrkdwn text as runs: tokens and code spans first, then Slack's
   * emphasis - "*bold*", "_italic_", "~strike~" - where a marker can open
   * (at the start, or after anything but a letter or a digit, and before
   * something that is not white space) and close (after something that is
   * not white space, and at the end or before anything but a letter or a
   * digit), each paired with the nearest one of its kind before it. A
   * marker with no pair is text.
   */
  private static readMrkdwnInlines(
    text: string,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): Array<ChatInline> {
    const pieces: Array<MrkdwnPiece> = SlackMessageReader.readMrkdwnPieces(
      text,
      names,
      labels,
      { readCodeSpans: true },
    );

    /*
     * One character per element of pieces' text, with which piece it is
     * in: emphasis is worked out on the characters of text pieces only.
     */
    interface Character {
      character: string;
      piece: number;
    }

    const characters: Array<Character> = [];

    pieces.forEach((piece: MrkdwnPiece, pieceIndex: number): void => {
      if (piece.kind !== "text") {
        characters.push({ character: "\u0000", piece: pieceIndex });
        return;
      }

      for (const character of piece.text) {
        characters.push({ character: character, piece: pieceIndex });
      }
    });

    const isMarker: (index: number) => boolean = (index: number): boolean => {
      const character: string = characters[index]!.character;
      return (
        (character === "*" || character === "_" || character === "~") &&
        pieces[characters[index]!.piece]!.kind === "text"
      );
    };

    const characterAt: (index: number) => string = (index: number): string => {
      if (index < 0 || index >= characters.length) {
        return "";
      }

      const character: string = characters[index]!.character;
      return character === "\u0000" ? "x" : character;
    };

    // Openers waiting for a closer, by marker.
    const openers: Map<string, Array<number>> = new Map<string, Array<number>>([
      ["*", []],
      ["_", []],
      ["~", []],
    ]);
    const pairs: Array<{ open: number; close: number; marker: string }> = [];

    for (let index: number = 0; index < characters.length; index++) {
      if (!isMarker(index)) {
        // A line break ends every emphasis that is still open.
        if (characters[index]!.character === "\n") {
          for (const waiting of openers.values()) {
            waiting.length = 0;
          }
        }
        continue;
      }

      const marker: string = characters[index]!.character;
      const before: string = characterAt(index - 1);
      const after: string = characterAt(index + 1);
      const waiting: Array<number> = openers.get(marker)!;

      const canClose: boolean =
        waiting.length > 0 &&
        before !== "" &&
        !isWhitespace(before) &&
        !isWordCharacter(after) &&
        // Not right after its opener: "**" is no emphasis.
        waiting[waiting.length - 1]! < index - 1;

      if (canClose) {
        pairs.push({ open: waiting.pop()!, close: index, marker: marker });
        continue;
      }

      const canOpen: boolean =
        !isWordCharacter(before) && after !== "" && !isWhitespace(after);

      if (canOpen) {
        waiting.push(index);
      }
    }

    // The style of each character, from the pairs it is inside.
    const bold: Array<number> = new Array<number>(characters.length + 1).fill(0);
    const italic: Array<number> = new Array<number>(characters.length + 1).fill(
      0,
    );
    const strike: Array<number> = new Array<number>(characters.length + 1).fill(
      0,
    );
    const isPairMarker: Set<number> = new Set<number>();

    for (const pair of pairs) {
      const counts: Array<number> =
        pair.marker === "*" ? bold : pair.marker === "_" ? italic : strike;

      counts[pair.open + 1] = (counts[pair.open + 1] || 0) + 1;
      counts[pair.close] = (counts[pair.close] || 0) - 1;
      isPairMarker.add(pair.open);
      isPairMarker.add(pair.close);
    }

    const inlines: Array<ChatInline> = [];
    let boldDepth: number = 0;
    let italicDepth: number = 0;
    let strikeDepth: number = 0;

    const isSameStyle: (
      a: ChatTextStyle | undefined,
      b: ChatTextStyle | undefined,
    ) => boolean = (
      a: ChatTextStyle | undefined,
      b: ChatTextStyle | undefined,
    ): boolean => {
      return (
        Boolean(a?.bold) === Boolean(b?.bold) &&
        Boolean(a?.italic) === Boolean(b?.italic) &&
        Boolean(a?.strike) === Boolean(b?.strike) &&
        Boolean(a?.code) === Boolean(b?.code)
      );
    };

    const push: (inline: ChatInline) => void = (inline: ChatInline): void => {
      const previous: ChatInline | undefined = inlines[inlines.length - 1];

      if (
        previous &&
        previous.type === "text" &&
        inline.type === "text" &&
        isSameStyle(previous.style, inline.style)
      ) {
        inlines[inlines.length - 1] = {
          ...previous,
          text: previous.text + inline.text,
        };
        return;
      }

      inlines.push(inline);
    };

    let lastPiece: number = -1;

    for (let index: number = 0; index < characters.length; index++) {
      boldDepth += bold[index]!;
      italicDepth += italic[index]!;
      strikeDepth += strike[index]!;

      if (isPairMarker.has(index)) {
        continue;
      }

      const style: ChatTextStyle = {};

      if (boldDepth > 0) {
        style.bold = true;
      }

      if (italicDepth > 0) {
        style.italic = true;
      }

      if (strikeDepth > 0) {
        style.strike = true;
      }

      const styleOrNone: ChatTextStyle | undefined =
        Object.keys(style).length > 0 ? style : undefined;
      const pieceIndex: number = characters[index]!.piece;
      const piece: MrkdwnPiece = pieces[pieceIndex]!;

      if (piece.kind === "text") {
        push({
          type: "text",
          text: characters[index]!.character,
          style: styleOrNone,
        });
        continue;
      }

      if (pieceIndex === lastPiece) {
        continue;
      }

      lastPiece = pieceIndex;

      if (piece.kind === "code") {
        push({
          type: "text",
          text: piece.text,
          style: { ...(styleOrNone || {}), code: true },
        });
        continue;
      }

      if (piece.url) {
        push({
          type: "link",
          url: piece.url,
          text: piece.text || undefined,
          style: styleOrNone,
        });
        continue;
      }

      push({ type: "text", text: piece.text, style: styleOrNone });
    }

    return inlines;
  }

  /*
   * mrkdwn cut into its pieces: text (its entities read), tokens - "<...>"
   * read as a mention's name, a link, a date's text - and, when asked, code
   * spans between single backticks on one line.
   */
  private static readMrkdwnPieces(
    text: string,
    names: SlackMessageNames,
    labels: Map<string, string>,
    options?: { readCodeSpans?: boolean | undefined } | undefined,
  ): Array<MrkdwnPiece> {
    const pieces: Array<MrkdwnPiece> = [];
    let textStart: number = 0;
    let index: number = 0;

    // Read once, whatever the text holds (nextFinder).
    const closes: NextFinder = nextFinder(text, ">");
    const opens: NextFinder = nextFinder(text, "<");
    const backticks: NextFinder = nextFinder(text, "`");
    const lineBreaks: NextFinder = nextFinder(text, "\n");

    const pushText: (end: number) => void = (end: number): void => {
      if (end > textStart) {
        pieces.push({
          kind: "text",
          text: decodeSlackEntities(text.slice(textStart, end)),
        });
      }
    };

    while (index < text.length) {
      const character: string = text[index]!;

      if (character === "<") {
        const end: number = closes.find(index + 1);
        const nextOpen: number = opens.find(index + 1);

        if (
          end !== -1 &&
          (nextOpen === -1 || nextOpen > end) &&
          end - index <= MAX_ANGLE_TOKEN_LENGTH
        ) {
          pushText(index);
          pieces.push(
            SlackMessageReader.readToken(
              text.slice(index + 1, end),
              names,
              labels,
            ),
          );
          index = end + 1;
          textStart = index;
          continue;
        }
      }

      if (character === "`" && options?.readCodeSpans) {
        const end: number = backticks.find(index + 1);
        const lineEnd: number = lineBreaks.find(index + 1);

        if (end > index + 1 && (lineEnd === -1 || end < lineEnd)) {
          pushText(index);
          pieces.push({
            kind: "code",
            text: SlackMessageReader.readMrkdwnCode(
              text.slice(index + 1, end),
              names,
              labels,
            ),
          });
          index = end + 1;
          textStart = index;
          continue;
        }
      }

      index++;
    }

    pushText(text.length);

    return pieces;
  }

  // One "<...>" token, read.
  private static readToken(
    body: string,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): MrkdwnPiece {
    const bar: number = body.indexOf("|");
    const head: string = bar === -1 ? body : body.slice(0, bar);
    const label: string =
      bar === -1 ? "" : decodeSlackEntities(body.slice(bar + 1)).trim();

    if (head.startsWith("@")) {
      const userId: string = head.slice(1);
      const name: string =
        names.users.get(userId) ||
        SlackMessageReader.withoutLeading(label, "@") ||
        SlackMessageReader.getUserName(userId, names, labels);

      return { kind: "token", text: `@${name}` };
    }

    if (head.startsWith("#")) {
      const channelId: string = head.slice(1);
      const name: string =
        names.channels.get(channelId) ||
        SlackMessageReader.withoutLeading(label, "#") ||
        SlackMessageReader.getChannelName(channelId, names, labels);

      return { kind: "token", text: `#${name}` };
    }

    if (head.startsWith("!subteam^")) {
      const userGroupId: string = head.slice(9);
      const handle: string =
        names.userGroups.get(userGroupId) ||
        SlackMessageReader.withoutLeading(label, "@");

      return {
        kind: "token",
        text: handle
          ? `@${handle}`
          : SlackMessageReader.getUserGroupHandle(userGroupId, names, labels),
      };
    }

    if (head.startsWith("!date^")) {
      return { kind: "token", text: label };
    }

    if (head.startsWith("!")) {
      // "<!here>", "<!channel>", "<!everyone>": as Slack shows them.
      const special: string = head.slice(1).split("^")[0] || "";
      return { kind: "token", text: label || `@${special}` };
    }

    const url: string = decodeSlackEntities(head);

    if (url.indexOf(":") > 0) {
      return { kind: "token", text: label, url: url };
    }

    // Not a token Slack writes: the characters as they were.
    return { kind: "text", text: decodeSlackEntities(`<${body}>`) };
  }

  // ---- Attachments and files ----

  /*
   * A legacy attachment an app or a bot wrote: its lead-in, its title (a
   * link when it has one), its text, its fields, its image as a link. A
   * link's preview is not read: the link is in the message already.
   */
  private static readAttachment(
    value: unknown,
    names: SlackMessageNames,
    labels: Map<string, string>,
  ): Array<ChatBlock> {
    const attachment: JSONObject | null = asObject(value);

    if (!attachment || SlackMessageReader.isUnfurl(attachment)) {
      return [];
    }

    const blocks: Array<ChatBlock> = [];

    blocks.push(
      ...SlackMessageReader.readMrkdwn(
        asString(attachment["pretext"]),
        names,
        labels,
      ),
    );

    const title: string = asString(attachment["title"]).trim();

    if (title) {
      const titleLink: string = asString(attachment["title_link"]);

      blocks.push({
        type: "paragraph",
        inlines: [
          titleLink
            ? {
                type: "link",
                url: titleLink,
                text: title,
                style: { bold: true },
              }
            : { type: "text", text: title, style: { bold: true } },
        ],
      });
    }

    const text: Array<ChatBlock> = SlackMessageReader.readMrkdwn(
      asString(attachment["text"]),
      names,
      labels,
    );

    blocks.push(...text);

    for (const field of asArray(attachment["fields"])) {
      const node: JSONObject | null = asObject(field);
      const fieldTitle: string = asString(node?.["title"]).trim();
      const fieldValue: Array<ChatBlock> = SlackMessageReader.readMrkdwn(
        asString(node?.["value"]),
        names,
        labels,
      );

      if (fieldTitle) {
        blocks.push({
          type: "paragraph",
          inlines: [{ type: "text", text: fieldTitle, style: { bold: true } }],
        });
      }

      blocks.push(...fieldValue);
    }

    const image: ChatInline | null = SlackMessageReader.attachmentLink(
      attachment["image_url"],
      "image",
    );

    if (image) {
      blocks.push({ type: "paragraph", inlines: [image] });
    }

    if (
      blocks.length === 0 &&
      !text.length &&
      asString(attachment["fallback"]).trim()
    ) {
      blocks.push({
        type: "paragraph",
        inlines: [{ type: "text", text: asString(attachment["fallback"]) }],
      });
    }

    return blocks;
  }

  /*
   * The files a message carried, as links: to the file in Slack, named as
   * the message showed it. A file that cannot be opened by link (one an
   * app hid, a file of a shared channel this app cannot see) is its name.
   */
  private static readFiles(files: Array<unknown>): Array<ChatInline> {
    const links: Array<ChatInline> = [];

    for (const file of files) {
      const node: JSONObject | null = asObject(file);

      if (!node) {
        continue;
      }

      const name: string = (
        asString(node["title"]) ||
        asString(node["name"]) ||
        "file"
      ).trim();

      const link: ChatInline | null = SlackMessageReader.attachmentLink(
        node["permalink"] || node["url_private"],
        name,
      );

      if (link) {
        links.push(link);
        continue;
      }

      if (node["mode"] !== "tombstone" && name !== "file") {
        links.push({ type: "text", text: `📎 ${name}` });
      }
    }

    return links;
  }

  // A file or an image as a link, or null without an address.
  private static attachmentLink(url: unknown, name: string): ChatInline | null {
    const address: string = asString(url).trim();

    if (!address) {
      return null;
    }

    return {
      type: "link",
      url: address,
      text: name || "file",
      isAttachment: true,
    };
  }
}
