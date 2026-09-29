import moment from "moment-timezone";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The time zone a Microsoft Teams user typed a date and a time in.
 *
 * Input.Date and Input.Time submit a bare "2026-10-01" and "14:00", with no
 * zone. Those used to be read in the server's time zone (UTC in the
 * containers), so 14:00 typed in New York became 10:00 in New York. Teams
 * tells the bot the sender's zone on the activity (localTimezone, an IANA
 * name, and the clientInfo entity), though not from every client: iOS has
 * been seen to leave localTimezone out. So the zone the form was requested
 * from also travels in the form's submit data, the UTC offset of the
 * activity's local timestamp comes next, and UTC is the last resort. Whichever
 * zone is used is named back to the user.
 */

export interface MicrosoftTeamsUserTimezone {
  // IANA name, when known.
  timezone?: string | undefined;
  // Offset from UTC in minutes, when only an offset is known.
  utcOffsetInMinutes?: number | undefined;
  // How the zone is named to the user, e.g. "America/New_York" or "UTC+05:30".
  label: string;
}

const DATE_TIME_FORMATS: Array<string> = [
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DD HH:mm:ss",
];

const UTC_OFFSET_SUFFIX: RegExp = /(?:[+-]\d{2}:?\d{2}|Z)$/i;

export default class MicrosoftTeamsTimezone {
  public static readonly UTC: MicrosoftTeamsUserTimezone = {
    timezone: "UTC",
    label: "UTC",
  };

  // The name, when it is an IANA time zone moment-timezone knows.
  public static getKnownTimezone(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const name: string = value.trim();

    if (!name || !moment.tz.zone(name)) {
      return undefined;
    }

    return name;
  }

  // The IANA zone an activity says its sender is in.
  public static getTimezoneFromActivity(
    activity: JSONObject,
  ): string | undefined {
    const fromLocalTimezone: string | undefined = this.getKnownTimezone(
      activity["localTimezone"],
    );

    if (fromLocalTimezone) {
      return fromLocalTimezone;
    }

    const entities: Array<JSONObject> =
      (activity["entities"] as Array<JSONObject> | undefined) || [];

    for (const entity of entities) {
      if (entity && entity["type"] === "clientInfo") {
        const fromClientInfo: string | undefined = this.getKnownTimezone(
          entity["timezone"],
        );

        if (fromClientInfo) {
          return fromClientInfo;
        }
      }
    }

    return undefined;
  }

  /*
   * The UTC offset of the activity's local timestamp, in minutes. botbuilder
   * turns localTimestamp into a Date, which drops the offset, and keeps the
   * original string as rawLocalTimestamp.
   */
  public static getUtcOffsetFromActivity(
    activity: JSONObject,
  ): number | undefined {
    for (const field of ["rawLocalTimestamp", "localTimestamp"]) {
      const value: unknown = activity[field];

      if (typeof value !== "string" || !UTC_OFFSET_SUFFIX.test(value.trim())) {
        continue;
      }

      const parsed: moment.Moment = moment.parseZone(
        value.trim(),
        moment.ISO_8601,
        true,
      );

      if (parsed.isValid()) {
        return parsed.utcOffset();
      }
    }

    return undefined;
  }

  /*
   * The zone to read a submitted date and time in: the submitting activity's
   * own zone, then the zone the form was sent for, then the submitting
   * activity's UTC offset, then UTC.
   */
  public static resolve(data: {
    activity: JSONObject;
    timezoneFromCard?: unknown;
  }): MicrosoftTeamsUserTimezone {
    const timezone: string | undefined =
      this.getTimezoneFromActivity(data.activity) ||
      this.getKnownTimezone(data.timezoneFromCard);

    if (timezone) {
      return { timezone: timezone, label: timezone };
    }

    const utcOffsetInMinutes: number | undefined =
      this.getUtcOffsetFromActivity(data.activity);

    if (utcOffsetInMinutes !== undefined) {
      return {
        utcOffsetInMinutes: utcOffsetInMinutes,
        label: this.formatUtcOffset(utcOffsetInMinutes),
      };
    }

    return this.UTC;
  }

  // "UTC", "UTC+05:30", "UTC-04:00".
  public static formatUtcOffset(utcOffsetInMinutes: number): string {
    if (utcOffsetInMinutes === 0) {
      return "UTC";
    }

    const sign: string = utcOffsetInMinutes > 0 ? "+" : "-";
    const absolute: number = Math.abs(utcOffsetInMinutes);
    const hours: string = String(Math.floor(absolute / 60)).padStart(2, "0");
    const minutes: string = String(absolute % 60).padStart(2, "0");

    return `UTC${sign}${hours}:${minutes}`;
  }

  /*
   * The instant a date ("YYYY-MM-DD") and a time ("HH:mm") mean in the zone,
   * or null when either is not in that form.
   */
  public static toDate(data: {
    date: string;
    time: string;
    timezone: MicrosoftTeamsUserTimezone;
  }): Date | null {
    const text: string = `${data.date.trim()} ${data.time.trim()}`;

    if (data.timezone.timezone) {
      const zoned: moment.Moment = moment.tz(
        text,
        DATE_TIME_FORMATS,
        true,
        data.timezone.timezone,
      );

      return zoned.isValid() ? zoned.toDate() : null;
    }

    const wallClock: moment.Moment = moment.utc(text, DATE_TIME_FORMATS, true);

    if (!wallClock.isValid()) {
      return null;
    }

    return wallClock
      .subtract(data.timezone.utcOffsetInMinutes || 0, "minutes")
      .toDate();
  }

  // A date as the user reads it back, e.g. "Oct 1, 2026, 14:00 (America/New_York)".
  public static format(
    date: Date,
    timezone: MicrosoftTeamsUserTimezone,
  ): string {
    const zoned: moment.Moment = timezone.timezone
      ? moment(date).tz(timezone.timezone)
      : moment(date).utcOffset(timezone.utcOffsetInMinutes || 0);

    return `${zoned.format("MMM D, YYYY, HH:mm")} (${timezone.label})`;
  }
}
