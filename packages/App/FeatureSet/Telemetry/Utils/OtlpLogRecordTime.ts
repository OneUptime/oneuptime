import OneUptimeDate, { ExactUnixNano } from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";

/*
 * WHEN AN OTLP LOG RECORD HAPPENED, AS THE LOG TABLE STORES IT.
 *
 * OpenTelemetry's logs data model gives a record two times. `timeUnixNano`
 * is when the event occurred, and it "may be missing if the source
 * timestamp is unknown" (logs.proto: "Value of 0 indicates unknown or
 * missing timestamp"). `observedTimeUnixNano` is when the collection system
 * saw it: an OpenTelemetry SDK sets it as it makes the record, and a
 * collector as it reads one. For a receiver that keeps one time, the data
 * model says: "Use time_unix_nano if it is present, otherwise use
 * observed_time_unix_nano." So a record is stored at:
 *
 *   1. its own time, when it sends one;
 *   2. otherwise its observed time - the Java agent's GenAI events, a newer
 *      Python SDK's, and what a collector's k8sobjects or filelog receiver
 *      reads without a time parser all come this way;
 *   3. otherwise the time it arrives.
 *
 * Before #6395 every record without a time of its own was stored at the
 * time it arrived: after its exporter's batch delay, its retries and the
 * ingest queue, so it sorted late on the Logs page and a GenAI event landed
 * seconds to minutes after the AI call it belongs to.
 *
 * Each time is read as ingest always read timeUnixNano: an integer string -
 * how OTLP/protobuf and gRPC send every time - exactly, its digits and its
 * Date alike (OneUptimeDate.readExactUnixNano), and a number or any other
 * numeric text as the float it is. A time far in the past or the future is
 * kept as it came, an observed time as an own time always was: a host
 * clock running wrong, or a sender that held its records back, still said
 * when. What is no time is:
 *
 *   - nothing, a 0 (logs.proto's "unknown or missing"), or below 1 ns;
 *   - text that is no number, or a value of another type (warned);
 *   - a time the Log table cannot hold: past int64 nanoseconds
 *     (2262-04-11T23:47:16.854775807Z), the ceiling of its DateTime64(9)
 *     time column. ClickHouse refuses such a row - and with it every row of
 *     the insert, at async-insert flush, where nobody hears about it - so
 *     the record is stored at its next time instead (warned). The profiles
 *     ingest refuses the same range.
 *
 * A warning is for an own time only, as before: an observed time that is
 * no time just leaves the record its arrival time.
 *
 * The observedTimeUnixNano column keeps the observed time as it was always
 * written: the exact digits of an integer string, the whole nanoseconds of
 * a number, and 0 when there is none. What its UInt64 cannot hold is 0
 * too: below 0, no number, or past 2^64 - 1. What was written for those
 * before - "-5", "Infinity", "NaN", or "1e+21" for a float past 1e21 - made
 * ClickHouse refuse the row and every other row of the insert with it, and
 * an integer past 2^64 - 1 was wrapped into a wrong time.
 */

/*
 * The latest instant the Log table can hold: int64 nanoseconds, the
 * ceiling of ClickHouse DateTime64(9), as digits (an exact read is compared
 * on them) and as the largest double not above it (a float is compared on
 * it, so the comparison is exact).
 */
export const MAX_STORABLE_LOG_UNIX_NANO_DIGITS: string = "9223372036854775807";
export const MAX_STORABLE_LOG_UNIX_NANO: number = 9_223_372_036_854_774_784;

// The largest UInt64, the observedTimeUnixNano column's ceiling, alike.
export const MAX_OBSERVED_COLUMN_DIGITS: string = "18446744073709551615";
export const MAX_OBSERVED_COLUMN_FLOAT: number = 18_446_744_073_709_549_568;

// Which of its times a record is stored at.
export enum OtlpLogTimeSource {
  // The time it said it happened (its timeUnixNano).
  Record = "Record",
  // It sent none: the time its SDK or collector observed it.
  Observed = "Observed",
  // It sent neither: the time it arrived.
  Arrival = "Arrival",
}

export interface OtlpLogRecordTime {
  /*
   * The time the record is stored at in whole nanoseconds since the epoch -
   * the digits of an exact read, or a float - which the time column's
   * fraction and the timeUnixNano column are written from, and its Date,
   * from the same read, so the second and the fraction always agree.
   */
  timeUnixNano: number | string;
  timeDate: Date;
  source: OtlpLogTimeSource;
  // The observedTimeUnixNano column's value, as it was always written.
  observedTimeUnixNano: number | string;
}

// One of a record's times, read.
export type OtlpTimeRead =
  | { kind: "time"; unixNano: number | string; date: Date }
  // Not sent, 0 or below 1 ns: OTLP's unknown time. Never warned.
  | { kind: "none" }
  // Sent, but no time the Log table can hold: why, for the warning.
  | { kind: "invalid"; reason: string };

const NO_TIME: OtlpTimeRead = { kind: "none" };

/*
 * Whether `digits` (an exact read's: no sign, no leading zeros) are at most
 * `maxDigits` (the same).
 */
function isDigitsAtMost(digits: string, maxDigits: string): boolean {
  return (
    digits.length < maxDigits.length ||
    (digits.length === maxDigits.length && digits <= maxDigits)
  );
}

export default class OtlpLogRecordTimeUtil {
  /*
   * When `record` (an OTLP LogRecord, as any route's decoder hands it on) is
   * stored, and its observed time as the column keeps it. Never throws. An
   * own time that is no time is warned about, with the time the record is
   * stored at instead.
   */
  public static read(record: {
    timeUnixNano?: unknown;
    observedTimeUnixNano?: unknown;
  }): OtlpLogRecordTime {
    const ownTimeValue: unknown = record.timeUnixNano;
    const ownTime: OtlpTimeRead = OtlpLogRecordTimeUtil.readTime(ownTimeValue);

    const observedTimeValue: unknown = record.observedTimeUnixNano;
    const observedTimeUnixNano: number | string =
      OtlpLogRecordTimeUtil.toObservedColumn(observedTimeValue);

    if (ownTime.kind === "time") {
      return {
        timeUnixNano: ownTime.unixNano,
        timeDate: ownTime.date,
        source: OtlpLogTimeSource.Record,
        observedTimeUnixNano: observedTimeUnixNano,
      };
    }

    const observedTime: OtlpTimeRead =
      OtlpLogRecordTimeUtil.readTime(observedTimeValue);

    if (ownTime.kind === "invalid") {
      logger.warn(
        `Error processing timestamp ${String(ownTimeValue)}: ${ownTime.reason}, using ${
          observedTime.kind === "time" ? "observed" : "current"
        } time`,
      );
    }

    if (observedTime.kind === "time") {
      return {
        timeUnixNano: observedTime.unixNano,
        timeDate: observedTime.date,
        source: OtlpLogTimeSource.Observed,
        observedTimeUnixNano: observedTimeUnixNano,
      };
    }

    /*
     * One read of the clock, and its millisecond as digits. Before #6395 the
     * clock was read twice, and the time column's fraction written from the
     * float of the first read - up to 128 ns off its millisecond, and a
     * second late when the two reads fell either side of one.
     */
    const arrivedAt: Date = OneUptimeDate.getCurrentDate();
    const arrivedAtMs: number = arrivedAt.getTime();

    return {
      timeUnixNano:
        Number.isSafeInteger(arrivedAtMs) && arrivedAtMs > 0
          ? `${arrivedAtMs}000000`
          : OneUptimeDate.toUnixNano(arrivedAt),
      timeDate: arrivedAt,
      source: OtlpLogTimeSource.Arrival,
      observedTimeUnixNano: observedTimeUnixNano,
    };
  }

  /*
   * One OTLP time, as ingest reads timeUnixNano: an integer string exactly,
   * a number or other numeric text as its float. See the header for what is
   * no time.
   */
  public static readTime(value: unknown): OtlpTimeRead {
    const exact: ExactUnixNano | null = OneUptimeDate.readExactUnixNano(value);

    if (exact !== null) {
      if (exact.nano === "0") {
        return NO_TIME;
      }

      if (!isDigitsAtMost(exact.nano, MAX_STORABLE_LOG_UNIX_NANO_DIGITS)) {
        return {
          kind: "invalid",
          reason: `Timestamp out of storable range: ${String(value)}`,
        };
      }

      return { kind: "time", unixNano: exact.nano, date: exact.date };
    }

    if (!value) {
      return NO_TIME;
    }

    let float: number;

    if (typeof value === "string") {
      float = parseFloat(value);

      if (isNaN(float)) {
        return {
          kind: "invalid",
          reason: `Invalid timestamp string: ${value}`,
        };
      }
    } else if (typeof value === "number") {
      float = value;
    } else {
      return {
        kind: "invalid",
        reason: `Invalid timestamp: a ${typeof value}`,
      };
    }

    if (float < 1) {
      return NO_TIME;
    }

    if (!(float <= MAX_STORABLE_LOG_UNIX_NANO)) {
      return {
        kind: "invalid",
        reason: `Timestamp out of storable range: ${String(value)}`,
      };
    }

    /*
     * Whole nanoseconds: only a time in 1970's first 104 days can have a
     * fraction, and the time column's fraction would be written with its
     * point ("00000001.5"), which ClickHouse refuses.
     */
    const unixNano: number = Math.trunc(float);

    return {
      kind: "time",
      unixNano: unixNano,
      date: OneUptimeDate.fromUnixNano(unixNano),
    };
  }

  /*
   * The observedTimeUnixNano column's value: the exact digits of an integer
   * string, the whole nanoseconds of a number or of other numeric text, and
   * 0 for nothing and for anything its UInt64 cannot hold (see the header).
   */
  public static toObservedColumn(value: unknown): number | string {
    if (!value) {
      return 0;
    }

    const exact: ExactUnixNano | null = OneUptimeDate.readExactUnixNano(value);

    if (exact !== null) {
      return isDigitsAtMost(exact.nano, MAX_OBSERVED_COLUMN_DIGITS)
        ? exact.nano
        : 0;
    }

    let float: number = Number.NaN;

    if (typeof value === "string") {
      float = parseFloat(value);
    } else if (typeof value === "number") {
      float = value;
    }

    // NaN fails both. Only a float below 2^53 (1970's first days) has a fraction.
    return float >= 0 && float <= MAX_OBSERVED_COLUMN_FLOAT
      ? Math.trunc(float)
      : 0;
  }
}
