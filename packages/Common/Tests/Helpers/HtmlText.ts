import {
  HtmlMarkupReplacer,
  removeHtmlMarkup,
  replaceHtmlMarkup,
} from "../../Types/HtmlMarkup";

/*
 * Rendered HTML read as text, for the tests: the place a test takes markup
 * out of what OneUptime renders - a note or feed entry through marked, an
 * email through Handlebars, a Telegram message, a docs or API reference
 * page - to read the words a person sees. A test that only needs the markup
 * gone imports removeHtmlMarkup (Common/Types/HtmlMarkup) itself; the
 * readings here add what comes after: entities decoded, words kept apart,
 * a page's styles left out.
 *
 * The tests used to copy a single pass of a tag pattern -
 * `.replace(/<[^>]+>/g, "")`, `/<[^>]*>/`, the same with " " - and code
 * scanning reported 21 of the copies as incomplete multi-character
 * sanitization (js/incomplete-multi-character-sanitization): one pass leaves
 * an unclosed "<script" exactly as it came, ends a tag at a ">" inside a
 * quoted attribute value and keeps the rest of the value as text, and ends
 * a comment at its first ">". What they read only ever fed an assertion,
 * but a test that misreads a page can pass on a page that is wrong. Every
 * reading here goes through the walk product code reads markup with
 * (removeHtmlMarkup / replaceHtmlMarkup), whose output holds no "<" from
 * any markup at all; TestTagStripGuard keeps the copies from coming back.
 *
 * Imports nothing but Common/Types/HtmlMarkup, which imports nothing:
 * Home's tests import this by a relative path from outside their own
 * package.
 */

export type HtmlTextFunction = (html: string) => string;

// What each tag and comment becomes in markupAsSpaces.
const SPACE: HtmlMarkupReplacer = (): string => {
  return " ";
};

/**
 * The HTML with every tag and comment replaced by a space, so the words
 * either side of one stay apart ("<td>a</td><td>b</td>" reads " a  b "),
 * and the text between them kept exactly as it is, entities included. A
 * "<" whose markup never ends is dropped on its own, as removeHtmlMarkup
 * drops it.
 */
export const markupAsSpaces: HtmlTextFunction = (html: string): string => {
  return replaceHtmlMarkup(html, SPACE);
};

// An Outlook-only conditional comment, and what it holds for Outlook.
const OUTLOOK_ONLY_COMMENT: RegExp =
  /^<!--\[if [^\]]*\]>([\s\S]*)<!\[endif\]-->$/;

/*
 * What each tag and comment becomes when an email is read as every client
 * shows it: an Outlook-only conditional comment is what it holds, its own
 * markup a space each.
 */
const AS_EVERY_CLIENT_SHOWS: HtmlMarkupReplacer = (markup: string): string => {
  const outlookOnly: RegExpExecArray | null = OUTLOOK_ONLY_COMMENT.exec(markup);

  return outlookOnly
    ? ` ${replaceHtmlMarkup(outlookOnly[1]!, AS_EVERY_CLIENT_SHOWS)} `
    : " ";
};

/**
 * markupAsSpaces for an email read as every client shows it: what an
 * Outlook-only conditional comment holds ("<!--[if mso]>...<![endif]-->")
 * is read as part of the email - its markup a space each, its words kept -
 * since Outlook shows it, where markupAsSpaces hides the comment whole, as
 * every other client does. For a check that no client shows a word: a
 * product name a white-label licence takes out.
 */
export const markupAsSpacesWithOutlookContent: HtmlTextFunction = (
  html: string,
): string => {
  return replaceHtmlMarkup(html, AS_EVERY_CLIENT_SHOWS);
};

/*
 * The references the renderers OneUptime uses write - marked, Handlebars,
 * micromark - and a few more a template may hold: a named one of these, or
 * a decimal or hexadecimal number.
 */
const CHARACTER_REFERENCE: RegExp =
  /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi;

const NAMED_REFERENCES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  // Read as the space it shows as.
  nbsp: " ",
};

// The last code point Unicode has; a reference past it decodes to nothing.
const LAST_CODE_POINT: number = 0x10ffff;

/**
 * The text with its character references decoded once, as a browser reads
 * a text node or an attribute value: "&amp;lt;" reads "&lt;", never "<".
 * Named references other than amp, quot, apos, lt, gt and nbsp, and numbers
 * that are no character, are left as they are written.
 */
export const decodeHtmlEntities: HtmlTextFunction = (text: string): string => {
  return text.replace(
    CHARACTER_REFERENCE,
    (reference: string, name: string): string => {
      if (name.startsWith("#")) {
        const isHex: boolean = name.charAt(1).toLowerCase() === "x";
        const codePoint: number = parseInt(
          name.slice(isHex ? 2 : 1),
          isHex ? 16 : 10,
        );

        return codePoint <= LAST_CODE_POINT
          ? String.fromCodePoint(codePoint)
          : reference;
      }

      return NAMED_REFERENCES[name.toLowerCase()] ?? reference;
    },
  );
};

/**
 * What a reader sees of an HTML fragment - a link's words, a table cell, a
 * rendered note: the markup taken out (removeHtmlMarkup), then the
 * references decoded once. Taking the markup out first is what keeps an
 * escaped "&lt;b&gt;" the text "<b>" a person typed rather than a tag.
 * Whitespace is kept as it is.
 */
export const htmlAsText: HtmlTextFunction = (html: string): string => {
  return decodeHtmlEntities(removeHtmlMarkup(html));
};

// A <style> or <script> element and all it holds: text nobody is shown.
const STYLE_OR_SCRIPT_ELEMENT: RegExp =
  /<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const WHITESPACE_RUN: RegExp = /\s+/g;

/**
 * The words a reader sees on a page or in an email: what its <style> and
 * <script> elements hold left out, every tag and comment a space (so a
 * table's cells stay apart), the references decoded once, every run of
 * whitespace one space, and the ends trimmed. A comment is hidden whole, an
 * Outlook-only conditional comment ("<!--[if mso]>...<![endif]-->") too,
 * as every other client hides it.
 */
export const visibleText: HtmlTextFunction = (html: string): string => {
  return decodeHtmlEntities(
    markupAsSpaces(html.replace(STYLE_OR_SCRIPT_ELEMENT, " ")),
  )
    .replace(WHITESPACE_RUN, " ")
    .trim();
};

// A character reference, as a Telegram message's length counts one.
const COUNTED_REFERENCE: RegExp = /&(?:#\d+|[a-z]+);/g;

export type TextLengthFunction = (html: string) => number;

/**
 * A message in HTML, counted as Telegram counts it once its formatting is
 * read: a tag takes nothing, and a character reference ("&amp;", "&#39;")
 * one character.
 */
export const telegramTextLength: TextLengthFunction = (
  html: string,
): number => {
  return removeHtmlMarkup(html).replace(COUNTED_REFERENCE, "_").length;
};
