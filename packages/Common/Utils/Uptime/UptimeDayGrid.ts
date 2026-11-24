import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import TimezoneAlias from "../../Types/TimezoneAlias";
import moment from "moment-timezone";

/*
 * THE DAY GRID A MONITOR'S UPTIME DAYS ARE CUT ON (issue #10039).
 *
 * A status page's uptime bars, a monitor's uptime by day and a monitor
 * group's are cut at the visitor's midnight. The statements that cut them
 * (MonitorStatusTimelineService.getDailyUptimeAggregateSql and
 * getMonitorGroupDailyUptimeAggregateSql) used to work the midnights out in
 * Postgres, with `AT TIME ZONE`, which reads the database server's own copy
 * of the tz database: the zoneinfo in its image, or whatever a managed
 * Postgres (RDS, Cloud SQL, Azure) ships. OneUptime controls neither. The
 * Helm chart's Postgres runs `postgres:latest` with IfNotPresent, so a node
 * keeps the zoneinfo of the image it first pulled: postgres:15.10 carries
 * tzdata 2024b, and started a Vancouver visitor's day at 08:00 UTC instead of
 * 07:00 from 2026-11-01 (British Columbia is UTC-7 all year since tzdata
 * 2026b, #9999). Every other wall-clock time - the window the bars cover, the
 * day each bar is labelled with, the key a status page caches a zone's
 * history under (StatusPageUptimeTimezone.getZoneKey) - is worked out with
 * moment-timezone, which OneUptime pins and checks against IANA every week
 * (Scripts/TimeZoneData).
 *
 * So the midnights are worked out here, with moment's data, and handed to
 * the statement as one array of instants (a timestamptz[]): Postgres never
 * converts by zone, and one copy of the tz database decides every day edge,
 * whatever Postgres the person runs.
 *
 * The grid is the local midnight that starts the window's first day, every
 * local midnight after it up to the one that ends the day the window ends
 * in (its end, or now when that is sooner), and one day on. The statements
 * clamp the window's end to the database's own clock (`now()`), which can be
 * a moment ahead of this server's: the extra day is there for a window that
 * reaches past midnight on that clock only. A day past the window's end is
 * never emitted (its bucket is empty, and the statements leave empty buckets
 * out).
 *
 * A local midnight is the first instant of a local calendar day, so a day
 * the clocks change on is 23 or 25 hours long (23.5 or 24.5 on Lord Howe
 * Island), and a day whose midnight never comes (America/Santiago springs
 * forward at its midnight) starts when the clocks resume, at 01:00.
 */
export default class UptimeDayGrid {
  /*
   * The most days one grid holds: a century. A status page's history is 90
   * days and a report a year; this only stops a window nobody could mean
   * from building an array without end.
   */
  public static readonly MAX_DAYS: number = 36525;

  /**
   * The local midnights of the window's days in `timezone`, in order, as
   * instants (see the class comment for where the grid starts and ends).
   * `now` is the clock the window's end is clamped to, the current time
   * unless a test pins it.
   *
   * The zone is read in its current name (TimezoneAlias), as every caller
   * hands it, and one moment does not know is refused: cutting such a
   * visitor's days in UTC would put every bar an offset away from the day
   * it is labelled with, and say nothing.
   */
  public static getMidnights(data: {
    startDate: Date;
    endDate: Date;
    timezone: string;
    now?: Date | undefined;
  }): Array<Date> {
    const timezone: string = UptimeDayGrid.getKnownTimezone(data.timezone);
    const startDate: Date = OneUptimeDate.fromString(data.startDate);
    const endDate: Date = OneUptimeDate.fromString(data.endDate);
    const now: Date = data.now
      ? OneUptimeDate.fromString(data.now)
      : OneUptimeDate.getCurrentDate();

    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime()) ||
      !Number.isFinite(now.getTime())
    ) {
      throw new BadDataException(
        "The uptime window's start and end must be dates.",
      );
    }

    const effectiveEnd: Date =
      endDate.getTime() < now.getTime() ? endDate : now;

    const firstMidnight: Date = OneUptimeDate.getStartOfDay(
      startDate,
      timezone,
    );

    /*
     * The midnight that starts the day the window ends in, and the one after
     * it, which ends that day: the grid must reach it.
     */
    const lastDayStart: Date = OneUptimeDate.getStartOfDay(
      effectiveEnd.getTime() > firstMidnight.getTime()
        ? effectiveEnd
        : firstMidnight,
      timezone,
    );
    const lastDayEnd: Date = UptimeDayGrid.getNextMidnight(
      lastDayStart,
      timezone,
    );

    const midnights: Array<Date> = [firstMidnight];

    while (midnights[midnights.length - 1]!.getTime() < lastDayEnd.getTime()) {
      if (midnights.length > UptimeDayGrid.MAX_DAYS) {
        throw new BadDataException(
          "The uptime window is longer than OneUptime can cut into days.",
        );
      }

      midnights.push(
        UptimeDayGrid.getNextMidnight(
          midnights[midnights.length - 1]!,
          timezone,
        ),
      );
    }

    // One day on, for the database's clock (see the class comment).
    midnights.push(
      UptimeDayGrid.getNextMidnight(midnights[midnights.length - 1]!, timezone),
    );

    return midnights;
  }

  /**
   * The grid as the statements bind it: each midnight as an ISO instant, in
   * order, which Postgres reads as a timestamptz[] whatever its session's
   * zone (`$n::timestamptz[]`).
   */
  public static toDatabaseParameter(midnights: Array<Date>): Array<string> {
    return midnights.map((midnight: Date): string => {
      return midnight.toISOString();
    });
  }

  /**
   * The grid for a window, bound as the statements take it: getMidnights,
   * then toDatabaseParameter.
   */
  public static getDatabaseParameter(data: {
    startDate: Date;
    endDate: Date;
    timezone: string;
    now?: Date | undefined;
  }): Array<string> {
    return UptimeDayGrid.toDatabaseParameter(UptimeDayGrid.getMidnights(data));
  }

  /*
   * The zone's name as moment knows it, in its current name: "UTC" for
   * nothing, and a refusal for a name moment does not know.
   */
  private static getKnownTimezone(timezone: string): string {
    if (typeof timezone !== "string" || !timezone.trim()) {
      return "UTC";
    }

    const currentName: string = TimezoneAlias.getCanonicalTimezone(
      timezone.trim(),
    );

    let zoneName: string | null = null;

    try {
      zoneName = moment.tz.zone(currentName)?.name || null;
    } catch {
      zoneName = null;
    }

    if (!zoneName) {
      throw new BadDataException(
        "That time zone is not one OneUptime knows. Use an IANA time zone name, for example Europe/London.",
      );
    }

    return zoneName;
  }

  /*
   * The local midnight after the one at `midnight`: the start of the local
   * day a day and a half on. No day is half a day shorter or longer than 24
   * hours, so that instant is always in the next day, never the one after it.
   */
  private static getNextMidnight(midnight: Date, timezone: string): Date {
    return OneUptimeDate.getStartOfDay(
      new Date(midnight.getTime() + 36 * 60 * 60 * 1000),
      timezone,
    );
  }
}
