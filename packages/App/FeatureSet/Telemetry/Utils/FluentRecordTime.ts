import { JSONObject } from "Common/Types/JSON";

/*
 * WHEN A FLUENTD RECORD HAPPENED (issue #8010).
 *
 * Fluentd's HTTP output posts records, not events: with json_array it sends
 * each record's fields and nothing else, so the time Fluentd gave an event
 * never arrives on its own. And a <parse> section takes a JSON line's
 * "time" field out of the record, as the event's time. Before #8010 every
 * Fluentd log was stored at the time it was processed here, so a log read
 * late - after a restart, from a backlog, or sent again after an outage -
 * showed when it was sent, not when it happened.
 *
 * A record now says when it happened in its own fields, the first of
 * FLUENT_RECORD_TIME_FIELDS that holds a time:
 *
 *   - "time", "timestamp", "@timestamp" and "ts": the names loggers write
 *     a line's time under (pino, bunyan, logrus, slog and Docker's own
 *     json-file write "time"; winston and structlog "timestamp"; Logstash
 *     and ECS "@timestamp"; zap "ts"). The guide's parser keeps a JSON
 *     line's "time" in it (keep_time_key).
 *   - "fluentd_time" (FLUENTD_EVENT_TIME_FIELD): the time Fluentd gave the
 *     event, which the guide's record_transformer filter writes into every
 *     record - when the tail read a line, or the time a forwarded event's
 *     sender gave it (the Docker log driver's, a fluent-logger's). Last, so
 *     a line's own time wins over when Fluentd read it.
 *
 * A time is:
 *
 *   - an ISO 8601 date and time, "2026-11-14T08:00:00.123456789Z", with
 *     "T" or a space between them, its seconds and fraction optional, and
 *     its zone "Z", "UTC" or an offset ("+01:00", "+0100", "+01"), apart
 *     from the time by a space or not. One without a zone is UTC. Ruby's
 *     Time#to_s ("2026-11-14 08:00:00 +0000") reads too. Up to nine places
 *     of its fraction are kept, to the nanosecond.
 *   - seconds since the epoch, a number or decimal text, whole or with a
 *     fraction; or milliseconds, microseconds or nanoseconds, told apart by
 *     size as Splunk's HEC time is (Compatible/SplunkHec.ts): above 1e11 is
 *     no time in seconds (the year 5138) but one in milliseconds, above
 *     1e14 microseconds, above 1e17 nanoseconds. pino writes milliseconds,
 *     zap seconds with a fraction.
 *
 * The names are guesses, so a value must also look like a time a log has:
 * not before 2000 (a duration, a count or a clock never set - "time": 125,
 * a device's 1970 - is no log's time) and not more than a day ahead of the
 * time the record arrived (a value in the wrong unit, a far-off clock). A
 * field whose value is no time is skipped for the next one, and kept as an
 * attribute. A record with no time is stored at the time it arrived, as
 * every Fluentd record was before.
 *
 * Linear: the text a time is read from is at most MAX_TIME_TEXT_LENGTH
 * characters, and each pattern is anchored, with bounded repeats.
 */

// The field the guide's record_transformer filter writes the event's time to.
export const FLUENTD_EVENT_TIME_FIELD: string = "fluentd_time";

// The record fields a log's time is read from, first to last.
export const FLUENT_RECORD_TIME_FIELDS: ReadonlyArray<string> = [
  "time",
  "timestamp",
  "@timestamp",
  "ts",
  FLUENTD_EVENT_TIME_FIELD,
];

// The earliest time read as a record's own: 2000-01-01T00:00:00Z.
export const EARLIEST_RECORD_TIME_MS: number = Date.UTC(2000, 0, 1);

// The furthest a record's time may be ahead of the time it arrived: a day.
export const MAX_RECORD_TIME_AHEAD_MS: number = 24 * 60 * 60 * 1000;

/*
 * Text longer than this is no time: the longest ISO time read here, with
 * nine places and an offset, is 35 characters; nanoseconds with a fraction
 * about 30.
 */
export const MAX_TIME_TEXT_LENGTH: number = 64;

// Where the decimal point moves to make an epoch number seconds, by size.
const EPOCH_UNITS: ReadonlyArray<{ above: number; places: number }> = [
  { above: 1e17, places: 9 },
  { above: 1e14, places: 6 },
  { above: 1e11, places: 3 },
];

const PLAIN_DECIMAL: RegExp = /^\d{1,30}(?:\.\d{1,30})?$/;

/*
 * Date, time, fraction and zone. The groups: year, month, day, hour,
 * minute, second, fraction, "Z" or "UTC", the offset's sign, hours and
 * minutes.
 */
const ISO_DATE_TIME: RegExp =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,12}))?)? ?(?:([Zz]|UTC)|([+-])(\d{2})(?::?(\d{2}))?)?$/;

const NANOS_PER_SECOND: bigint = BigInt(1_000_000_000);
const NANOS_PER_MILLISECOND: bigint = BigInt(1_000_000);

// One time, read: its nanoseconds since the epoch, as digits, and its Date.
export interface RecordTimeRead {
  unixNano: string;
  date: Date;
}

export interface FluentRecordTime {
  /*
   * Nanoseconds since the epoch, as digits: the timeUnixNano column, and
   * the fraction of the time column (OneUptimeDate.toClickhouseDateTime64).
   */
  timeUnixNano: string;
  // The millisecond those nanoseconds fall in.
  timeDate: Date;
  // The field the time was read from; null when it is the arrival time.
  field: string | null;
}

export default class FluentRecordTimeUtil {
  /*
   * When `record` happened: the first of its time fields that holds a
   * time (see the header), else `arrivedAt`. Never throws.
   */
  public static read(record: JSONObject, arrivedAt: Date): FluentRecordTime {
    for (const field of FLUENT_RECORD_TIME_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) {
        continue;
      }

      const read: RecordTimeRead | null = FluentRecordTimeUtil.readTime(
        record[field],
        arrivedAt,
      );

      if (read) {
        return {
          timeUnixNano: read.unixNano,
          timeDate: read.date,
          field: field,
        };
      }
    }

    return {
      timeUnixNano: FluentRecordTimeUtil.millisecondsToUnixNano(
        arrivedAt.getTime(),
      ),
      timeDate: arrivedAt,
      field: null,
    };
  }

  /*
   * One field's value as a time a log has, or null: an ISO 8601 time, or
   * an epoch number in one of its units, from 2000 to a day after
   * `arrivedAt`.
   */
  public static readTime(
    value: unknown,
    arrivedAt: Date,
  ): RecordTimeRead | null {
    let unixNano: bigint | null = null;

    if (typeof value === "number") {
      unixNano = Number.isFinite(value)
        ? FluentRecordTimeUtil.readEpochText(String(value))
        : null;
    } else if (typeof value === "string") {
      const text: string = value.trim();

      if (text.length === 0 || text.length > MAX_TIME_TEXT_LENGTH) {
        return null;
      }

      unixNano = PLAIN_DECIMAL.test(text)
        ? FluentRecordTimeUtil.readEpochText(text)
        : FluentRecordTimeUtil.readIsoText(text);
    }

    if (unixNano === null) {
      return null;
    }

    const milliseconds: number = Number(unixNano / NANOS_PER_MILLISECOND);

    if (
      milliseconds < EARLIEST_RECORD_TIME_MS ||
      milliseconds > arrivedAt.getTime() + MAX_RECORD_TIME_AHEAD_MS
    ) {
      return null;
    }

    return { unixNano: unixNano.toString(), date: new Date(milliseconds) };
  }

  /*
   * An epoch number's text - plain digits, with a fraction or not - as
   * nanoseconds, its unit told by its size. The digits are moved, not
   * multiplied, so text keeps all nine places of a fraction. Null for
   * anything else: a sign, an exponent ("1e+21"), no digits.
   */
  private static readEpochText(text: string): bigint | null {
    if (!PLAIN_DECIMAL.test(text)) {
      return null;
    }

    const magnitude: number = Number(text);
    let places: number = 0;

    for (const unit of EPOCH_UNITS) {
      if (magnitude > unit.above) {
        places = unit.places;
        break;
      }
    }

    const [whole, fraction] = text.split(".") as [string, string | undefined];
    const seconds: string = places === 0 ? whole : whole.slice(0, -places);
    const nanos: string = `${places === 0 ? "" : whole.slice(-places)}${
      fraction || ""
    }`
      .slice(0, 9)
      .padEnd(9, "0");

    return BigInt(seconds || "0") * NANOS_PER_SECOND + BigInt(nanos);
  }

  /*
   * An ISO 8601 date and time as nanoseconds, or null for text that is
   * not one, or names a day, an hour or an offset no calendar has.
   */
  private static readIsoText(text: string): bigint | null {
    const match: RegExpMatchArray | null = text.match(ISO_DATE_TIME);

    if (!match) {
      return null;
    }

    const year: number = Number(match[1]);
    const month: number = Number(match[2]);
    const day: number = Number(match[3]);
    const hour: number = Number(match[4]);
    const minute: number = Number(match[5]);
    const second: number = Number(match[6] || "0");

    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return null;
    }

    const utcMilliseconds: number = Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second,
    );

    // Date.UTC rolls the 31st of a 30-day month into the next.
    if (new Date(utcMilliseconds).getUTCDate() !== day) {
      return null;
    }

    let offsetSeconds: number = 0;

    if (match[9]) {
      const offsetHours: number = Number(match[10]);
      const offsetMinutes: number = Number(match[11] || "0");

      if (offsetHours > 23 || offsetMinutes > 59) {
        return null;
      }

      offsetSeconds =
        (match[9] === "-" ? -1 : 1) * (offsetHours * 3600 + offsetMinutes * 60);
    }

    const nanos: string = (match[7] || "").slice(0, 9).padEnd(9, "0");

    return (
      BigInt(utcMilliseconds / 1000 - offsetSeconds) * NANOS_PER_SECOND +
      BigInt(nanos)
    );
  }

  private static millisecondsToUnixNano(milliseconds: number): string {
    return (
      BigInt(Math.trunc(milliseconds)) * NANOS_PER_MILLISECOND
    ).toString();
  }
}
