/** @timezone America/New_York */

import OneUptimeDate, { ExactUnixNano } from "../../Types/Date";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * OneUptimeDate.readExactUnixNano reads an OTLP time - whole nanoseconds
 * since the epoch, as an integer string - from its digits, and
 * toClickhouseDateTime64 writes a DateTime64(9) fraction from the same
 * digits.
 *
 * The ingest read these times with parseFloat. Today's are about 1.8e18,
 * where doubles are 256 ns apart, so the float was up to 128 ns off, and the
 * Date made from it (fromUnixNano of a number) a millisecond off: early on
 * one whole millisecond in eight, late just before a millisecond ends. A
 * time up to 128 ns before a whole second read as that second. Where it
 * shows, a case also checks what that float read gave, so it is one the
 * float got wrong.
 *
 * Run in a non-UTC zone with daylight saving, as the other Date suites are:
 * under TZ=UTC a slip from the UTC getters to the local ones would be
 * invisible. The docblock above sets the zone before this file loads
 * (Tests/Utils/TimezoneEnvironment.js); the first test checks it took.
 */

describe("the zone this suite runs in", () => {
  test("is America/New_York, five hours behind UTC in winter and four in summer", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/New_York",
    );
    expect(new Date("2026-01-15T12:00:00.000Z").getTimezoneOffset()).toBe(300);
    expect(new Date("2026-07-15T12:00:00.000Z").getTimezoneOffset()).toBe(240);
  });
});

// 2026-10-17T10:11:12Z, a whole second of today's epoch.
const SECOND: number = Date.UTC(2026, 9, 17, 10, 11, 12) / 1000;
const SECOND_IN_MS: number = SECOND * 1000;

// 2026-10-17T10:11:12.345678901Z.
const PRECISE_NANO_TEXT: string = "1792231872345678901";

// The time `offsetInNanos` from SECOND, as OTLP sends it.
function nanosFromSecond(offsetInNanos: number): string {
  return (
    BigInt(SECOND) * BigInt(1000000000) +
    BigInt(offsetInNanos)
  ).toString();
}

// What the ingest's float read made of a text: its Date and its digits.
function floatRead(text: string): { ms: number; nano: string } {
  const float: number = Math.trunc(Number.parseFloat(text));
  return { ms: new Date(float / 1000000).getTime(), nano: float.toString() };
}

// The read, which must be there for the text.
function read(text: string): ExactUnixNano {
  const exact: ExactUnixNano | null = OneUptimeDate.readExactUnixNano(text);

  if (exact === null) {
    throw new Error(`${JSON.stringify(text)} was not read`);
  }

  return exact;
}

// The truth: BigInt's reading of an integer text.
function bigIntRead(text: string): { ms: number; nano: string } {
  const nanos: bigint = BigInt(text);
  return {
    ms: Number(nanos / BigInt(1000000)),
    nano: nanos.toString(),
  };
}

describe("OneUptimeDate.readExactUnixNano: whole milliseconds", () => {
  test("every millisecond of a run of 64 reads exactly, the eight a float read gets a millisecond early included", () => {
    let floatEarly: number = 0;

    for (let ms: number = SECOND_IN_MS; ms < SECOND_IN_MS + 64; ms++) {
      const text: string = `${ms}000000`;
      const exact: ExactUnixNano = read(text);

      expect(exact.date.getTime()).toBe(ms);
      expect(exact.nano).toBe(text);

      if (floatRead(text).ms === ms - 1) {
        floatEarly++;
        // ms = 2 mod 8: halfway between two doubles, rounded 128 ns down.
        expect(ms % 8).toBe(2);
      }
    }

    expect(floatEarly).toBe(8);
  });

  test("2026-10-17T10:11:12.346Z, which the float read gave as .345", () => {
    const text: string = `${SECOND_IN_MS + 346}000000`;

    expect(floatRead(text).ms).toBe(SECOND_IN_MS + 345);
    expect(read(text).date.toISOString()).toBe("2026-10-17T10:11:12.346Z");
    expect(read(text).nano).toBe("1792231872346000000");
  });
});

describe("OneUptimeDate.readExactUnixNano: to the nanosecond", () => {
  test("the digits as sent, and the millisecond they fall in", () => {
    const cases: Array<[string, number]> = [
      ["1792231872345678901", 1792231872345],
      ["1792231872345999999", 1792231872345],
      ["1792231872346000001", 1792231872346],
      ["1792231872000000001", 1792231872000],
      ["1792231872999999999", 1792231872999],
      ["1760000000123456789", 1760000000123],
    ];

    for (const [text, ms] of cases) {
      const exact: ExactUnixNano = read(text);
      expect(exact.nano).toBe(text);
      expect(exact.date.getTime()).toBe(ms);
    }

    // The float read wrote other digits for the first: 53 ns lower, shortened.
    expect(floatRead("1792231872345678901").nano).toBe("1792231872345678800");
  });

  test("100 ns before a whole second stays in the second before it", () => {
    const text: string = nanosFromSecond(-100);
    const exact: ExactUnixNano = read(text);

    expect(text).toBe("1792231871999999900");
    expect(exact.nano).toBe(text);
    expect(exact.date.getTime()).toBe(SECOND_IN_MS - 1);
    expect(exact.date.toISOString()).toBe("2026-10-17T10:11:11.999Z");

    // The float read was the whole second: the next second, and its digits.
    expect(floatRead(text)).toEqual({
      ms: SECOND_IN_MS,
      nano: "1792231872000000000",
    });
  });

  test("100 ns after a whole second keeps its 100 ns", () => {
    const text: string = nanosFromSecond(100);
    const exact: ExactUnixNano = read(text);

    expect(text).toBe("1792231872000000100");
    expect(exact.nano).toBe(text);
    expect(exact.date.getTime()).toBe(SECOND_IN_MS);
    expect(exact.date.toISOString()).toBe("2026-10-17T10:11:12.000Z");

    // The float read had the millisecond, but not the 100 ns.
    expect(floatRead(text)).toEqual({
      ms: SECOND_IN_MS,
      nano: "1792231872000000000",
    });
  });

  test("every nanosecond near a second and a millisecond agrees with BigInt, where the float read did not", () => {
    const offsets: Array<number> = [
      -1000001, -1000000, -999999, -257, -256, -255, -129, -128, -127, -101,
      -100, -99, -2, -1, 0, 1, 2, 99, 100, 101, 127, 128, 129, 255, 256, 257,
      999999, 1000000, 1000001,
    ];
    const floatWrong: Array<string> = [];

    for (const offset of offsets) {
      const text: string = nanosFromSecond(offset);
      const exact: ExactUnixNano = read(text);

      expect({ ms: exact.date.getTime(), nano: exact.nano }).toEqual(
        bigIntRead(text),
      );

      const floatOff: number = floatRead(text).ms - bigIntRead(text).ms;

      if (floatOff !== 0) {
        floatWrong.push(`${offset} ns: ${floatOff} ms`);
      }
    }

    /*
     * The float read the last 128 ns before the second as the second itself,
     * a millisecond late (and in the next second), and a nanosecond before
     * a millisecond's end one late too: dividing the float rounded it up.
     */
    expect(floatWrong).toEqual([
      "-1000001 ns: 1 ms",
      "-128 ns: 1 ms",
      "-127 ns: 1 ms",
      "-101 ns: 1 ms",
      "-100 ns: 1 ms",
      "-99 ns: 1 ms",
      "-2 ns: 1 ms",
      "-1 ns: 1 ms",
      "999999 ns: 1 ms",
    ]);
  });
});

describe("OneUptimeDate.readExactUnixNano: a '+' and leading zeros", () => {
  /*
   * parseFloat reads "+5" and "005" as 5, so the exact read does too: the
   * same number, without the float's rounding. The stored digits drop them,
   * as the float's digits did, so a UInt64 column gets plain digits.
   */
  test("read as the same number, and the digits drop them", () => {
    const cases: Array<[string, string, number]> = [
      ["+1792231872345678901", "1792231872345678901", 1792231872345],
      ["0001792231872345678901", "1792231872345678901", 1792231872345],
      ["+0001792231872345678901", "1792231872345678901", 1792231872345],
      ["+000123", "123", 0],
      ["00001000000", "1000000", 1],
      ["000", "0", 0],
      ["+0", "0", 0],
      ["+00", "0", 0],
      ["0", "0", 0],
    ];

    for (const [text, nano, ms] of cases) {
      const exact: ExactUnixNano = read(text);
      expect(exact.nano).toBe(nano);
      expect(exact.date.getTime()).toBe(ms);
      // The same number parseFloat reads.
      expect(Number.parseFloat(exact.nano)).toBe(Number.parseFloat(text));
    }
  });

  test("zeros do not count toward the 21 digits", () => {
    const text: string = "0".repeat(40) + "9".repeat(21);
    expect(read(text).nano).toBe("9".repeat(21));
  });

  test("only one '+', and only first", () => {
    for (const text of ["++1", "+-1", "-+1", "1+", "0+1", "+", "+ 1"]) {
      expect(OneUptimeDate.readExactUnixNano(text)).toBeNull();
    }
  });
});

describe("OneUptimeDate.readExactUnixNano: short texts", () => {
  test("under a millisecond, under a second, a second", () => {
    const cases: Array<[string, number]> = [
      ["0", 0],
      ["1", 0],
      ["5", 0],
      ["999999", 0],
      ["1000000", 1],
      ["1999999", 1],
      ["123456789", 123],
      ["999999999", 999],
      ["1000000000", 1000],
    ];

    for (const [text, ms] of cases) {
      const exact: ExactUnixNano = read(text);
      expect(exact.nano).toBe(text);
      expect(exact.date.getTime()).toBe(ms);
    }
  });
});

describe("OneUptimeDate.readExactUnixNano: how long a text it reads", () => {
  test("21 digits, every one a Date holds; one more is left to the caller", () => {
    const longest: ExactUnixNano = read("9".repeat(21));
    expect(longest.date.getTime()).toBe(999999999999999);
    expect(longest.date.toISOString()).toBe("+033658-09-27T01:46:39.999Z");

    expect(read("1" + "0".repeat(20)).date.getTime()).toBe(1e14);
    expect(OneUptimeDate.readExactUnixNano("1" + "0".repeat(21))).toBeNull();
    expect(OneUptimeDate.readExactUnixNano("9".repeat(40))).toBeNull();
  });

  test("int64 and uint64 nanoseconds' largest values", () => {
    expect(read("9223372036854775807")).toEqual({
      nano: "9223372036854775807",
      date: new Date(9223372036854),
    });
    expect(read("18446744073709551615")).toEqual({
      nano: "18446744073709551615",
      date: new Date(18446744073709),
    });
  });
});

describe("OneUptimeDate.readExactUnixNano: what it leaves to the caller's float read", () => {
  test("numbers: already floats, read as before", () => {
    for (const value of [
      0,
      1,
      -1,
      1792231872345678848,
      1.5e18,
      Number.MAX_SAFE_INTEGER,
      NaN,
      Infinity,
      -Infinity,
    ]) {
      expect(OneUptimeDate.readExactUnixNano(value)).toBeNull();
    }
  });

  test("no text at all", () => {
    for (const value of [
      undefined,
      null,
      true,
      false,
      {},
      [],
      ["1792231872345678901"],
      { low: 1, high: 2 },
      BigInt("1792231872345678901"),
      new String("1792231872345678901"),
    ]) {
      expect(OneUptimeDate.readExactUnixNano(value)).toBeNull();
    }
  });

  test("one character that is not a digit, anywhere in a time, of any length", () => {
    // "/" and ":" are the characters either side of the digits.
    for (const text of [PRECISE_NANO_TEXT, "9".repeat(21), "1234567", "12"]) {
      for (let at: number = 0; at < text.length; at++) {
        for (const wrong of ["/", ":", "a", " ", ".", "-"]) {
          const changed: string =
            text.slice(0, at) + wrong + text.slice(at + 1);

          if (OneUptimeDate.readExactUnixNano(changed) !== null) {
            throw new Error(`${JSON.stringify(changed)} was read`);
          }
        }
      }
    }
  });

  test("text that is not an integer string of nanoseconds", () => {
    const texts: Array<string> = [
      "",
      " ",
      "-",
      "-0",
      "-1",
      "-1792231872345678901",
      " 1792231872345678901",
      "1792231872345678901 ",
      "\t1792231872345678901\n",
      "1792231872345678901\n",
      "1.5",
      "1.5e18",
      "1e18",
      "1E18",
      "1792231872345678901.0",
      "1792231872345678901.",
      ".5",
      "0x1F",
      "0b101",
      "0o17",
      "1_000",
      "1,000",
      "Infinity",
      "NaN",
      "abc",
      "12a",
      "a12",
      "1792231872345678901abc",
      // Digits of other scripts, and a no-break space: none of them 0 to 9.
      String.fromCharCode(0x0661, 0x0662, 0x0663),
      String.fromCharCode(0xff11, 0xff12, 0xff13),
      `1${String.fromCharCode(0x00a0)}`,
    ];

    for (const text of texts) {
      expect(OneUptimeDate.readExactUnixNano(text)).toBeNull();
    }
  });
});

describe("OneUptimeDate.readExactUnixNano agrees with BigInt on every integer string it reads", () => {
  test("20,000 seeded texts of 1 to 21 digits, with and without a '+' and zeros", () => {
    const random: SeededRandom = seededRandom(5261);

    for (let i: number = 0; i < 20000; i++) {
      const digits: number = 1 + random(21);
      let text: string = String(1 + random(9));

      for (let d: number = 1; d < digits; d++) {
        text += String(random(10));
      }

      const input: string =
        (random(4) === 0 ? "+" : "") + "0".repeat(random(3)) + text;
      const exact: ExactUnixNano | null =
        OneUptimeDate.readExactUnixNano(input);
      const truth: { ms: number; nano: string } = bigIntRead(input);

      if (
        exact === null ||
        exact.nano !== truth.nano ||
        exact.date.getTime() !== truth.ms ||
        // fromUnixNano's own exact read (BigInt) of the same text.
        OneUptimeDate.fromUnixNano(input).getTime() !== truth.ms
      ) {
        throw new Error(
          `${JSON.stringify(input)} read as ${JSON.stringify(exact && { nano: exact.nano, ms: exact.date.getTime() })}, BigInt reads ${JSON.stringify(truth)}`,
        );
      }
    }
  });

  test("20,000 seeded times around today's, each a nanosecond of its own", () => {
    const random: SeededRandom = seededRandom(1792);

    for (let i: number = 0; i < 20000; i++) {
      // Within about 11 days of SECOND, to the nanosecond.
      const text: string = nanosFromSecond(
        random(1e6) * 1e9 + random(1e9) - 5e14,
      );
      const exact: ExactUnixNano = read(text);
      const truth: { ms: number; nano: string } = bigIntRead(text);

      if (exact.nano !== truth.nano || exact.date.getTime() !== truth.ms) {
        throw new Error(
          `${text} read as ${exact.nano} / ${exact.date.getTime()}, BigInt reads ${truth.nano} / ${truth.ms}`,
        );
      }
    }
  });
});

describe("OneUptimeDate.readExactUnixNano hands back what is its own", () => {
  test("each read a Date of its own; a text of plain digits as it came", () => {
    const text: string = "1792231872345678901";
    const first: ExactUnixNano = read(text);
    first.date.setUTCFullYear(1999);

    expect(read(text).date.getTime()).toBe(1792231872345);
    expect(read(text).date).not.toBe(read(text).date);
    expect(read(text).nano).toBe(text);
  });
});

describe("OneUptimeDate.toClickhouseDateTime64 with digits: the second and the fraction from one read", () => {
  // The DateTime64 text of an exact read, as the logs ingest writes it.
  function dateTime64(text: string): string {
    const exact: ExactUnixNano = read(text);
    return OneUptimeDate.toClickhouseDateTime64(exact.date, exact.nano);
  }

  test("100 ns before a whole second: the second before, and .999999900", () => {
    expect(dateTime64(nanosFromSecond(-100))).toBe(
      "2026-10-17 10:11:11.999999900",
    );
  });

  test("100 ns after a whole second: that second, and .000000100", () => {
    expect(dateTime64(nanosFromSecond(100))).toBe(
      "2026-10-17 10:11:12.000000100",
    );
  });

  test("the nanoseconds either side of a whole second, and the second itself", () => {
    expect(dateTime64(nanosFromSecond(-1))).toBe(
      "2026-10-17 10:11:11.999999999",
    );
    expect(dateTime64(nanosFromSecond(0))).toBe(
      "2026-10-17 10:11:12.000000000",
    );
    expect(dateTime64(nanosFromSecond(1))).toBe(
      "2026-10-17 10:11:12.000000001",
    );
  });

  test("a time to the nanosecond", () => {
    expect(dateTime64("1792231872345678901")).toBe(
      "2026-10-17 10:11:12.345678901",
    );
  });

  test("short digits pad to nine", () => {
    expect(dateTime64("0")).toBe("1970-01-01 00:00:00.000000000");
    expect(dateTime64("5")).toBe("1970-01-01 00:00:00.000000005");
    expect(dateTime64("123456789")).toBe("1970-01-01 00:00:00.123456789");
    expect(dateTime64("1000000007")).toBe("1970-01-01 00:00:01.000000007");
  });

  test("the year, month, day and hour roll over with the second", () => {
    const newYear: number = Date.UTC(2027, 0, 1) / 1000;
    const before: string = (
      BigInt(newYear) * BigInt(1000000000) -
      BigInt(100)
    ).toString();

    expect(dateTime64(before)).toBe("2026-12-31 23:59:59.999999900");
  });

  test("an exact Date with the float's fraction would have been a second early", () => {
    const text: string = nanosFromSecond(-100);
    const exact: ExactUnixNano = read(text);
    const float: number = Number.parseFloat(text);

    // The float is the whole second, so its fraction is .000000000 ...
    expect(float % 1e9).toBe(0);
    // ... and with the exact Date's second it reads a second early.
    expect(OneUptimeDate.toClickhouseDateTime64(exact.date, float)).toBe(
      "2026-10-17 10:11:11.000000000",
    );
    // From the same digits, both are right.
    expect(OneUptimeDate.toClickhouseDateTime64(exact.date, exact.nano)).toBe(
      "2026-10-17 10:11:11.999999900",
    );
  });

  test("numbers are read as before: the remainder of the float, or the Date's milliseconds", () => {
    const date: Date = new Date(Date.UTC(1970, 0, 20, 12, 0, 5, 0));
    const nano: number = date.getTime() * 1_000_000 + 123_456_789;

    expect(OneUptimeDate.toClickhouseDateTime64(date, nano)).toBe(
      "1970-01-20 12:00:05.123456789",
    );

    const withMilliseconds: Date = new Date(
      Date.UTC(2026, 7, 10, 12, 0, 5, 123),
    );

    expect(OneUptimeDate.toClickhouseDateTime64(withMilliseconds)).toBe(
      "2026-08-10 12:00:05.123000000",
    );
    expect(OneUptimeDate.toClickhouseDateTime64(withMilliseconds, 0)).toBe(
      "2026-08-10 12:00:05.123000000",
    );
    expect(OneUptimeDate.toClickhouseDateTime64(withMilliseconds, -5)).toBe(
      "2026-08-10 12:00:05.123000000",
    );
  });
});
