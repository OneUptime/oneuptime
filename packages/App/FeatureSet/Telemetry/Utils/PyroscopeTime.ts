/*
 * Time handling for Pyroscope ingest.
 *
 * Pyroscope clients do not agree on a unit for the `from` / `until` query
 * params of /ingest:
 *
 *   - pyroscope-java and pyroscope-nodejs send unix SECONDS (10 digits);
 *   - pyroscope-dotnet up to v0.13 sends MILLISECONDS (13 digits) — its
 *     ProfileTime is time_point<system_clock, milliseconds>;
 *   - pyroscope-go v1.1+ sends NANOSECONDS (19 digits).
 *
 * The reference server copes by reading the unit off the digit count
 * (grafana/pyroscope pkg/og/util/attime.Parse: 13 = ms, 16 = us, 19 = ns,
 * anything else = seconds). Reading every value as seconds instead turned a
 * .NET upload's 13-digit `from` into a year-58000 timestamp that ClickHouse
 * rejected at async-insert flush, so .NET profiles never appeared and
 * nothing anywhere reported an error.
 *
 * Every value here is a BigInt of unix NANOSECONDS. Number is not enough:
 * nanosecond epochs are far above Number.MAX_SAFE_INTEGER, and
 * Number#toString switches to exponent notation ("1.7e+21") at 1e21, which
 * no UInt64 or DateTime64 column will parse.
 */

import OneUptimeDate from "Common/Types/Date";

const NANOS_PER_MICRO: bigint = BigInt(1_000);
const NANOS_PER_MILLI: bigint = BigInt(1_000_000);
const NANOS_PER_SECOND: bigint = BigInt(1_000_000_000);

/*
 * Earliest capture time accepted from a client. Nothing profiles the past
 * this far back; values below it are unit mix-ups (microseconds written
 * into pprof time_nanos by old rbspy / pyspy / pyroscope-rs builds land in
 * 1970) and would put the profile outside every dashboard window and past
 * retention the moment it is written.
 */
export const MIN_PROFILE_UNIX_NANO: bigint =
  BigInt(Date.UTC(2000, 0, 1)) * NANOS_PER_MILLI;

/*
 * How far past the server clock a capture time may be before it is treated
 * as a unit mix-up rather than clock skew.
 */
export const MAX_PROFILE_FUTURE_SKEW_NANO: bigint =
  BigInt(24 * 60 * 60) * NANOS_PER_SECOND;

export function getCurrentUnixNano(): bigint {
  return BigInt(OneUptimeDate.getCurrentDate().getTime()) * NANOS_PER_MILLI;
}

export function isPlausibleProfileUnixNano(
  value: bigint,
  nowUnixNano: bigint,
): boolean {
  return (
    value >= MIN_PROFILE_UNIX_NANO &&
    value <= nowUnixNano + MAX_PROFILE_FUTURE_SKEW_NANO
  );
}

/*
 * Parse a `from` / `until` query param into unix nanoseconds.
 *
 * Returns null — "not provided", so the caller falls back to the pprof
 * time or ingestion time — for anything that is not a plain unix
 * timestamp: missing, empty, zero, relative forms such as "now-10s", and
 * values that land outside the plausible window once their unit is known.
 */
export function parsePyroscopeTimeParam(
  raw: unknown,
  nowUnixNano: bigint,
): bigint | null {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }

  // Same separators attime.Parse strips before looking at the digits.
  const digits: string = String(raw).trim().replace(/[_, ]/g, "");

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  const value: bigint = BigInt(digits);

  if (value === BigInt(0)) {
    return null;
  }

  let unixNano: bigint;

  switch (digits.length) {
    case 13:
      unixNano = value * NANOS_PER_MILLI;
      break;
    case 16:
      unixNano = value * NANOS_PER_MICRO;
      break;
    case 19:
      unixNano = value;
      break;
    default:
      unixNano = value * NANOS_PER_SECOND;
  }

  return isPlausibleProfileUnixNano(unixNano, nowUnixNano) ? unixNano : null;
}

/*
 * A non-negative integer nanosecond count read out of a decoded pprof
 * field. parsePprof decodes int64 as Number, so the value may be a
 * (precision-reduced) number, a numeric string, or absent.
 */
export function toNonNegativeUnixNano(raw: unknown): bigint | null {
  if (typeof raw === "bigint") {
    return raw > BigInt(0) ? raw : null;
  }

  if (typeof raw === "string") {
    const trimmed: string = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const value: bigint = BigInt(trimmed);
      return value > BigInt(0) ? value : null;
    }
    raw = Number(trimmed);
  }

  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }

  return BigInt(Math.trunc(raw));
}

export interface ProfileWindow {
  startUnixNano: bigint;
  endUnixNano: bigint;
}

/*
 * Decide the capture window of one profile.
 *
 * Start: the pprof's own time_nanos when it is plausible, else the client's
 * `from`, else ingestion time. An implausible time_nanos (the 1970
 * microsecond mix-up above) is skipped rather than trusted, the way the
 * reference server's fixTime does.
 *
 * End: start + duration_nanos when the pprof carries one, else the client's
 * `until` when it is not before start, else start. Go's non-CPU profiles
 * are the common "time_nanos but no duration_nanos" shape; they rely on the
 * `until` fallback, which is why `until` has to be unit-normalised too.
 */
export function resolveProfileWindow(data: {
  pprofTimeNanos: unknown;
  pprofDurationNanos: unknown;
  fromUnixNano: bigint | null;
  untilUnixNano: bigint | null;
  nowUnixNano: bigint;
}): ProfileWindow {
  const pprofStart: bigint | null = toNonNegativeUnixNano(data.pprofTimeNanos);

  let startUnixNano: bigint = data.nowUnixNano;

  if (
    pprofStart !== null &&
    isPlausibleProfileUnixNano(pprofStart, data.nowUnixNano)
  ) {
    startUnixNano = pprofStart;
  } else if (data.fromUnixNano !== null) {
    startUnixNano = data.fromUnixNano;
  }

  const duration: bigint | null = toNonNegativeUnixNano(
    data.pprofDurationNanos,
  );

  let endUnixNano: bigint = startUnixNano;

  if (duration !== null) {
    endUnixNano = startUnixNano + duration;
  } else if (
    data.untilUnixNano !== null &&
    data.untilUnixNano >= startUnixNano
  ) {
    endUnixNano = data.untilUnixNano;
  }

  return { startUnixNano, endUnixNano };
}
