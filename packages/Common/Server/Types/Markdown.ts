import {
  Marked,
  MarkedOptions,
  Renderer,
  Tokenizer,
  Tokens,
  marked,
} from "marked";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import markdownSlugify from "./MarkdownSlugify";
import { addCodeBreakOpportunities } from "./MarkdownCodeBreaks";
import {
  DOCS_CALLOUT_TYPES,
  docsMarkdownExtensions,
  docsSafeUrl,
  renderDocsCallout,
} from "./MarkdownDocsExtensions";
import SafeHtml from "../../Types/SafeHtml";
import {
  MarkupInTextReading,
  removeMarkupFromText,
} from "../../Types/HtmlMarkup";
import {
  InlineImageDataUri,
  isInlineImageDataUriPrefix,
  parseInlineImageDataUri,
} from "../../Utils/Markdown/InlineImageDataUri";
import {
  Base64Run,
  getBase64Runs,
  holdBackBase64Data,
} from "../../Utils/Markdown/Base64Data";
import {
  LinkReferenceDefinition,
  NestedLinkReferenceDefinition,
  forEachBracketedLabel,
  getLinkReferenceDefinitions,
} from "../../Utils/Markdown/LinkReferenceDefinitions";
import {
  IsCodeFunction,
  isDigitCode,
  isWordCode,
} from "../../Utils/RegExpCharacterClasses";
import {
  holdBackOverLongLines,
  holdBackOverLongText,
  mayHoldBack,
} from "../../Utils/Markdown/OverLongText";
import {
  SLOW_MARKDOWN_MAX_INLINE_WORK,
  SLOW_MARKDOWN_MAX_NESTING_DEPTH,
  SlowMarkdownLimits,
  holdBackSlowMarkdown,
} from "../../Utils/Markdown/SlowMarkdown";
import logger from "../Utils/Logger";
import EmailInlineImages from "../Utils/Mail/EmailInlineImages";
import EmailSize, {
  EMAIL_TRUNCATED_TEXT_NOTE_HTML,
  MAX_EMAIL_FIELD_HTML_BYTES,
} from "../Utils/Mail/EmailSize";

export type MarkdownRenderer = Renderer;

export enum MarkdownContentType {
  Docs,
  Blog,
  Email,
  // Compact rendering tuned for small surfaces (e.g. the blog validation modal).
  BlogValidation,
}

/*
 * Private Use Area sentinels used by convertToPlainText. Any already in the
 * input are held back first, so every sentinel in the working text is one
 * the function put there. Always write them as \u escapes, never as raw
 * characters.
 *   PLACEHOLDER_OPEN + index + PLACEHOLDER_CLOSE  held-back literal text
 *   PARAGRAPH_BREAK     marks a blank line while emphasis is removed
 *   LITERAL_UNDERSCORE  an intraword "_" (snake_case), restored as "_"
 *   WORD_EDGE           sits between a letter/digit and an underscore run
 */
const PLACEHOLDER_OPEN: string = "\uE000";
const PLACEHOLDER_CLOSE: string = "\uE001";
const PLACEHOLDER_PATTERN: RegExp = /\uE000(\d+)\uE001/g;
const PARAGRAPH_BREAK: string = "\uE002";
const LITERAL_UNDERSCORE: string = "\uE003";
const WORD_EDGE: string = "\uE004";
const FIRST_SENTINEL_CODE: number = 0xe000;
const LAST_SENTINEL_CODE: number = 0xe004;
// The last of PLACEHOLDER_OPEN, PLACEHOLDER_CLOSE and PARAGRAPH_BREAK.
const LAST_TAG_BREAK_CODE: number = 0xe002;

/*
 * How convertToPlainText reads the HTML in Markdown
 * (removeMarkupFromText): no tag reaches across held-back text or a blank
 * line - their placeholders and marks, U+E000 to U+E002 - and no tag or
 * comment holds more than 65536 characters, the most any step that reads
 * across lines takes.
 */
export const PLAIN_TEXT_MARKUP_READING: MarkupInTextReading = {
  tagCannotHold: (code: number): boolean => {
    return code >= FIRST_SENTINEL_CODE && code <= LAST_TAG_BREAK_CODE;
  },
  maxLength: 65536,
};

/*
 * Private Use Area sentinels convertToHTML puts in place of what it holds
 * back from marked while marked reads EMAIL Markdown - long base64 data and
 * over-long text (see holdBackFromMarked):
 *   HELD_DATA_OPEN + index + HELD_DATA_CLOSE
 * Any already in the input are held back the same way, so every one marked
 * sees is one convertToHTML put there. Always write them as \u escapes,
 * never as raw characters.
 */
const HELD_DATA_OPEN: string = "\uE005";
const HELD_DATA_CLOSE: string = "\uE006";
const HELD_DATA_OPEN_CODE: number = 0xe005;
const HELD_DATA_CLOSE_CODE: number = 0xe006;

/*
 * The most Markdown marked reads for an email once what it cannot read
 * safely is held back (holdBackFromMarked). Markdown with more left than
 * this - a log of megabytes whose every line holds a "|", a "<" or a "`",
 * a table of a hundred thousand rows - is sent as text (getEmailTextHtml):
 * marked ran out of stack on a few megabytes of it, took seconds on less,
 * and an email's table is some thirty times the size of its Markdown.
 */
export const MAX_MARKED_EMAIL_MARKDOWN_LENGTH: number = 1024 * 1024;

/*
 * The most the copies of screenshots an email field's references are given
 * may put back, in characters, in all (withHeldDataInUrls). marked writes a
 * link reference definition's address into every reference to it, so a
 * screenshot defined once can be shown many times - and a screenshot of
 * 1 MB referenced 200 times was 280 MB of HTML before its images went out
 * as attachments, took seconds to render, and one of 2.25 MB referenced 200
 * times made more than V8's longest string: marked failed, and the email
 * went out as its Markdown in text (issue #6481). A copy of a screenshot is
 * an image whose address is an inline image (parseInlineImageDataUri),
 * which goes out as an attachment; every other copy stays in the email's
 * HTML, and counts against MAX_EMAIL_COPIED_HTML_IN_REFERENCES. The text's
 * own copy - an image's own address, or the first reference to a
 * definition - counts against neither: the text holds it once already.
 *
 * Why 8 MiB:
 *   - an email attaches at most MaxEmailInlineImageBytes (2 MB, about
 *     2.7 MB of base64) of distinct images, so more than that only shows
 *     the same images again;
 *   - one email carries several Markdown fields - a description, a root
 *     cause, remediation notes - in one request to the notification
 *     service, whose JSON body may be at most 50 MB (jsonBodyParserOptions
 *     in Server/Utils/StartServer);
 *   - and within it, a screenshot of 1 MB still shows six times and one of
 *     100 KB sixty-two times, every one of them from one attachment.
 * The dashboard's viewer holds what remark copies the same way
 * (MAX_HELD_TEXT_IN_REFERENCES, UI/Components/Markdown.tsx/
 * MarkdownViewerOverLongText.ts), with twice as much: a page shows one
 * text, where one request carries several.
 */
export const MAX_EMAIL_HELD_TEXT_IN_REFERENCES: number = 8 * 1024 * 1024;

/*
 * The most HTML the copies of addresses that stay in an email field's HTML
 * - a link's, an image's from the web - may write in one render, in all;
 * and the copies of titles as much again (withHeldDataInUrls, #6962).
 * marked writes a definition's address and title into every reference to
 * it, and those copies are the field's HTML, which an email holds to
 * MAX_EMAIL_FIELD_HTML_BYTES: two hundred references to an image address of
 * 60 KB, or to one with a title of 2 KB, were more than a field keeps, so
 * the field was cut to fit - and the cut took the definition at its end,
 * and every reference showed as Markdown. Past it, a copy's title is left
 * out, an image is the note an email leaves in place of an image too large
 * to include, and a link is its text.
 *
 * Why a quarter of a field each: addresses and titles together take at
 * most half of what a field keeps, and the text the other half; and a short
 * address or title - a page's address, an error's first line - is copied
 * into hundreds of references within it, as it always was.
 */
export const MAX_EMAIL_COPIED_HTML_IN_REFERENCES: number =
  MAX_EMAIL_FIELD_HTML_BYTES / 4;

/*
 * What marked is given of an email's Markdown at most, once what is too
 * long for it is held back (Utils/Markdown/SlowMarkdown): blocks whose
 * emphasis, code spans, links or escapes would make it look ahead through
 * them for too long, and blocks nested too deep, are written as text.
 * marked reads lines, lists and tables in linear time, so their number is
 * not limited. A block is counted as marked reads it (countAsMarked,
 * #7228): a link or a reference whose label closes costs it a copy of the
 * block, and a link's address and title, or a definition's, are read once -
 * so a paragraph of a thousand references, or a link to an address with a
 * long query, reaches marked and renders as links.
 */
export const EMAIL_SLOW_MARKDOWN_LIMITS: SlowMarkdownLimits = {
  maxInlineWork: SLOW_MARKDOWN_MAX_INLINE_WORK,
  maxRunLines: Number.POSITIVE_INFINITY,
  maxLines: Number.POSITIVE_INFINITY,
  maxUnitLines: Number.POSITIVE_INFINITY,
  maxUnitLength: Number.POSITIVE_INFINITY,
  maxNestingDepth: SLOW_MARKDOWN_MAX_NESTING_DEPTH,
  maxCellsPerLine: Number.POSITIVE_INFINITY,
  holdBackCodeBlockContent: false,
  countUrlLiterals: false,
  countWordUnderscores: false,
  countAsMarked: true,
};

/*
 * convertToHTML renders an email field shorter at most this many times
 * after the first, each time to this share of what would just fit
 * (convertToEmailHtml).
 */
const MAX_EMAIL_FIT_ATTEMPTS: number = 5;
const EMAIL_FIT_MARGIN: number = 0.9;

/*
 * Where an image is in Markdown: "![", its address and where its data ends
 * (after any "=" padding), and after its ")".
 */
interface MarkdownImagePosition {
  start: number;
  addressStart: number;
  addressEnd: number;
  end: number;
}

/*
 * What a data: URL's media type and encoding read, before its data - any
 * type: whether it is an image an email sends is parseInlineImageDataUri's
 * to say.
 */
const IMAGE_DATA_URL_PREFIX: RegExp =
  /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,$/i;

// The longest an image's data: URL is read for, before its data.
const IMAGE_DATA_URL_PREFIX_MAX_LENGTH: number = 64;

/*
 * How far from an image's data its "![" may be, and its ")": the length of
 * an alt text or a title (findImageAround).
 */
const IMAGE_SYNTAX_WINDOW: number = 1024;

interface HeldBackMarkdown {
  // The Markdown, with what marked cannot read safely held back.
  markdown: string;
  // `value` with what was held back put back as it was written: for a URL.
  restore: (value: string) => string;
  /*
   * `value` - HTML marked rendered - with what was held back put back
   * escaped, as marked escapes text.
   */
  restoreEscaped: (value: string) => string;
  /*
   * The held-back texts `value` holds, by index, in the order it holds
   * them: none when it holds none.
   */
  heldIn: (value: string) => Array<number>;
}

/*
 * EMAIL Markdown as cutEmailMarkdown reads it (readEmailMarkdownToCut): its
 * line breaks as marked reads them, its base64 runs and its link reference
 * definitions.
 */
interface EmailMarkdownToCut {
  markdown: string;
  runs: Array<Base64Run>;
  definitions: Array<LinkReferenceDefinition>;
}

/*
 * A link reference definition as a field cut to fit writes it on a line of
 * its own (cutEmailMarkdown): whole, without its title, or empty - and what
 * the first two weigh (getEmailMarkdownWeight), the line break after them
 * left out.
 */
interface CutDefinitionLines {
  whole: string;
  wholeWeight: number;
  withoutTitle: string;
  withoutTitleWeight: number;
  empty: string;
}

/*
 * What becomes of an image's or a link's address (withHeldDataInUrls): put
 * back whole for the renderer ("kept") - the text's own, or a copy within
 * its budget (`isCopy`); or not, because an email cannot keep the address
 * ("refused"), or because it is a copy past its budget ("leftOut").
 */
type HeldAddress =
  | { fate: "kept"; href: string; isCopy: boolean }
  | { fate: "refused" }
  | { fate: "leftOut" };

/*
 * What each copy of an address costs, learned from its first copy: a
 * screenshot's (`isScreenshot`: an inline image, which goes out as an
 * attachment), the characters it puts back, of
 * MAX_EMAIL_HELD_TEXT_IN_REFERENCES; any other's, the HTML the renderer
 * writes of it - ASCII alone, so its bytes - of
 * MAX_EMAIL_COPIED_HTML_IN_REFERENCES. null when the renderer does not keep
 * the address: each copy is then its text or alt text, and costs nothing.
 */
type CopyVerdict = { isScreenshot: boolean; cost: number } | null;

/*
 * An address as marked gives it to the renderer - a definition's mark, or
 * an image's or a link's own address - as withHeldDataInUrls reads it, once
 * for every image or link it is given to.
 */
interface HeldAddressReading {
  // The address as marked read it: what was held back of it still held back.
  address: string;
  // Whether it is a link reference definition's, given to its every reference.
  isDefinition: boolean;
  // The held-back texts it holds, by index.
  indexes: Array<number>;
  // Whether an email cannot keep it, whatever was held back of it.
  isRefused: boolean;
  // What a copy of it costs: judged when its first copy is put back.
  verdict: CopyVerdict | undefined;
}

/*
 * A title as marked gives it to the renderer - a definition's mark, or an
 * image's or a link's own title - as withHeldDataInUrls reads it, once for
 * every image or link it is given to.
 */
interface HeldTitleReading {
  // The title as marked writes it: escaped for its attribute.
  title: string;
  // The held-back texts it holds, by index.
  indexes: Array<number>;
  // The HTML it writes, in bytes.
  size: number;
}

/*
 * How withHeldDataInUrls judges one kind of address - an image's, or a
 * link's - as the email renderer judges it, and what it has read of the
 * addresses of that kind in one render.
 */
interface HeldAddressRules {
  // The schemes the renderer keeps an address of this kind with.
  schemes: ReadonlyArray<string>;
  // Whether a data: address of this kind can still be an inline image.
  mayBeInlineImage: boolean;
  // What a copy of an address of this kind, put back whole, costs.
  judge: (href: string) => CopyVerdict;
  // The addresses read, by the address as marked gives it.
  readings: Map<string, HeldAddressReading>;
}

// A link reference definition as marked read it (EmailMarkedTokenizer).
interface MarkedDefinition {
  href: string;
  // Escaped as marked escapes a title (escapeLikeMarkedTitle); null for none.
  title: string | null;
}

// What marked's tokenizer writes in a title for each character it escapes.
const MARKED_TITLE_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// What [a-fA-F0-9] matches.
const isHexDigitCode: IsCodeFunction = (code: number): boolean => {
  return (
    isDigitCode(code) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
};

/*
 * Whether `text` from `at` - just after an "&" - reads as marked reads a
 * character reference it leaves as it is: "#", one to seven digits and
 * ";"; "#x" or "#X", one to six hexadecimal digits and ";"; or a word
 * (letters, digits and "_") and ";".
 */
const startsCharacterReference: (text: string, at: number) => boolean = (
  text: string,
  at: number,
): boolean => {
  let end: number = at;

  if (text.charAt(at) === "#") {
    const isHex: boolean =
      text.charAt(at + 1) === "x" || text.charAt(at + 1) === "X";
    const digitsStart: number = at + (isHex ? 2 : 1);

    end = digitsStart;

    const isDigit: IsCodeFunction = isHex ? isHexDigitCode : isDigitCode;

    while (end < text.length && isDigit(text.charCodeAt(end))) {
      end++;
    }

    return (
      end > digitsStart &&
      end - digitsStart <= (isHex ? 6 : 7) &&
      text.charAt(end) === ";"
    );
  }

  while (end < text.length && isWordCode(text.charCodeAt(end))) {
    end++;
  }

  return end > at && text.charAt(end) === ";";
};

/*
 * `title` escaped as marked's tokenizer escapes a link's or an image's title
 * (`escape` in marked, not encoding): "<", ">", '"' and "'", and an "&"
 * that does not start a character reference - "&amp;", "&#39;" and
 * "&copy;" stay as they are written. Read with a loop: a title can be as
 * long as the lines it is on.
 */
const escapeLikeMarkedTitle: (title: string) => string = (
  title: string,
): string => {
  let escaped: string = "";
  let copiedUpTo: number = 0;

  for (let index: number = 0; index < title.length; index++) {
    const character: string = title.charAt(index);
    const replacement: string | undefined = MARKED_TITLE_ESCAPES[character];

    if (
      replacement === undefined ||
      (character === "&" && startsCharacterReference(title, index + 1))
    ) {
      continue;
    }

    escaped += title.slice(copiedUpTo, index) + replacement;
    copiedUpTo = index + 1;
  }

  return copiedUpTo === 0 ? title : escaped + title.slice(copiedUpTo);
};

/*
 * marked's tokenizer for one email render, which gives each link reference
 * definition's address and title marks of their own in their place. marked
 * writes a definition's address and title into every reference to it
 * (`outputLink`), so the renderer is given the marks wherever an image or a
 * link is a reference, and reads from them which definition it refers to
 * (addressOf, titleOf): the first reference to take the address has the
 * text's own copy, every later one a copy (withHeldDataInUrls) - whether or
 * not anything of it was held back. An image or a link of its own is never
 * given a mark.
 *
 * And marked holds a mark for each reference, not a title: it escapes a
 * definition's title again for every reference, so a title of 60 KB with a
 * quote in it, referenced a hundred thousand times, was gigabytes before
 * anything was rendered. The title is escaped once, here, as marked would
 * have escaped it.
 *
 * A mark is HELD_DATA_OPEN, "a" for an address or "t" for a title, the
 * definition's number and HELD_DATA_CLOSE. No Markdown marked reads holds
 * one: a sentinel in the input is held back (holdBackFromMarked), and the
 * token of a held-back text holds digits alone.
 */
class EmailMarkedTokenizer extends Tokenizer {
  // The definitions as marked read them, by their number.
  private readonly definitions: Array<MarkedDefinition> = [];

  public override def(src: string): Tokens.Def | undefined {
    const token: Tokens.Def | undefined = super.def(src);

    if (token) {
      const number: number = this.definitions.length;

      this.definitions.push({
        href: token.href,
        title: token.title ? escapeLikeMarkedTitle(token.title) : null,
      });
      token.href = EmailMarkedTokenizer.mark("a", number);

      if (token.title) {
        token.title = EmailMarkedTokenizer.mark("t", number);
      }
    }

    return token;
  }

  /*
   * The address of the definition `href` marks; null when `href` is no
   * mark - an image's or a link's own address.
   */
  public addressOf(href: string): string | null {
    const number: number | null = this.markedNumber(href, "a");

    return number === null ? null : this.definitions[number]!.href;
  }

  /*
   * The title of the definition `title` marks, escaped as marked escapes a
   * title; null when `title` is no mark - an image's or a link's own title.
   */
  public titleOf(title: string): string | null {
    const number: number | null = this.markedNumber(title, "t");

    return number === null ? null : this.definitions[number]!.title;
  }

  private static mark(kind: string, number: number): string {
    return `${HELD_DATA_OPEN}${kind}${number}${HELD_DATA_CLOSE}`;
  }

  // The number of the definition `value` marks as `kind`, or null.
  private markedNumber(value: string, kind: string): number | null {
    if (
      typeof value !== "string" ||
      value.length < 4 ||
      value.charCodeAt(0) !== HELD_DATA_OPEN_CODE ||
      value.charAt(1) !== kind ||
      value.charCodeAt(value.length - 1) !== HELD_DATA_CLOSE_CODE
    ) {
      return null;
    }

    const digits: string = value.slice(2, -1);
    const number: number = Number(digits);

    return Number.isInteger(number) &&
      number >= 0 &&
      number < this.definitions.length &&
      String(number) === digits
      ? number
      : null;
  }
}

// Puts back what was held back: as it was written, or escaped for HTML.
type PutBackFunction = (value: string, escape: boolean) => string;

// Each fence run is taken whole, as the pattern took it first anyway (see FENCE_LINE_PATTERN in FeedMarkdown).
const FENCE_OPEN: RegExp =
  /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])[ \t])*(?:(`{3,}(?!`))[^`]*|(~{3,}(?!~)).*)$/;
const FENCE_CLOSE: RegExp = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/;

const ESCAPE_OR_BACKTICK_RUN: RegExp = /\\([!-/:-@[-`{-~])|`+/g;
const BACKTICK_RUN: RegExp = /`+/g;
const NOT_ONLY_SPACES: RegExp = /[^ ]/;

// GFM autolink literals leave these trailing characters outside the URL.
const BARE_URL_TRAILING_PUNCTUATION: string = "?!.,:*_~'\"";

const HTML_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

// The named references getEmailUrl decodes in a link destination.
const URL_NAMED_CHARACTER_REFERENCES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/*
 * The schemes an email may link to, and load an image from. A destination
 * with no scheme is also allowed (see Markdown.getEmailUrl). An image may
 * also be an inline raster image, a data: URL that carries a PNG, JPEG, GIF
 * or WebP itself (see Utils/Markdown/InlineImageDataUri) - never data: as a
 * scheme, which would let any data: URL through.
 */
export const EMAIL_LINK_SCHEMES: ReadonlyArray<string> = [
  "http",
  "https",
  "mailto",
];
export const EMAIL_IMAGE_SCHEMES: ReadonlyArray<string> = ["http", "https"];

// A URL's scheme, before its ":".
const URL_SCHEME_PATTERN: RegExp = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/*
 * The scheme a URL - encoded as getEmailUrl encodes it - starts with, in
 * lower case; null when it starts with none: a relative URL.
 */
const getUrlScheme: (url: string) => string | null = (
  url: string,
): string | null => {
  const scheme: RegExpMatchArray | null = url.match(URL_SCHEME_PATTERN);

  return scheme ? scheme[1]!.toLowerCase() : null;
};

/*
 * Every image in an email is scaled down to the width of the card it sits
 * in, never up. A screenshot is 1280 pixels wide or more, and the card leaves
 * about 416 (see getEmailRenderer); left at its own width it pushed the card
 * wider than a phone's screen, which is where an on-call engineer reads it.
 * Outlook's Word engine ignores max-width and shows the image at its own size.
 */
export const EMAIL_IMAGE_STYLE: string = "max-width:100%;height:auto;";

type HoldFunction = (value: string) => string;

interface BacktickRuns {
  starts: Array<number>;
  next: number;
}

export default class Markdown {
  /*
   * Markdown to plain text, for SMS, calls, push notifications, email
   * subjects and preheaders.
   *
   * THE ORDER OF THE STEPS IS THE POINT. Fenced code is dropped and code
   * spans, backslash-escaped characters and any sentinel character already
   * in the input are swapped for placeholders BEFORE any markup step runs,
   * and swapped back AFTER the last one, so no markup step can see inside
   * code or pair a marker inside it with a marker outside it: the "_" in
   * `http.status_code` must never pair with the "_" of a later _italic_
   * note, and `<pod>` inside a code span must never be stripped as a tag.
   * Autolink addresses are held back the same way before tags are stripped,
   * and bare URLs after tags, images and links are converted (so a URL in a
   * link target goes with the link) but before emphasis.
   *
   * Every regex is linear in the input. The emphasis regexes run WITHOUT the
   * u flag: a u-flag regex whose loop crosses a multi-MB two-byte string
   * overflows V8's backtrack stack (RangeError). The two Unicode-aware steps
   * (which underscores touch a letter or digit) loop over "_" alone and
   * leave marks that the emphasis steps read.
   *
   * NO QUANTIFIER TAKES MORE THAN A LINE'S WORTH. V8 matches a regex on a
   * backtracking stack that can grow with every character a quantifier
   * takes, and a process that has been running a while compiles regexes
   * unoptimized: then a quantifier that took a few million characters - a
   * long URL, a run of spaces, a minified JSON body, an unclosed tag - ran
   * out of stack ("Maximum call stack size exceeded"). So the middle of every
   * over-long line is held back first, as literal text
   * (Utils/Markdown/OverLongText): a quantifier that stays within a line
   * never takes more than OVER_LONG_LINE_LENGTH characters. One that can
   * cross lines - a tag, a link, emphasis, a run of whitespace - takes at
   * most 65536 ({0,65536}). Sentinels and whitespace are collapsed with
   * loops, after the held-back text is back.
   */
  @CaptureSpan()
  public static convertToPlainText(markdown: string): string {
    if (!markdown) {
      return "";
    }

    // A caller typed `string` can still hand over a number at runtime.
    let text: string =
      typeof markdown === "string" ? markdown : String(markdown);

    /*
     * Literal text held back from the markup steps, by placeholder index. A
     * value is resolved before it is stored, so it never contains a
     * placeholder and one restore pass at the end is enough.
     */
    const held: Array<string> = [];

    const restore: (value: string) => string = (value: string): string => {
      return value.replace(
        PLACEHOLDER_PATTERN,
        (_match: string, index: string): string => {
          return held[Number(index)] ?? "";
        },
      );
    };

    const hold: HoldFunction = (value: string): string => {
      held.push(restore(value));
      return `${PLACEHOLDER_OPEN}${held.length - 1}${PLACEHOLDER_CLOSE}`;
    };

    // Normalize line endings, so "\n" is the only line break the steps see.
    text = text.replace(/\r\n?/g, "\n");

    // Hold back sentinel characters already in the input, verbatim.
    text = Markdown.holdInputSentinels(text, hold);

    /*
     * Hold back the middle of every over-long line, verbatim: it reads as
     * written, and no step below reads more than a line's worth of it.
     */
    text = holdBackOverLongLines(text, hold);

    /*
     * CODE FIRST. Drop fenced code blocks, then hold back code spans and
     * escaped characters. Everything after this point sees code only as an
     * opaque placeholder.
     */
    text = Markdown.removeFencedCodeBlocks(text);
    text = Markdown.holdInlineCodeAndEscapes(text, hold);

    /*
     * Mark blank lines, so bold, strikethrough and HTML tags (which may wrap
     * onto the next line) cannot reach across a paragraph break.
     */
    text = text.replace(/\n(?=[^\S\n]*\n)/g, `\n${PARAGRAPH_BREAK}`);

    /*
     * Autolinks <https://...> and <someone@example.com> read as the address.
     * Entities are decoded now, as they are in a bare URL, because the entity
     * step below never sees held-back text ("?a=1&amp;b=2" reads "?a=1&b=2").
     */
    text = text.replace(
      /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/g,
      (_match: string, uri: string): string => {
        return hold(Markdown.decodeHtmlEntities(uri));
      },
    );
    text = text.replace(
      /<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+)>/g,
      (_match: string, email: string): string => {
        return hold(Markdown.decodeHtmlEntities(email));
      },
    );

    /*
     * Underscores next to letters or digits (the only Unicode-aware steps;
     * their loops are over "_" alone). A run with a letter, mark or digit on
     * both sides is intraword (snake_case, http.status_code, k8s.pod_name)
     * and is never emphasis, as in CommonMark: it becomes LITERAL_UNDERSCORE.
     * Any other run touching a letter or digit gets a WORD_EDGE on that side,
     * which tells the underscore steps below that it cannot open (letter
     * before it) or cannot close (letter after it) emphasis, so they need no
     * u flag. This runs BEFORE tags, links and emphasis are removed, so
     * flanking is judged on the source text: in "**b**_x_", "[l](u)_x_" and
     * "_x_[l](u)" the "_" touches punctuation, not the letters that end up
     * next to it.
     */
    text = text.replace(
      /(?<=[\p{L}\p{M}\p{N}])_+(?=[\p{L}\p{M}\p{N}])/gu,
      (run: string): string => {
        return LITERAL_UNDERSCORE.repeat(run.length);
      },
    );
    text = text.replace(
      /(?<=[\p{L}\p{M}\p{N}])(_+)|(?<!_)(_+)(?=[\p{L}\p{M}\p{N}])/gu,
      (
        _match: string,
        afterLetter: string | undefined,
        beforeLetter: string | undefined,
      ): string => {
        return afterLetter !== undefined
          ? WORD_EDGE + afterLetter
          : (beforeLetter ?? "") + WORD_EDGE;
      },
    );

    /*
     * Remove HTML tags: <tag ...>, </tag>, <!-- ... -->, <!DOCTYPE ...>,
     * <?...?>. Only a "<" that starts a tag counts, so "a < b and c > d"
     * survives. A tag never spans a placeholder or a blank line, so held-back
     * code ("Map<String, `k8s.pod_name`>") is never removed as part of a tag.
     * A backslash-escaped character is held back too, so it also keeps the
     * text around it from being read as a tag ("List<Foo\_Bar>" stays).
     * A comment may span both: it is hidden when rendered, code and all.
     * They come out completely: where taking one out joins the text either
     * side into another - "<scr<script>ipt>", "<<b>b>", "<b<i>x</i>>" -
     * that one goes too, until none is left (removeMarkupFromText, in one
     * walk). Text that one pass of the rule left no tag in reads exactly
     * as it did.
     */
    text = removeMarkupFromText(text, PLAIN_TEXT_MARKUP_READING);

    /*
     * Convert markdown images ![alt](url) to just alt text. Before links, or
     * the link step would leave the "!" behind.
     */
    text = text.replace(
      /!\[([^[\]]{0,65536})\]\((?!\))[^()]{0,65536}(?:\([^()]{0,65536}\)[^()]{0,65536})?\)/g,
      "$1",
    );

    /*
     * Convert markdown links [text](url) to just text. The URL may contain
     * one pair of parentheses, e.g. https://en.wikipedia.org/wiki/Foo_(bar).
     */
    text = text.replace(
      /\[([^[\]]{1,65536})\]\((?!\))[^()]{0,65536}(?:\([^()]{0,65536}\)[^()]{0,65536})?\)/g,
      "$1",
    );

    /*
     * Bare http(s) URLs are held back (GFM autolink literals), so emphasis
     * cannot eat a "_" or "*" inside one ("/d/_abc_/cpu_usage"). After tags
     * and links, so a URL in a tag attribute or a link target goes with it.
     */
    text = text.replace(/\bhttps?:\/\/[^\s<>]+/g, (url: string): string => {
      return Markdown.holdBareUrl(url, hold);
    });

    /*
     * Remove markdown bold/italic markers. An opening marker must be
     * followed by a non-space and a closing marker preceded by one, so
     * "5 * 3 * 2" and "* bullet" are not emphasis. Single markers (* and _)
     * never pair across a line break; double markers may wrap onto the next
     * line but never cross a blank line. An underscore run with a letter or
     * digit on its outer side (a WORD_EDGE there) cannot open or close. Bold
     * runs again after italic to unwrap "**a *b* c**"; italic runs after
     * bold to unwrap "***a***".
     */
    const boldStars: RegExp =
      /\*\*(?![\s*])([^*\uE002]{0,65536}[^\s*\uE002])\*\*/g;
    const italicStar: RegExp = /\*(?![\s*])([^*\n]*[^\s*])\*/g;
    const boldUnderscores: RegExp =
      /(?<!\uE004)__(?![\s_])([^_\uE002]{0,65536}[^\s_\uE002])__(?!\uE004)/g;
    const italicUnderscore: RegExp =
      /(?<![_\uE004])_(?![\s_])([^_\n]*[^\s_])_(?![_\uE004])/g;

    text = text.replace(boldStars, "$1"); // **bold**
    text = text.replace(italicStar, "$1"); // *italic*
    text = text.replace(boldStars, "$1"); // **bold *italic* bold**
    text = text.replace(boldUnderscores, "$1"); // __bold__
    text = text.replace(italicUnderscore, "$1"); // _italic_
    text = text.replace(boldUnderscores, "$1"); // __bold _italic_ bold__

    // Remove markdown strikethrough
    text = text.replace(
      /~~(?![\s~])([^~\uE002]{0,65536}[^\s~\uE002])~~/g,
      "$1",
    );

    // Drop the blank-line and word-edge marks again.
    text = text.split(PARAGRAPH_BREAK).join("");
    text = text.split(WORD_EDGE).join("");

    // Remove markdown headers
    text = text.replace(/^#{1,6}\s{1,65536}/gm, "");

    // Remove markdown blockquotes
    text = text.replace(/^>\s{1,65536}/gm, "");

    // Remove markdown horizontal rules: "---", "***", "___", "* * *", "- - -"
    text = text.replace(
      /^(?=[ \t]*[-*_][ \t]*[-*_][ \t]*[-*_])[-*_ \t]*$/gm,
      "",
    );

    // Remove markdown list markers
    text = text.replace(/^[^\S\n]*[-*+]\s{1,65536}/gm, "");
    text = text.replace(/^[^\S\n]*\d+\.\s{1,65536}/gm, "");

    /*
     * Decode HTML entities. Code is still a placeholder here, so entities
     * inside code stay literal ("`a &amp;&amp; b`" shows as written).
     */
    text = Markdown.decodeHtmlEntities(text);

    /*
     * Put the held-back text back. This must run after every markup step and
     * the entity step (so code stays literal) and before the whitespace
     * steps (so whitespace inside code collapses like the rest of the text).
     * Intraword underscores first: a held-back input sentinel may itself be
     * a U+E003 and must come back as one.
     */
    text = text.split(LITERAL_UNDERSCORE).join("_");
    text = restore(text);

    /*
     * Normalize whitespace - collapse multiple spaces/newlines. A loop: the
     * held-back text is back, and a run of whitespace can be megabytes.
     */
    text = Markdown.collapseWhitespace(text);

    // Trim whitespace
    text = text.trim();

    return text;
  }

  /*
   * Every run of sentinel characters already in the input, held back as it
   * is (see PLACEHOLDER_OPEN). A loop: a run can be megabytes long.
   */
  private static holdInputSentinels(text: string, hold: HoldFunction): string {
    let result: string = "";
    let copiedUpTo: number = 0;
    let index: number = 0;

    while (index < text.length) {
      const code: number = text.charCodeAt(index);

      if (code < FIRST_SENTINEL_CODE || code > LAST_SENTINEL_CODE) {
        index++;
        continue;
      }

      let runEnd: number = index + 1;

      while (runEnd < text.length) {
        const next: number = text.charCodeAt(runEnd);

        if (next < FIRST_SENTINEL_CODE || next > LAST_SENTINEL_CODE) {
          break;
        }

        runEnd++;
      }

      result += text.slice(copiedUpTo, index) + hold(text.slice(index, runEnd));
      copiedUpTo = runEnd;
      index = runEnd;
    }

    return copiedUpTo === 0 ? text : result + text.slice(copiedUpTo);
  }

  /*
   * What text.replace(/\n\s*\n/g, "\n").replace(/[ \t]+/g, " ") makes of
   * `text`, with loops: from a line break, a run of whitespace up to its
   * last line break becomes one line break, and then every run of spaces
   * and tabs one space.
   */
  private static collapseWhitespace(text: string): string {
    let lines: string = "";
    let copiedUpTo: number = 0;
    let index: number = text.indexOf("\n");

    while (index !== -1) {
      let runEnd: number = index + 1;
      let lastLineBreak: number = -1;

      while (
        runEnd < text.length &&
        Markdown.isRegExpWhitespace(text.charCodeAt(runEnd))
      ) {
        if (text.charCodeAt(runEnd) === 0x0a) {
          lastLineBreak = runEnd;
        }

        runEnd++;
      }

      if (lastLineBreak === -1) {
        index = text.indexOf("\n", index + 1);
        continue;
      }

      lines += text.slice(copiedUpTo, index) + "\n";
      copiedUpTo = lastLineBreak + 1;
      index = text.indexOf("\n", copiedUpTo);
    }

    lines += text.slice(copiedUpTo);

    let collapsed: string = "";
    let runStart: number = -1;
    copiedUpTo = 0;

    for (let position: number = 0; position <= lines.length; position++) {
      const code: number =
        position < lines.length ? lines.charCodeAt(position) : -1;
      const isSpaceOrTab: boolean = code === 0x20 || code === 0x09;

      if (isSpaceOrTab && runStart === -1) {
        runStart = position;
      }

      if (!isSpaceOrTab && runStart !== -1) {
        collapsed += lines.slice(copiedUpTo, runStart) + " ";
        copiedUpTo = position;
        runStart = -1;
      }
    }

    return collapsed + lines.slice(copiedUpTo);
  }

  // Whether a UTF-16 code unit is whitespace to a regular expression's \s.
  private static isRegExpWhitespace(code: number): boolean {
    return (
      (code >= 0x09 && code <= 0x0d) ||
      code === 0x20 ||
      code === 0xa0 ||
      code === 0x1680 ||
      (code >= 0x2000 && code <= 0x200a) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0x202f ||
      code === 0x205f ||
      code === 0x3000 ||
      code === 0xfeff
    );
  }

  /*
   * Fenced code blocks are dropped, but only real ones: a line that opens
   * with three or more backticks or tildes (after optional indentation, ">"
   * quote markers and list markers such as "- " or "1. "; a backtick fence's
   * info string holds no backtick), through the next line holding only a
   * fence of the same character at least as long. A fence that is never
   * closed stays as ordinary text instead of swallowing the rest of the
   * message, and "Run ```npm install``` first" is a code span, not a fence.
   * The list markers matter: without them the indented closer of
   * "1. ```bash" would open a block of its own and swallow the list items
   * up to the next fence.
   *
   * The block becomes one empty line, so the text on either side stays two
   * paragraphs and no emphasis pairs across it.
   *
   * Linear: the longest closing fence at or after each line is computed
   * once, from the end, so an unclosed opener is recognised without
   * rescanning.
   */
  private static removeFencedCodeBlocks(text: string): string {
    if (text.indexOf("```") === -1 && text.indexOf("~~~") === -1) {
      return text;
    }

    const lines: Array<string> = text.split("\n");

    // The fence (e.g. "```") a line closes with, or "" when it is no closer.
    const closingFences: Array<string> = lines.map((line: string): string => {
      return FENCE_CLOSE.exec(line)?.[1] ?? "";
    });

    const longestBacktickCloseFrom: Array<number> = new Array<number>(
      lines.length + 1,
    ).fill(0);
    const longestTildeCloseFrom: Array<number> = new Array<number>(
      lines.length + 1,
    ).fill(0);

    for (let i: number = lines.length - 1; i >= 0; i--) {
      const fence: string = closingFences[i] ?? "";
      const backtickAfter: number = longestBacktickCloseFrom[i + 1] ?? 0;
      const tildeAfter: number = longestTildeCloseFrom[i + 1] ?? 0;

      longestBacktickCloseFrom[i] = fence.startsWith("`")
        ? Math.max(backtickAfter, fence.length)
        : backtickAfter;
      longestTildeCloseFrom[i] = fence.startsWith("~")
        ? Math.max(tildeAfter, fence.length)
        : tildeAfter;
    }

    const kept: Array<string> = [];
    let i: number = 0;

    while (i < lines.length) {
      const line: string = lines[i] ?? "";
      const open: RegExpExecArray | null = FENCE_OPEN.exec(line);
      const fence: string = open ? open[1] ?? open[2] ?? "" : "";
      const longestCloseAfter: number = fence.startsWith("`")
        ? longestBacktickCloseFrom[i + 1] ?? 0
        : longestTildeCloseFrom[i + 1] ?? 0;

      if (fence && longestCloseAfter >= fence.length) {
        let end: number = i + 1;

        while (
          !(
            (closingFences[end] ?? "").startsWith(fence[0] ?? "") &&
            (closingFences[end] ?? "").length >= fence.length
          )
        ) {
          end++;
        }

        kept.push("");
        i = end + 1;
        continue;
      }

      kept.push(line);
      i++;
    }

    return kept.join("\n");
  }

  /*
   * Inline code spans and backslash escapes, in one left-to-right pass
   * because each decides what the other means: "\`" is a literal backtick,
   * not the start of a span, while a backslash inside a span is literal.
   *
   * A span opens with a run of N backticks and closes at the next run of
   * exactly N backticks ON THE SAME LINE, so ``a`b`` is "a`b" and a stray
   * backtick in one table row or list item can never pair with a code span
   * on the next. A run with no closer on its line stays as literal backticks.
   *
   * When N >= 2, one leading and one trailing space are stripped when both
   * are present (CommonMark), which is how AffectedResourceList.code() pads
   * a name that contains a backtick ("`` web`01 ``"). A single-backtick
   * span keeps its content unchanged, so two stray backticks that happen to
   * pair ("Don't paste ` here. It's `broken") never glue words together.
   *
   * A backslash before ASCII punctuation is dropped and the character is
   * held back, so "\*" is a literal "*".
   *
   * Linear: every backtick run is indexed by length up front and each
   * length's cursor only moves forward, so a run that never closes is not
   * rescanned.
   */
  private static holdInlineCodeAndEscapes(
    text: string,
    hold: HoldFunction,
  ): string {
    if (text.indexOf("`") === -1 && text.indexOf("\\") === -1) {
      return text;
    }

    const runsByLength: Map<number, BacktickRuns> = new Map();
    const runPattern: RegExp = new RegExp(BACKTICK_RUN.source, "g");
    let run: RegExpExecArray | null = runPattern.exec(text);

    while (run !== null) {
      let runs: BacktickRuns | undefined = runsByLength.get(run[0].length);

      if (!runs) {
        runs = { starts: [], next: 0 };
        runsByLength.set(run[0].length, runs);
      }

      runs.starts.push(run.index);
      run = runPattern.exec(text);
    }

    const tokenPattern: RegExp = new RegExp(ESCAPE_OR_BACKTICK_RUN.source, "g");
    let result: string = "";
    let copiedUpTo: number = 0;
    let lineEnd: number = -1;
    let token: RegExpExecArray | null = tokenPattern.exec(text);

    for (; token !== null; token = tokenPattern.exec(text)) {
      const escaped: string | undefined = token[1];

      if (escaped !== undefined) {
        result += text.slice(copiedUpTo, token.index) + hold(escaped);
        copiedUpTo = tokenPattern.lastIndex;
        continue;
      }

      const fenceLength: number = token[0].length;
      const openEnd: number = tokenPattern.lastIndex;

      if (lineEnd < token.index) {
        lineEnd = text.indexOf("\n", token.index);

        if (lineEnd === -1) {
          lineEnd = text.length;
        }
      }

      /*
       * After an escaped backtick the opener is the rest of a longer run,
       * and may have no same-length run anywhere.
       */
      const runs: BacktickRuns | undefined = runsByLength.get(fenceLength);

      if (!runs) {
        continue;
      }

      while ((runs.starts[runs.next] ?? Infinity) < openEnd) {
        runs.next++;
      }

      const closeStart: number | undefined = runs.starts[runs.next];

      if (closeStart === undefined || closeStart > lineEnd) {
        continue;
      }

      let code: string = text.slice(openEnd, closeStart);

      if (
        fenceLength >= 2 &&
        code.startsWith(" ") &&
        code.endsWith(" ") &&
        NOT_ONLY_SPACES.test(code)
      ) {
        code = code.slice(1, -1);
      }

      result += text.slice(copiedUpTo, token.index) + hold(code);
      copiedUpTo = closeStart + fenceLength;
      tokenPattern.lastIndex = copiedUpTo;
    }

    return result + text.slice(copiedUpTo);
  }

  /*
   * Hold back a bare URL found by /\bhttps?:\/\/[^\s<>]+/. As in GFM,
   * trailing punctuation (".", ",", "*", "_", ...) and an unbalanced ")"
   * stay outside the URL, so "_see https://x.example/a_" still loses its
   * emphasis markers. Entities in the URL are decoded now, as they would
   * have been in the text ("?a=1&amp;b=2" reads "?a=1&b=2").
   *
   * Linear: parentheses are counted once and the trim only moves backwards.
   */
  private static holdBareUrl(url: string, hold: HoldFunction): string {
    const opens: number = url.split("(").length - 1;
    let closes: number = url.split(")").length - 1;
    let end: number = url.length;

    while (end > 0) {
      const last: string = url[end - 1] ?? "";

      /*
       * A WORD_EDGE only ends up last once the "_" after it was trimmed; it
       * leaves with that "_", so the "_" keeps its flanking.
       */
      if (BARE_URL_TRAILING_PUNCTUATION.includes(last) || last === WORD_EDGE) {
        end--;
        continue;
      }

      if (last === ")" && closes > opens) {
        closes--;
        end--;
        continue;
      }

      break;
    }

    // The URL's underscores were marked like any other text: unmark them.
    const address: string = url
      .slice(0, end)
      .split(WORD_EDGE)
      .join("")
      .split(LITERAL_UNDERSCORE)
      .join("_");

    return hold(Markdown.decodeHtmlEntities(address)) + url.slice(end);
  }

  /*
   * Decode &lt; &gt; &amp; &quot; &#39; and &nbsp;, in one pass, so
   * "&amp;quot;" becomes "&quot;" instead of being decoded twice.
   */
  private static decodeHtmlEntities(text: string): string {
    return text.replace(
      /&(lt|gt|amp|quot|#39|nbsp);/g,
      (match: string, name: string): string => {
        return HTML_ENTITIES[name] ?? match;
      },
    );
  }

  private static blogRenderer: Renderer | null = null;
  private static docsRenderer: Renderer | null = null;
  private static docsMarkedOptions: MarkedOptions | null = null;
  private static emailRenderer: Renderer | null = null;
  private static blogValidationRenderer: Renderer | null = null;

  @CaptureSpan()
  public static async convertToHTML(
    markdown: string,
    contentType: MarkdownContentType,
  ): Promise<string> {
    let renderer: Renderer | null = null;

    if (contentType === MarkdownContentType.Blog) {
      renderer = this.getBlogRenderer();
    }

    if (contentType === MarkdownContentType.Docs) {
      renderer = this.getDocsRenderer();
    }

    if (contentType === MarkdownContentType.Email) {
      renderer = this.getEmailRenderer();
    }

    if (contentType === MarkdownContentType.BlogValidation) {
      renderer = this.getBlogValidationRenderer();
    }

    /*
     * Escape raw HTML tokens in the markdown source to prevent XSS.
     * This only affects raw HTML that users type directly (e.g. <img onerror=...>),
     * not HTML generated by the renderer methods (headings, paragraphs, etc.).
     */
    if (renderer) {
      renderer.html = (html: string): string => {
        return Markdown.escapeHtml(html);
      };
    }

    /*
     * An email's screenshots, and text too long for marked to read, are held
     * back from marked (holdBackFromMarked), and the HTML a field renders
     * to is held to what an email carries (convertToEmailHtml).
     */
    if (contentType === MarkdownContentType.Email && renderer) {
      return Markdown.convertToEmailHtml(markdown, renderer);
    }

    /*
     * The docs have block components of their own (steps, tabs, cards,
     * collapsible sections and callouts - see MarkdownDocsExtensions.ts).
     * They are passed with each docs render rather than registered on
     * marked, so the blog, email and the rest keep reading ":::" as text,
     * and docs rendering still goes through marked like every other type.
     */
    if (contentType === MarkdownContentType.Docs && renderer) {
      return await marked(markdown, {
        ...Markdown.getDocsMarkedOptions(),
        renderer: renderer,
      });
    }

    const htmlBody: string = await marked(markdown, {
      renderer: renderer,
    });

    return htmlBody;
  }

  /*
   * EMAIL Markdown as HTML of at most MAX_EMAIL_FIELD_HTML_BYTES (see
   * Utils/Mail/EmailSize), measured as it is sent: its inline images as the
   * attachments they go out as, so a screenshot does not count. A text whose
   * HTML is more - a log or a response body of megabytes, a table, whose
   * HTML is some thirty times its Markdown - is cut (cutEmailMarkdown: at a
   * line break where it can be, never inside an image or a link reference
   * definition, and with the definitions its kept references need) and
   * rendered again, shorter in proportion and with a margin, a few times at
   * most, and ends with EMAIL_TRUNCATED_TEXT_NOTE_HTML. A text far longer
   * than that is cut before it is first rendered: rendering megabytes only
   * to drop them is wasted work. A text that fits renders exactly as it
   * always has.
   */
  private static async convertToEmailHtml(
    markdown: string,
    renderer: Renderer,
  ): Promise<string> {
    if (typeof markdown !== "string" || !markdown) {
      return Markdown.renderEmailMarkdown(markdown, renderer);
    }

    const runs: Array<Base64Run> = getBase64Runs(markdown);
    const weight: number = Markdown.getEmailMarkdownWeight(markdown, runs);

    /*
     * How much of the text is kept, by weight; null while all of it is. A
     * text heavier than the budget renders to more HTML than it (escaping
     * and tags only add), so it is cut to the budget before it is first
     * rendered.
     */
    let kept: number | null =
      weight > MAX_EMAIL_FIELD_HTML_BYTES ? MAX_EMAIL_FIELD_HTML_BYTES : null;
    let html: string = "";
    // What the cut reads, made the first time the text is cut.
    let toCut: EmailMarkdownToCut | null = null;

    for (
      let attempt: number = 0;
      attempt <= MAX_EMAIL_FIT_ATTEMPTS;
      attempt++
    ) {
      if (kept === null) {
        html = await Markdown.renderEmailMarkdown(markdown, renderer);
      } else {
        toCut = toCut ?? Markdown.readEmailMarkdownToCut(markdown, runs);
        html =
          (await Markdown.renderEmailMarkdown(
            Markdown.cutEmailMarkdown(
              toCut.markdown,
              kept,
              toCut.runs,
              toCut.definitions,
            ),
            renderer,
          )) + EMAIL_TRUNCATED_TEXT_NOTE_HTML;
      }

      const sizeInBytes: number = EmailSize.getFieldSizeInBytes(html);

      if (
        sizeInBytes <= MAX_EMAIL_FIELD_HTML_BYTES ||
        (kept !== null && kept <= 1)
      ) {
        break;
      }

      kept = Math.max(
        1,
        Math.floor(
          (((kept ?? weight) * MAX_EMAIL_FIELD_HTML_BYTES) / sizeInBytes) *
            EMAIL_FIT_MARGIN,
        ),
      );
    }

    if (kept !== null) {
      logger.warn(
        `An email's Markdown (${markdown.length} characters) renders to more HTML than an email carries, and was cut to fit.`,
      );
    }

    return html;
  }

  /*
   * EMAIL Markdown rendered by marked, with what marked cannot read safely
   * held back (holdBackFromMarked); as text when even that is more than it
   * reads safely, or when it fails anyway (getEmailTextHtml).
   */
  private static async renderEmailMarkdown(
    markdown: string,
    renderer: Renderer,
  ): Promise<string> {
    const held: HeldBackMarkdown = Markdown.holdBackFromMarked(markdown);

    if (
      typeof held.markdown === "string" &&
      held.markdown.length > MAX_MARKED_EMAIL_MARKDOWN_LENGTH
    ) {
      logger.warn(
        `An email's Markdown (${held.markdown.length} characters left once over-long text is held back, of ${String(markdown).length}) is more than marked reads safely, and is sent as text.`,
      );

      return Markdown.getEmailTextHtml(markdown);
    }

    try {
      // A tokenizer of its own: it marks this text's definitions.
      const tokenizer: EmailMarkedTokenizer = new EmailMarkedTokenizer();
      const emailBody: string = await marked(held.markdown, {
        renderer: Markdown.withHeldDataInUrls(renderer, held, tokenizer),
        tokenizer: tokenizer,
      });

      return held.restoreEscaped(emailBody);
    } catch (error) {
      /*
       * The last resort. What marked cannot read safely is held back, so
       * this is not expected - but if marked still runs out of stack
       * (RangeError), the email is sent with its Markdown as text rather
       * than not sent at all.
       */
      if (!(error instanceof RangeError)) {
        throw error;
      }

      logger.error(
        `An email's Markdown (${String(markdown).length} characters) could not be rendered, and is sent as text: ${error.message}`,
      );

      return Markdown.getEmailTextHtml(markdown);
    }
  }

  /*
   * How much of EMAIL Markdown counts toward the HTML it renders to: all of
   * it but the data of its inline images, which go out as attachments.
   */
  private static getEmailMarkdownWeight(
    markdown: string,
    runs: Array<Base64Run>,
  ): number {
    return runs.reduce((weight: number, run: Base64Run): number => {
      return weight - (run.end - run.start);
    }, markdown.length);
  }

  /*
   * The weight of markdown[start, end) (getEmailMarkdownWeight): its length,
   * less the base64 runs in it. The runs are in order, so the first that
   * reaches into it is found by halves.
   */
  private static getEmailWeightBetween(
    runs: Array<Base64Run>,
    start: number,
    end: number,
  ): number {
    let low: number = 0;
    let high: number = runs.length;

    while (low < high) {
      const middle: number = Math.floor((low + high) / 2);

      if (runs[middle]!.end <= start) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    let weight: number = end - start;

    for (
      let index: number = low;
      index < runs.length && runs[index]!.start < end;
      index++
    ) {
      const run: Base64Run = runs[index]!;

      weight -= Math.min(end, run.end) - Math.max(start, run.start);
    }

    return weight;
  }

  /*
   * EMAIL Markdown as cutEmailMarkdown reads it: its line breaks as marked
   * reads them ("\r\n" and "\r" are "\n"), so a definition is where marked
   * finds it; its base64 runs (`runs`, when that is all the same); and its
   * link reference definitions.
   */
  private static readEmailMarkdownToCut(
    markdown: string,
    runs: Array<Base64Run>,
  ): EmailMarkdownToCut {
    if (markdown.indexOf("\r") === -1) {
      return {
        markdown: markdown,
        runs: runs,
        definitions: getLinkReferenceDefinitions(markdown),
      };
    }

    const source: string = markdown.replace(/\r\n|\r/g, "\n");

    return {
      markdown: source,
      runs: getBase64Runs(source),
      definitions: getLinkReferenceDefinitions(source),
    };
  }

  // Where `weight` of `markdown` ends, counting no base64 run.
  private static getPositionOfWeight(
    markdown: string,
    runs: Array<Base64Run>,
    weight: number,
  ): number {
    let counted: number = 0;
    let segmentStart: number = 0;

    for (const run of runs) {
      if (counted + (run.start - segmentStart) >= weight) {
        return segmentStart + (weight - counted);
      }

      counted += run.start - segmentStart;
      segmentStart = run.end;
    }

    return Math.min(markdown.length, segmentStart + (weight - counted));
  }

  /*
   * The Markdown image whose data is `run` - "![alt](data:image/...;base64,
   * <run> "title")" - where it starts ("!["), where its address starts, and
   * where it ends (after its ")"); or null when the data is not in an
   * image's address. Read in windows of IMAGE_SYNTAX_WINDOW around the
   * data, so finding every image of a text takes time linear in its length.
   */
  private static findImageAround(
    markdown: string,
    run: Base64Run,
  ): MarkdownImagePosition | null {
    // "](" and "data:image/<type>;base64," right before the data.
    const prefixStart: number = Math.max(
      0,
      run.start - IMAGE_DATA_URL_PREFIX_MAX_LENGTH,
    );
    const addressIndex: number = markdown
      .slice(prefixStart, run.start)
      .lastIndexOf("](");

    if (addressIndex === -1) {
      return null;
    }

    const addressStart: number = prefixStart + addressIndex + 2;

    if (!IMAGE_DATA_URL_PREFIX.test(markdown.slice(addressStart, run.start))) {
      return null;
    }

    // "![" before the alt text, on the same line.
    const altWindowStart: number = Math.max(
      0,
      addressStart - 2 - IMAGE_SYNTAX_WINDOW,
    );
    const altWindow: string = markdown.slice(altWindowStart, addressStart - 2);
    const altIndex: number = altWindow.lastIndexOf("![");

    if (altIndex === -1 || altWindow.indexOf("\n", altIndex) !== -1) {
      return null;
    }

    // The data's "=" padding, which the run does not take.
    let addressEnd: number = run.end;

    while (
      addressEnd < markdown.length &&
      addressEnd - run.end < 2 &&
      markdown.charAt(addressEnd) === "="
    ) {
      addressEnd++;
    }

    // After the data: spaces and a quoted title, then ")".
    const limit: number = Math.min(
      markdown.length,
      addressEnd + IMAGE_SYNTAX_WINDOW,
    );
    let end: number = addressEnd;

    while (end < limit && markdown.charAt(end) === " ") {
      end++;
    }

    const quote: string = markdown.charAt(end);

    if (quote === '"' || quote === "'") {
      const title: string = markdown.slice(end + 1, limit);
      const titleLength: number = title.indexOf(quote);

      if (titleLength === -1 || title.slice(0, titleLength).includes("\n")) {
        return null;
      }

      end += titleLength + 2;

      while (end < limit && markdown.charAt(end) === " ") {
        end++;
      }
    }

    if (markdown.charAt(end) !== ")") {
      return null;
    }

    return {
      start: altWindowStart + altIndex,
      addressStart: addressStart,
      addressEnd: addressEnd,
      end: end + 1,
    };
  }

  /*
   * The start of EMAIL Markdown up to `weight` (getEmailMarkdownWeight: an
   * inline image's data weighs nothing, so an image before the cut stays
   * whole), with the link reference definitions it needs (#6963).
   *
   * Cut where getEmailCut cuts: at a line break where it can be, never
   * inside an image or a definition. marked reads a definition wherever it
   * is, and a description most often defines its screenshot at its end, so
   * a cut that keeps a reference would leave out what it refers to, and the
   * reference would show as Markdown. So each definition of a label the
   * kept part refers to - "![alt][label]", "[text][label]", "[label][]",
   * "[label]", whatever its case - and does not define itself comes along:
   * the first of the cut part's definitions of it, as marked reads the
   * first. They go before the kept part, a blank line between: there each
   * is a definition whatever the cut ends inside - a code block, a list, an
   * HTML comment - and a definition renders nothing, so the email reads as
   * it would with them anywhere. One written in a block quote or a list
   * item goes as marked reads it there, without the quote's markers and the
   * item's indentation (getCutDefinitionLines, #7230): before the kept part
   * it is no quote or list, but a definition all the same.
   *
   * They count toward `weight`, and a screenshot's data in one weighs
   * nothing. The kept part is cut shorter to make room for them - to half
   * of `weight` at the least - and a definition still too heavy goes
   * without its title, or else as an empty one ("[label]: <>"), whose
   * references show their text or alt text: never Markdown. Room is made
   * for every one as an empty one before any is written whole, and goes to
   * the lightest first - a screenshot's, before a long title's or
   * address's. A definition whose empty one does not fit either goes
   * without, so the cut text never weighs more than `weight`.
   *
   * "\r\n" and "\r" are read as "\n", as marked reads them, whenever the
   * text has to be cut (`runs` and `definitions` are those of the text cut:
   * convertToEmailHtml reads them once for every attempt).
   */
  public static cutEmailMarkdown(
    markdown: string,
    weight: number,
    runs: Array<Base64Run> = getBase64Runs(markdown),
    definitions?: Array<LinkReferenceDefinition>,
  ): string {
    if (Markdown.getEmailMarkdownWeight(markdown, runs) <= weight) {
      return markdown;
    }

    if (definitions === undefined || markdown.indexOf("\r") !== -1) {
      const toCut: EmailMarkdownToCut = Markdown.readEmailMarkdownToCut(
        markdown,
        runs,
      );

      return Markdown.cutEmailMarkdown(
        toCut.markdown,
        weight,
        toCut.runs,
        toCut.definitions,
      );
    }

    let cut: number = Markdown.getEmailCut(markdown, weight, runs, definitions);
    let needed: Array<LinkReferenceDefinition> = Markdown.getDefinitionsNeeded(
      markdown,
      cut,
      definitions,
    );

    if (needed.length === 0) {
      return markdown.slice(0, cut).trimEnd();
    }

    // Each definition on a line of its own, and a blank line after them.
    const neededWeight: number = needed.reduce(
      (sum: number, definition: LinkReferenceDefinition): number => {
        return (
          sum +
          Markdown.getCutDefinitionLines(markdown, runs, definition)
            .wholeWeight +
          1
        );
      },
      1,
    );

    if (Markdown.getEmailWeightBetween(runs, 0, cut) + neededWeight > weight) {
      cut = Markdown.getEmailCut(
        markdown,
        Math.max(weight - neededWeight, Math.ceil(weight / 2)),
        runs,
        definitions,
      );
      needed = Markdown.getDefinitionsNeeded(markdown, cut, definitions);
    }

    // What the kept part leaves, a blank line after the definitions.
    const kept: string = markdown.slice(0, cut).trimEnd();
    let room: number =
      weight - Markdown.getEmailWeightBetween(runs, 0, kept.length) - 1;

    /*
     * Each as an empty definition first, where one fits - its references
     * are then their text - and then as much of each as fits: the lightest
     * first both times. Written in the order of the text.
     */
    const forms: Array<CutDefinitionLines> = needed.map(
      (definition: LinkReferenceDefinition): CutDefinitionLines => {
        return Markdown.getCutDefinitionLines(markdown, runs, definition);
      },
    );
    const lightestFirst: Array<number> = forms
      .map((_form: CutDefinitionLines, index: number): number => {
        return index;
      })
      .sort((one: number, other: number): number => {
        return (
          forms[one]!.wholeWeight - forms[other]!.wholeWeight || one - other
        );
      });
    const lines: Array<string | null> = needed.map((): null => {
      return null;
    });

    for (const index of lightestFirst) {
      const empty: string = forms[index]!.empty;

      if (empty.length + 1 <= room) {
        lines[index] = empty;
        room -= empty.length + 1;
      }
    }

    for (const index of lightestFirst) {
      const empty: string | null = lines[index] ?? null;

      if (empty === null) {
        continue;
      }

      const form: CutDefinitionLines = forms[index]!;
      const whole: number = form.wholeWeight - empty.length;
      const withoutTitle: number = form.withoutTitleWeight - empty.length;

      if (whole <= room) {
        lines[index] = form.whole;
        room -= whole;
      } else if (withoutTitle <= room) {
        lines[index] = form.withoutTitle;
        room -= withoutTitle;
      }
    }

    let written: string = "";

    for (const line of lines) {
      if (line !== null) {
        written += `${line}\n`;
      }
    }

    return written ? `${written}\n${kept}` : kept;
  }

  /*
   * How a field cut to fit writes `definition` on a line of its own, before
   * its kept part (cutEmailMarkdown): as it is written - or, when it is in
   * a block quote or a list item, as marked reads it there (`nested`),
   * without the quote's markers and the item's indentation, which would
   * make a quote or a list of it there (#7230), and from its "[": a line
   * indented past its item's indentation is no less a definition. Its
   * address is the text's own either way, so a screenshot's data in it
   * weighs nothing; the rest of a nested one weighs all it is long, never
   * less than the cut text does.
   */
  private static getCutDefinitionLines(
    markdown: string,
    runs: Array<Base64Run>,
    definition: LinkReferenceDefinition,
  ): CutDefinitionLines {
    const nested: NestedLinkReferenceDefinition | undefined = definition.nested;

    if (!nested) {
      return {
        whole: markdown.slice(definition.start, definition.end),
        wholeWeight: Markdown.getEmailWeightBetween(
          runs,
          definition.start,
          definition.end,
        ),
        withoutTitle: markdown.slice(
          definition.start,
          definition.destinationEnd,
        ),
        withoutTitleWeight: Markdown.getEmailWeightBetween(
          runs,
          definition.start,
          definition.destinationEnd,
        ),
        empty: `[${markdown.slice(definition.labelStart, definition.labelEnd)}]: <>`,
      };
    }

    // The base64 its address holds, which weighs nothing.
    const addressData: number =
      definition.destinationEnd -
      definition.destinationStart -
      Markdown.getEmailWeightBetween(
        runs,
        definition.destinationStart,
        definition.destinationEnd,
      );
    // Its "[", after the up to three spaces a definition may be indented.
    const from: number = nested.labelStart - 1;

    return {
      whole: nested.text.slice(from),
      wholeWeight: nested.text.length - from - addressData,
      withoutTitle: nested.text.slice(from, nested.destinationEnd),
      withoutTitleWeight: nested.destinationEnd - from - addressData,
      empty: `[${nested.text.slice(nested.labelStart, nested.labelEnd)}]: <>`,
    };
  }

  /*
   * Where cutEmailMarkdown cuts EMAIL Markdown to `weight`: at the last line
   * break in the second half of that, so a line is not split where it can
   * be helped, else between whole characters - and never inside an image or
   * a link reference definition. An image the cut would split is left out,
   * from its "![", so none of its data is left as text; a definition, from
   * the start of its line, so the kept part does not end with what reads as
   * a definition of half its address.
   */
  private static getEmailCut(
    markdown: string,
    weight: number,
    runs: Array<Base64Run>,
    definitions: Array<LinkReferenceDefinition>,
  ): number {
    let cut: number = Markdown.getPositionOfWeight(markdown, runs, weight);
    const half: number = Markdown.getPositionOfWeight(
      markdown,
      runs,
      Math.floor(weight / 2),
    );
    const lineBreak: number = markdown.lastIndexOf("\n", cut);

    if (lineBreak > half) {
      cut = lineBreak;
    } else {
      const before: number = markdown.charCodeAt(cut - 1);

      if (cut > 0 && before >= 0xd800 && before <= 0xdbff) {
        cut--;
      }
    }

    /*
     * An image the cut splits - one whose data starts after it, or ends
     * before it with its ")" after - is left out from its "![".
     */
    const after: Base64Run | undefined = runs.find(
      (run: Base64Run): boolean => {
        return run.start >= cut;
      },
    );
    const before: Base64Run | undefined = runs
      .filter((run: Base64Run): boolean => {
        return run.end <= cut;
      })
      .pop();

    for (const run of [after, before]) {
      const image: MarkdownImagePosition | null = run
        ? Markdown.findImageAround(markdown, run)
        : null;

      if (image && image.start < cut && image.end > cut) {
        cut = image.start;
      }
    }

    /*
     * The definitions are in order, so the last to start before the cut is
     * found by halves.
     */
    let low: number = 0;
    let high: number = definitions.length;

    while (low < high) {
      const middle: number = Math.floor((low + high) / 2);

      if (definitions[middle]!.start < cut) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    const split: LinkReferenceDefinition | undefined = definitions[low - 1];

    if (split && split.end > cut) {
      cut = split.start;
    }

    return cut;
  }

  /*
   * The link reference definitions EMAIL Markdown cut at `cut` needs, in
   * the order of the text: for each label a bracket of the kept part holds
   * (forEachBracketedLabel) that no definition of the kept part defines,
   * the first definition of it after the cut - the one marked reads.
   */
  private static getDefinitionsNeeded(
    markdown: string,
    cut: number,
    definitions: Array<LinkReferenceDefinition>,
  ): Array<LinkReferenceDefinition> {
    const keptLabels: Set<string> = new Set<string>();
    const cutOff: Map<string, LinkReferenceDefinition> = new Map<
      string,
      LinkReferenceDefinition
    >();

    for (const definition of definitions) {
      if (definition.start < cut) {
        keptLabels.add(definition.label);
      } else if (
        !keptLabels.has(definition.label) &&
        !cutOff.has(definition.label)
      ) {
        cutOff.set(definition.label, definition);
      }
    }

    if (cutOff.size === 0) {
      return [];
    }

    const needed: Set<LinkReferenceDefinition> =
      new Set<LinkReferenceDefinition>();

    forEachBracketedLabel(markdown, 0, cut, (label: string): void => {
      const definition: LinkReferenceDefinition | undefined = cutOff.get(label);

      if (definition) {
        needed.add(definition);
      }
    });

    return Array.from(needed).sort(
      (
        one: LinkReferenceDefinition,
        other: LinkReferenceDefinition,
      ): number => {
        return one.start - other.start;
      },
    );
  }

  /*
   * marked's own processed form of the docs extensions - the tokenizers,
   * renderers and the hook that resets per-page ids - taken from an instance
   * that has them registered, to pass with each docs render.
   */
  private static getDocsMarkedOptions(): MarkedOptions {
    if (this.docsMarkedOptions === null) {
      const defaults: MarkedOptions = new Marked(docsMarkdownExtensions)
        .defaults;
      this.docsMarkedOptions = {
        extensions: defaults.extensions ?? null,
        hooks: defaults.hooks ?? null,
      };
    }

    return this.docsMarkedOptions;
  }

  /*
   * EMAIL Markdown with everything marked cannot read safely held back, for
   * marked to read, and the means to put it back.
   *
   * marked reads a line, and a paragraph, with regular expressions, and V8
   * matches those with a backtracking stack that can grow with every
   * character: a screenshot of about six megabytes on one line ran it out
   * of stack - "Maximum call stack size exceeded" - and the email was never
   * rendered. Once a long-running process has compiled enough code, V8 stops
   * optimizing the regular expressions it compiles, and then three and a
   * half megabytes was enough - of a screenshot, of a response body a
   * description template placed, of a log pasted into a note.
   *
   * So, before marked reads the Markdown, and each replaced by a short token:
   *
   *   - each run of base64 after ";base64," long enough to matter (a
   *     screenshot, see Utils/Markdown/InlineImageDataUri) leaves it, all
   *     but its last character (Utils/Markdown/Base64Data, as the
   *     dashboard's viewer does). The last character stays so that
   *     whatever follows the data reads exactly as it did.
   *   - the middle of every over-long line, and the plain lines of every
   *     over-long run of lines, leave it (Utils/Markdown/OverLongText): the
   *     line keeps its start and end, and the run the lines that give it its
   *     structure.
   *   - a token character already in the input leaves it as it is.
   *
   * Links and images get what was held back before their URL is judged
   * (withHeldDataInUrls), as it was written - within what the copies a link
   * reference definition's references make may put back - and the rendered
   * HTML gets it back wherever else marked wrote it - text, code, alt text,
   * a title - escaped, as marked escapes text. So an email whose text is
   * too long for marked shows it, as text, and the rest of the email is
   * what it would have been. Markdown of at most 64 KB with no screenshot
   * holds back nothing, and goes to marked as it is. Markdown with more than
   * MAX_MARKED_EMAIL_MARKDOWN_LENGTH left - long runs of lines that are not
   * plain - is not given to marked at all: it is sent as text.
   */
  private static holdBackFromMarked(markdown: string): HeldBackMarkdown {
    const asIs: (value: string) => string = (value: string): string => {
      return value;
    };

    const nothingHeld: HeldBackMarkdown = {
      markdown: markdown,
      restore: asIs,
      restoreEscaped: asIs,
      heldIn: (): Array<number> => {
        return [];
      },
    };

    if (typeof markdown !== "string" || !markdown) {
      return nothingHeld;
    }

    const held: Array<string> = [];
    // The held texts that are whole lines (SlowMarkdown), by index.
    const heldLines: Set<number> = new Set<number>();

    // Read with indexOf, not a regular expression: the HTML is as long as the data.
    const putBack: PutBackFunction = (
      value: string,
      escape: boolean,
    ): string => {
      let restored: string = "";
      let restoredUpTo: number = 0;

      for (
        let open: number = value.indexOf(HELD_DATA_OPEN);
        open !== -1;
        open = value.indexOf(HELD_DATA_OPEN, restoredUpTo)
      ) {
        const close: number = value.indexOf(HELD_DATA_CLOSE, open + 1);

        if (close === -1) {
          break;
        }

        const index: number = Number(value.slice(open + 1, close));
        const heldText: string = held[index] ?? "";

        let restoredText: string = heldText;

        if (escape) {
          restoredText = heldLines.has(index)
            ? Markdown.getEmailLinesHtml(heldText)
            : Markdown.escapeHtml(heldText);
        }

        restored += value.slice(restoredUpTo, open) + restoredText;
        restoredUpTo = close + 1;
      }

      return restored + value.slice(restoredUpTo);
    };

    // Kept as written: anything held back inside it is put back first.
    const hold: (text: string) => string = (text: string): string => {
      held.push(putBack(text, false));

      return `${HELD_DATA_OPEN}${held.length - 1}${HELD_DATA_CLOSE}`;
    };

    // Whole lines, written back a line on each line (getEmailLinesHtml).
    const holdLines: (text: string) => string = (text: string): string => {
      const token: string = hold(text);

      heldLines.add(held.length - 1);

      return token;
    };

    /*
     * Line breaks as marked reads them, so a line is a line here too. Only
     * Markdown long enough to hold anything back is rewritten.
     */
    const source: string =
      mayHoldBack(markdown) && markdown.indexOf("\r") !== -1
        ? markdown.replace(/\r\n|\r/g, "\n")
        : markdown;

    // A sentinel already in the input is held back as it is.
    let text: string = source;

    if (
      source.indexOf(HELD_DATA_OPEN) !== -1 ||
      source.indexOf(HELD_DATA_CLOSE) !== -1
    ) {
      let copiedUpTo: number = 0;

      text = "";

      for (let index: number = 0; index < source.length; index++) {
        const code: number = source.charCodeAt(index);

        if (code === HELD_DATA_OPEN_CODE || code === HELD_DATA_CLOSE_CODE) {
          text += source.slice(copiedUpTo, index) + hold(source.charAt(index));
          copiedUpTo = index + 1;
        }
      }

      text += source.slice(copiedUpTo);
    }

    text = holdBackOverLongText(holdBackBase64Data(text, hold), hold);

    /*
     * Blocks marked would take too long to read - emphasis, code spans or
     * links it looks ahead through, quotes nested thousands deep - are held
     * back whole, and written back as text, a line on each line.
     */
    text = holdBackSlowMarkdown(
      text,
      { holdLines: holdLines, holdCode: hold },
      EMAIL_SLOW_MARKDOWN_LIMITS,
    );

    if (held.length === 0) {
      return nothingHeld;
    }

    return {
      markdown: text,
      restore: (value: string): string => {
        return putBack(value, false);
      },
      restoreEscaped: (value: string): string => {
        return putBack(value, true);
      },
      heldIn: (value: string): Array<number> => {
        return Markdown.getHeldIndexes(value);
      },
    };
  }

  /*
   * The held-back texts `value` holds (holdBackFromMarked), by index, in
   * order. Read with indexOf, as putBack reads them.
   */
  private static getHeldIndexes(value: string): Array<number> {
    const indexes: Array<number> = [];

    if (typeof value !== "string") {
      return indexes;
    }

    let readUpTo: number = 0;

    for (
      let open: number = value.indexOf(HELD_DATA_OPEN);
      open !== -1;
      open = value.indexOf(HELD_DATA_OPEN, readUpTo)
    ) {
      const close: number = value.indexOf(HELD_DATA_CLOSE, open + 1);

      if (close === -1) {
        break;
      }

      indexes.push(Number(value.slice(open + 1, close)));
      readUpTo = close + 1;
    }

    return indexes;
  }

  /*
   * An email's Markdown as text, for when marked cannot render it: every
   * character escaped, every line on a line of its own - but an inline image
   * ("![alt](data:image/png;base64,...)", a screenshot) still an image, which
   * MailService sends as an attachment: written as text, its data would be
   * megabytes of base64 in the email. An image whose data is not an image
   * this sends (parseInlineImageDataUri) is its alt text.
   *
   * A link reference definition whose address is a data: URL of base64 -
   * a screenshot defined once for the images that refer to it (#6481) - is
   * its image the same way, with its label for alt text, or its label when
   * the data is no image this sends: its references are text here, and its
   * data is never written out as text (#6962). Line breaks are read as
   * marked reads them, so a definition is where marked finds it.
   */
  private static getEmailTextHtml(markdown: string): string {
    const written: string = String(markdown ?? "");
    const text: string =
      written.indexOf("\r") === -1
        ? written
        : written.replace(/\r\n|\r/g, "\n");
    let html: string = "";
    let copiedUpTo: number = 0;
    // Found the first time data is in no inline image: most texts have none.
    let definitions: Array<LinkReferenceDefinition> | null = null;
    let definitionIndex: number = 0;

    // An image of `address`, or `alt` alone when it is no image this sends.
    const writeImage: (
      start: number,
      end: number,
      address: string,
      alt: string,
    ) => void = (
      start: number,
      end: number,
      address: string,
      alt: string,
    ): void => {
      const image: InlineImageDataUri | null = parseInlineImageDataUri(address);

      html += Markdown.getEmailLinesHtml(text.slice(copiedUpTo, start));
      html += image
        ? `<img src="${Markdown.escapeHtml(image.dataUri)}" alt="${Markdown.escapeHtml(alt)}" style="${EMAIL_IMAGE_STYLE}">`
        : Markdown.escapeHtml(alt);
      copiedUpTo = end;
    };

    for (const run of getBase64Runs(text, 1)) {
      if (run.start < copiedUpTo) {
        continue;
      }

      const found: MarkdownImagePosition | null = Markdown.findImageAround(
        text,
        run,
      );

      if (found !== null) {
        if (found.start >= copiedUpTo) {
          writeImage(
            found.start,
            found.end,
            text.slice(found.addressStart, found.addressEnd),
            text.slice(found.start + 2, found.addressStart - 2),
          );
        }

        continue;
      }

      definitions = definitions ?? getLinkReferenceDefinitions(text);

      // The definitions are in order, as the runs are.
      while (
        definitionIndex < definitions.length &&
        definitions[definitionIndex]!.destinationEnd < run.end
      ) {
        definitionIndex++;
      }

      const definition: LinkReferenceDefinition | undefined =
        definitions[definitionIndex];

      if (!definition || definition.start < copiedUpTo) {
        continue;
      }

      const bracketed: boolean =
        text.charAt(definition.destinationStart) === "<";
      const addressStart: number =
        definition.destinationStart + (bracketed ? 1 : 0);

      // Its address is the run's data: URL, as an image's is (findImageAround).
      if (
        run.start < addressStart ||
        run.start - addressStart > IMAGE_DATA_URL_PREFIX_MAX_LENGTH ||
        !IMAGE_DATA_URL_PREFIX.test(text.slice(addressStart, run.start))
      ) {
        continue;
      }

      /*
       * Its label as marked reads it: in a block quote or a list item,
       * without the markers and indentation of the lines it runs over.
       */
      const nested: NestedLinkReferenceDefinition | undefined =
        definition.nested;

      writeImage(
        definition.start,
        definition.end,
        text.slice(
          addressStart,
          definition.destinationEnd - (bracketed ? 1 : 0),
        ),
        nested
          ? nested.text.slice(nested.labelStart, nested.labelEnd)
          : text.slice(definition.labelStart, definition.labelEnd),
      );
    }

    html += Markdown.getEmailLinesHtml(text.slice(copiedUpTo));

    return `<p>${html}</p>\n`;
  }

  /*
   * Lines of text as an email shows them: every character escaped, every
   * line on a line of its own (a "\r\n" line break is one line break).
   */
  private static getEmailLinesHtml(text: string): string {
    return Markdown.escapeHtml(text)
      .split("\r\n")
      .join("\n")
      .split("\n")
      .join("<br>\n");
  }

  /*
   * `renderer`, with every link and image URL it is given put back together
   * first (see holdBackFromMarked), so it judges the URL the author wrote -
   * but never more of it than an email can use. marked writes a link
   * reference definition's address and title into every reference to it,
   * and `definitions` - the tokenizer that read the text
   * (EmailMarkedTokenizer) - says which definition a reference's are:
   *
   *   - The first reference to a definition to take its address has the
   *     text's own copy, as an image or a link has its own address: it
   *     renders as it always has, however long. Every later reference has
   *     a copy.
   *   - A copy of a screenshot - an image whose address is an inline image,
   *     sent once as an attachment however often it shows - is put back
   *     while the copies of screenshots come to at most
   *     MAX_EMAIL_HELD_TEXT_IN_REFERENCES characters, in the order of the
   *     text (#6481). Any other copy of an address - a link's, an image's
   *     from the web - stays in the email's HTML, and is put back while the
   *     HTML such copies write comes to at most
   *     MAX_EMAIL_COPIED_HTML_IN_REFERENCES (#6962). Past its budget, an
   *     image is the note an email leaves in place of an image too large to
   *     include (EmailInlineImages.getTooLargeImageNotice), and a link is its
   *     text. So two references to a screenshot still show it twice, from
   *     one attachment, and two hundred show it as often as the budget
   *     holds, then the note.
   *   - A copy of a title stays in the HTML too, and is kept while the
   *     copies of titles write at most MAX_EMAIL_COPIED_HTML_IN_REFERENCES:
   *     past that, its image or link goes without it. A copy of a title that
   *     holds held-back text - most often the middle of a definition's line
   *     over 64 KB - is never kept, as the dashboard's viewer leaves a long
   *     title out of the references past its budget.
   *   - An address an email cannot keep, whatever was held back of it, is
   *     not put back at all (isRefusedWhateverFollows): a link to a scheme
   *     an email does not link to - a data: link, whatever it carries - and
   *     an image from a scheme it does not load that cannot be an inline
   *     image. The link is its text and the image its alt text, as they
   *     always were, and neither takes anything of a budget, nor the text's
   *     own copy.
   *   - The first copy of any other address is put back whole and judged as
   *     the renderer judges it (HeldAddressRules.judge), and the verdict
   *     holds for its later copies. An address the renderer does not keep -
   *     a data:image/png address whose data is no image, a link whose
   *     scheme was held back with the rest of it - is then its text or alt
   *     text at every copy, as the renderer makes it, and takes nothing of a
   *     budget.
   *
   * Each address and title is read once, however many references it is
   * given to, so a reference that is not put back costs no more than its
   * text. An address or a title of a few dozen characters, referenced
   * hundreds of times, is within every budget, and renders exactly as it
   * always has. What it counts is counted for one render: each render
   * starts afresh.
   */
  private static withHeldDataInUrls(
    renderer: Renderer,
    held: HeldBackMarkdown,
    definitions: EmailMarkedTokenizer,
  ): Renderer {
    const restoring: Renderer = Object.create(renderer) as Renderer;

    // The held-back texts an address or a title has put back, by index.
    const putBack: Set<number> = new Set<number>();
    /*
     * The definitions whose address a reference has taken the text's own
     * copy of, by their mark.
     */
    const ownTaken: Set<string> = new Set<string>();
    // What the copies have taken of their budgets.
    let copiedScreenshots: number = 0;
    let copiedAddresses: number = 0;
    let copiedTitles: number = 0;
    // The titles read, by the title as marked gives it.
    const titles: Map<string, HeldTitleReading> = new Map<
      string,
      HeldTitleReading
    >();

    const imageRules: HeldAddressRules = {
      schemes: EMAIL_IMAGE_SCHEMES,
      mayBeInlineImage: true,
      // As getEmailImageSource keeps it.
      judge: (href: string): CopyVerdict => {
        if (parseInlineImageDataUri(href) !== null) {
          return { isScreenshot: true, cost: href.length };
        }

        const url: string | null = Markdown.getEmailUrl(
          href,
          EMAIL_IMAGE_SCHEMES,
        );

        return url === null ? null : { isScreenshot: false, cost: url.length };
      },
      readings: new Map<string, HeldAddressReading>(),
    };

    const linkRules: HeldAddressRules = {
      schemes: EMAIL_LINK_SCHEMES,
      mayBeInlineImage: false,
      judge: (href: string): CopyVerdict => {
        const url: string | null = Markdown.getEmailUrl(
          href,
          EMAIL_LINK_SCHEMES,
        );

        return url === null ? null : { isScreenshot: false, cost: url.length };
      },
      readings: new Map<string, HeldAddressReading>(),
    };

    const isCopy: (indexes: Array<number>) => boolean = (
      indexes: Array<number>,
    ): boolean => {
      return indexes.some((index: number): boolean => {
        return putBack.has(index);
      });
    };

    const notePutBack: (indexes: Array<number>) => void = (
      indexes: Array<number>,
    ): void => {
      for (const index of indexes) {
        putBack.add(index);
      }
    };

    const readAddress: (
      href: string,
      rules: HeldAddressRules,
    ) => HeldAddressReading = (
      href: string,
      rules: HeldAddressRules,
    ): HeldAddressReading => {
      let reading: HeldAddressReading | undefined = rules.readings.get(href);

      if (reading === undefined) {
        const definitionAddress: string | null = definitions.addressOf(href);
        const address: string = definitionAddress ?? href;
        const indexes: Array<number> = held.heldIn(address);

        reading = {
          address: address,
          isDefinition: definitionAddress !== null,
          indexes: indexes,
          isRefused:
            indexes.length > 0 &&
            Markdown.isRefusedWhateverFollows(
              address.slice(0, address.indexOf(HELD_DATA_OPEN)),
              rules.schemes,
              rules.mayBeInlineImage,
            ),
          verdict: undefined,
        };
        rules.readings.set(href, reading);
      }

      return reading;
    };

    /*
     * The address an image or a link is rendered with, from `href` as
     * marked gives it.
     */
    const takeAddress: (
      href: string,
      rules: HeldAddressRules,
    ) => HeldAddress = (href: string, rules: HeldAddressRules): HeldAddress => {
      const reading: HeldAddressReading = readAddress(href, rules);

      if (reading.isRefused) {
        return { fate: "refused" };
      }

      const putBackWhole: () => string = (): string => {
        return reading.indexes.length === 0
          ? reading.address
          : held.restore(reading.address);
      };

      // The text's own: put back, for the renderer to judge as it always has.
      if (
        reading.isDefinition ? !ownTaken.has(href) : !isCopy(reading.indexes)
      ) {
        if (reading.isDefinition) {
          ownTaken.add(href);
        }

        notePutBack(reading.indexes);

        return { fate: "kept", href: putBackWhole(), isCopy: false };
      }

      let restored: string | null = null;

      if (reading.verdict === undefined) {
        restored = putBackWhole();
        reading.verdict = rules.judge(restored);
      }

      const verdict: CopyVerdict = reading.verdict;

      // Nothing of it goes into the HTML, so it takes nothing of a budget.
      if (verdict === null) {
        return { fate: "refused" };
      }

      if (verdict.isScreenshot) {
        if (
          copiedScreenshots + verdict.cost >
          MAX_EMAIL_HELD_TEXT_IN_REFERENCES
        ) {
          return { fate: "leftOut" };
        }

        copiedScreenshots += verdict.cost;
      } else {
        if (
          copiedAddresses + verdict.cost >
          MAX_EMAIL_COPIED_HTML_IN_REFERENCES
        ) {
          return { fate: "leftOut" };
        }

        copiedAddresses += verdict.cost;
      }

      notePutBack(reading.indexes);

      return { fate: "kept", href: restored ?? putBackWhole(), isCopy: true };
    };

    /*
     * The title an image or a link is rendered with, as marked writes it -
     * what was held back of it is put back with the rest of the HTML
     * (restoreEscaped) - or none: for a copy of a title that holds
     * held-back text, or one past what copies of titles may write. A title
     * goes with a copy of an address (`isCopyOfAddress`) as a copy.
     */
    const takeTitle: (
      title: string | null | undefined,
      isCopyOfAddress: boolean,
    ) => string | null = (
      title: string | null | undefined,
      isCopyOfAddress: boolean,
    ): string | null => {
      if (!title) {
        return title ?? null;
      }

      let reading: HeldTitleReading | undefined = titles.get(title);

      if (reading === undefined) {
        const written: string = definitions.titleOf(title) ?? title;

        reading = {
          title: written,
          indexes: held.heldIn(written),
          size: EmailSize.getHtmlSizeInBytes(written),
        };
        titles.set(title, reading);
      }

      if (reading.indexes.length > 0) {
        if (isCopy(reading.indexes)) {
          return null;
        }

        notePutBack(reading.indexes);

        return reading.title;
      }

      if (!isCopyOfAddress) {
        return reading.title;
      }

      if (copiedTitles + reading.size > MAX_EMAIL_COPIED_HTML_IN_REFERENCES) {
        return null;
      }

      copiedTitles += reading.size;

      return reading.title;
    };

    restoring.link = function (
      this: Renderer,
      href: string,
      title: string | null | undefined,
      text: string,
    ): string {
      const address: HeldAddress = takeAddress(href, linkRules);

      // Refused or left out: its text, as any link the renderer does not keep.
      if (address.fate !== "kept") {
        return text;
      }

      return renderer.link.call(
        this,
        address.href,
        takeTitle(title, address.isCopy),
        text,
      );
    };

    restoring.image = function (
      this: Renderer,
      href: string,
      title: string | null,
      text: string,
    ): string {
      const address: HeldAddress = takeAddress(href, imageRules);

      if (address.fate === "refused") {
        return text;
      }

      if (address.fate === "leftOut") {
        return EmailInlineImages.getTooLargeImageNotice(text);
      }

      return renderer.image.call(
        this,
        address.href,
        takeTitle(title, address.isCopy),
        text,
      );
    };

    return restoring;
  }

  /*
   * Whether an image or a link whose address starts with `start` - what
   * comes before the first text held back of it - is one an email cannot
   * keep, whatever that text is: `start` holds its whole scheme, read as
   * getEmailUrl reads it, and that is none of `allowedSchemes`. For an
   * image (`mayBeInlineImage`), a data: URL can still be an inline image
   * (parseInlineImageDataUri), whose address is "data:", its media type and
   * ";base64," up to its first ",": so it is refused only when `start`
   * holds that "," - Utils/Markdown/Base64Data leaves the data's start
   * before what it holds back - and what comes up to it is not an inline
   * image's. False whenever `start` does not say: the address is put back
   * and judged whole.
   */
  private static isRefusedWhateverFollows(
    start: string,
    allowedSchemes: ReadonlyArray<string>,
    mayBeInlineImage: boolean,
  ): boolean {
    const url: string | null = Markdown.encodeEmailUrl(start);
    const scheme: string | null = url === null ? null : getUrlScheme(url);

    if (scheme === null || allowedSchemes.includes(scheme)) {
      return false;
    }

    if (!mayBeInlineImage || scheme !== "data") {
      return true;
    }

    const dataStart: number = start.indexOf(",");

    return (
      dataStart !== -1 &&
      !isInlineImageDataUriPrefix(start.slice(0, dataStart + 1))
    );
  }

  /**
   * Escape the five characters that can break out of HTML text or an
   * attribute value.
   *
   * Public because it is not only marked's business: code that hand-builds
   * an email fragment by string interpolation needs the same escaping, and
   * a second implementation is a second thing to get wrong.
   */
  public static escapeHtml(text: string): string {
    return SafeHtml.escape(text);
  }

  /**
   * The URL a link or image in an EMAIL may point at, ready to go between
   * the double quotes of an href or src attribute - or null when it may not
   * be emitted at all.
   *
   * An email's Markdown comes from people outside the recipient's control: a
   * public note, an incident description, a root cause built from telemetry.
   * marked emits any destination it is given, so `[Details](javascript:...)`
   * or `(data:text/html;base64,...)` became a live link in a status update
   * the subscriber trusts. Only the schemes listed are kept; a destination
   * with no scheme (a relative link or "#anchor") is kept too, as it was
   * before, and cannot run anything.
   *
   * The scheme is judged on exactly the URL the recipient's mail client will
   * see:
   * - The character references marked leaves in a destination
   *   ("&#x6A;avascript:") are decoded first, and the result is percent-
   *   encoded the way marked does it (encodeURI), which also encodes every
   *   space and control character a browser would strip out of a scheme.
   * - The URL is then HTML-escaped into the attribute, so the client's own
   *   decoding of the attribute gives back exactly the string that was
   *   checked. A character reference this does not decode ("&colon;")
   *   therefore reaches the client as literal text, never as a ":".
   */
  public static getEmailUrl(
    href: string | null | undefined,
    allowedSchemes: ReadonlyArray<string>,
  ): string | null {
    if (!href) {
      return null;
    }

    const url: string | null = Markdown.encodeEmailUrl(href);

    // A lone surrogate, which encodeURI refuses: no usable URL.
    if (url === null) {
      return null;
    }

    const scheme: string | null = getUrlScheme(url);

    if (scheme !== null && !allowedSchemes.includes(scheme)) {
      return null;
    }

    return Markdown.escapeHtml(url);
  }

  /*
   * The src an email's image is written with, ready to go between the
   * double quotes of the attribute: an inline raster image as its parser
   * rebuilt it (parseInlineImageDataUri), any other image as getEmailUrl
   * keeps it for an image - or null when the image is its alt text.
   */
  private static getEmailImageSource(href: string): string | null {
    const inlineImage: InlineImageDataUri | null =
      parseInlineImageDataUri(href);

    return inlineImage
      ? Markdown.escapeHtml(inlineImage.dataUri)
      : Markdown.getEmailUrl(href, EMAIL_IMAGE_SCHEMES);
  }

  /*
   * A link's or an image's destination as getEmailUrl judges it: the
   * character references it decodes decoded, then percent-encoded the way
   * marked does it (encodeURI) - or null when encodeURI cannot encode it (a
   * lone surrogate).
   */
  private static encodeEmailUrl(href: string): string | null {
    try {
      return encodeURI(Markdown.decodeUrlCharacterReferences(href)).replace(
        /%25/g,
        "%",
      );
    } catch {
      return null;
    }
  }

  /*
   * Numeric character references, and the named ones for the characters
   * escapeHtml writes. Anything else is left as written, and getEmailUrl's
   * escaping makes it inert.
   */
  private static decodeUrlCharacterReferences(text: string): string {
    return text.replace(
      /&(#[xX][0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,
      (match: string, reference: string): string => {
        if (reference.startsWith("#")) {
          const codePoint: number =
            reference[1] === "x" || reference[1] === "X"
              ? parseInt(reference.slice(2), 16)
              : parseInt(reference.slice(1), 10);

          if (
            !Number.isFinite(codePoint) ||
            codePoint <= 0 ||
            codePoint > 0x10ffff
          ) {
            return match;
          }

          return String.fromCodePoint(codePoint);
        }

        return URL_NAMED_CHARACTER_REFERENCES[reference] ?? match;
      },
    );
  }

  /*
   * The email renderer.
   *
   * Everything here is an INLINE style, and that is not a preference.
   * MailService compiles the Handlebars template and sends it — there is no
   * CSS inlining step anywhere in the pipeline — and Gmail strips <style>
   * blocks from the document head, so a class name emitted here reaches the
   * reader as nothing at all. That is why the Docs/Blog renderers' Tailwind
   * classes cannot be copied even though the override shape can.
   *
   * Until this existed the renderer was a bare `new Renderer()`. Alert and
   * incident root causes carry a GitHub-flavoured table of breaching
   * samples, and marked emitted it as a naked <table> with no borders, no
   * padding and no alignment: every row ran into the next, which is
   * precisely the part of the email an on-call engineer reads first.
   *
   * Outlook renders through Word, which ignores border-radius, box-shadow
   * and — importantly — overflow, so the scrolling wrapper the Docs and
   * Blog renderers use does not transfer. The table has to FIT instead:
   * the DetailBox card is 472px wide with 28px of padding either side,
   * leaving roughly 416px for a root-cause table that routinely runs to
   * four or more columns. Hence `width:100%` with `table-layout:auto` and
   * `word-break:break-word` on the cells — a long metric name wraps inside
   * its column rather than pushing the table past the body width.
   */
  private static getEmailRenderer(): Renderer {
    if (this.emailRenderer !== null) {
      return this.emailRenderer;
    }

    const renderer: Renderer = new Renderer();

    const cellFont: string =
      "font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;font-size:13px;line-height:20px;";

    renderer.table = function (header: string, body: string): string {
      return (
        `<table cellpadding="0" cellspacing="0" border="0" width="100%" ` +
        `style="border-collapse:collapse;width:100%;table-layout:auto;` +
        `margin:12px 0;border:1px solid #e2e8f0;">` +
        `<thead>${header}</thead><tbody>${body}</tbody></table>`
      );
    };

    /*
     * The lines between a table's rows are drawn above the row below them,
     * never under the row above: a line under the last row would sit on the
     * table's own bottom border and, in a collapsed table, be drawn in its
     * place - a cell's border wins over the table's - so the table's bottom
     * edge was the near-invisible hairline and the box read as open. (Detail
     * cards draw their dividers the same way: Utils/EmailDetailCard.ts in
     * the Notification feature set.)
     *
     * So the heavier rule under the header is the first body row's top
     * border, and each later body row draws a hairline above itself. A table
     * with a header and no body rows draws no line at all. marked renders a
     * table's cells row by row, its header row first, then calls tablerow
     * for each row and table() at the end, all in one synchronous pass: so a
     * header cell starts a new table, and the body rows it has finished so
     * far tell a body cell which row it is in.
     */
    let finishedBodyRows: number = 0;

    renderer.tablerow = function (content: string): string {
      if (content.startsWith("<td")) {
        finishedBodyRows += 1;
      }

      return `<tr>${content}</tr>`;
    };

    renderer.tablecell = function (
      content: string,
      flags: { header?: boolean; align?: string | null },
    ): string {
      const tag: string = flags.header ? "th" : "td";
      const align: string = flags.align ? `text-align:${flags.align};` : "";

      if (flags.header) {
        finishedBodyRows = 0;
      }

      /*
       * A header cell gets the tinted band; the first body row, the heavier
       * rule above it; a later body row, a hairline so consecutive rows stay
       * separable. All keep the same padding so the columns line up.
       */
      const rowDivider: string =
        finishedBodyRows === 0
          ? "border-top:1px solid #cbd5e1;"
          : "border-top:1px solid #f1f5f9;";
      const tone: string = flags.header
        ? "background-color:#f8fafc;color:#475569;font-weight:600;"
        : `color:#1e293b;font-weight:400;${rowDivider}`;

      return (
        `<${tag} style="padding:8px 10px;${cellFont}${tone}` +
        `word-break:break-word;${align || "text-align:left;"}">` +
        `${content}</${tag}>`
      );
    };

    /*
     * Lists. A platform monitor's root cause lists its affected resources
     * as a numbered list with a bullet list of details nested under each
     * item, and the cluster and metric details above it are bullets too.
     *
     * Left to the client, Gmail and Apple Mail indent every list level by
     * 40px — close to a tenth of the card, twice over for a nested list —
     * and Outlook's Word engine ignores padding on <ul>/<ol> and picks its
     * own margins. So the indent is a margin-left, which Outlook honours,
     * with padding zeroed: 24px holds a bullet, and 32px holds a numbered
     * marker up to three digits ("100."). The vertical margins give each
     * item's nested details a little air above and a gap below that
     * separates it from the next item.
     *
     * margin-left is a physical side, so it is followed by the logical
     * margin-inline-start / -end: a client that understands them moves
     * the indent to the marker side in right-to-left text, and one that
     * does not keeps the margin-left.
     */
    renderer.list = function (
      body: string,
      ordered: boolean,
      start: number | "",
    ): string {
      const tag: string = ordered ? "ol" : "ul";
      const startAttribute: string =
        ordered && start !== "" && start !== 1 ? ` start="${start}"` : "";
      const indent: string = ordered ? "32px" : "24px";

      return (
        `<${tag}${startAttribute} style="margin:6px 0 12px 0;` +
        `margin-left:${indent};margin-inline-start:${indent};` +
        `margin-inline-end:0;padding:0;">` +
        `${body}</${tag}>`
      );
    };

    renderer.listitem = function (text: string): string {
      return `<li style="margin:0 0 4px;padding:0;">${text}</li>`;
    };

    /*
     * The root cause backticks metric names, aliases and timestamps. Left
     * bare they were indistinguishable from the prose around them.
     *
     * `code` arrives ALREADY escaped — marked escapes codespan text before
     * it reaches the renderer — so escaping again here would turn a typed
     * "<img>" into the literal "&lt;img&gt;" on screen rather than the
     * "<img>" the author wrote. (The blog's renderers do escape a second
     * time; that is a separate defect in those surfaces, not a pattern to
     * copy. The docs renderer no longer does.)
     */
    renderer.codespan = function (code: string): string {
      return (
        `<code style="background-color:#f1f5f9;color:#0f172a;` +
        `padding:1px 5px;border-radius:4px;` +
        `font-family:'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;` +
        `font-size:12px;">${code}</code>`
      );
    };

    /*
     * Links and images keep only http, https and mailto destinations (http
     * and https for an image), plus relative ones: see getEmailUrl. Any
     * other link renders as its text alone, and any other image as its alt
     * text, so the words the author wrote still read in place.
     *
     * An image may also be an inline raster image: a data: URL whose bytes
     * are a PNG, JPEG, GIF or WebP (parseInlineImageDataUri). That is the
     * only way a synthetic monitor's screenshot reaches a description, and
     * it is fetched from nowhere and runs nothing. It is written out as the
     * parser rebuilt it, and MailService sends it as an inline attachment
     * the HTML points at by Content-ID, which Gmail and Outlook show and a
     * data: URL they do not. A data: link stays a link's text, whatever it
     * carries.
     *
     * The markup is marked's own. `text` is the link's rendered inline
     * content, and `title` and an image's alt text arrive already escaped by
     * marked's tokenizer, so escaping them again would show "&amp;".
     */
    renderer.link = function (
      href: string,
      title: string | null | undefined,
      text: string,
    ): string {
      const url: string | null = Markdown.getEmailUrl(href, EMAIL_LINK_SCHEMES);

      if (url === null) {
        return text;
      }

      const titleAttribute: string = title ? ` title="${title}"` : "";

      return `<a href="${url}"${titleAttribute}>${text}</a>`;
    };

    renderer.image = function (
      href: string,
      title: string | null,
      text: string,
    ): string {
      const url: string | null = Markdown.getEmailImageSource(href);

      if (url === null) {
        return text;
      }

      const titleAttribute: string = title ? ` title="${title}"` : "";

      return `<img src="${url}" alt="${text}"${titleAttribute} style="${EMAIL_IMAGE_STYLE}">`;
    };

    this.emailRenderer = renderer;

    return renderer;
  }

  /*
   * Compact renderer for small surfaces like the blog validation modal. Smaller,
   * quieter headings (no oversized doc titles, no permalink anchors), tight
   * paragraph/list rhythm, and subtle code styling so a long report stays
   * readable in a constrained, scrollable panel.
   */
  private static getBlogValidationRenderer(): Renderer {
    if (this.blogValidationRenderer !== null) {
      return this.blogValidationRenderer;
    }

    const renderer: Renderer = new Renderer();

    renderer.heading = function (text, level) {
      if (level <= 2) {
        return `<h3 class="mt-7 mb-3 pt-6 border-t border-gray-100 first:mt-0 first:pt-0 first:border-t-0 text-[0.7rem] font-semibold uppercase tracking-wider text-emerald-700">${text}</h3>`;
      }
      if (level === 3) {
        return `<h4 class="mt-5 mb-1.5 text-sm font-semibold text-gray-900">${text}</h4>`;
      }
      return `<h5 class="mt-4 mb-1 text-sm font-semibold text-gray-700">${text}</h5>`;
    };

    renderer.paragraph = function (text) {
      return `<p class="my-2.5 text-sm leading-relaxed text-gray-600">${text}</p>`;
    };

    renderer.list = function (body, ordered, start) {
      const tag: string = ordered ? "ol" : "ul";
      const cls: string = ordered
        ? "list-decimal pl-5 my-2 space-y-1.5 text-sm text-gray-600 marker:text-gray-400"
        : "list-disc pl-5 my-2 space-y-1.5 text-sm text-gray-600 marker:text-gray-300";
      const startAttr: string =
        ordered && start !== 1 ? ` start="${start}"` : "";
      return `<${tag}${startAttr} class="${cls}">${body}</${tag}>`;
    };
    renderer.listitem = function (text) {
      return `<li class="leading-relaxed pl-1">${text}</li>`;
    };

    renderer.strong = function (text) {
      return `<strong class="font-semibold text-gray-800">${text}</strong>`;
    };
    renderer.em = function (text) {
      return `<em class="italic">${text}</em>`;
    };

    renderer.blockquote = function (quote) {
      return `<blockquote class="my-3 border-s-2 border-emerald-200 ps-3 text-sm text-gray-600">${quote}</blockquote>`;
    };

    renderer.hr = function () {
      return '<hr class="my-5 border-t border-gray-100" />';
    };

    renderer.codespan = function (code) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<code class="rounded bg-gray-100 px-1.5 py-0.5 text-[0.8125rem] text-gray-700 font-mono break-words">${escaped}</code>`;
    };

    renderer.code = function (code, language) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<pre class="my-3 overflow-x-auto rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs leading-relaxed"><code class="language-${language} font-mono text-gray-700">${escaped}</code></pre>`;
    };

    renderer.table = function (header, body) {
      return `<div class="my-4 overflow-x-auto rounded-lg border border-gray-100"><table class="min-w-full text-sm text-left">${header}${body}</table></div>`;
    };
    renderer.tablerow = function (content) {
      return `<tr class="border-b border-gray-100 last:border-b-0">${content}</tr>`;
    };
    renderer.tablecell = function (content, flags) {
      const tag: string = flags.header ? "th" : "td";
      const align: string = flags.align ? ` text-${flags.align}` : "";
      const headerClass: string = flags.header
        ? " font-semibold text-gray-900 bg-gray-50"
        : " text-gray-600";
      return `<${tag} class="px-3 py-2${align}${headerClass}">${content}</${tag}>`;
    };

    renderer.link = function (href, _title, text) {
      if (!href) {
        return text as string;
      }
      const isExternal: boolean = href.startsWith("http");
      const rel: string = isExternal
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      return `<a href="${href}"${rel} class="text-emerald-700 font-medium underline decoration-emerald-200 underline-offset-2 hover:decoration-emerald-400 break-words">${text}</a>`;
    };

    this.blogValidationRenderer = renderer;

    return renderer;
  }

  /*
   * Heading text -> the `id` used for in-page anchors. The rules live in
   * MarkdownSlugify.ts, a dependency-free module, so the docs anchor scripts
   * (Scripts/Docs/CheckAnchors.ts, FixAnchors.ts) can share them without
   * pulling in marked or the telemetry stack — see the comment there.
   */
  public static slugify(text: string): string {
    return markdownSlugify(text);
  }

  /*
   * Human-readable names for the languages a docs code fence can declare.
   * Rendered into the code block's header bar. A fence with no language, or
   * one that is not listed here, gets no label rather than a guess — the
   * label used to come from highlight.js auto-detection, which cheerfully
   * announced shell snippets as "PHP".
   */
  private static readonly codeLanguageNames: Record<string, string> = {
    apache: "Apache",
    bash: "Bash",
    c: "C",
    cpp: "C++",
    csharp: "C#",
    css: "CSS",
    diff: "Diff",
    dns: "DNS Zone",
    docker: "Dockerfile",
    dockerfile: "Dockerfile",
    go: "Go",
    graphql: "GraphQL",
    groovy: "Groovy",
    hcl: "HCL",
    html: "HTML",
    http: "HTTP",
    ini: "INI",
    java: "Java",
    javascript: "JavaScript",
    js: "JavaScript",
    json: "JSON",
    jsx: "JSX",
    kotlin: "Kotlin",
    lua: "Lua",
    makefile: "Makefile",
    markdown: "Markdown",
    md: "Markdown",
    nginx: "Nginx",
    perl: "Perl",
    php: "PHP",
    powershell: "PowerShell",
    proto: "Protobuf",
    py: "Python",
    python: "Python",
    r: "R",
    rb: "Ruby",
    ruby: "Ruby",
    rust: "Rust",
    scala: "Scala",
    sh: "Shell",
    shell: "Shell",
    sql: "SQL",
    swift: "Swift",
    terraform: "Terraform",
    toml: "TOML",
    ts: "TypeScript",
    tsx: "TSX",
    typescript: "TypeScript",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
    zsh: "Shell",
  };

  private static getDocsRenderer(): Renderer {
    if (this.docsRenderer !== null) {
      return this.docsRenderer;
    }

    const renderer: Renderer = new Renderer();

    /*
     * The docs renderer emits semantic markup with a small set of stable class
     * names and leaves every colour, size and spacing decision to
     * Docs/Static/css/style.css. Utility classes used to be baked in here,
     * which meant the same element was styled from two places at once and made
     * a dark theme impossible without editing this file.
     */

    renderer.paragraph = function (text) {
      return `<p>${text}</p>`;
    };

    renderer.blockquote = function (quote) {
      /*
       * GitHub's alert syntax - "> [!NOTE]" on the first line - names the
       * kind of callout without a word in any language, so a translated page
       * keeps it as written and the label is put into the page's language
       * (see renderDocsCallout). The older "> **Note:**" form still works.
       */
      const alertMatch: RegExpMatchArray | null = quote.match(
        /^\s*<p>\[!(NOTE|TIP|INFO|IMPORTANT|WARNING|CAUTION|DANGER)\][ \t]*(?:\n|<br>)?/i,
      );

      if (alertMatch) {
        const body: string = quote
          .slice(alertMatch[0].length)
          // "[!NOTE]" alone on its line leaves an empty paragraph behind.
          .replace(/^\s*<\/p>/, "");

        return renderDocsCallout({
          type: alertMatch[1]!.toLowerCase(),
          title: null,
          bodyHtml: body.trim().startsWith("<") ? body : `<p>${body}`,
        });
      }

      const calloutMatch: RegExpMatchArray | null = quote.match(
        /<p[^>]*>\s*<strong>(Note|Warning|Tip|Danger|Info|Caution|Important):?<\/strong>/i,
      );

      if (calloutMatch) {
        const type: string = calloutMatch[1]!.toLowerCase();

        const content: string = quote.replace(
          /<p[^>]*>\s*<strong>(Note|Warning|Tip|Danger|Info|Caution|Important):?<\/strong>\s*/i,
          "<p>",
        );

        return renderDocsCallout({
          type: DOCS_CALLOUT_TYPES.includes(type) ? type : "note",
          title: null,
          bodyHtml: content,
        });
      }

      return `<blockquote class="docs-quote">${quote}</blockquote>`;
    };

    /*
     * marked hands a link's or an image's address over as written, so it
     * goes through docsSafeUrl before it is put in an attribute: a quote in
     * it cannot end the attribute, and a javascript: address is shown as
     * text, not as a link.
     */
    renderer.image = function (href, title, text) {
      const src: string | null = href
        ? docsSafeUrl(href, { isImage: true })
        : null;

      if (src === null) {
        return text || "";
      }

      const titleAttr: string = title
        ? ` title="${Markdown.escapeHtml(title)}"`
        : "";
      return `<img src="${src}" alt="${text || ""}"${titleAttr} class="docs-image" loading="lazy" decoding="async" />`;
    };

    renderer.link = function (href, title, text) {
      const safeHref: string | null = href ? docsSafeUrl(href) : null;

      if (safeHref === null) {
        return text as string;
      }

      const target: string = href.toLowerCase();
      const isExternal: boolean =
        (target.startsWith("http://") || target.startsWith("https://")) &&
        !target.includes("oneuptime.com");
      const titleAttr: string = title
        ? ` title="${Markdown.escapeHtml(title)}"`
        : "";
      const externalAttrs: string = isExternal
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      const marker: string = isExternal
        ? '<svg class="docs-link__external" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>'
        : "";

      return `<a class="docs-link" href="${safeHref}"${titleAttr}${externalAttrs}>${text}${marker}</a>`;
    };

    renderer.code = function (code, language) {
      /*
       * The info string is the language, optionally followed by a title:
       * ```bash title="install.sh"
       */
      const info: string = (language || "").trim();
      const lang: string = (info.split(/\s+/)[0] || "").toLowerCase();
      const titleMatch: RegExpMatchArray | null = info.match(
        /\btitle=(?:"([^"]*)"|'([^']*)')/,
      );
      const title: string = titleMatch
        ? (titleMatch[1] ?? titleMatch[2] ?? "").trim()
        : "";

      if (lang === "mermaid") {
        /*
         * Mermaid reads the diagram from textContent, so escaping here keeps
         * the diagram identical while making sure a `<` in a node label can
         * never be parsed as markup.
         */
        const caption: string = title
          ? `<p class="docs-diagram__caption">${Markdown.escapeHtml(title)}</p>`
          : "";
        return `<div class="docs-diagram"><div class="mermaid">${Markdown.escapeHtml(code)}</div>${caption}</div>`;
      }

      const escaped: string = Markdown.escapeHtml(code);
      const label: string | undefined = Markdown.codeLanguageNames[lang];
      /*
       * `nohighlight` stops highlight.js auto-detecting a language for fences
       * that never declared one — plain text is honest, a wrong grammar is not.
       */
      const codeClass: string = lang ? `language-${lang}` : "nohighlight";
      /*
       * The copy button ships hidden and the page's script unhides it once it
       * has wired up the click handler and filled in the translated label —
       * without scripting it would be a dead control with an English name.
       * The bar reserves its height either way, so nothing shifts.
       */
      const titleHtml: string = title
        ? `<span class="docs-code__title">${Markdown.escapeHtml(title)}</span>`
        : "";
      const bar: string = `<div class="docs-code__bar">
          ${titleHtml}<span class="docs-code__lang">${label || ""}</span>
          <button type="button" class="docs-code__copy" data-copy-code hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            <span class="docs-code__copy-text"></span>
          </button>
        </div>`;

      return `<div class="docs-code"${lang ? ` data-language="${Markdown.escapeHtml(lang)}"` : ""}>${bar}<pre><code class="${Markdown.escapeHtml(codeClass)}">${escaped}</code></pre></div>`;
    };

    renderer.heading = function (text, level) {
      const slug: string = Markdown.slugify(text);
      const anchor: string =
        level >= 2 && level <= 4
          ? `<a class="docs-anchor" href="#${slug}" aria-hidden="true" tabindex="-1">#</a>`
          : "";

      const safeLevel: number = Math.min(Math.max(level, 1), 6);

      return `<h${safeLevel} id="${slug}" class="docs-heading docs-h${safeLevel}"><span class="docs-heading__text">${text}</span>${anchor}</h${safeLevel}>`;
    };

    renderer.hr = function () {
      return '<hr class="docs-hr" />';
    };

    renderer.table = function (header, body) {
      return `<div class="docs-table-wrapper" tabindex="0"><table class="docs-table">${header}${body}</table></div>`;
    };

    renderer.tablerow = function (content) {
      return `<tr>${content}</tr>`;
    };

    renderer.tablecell = function (content, flags) {
      const tag: string = flags.header ? "th" : "td";
      const align: string = flags.align
        ? ` style="text-align:${flags.align}"`
        : "";
      return `<${tag}${align}>${content}</${tag}>`;
    };

    /*
     * Inline code. marked has escaped the code already, so it goes in as it
     * is: escaping it again showed every quote, `<` and `&` in inline code
     * as its entity - `"UP"` read "&quot;UP&quot;" on the page.
     *
     * A long name gets places to break at its dots, underscores and slashes
     * (MarkdownCodeBreaks.ts), so it wraps between its parts on a phone and
     * lets a table column narrow, rather than breaking mid-word or pushing
     * the table out of the page.
     */
    renderer.codespan = function (code) {
      return `<code class="docs-code-inline">${addCodeBreakOpportunities(code)}</code>`;
    };

    this.docsRenderer = renderer;

    return renderer;
  }

  private static getBlogRenderer(): Renderer {
    if (this.blogRenderer !== null) {
      return this.blogRenderer;
    }

    const renderer: Renderer = new Renderer();

    renderer.paragraph = function (text) {
      return `<p class="mt-5 mb-2 leading-8 text-gray-600 text-lg">${text}</p>`;
    };

    renderer.blockquote = function (quote) {
      return `<blockquote class="p-4 pt-1 pb-1 my-4 border-s-4 border-indigo-500">
            <div class="leading-8 text-gray-600">${quote}</div>
        </blockquote>`;
    };

    renderer.code = function (code, language) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<pre class="language-${language} rounded-md"><code class="language-${language} rounded-md">${escaped}</code></pre>`;
    };

    renderer.heading = function (text, level) {
      if (level === 1) {
        return `<h1 class="my-5 mt-8 text-4xl font-bold tracking-tight text-gray-800">${text}</h1>`;
      } else if (level === 2) {
        return `<h2 class="my-5  mt-8 text-3xl font-bold tracking-tight text-gray-800">${text}</h2>`;
      } else if (level === 3) {
        return `<h3 class="my-5  mt-8 text-2xl font-bold tracking-tight text-gray-800">${text}</h3>`;
      } else if (level === 4) {
        return `<h4 class="my-5  mt-8 text-xl font-bold tracking-tight text-gray-800">${text}</h4>`;
      } else if (level === 5) {
        return `<h5 class="my-5  mt-8 text-lg font-bold tracking-tight text-gray-800">${text}</h5>`;
      }
      return `<h6 class="my-5 tracking-tight font-bold text-gray-800">${text}</h6>`;
    };

    // Lists
    renderer.list = function (body, ordered, start) {
      const tag: string = ordered ? "ol" : "ul";
      const cls: string = ordered
        ? "list-decimal pl-6 my-6 space-y-2 text-gray-700"
        : "list-disc pl-6 my-6 space-y-2 text-gray-700";
      const startAttr: string =
        ordered && start !== 1 ? ` start="${start}"` : "";
      return `<${tag}${startAttr} class="${cls}">${body}</${tag}>`;
    };
    renderer.listitem = function (text) {
      return `<li class="leading-7">${text}</li>`;
    };

    // Tables
    renderer.table = function (header, body) {
      return `<div class="overflow-x-auto my-8"><table class="min-w-full border border-gray-200 text-sm text-left">
        ${header}${body}
      </table></div>`;
    };
    renderer.tablerow = function (content) {
      return `<tr class="border-b last:border-b-0">${content}</tr>`;
    };
    renderer.tablecell = function (content, flags) {
      const type: string = flags.header ? "th" : "td";
      const base: string = "px-4 py-2 border-r last:border-r-0 border-gray-200";
      const align: string = flags.align ? ` text-${flags.align}` : "";
      const weight: string = flags.header ? " font-semibold bg-gray-50" : "";
      return `<${type} class="${base}${align}${weight}">${content}</${type}>`;
    };

    // Inline code
    renderer.codespan = function (code) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<code class="rounded-md bg-gray-100 px-1.5 py-0.5 text-sm text-pink-600">${escaped}</code>`;
    };

    // Horizontal rule
    renderer.hr = function () {
      return '<hr class="my-12 border-t border-gray-200" />';
    };

    // Emphasis / Strong / Strikethrough
    renderer.strong = function (text) {
      return `<strong class="font-semibold text-gray-800">${text}</strong>`;
    };
    renderer.em = function (text) {
      return `<em class="italic text-gray-700">${text}</em>`;
    };
    renderer.del = function (text) {
      return `<del class="line-through text-gray-400">${text}</del>`;
    };

    // Images
    renderer.image = function (href, _title, text) {
      return `<figure class="my-8"><img src="${href}" alt="${text}" class="rounded-xl shadow-sm border border-gray-200" loading="lazy"/><figcaption class="mt-2 text-center text-sm text-gray-500">${text || ""}</figcaption></figure>`;
    };

    /*
     * Links
     * We explicitly add underline + color classes because Tailwind Typography (prose-*)
     * styles may get overridden by surrounding utility classes or global resets.
     * External links open in a new tab with proper rel attributes; internal links stay in-page.
     */
    renderer.link = function (href, title, text) {
      // Guard: if no href, just return the text.
      if (!href) {
        return text as string;
      }

      const isHash: boolean = href.startsWith("#");
      const isMailTo: boolean = href.startsWith("mailto:");
      const isTel: boolean = href.startsWith("tel:");
      const isInternal: boolean =
        href.startsWith("/") ||
        href.includes("oneuptime.com") ||
        isHash ||
        isMailTo ||
        isTel;

      const baseClasses: string = [
        "font-semibold",
        "text-indigo-600",
        "underline",
        "underline-offset-2",
        "decoration-indigo-300",
        "hover:decoration-indigo-500",
        "hover:text-indigo-500",
        "transition-colors",
      ].join(" ");

      const titleAttr: string = title ? ` title="${title}"` : "";
      const externalAttrs: string = isInternal
        ? ""
        : ' target="_blank" rel="noopener noreferrer"';

      return `<a href="${href}"${titleAttr} class="${baseClasses}"${externalAttrs}>${text}</a>`;
    };

    this.blogRenderer = renderer;

    return renderer;
  }
}
