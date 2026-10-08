import { Marked, MarkedOptions, Renderer, marked } from "marked";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import markdownSlugify from "./MarkdownSlugify";
import {
  DOCS_CALLOUT_TYPES,
  docsMarkdownExtensions,
  docsSafeUrl,
  renderDocsCallout,
} from "./MarkdownDocsExtensions";
import SafeHtml from "../../Types/SafeHtml";
import {
  InlineImageDataUri,
  isBase64Character,
  parseInlineImageDataUri,
} from "../../Utils/Markdown/InlineImageDataUri";
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

/*
 * Where the base64 data of a data: URL starts, or a sentinel already in the
 * input. It has no quantifier, so matching it never backtracks.
 */
const BASE64_DATA_START_OR_SENTINEL: RegExp = /;base64,|[\uE005\uE006]/gi;

/*
 * Base64 data at least this long is held back. A screenshot runs to millions
 * of characters; shorter data is no trouble to marked and stays in place.
 */
const HELD_BASE64_MIN_LENGTH: number = 1024;

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
 * What marked is given of an email's Markdown at most, once what is too
 * long for it is held back (Utils/Markdown/SlowMarkdown): blocks whose
 * emphasis, code spans, links or escapes would make it look ahead through
 * them for too long, and blocks nested too deep, are written as text.
 * marked reads lines, lists and tables in linear time, so their number is
 * not limited.
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
};

/*
 * convertToHTML renders an email field shorter at most this many times
 * after the first, each time to this share of what would just fit
 * (convertToEmailHtml).
 */
const MAX_EMAIL_FIT_ATTEMPTS: number = 5;
const EMAIL_FIT_MARGIN: number = 0.9;

// A run of base64 data after ";base64," in a text: where it starts and ends.
interface Base64Run {
  start: number;
  end: number;
}

// Where an image is in Markdown: "![", its address, and after its ")".
interface MarkdownImagePosition {
  start: number;
  addressStart: number;
  end: number;
}

// The start of base64 data after a data: URL's media type.
const BASE64_DATA_START: RegExp = /;base64,/gi;

// What a data: URL's media type and encoding read, before its data.
const IMAGE_DATA_URL_PREFIX: RegExp = /^data:image\/[a-z0-9.+-]+;base64,$/i;

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
}

// Puts back what was held back: as it was written, or escaped for HTML.
type PutBackFunction = (value: string, escape: boolean) => string;

const FENCE_OPEN: RegExp =
  /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])[ \t])*(?:(`{3,})[^`]*|(~{3,}).*)$/;
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
     */
    text = text.replace(
      /<(?:\/?[A-Za-z][^<>\uE000-\uE002]{0,65536}|[!?][^<>]{0,65536})>/g,
      "",
    );

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
   * line break where it can be, never inside an image) and rendered again,
   * shorter in proportion and with a margin, a few times at most, and ends
   * with EMAIL_TRUNCATED_TEXT_NOTE_HTML. A text far longer than that is cut
   * before it is first rendered: rendering megabytes only to drop them is
   * wasted work. A text that fits renders exactly as it always has.
   */
  private static async convertToEmailHtml(
    markdown: string,
    renderer: Renderer,
  ): Promise<string> {
    if (typeof markdown !== "string" || !markdown) {
      return Markdown.renderEmailMarkdown(markdown, renderer);
    }

    const runs: Array<Base64Run> = Markdown.getBase64Runs(markdown);
    const weight: number = Markdown.getEmailMarkdownWeight(markdown, runs);

    // How much of the text is kept, by weight; null while all of it is.
    let kept: number | null =
      weight > 2 * MAX_EMAIL_FIELD_HTML_BYTES
        ? 2 * MAX_EMAIL_FIELD_HTML_BYTES
        : null;
    let html: string = "";

    for (let attempt: number = 0; attempt <= MAX_EMAIL_FIT_ATTEMPTS; attempt++) {
      html =
        kept === null
          ? await Markdown.renderEmailMarkdown(markdown, renderer)
          : (await Markdown.renderEmailMarkdown(
              Markdown.cutEmailMarkdown(markdown, kept, runs),
              renderer,
            )) + EMAIL_TRUNCATED_TEXT_NOTE_HTML;

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
      const emailBody: string = await marked(held.markdown, {
        renderer: Markdown.withHeldDataInUrls(renderer, held.restore),
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
   * The runs of base64 data in `text` of at least `minLength` characters
   * (by default those long enough to matter: a screenshot, see
   * HELD_BASE64_MIN_LENGTH), each after a ";base64,", in order. Found with
   * a pattern that has no quantifier and a loop over the data.
   */
  private static getBase64Runs(
    text: string,
    minLength: number = HELD_BASE64_MIN_LENGTH,
  ): Array<Base64Run> {
    const runs: Array<Base64Run> = [];
    const pattern: RegExp = new RegExp(BASE64_DATA_START.source, "gi");

    for (
      let match: RegExpExecArray | null = pattern.exec(text);
      match !== null;
      match = pattern.exec(text)
    ) {
      const start: number = match.index + match[0].length;
      let end: number = start;

      while (end < text.length && isBase64Character(text.charCodeAt(end))) {
        end++;
      }

      pattern.lastIndex = end;

      if (end - start >= minLength) {
        runs.push({ start: start, end: end });
      }
    }

    return runs;
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
    const prefixStart: number = Math.max(0, run.start - 64);
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

    // After the data: spaces and a quoted title, then ")".
    const limit: number = Math.min(
      markdown.length,
      run.end + IMAGE_SYNTAX_WINDOW,
    );
    let end: number = run.end;

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
      end: end + 1,
    };
  }

  /*
   * The start of EMAIL Markdown up to `weight` (getEmailMarkdownWeight: an
   * inline image's data weighs nothing, so an image before the cut stays
   * whole). Cut at the last line break in the second half of that, so a line
   * is not split where it can be helped, else between whole characters -
   * and never inside an image: an image the cut would split is left out,
   * from its "![", so none of its data is left as text.
   */
  public static cutEmailMarkdown(
    markdown: string,
    weight: number,
    runs: Array<Base64Run> = Markdown.getBase64Runs(markdown),
  ): string {
    if (Markdown.getEmailMarkdownWeight(markdown, runs) <= weight) {
      return markdown;
    }

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
    const after: Base64Run | undefined = runs.find((run: Base64Run): boolean => {
      return run.start >= cut;
    });
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

    return markdown.slice(0, cut).trimEnd();
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
   *     but its last character. The last character stays so that whatever
   *     follows the data reads exactly as it did.
   *   - the middle of every over-long line, and the plain lines of every
   *     over-long run of lines, leave it (Utils/Markdown/OverLongText): the
   *     line keeps its start and end, and the run the lines that give it its
   *     structure.
   *   - a token character already in the input leaves it as it is.
   *
   * Links and images get what was held back before their URL is judged
   * (withHeldDataInUrls), as it was written, and the rendered HTML gets it
   * back wherever else marked wrote it - text, code, alt text, a title -
   * escaped, as marked escapes text. So an email whose text is too long for
   * marked shows it, as text, and the rest of the email is what it would
   * have been. Markdown of at most 64 KB with no screenshot holds back
   * nothing, and goes to marked as it is. Markdown with more than
   * MAX_MARKED_EMAIL_MARKDOWN_LENGTH left - long runs of lines that are not
   * plain - is not given to marked at all: it is sent as text.
   */
  private static holdBackFromMarked(markdown: string): HeldBackMarkdown {
    const asIs: (value: string) => string = (value: string): string => {
      return value;
    };

    if (typeof markdown !== "string" || !markdown) {
      return {
        markdown: markdown,
        restore: asIs,
        restoreEscaped: asIs,
      };
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

    let text: string = "";
    let copiedUpTo: number = 0;

    const pattern: RegExp = new RegExp(
      BASE64_DATA_START_OR_SENTINEL.source,
      "gi",
    );

    for (
      let match: RegExpExecArray | null = pattern.exec(source);
      match !== null;
      match = pattern.exec(source)
    ) {
      let holdFrom: number = match.index;
      let holdTo: number = match.index + match[0].length;

      if (match[0].length > 1) {
        // ";base64,": the data runs on for as long as it is base64.
        holdFrom = holdTo;

        let dataEnd: number = holdFrom;

        while (
          dataEnd < source.length &&
          isBase64Character(source.charCodeAt(dataEnd))
        ) {
          dataEnd++;
        }

        pattern.lastIndex = dataEnd;

        if (dataEnd - holdFrom < HELD_BASE64_MIN_LENGTH) {
          continue;
        }

        holdTo = dataEnd - 1;
      }

      // Otherwise a sentinel already in the input, held back as it is.
      text +=
        source.slice(copiedUpTo, holdFrom) +
        hold(source.slice(holdFrom, holdTo));
      copiedUpTo = holdTo;
    }

    text = holdBackOverLongText(text + source.slice(copiedUpTo), hold);

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
      return {
        markdown: markdown,
        restore: asIs,
        restoreEscaped: asIs,
      };
    }

    return {
      markdown: text,
      restore: (value: string): string => {
        return putBack(value, false);
      },
      restoreEscaped: (value: string): string => {
        return putBack(value, true);
      },
    };
  }

  /*
   * An email's Markdown as text, for when marked cannot render it: every
   * character escaped, every line on a line of its own - but an inline image
   * ("![alt](data:image/png;base64,...)", a screenshot) still an image, which
   * MailService sends as an attachment: written as text, its data would be
   * megabytes of base64 in the email. An image whose data is not an image
   * this sends (parseInlineImageDataUri) is its alt text.
   */
  private static getEmailTextHtml(markdown: string): string {
    const text: string = String(markdown ?? "");
    let html: string = "";
    let copiedUpTo: number = 0;

    for (const run of Markdown.getBase64Runs(text, 1)) {
      const found: MarkdownImagePosition | null = Markdown.findImageAround(
        text,
        run,
      );

      if (found === null || found.start < copiedUpTo) {
        continue;
      }

      const alt: string = text.slice(found.start + 2, found.addressStart - 2);
      const image: InlineImageDataUri | null = parseInlineImageDataUri(
        text.slice(found.addressStart, run.end),
      );

      html += Markdown.getEmailLinesHtml(text.slice(copiedUpTo, found.start));
      html += image
        ? `<img src="${Markdown.escapeHtml(image.dataUri)}" alt="${Markdown.escapeHtml(alt)}" style="${EMAIL_IMAGE_STYLE}">`
        : Markdown.escapeHtml(alt);
      copiedUpTo = found.end;
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
   * first (see holdBackFromMarked), so it judges the URL the author wrote.
   */
  private static withHeldDataInUrls(
    renderer: Renderer,
    restore: (value: string) => string,
  ): Renderer {
    const restoring: Renderer = Object.create(renderer) as Renderer;

    restoring.link = function (
      this: Renderer,
      href: string,
      title: string | null | undefined,
      text: string,
    ): string {
      return renderer.link.call(this, restore(href), title, text);
    };

    restoring.image = function (
      this: Renderer,
      href: string,
      title: string | null,
      text: string,
    ): string {
      return renderer.image.call(this, restore(href), title, text);
    };

    return restoring;
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

    let url: string;

    try {
      url = encodeURI(Markdown.decodeUrlCharacterReferences(href)).replace(
        /%25/g,
        "%",
      );
    } catch {
      // A lone surrogate, which encodeURI refuses: no usable URL.
      return null;
    }

    const scheme: RegExpMatchArray | null = url.match(
      /^([a-zA-Z][a-zA-Z0-9+.-]*):/,
    );

    if (scheme && !allowedSchemes.includes(scheme[1]!.toLowerCase())) {
      return null;
    }

    return Markdown.escapeHtml(url);
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

    renderer.tablerow = function (content: string): string {
      return `<tr>${content}</tr>`;
    };

    renderer.tablecell = function (
      content: string,
      flags: { header?: boolean; align?: string | null },
    ): string {
      const tag: string = flags.header ? "th" : "td";
      const align: string = flags.align ? `text-align:${flags.align};` : "";

      /*
       * A header cell gets the tinted band and the heavier bottom rule; a
       * body cell gets a hairline so consecutive rows stay separable. Both
       * keep the same padding so the columns line up.
       */
      const tone: string = flags.header
        ? "background-color:#f8fafc;color:#475569;font-weight:600;border-bottom:1px solid #cbd5e1;"
        : "color:#1e293b;font-weight:400;border-bottom:1px solid #f1f5f9;";

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
      const inlineImage: InlineImageDataUri | null =
        parseInlineImageDataUri(href);

      const url: string | null = inlineImage
        ? Markdown.escapeHtml(inlineImage.dataUri)
        : Markdown.getEmailUrl(href, EMAIL_IMAGE_SCHEMES);

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
     */
    renderer.codespan = function (code) {
      return `<code class="docs-code-inline">${code}</code>`;
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
