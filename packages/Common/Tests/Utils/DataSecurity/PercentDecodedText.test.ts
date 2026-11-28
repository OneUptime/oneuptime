import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import PercentDecodedText, {
  MAX_PERCENT_DECODINGS,
  PercentDecodedRange,
} from "../../../Utils/DataSecurity/PercentDecodedText";

/*
 * A TEXT AS ITS PERCENT-ESCAPES READ, AND WHERE EACH PART IS WRITTEN (#10467).
 *
 * Data Security's IP address detectors and an IP Address scrub rule read a
 * text this way too, so an address in a percent-encoded URL - its colons
 * written %3A - is found, and hidden on exactly the characters it is
 * written with. These tests read the reading itself: what it reads, what it
 * leaves, and where every position of it is written.
 */

// The written characters a range of the reading stands for.
function writtenOf(text: string, range: PercentDecodedRange): string {
  const read: PercentDecodedText = PercentDecodedText.read(text)!;
  const [start, end] = read.rangeToWritten(range);

  return text.slice(start, end);
}

// The range of the reading where `part` is.
function rangeOf(read: PercentDecodedText, part: string): PercentDecodedRange {
  const start: number = read.readable.indexOf(part);

  expect(start).toBeGreaterThanOrEqual(0);

  return [start, start + part.length];
}

describe("what the reading reads", () => {
  test.each([
    ["an encoded colon", "2001%3Adb8%3A%3A1", "2001:db8::1"],
    ["a lower-case escape", "2001%3adb8%3a%3a1", "2001:db8::1"],
    [
      "an encoded URL",
      "target=http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%2F",
      "target=http://[2001:db8::1]/",
    ],
    ["an encoded IPv4 address", "8%2E8%2E8%2E8", "8.8.8.8"],
    ["digits written as escapes", "%38.%38.%38.%38", "8.8.8.8"],
    ["every character escaped", "%32%30%30%31%3A%3A%31", "2001::1"],
    ["a mixed spelling", "2001%3Adb8::1", "2001:db8::1"],
    ["a space and a query", "a%20b%3Fc%3Dd%26e", "a b?c=d&e"],
    ["an escape at the very start", "%5Bx", "[x"],
    ["an escape at the very end", "x%5D", "x]"],
    ["escapes back to back", "%3A%3A%3A", ":::"],
  ])("%s: %s reads %s", (_label: string, text: string, readable: string) => {
    expect(PercentDecodedText.read(text)!.readable).toBe(readable);
    expect(PercentDecodedText.readableOf(text)).toBe(readable);
  });

  test("an escape escaped again is read again: a URL inside a query string inside a URL", () => {
    const text: string =
      "next=https%3A%2F%2Fa.example%2Fcb%3Fto%3Dhttp%253A%252F%252F%255B2001%253Adb8%253A%253A1%255D";

    expect(PercentDecodedText.read(text)!.readable).toBe(
      "next=https://a.example/cb?to=http://[2001:db8::1]",
    );
  });

  test(`reads an escape escaped again up to ${MAX_PERCENT_DECODINGS} times, and no more`, () => {
    expect(MAX_PERCENT_DECODINGS).toBe(3);
    // Escaped once, twice and three times: read in full.
    expect(PercentDecodedText.readableOf("%3A")).toBe(":");
    expect(PercentDecodedText.readableOf("%253A")).toBe(":");
    expect(PercentDecodedText.readableOf("%25253A")).toBe(":");
    // Four times: read three times, one escape left as written.
    expect(PercentDecodedText.readableOf("%2525253A")).toBe("%3A");
  });

  test.each([
    ["a percent sign that ends a number", "cpu 100% busy"],
    ["a percent sign at the very end", "done 100%"],
    ["a percent sign and one character", "x%4"],
    ["a percent sign and no hex digits", "%zz %g1 %1g"],
    ["two percent signs", "50%%"],
    ["bytes beyond ASCII that start no character", "%FF %80 %BF %F5%80%80%80"],
    ["a plus, which only a form's body reads as a space", "a+b"],
    ["no percent sign at all", "2001:db8::1"],
    ["an empty text", ""],
  ])("leaves %s as it is written: %s", (_label: string, text: string) => {
    expect(PercentDecodedText.read(text)).toBeNull();
    expect(PercentDecodedText.readableOf(text)).toBe(text);
  });

  test("reads the escapes among those it leaves", () => {
    expect(
      PercentDecodedText.readableOf("100% of %C3%A9 at %5B2001%3A%3A1%5D, %zz"),
    ).toBe("100% of é at [2001::1], %zz");
  });
});

/*
 * A CHARACTER BEYOND ASCII, ITS UTF-8 BYTES EACH AN ESCAPE (#11032):
 * jos%C3%A9%40example.com reads josé@example.com. Only bytes that spell a
 * character in UTF-8 are read as one; any other is left as it is written.
 */
describe("a character's UTF-8 bytes, each escaped", () => {
  test.each([
    ["two bytes: é", "jos%C3%A9", "josé"],
    ["two bytes, in lower case", "jos%c3%a9", "josé"],
    ["three bytes: €", "%E2%82%AC5", "€5"],
    ["three bytes: a Han character", "%E5%BC%A0%E4%BC%9F", "张伟"],
    ["three bytes: a fullwidth digit", "%EF%BC%94%EF%BC%91", "４１"],
    ["four bytes: an emoji, one beyond U+FFFF", "hi%F0%9F%98%80", "hi😀"],
    ["the highest code point", "%F4%8F%BF%BF", "\u{10FFFF}"],
    ["the lowest of three bytes", "%E0%A0%80", "ࠀ"],
    [
      "an address of another script, its @ escaped too",
      "email=jos%C3%A9%40example.com",
      "email=josé@example.com",
    ],
    [
      "a name in a query string",
      "name=Jos%C3%A9%20Garc%C3%ADa",
      "name=José García",
    ],
    ["escaped twice", "jos%25C3%25A9", "josé"],
  ])("%s: %s reads %s", (_label: string, text: string, readable: string) => {
    expect(PercentDecodedText.read(text)!.readable).toBe(readable);
  });

  test.each([
    ["a continuation byte alone", "%A9x", "%A9x"],
    ["a lead byte alone", "%C3x", "%C3x"],
    ["a lead byte at the very end", "x%C3", "x%C3"],
    ["a character cut short", "%E2%82x", "%E2%82x"],
    ["a lead byte before ASCII", "%C3%41", "%C3A"],
    ["two lead bytes", "%C3%C3%A9", "%C3é"],
    ["an overlong two bytes: C0 or C1", "%C0%AF %C1%81", "%C0%AF %C1%81"],
    ["an overlong three bytes", "%E0%80%AF", "%E0%80%AF"],
    ["an overlong four bytes", "%F0%80%80%AF", "%F0%80%80%AF"],
    ["a surrogate", "%ED%A0%80", "%ED%A0%80"],
    ["beyond U+10FFFF", "%F4%90%80%80", "%F4%90%80%80"],
    ["a byte that starts nothing", "%F8%80%80%80%80", "%F8%80%80%80%80"],
    ["a byte written between two escaped", "%C3A%A9", "%C3A%A9"],
  ])(
    "leaves %s as it is written: %s reads %s",
    (_label: string, text: string, readable: string) => {
      expect(PercentDecodedText.readableOf(text)).toBe(readable);
    },
  );

  test("a character whose bytes were escaped unevenly is left, as a URL decoder leaves it", () => {
    // The lead byte escaped twice, its continuation once: two different readings.
    expect(PercentDecodedText.readableOf("%25C3%A9")).toBe("%C3%A9");
  });

  test("each character is placed on every escape it was written with", () => {
    const text: string = "email=jos%C3%A9%40example.com&x=1";
    const read: PercentDecodedText = PercentDecodedText.read(text)!;

    expect(writtenOf(text, rangeOf(read, "josé@example.com"))).toBe(
      "jos%C3%A9%40example.com",
    );
    expect(writtenOf(text, rangeOf(read, "é"))).toBe("%C3%A9");
    expect(writtenOf(text, rangeOf(read, "@"))).toBe("%40");
    expect(writtenOf(text, rangeOf(read, "&x=1"))).toBe("&x=1");
  });

  test("a character read as two UTF-16 units is placed whole, wherever a range ends in it", () => {
    const text: string = "a%F0%9F%98%80b";
    const read: PercentDecodedText = PercentDecodedText.read(text)!;

    expect(read.readable).toBe("a😀b");
    // The emoji's two units: both, or either half, take its four escapes.
    expect(writtenOf(text, [1, 3])).toBe("%F0%9F%98%80");
    expect(writtenOf(text, [1, 2])).toBe("%F0%9F%98%80");
    expect(writtenOf(text, [0, 2])).toBe("a%F0%9F%98%80");
    expect(read.toWritten(3)).toBe(text.length - 1);
    expect(read.toWritten(read.readable.length)).toBe(text.length);
  });

  test("ASCII and UTF-8 escapes read together, escaped twice, are placed on their own characters", () => {
    const text: string = "to=a%253Ab%2520jos%25C3%25A9";
    const read: PercentDecodedText = PercentDecodedText.read(text)!;

    expect(read.readable).toBe("to=a:b josé");
    expect(writtenOf(text, rangeOf(read, "josé"))).toBe("jos%25C3%25A9");
    expect(writtenOf(text, rangeOf(read, ":"))).toBe("%253A");
  });

  test("a percent sign before an escape stays, and never joins what the escape reads as into one more", () => {
    expect(PercentDecodedText.readableOf("%%41")).toBe("%A");
    expect(PercentDecodedText.readableOf("%2%41")).toBe("%2A");
    // Not read as ":": the "%" was written, not an escaped "%".
    expect(PercentDecodedText.readableOf("%%33A")).toBe("%3A");
    expect(PercentDecodedText.readableOf("100%%33A1")).toBe("100%3A1");
  });

  test("keeps the text as it is written", () => {
    const text: string = "a%3Ab";

    expect(PercentDecodedText.read(text)!.written).toBe(text);
  });
});

describe("where each part of the reading is written", () => {
  test("an encoded address is placed on its own characters, not the escaped brackets around it", () => {
    const text: string = "target=http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%2F";
    const read: PercentDecodedText = PercentDecodedText.read(text)!;

    expect(writtenOf(text, rangeOf(read, "2001:db8::1"))).toBe(
      "2001%3Adb8%3A%3A1",
    );
    expect(writtenOf(text, rangeOf(read, "[2001:db8::1]"))).toBe(
      "%5B2001%3Adb8%3A%3A1%5D",
    );
    expect(writtenOf(text, rangeOf(read, "target="))).toBe("target=");
    expect(writtenOf(text, rangeOf(read, "http://"))).toBe("http%3A%2F%2F");
  });

  test("an address that starts or ends with an escape is placed on it whole", () => {
    const text: string = "%32%30%30%31%3A%3A%31";
    const read: PercentDecodedText = PercentDecodedText.read(text)!;

    expect(read.rangeToWritten([0, read.readable.length])).toEqual([
      0,
      text.length,
    ]);
    expect(writtenOf(text, [0, 4])).toBe("%32%30%30%31");
    expect(writtenOf(text, [4, 6])).toBe("%3A%3A");
  });

  test("an address escaped twice is placed on all its characters", () => {
    const text: string =
      "to=http%253A%252F%252F%255B2001%253Adb8%253A%253A1%255D";
    const read: PercentDecodedText = PercentDecodedText.read(text)!;

    expect(read.readable).toBe("to=http://[2001:db8::1]");
    expect(writtenOf(text, rangeOf(read, "2001:db8::1"))).toBe(
      "2001%253Adb8%253A%253A1",
    );
  });

  test("every position of the reading is written in order, and the end is the text's end", () => {
    const texts: Array<string> = [
      "a%3Ab%2Fc",
      "%3A%3A%3A",
      "100% of %C3%A9 at %5B2001%3A%3A1%5D, %zz",
      "x%253Ay%25253Az",
      "%%41%2%41",
      "jos%C3%A9%40example.com",
      "a%F0%9F%98%80b%E2%82%AC",
      "%C3%C3%A9%E2%82x%E5%BC%A0",
    ];

    for (const text of texts) {
      const read: PercentDecodedText = PercentDecodedText.read(text)!;
      let previous: number = -1;

      for (
        let position: number = 0;
        position <= read.readable.length;
        position++
      ) {
        const written: number = read.toWritten(position);
        // Between a character's two UTF-16 units: placed after its escapes, as the next position is.
        const code: number = read.readable.charCodeAt(position - 1);
        const followsSecondHalf: boolean = code >= 0xdc00 && code <= 0xdfff;

        if (followsSecondHalf) {
          expect(written).toBeGreaterThanOrEqual(previous);
        } else {
          expect(written).toBeGreaterThan(previous);
        }

        expect(written).toBeLessThanOrEqual(text.length);
        previous = written;
      }

      expect(read.toWritten(read.readable.length)).toBe(text.length);
      expect(read.toWritten(0)).toBe(0);
    }
  });

  test("each character of the reading is what its written characters read", () => {
    const texts: Array<string> = [
      "target=http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%2F",
      "x%253Ay%25253Az",
      "100% of %C3%A9 at %5B2001%3A%3A1%5D, %zz",
      "name=Jos%C3%A9%20Garc%C3%ADa%2C%E5%BC%A0%E4%BC%9F",
    ];

    for (const text of texts) {
      const read: PercentDecodedText = PercentDecodedText.read(text)!;

      for (
        let position: number = 0;
        position < read.readable.length;
        position++
      ) {
        const [start, end] = read.rangeToWritten([position, position + 1]);

        expect(PercentDecodedText.readableOf(text.slice(start, end))).toBe(
          read.readable[position],
        );
      }
    }
  });

  test("a whole character beyond U+FFFF reads as itself from its written escapes", () => {
    const text: string = "%F0%9F%98%80%F0%9F%98%81";
    const read: PercentDecodedText = PercentDecodedText.read(text)!;

    for (const [start, end] of [
      [0, 2],
      [2, 4],
    ] as Array<[number, number]>) {
      const [writtenStart, writtenEnd] = read.rangeToWritten([start, end]);

      expect(
        PercentDecodedText.readableOf(text.slice(writtenStart, writtenEnd)),
      ).toBe(read.readable.slice(start, end));
    }
  });
});

describe("in time in line with the text's length", () => {
  const LENGTH: number = 400_000;
  const LIMIT_IN_MS: number = 2000;

  function repeat(unit: string): string {
    return unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH);
  }

  test.each([
    ["escapes without end", repeat("%3A")],
    ["percent signs without end", repeat("%")],
    ["half escapes without end", repeat("%3")],
    ["escapes escaped again without end", repeat("%253A")],
    ["escapes of bytes beyond ASCII without end", repeat("%C3%A9")],
    ["four-byte characters without end", repeat("%F0%9F%98%80")],
    ["lead bytes without end", repeat("%F0")],
    ["characters cut short without end", repeat("%F0%9F%98")],
    ["continuation bytes without end", repeat("%80")],
    ["UTF-8 escaped twice without end", repeat("%25C3%25A9")],
    [
      "an encoded URL again and again",
      repeat("http%3A%2F%2F%5B2001%3A%3A1%5D%2F "),
    ],
  ])("reads %s", (_label: string, text: string) => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        const read: PercentDecodedText | null = PercentDecodedText.read(text);

        return read ? read.toWritten(read.readable.length) : text.length;
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    expect(timed.result).toBe(text.length);
  });
});
