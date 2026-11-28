import { describe, expect, test } from "@jest/globals";
import ToolResultSerializer, {
  SerializedResult,
} from "../../../../../Server/Utils/AI/Toolbox/Serializer";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../../../Utils/DataSecurity/TextScanner";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * WHAT OneUptime AI's TOOLS SEND THE MODEL: A NATIONAL NUMBER IN ITS GROUPS
 * BESIDE ITS WORD IS HIDDEN (#11493), AND A UNIX TIME OR A SIZE AFTER CALL,
 * CELL OR CONTACT IS KEPT (#11496).
 *
 * A tool result hides the phone numbers Data Security's own detectors find
 * (#11384). Those missed a national number written in the groups its
 * country writes - tel 03-1234-5678, phone 020 3123 4567 - which reached
 * the model as it was, and took nine to twelve digits after call, cell or
 * contact for one, so a Unix time after "call started at" or a size after
 * "cell" reached it as [redacted-phone] and the model lost the time. Now a
 * number in its groups beside its word is hidden, and call, cell and
 * contact name a number only in a phrase - call me on, cell number,
 * contact number - or before a number with its trunk prefix.
 * ---------------------------------------------------------------------------
 */

function redacted(text: string): string {
  return ToolResultSerializer.redact(text).text;
}

function phonesIn(text: string): Array<string> {
  return findSensitiveValues(text)
    .filter((match: TextMatch): boolean => {
      return match.dataTypeId === "phone-number";
    })
    .map((match: TextMatch): string => {
      return text.slice(match.start, match.end);
    });
}

describe("a national number in its groups beside its word is hidden (#11493)", () => {
  test.each([
    ["Tokyo, by hyphens", "tel 03-1234-5678 ok", "tel [redacted-phone] ok"],
    [
      "London, by spaces",
      "phone 020 3123 4567 ok",
      "phone [redacted-phone] ok",
    ],
    [
      "Paris, by dots",
      "mobile 06.12.34.56.78 ok",
      "mobile [redacted-phone] ok",
    ],
    [
      "Berlin, two groups",
      "telephone 030 12345678 ok",
      "telephone [redacted-phone] ok",
    ],
    [
      "Sydney, its area code in parentheses",
      "phone (02) 1234 5678 ok",
      "phone [redacted-phone] ok",
    ],
    [
      "after its word and a colon",
      "Tel.: 020 3123 4567",
      "Tel.: [redacted-phone]",
    ],
    [
      "typed in fullwidth",
      "tel ０３－１２３４－５６７８",
      "tel [redacted-phone]",
    ],
  ])("%s: %s", (_label: string, text: string, left: string) => {
    expect(redacted(text)).toBe(left);
  });

  test.each([
    ["a date", "tel 2026-11-28 ok"],
    ["a date and a time", "tel 2026-11-28 10:30:00 ok"],
    ["a version", "tel version 1.2.3 ok"],
    ["an IPv4 address", "tel 192.168.100.200 ok"],
    ["a range of pages", "phone pages 10-20 ok"],
    ["groups beside no word that names them", "order 03-1234-5678 ok"],
    ["groups beside a word inside another", "hotel 03-1234-5678 ok"],
    ["groups that run on past a number", "tel 020 3123 4567 8901 ok"],
  ])("keeps %s: %s", (_label: string, text: string) => {
    expect(redacted(text)).toBe(text);
    expect(phonesIn(text)).toEqual([]);
  });

  test("a row's field named for a phone hides its number in groups too, and a field named for nothing keeps it", () => {
    expect(
      ToolResultSerializer.serializeRows([
        { phone: "03-1234-5678", order: "03-1234-5678" },
      ]).text,
    ).toBe("- phone=[redacted-phone] | order=03-1234-5678");
  });

  test("each number hidden is counted as one redaction", () => {
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      "tel 03-1234-5678, then phone 020 3123 4567",
    );

    expect(result.count).toBe(2);
    expect(result.text).toBe(
      "tel [redacted-phone], then phone [redacted-phone]",
    );
  });
});

describe("call, cell and contact name a number only with more (#11496)", () => {
  test.each([
    ["a Unix time after call", "call started at 1732752000 ok"],
    ["a Unix time just after call", "call 1732752000 ok"],
    [
      "a Unix time in milliseconds after call",
      "call started at 1732752000123 ok",
    ],
    ["a size in bytes after cell", "cell 104857600 bytes"],
    ["a count after cell", "cell: 201234567"],
    ["an id after contact", "contact 123456789012 created"],
    ["an id in JSON after contact", '{"contact": 482910374615}'],
  ])("keeps %s: %s", (_label: string, text: string) => {
    expect(redacted(text)).toBe(text);
    expect(phonesIn(text)).toEqual([]);
  });

  test.each([
    [
      "after call me on",
      "please call me on 2012345678 tomorrow",
      "please call me on [redacted-phone] tomorrow",
    ],
    [
      "after call us at",
      "call us at 2012345678",
      "call us at [redacted-phone]",
    ],
    [
      "after contact number",
      "contact number: 612345678",
      "contact number: [redacted-phone]",
    ],
    [
      "after cell number",
      "cell number: 201234567",
      "cell number: [redacted-phone]",
    ],
    [
      "with its trunk prefix after call",
      "call 02031234567 now",
      "call [redacted-phone] now",
    ],
    [
      "in groups with its trunk prefix after contact",
      "contact: 03-1234-5678",
      "contact: [redacted-phone]",
    ],
  ])("hides one %s: %s", (_label: string, text: string, left: string) => {
    expect(redacted(text)).toBe(left);
  });

  test("a log row of a call keeps its time and its duration", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { body: "call started at 1732752000", durationNano: 2012345678 },
    ]);

    expect(result.text).toBe(
      "- body=call started at 1732752000 | durationNano=2012345678",
    );
    expect(result.redactionCount).toBe(0);
  });

  test("and loses the number a row asks to be called back on", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { body: "customer asked: call me on 2012345678" },
    ]);

    expect(result.text).toBe(
      "- body=customer asked: call me on [redacted-phone]",
    );
    expect(result.redactionCount).toBe(1);
  });
});

/*
 * 400,000 characters of each awkward text - digit groups without end
 * beside a phone word, call and cell before digits without end - read
 * under two seconds (Tests/Helpers/FastestRun).
 */
const LENGTH: number = 400_000;
const LIMIT_IN_MS: number = 2000;

function repeat(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

describe("a tool result of national numbers and call words reads in time in line with its length", () => {
  test.each([
    [
      "groups of two without end after a phone word",
      "tel " + repeat("12 ", LENGTH),
    ],
    [
      "hyphenated groups without end after a phone word",
      "tel " + repeat("12-", LENGTH),
    ],
    [
      "national numbers in groups back to back",
      repeat("tel 03-1234-5678 ", LENGTH),
    ],
    ["call before Unix times back to back", repeat("call 1732752000 ", LENGTH)],
    [
      "call me on before numbers back to back",
      repeat("call me on 2012345678 ", LENGTH),
    ],
    ["cell words without end", repeat("cell ", LENGTH)],
    ["contact before digits without end", "contact " + repeat("4", LENGTH)],
  ])("%s", (_label: string, text: string) => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return ToolResultSerializer.redact(text).count;
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
  });
});
