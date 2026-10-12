import FeedMarkdown, {
  MarkdownText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * A MOMENT IN A SLACK OR MICROSOFT TEAMS MESSAGE, IN EACH READER'S OWN TIME.
 *
 * A message that is edited for twenty minutes cannot say "if nobody
 * acknowledges within 7 minutes": its reader cannot see when the seven
 * minutes started. It says "by 5:28 PM" instead - but the people in a
 * channel are in different time zones, and the server knows none of them.
 * Both workspaces show a moment in each reader's own zone and clock format,
 * each in its own syntax:
 *
 *   Microsoft Teams   {{TIME(2026-10-12T17:28:00Z)}}       (an Adaptive Card text function)
 *   Slack             <!date^1760290080^{time}|17:28 UTC>   (a date, with its fallback)
 *
 * A message's Markdown carries the Teams form (time), which a Teams card
 * shows as it is. Slack's text gets the Slack form once its Markdown is
 * converted (toSlack, in SlackUtil.getMarkdownBlocks) - the conversion would
 * escape the "<" of a Slack date written any earlier. Where a moment cannot
 * be shown in its reader's zone - a notification log - it reads as the time
 * in UTC (toPlainText).
 */

// The Teams form, as time() writes it: whole seconds, in UTC.
const TIME_TOKEN_PATTERN: RegExp =
  /\{\{TIME\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\)\}\}/g;

// The milliseconds of an ISO date ("...:00.000Z"): a TIME() takes seconds.
const ISO_MILLISECONDS_PATTERN: RegExp = /\.\d{3}Z$/;

const MINUTE_IN_MS: number = 60_000;

export default class WorkspaceMessageTime {
  /*
   * The moment, as Markdown both workspaces show in the reader's own time
   * ("5:28 PM", or "17:28" for a reader with a 24-hour clock).
   */
  public static time(date: Date): MarkdownText {
    return FeedMarkdown.asMarkdown(`{{TIME(${this.toIsoSeconds(date)})}}`);
  }

  /*
   * The moment a wait of `minutes` that started at `startedAt` is over, on
   * the minute: OneUptime moves an escalation on at its first minute's tick
   * once the wait is over, so 17:21:37 and 7 minutes reads 5:29 PM.
   */
  public static endOfWait(startedAt: Date, minutes: number): Date {
    const end: number = startedAt.getTime() + minutes * MINUTE_IN_MS;

    return new Date(Math.ceil(end / MINUTE_IN_MS) * MINUTE_IN_MS);
  }

  // Slack's text with each moment as a Slack date, its fallback in UTC.
  public static toSlack(text: string): string {
    if (!text || text.indexOf("{{TIME(") === -1) {
      return text;
    }

    return text.replace(
      TIME_TOKEN_PATTERN,
      (token: string, iso: string): string => {
        const date: Date = new Date(iso);

        if (isNaN(date.getTime())) {
          return token;
        }

        return `<!date^${Math.floor(date.getTime() / 1000)}^{time}|${this.toUtcClock(date)}>`;
      },
    );
  }

  /*
   * The text with each moment as its time in UTC ("17:28 UTC"): for where
   * no workspace shows it - a notification log.
   */
  public static toPlainText(text: string): string {
    if (!text || text.indexOf("{{TIME(") === -1) {
      return text;
    }

    return text.replace(
      TIME_TOKEN_PATTERN,
      (token: string, iso: string): string => {
        const date: Date = new Date(iso);

        if (isNaN(date.getTime())) {
          return token;
        }

        return this.toUtcClock(date);
      },
    );
  }

  private static toIsoSeconds(date: Date): string {
    return date.toISOString().replace(ISO_MILLISECONDS_PATTERN, "Z");
  }

  private static toUtcClock(date: Date): string {
    const hours: string = String(date.getUTCHours()).padStart(2, "0");
    const minutes: string = String(date.getUTCMinutes()).padStart(2, "0");

    return `${hours}:${minutes} UTC`;
  }
}
