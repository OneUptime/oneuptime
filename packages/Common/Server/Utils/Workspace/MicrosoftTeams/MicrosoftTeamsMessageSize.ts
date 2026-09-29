import { JSONObject } from "../../../../Types/JSON";
import { truncateToLength } from "../../Database/TruncateColumnValue";

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
