import {
  fitTextToLength,
  MAX_TELEGRAM_MESSAGE_LENGTH,
  TRUNCATED_TEXT_NOTE,
} from "./MessageFit";

/*
 * A TELEGRAM MESSAGE HELD TO WHAT TELEGRAM TAKES.
 *
 * Telegram refuses a message of more than MAX_TELEGRAM_MESSAGE_LENGTH
 * characters once its formatting is read ("message is too long"), and the
 * notification is lost. A longer one is cut, and ends with a note that the
 * rest is in OneUptime:
 *
 *   - plain text is cut (fitTextToLength);
 *   - HTML (parse mode "HTML", which OneUptime's own messages use) is
 *     counted as Telegram counts it - a tag takes nothing, a character
 *     reference ("&amp;") one character - and cut between characters, never
 *     inside a tag or a reference, with every tag still open closed after
 *     the cut: what is left is still HTML Telegram reads;
 *   - Markdown (parse mode "Markdown" or "MarkdownV2", which a workflow can
 *     choose) cannot be cut so that its formatting stays whole, so a message
 *     too long is sent cut as plain text, with no parse mode.
 *
 * A message that fits is sent as it always was. Pure, with no Node or
 * browser APIs.
 */

export interface TelegramMessageText {
  text: string;
  parseMode?: string | undefined;
}

// The note, on a line of its own.
const NOTE: string = `\n\n${TRUNCATED_TEXT_NOTE}`;

// The name a tag ("<b>", "</b>", "<a href=...>") opens or closes.
const TAG_NAME_PATTERN: RegExp = /^<\/?\s*([a-zA-Z0-9-]+)/;

// The name of the tag `tag` ("<b>", "</b>", "<a href=...>") opens or closes.
const getTagName: (tag: string) => string = (tag: string): string => {
  const name: RegExpExecArray | null = TAG_NAME_PATTERN.exec(tag);

  return name ? name[1]!.toLowerCase() : "";
};

/*
 * Telegram HTML cut to at most `maxLength` characters of text, ending with
 * the note (see the top of this file). HTML that fits is returned as it is.
 */
export const fitTelegramHtml: (html: string, maxLength?: number) => string = (
  html: string,
  maxLength: number = MAX_TELEGRAM_MESSAGE_LENGTH,
): string => {
  // A text is never longer than the HTML it is written in.
  if (html.length <= maxLength) {
    return html;
  }

  const budget: number = Math.max(0, maxLength - NOTE.length);
  const openTags: Array<string> = [];
  let textLength: number = 0;
  let index: number = 0;
  // Where the HTML is cut if it is too long, and the tags open there.
  let cut: number = 0;
  let tagsOpenAtCut: Array<string> = [];
  let isCutFound: boolean = false;

  while (index < html.length && textLength <= maxLength) {
    const code: number = html.charCodeAt(index);

    if (code === 0x3c) {
      // A tag: no text, and no cut inside it.
      const tagEnd: number = html.indexOf(">", index);

      if (tagEnd === -1) {
        // Not HTML Telegram reads: counted as the text it is.
        textLength += html.length - index;
        break;
      }

      const tag: string = html.slice(index, tagEnd + 1);
      const name: string = getTagName(tag);

      if (tag.startsWith("</")) {
        const open: number = openTags.lastIndexOf(name);

        if (open !== -1) {
          openTags.splice(open, 1);
        }
      } else if (name && !tag.endsWith("/>")) {
        openTags.push(name);
      }

      index = tagEnd + 1;

      if (!isCutFound) {
        cut = index;
        tagsOpenAtCut = openTags.slice();
      }

      continue;
    }

    // A character reference is one character; anything else is itself.
    let next: number = index + 1;

    if (code === 0x26) {
      const referenceEnd: number = html.indexOf(";", index);

      if (referenceEnd !== -1 && referenceEnd - index <= 32) {
        next = referenceEnd + 1;
      }
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < html.length &&
      html.charCodeAt(index + 1) >= 0xdc00 &&
      html.charCodeAt(index + 1) <= 0xdfff
    ) {
      // An emoji is two of Telegram's characters, never cut in two.
      next = index + 2;
    }

    const length: number = code === 0x26 ? 1 : next - index;

    if (!isCutFound && textLength + length > budget) {
      isCutFound = true;
    }

    textLength += length;
    index = next;

    if (!isCutFound) {
      cut = index;
    }
  }

  // Its text fits, whatever the length of its tags.
  if (textLength <= maxLength) {
    return html;
  }

  const closingTags: string = tagsOpenAtCut
    .slice()
    .reverse()
    .map((name: string): string => {
      return `</${name}>`;
    })
    .join("");

  return html.slice(0, cut).trimEnd() + closingTags + NOTE;
};

/*
 * A Telegram message's text and parse mode, held to what Telegram takes
 * (see the top of this file).
 */
export const fitTelegramMessage: (
  text: string,
  parseMode?: string | undefined,
) => TelegramMessageText = (
  text: string,
  parseMode?: string | undefined,
): TelegramMessageText => {
  if (typeof text !== "string" || text.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
    return { text: text, parseMode: parseMode };
  }

  if (parseMode === "HTML") {
    return { text: fitTelegramHtml(text), parseMode: parseMode };
  }

  return {
    text: fitTextToLength(text, MAX_TELEGRAM_MESSAGE_LENGTH, NOTE),
    parseMode: undefined,
  };
};
