/*
 * THE RETRY-AFTER RESPONSE HEADER, READ AS RFC 9110 WRITES IT.
 *
 * A server that refuses for now - a 429 or a 503, most often - can say when
 * to ask again (RFC 9110 section 10.2.3):
 *
 *   Retry-After = HTTP-date / delay-seconds
 *
 * delay-seconds is a whole number of seconds, in digits and nothing else:
 * "120". An HTTP-date is one of the three shapes of section 5.6.7, which a
 * recipient must all accept, case and spaces exactly as written:
 *
 *   IMF-fixdate  Sun, 06 Nov 1994 08:49:37 GMT   (the one senders send)
 *   RFC 850      Sunday, 06-Nov-94 08:49:37 GMT  (obsolete; a two-digit year
 *                                                 more than 50 years ahead
 *                                                 is the century before)
 *   asctime      Sun Nov  6 08:49:37 1994        (obsolete; UTC)
 *
 * Anything else is no Retry-After at all and reads as undefined, so the
 * caller waits its own backoff: a fraction ("1.5"), a sign ("-5", "+5"),
 * words ("5 seconds"), an exponent ("1e3"), hex ("0x10"), a list
 * ("120, 120"), a date in any other shape, a day the month does not have.
 * Never Date.parse: V8 reads "-5" and "1.5" as days in 2001 - a wait long
 * over, so a retry at once - and asctime in the local time zone.
 *
 * A wait that is read is held between two bounds, which a caller may set:
 *
 *   - at least minMs, a second unless the caller says otherwise. "0", or a
 *     date gone by (most often a server clock behind this one), would retry
 *     at once, and a server that keeps answering so would be asked again in
 *     a tight loop. Waiting longer than asked is always allowed;
 *   - at most maxMs, an hour unless the caller says otherwise. A huge
 *     number, digits too many for a number, or a date years ahead would
 *     stall the caller as long (and setTimeout fires at once past
 *     2^31 - 1 ms). maxMs wins over minMs.
 *
 * The value comes from the network, so nothing here throws, and each value
 * is read in one pass: a megabyte of spaces costs a megabyte.
 *
 * This file imports nothing, so the packages that cannot import Common
 * carry byte-identical copies of it: agents/KubernetesAIAgent and
 * agents/ResourceAIAgent (Common/Utils/RetryAfter.ts, copied by their
 * npm run sync-common) and the React Native recorder
 * (packages/App/FeatureSet/MobileRecorder/src/RetryAfter.ts). Their parity
 * tests fail when a copy drifts. The browser recorder inlines it into a
 * script every page of a customer's site loads, so it is kept small.
 */

// The header's name, in the lower case Node and fetch give it.
export const RETRY_AFTER_HEADER: string = "retry-after";

// The least a Retry-After that is read waits, unless the caller says otherwise.
export const DEFAULT_RETRY_AFTER_MIN_MS: number = 1000;

// The most a Retry-After that is read waits, unless the caller says otherwise.
export const DEFAULT_RETRY_AFTER_MAX_MS: number = 60 * 60 * 1000;

export interface RetryAfterOptions {
  // The time now, in milliseconds since the epoch: Date.now() when left out.
  nowMs?: number | undefined;
  /*
   * The least a value that is read waits: DEFAULT_RETRY_AFTER_MIN_MS when
   * left out, or when it is not a finite number of 0 or more.
   */
  minMs?: number | undefined;
  /*
   * The most a value that is read waits: DEFAULT_RETRY_AFTER_MAX_MS when
   * left out, or when it is not a finite number of 0 or more.
   */
  maxMs?: number | undefined;
  /*
   * False reads delay-seconds only, and an HTTP-date as no Retry-After: for
   * a wait counted down in front of a person, on a device whose clock may be
   * wrong, which a date would move with. True when left out.
   */
  acceptHttpDate?: boolean | undefined;
}

// delay-seconds: 1*DIGIT. \d is the ASCII digits alone (no u flag).
const DELAY_SECONDS: RegExp = /^\d+$/;

const MONTHS: Array<string> =
  "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

// The parts the three shapes are written with (RFC 9110 section 5.6.7).
const DAY_NAME: string = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
const DAY_NAME_LONG: string = "(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day";
const MONTH: string = `(${MONTHS.join("|")})`;
const TIME_OF_DAY: string = "(\\d\\d):(\\d\\d):(\\d\\d)";

// day-name "," SP 2DIGIT SP month SP 4DIGIT SP time-of-day SP "GMT".
const IMF_FIXDATE: RegExp = new RegExp(
  `^${DAY_NAME}, (\\d\\d) ${MONTH} (\\d{4}) ${TIME_OF_DAY} GMT$`,
);

// day-name-l "," SP 2DIGIT "-" month "-" 2DIGIT SP time-of-day SP "GMT".
const RFC_850_DATE: RegExp = new RegExp(
  `^${DAY_NAME_LONG}, (\\d\\d)-${MONTH}-(\\d\\d) ${TIME_OF_DAY} GMT$`,
);

// day-name SP month SP ( 2DIGIT / ( SP DIGIT )) SP time-of-day SP 4DIGIT.
const ASCTIME_DATE: RegExp = new RegExp(
  `^${DAY_NAME} ${MONTH} (\\d\\d| \\d) ${TIME_OF_DAY} (\\d{4})$`,
);

// How far ahead an RFC 850 date's two-digit year may land (section 5.6.7).
const TWO_DIGIT_YEAR_LOOKAHEAD_YEARS: number = 50;

/*
 * A date written in UTC, as milliseconds since the epoch. Undefined for a
 * time past 23:59:60 (60 is a leap second, which section 5.6.7 allows: it
 * reads as the next minute's first) or a day the month does not have
 * (31 Apr, 29 Feb 2023) - never the date it would roll over to. The fields
 * are digits as written; a comparison with one that is missing (NaN) fails.
 */
function toUtcMs(
  year: number,
  month: string | undefined,
  day: string | undefined,
  hour: string | undefined,
  minute: string | undefined,
  second: string | undefined,
): number | undefined {
  const monthIndex: number = MONTHS.indexOf(month || "");
  const dayOfMonth: number = Number(day);
  // setUTCFullYear, not Date.UTC: Date.UTC reads a year below 100 as 19xx.
  const date: Date = new Date(0);
  date.setUTCFullYear(year, monthIndex, dayOfMonth);

  if (
    monthIndex < 0 ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== dayOfMonth ||
    !(Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 60)
  ) {
    return undefined;
  }

  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);

  return date.getTime();
}

/*
 * An RFC 850 date's two-digit year is this century's, unless that is more
 * than 50 years ahead: then it is the most recent year gone by with the
 * same last two digits (RFC 9110 section 5.6.7).
 */
function readRfc850Date(
  match: RegExpExecArray,
  nowMs: number,
): number | undefined {
  const thisYear: number = new Date(nowMs).getUTCFullYear();
  const lookaheadEnd: Date = new Date(nowMs);
  lookaheadEnd.setUTCFullYear(thisYear + TWO_DIGIT_YEAR_LOOKAHEAD_YEARS);

  let year: number = thisYear - (thisYear % 100) + Number(match[3]);
  let atMs: number | undefined = toUtcMs(
    year,
    match[2],
    match[1],
    match[4],
    match[5],
    match[6],
  );

  if (atMs !== undefined && atMs > lookaheadEnd.getTime()) {
    year -= 100;
    atMs = toUtcMs(year, match[2], match[1], match[4], match[5], match[6]);
  }

  return atMs;
}

// SP and HTAB: the whitespace RFC 9110 allows around a field's value.
function isSpace(code: number): boolean {
  return code === 32 || code === 9;
}

/*
 * A value's text, its surrounding spaces and tabs left out; undefined when
 * it is not a string or a number, or nothing is left. Copies of a header
 * sent more than once give their text only when they all agree.
 */
function toText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const copies: Array<string | undefined> = value.map(
      (copy: unknown): string | undefined => {
        return Array.isArray(copy) ? undefined : toText(copy);
      },
    );

    return copies.every((copy: string | undefined): boolean => {
      return copy === copies[0];
    })
      ? copies[0]
      : undefined;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const text: string = String(value);
  let start: number = 0;
  let end: number = text.length;

  while (start < end && isSpace(text.charCodeAt(start))) {
    start++;
  }

  while (end > start && isSpace(text.charCodeAt(end - 1))) {
    end--;
  }

  return start < end ? text.slice(start, end) : undefined;
}

function readNow(nowMs: number | undefined): number {
  return typeof nowMs === "number" && Number.isFinite(nowMs)
    ? nowMs
    : Date.now();
}

function readBound(bound: number | undefined, fallback: number): number {
  return typeof bound === "number" && Number.isFinite(bound) && bound >= 0
    ? bound
    : fallback;
}

export default class RetryAfter {
  /*
   * The wait a Retry-After value asks for, in milliseconds, held between
   * minMs and maxMs; undefined when the value is not a Retry-After (absent,
   * empty, or neither delay-seconds nor an HTTP-date), so the caller waits
   * its own backoff. The value is a header's: a string, a number, or the
   * copies of a header sent more than once - which count only when they
   * all say the same.
   */
  public static parseMs(
    value: unknown,
    options?: RetryAfterOptions | undefined,
  ): number | undefined {
    const text: string | undefined = toText(value);
    const asked: RetryAfterOptions = options || {};
    let waitMs: number | undefined;

    if (text === undefined) {
      return undefined;
    }

    if (DELAY_SECONDS.test(text)) {
      // Digits too many for a number read as Infinity: the ceiling.
      waitMs = Number(text) * 1000;
    } else if (asked.acceptHttpDate !== false) {
      const nowMs: number = readNow(asked.nowMs);
      const retryAtMs: number | undefined = RetryAfter.parseHttpDate(
        text,
        nowMs,
      );

      waitMs = retryAtMs === undefined ? undefined : retryAtMs - nowMs;
    }

    return waitMs === undefined
      ? undefined
      : Math.min(
          Math.max(waitMs, readBound(asked.minMs, DEFAULT_RETRY_AFTER_MIN_MS)),
          readBound(asked.maxMs, DEFAULT_RETRY_AFTER_MAX_MS),
        );
  }

  /*
   * The same wait in whole seconds, rounded up - never sooner than asked -
   * for a caller that counts in seconds.
   */
  public static parseSeconds(
    value: unknown,
    options?: RetryAfterOptions | undefined,
  ): number | undefined {
    const waitMs: number | undefined = RetryAfter.parseMs(value, options);

    return waitMs === undefined ? undefined : Math.ceil(waitMs / 1000);
  }

  /*
   * The Retry-After header of a response's headers, whatever its case: an
   * object with a get() (fetch's Headers, axios's AxiosHeaders), or a plain
   * object of names to values (Node's, a test's). Undefined when there is
   * none; a get() that throws reads as none.
   */
  public static readHeader(headers: unknown): unknown {
    if (!headers || typeof headers !== "object") {
      return undefined;
    }

    const get: unknown = (headers as { get?: unknown }).get;

    if (typeof get === "function") {
      try {
        const value: unknown = (get as (name: string) => unknown).call(
          headers,
          RETRY_AFTER_HEADER,
        );

        if (value !== undefined && value !== null) {
          return value;
        }
      } catch {
        // A get() that throws is no header; the names are read below.
      }
    }

    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === RETRY_AFTER_HEADER) {
        return (headers as Record<string, unknown>)[name];
      }
    }

    return undefined;
  }

  // parseMs of a response's Retry-After header.
  public static msFromHeaders(
    headers: unknown,
    options?: RetryAfterOptions | undefined,
  ): number | undefined {
    return RetryAfter.parseMs(RetryAfter.readHeader(headers), options);
  }

  // parseSeconds of a response's Retry-After header.
  public static secondsFromHeaders(
    headers: unknown,
    options?: RetryAfterOptions | undefined,
  ): number | undefined {
    return RetryAfter.parseSeconds(RetryAfter.readHeader(headers), options);
  }

  /*
   * An HTTP-date in any of its three shapes, exactly as written, as
   * milliseconds since the epoch; undefined for anything else. nowMs is what
   * an RFC 850 date's two-digit year is read against.
   */
  public static parseHttpDate(
    value: string,
    nowMs?: number | undefined,
  ): number | undefined {
    let match: RegExpExecArray | null = IMF_FIXDATE.exec(value);

    if (match) {
      return toUtcMs(
        Number(match[3]),
        match[2],
        match[1],
        match[4],
        match[5],
        match[6],
      );
    }

    match = RFC_850_DATE.exec(value);

    if (match) {
      return readRfc850Date(match, readNow(nowMs));
    }

    match = ASCTIME_DATE.exec(value);

    // asctime's day is " 6" or "06": Number reads both as 6.
    return match
      ? toUtcMs(
          Number(match[6]),
          match[1],
          match[2],
          match[3],
          match[4],
          match[5],
        )
      : undefined;
  }
}
