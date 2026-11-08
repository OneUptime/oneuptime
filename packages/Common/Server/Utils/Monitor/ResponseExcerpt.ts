import {
  MonitorEvaluationDetailsLimits,
  MonitorEvaluationExcerpt,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import JsonTextScanner, { JsonTextScan, JsonTextSpan } from "./JsonTextScanner";
import MonitorEvidenceRedaction from "./MonitorEvidenceRedaction";

/*
 * A SHORT, REDACTED PART OF A RESPONSE, AROUND WHAT A FILTER MATCHED.
 *
 * A Website or API monitor can read a response of megabytes and match one
 * word in it. What explains the incident is that word and the text around
 * it, so that is what is kept: a few lines either side of the match, never
 * the body.
 *
 * Redaction runs before the cut, on a wider stretch of the text that starts
 * and ends where a token cannot (a quote, a space, a comma...). A token or an
 * email that runs into the excerpt is therefore seen whole by the rules and
 * masked whole, instead of being cut into a piece no rule recognizes. Values
 * of JSON fields whose names say secret are masked from their positions in
 * the text (JsonTextScanner), so a JSON response is masked by its structure
 * as well as by its text.
 */

export interface ResponseText {
  // What the excerpt is cut from.
  text: string;
  // The response is JSON: its sensitive values, where they sit in `text`.
  scan?: JsonTextScan | undefined;
}

export interface MatchExcerptResult {
  excerpt?: MonitorEvaluationExcerpt | undefined;
  // The JSON path of the key or value that holds the match.
  path?: string | undefined;
  // What matched is (part of) a masked value.
  isMatchMasked?: boolean | undefined;
}

// Wider than what is kept, so the rules see whole tokens near the cut.
const REDACTION_CONTEXT_CHARS: number = 4 * 160;

// How far a window grows to reach a place no token runs across.
const MAX_BOUNDARY_SEARCH_CHARS: number = 4096;

/*
 * A window's start also takes in the two words before it, at most this many
 * characters each: the rules that mask a value read the name or the scheme
 * in front of it - "Bearer <token>", "password: <value>", "token=<value>".
 */
const LEADING_WORDS: number = 2;
const MAX_LEADING_WORD_CHARS: number = 128;

// Runs of white space collapse to one space in an excerpt.
const WHITESPACE_RUN: RegExp = /\s+/g;

export default class ResponseExcerpt {
  /*
   * The text an excerpt is cut from, from a stored response body: a JSON
   * text as it was stored, or the text inside a body the probe stored as
   * one JSON string (an API monitor's text response). Bodies longer than
   * MonitorEvaluationDetailsLimits.scannedBodyChars are not parsed.
   */
  public static readText(body: unknown): ResponseText | null {
    let text: string;

    if (typeof body === "string") {
      text = body;
    } else if (body && typeof body === "object") {
      try {
        text = JSON.stringify(body);
      } catch {
        return null;
      }
    } else {
      return null;
    }

    if (!text) {
      return { text: "" };
    }

    if (text.length > MonitorEvaluationDetailsLimits.scannedBodyChars) {
      return { text: text };
    }

    const firstCharacter: string = text.trimStart().charAt(0);

    // The probe stores an API monitor's text response as a JSON string.
    if (firstCharacter === '"') {
      try {
        const decoded: unknown = JSON.parse(text);

        if (typeof decoded === "string") {
          return { text: decoded };
        }
      } catch {
        return { text: text };
      }
    }

    if (firstCharacter !== "{" && firstCharacter !== "[") {
      return { text: text };
    }

    const scan: JsonTextScan | null = JsonTextScanner.scan({
      text: text,
      isSensitiveName: (name: string): boolean => {
        return MonitorEvidenceRedaction.isSensitiveName(name);
      },
    });

    return scan ? { text: text, scan: scan } : { text: text };
  }

  /*
   * The excerpt around the first place `needle` is found in the response,
   * and the JSON path of the field there. Null when the needle is not in the
   * text at all - the filter did not match on it.
   */
  public static aroundMatch(input: {
    response: ResponseText;
    needle: string;
    // Compare without case (header values are compared lowercased).
    ignoreCase?: boolean | undefined;
  }): MatchExcerptResult | null {
    const text: string = input.response.text;

    if (!text || !input.needle) {
      return null;
    }

    const haystack: string = input.ignoreCase ? text.toLowerCase() : text;
    const needleToFind: string = input.ignoreCase
      ? input.needle.toLowerCase()
      : input.needle;

    const matchIndex: number = haystack.indexOf(needleToFind);

    if (matchIndex === -1) {
      return null;
    }

    const matchLength: number = Math.min(
      input.needle.length,
      MonitorEvaluationDetailsLimits.matchChars,
    );

    const path: string | undefined = input.response.scan
      ? ResponseExcerpt.pathAt(input.response, matchIndex)
      : undefined;

    // The window the rules read, grown to places no token runs across.
    const windowStart: number = ResponseExcerpt.takeLeadingWords(
      text,
      ResponseExcerpt.growToBoundary(
        text,
        Math.max(0, matchIndex - REDACTION_CONTEXT_CHARS),
        -1,
      ),
    );
    const windowEnd: number = ResponseExcerpt.growToBoundary(
      text,
      Math.min(text.length, matchIndex + matchLength + REDACTION_CONTEXT_CHARS),
      1,
    );

    const redacted: string = MonitorEvidenceRedaction.redactText(
      ResponseExcerpt.maskSpans({
        text: text,
        start: windowStart,
        end: windowEnd,
        spans: input.response.scan?.sensitiveSpans || [],
      }),
    );

    /*
     * The match, found again in the redacted window: at the occurrence
     * nearest where it was. Masking only ever replaces a value whole, so a
     * match that is part of a masked value is not found again there - and
     * an excerpt is never cut through a masked value.
     */
    const matchedText: string = text.slice(
      matchIndex,
      matchIndex + matchLength,
    );
    const located: number = ResponseExcerpt.findNearest({
      text: input.ignoreCase ? redacted.toLowerCase() : redacted,
      needle: input.ignoreCase ? matchedText.toLowerCase() : matchedText,
      near: matchIndex - windowStart,
    });

    if (located === -1) {
      return { path: path, isMatchMasked: true };
    }

    const context: number = MonitorEvaluationDetailsLimits.excerptContextChars;

    const displayStart: number = ResponseExcerpt.safeCut(
      redacted,
      Math.max(0, located - context),
      1,
    );
    const displayEnd: number = ResponseExcerpt.safeCut(
      redacted,
      Math.min(redacted.length, located + matchLength + context),
      -1,
    );

    return {
      path: path,
      excerpt: {
        before: ResponseExcerpt.collapse(
          redacted.slice(displayStart, located),
        ).trimStart(),
        match: ResponseExcerpt.collapse(
          redacted.slice(located, located + matchLength),
        ),
        after: ResponseExcerpt.collapse(
          redacted.slice(located + matchLength, displayEnd),
        ).trimEnd(),
        isCutAtStart: windowStart + displayStart > 0,
        isCutAtEnd: displayEnd < redacted.length || windowEnd < text.length,
      },
    };
  }

  /*
   * The start of the response, for a filter that found nothing to point at
   * (Response Body Does Not Contain): how the response began is what says
   * what came back instead.
   */
  public static atStart(input: {
    response: ResponseText;
  }): MonitorEvaluationExcerpt | null {
    const text: string = input.response.text;

    if (!text || !text.trim()) {
      return null;
    }

    const keep: number = MonitorEvaluationDetailsLimits.startExcerptChars;

    const windowEnd: number = ResponseExcerpt.growToBoundary(
      text,
      Math.min(text.length, keep + REDACTION_CONTEXT_CHARS),
      1,
    );

    const redacted: string = MonitorEvidenceRedaction.redactText(
      ResponseExcerpt.maskSpans({
        text: text,
        start: 0,
        end: windowEnd,
        spans: input.response.scan?.sensitiveSpans || [],
      }),
    );

    const displayEnd: number = ResponseExcerpt.safeCut(
      redacted,
      Math.min(redacted.length, keep),
      -1,
    );

    return {
      before: "",
      match: "",
      after: ResponseExcerpt.collapse(redacted.slice(0, displayEnd)).trim(),
      isCutAtStart: false,
      isCutAtEnd: displayEnd < redacted.length || windowEnd < text.length,
    };
  }

  // The path of the key or value whose text holds `index`.
  public static pathAt(
    response: ResponseText,
    index: number,
  ): string | undefined {
    if (!response.scan) {
      return undefined;
    }

    const scan: JsonTextScan | null = JsonTextScanner.scan({
      text: response.text,
      isSensitiveName: (): boolean => {
        return false;
      },
      index: index,
    });

    return scan?.pathAtIndex || undefined;
  }

  /*
   * The text between `start` and `end` with every sensitive span in it
   * replaced by [REDACTED] - a span the window cuts included, so no part of
   * a masked value is left at the window's edge.
   */
  private static maskSpans(input: {
    text: string;
    start: number;
    end: number;
    spans: Array<JsonTextSpan>;
  }): string {
    let result: string = "";
    let cursor: number = input.start;

    for (const span of input.spans) {
      if (span.end <= input.start) {
        continue;
      }

      if (span.start >= input.end) {
        break;
      }

      const spanStart: number = Math.max(span.start, input.start);
      const spanEnd: number = Math.min(span.end, input.end);

      if (spanStart > cursor) {
        result += input.text.slice(cursor, spanStart);
      }

      result += MonitorEvidenceRedaction.REDACTED;
      cursor = Math.max(cursor, spanEnd);
    }

    if (cursor < input.end) {
      result += input.text.slice(cursor, input.end);
    }

    return result;
  }

  /*
   * Moves `position` outwards (direction -1 back, 1 forward) to the nearest
   * character no token is made of, reading at most
   * MAX_BOUNDARY_SEARCH_CHARS; past that, the window starts or ends there.
   */
  private static growToBoundary(
    text: string,
    position: number,
    direction: -1 | 1,
  ): number {
    let current: number = position;
    let read: number = 0;

    while (read < MAX_BOUNDARY_SEARCH_CHARS) {
      if (direction === -1 ? current <= 0 : current >= text.length) {
        return direction === -1 ? 0 : text.length;
      }

      const character: string =
        direction === -1 ? text.charAt(current - 1) : text.charAt(current);

      if (ResponseExcerpt.isBoundary(character)) {
        return current;
      }

      current += direction;
      read++;
    }

    return current;
  }

  /*
   * Moves a window's start back over the words before it (LEADING_WORDS of
   * them, each at most MAX_LEADING_WORD_CHARS), and the separators between.
   */
  private static takeLeadingWords(text: string, position: number): number {
    let current: number = position;

    for (let word: number = 0; word < LEADING_WORDS; word++) {
      while (
        current > 0 &&
        ResponseExcerpt.isBoundary(text.charAt(current - 1))
      ) {
        current--;
      }

      let read: number = 0;

      while (
        current > 0 &&
        read < MAX_LEADING_WORD_CHARS &&
        !ResponseExcerpt.isBoundary(text.charAt(current - 1))
      ) {
        current--;
        read++;
      }
    }

    /*
     * And the separators before the first word, so a quoted name keeps its
     * opening quote: "password":"..." is what the JSON text rule reads.
     */
    let separators: number = 0;

    while (
      current > 0 &&
      separators < 8 &&
      ResponseExcerpt.isBoundary(text.charAt(current - 1))
    ) {
      current--;
      separators++;
    }

    return current;
  }

  /*
   * A cut point that does not split a [REDACTED] marker or a surrogate
   * pair: moved inwards (direction 1 forward for a start, -1 back for an
   * end) past either.
   */
  private static safeCut(
    text: string,
    position: number,
    direction: -1 | 1,
  ): number {
    let cut: number = position;
    const marker: string = MonitorEvidenceRedaction.REDACTED;

    // Inside a marker: the marker's start is at most marker.length back.
    const searchFrom: number = Math.max(0, cut - marker.length + 1);
    const markerStart: number = text.indexOf(marker, searchFrom);

    if (
      markerStart !== -1 &&
      markerStart < cut &&
      cut < markerStart + marker.length
    ) {
      cut = direction === 1 ? markerStart + marker.length : markerStart;
    }

    // Inside a surrogate pair: between a high and a low surrogate.
    if (cut > 0 && cut < text.length) {
      const before: number = text.charCodeAt(cut - 1);
      const after: number = text.charCodeAt(cut);

      if (
        before >= 0xd800 &&
        before <= 0xdbff &&
        after >= 0xdc00 &&
        after <= 0xdfff
      ) {
        cut = cut + direction;
      }
    }

    return Math.max(0, Math.min(text.length, cut));
  }

  // The occurrence of `needle` in `text` nearest to `near`, or -1.
  private static findNearest(input: {
    text: string;
    needle: string;
    near: number;
  }): number {
    let best: number = -1;
    let bestDistance: number = Number.MAX_SAFE_INTEGER;
    let index: number = input.text.indexOf(input.needle);

    while (index !== -1) {
      const distance: number = Math.abs(index - input.near);

      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }

      // Past `near`, every later one is farther.
      if (index > input.near) {
        break;
      }

      index = input.text.indexOf(input.needle, index + 1);
    }

    return best;
  }

  private static collapse(text: string): string {
    return text.replace(WHITESPACE_RUN, " ");
  }

  private static isBoundary(character: string): boolean {
    return (
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r" ||
      character === '"' ||
      character === "'" ||
      character === "," ||
      character === "{" ||
      character === "}" ||
      character === "[" ||
      character === "]" ||
      character === "<" ||
      character === ">" ||
      character === ";" ||
      character === "&" ||
      character === "(" ||
      character === ")" ||
      character === "|"
    );
  }
}
