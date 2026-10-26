import { replaceHtmlMarkup } from "../../Types/HtmlMarkup";
import { decodeHtmlEntities } from "./HtmlText";
import { StartTag, TagAttribute, readStartTag } from "./MarkupReferences";

/*
 * WHAT A SCREEN READER SAYS FOR A PIECE OF HTML, IN ORDER.
 *
 * For the tests of markup OneUptime writes - an email's header, a card -
 * that must name something once: the text a reader hears, and the alt
 * text of each image, leaving out
 *
 *   - whatever an element marked aria-hidden="true" holds, all of it, and
 *     what one that is never displayed holds (styled display:none, as an
 *     email's inbox preview line is, or marked hidden);
 *   - an image whose alt is empty, which a screen reader passes over as
 *     decoration, and one marked role="presentation" or "none";
 *   - what is never shown: comments (Outlook's conditional ones too: other
 *     clients hide them, and Outlook's own reader is not what this checks),
 *     the head and title, styles and scripts.
 *
 * Each piece of text has its character references decoded once and every
 * run of whitespace read as one space; a piece left with no words is
 * dropped. The markup is read by the walk product code reads markup with
 * (replaceHtmlMarkup) and each tag a character at a time (readStartTag),
 * never by a pattern over the HTML.
 */

// Elements that hold nothing a screen reader says.
const NEVER_READ: ReadonlySet<string> = new Set<string>([
  "head",
  "title",
  "style",
  "script",
  "template",
]);

// Elements with no end tag: nothing is inside them.
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

/*
 * Elements the walk hands over whole, start tag to end tag (rawTextElements):
 * nothing in them is shown, and nothing is left open after them.
 */
const READ_WHOLE: ReadonlySet<string> = new Set<string>([
  "style",
  "script",
  "iframe",
  "noembed",
  "noframes",
]);

// What the walk leaves where each tag was: a character no email holds.
const TAG_MARK: string = "\u{0000}";

const WHITESPACE_RUN: RegExp = /\s+/g;

// Whether an element's style keeps it from being displayed at all.
const isStyledNotDisplayed: (style: string | undefined) => boolean = (
  style: string | undefined,
): boolean => {
  return (style || "")
    .toLowerCase()
    .replace(WHITESPACE_RUN, "")
    .includes("display:none");
};

interface OpenElement {
  name: string;
  isHidden: boolean;
}

const attributeOf: (tag: StartTag, name: string) => string | undefined = (
  tag: StartTag,
  name: string,
): string | undefined => {
  return tag.attributes.find((attribute: TagAttribute): boolean => {
    return attribute.name === name;
  })?.value;
};

// The name of the end tag `markup` is ("</td >" is "td").
const endTagName: (markup: string) => string = (markup: string): string => {
  let name: string = "";

  for (let index: number = 2; index < markup.length; index++) {
    const character: string = markup[index]!;

    if (character === ">" || character === "/" || character.trim() === "") {
      break;
    }

    name += character;
  }

  return name.toLowerCase();
};

const asSpokenText: (text: string) => string = (text: string): string => {
  return decodeHtmlEntities(text).replace(WHITESPACE_RUN, " ").trim();
};

/**
 * What a screen reader says for `html`, piece by piece: each run of text
 * between tags, and each image's alt text, that aria-hidden does not hide
 * (see the top of this file).
 */
export const screenReaderPieces: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const tags: Array<string> = [];

  const texts: Array<string> = replaceHtmlMarkup(
    html,
    (markup: string): string => {
      tags.push(markup);
      return TAG_MARK;
    },
    { rawTextElements: true },
  ).split(TAG_MARK);

  const open: Array<OpenElement> = [];
  const pieces: Array<string> = [];

  const isHiddenNow: () => boolean = (): boolean => {
    return open.length > 0 && open[open.length - 1]!.isHidden;
  };

  const say: (text: string) => void = (text: string): void => {
    const spoken: string = asSpokenText(text);

    if (spoken) {
      pieces.push(spoken);
    }
  };

  for (let index: number = 0; index < texts.length; index++) {
    if (!isHiddenNow()) {
      say(texts[index]!);
    }

    const markup: string | undefined = tags[index];

    if (markup === undefined || markup.startsWith("<!")) {
      // The end, a comment, or a doctype: nothing is said.
      continue;
    }

    if (markup.startsWith("</")) {
      const name: string = endTagName(markup);
      const at: number = open
        .map((element: OpenElement): string => {
          return element.name;
        })
        .lastIndexOf(name);

      if (at !== -1) {
        open.length = at;
      }

      continue;
    }

    const tag: StartTag = readStartTag(markup);
    const role: string = (attributeOf(tag, "role") || "").trim().toLowerCase();
    const isHidden: boolean =
      isHiddenNow() ||
      NEVER_READ.has(tag.name) ||
      (attributeOf(tag, "aria-hidden") || "").trim().toLowerCase() === "true" ||
      attributeOf(tag, "hidden") !== undefined ||
      isStyledNotDisplayed(attributeOf(tag, "style"));

    if (tag.name === "img") {
      if (!isHidden && role !== "presentation" && role !== "none") {
        say(attributeOf(tag, "alt") || "");
      }

      continue;
    }

    if (
      VOID_ELEMENTS.has(tag.name) ||
      READ_WHOLE.has(tag.name) ||
      markup.endsWith("/>")
    ) {
      continue;
    }

    open.push({ name: tag.name, isHidden: isHidden });
  }

  return pieces;
};

/**
 * What a screen reader says for `html`, as one line: the pieces of
 * screenReaderPieces with a space between them.
 */
export const screenReaderText: (html: string) => string = (
  html: string,
): string => {
  return screenReaderPieces(html).join(" ");
};

// How many times a screen reader says `word` as a whole piece or within one.
export const timesSaid: (html: string, word: string) => number = (
  html: string,
  word: string,
): number => {
  let count: number = 0;

  for (const piece of screenReaderPieces(html)) {
    let at: number = piece.indexOf(word);

    while (at !== -1) {
      count++;
      at = piece.indexOf(word, at + word.length);
    }
  }

  return count;
};
