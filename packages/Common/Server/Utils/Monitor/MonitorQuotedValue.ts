import { JSONValue } from "../../../Types/JSON";
import { MonitorEvaluationDetailsLimits } from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorEvidenceRedaction from "./MonitorEvidenceRedaction";

/*
 * A VALUE THE MONITORED SYSTEM SENT, AS A SENTENCE MAY QUOTE IT.
 *
 * A root cause quotes what a filter found - "Error is not empty. Value:
 * ...", "Email body is not empty. Value: ...", "SQL Query Result is ...
 * which contains ..." - and so do the evaluation's own sentences about a
 * script's result, error and log lines. A root cause goes out in email,
 * Slack and Teams and is kept on the incident, the alert and the status
 * timeline, so a quote is:
 *
 *   - redacted by the rules an incident's evidence is cut by
 *     (MonitorEvidenceRedaction): a JSON value loses the values of fields
 *     whose names say credential or personal data, and every text is read
 *     for a token, a key, a password, an email address, a card number;
 *   - one line: a stack trace or an email's paragraphs would break the
 *     Markdown list the root cause puts each finding in;
 *   - at most as long as the incident's evaluation details keep one value
 *     (MonitorEvaluationDetailsLimits.valueChars, 300 characters): about six
 *     lines of the ~416px email card, three of a Slack message. The rest of
 *     the evidence is on the incident, under Evaluation details.
 *
 * A long text is read from its start only, far past what is kept, so a
 * quote costs the same whatever the size of what it quotes.
 */

/*
 * How much of a long text is read: the kept part redacted in context, with
 * room for redaction to shorten what comes first.
 */
const READ_CHARS: number = 16 * 1024;

export default class MonitorQuotedValue {
  public static quote(
    value: unknown,
    maxChars: number = MonitorEvaluationDetailsLimits.valueChars,
  ): string {
    return MonitorQuotedValue.bound(
      MonitorQuotedValue.toOneLine(MonitorQuotedValue.toRedactedText(value)),
      maxChars,
    );
  }

  /*
   * A text cut to the limit, with an ellipsis when it was longer - never
   * between the two halves of a character outside the basic plane.
   */
  public static bound(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text;
    }

    let end: number = maxChars;
    const last: number = text.charCodeAt(end - 1);

    if (last >= 0xd800 && last <= 0xdbff) {
      end--;
    }

    return `${text.slice(0, end)}…`;
  }

  private static toRedactedText(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return MonitorEvidenceRedaction.redactText(value.slice(0, READ_CHARS));
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value !== "object") {
      return "";
    }

    try {
      return (
        JSON.stringify(
          MonitorEvidenceRedaction.redactJson(value as JSONValue),
        ) ?? ""
      ).slice(0, READ_CHARS);
    } catch {
      return "";
    }
  }

  // Every run of white space - line breaks and tabs included - as one space.
  private static toOneLine(text: string): string {
    let result: string = "";
    let isInSpace: boolean = false;

    for (let index: number = 0; index < text.length; index++) {
      const character: string = text.charAt(index);

      if (MonitorQuotedValue.isWhiteSpace(character)) {
        isInSpace = true;
        continue;
      }

      if (isInSpace && result) {
        result += " ";
      }

      isInSpace = false;
      result += character;
    }

    return result;
  }

  private static isWhiteSpace(character: string): boolean {
    return (
      character === " " ||
      character === "\n" ||
      character === "\r" ||
      character === "\t" ||
      character === "\f" ||
      character === "\v" ||
      character === "\u00a0" ||
      character === "\u2028" ||
      character === "\u2029"
    );
  }
}
