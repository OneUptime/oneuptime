import RetryAfter, {
  DEFAULT_RETRY_AFTER_MAX_MS,
  DEFAULT_RETRY_AFTER_MIN_MS,
  RETRY_AFTER_HEADER,
} from "../../Utils/RetryAfter";
import { fastestRun } from "../Helpers/FastestRun";
import {
  LARGEST_LIMIT,
  SeededRandom,
  seededRandom,
} from "../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { AxiosHeaders } from "axios";

/*
 * Retry-After as RFC 9110 writes it (issue #8928): delay-seconds is digits
 * only, an HTTP-date is one of three shapes, and anything else is no
 * Retry-After, so the caller's own backoff applies. A wait that is read is
 * held between a floor and a ceiling, so neither "0" nor a date gone by
 * retries at once, and no value stalls a caller for longer than it allows.
 */

// Sun, 06 Nov 1994 08:49:37 GMT: RFC 9110's own example date.
const RFC_EXAMPLE_MS: number = Date.UTC(1994, 10, 6, 8, 49, 37);

// 16 Nov 2026, 10:00:00 UTC: "now" in most tests below.
const NOW_MS: number = Date.UTC(2026, 10, 16, 10, 0, 0);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("delay-seconds", () => {
  test("a whole number of seconds waits that long", () => {
    expect(RetryAfter.parseMs("7")).toBe(7000);
    expect(RetryAfter.parseMs("120")).toBe(120_000);
    // 1*DIGIT allows leading zeros.
    expect(RetryAfter.parseMs("007")).toBe(7000);
    // A number, as a test's or an adapter's header object may hold.
    expect(RetryAfter.parseMs(25)).toBe(25_000);
  });

  test("spaces and tabs around the value are not part of it", () => {
    expect(RetryAfter.parseMs("  7 ")).toBe(7000);
    expect(RetryAfter.parseMs("\t7\t")).toBe(7000);
  });

  test("0 waits the floor, so a server that keeps answering 0 is not asked in a tight loop", () => {
    expect(RetryAfter.parseMs("0")).toBe(DEFAULT_RETRY_AFTER_MIN_MS);
    expect(RetryAfter.parseMs("000")).toBe(DEFAULT_RETRY_AFTER_MIN_MS);
    expect(DEFAULT_RETRY_AFTER_MIN_MS).toBe(1000);
  });

  test("a caller may lower the floor, to 0 if it has its own pacing", () => {
    expect(RetryAfter.parseMs("0", { minMs: 0 })).toBe(0);
    expect(RetryAfter.parseMs("0", { minMs: 250 })).toBe(250);
    expect(RetryAfter.parseMs("2", { minMs: 0 })).toBe(2000);
  });

  test("a huge value waits the ceiling, an hour unless the caller says otherwise", () => {
    expect(DEFAULT_RETRY_AFTER_MAX_MS).toBe(60 * 60 * 1000);
    expect(RetryAfter.parseMs("3600")).toBe(3_600_000);
    expect(RetryAfter.parseMs("3601")).toBe(DEFAULT_RETRY_AFTER_MAX_MS);
    expect(RetryAfter.parseMs("99999999999999999999")).toBe(
      DEFAULT_RETRY_AFTER_MAX_MS,
    );
    // Digits too many for a number: Number() reads Infinity.
    expect(RetryAfter.parseMs("9".repeat(400))).toBe(
      DEFAULT_RETRY_AFTER_MAX_MS,
    );
    expect(RetryAfter.parseMs("3600", { maxMs: 8000 })).toBe(8000);
  });

  test("the ceiling wins over the floor", () => {
    expect(RetryAfter.parseMs("0", { minMs: 5000, maxMs: 2000 })).toBe(2000);
    expect(RetryAfter.parseMs("60", { minMs: 5000, maxMs: 2000 })).toBe(2000);
  });

  test("a bound that is not a finite number of 0 or more is the default", () => {
    for (const bound of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(RetryAfter.parseMs("0", { minMs: bound })).toBe(
        DEFAULT_RETRY_AFTER_MIN_MS,
      );
      expect(RetryAfter.parseMs("7200", { maxMs: bound })).toBe(
        DEFAULT_RETRY_AFTER_MAX_MS,
      );
    }
  });
});

describe("what is not a Retry-After reads as none, so the caller's backoff applies", () => {
  /*
   * The regression of issue #8928: Date.parse read "-5", "1.5" and
   * "5 seconds" as days in 2001 - gone by - and API.fetch retried at once.
   */
  test.each([
    ["-5"],
    ["1.5"],
    ["5 seconds"],
    ["+5"],
    ["-0"],
    [".5"],
    ["5."],
    ["1e3"],
    ["0x10"],
    ["0b11"],
    ["1_000"],
    ["1 0"],
    ["120, 120"],
    ["Infinity"],
    ["NaN"],
    ["soon-ish"],
    ["five"],
    // Arabic-Indic and full-width digits are no DIGIT.
    ["٥"],
    ["５"],
    // Only spaces and tabs are trimmed: a no-break space is part of the value.
    [" 7"],
    ["7\n"],
    [""],
    ["   "],
    ["\t"],
  ])("%j", (value: string) => {
    expect(RetryAfter.parseMs(value)).toBeUndefined();
    expect(RetryAfter.parseSeconds(value)).toBeUndefined();
  });

  test("dates in shapes other than the three: undefined", () => {
    for (const value of [
      // ISO 8601, and the shapes Date.parse also takes.
      "2026-11-16T10:00:07Z",
      "2026-11-16",
      "11/16/2026",
      "16 Nov 2026 10:00:07 GMT",
      "Mon, 16 Nov 2026 10:00:07 +0000",
      "Mon, 16 Nov 2026 10:00:07 UTC",
      "Mon, 16 Nov 2026 10:00:07",
      "Mon, 16 Nov 2026 10:00:07 GMT+1",
      // HTTP-date is case sensitive.
      "mon, 16 nov 2026 10:00:07 gmt",
      "MON, 16 NOV 2026 10:00:07 GMT",
      // One digit where two are required, and two where four are.
      "Mon, 6 Nov 2026 10:00:07 GMT",
      "Mon, 16 Nov 26 10:00:07 GMT",
      "Mon, 16 Nov 2026 9:00:07 GMT",
      // Spaces missing, doubled, or a comma too many.
      "Mon,16 Nov 2026 10:00:07 GMT",
      "Mon, 16  Nov 2026 10:00:07 GMT",
      "Mon, 16 Nov, 2026 10:00:07 GMT",
      // The long day name belongs to RFC 850's shape, the short to the others.
      "Monday, 16 Nov 2026 10:00:07 GMT",
      "Mon, 16-Nov-26 10:00:07 GMT",
      // asctime with one space before a one-digit day.
      "Mon Nov 6 10:00:07 2026",
      // Something after the date.
      "Mon, 16 Nov 2026 10:00:07 GMT, Mon, 16 Nov 2026 10:00:07 GMT",
      "Mon, 16 Nov 2026 10:00:07 GMT x",
    ]) {
      expect({
        value,
        waitMs: RetryAfter.parseMs(value, { nowMs: NOW_MS }),
      }).toEqual({ value, waitMs: undefined });
    }
  });

  test("a value that is not a string or a number: undefined", () => {
    for (const value of [
      undefined,
      null,
      true,
      {},
      { value: "7" },
      () => {
        return "7";
      },
    ]) {
      expect(RetryAfter.parseMs(value)).toBeUndefined();
    }
  });

  test("a number that is not a whole one of 0 or more: undefined", () => {
    for (const value of [
      -5,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      // String(1e21) is "1e+21": no digits-only text, so no Retry-After.
      1e21,
    ]) {
      expect(RetryAfter.parseMs(value)).toBeUndefined();
    }
  });
});

describe("IMF-fixdate, the shape senders send", () => {
  test("a date ahead waits until then", () => {
    expect(
      RetryAfter.parseMs("Sun, 06 Nov 1994 08:49:37 GMT", {
        nowMs: RFC_EXAMPLE_MS - 7000,
      }),
    ).toBe(7000);
    expect(
      RetryAfter.parseMs("Mon, 16 Nov 2026 10:05:00 GMT", { nowMs: NOW_MS }),
    ).toBe(5 * 60 * 1000);
  });

  test("a date gone by, or now, waits the floor - a server clock behind ours never means a retry at once", () => {
    for (const value of [
      "Mon, 16 Nov 2026 09:59:00 GMT",
      "Mon, 16 Nov 2026 10:00:00 GMT",
      "Sun, 06 Nov 1994 08:49:37 GMT",
    ]) {
      expect(RetryAfter.parseMs(value, { nowMs: NOW_MS })).toBe(
        DEFAULT_RETRY_AFTER_MIN_MS,
      );
      expect(RetryAfter.parseMs(value, { nowMs: NOW_MS, minMs: 0 })).toBe(0);
    }
  });

  test("a date beyond the ceiling waits the ceiling", () => {
    expect(
      RetryAfter.parseMs("Mon, 16 Nov 2026 12:00:00 GMT", { nowMs: NOW_MS }),
    ).toBe(DEFAULT_RETRY_AFTER_MAX_MS);
    expect(
      RetryAfter.parseMs("Fri, 31 Dec 9999 23:59:59 GMT", {
        nowMs: NOW_MS,
        maxMs: 30_000,
      }),
    ).toBe(30_000);
  });

  test("spaces and tabs around a date are not part of it", () => {
    expect(
      RetryAfter.parseMs(" \tMon, 16 Nov 2026 10:00:09 GMT\t ", {
        nowMs: NOW_MS,
      }),
    ).toBe(9000);
  });

  test("now is Date.now() when the caller does not say", () => {
    jest.spyOn(Date, "now").mockReturnValue(NOW_MS);

    expect(RetryAfter.parseMs("Mon, 16 Nov 2026 10:00:30 GMT")).toBe(30_000);
    expect(
      RetryAfter.parseMs("Mon, 16 Nov 2026 10:00:30 GMT", {
        nowMs: Number.NaN,
      }),
    ).toBe(30_000);
  });

  test("the day name is not checked against the date: the date says when", () => {
    // 16 Nov 2026 is a Monday.
    expect(
      RetryAfter.parseMs("Fri, 16 Nov 2026 10:00:07 GMT", { nowMs: NOW_MS }),
    ).toBe(7000);
  });

  test("every date toUTCString writes reads back to the second", () => {
    const random: SeededRandom = seededRandom(8928);

    for (let index: number = 0; index < 2000; index++) {
      // Any second from 1970 to 2106.
      const atMs: number = random(LARGEST_LIMIT) * 1000;
      const written: string = new Date(atMs).toUTCString();

      expect({ written, read: RetryAfter.parseHttpDate(written) }).toEqual({
        written,
        read: atMs,
      });
    }
  });

  test("a day the month does not have, or a time past the day, is no date", () => {
    for (const value of [
      "Thu, 31 Apr 2026 10:00:00 GMT",
      "Sun, 29 Feb 2026 10:00:00 GMT",
      "Mon, 30 Feb 2026 10:00:00 GMT",
      "Mon, 32 Jan 2026 10:00:00 GMT",
      "Mon, 00 Jan 2026 10:00:00 GMT",
      "Mon, 16 Nov 2026 24:00:00 GMT",
      "Mon, 16 Nov 2026 10:60:00 GMT",
      "Mon, 16 Nov 2026 10:00:61 GMT",
      "Mon, 16 Nov 2026 99:99:99 GMT",
    ]) {
      expect({ value, read: RetryAfter.parseHttpDate(value) }).toEqual({
        value,
        read: undefined,
      });
    }
  });

  test("29 February is a date in a leap year, and 60 a leap second", () => {
    expect(RetryAfter.parseHttpDate("Thu, 29 Feb 2024 10:00:00 GMT")).toBe(
      Date.UTC(2024, 1, 29, 10, 0, 0),
    );
    expect(RetryAfter.parseHttpDate("Tue, 29 Feb 2000 10:00:00 GMT")).toBe(
      Date.UTC(2000, 1, 29, 10, 0, 0),
    );
    expect(RetryAfter.parseHttpDate("Thu, 29 Feb 1900 10:00:00 GMT")).toBe(
      undefined,
    );
    // The leap second reads as the first second of the next minute.
    expect(RetryAfter.parseHttpDate("Wed, 31 Dec 2016 23:59:60 GMT")).toBe(
      Date.UTC(2017, 0, 1, 0, 0, 0),
    );
  });

  test("a four-digit year below 100 is that year, not 1900 and more", () => {
    const read: number | undefined = RetryAfter.parseHttpDate(
      "Sat, 06 Nov 0094 08:49:37 GMT",
    );

    expect(read).toBeDefined();
    expect(new Date(read!).getUTCFullYear()).toBe(94);
  });
});

describe("the obsolete RFC 850 shape", () => {
  test("is read, with its day name in full", () => {
    expect(
      RetryAfter.parseMs("Monday, 16-Nov-26 10:00:07 GMT", { nowMs: NOW_MS }),
    ).toBe(7000);
  });

  test("a two-digit year is this century's unless that is more than 50 years ahead", () => {
    // 2094 would be 68 years ahead: it is 1994, RFC 9110's example.
    expect(
      RetryAfter.parseHttpDate("Sunday, 06-Nov-94 08:49:37 GMT", NOW_MS),
    ).toBe(RFC_EXAMPLE_MS);
    // "70" is 2070 in 2026, 44 years ahead - not 1970, as a fixed pivot reads it.
    expect(
      RetryAfter.parseHttpDate("Thursday, 01-Jan-70 00:00:00 GMT", NOW_MS),
    ).toBe(Date.UTC(2070, 0, 1));
    // 2030 is four years ahead: this century.
    expect(
      RetryAfter.parseHttpDate("Friday, 01-Mar-30 00:00:00 GMT", NOW_MS),
    ).toBe(Date.UTC(2030, 2, 1));
    // Exactly 50 years ahead is not more than 50: this century still.
    expect(
      RetryAfter.parseHttpDate("Monday, 16-Nov-76 10:00:00 GMT", NOW_MS),
    ).toBe(Date.UTC(2076, 10, 16, 10, 0, 0));
    // A second past 50 years ahead: the century before.
    expect(
      RetryAfter.parseHttpDate("Monday, 16-Nov-76 10:00:01 GMT", NOW_MS),
    ).toBe(Date.UTC(1976, 10, 16, 10, 0, 1));
  });

  test("a date gone by waits the floor, like any other", () => {
    expect(
      RetryAfter.parseMs("Sunday, 06-Nov-94 08:49:37 GMT", { nowMs: NOW_MS }),
    ).toBe(DEFAULT_RETRY_AFTER_MIN_MS);
  });

  test("a day the month does not have is no date", () => {
    expect(
      RetryAfter.parseHttpDate("Sunday, 29-Feb-26 10:00:00 GMT", NOW_MS),
    ).toBeUndefined();
    expect(
      RetryAfter.parseHttpDate("Sunday, 31-Jun-26 10:00:00 GMT", NOW_MS),
    ).toBeUndefined();
  });
});

describe("the obsolete asctime shape", () => {
  test("is read as UTC, never in the local time zone", () => {
    expect(RetryAfter.parseHttpDate("Sun Nov  6 08:49:37 1994")).toBe(
      RFC_EXAMPLE_MS,
    );
    expect(RetryAfter.parseHttpDate("Sun Nov 06 08:49:37 1994")).toBe(
      RFC_EXAMPLE_MS,
    );
    expect(
      RetryAfter.parseMs("Mon Nov 16 10:00:07 2026", { nowMs: NOW_MS }),
    ).toBe(7000);
  });

  test("a day the month does not have is no date", () => {
    expect(RetryAfter.parseHttpDate("Sun Feb 30 08:49:37 1994")).toBe(
      undefined,
    );
  });
});

describe("acceptHttpDate: false", () => {
  test("reads delay-seconds only", () => {
    expect(RetryAfter.parseMs("7", { acceptHttpDate: false })).toBe(7000);
    expect(
      RetryAfter.parseMs("Mon, 16 Nov 2026 10:00:07 GMT", {
        nowMs: NOW_MS,
        acceptHttpDate: false,
      }),
    ).toBeUndefined();
    expect(
      RetryAfter.parseMs("Mon, 16 Nov 2026 10:00:07 GMT", {
        nowMs: NOW_MS,
        acceptHttpDate: true,
      }),
    ).toBe(7000);
  });
});

describe("parseSeconds", () => {
  test("is the wait in whole seconds, rounded up, never sooner than asked", () => {
    expect(RetryAfter.parseSeconds("7")).toBe(7);
    expect(RetryAfter.parseSeconds("0")).toBe(1);
    expect(RetryAfter.parseSeconds("0", { minMs: 0 })).toBe(0);
    expect(
      RetryAfter.parseSeconds("Mon, 16 Nov 2026 10:00:05 GMT", {
        nowMs: NOW_MS + 800,
      }),
    ).toBe(5);
    expect(RetryAfter.parseSeconds("99999")).toBe(3600);
    expect(RetryAfter.parseSeconds("five")).toBeUndefined();
  });
});

describe("a header sent more than once", () => {
  test("counts only when every copy says the same", () => {
    expect(RetryAfter.parseMs(["7"])).toBe(7000);
    expect(RetryAfter.parseMs(["7", " 7"])).toBe(7000);
    expect(RetryAfter.parseMs(["7", 7])).toBe(7000);
    expect(RetryAfter.parseMs(["7", "8"])).toBeUndefined();
    expect(RetryAfter.parseMs(["7", "soon"])).toBeUndefined();
    expect(RetryAfter.parseMs(["7", ""])).toBeUndefined();
    expect(RetryAfter.parseMs([])).toBeUndefined();
    expect(RetryAfter.parseMs([["7"]])).toBeUndefined();
  });
});

describe("readHeader", () => {
  test("reads a plain object's header whatever its case", () => {
    expect(RETRY_AFTER_HEADER).toBe("retry-after");
    expect(RetryAfter.readHeader({ "retry-after": "7" })).toBe("7");
    expect(RetryAfter.readHeader({ "Retry-After": "7" })).toBe("7");
    expect(RetryAfter.readHeader({ "RETRY-AFTER": "7" })).toBe("7");
    expect(
      RetryAfter.readHeader({ "content-type": "text/plain", "retry-after": 9 }),
    ).toBe(9);
  });

  test("reads fetch's Headers and axios's AxiosHeaders through get()", () => {
    expect(RetryAfter.readHeader(new Headers({ "Retry-After": "7" }))).toBe(
      "7",
    );
    expect(
      RetryAfter.readHeader(new AxiosHeaders({ "Retry-After": "8" })),
    ).toBe("8");
    expect(
      RetryAfter.readHeader({
        get: (name: string): string | null => {
          return name === "retry-after" ? "9" : null;
        },
      }),
    ).toBe("9");
  });

  test("a get() that throws, or finds nothing, falls back to the names", () => {
    expect(
      RetryAfter.readHeader({
        get: (): never => {
          throw new Error("headers already consumed");
        },
        "Retry-After": "7",
      }),
    ).toBe("7");
    expect(
      RetryAfter.readHeader({
        get: (): null => {
          return null;
        },
      }),
    ).toBeUndefined();
  });

  test("a header named get is a header, not a function to call", () => {
    expect(RetryAfter.readHeader({ get: "nothing", "retry-after": "7" })).toBe(
      "7",
    );
  });

  test("no headers, or none of this name: undefined", () => {
    expect(RetryAfter.readHeader(undefined)).toBeUndefined();
    expect(RetryAfter.readHeader(null)).toBeUndefined();
    expect(RetryAfter.readHeader("retry-after: 7")).toBeUndefined();
    expect(RetryAfter.readHeader({})).toBeUndefined();
    expect(
      RetryAfter.readHeader({ "x-ratelimit-retryafter": "7" }),
    ).toBeUndefined();
    expect(RetryAfter.readHeader(new Headers())).toBeUndefined();
  });
});

describe("msFromHeaders and secondsFromHeaders", () => {
  test("read the header, then parse it", () => {
    expect(RetryAfter.msFromHeaders({ "Retry-After": "7" })).toBe(7000);
    expect(
      RetryAfter.msFromHeaders(
        new Headers({ "retry-after": "Mon, 16 Nov 2026 10:00:07 GMT" }),
        { nowMs: NOW_MS },
      ),
    ).toBe(7000);
    expect(RetryAfter.secondsFromHeaders({ "retry-after": "7" })).toBe(7);
    expect(
      RetryAfter.secondsFromHeaders({ "retry-after": "7" }, { maxMs: 5000 }),
    ).toBe(5);
    expect(RetryAfter.msFromHeaders({ "retry-after": "-5" })).toBeUndefined();
    expect(RetryAfter.msFromHeaders({})).toBeUndefined();
    expect(RetryAfter.secondsFromHeaders(undefined)).toBeUndefined();
  });
});

describe("a value from the network costs time in line with its length", () => {
  const LONG: number = 1_000_000;

  test.each([
    ["spaces around a number", `${" ".repeat(LONG)}7${" ".repeat(LONG)}`],
    ["spaces inside", `7${" ".repeat(LONG)}7`],
    ["digits", "9".repeat(LONG)],
    [
      "a date and then more",
      `Mon, 16 Nov 2026 10:00:07 GMT${" x".repeat(LONG)}`,
    ],
    ["a day name over and over", "Mon, ".repeat(LONG / 5)],
  ])("%s", (_name: string, value: string) => {
    expect(
      fastestRun({
        run: (): number | undefined => {
          return RetryAfter.parseMs(value, { nowMs: NOW_MS });
        },
        limitInMs: 2000,
      }).inMs,
    ).toBeLessThan(2000);
  });
});
