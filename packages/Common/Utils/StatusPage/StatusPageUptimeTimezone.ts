import TimezoneAlias from "../../Types/TimezoneAlias";
import { DEFAULT_UPTIME_AGGREGATE_TIMEZONE } from "./UptimeDailyAggregateUtil";
import moment from "moment-timezone";

const DAY_MS: number = 24 * 60 * 60 * 1000;

/*
 * The zone a status page's uptime history is cut in, for one visitor.
 *
 * Each bar of the history is one calendar day of the VISITOR's - "Today" is
 * their today, and an incident at 15:36 in Shanghai is on that date's bar
 * in Shanghai, beside the times the tooltip already shows in the visitor's
 * zone (issue #6697). The page used to cut every day in UTC, because the
 * overview is one cached response shared by every visitor; the history is
 * now built per zone, and cached per zone (StatusPageOverviewCache).
 */
export default class StatusPageUptimeTimezone {
  /*
   * The longest zone name a visitor may send. IANA names run to about 30
   * characters; anything longer is not one.
   */
  public static readonly MAX_TIMEZONE_LENGTH: number = 64;

  /**
   * The zone a visitor asked for, as a name the server can cut days in, or
   * UTC.
   *
   * Lenient on purpose: a status page must render, so a zone it cannot use
   * - missing, not a string, not one moment knows - is UTC, the history the
   * page always drew, never an error. A legacy name a browser reports
   * (Chromium says Asia/Calcutta for India, Europe/Kiev for Ukraine) is
   * translated to its current one first (TimezoneAlias): the Postgres in
   * the shipped images has no legacy tzdata links and rejects several of
   * them in AT TIME ZONE. The name comes back in moment's own spelling, so
   * "asia/shanghai" and "Asia/Shanghai" are one zone.
   */
  public static resolve(raw: unknown): string {
    if (typeof raw !== "string") {
      return DEFAULT_UPTIME_AGGREGATE_TIMEZONE;
    }

    const trimmed: string = raw.trim();

    if (!trimmed || trimmed.length > this.MAX_TIMEZONE_LENGTH) {
      return DEFAULT_UPTIME_AGGREGATE_TIMEZONE;
    }

    const canonical: string = TimezoneAlias.getCanonicalTimezone(trimmed);

    let name: string | null = null;

    try {
      name = moment.tz.zone(canonical)?.name || null;
    } catch {
      name = null;
    }

    if (!name) {
      return DEFAULT_UPTIME_AGGREGATE_TIMEZONE;
    }

    // moment knows a few names only as links; their target is what it names.
    return TimezoneAlias.getCanonicalTimezone(name);
  }

  /**
   * A key that is the same for every zone that cuts the same days over
   * [startDate, endDate]: its UTC offset at the start, and every change of
   * offset in the window (with a day of margin each side), with the offset
   * it changes to.
   *
   * Two zones with the same key keep the same clock over the window, so
   * their local midnights - the history's day boundaries - fall at the same
   * instants, and one zone's history serves the other. Every UTC+8 zone
   * without daylight saving (Shanghai, Singapore, Perth, Manila) has one
   * key, and so has every zone on the EU's rules (Berlin, Paris, Madrid,
   * Oslo), which change at the same instant. A status page's visitors come
   * from a few dozen zones but far fewer clocks, and each clock costs the
   * database one history build per cache entry.
   *
   * Conservative: two zones whose offsets differ only at instants that are
   * not midnights get different keys though their days agree. That costs a
   * build, never a wrong day.
   */
  public static getZoneKey(data: {
    timezone: string;
    startDate: Date;
    endDate: Date;
  }): string {
    let zone: moment.MomentZone | null = null;

    try {
      zone = moment.tz.zone(data.timezone);
    } catch {
      zone = null;
    }

    if (!zone) {
      return `zone:${data.timezone}`;
    }

    const from: number = data.startDate.getTime() - DAY_MS;
    const to: number = data.endDate.getTime() + DAY_MS;

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return `zone:${zone.name}`;
    }

    const parts: Array<string> = [`offset:${zone.utcOffset(from)}`];

    for (let i: number = 0; i < zone.untils.length; i++) {
      const until: number | null | undefined = zone.untils[i];

      if (typeof until !== "number" || !Number.isFinite(until)) {
        break;
      }

      if (until <= from) {
        continue;
      }

      if (until > to) {
        break;
      }

      parts.push(`${until}:${zone.offsets[i + 1]}`);
    }

    return parts.join("|");
  }
}
