import ColumnLength from "../../Types/Database/ColumnLength";
import { HOST_LOG_SESSION_NOTE_MAX_LENGTH } from "../../Types/Host/HostLogSession";
import AndroidAgentRedactor from "./AndroidAgentRedactor";

/*
 * A log session's note (#9966): why the requester asks for a device's logs,
 * in their words, which the person at the device reads under the request -
 * in the notification and on the agent's screen - before they allow it.
 * "Checking why the payment app crashes after 6pm" makes a request from a
 * name they may not know easier to trust.
 *
 * What a person types is made into what a device can show:
 *
 *   - one line of plain text: line breaks, tabs and runs of spaces become
 *     one space, other control characters go, and so do the characters
 *     that would reorder the text around them on the device's screen
 *     (embeddings, overrides and isolates, U+202A to U+202E and U+2066 to
 *     U+2069), so a note cannot make the request beside it read otherwise;
 *   - at most HOST_LOG_SESSION_NOTE_MAX_LENGTH characters, as typed;
 *   - with what must not reach a screen anyone can stand in front of
 *     replaced, as the agent replaces it in what it reads
 *     (AndroidAgentRedactor): a card number, an email address, a token or a
 *     credential, a password's value.
 *
 * The note is kept as shown - in the session's row, its audit log and the
 * file of its lines - and sent to the device as it is kept.
 */

export const NOTE_TOO_LONG_MESSAGE: string = `A note says why you ask in at most ${HOST_LOG_SESSION_NOTE_MAX_LENGTH} characters. Shorten it.`;

// The most a kept note holds: its column's length, which redaction stays within.
export const MAX_KEPT_NOTE_LENGTH: number = ColumnLength.LongText;

// Line breaks, tabs and other spaces: one space.
const WHITESPACE: RegExp = /[\s\u0085\u2028\u2029]+/g;

/*
 * Control characters (C0 and C1, but the whitespace above) and the
 * characters that reorder text around them: embeddings and overrides
 * (U+202A to U+202E) and isolates (U+2066 to U+2069).
 */
/* eslint-disable no-control-regex */
const NOT_SHOWN: RegExp =
  /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
/* eslint-enable no-control-regex */

export interface HostLogSessionNoteResult {
  // The note as kept and shown, or undefined when there is none.
  note?: string | undefined;
  // Why the note cannot be kept, or undefined.
  error?: string | undefined;
}

export default class HostLogSessionNote {
  // One line of plain text, as typed: undefined when nothing is left.
  public static clean(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const text: string = value
      .replace(WHITESPACE, " ")
      .replace(NOT_SHOWN, "")
      .replace(/ {2,}/g, " ")
      .trim();

    return text || undefined;
  }

  // The length a person counts: characters, an emoji as one.
  public static lengthOf(text: string): number {
    return Array.from(text).length;
  }

  /*
   * What a requester's note becomes: cleaned, held to its length as typed,
   * then redacted. An error when it is too long.
   */
  public static prepare(value: unknown): HostLogSessionNoteResult {
    const cleaned: string | undefined = HostLogSessionNote.clean(value);

    if (!cleaned) {
      return {};
    }

    if (
      HostLogSessionNote.lengthOf(cleaned) > HOST_LOG_SESSION_NOTE_MAX_LENGTH
    ) {
      return { error: NOTE_TOO_LONG_MESSAGE };
    }

    const redacted: string = AndroidAgentRedactor.redact(cleaned);

    return {
      note: Array.from(redacted).slice(0, MAX_KEPT_NOTE_LENGTH).join(""),
    };
  }
}
