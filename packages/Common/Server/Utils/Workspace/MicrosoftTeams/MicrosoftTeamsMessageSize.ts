import { JSONObject } from "../../../../Types/JSON";
import { truncateToLength } from "../../Database/TruncateColumnValue";
import { cutToLength } from "../../../../Utils/Markdown/OverLongText";

/*
 * How big a message Microsoft Teams takes from a bot.
 *
 * Teams measures a bot message as UTF-16 and refuses one over its limit with
 * HTTP 413 MessageSizeTooBig ("Message size too large."), which the Bot
 * Framework SDK does not retry. The documented limit has moved over the years
 * (28 KB, then 40 KB, now "about 100 KB, keep it within 80 KB"), and Teams
 * checks it against its own internal form of the message rather than the JSON
 * we send, so 413s are reported well under the documented number. Anything we
 * build that grows with the size of a project is therefore kept to a budget
 * with a wide margin, and a card Teams still refuses is sent again, smaller.
 *
 * Issue #4111: the "create incident" and "create maintenance" forms listed
 * every monitor, label and on-call policy of the project, so a few hundred
 * monitors were enough for Teams to refuse the form.
 */

/*
 * Budgets for an adaptive card, in the order they are tried. The next one is
 * only tried after Teams refused the card built for the previous one. A budget
 * of 0 leaves every optional list off the card.
 */
export const MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES: ReadonlyArray<number> =
  [40 * 1024, 20 * 1024, 0];

// Budget for a plain text reply, such as "show active incidents".
export const MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES: number = 40 * 1024;

/*
 * The most of one markdown text - a description, a note or a root cause in
 * a notification - a message carries, as Teams counts it: Microsoft's
 * "keep a bot message within 80 KB". A response body or a log a
 * description template placed can be megabytes, which Teams would refuse,
 * and which the card builder's regular expressions cannot read safely: a
 * longer text is cut to this (cutToLength) and ends with
 * MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE.
 */
export const MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES: number = 80 * 1024;

// Ends a markdown text cut to fit - the words a cut Slack message ends with.
export const MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE: string =
  "\n\n_… (truncated — see OneUptime for the full text)_";

// How big what Teams is sent for a text is, in bytes as Teams counts them.
export type MeasureTextFunction = (text: string) => number;

/*
 * fitMarkdownText cuts a text that measures over the budget shorter at most
 * this many times, each time to this share of what would just fit.
 */
const MAX_FIT_ATTEMPTS: number = 5;
const FIT_MARGIN: number = 0.9;

const DEFAULT_TRUNCATION_NOTE: string =
  "…\n\n_This reply was shortened to fit in Microsoft Teams. Open OneUptime to see everything._";

export default class MicrosoftTeamsMessageSize {
  // Size as Teams counts it: JavaScript strings are UTF-16, two bytes a unit.
  public static getSizeInBytes(value: string | JSONObject): number {
    const text: string =
      typeof value === "string" ? value : JSON.stringify(value);

    return text.length * 2;
  }

  /*
   * Whether Teams refused a message as too large.
   *
   * The Bot Framework connector throws a RestError that carries statusCode
   * 413 and code "MessageSizeTooBig". It is matched on those fields and not
   * on its class: @azure/* is not a dependency of Common (botbuilder brings
   * it), and the error can come from another JavaScript realm, where
   * instanceof is false. The status code alone is enough when a proxy in
   * front of the connector answered 413 with a body that is not JSON.
   */
  public static isMessageTooLargeError(error: unknown): boolean {
    return (
      this.getErrorStatusCode(error) === 413 ||
      this.getErrorCode(error) === "MessageSizeTooBig"
    );
  }

  // The HTTP status of a failed Bot Framework call, when the error has one.
  public static getErrorStatusCode(error: unknown): number | undefined {
    if (!error || typeof error !== "object") {
      return undefined;
    }

    const candidate: {
      statusCode?: unknown;
      response?: { status?: unknown } | undefined;
    } = error as {
      statusCode?: unknown;
      response?: { status?: unknown } | undefined;
    };

    if (typeof candidate.statusCode === "number") {
      return candidate.statusCode;
    }

    if (typeof candidate.response?.status === "number") {
      return candidate.response.status;
    }

    return undefined;
  }

  // The error code of a failed Bot Framework call, e.g. "MessageSizeTooBig".
  public static getErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") {
      return undefined;
    }

    const candidate: {
      code?: unknown;
      details?: { error?: { code?: unknown } | undefined } | undefined;
    } = error as {
      code?: unknown;
      details?: { error?: { code?: unknown } | undefined } | undefined;
    };

    if (typeof candidate.code === "string" && candidate.code) {
      return candidate.code;
    }

    if (
      typeof candidate.details?.error?.code === "string" &&
      candidate.details.error.code
    ) {
      return candidate.details.error.code;
    }

    return undefined;
  }

  /*
   * A markdown text a notification carries, within
   * MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES: as it is when it fits,
   * else cut (cutToLength: at a line break where there is one near the end)
   * and followed by MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE.
   *
   * What Teams is sent for a text can be bigger than the text: JSON writes
   * each quote and backslash in two characters, and a MessageCard's table
   * is HTML several times the size of its Markdown. So a cut text is
   * measured as it is sent - measureInBytes: as a JSON string unless the
   * caller measures the message it builds from it - and one that comes out
   * over the budget is cut shorter, in proportion and with a margin, a few
   * times at most. A text that fits is never measured: it is sent as it
   * always was.
   */
  public static fitMarkdownText(
    text: string,
    measureInBytes: MeasureTextFunction = (fitted: string): number => {
      return MicrosoftTeamsMessageSize.getSizeInBytes(JSON.stringify(fitted));
    },
  ): string {
    const maxLength: number = Math.floor(
      MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES / 2,
    );

    if (text.length <= maxLength) {
      return text;
    }

    const cut: (length: number) => string = (length: number): string => {
      return (
        cutToLength(text, length).trimEnd() +
        MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE
      );
    };

    let length: number = maxLength - MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE.length;
    let fitted: string = cut(length);

    for (let attempt: number = 0; attempt < MAX_FIT_ATTEMPTS; attempt++) {
      const sizeInBytes: number = measureInBytes(fitted);

      if (
        sizeInBytes <= MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES ||
        length <= 1
      ) {
        break;
      }

      length = Math.max(
        1,
        Math.floor(
          ((length * MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES) /
            sizeInBytes) *
            FIT_MARGIN,
        ),
      );
      fitted = cut(length);
    }

    return fitted;
  }

  /*
   * A text reply cut down to the budget, with a note that it was shortened
   * when the note fits as well. The cut is made at the last line break that
   * fits, so no markdown line is split, or mid-line (never inside an emoji)
   * when the first line alone is over the budget. The result is never over
   * the budget; text within it is returned as it is.
   */
  public static fitTextToBudget(data: {
    text: string;
    budgetInBytes?: number | undefined;
    truncationNote?: string | undefined;
  }): string {
    const budgetInBytes: number =
      data.budgetInBytes ?? MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES;

    if (this.getSizeInBytes(data.text) <= budgetInBytes) {
      return data.text;
    }

    const maxUnits: number = Math.max(0, Math.floor(budgetInBytes / 2));
    const requestedNote: string =
      data.truncationNote ?? DEFAULT_TRUNCATION_NOTE;

    // A note that does not fit leaves the whole budget to the text.
    const truncationNote: string =
      requestedNote.length <= maxUnits ? requestedNote : "";
    const maxLength: number = maxUnits - truncationNote.length;

    // A line that ends exactly at the cut still fits, so the search includes it.
    const lastLineBreak: number = data.text.lastIndexOf("\n", maxLength);

    const kept: string =
      lastLineBreak > 0
        ? data.text.substring(0, lastLineBreak)
        : truncateToLength(data.text, maxLength);

    return kept.trimEnd() + truncationNote;
  }
}
