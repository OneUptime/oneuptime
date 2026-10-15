/*
 * WHAT A REPLY SAYS, WITHOUT THE THREAD IT QUOTES.
 *
 * A reply carries the emails above it: Gmail, Apple Mail and Thunderbird
 * quote them below the reply, each line led by ">", after a line naming who
 * wrote them ("On Wed, Oct 15, 2026 at 9:02 AM Tom <tom@acme.example>
 * wrote:"); Outlook puts them under a rule of underscores (or an "-----Original
 * Message-----" line) and their From / Sent / To / Subject lines. Every reply
 * in a thread carries all of it again, so a note made of the whole text says
 * the same things again and again, longer each time.
 *
 * getOwnText keeps what the sender wrote: the text above the quoted thread.
 * It takes away only what reads as quoted for sure - the quoted lines at the
 * end when a line names who wrote them (above them, or as their first line,
 * as the iPhone writes it), or everything from Outlook's rule on - and when
 * that would leave nothing (a reply that is all quote), it keeps the whole
 * text: a reply is never shown empty for being misread.
 *
 * One pass over the lines, each read once, so a reply of any length - the
 * sender writes it - takes time in line with its length.
 */

const LINE_BREAK_PATTERN: RegExp = /\r\n|\r|\n/;

// Outlook's rule above a quoted email: a line of underscores this long or longer.
const MIN_RULE_LENGTH: number = 10;

/*
 * How far into a line a header label's colon is ("From:", "Von:", "De :"):
 * what tells Outlook's rule from a line of underscores in the reply itself.
 */
const MAX_HEADER_LABEL_LENGTH: number = 40;

/*
 * The longest line read as the one naming who wrote the quote: a line, not a
 * paragraph that happens to end with a colon.
 */
const MAX_ATTRIBUTION_LENGTH: number = 500;

export default class EmailReplyText {
  /*
   * The reply's own text: what its sender wrote above the emails it
   * quotes. The whole text, trimmed, when nothing is quoted - or when only
   * the quote is there.
   */
  public static getOwnText(body: string | null | undefined): string {
    const text: string = String(body ?? "");
    const lines: Array<string> = text.split(LINE_BREAK_PATTERN);

    // The lines of the reply's own text: lines[0] up to, not including, end.
    let end: number = lines.length;

    // Outlook: everything from its rule on is the quoted thread.
    for (let index: number = 0; index < lines.length; index++) {
      if (EmailReplyText.isQuotedEmailRule(lines, index)) {
        end = index;
        break;
      }
    }

    // A quote at the end: ">" lines, and the blank lines among them.
    let quoteStart: number = end;
    let firstQuotedLine: string | null = null;

    while (quoteStart > 0) {
      const line: string = lines[quoteStart - 1]!.trim();

      if (line === "") {
        quoteStart--;
        continue;
      }

      if (line.startsWith(">")) {
        firstQuotedLine = line;
        quoteStart--;
        continue;
      }

      break;
    }

    /*
     * Taken away only when a line names who wrote it: above the quote, as
     * Gmail, Apple Mail and Thunderbird write it, or as its first line, as
     * the iPhone's Mail does. A quote that names nobody may be the
     * sender's own, and stays.
     */
    if (firstQuotedLine !== null) {
      if (
        quoteStart > 0 &&
        EmailReplyText.isAttribution(lines[quoteStart - 1]!)
      ) {
        end = quoteStart - 1;

        // Gmail wraps a long one inside the writer's "<address>".
        if (end > 0 && lines[end - 1]!.trimEnd().endsWith("<")) {
          end--;
        }
      } else if (
        EmailReplyText.isAttribution(
          EmailReplyText.withoutQuoteMarkers(firstQuotedLine),
        )
      ) {
        end = quoteStart;
      }
    }

    const ownText: string = lines.slice(0, end).join("\n").trim();

    return ownText || text.trim();
  }

  /*
   * Whether the line at `index` starts an email Outlook quotes: its
   * "-----Original Message-----" line, or its rule of underscores followed
   * by the quoted email's first header line ("From: ...").
   */
  private static isQuotedEmailRule(
    lines: Array<string>,
    index: number,
  ): boolean {
    const line: string = lines[index]!.trim();

    if (
      line.startsWith("--") &&
      line.endsWith("--") &&
      line.toLowerCase().includes("original message")
    ) {
      return true;
    }

    if (line.length < MIN_RULE_LENGTH || !EmailReplyText.isMadeOf(line, "_")) {
      return false;
    }

    // The next line with text on it is a header line: a label and a colon.
    for (
      let next: number = index + 1;
      next < lines.length && next <= index + 2;
      next++
    ) {
      const nextLine: string = lines[next]!.trim();

      if (nextLine === "") {
        continue;
      }

      const colon: number = nextLine.indexOf(":");

      return colon > 0 && colon <= MAX_HEADER_LABEL_LENGTH;
    }

    return false;
  }

  /*
   * Whether a line reads as the one a mail program writes above a quote:
   * one line ending with a colon that names a time or an address - "On Wed,
   * Oct 15, 2026 at 9:02 AM Tom <tom@acme.example> wrote:", "Am 15.10.2026
   * um 09:02 schrieb Tom:", "Le 15 oct. 2026, Tom a écrit :".
   */
  private static isAttribution(rawLine: string): boolean {
    const line: string = rawLine.trim();

    if (
      !line.endsWith(":") ||
      line.length > MAX_ATTRIBUTION_LENGTH ||
      line.startsWith(">")
    ) {
      return false;
    }

    if (line.includes("@")) {
      return true;
    }

    for (let index: number = 0; index < line.length; index++) {
      const code: number = line.charCodeAt(index);

      if (code >= 0x30 && code <= 0x39) {
        return true;
      }
    }

    return false;
  }

  // A quoted line without its ">" markers and the spaces between them.
  private static withoutQuoteMarkers(line: string): string {
    let start: number = 0;

    while (
      start < line.length &&
      (line.charAt(start) === ">" || line.charAt(start) === " ")
    ) {
      start++;
    }

    return line.slice(start);
  }

  private static isMadeOf(line: string, character: string): boolean {
    for (let index: number = 0; index < line.length; index++) {
      if (line.charAt(index) !== character) {
        return false;
      }
    }

    return true;
  }
}
