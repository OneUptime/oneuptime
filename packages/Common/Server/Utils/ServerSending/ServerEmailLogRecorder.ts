import ColumnLength from "../../../Types/Database/ColumnLength";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHAT THE SERVER'S EMAIL LOG KEEPS OF AN EMAIL (#6878).
 *
 * MailService tells this of every email it sent, or failed to send. The log
 * (Models/DatabaseModels/ServerEmailLog) keeps a row for one sent through
 * the server's own email settings that belongs to no project - sent or not
 * - and for one of a project's those settings failed to send. A project's
 * email that went is in that project's Email Logs; one through a project's
 * own mail server is the project's alone.
 *
 * Never the message: a password reset, a verification or a sign-in link
 * carries a token that signs its holder in. What is kept of the subject and
 * of the mail service's answer has every link taken out, and every run of
 * letters and digits long enough to be a token; a project's subject is not
 * kept at all, only its template - the project's Email Logs have it, read
 * by those who may read the record it is about.
 *
 * The Notification service registers what writes the row when it starts
 * (ServerEmailLogWriter), as it registers what writes down how sends went
 * (ServerSendingOutcomes). Until then, and in a test that sends without it,
 * nothing is kept: this file imports nothing that reaches the database. A
 * row that cannot be written never stops an email, and the line that says
 * so never names whom it was for.
 */

export interface ServerEmailLogFacts {
  // Whether it went through the server's own email settings.
  isServerSettings: boolean;
  toEmail: Email;
  subject?: string | undefined;
  templateType?: string | undefined;
  projectId?: ObjectID | undefined;
  isSent: boolean;
  // The mail service's answer, or why nothing was sent.
  statusMessage?: string | undefined;
}

export type ServerEmailLogWrite = (facts: ServerEmailLogFacts) => Promise<void>;

// What a link is kept as.
export const SERVER_EMAIL_LOG_LINK: string = "[link]";

// What a run of letters and digits long enough to be a token is kept as.
export const SERVER_EMAIL_LOG_REDACTED: string = "[redacted]";

// What a log line says in place of whom an email was for.
export const SERVER_EMAIL_LOG_RECIPIENT: string = "[recipient]";

/*
 * A link with a scheme ("https://", "ftp://") or starting "www.", up to the
 * first space, quote or bracket.
 */
const LINK_PATTERN: RegExp =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s<>"'()]+/gi;

// 24 or more letters, digits, "_" and "-" in a row.
const LONG_RUN_PATTERN: RegExp = /[A-Za-z0-9_-]{24,}/g;

// A token mixes digits and letters; a word or a number does not.
const HAS_DIGIT: RegExp = /[0-9]/;
const HAS_LETTER: RegExp = /[A-Za-z]/;

const ELLIPSIS: string = "…";

export default class ServerEmailLogRecorder {
  private static writer: ServerEmailLogWrite | null = null;

  public static register(writer: ServerEmailLogWrite | null): void {
    ServerEmailLogRecorder.writer = writer;
  }

  public static isRegistered(): boolean {
    return ServerEmailLogRecorder.writer !== null;
  }

  // Whether the log keeps a row for the email (see the top of this file).
  public static isKept(data: {
    isServerSettings: boolean;
    projectId?: ObjectID | undefined;
    isSent: boolean;
  }): boolean {
    if (!data.isServerSettings) {
      return false;
    }

    return !data.projectId || !data.isSent;
  }

  /*
   * Keeps the email's row, when the log keeps one. Never throws: a row that
   * cannot be written is logged by the writer, without whom the email was
   * for, and the email goes on as if the log were not there.
   */
  public static async record(facts: ServerEmailLogFacts): Promise<void> {
    const writer: ServerEmailLogWrite | null = ServerEmailLogRecorder.writer;

    if (!writer || !ServerEmailLogRecorder.isKept(facts)) {
      return;
    }

    try {
      await writer(facts);
    } catch {
      // Not kept this time; the email itself is not touched.
    }
  }

  /*
   * A subject or an answer as the log keeps it: links and tokens taken out,
   * and no longer than its column. A long run with no digit in it, or no
   * letter, is a word or a number, and stays.
   */
  public static scrub(
    text: string | null | undefined,
    maxLength: number = ColumnLength.LongText,
  ): string | undefined {
    if (!text || typeof text !== "string") {
      return undefined;
    }

    const scrubbed: string = text
      .replace(LINK_PATTERN, SERVER_EMAIL_LOG_LINK)
      .replace(LONG_RUN_PATTERN, (run: string): string => {
        return HAS_DIGIT.test(run) && HAS_LETTER.test(run)
          ? SERVER_EMAIL_LOG_REDACTED
          : run;
      })
      .trim();

    if (!scrubbed) {
      return undefined;
    }

    if (scrubbed.length <= maxLength) {
      return scrubbed;
    }

    let cut: number = maxLength - ELLIPSIS.length;
    const code: number = scrubbed.charCodeAt(cut - 1);

    // Never between the two halves of a surrogate pair.
    if (cut > 0 && code >= 0xd800 && code <= 0xdbff) {
      cut--;
    }

    return `${scrubbed.slice(0, cut).trimEnd()}${ELLIPSIS}`;
  }

  // A line about an email, with whom it was for taken out.
  public static withoutRecipient(text: string, toEmail: Email): string {
    const recipient: string = toEmail.toString();

    if (!recipient) {
      return text;
    }

    return text
      .split(recipient)
      .join(SERVER_EMAIL_LOG_RECIPIENT)
      .split(recipient.toLowerCase())
      .join(SERVER_EMAIL_LOG_RECIPIENT);
  }
}
