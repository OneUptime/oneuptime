import {
  CallSummaryCitation,
  CallSummaryRootCause,
  CallSummaryRootCauseOutcome,
} from "../../Types/VideoCall/CallSummary";

/*
 * THE ROOT CAUSE A PERSON STARTS FROM, when they use what OneUptime AI
 * suggested from an incident call (issue #4875).
 *
 * The suggestion, then each transcript line it rests on as a quote - time,
 * speaker, words - in the order they were said, so the root cause keeps
 * what it was based on. It opens in the root cause's own editor, where the
 * person reads and changes it before anything is saved, and once saved the
 * incident page shows it.
 *
 * Both read Markdown, each its own way. The editor (MarkdownConverters)
 * honours no backslash escape, reads an underscore inside a word as
 * emphasis, and keeps a few HTML tags (<u>, <br>, ...) wherever they stand,
 * inside code too. The page (GitHub Markdown) hides a backslash before
 * punctuation, reads "&amp;" as "&" and "<https://...>" as a link without
 * its brackets. So the text is not escaped: each
 * word one of them would restyle, hide or turn into something - DB_POOL_MAX,
 * a *, a [link](...), an image, a tag, a heading or list marker starting a
 * line - is written as code, which both show as written and the editor
 * saves back unchanged. Both pieces are somebody else's text (the model
 * wrote the sentence, a participant said the words), so nothing in them
 * becomes a link, an image or markup.
 *
 * Each quote is a plain "> " quote, never a callout (the page reads only
 * "> [!KIND]" and "> **Note:**" as one, GuideCalloutsMarked).
 */

// Characters that make the editor or the page restyle a word, link it or hide part of it.
const RESTYLING_CHARACTERS: ReadonlyArray<string> = ["_", "*", "~", "[", "\\"];

// A first word that makes its line a heading, a list item or a rule.
const BLOCK_MARKER: RegExp = /^(?:#{1,6}|[-+]+|\d{1,9}[.)])$/;

// The HTML tags the editor keeps as tags wherever they stand, inside code too.
const EDITOR_TAG_NAMES: ReadonlyArray<string> = ["u", "sub", "sup", "kbd", "br"];

// Punctuation around a word that stays outside it when it is written as code.
const LEADING_PUNCTUATION: ReadonlyArray<string> = ["(", '"', "'", "“", "‘"];
const TRAILING_PUNCTUATION: ReadonlyArray<string> = [
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  ")",
  '"',
  "'",
  "”",
  "’",
];

// Control characters, which neither shows; line breaks and tabs are spaces here.
const CONTROL_CHARACTERS: RegExp = /[\u0000-\u0008\u000E-\u001F\u007F]/g;
const WHITESPACE_RUN: RegExp = /\s+/;

export default class CallSummaryMarkdown {
  public static buildRootCause(rootCause: CallSummaryRootCause): string {
    const summary: string =
      rootCause.outcome === CallSummaryRootCauseOutcome.Suggested
        ? CallSummaryMarkdown.asEditorText(rootCause.summary || "")
        : "";

    if (!summary) {
      return "";
    }

    const quotes: Array<string> = [...rootCause.citations]
      .sort((left: CallSummaryCitation, right: CallSummaryCitation) => {
        return left.line - right.line;
      })
      .map((citation: CallSummaryCitation): string => {
        return CallSummaryMarkdown.quote(citation);
      });

    return [summary, ...quotes].join("\n\n");
  }

  // "> 00:12:03 · Priya Shah: the words".
  public static quote(citation: CallSummaryCitation): string {
    const head: string = [citation.time, citation.speaker]
      .map((piece: string | undefined): string => {
        return (piece || "").trim();
      })
      .filter((piece: string): boolean => {
        return piece.length > 0;
      })
      .join(" · ");

    const said: string = head ? `${head}: ${citation.text}` : citation.text;

    return `> ${CallSummaryMarkdown.asEditorText(said)}`;
  }

  /*
   * The text on one line, as the editor and the page both show it: each
   * word that would be restyled, hidden or turned into something, as code.
   */
  public static asEditorText(text: string): string {
    return text
      .replace(CONTROL_CHARACTERS, "")
      .split(WHITESPACE_RUN)
      .filter((word: string): boolean => {
        return word.length > 0;
      })
      .map((word: string, index: number): string => {
        return CallSummaryMarkdown.asEditorWord(word, index === 0);
      })
      .join(" ");
  }

  private static asEditorWord(word: string, startsTheLine: boolean): string {
    // A backtick would end the code a word is written as.
    const plain: string = word.split("`").join("'");

    /*
     * A tag the editor keeps (<u>, <br>, ...) is read even inside code. Its
     * "<" stays out of code, followed by code, so no tag is left to read.
     */
    const tagStarts: Array<number> = CallSummaryMarkdown.editorTagStarts(plain);

    if (tagStarts.length > 0) {
      const pieces: Array<string> = [];
      let from: number = 0;

      for (const tagStart of tagStarts) {
        pieces.push(plain.slice(from, tagStart));
        from = tagStart + 1;
      }

      pieces.push(plain.slice(from));

      const first: string = pieces[0] || "";

      return [
        first ? CallSummaryMarkdown.asEditorWord(first, startsTheLine) : "",
        ...pieces.slice(1).map((piece: string): string => {
          return CallSummaryMarkdown.asCode(piece);
        }),
      ].join("<");
    }

    // ">" starts a quote even with no space after it, and "<" a block of HTML.
    if (
      startsTheLine &&
      (plain.startsWith(">") ||
        plain.startsWith("<") ||
        BLOCK_MARKER.test(plain))
    ) {
      return `\`${plain}\``;
    }

    return CallSummaryMarkdown.needsCode(plain)
      ? CallSummaryMarkdown.asCode(plain)
      : plain;
  }

  private static needsCode(word: string): boolean {
    if (
      RESTYLING_CHARACTERS.some((character: string): boolean => {
        return word.includes(character);
      })
    ) {
      return true;
    }

    // An entity, "&amp;", which the page shows as the character it names.
    const ampersand: number = word.indexOf("&");

    if (ampersand >= 0 && word.indexOf(";", ampersand) > ampersand) {
      return true;
    }

    /*
     * An address in angle brackets, "<https://...>", which the page shows
     * as a link without its brackets. Other HTML the page shows as written.
     */
    const angle: number = word.indexOf("<");

    return angle >= 0 && word.indexOf(">", angle) > angle;
  }

  // Where in the word a "<" opens a tag the editor keeps: "<u>", "</br", "<SUP".
  private static editorTagStarts(word: string): Array<number> {
    const starts: Array<number> = [];

    for (
      let index: number = word.indexOf("<");
      index >= 0;
      index = word.indexOf("<", index + 1)
    ) {
      const nameAt: number = word.charAt(index + 1) === "/" ? index + 2 : index + 1;

      const opensTag: boolean = EDITOR_TAG_NAMES.some(
        (name: string): boolean => {
          const after: string = word.charAt(nameAt + name.length);

          return (
            word.slice(nameAt, nameAt + name.length).toLowerCase() === name &&
            (after === "" || after === ">" || after === "/")
          );
        },
      );

      if (opensTag) {
        starts.push(index);
      }
    }

    return starts;
  }

  // The word as code, with the punctuation around it kept outside.
  private static asCode(word: string): string {
    let start: number = 0;
    let end: number = word.length;

    while (start < end - 1 && LEADING_PUNCTUATION.includes(word.charAt(start))) {
      start++;
    }

    while (end - 1 > start && TRAILING_PUNCTUATION.includes(word.charAt(end - 1))) {
      end--;
    }

    return `${word.slice(0, start)}\`${word.slice(start, end)}\`${word.slice(end)}`;
  }
}
