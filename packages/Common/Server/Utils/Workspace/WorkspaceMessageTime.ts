import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import moment from "moment-timezone";

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
 * A moment further off than today names its day as well (dateAndTime):
 * Teams' {{DATE(..., SHORT)}} and Slack's {date_short_pretty} ("today",
 * "tomorrow", "Oct 17, 2026"), each in the reader's own calendar.
 *
 * A message's Markdown carries the Teams form (time), which a Teams card
 * shows as it is. Slack's text gets the Slack form once its Markdown is
 * converted (toSlack, in SlackUtil.getMarkdownBlocks) - the conversion would
 * escape the "<" of a Slack date written any earlier. Where a moment cannot
 * be shown in its reader's zone - a notification log, a Mattermost post
 * (MattermostUtil.getMessageText) - it reads as the time in UTC
 * (toPlainText).
 *
 * A line that knows the zone its moments were set in says them in words on
 * that zone's clock where no reader's own can be shown (dateAndTimeInZone):
 * an on-call line in Mattermost reads "until Sat, Nov 14 at 5:50 PM EST",
 * in its schedule's zone, not "until 2026-11-14 at 22:50 UTC" (issue #7970).
 */

// The Teams form, as time() writes it: whole seconds, in UTC.
const TIME_TOKEN_PATTERN: RegExp =
  /\{\{TIME\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\)\}\}/g;

// The Teams form of a day, as dateAndTime() writes it.
const DATE_TOKEN_PATTERN: RegExp =
  /\{\{DATE\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z), SHORT\)\}\}/g;

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
   * The moment with its day, as Markdown both workspaces show in the
   * reader's own calendar and clock: "Fri, Oct 17, 2026 at 5:00 PM" in
   * Teams, "Oct 17, 2026 at 5:00 PM" - or "tomorrow at 5:00 PM" - in Slack.
   * For a moment that may be days away: when somebody who is away is back.
   */
  public static dateAndTime(date: Date): MarkdownText {
    const iso: string = this.toIsoSeconds(date);

    return FeedMarkdown.asMarkdown(
      `{{DATE(${iso}, SHORT)}} at {{TIME(${iso})}}`,
    );
  }

  /*
   * The moment with its day, in words, on the clock of one time zone, which
   * it names: "Sat, Nov 14 at 5:50 PM EST" - and the year too when the
   * moment is not in this year there, "Sat, Jan 2, 2027 at 9:00 AM EST".
   * For a line read where no reader's own zone can be shown, and that knows
   * the zone its moments were set in: an on-call line in Mattermost, in its
   * schedule's zone (issue #7970). Without a zone, or with one no clock
   * knows, in UTC: "Sat, Nov 14 at 10:50 PM UTC". Plain text, as Markdown.
   */
  public static dateAndTimeInZone(
    date: Date,
    timezone?: Timezone | string | null | undefined,
    now?: Date | undefined,
  ): MarkdownText {
    const zone: string =
      timezone && moment.tz.zone(timezone.toString())
        ? timezone.toString()
        : Timezone.UTC;
    const zoned: moment.Moment = moment(date).tz(zone);
    const isThisYear: boolean =
      zoned.year() ===
      moment(now || OneUptimeDate.getCurrentDate())
        .tz(zone)
        .year();

    const words: string = zoned.format(
      isThisYear ? "ddd, MMM D [at] h:mm A" : "ddd, MMM D, YYYY [at] h:mm A",
    );

    return mdText`${words} ${OneUptimeDate.getZoneAbbrByTimezone(
      zone as Timezone,
      date,
    )}`;
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
    if (
      !text ||
      (text.indexOf("{{TIME(") === -1 && text.indexOf("{{DATE(") === -1)
    ) {
      return text;
    }

    return text
      .replace(DATE_TOKEN_PATTERN, (token: string, iso: string): string => {
        const date: Date = new Date(iso);

        if (isNaN(date.getTime())) {
          return token;
        }

        return `<!date^${Math.floor(date.getTime() / 1000)}^{date_short_pretty}|${this.toUtcDay(date)}>`;
      })
      .replace(TIME_TOKEN_PATTERN, (token: string, iso: string): string => {
        const date: Date = new Date(iso);

        if (isNaN(date.getTime())) {
          return token;
        }

        return `<!date^${Math.floor(date.getTime() / 1000)}^{time}|${this.toUtcClock(date)}>`;
      });
  }

  /*
   * The text with each moment as its time in UTC ("17:28 UTC"): for where
   * nothing shows it in the reader's zone - a notification log, Mattermost.
   */
  public static toPlainText(text: string): string {
    if (
      !text ||
      (text.indexOf("{{TIME(") === -1 && text.indexOf("{{DATE(") === -1)
    ) {
      return text;
    }

    return text
      .replace(DATE_TOKEN_PATTERN, (token: string, iso: string): string => {
        const date: Date = new Date(iso);

        if (isNaN(date.getTime())) {
          return token;
        }

        return this.toUtcDay(date);
      })
      .replace(TIME_TOKEN_PATTERN, (token: string, iso: string): string => {
        const date: Date = new Date(iso);

        if (isNaN(date.getTime())) {
          return token;
        }

        return this.toUtcClock(date);
      });
  }

  private static toIsoSeconds(date: Date): string {
    return date.toISOString().replace(ISO_MILLISECONDS_PATTERN, "Z");
  }

  // "2026-10-17": the day, in UTC.
  private static toUtcDay(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private static toUtcClock(date: Date): string {
    const hours: string = String(date.getUTCHours()).padStart(2, "0");
    const minutes: string = String(date.getUTCMinutes()).padStart(2, "0");

    return `${hours}:${minutes} UTC`;
  }
}
