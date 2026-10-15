import Dictionary from "../../Types/Dictionary";

/*
 * What an email's own headers say about it:
 *
 *   - which email it is: its Message-ID, which the sender's mail program gives
 *     every email it sends and every copy of that email keeps, however often
 *     it is delivered (RFC 5322 section 3.6.4);
 *   - which earlier emails it answers: the Message-IDs in In-Reply-To (the
 *     email it replies to) and References (the thread above it, the first
 *     email first);
 *   - whether a program sent it as an automatic reply - an out-of-office
 *     message, a vacation notice, a bounce - rather than a person or a system
 *     reporting something (RFC 3834).
 *
 * An Incoming Email monitor that opens an incident for every email reads them
 * to open one incident per email, not per delivery, to add a reply to the
 * incident its thread opened, and to leave automatic replies alone.
 *
 * Header names are matched without regard to case ("Message-ID",
 * "Message-Id"), as email header names are. Every reading is one pass over
 * the text, so a header of any length - the sender writes it - costs time in
 * line with its length.
 */

// The longest line RFC 5322 allows; no Message-ID is longer.
export const MAX_MESSAGE_ID_LENGTH: number = 998;

/*
 * The most earlier emails one email is read as answering. A thread of a
 * hundred emails is a long one; a References header holding more is cut
 * (keeping the email it replies to and the newest of the thread).
 */
export const MAX_REFERENCED_MESSAGE_IDS: number = 100;

/*
 * Auto-Submitted values (RFC 3834) that mark a reply a program sent: an
 * automatic reply ("auto-replied", an out-of-office message or a bounce) and
 * a disposition notification ("auto-notified", a read receipt). Not
 * "auto-generated": monitoring systems send their reports with it, and those
 * are exactly the emails a monitor is for.
 */
const AUTOMATIC_REPLY_AUTO_SUBMITTED_VALUES: ReadonlyArray<string> = [
  "auto-replied",
  "auto-notified",
];

// A References header, as getReferencedMessageIds reads it.
export interface ThreadIds {
  // The thread's first email, or null when the header names none.
  first: string | null;
  // Its newest emails, oldest of them first.
  newest: Array<string>;
}

export default class EmailThreadHeaders {
  /*
   * The value of the header with this name, compared without regard to case,
   * or undefined when the email has none. Of two headers whose names differ
   * only in case, the first wins.
   */
  public static getHeader(
    headers: Dictionary<string> | null | undefined,
    name: string,
  ): string | undefined {
    if (!headers || typeof headers !== "object") {
      return undefined;
    }

    const wanted: string = name.toLowerCase();

    for (const key of Object.keys(headers)) {
      if (key.trim().toLowerCase() !== wanted) {
        continue;
      }

      const value: unknown = headers[key];

      return typeof value === "string" ? value : undefined;
    }

    return undefined;
  }

  /*
   * The email's Message-ID without its angle brackets, or null when it has
   * none that can be read. A value written without brackets is taken as it
   * is when it is one word.
   */
  public static getMessageId(
    headers: Dictionary<string> | null | undefined,
  ): string | null {
    const value: string | undefined = EmailThreadHeaders.getHeader(
      headers,
      "Message-ID",
    );

    if (!value) {
      return null;
    }

    const bracketed: Array<string> = EmailThreadHeaders.readMessageIds(
      value,
      1,
    );

    if (bracketed.length > 0) {
      return bracketed[0]!;
    }

    const bare: string = value.trim();

    return EmailThreadHeaders.isUsableMessageId(bare) ? bare : null;
  }

  /*
   * The Message-IDs of the earlier emails this one answers, each once: the
   * one in In-Reply-To first, then from References the thread's first email
   * and its newest ones, newest first. At most MAX_REFERENCED_MESSAGE_IDS,
   * and never the email's own.
   */
  public static getReferencedMessageIds(
    headers: Dictionary<string> | null | undefined,
  ): Array<string> {
    const ownId: string | null = EmailThreadHeaders.getMessageId(headers);
    const seen: Set<string> = new Set<string>();
    const referenced: Array<string> = [];

    const add: (id: string) => void = (id: string): void => {
      if (id === ownId || seen.has(id)) {
        return;
      }

      seen.add(id);
      referenced.push(id);
    };

    for (const id of EmailThreadHeaders.readMessageIds(
      EmailThreadHeaders.getHeader(headers, "In-Reply-To") || "",
      MAX_REFERENCED_MESSAGE_IDS,
    )) {
      add(id);
    }

    /*
     * The thread's first email - the one that most often opened something -
     * and its newest emails, the ones a reply most often answers.
     */
    const thread: ThreadIds = EmailThreadHeaders.readThread(
      EmailThreadHeaders.getHeader(headers, "References") || "",
      MAX_REFERENCED_MESSAGE_IDS,
    );

    if (thread.first) {
      add(thread.first);
    }

    for (let index: number = thread.newest.length - 1; index >= 0; index--) {
      add(thread.newest[index]!);
    }

    return referenced.slice(0, MAX_REFERENCED_MESSAGE_IDS);
  }

  /*
   * Whether a program sent this email as an automatic reply: an
   * out-of-office or vacation message, a bounce, a read receipt. Read from
   * the headers such programs write: Auto-Submitted (RFC 3834), the older
   * X-Autoreply and X-Autorespond, and Precedence: auto_reply.
   */
  public static isAutomaticReply(
    headers: Dictionary<string> | null | undefined,
  ): boolean {
    const autoSubmitted: string = (
      EmailThreadHeaders.getHeader(headers, "Auto-Submitted") || ""
    )
      .trim()
      .toLowerCase();

    if (
      AUTOMATIC_REPLY_AUTO_SUBMITTED_VALUES.some((value: string): boolean => {
        return autoSubmitted.startsWith(value);
      })
    ) {
      return true;
    }

    const autoreply: string | undefined = EmailThreadHeaders.getHeader(
      headers,
      "X-Autoreply",
    );

    if (autoreply !== undefined && autoreply.trim().toLowerCase() !== "no") {
      return true;
    }

    if (EmailThreadHeaders.getHeader(headers, "X-Autorespond") !== undefined) {
      return true;
    }

    return (
      (EmailThreadHeaders.getHeader(headers, "Precedence") || "")
        .trim()
        .toLowerCase() === "auto_reply"
    );
  }

  /*
   * The ids written in angle brackets in a header's value, in order, at most
   * `limit` of them. One pass: an opening bracket starts an id and a later
   * one starts it again, so "<a<b>" reads "b", and text between ids
   * (comments, folding whitespace) is skipped.
   */
  public static readMessageIds(value: string, limit: number): Array<string> {
    const ids: Array<string> = [];
    let start: number = -1;

    for (let index: number = 0; index < value.length; index++) {
      if (ids.length >= limit) {
        break;
      }

      const character: string = value.charAt(index);

      if (character === "<") {
        start = index;
        continue;
      }

      if (character !== ">" || start === -1) {
        continue;
      }

      const id: string = value.slice(start + 1, index).trim();
      start = -1;

      if (EmailThreadHeaders.isUsableMessageId(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  /*
   * A References header's first id and its newest `keep` ids, oldest of
   * them first. One pass, holding at most `keep` ids however long the
   * header is: the sender writes it.
   */
  public static readThread(value: string, keep: number): ThreadIds {
    let first: string | null = null;
    // The newest ids, kept in a ring: slot `count % keep` holds the oldest.
    const ring: Array<string> = [];
    let count: number = 0;
    let start: number = -1;

    for (let index: number = 0; index < value.length; index++) {
      const character: string = value.charAt(index);

      if (character === "<") {
        start = index;
        continue;
      }

      if (character !== ">" || start === -1) {
        continue;
      }

      const id: string = value.slice(start + 1, index).trim();
      start = -1;

      if (!EmailThreadHeaders.isUsableMessageId(id)) {
        continue;
      }

      if (first === null) {
        first = id;
      }

      if (keep <= 0) {
        continue;
      }

      if (ring.length < keep) {
        ring.push(id);
      } else {
        ring[count % keep] = id;
      }

      count++;
    }

    const oldest: number = ring.length < keep ? 0 : count % keep;

    return {
      first: first,
      newest: [...ring.slice(oldest), ...ring.slice(0, oldest)],
    };
  }

  /*
   * One word of printable text no longer than a header line: what a
   * Message-ID is. Anything else - empty, spaced, or longer than any mail
   * program writes - is not read as one.
   */
  private static isUsableMessageId(id: string): boolean {
    if (!id || id.length > MAX_MESSAGE_ID_LENGTH) {
      return false;
    }

    for (let index: number = 0; index < id.length; index++) {
      const code: number = id.charCodeAt(index);

      // Spaces, control characters and the angle brackets never belong in one.
      if (code <= 0x20 || code === 0x7f || code === 0x3c || code === 0x3e) {
        return false;
      }
    }

    return true;
  }
}
