import { describe, expect, test } from "@jest/globals";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import {
  EMAIL_ADDRESS_DETECTORS,
  IP_ADDRESS_DETECTORS,
} from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { CARD_NUMBER_DETECTORS } from "../../../Utils/DataSecurity/Detectors/FinancialDetectors";
import {
  acceptedRangesIn,
  findDetectorRanges,
  findInEveryReading,
  mergeRanges,
  passesQuickCheck,
  TextRange,
  TextReading,
  TextReadings,
} from "../../../Utils/DataSecurity/TextReadings";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import ScrubIpAddress from "../../../Utils/Telemetry/ScrubIpAddress";

/*
 * THE ONE FUNCTION EVERY RULE BUILT ON THE DETECTORS FINDS WITH.
 *
 * A text is read as written, and - for a detector that asks - with its
 * percent-escapes read (#10467, #10935) and with every script's digits
 * read by their values (#10960), each match placed on the characters the
 * text writes it with. The scanner reads a window the same ways, so what
 * findDetectorRanges hides is what the scanner finds.
 */

function textsOf(text: string, ranges: Array<TextRange>): Array<string> {
  return ranges.map(([start, end]: TextRange): string => {
    return text.slice(start, end);
  });
}

describe("TextReadings", () => {
  test("reads a text as written alone for a detector that asks for nothing more", () => {
    const readings: TextReadings = new TextReadings("u=jane%40acme.io ٤١");
    const read: Array<TextReading> = readings.readingsFor({});

    expect(read).toHaveLength(1);
    expect(read[0]).toBe(readings.written);
    expect(read[0]!.text).toBe("u=jane%40acme.io ٤١");
    expect(read[0]!.toWritten(5)).toBe(5);
  });

  test("adds the percent-decoded reading, whose positions are placed where they are written", () => {
    const readings: TextReadings = new TextReadings("u=jane%40acme.io");
    const read: Array<TextReading> = readings.readingsFor({
      readsPercentEncoded: true,
    });

    expect(
      read.map((reading: TextReading) => {
        return reading.text;
      }),
    ).toEqual(["u=jane%40acme.io", "u=jane@acme.io"]);
    // "@" is read at 6, and written at 6 as "%40"; "a" after it at 7, written at 9.
    expect(read[1]!.toWritten(6)).toBe(6);
    expect(read[1]!.toWritten(7)).toBe(9);
    expect(read[1]!.toWritten(14)).toBe(16);
  });

  test("adds each script's digits alone and all of them together, as long as the text", () => {
    const text: string = "card ４１１１ １１１１ １１１１ １１１１ 7";
    const readings: TextReadings = new TextReadings(text);
    const read: Array<TextReading> = readings.readingsFor({
      readsDigitsOfEveryScript: true,
    });

    expect(
      read.map((reading: TextReading) => {
        return reading.text;
      }),
    ).toEqual([
      text,
      "card 4111 1111 1111 1111 \u0000",
      "card 4111 1111 1111 1111 7",
    ]);

    for (const reading of read) {
      expect(reading.text).toHaveLength(text.length);
      expect(reading.toWritten(7)).toBe(7);
    }
  });

  test("reads each kind once, whoever asks", () => {
    const readings: TextReadings = new TextReadings("a%3Ab ４");

    expect(readings.getPercentDecoded()).toBe(readings.getPercentDecoded());
    expect(readings.getDigitsOfEveryScript()).toBe(
      readings.getDigitsOfEveryScript(),
    );
    expect(readings.getDigitsOfEveryScriptPercentDecoded()).toBe(
      readings.getDigitsOfEveryScriptPercentDecoded(),
    );
    /*
     * As written, decoded, every script's digits together - one fullwidth
     * digit holds no run of its own - and the decoded text's digits too.
     */
    expect(
      readings
        .readingsFor({
          readsPercentEncoded: true,
          readsDigitsOfEveryScript: true,
        })
        .map((reading: TextReading): string => {
          return reading.text;
        }),
    ).toEqual(["a%3Ab ４", "a:b ４", "a%3Ab 4", "a:b 4"]);
  });

  test("a digit of another script escaped in UTF-8 is read by its value, and placed on its escapes (#11032)", () => {
    const text: string = "tel=%EF%BC%94%EF%BC%95 x";
    const readings: TextReadings = new TextReadings(text);
    const [reading] = readings.getDigitsOfEveryScriptPercentDecoded();

    expect(reading!.text).toBe("tel=45 x");
    expect(text.slice(reading!.toWritten(4), reading!.toWritten(6))).toBe(
      "%EF%BC%94%EF%BC%95",
    );
    // Only a detector that reads both is read so.
    expect(
      readings
        .readingsFor({ readsPercentEncoded: true })
        .map((each: TextReading): string => {
          return each.text;
        }),
    ).toEqual([text, "tel=４５ x"]);
    expect(
      readings
        .readingsFor({ readsDigitsOfEveryScript: true })
        .map((each: TextReading): string => {
          return each.text;
        }),
    ).toEqual([text]);
  });

  test("has no other reading of a text with no escape and no digit beyond ASCII", () => {
    const readings: TextReadings = new TextReadings("plain 4111 text");

    expect(readings.getPercentDecoded()).toBeNull();
    expect(readings.getDigitsOfEveryScript()).toEqual([]);
    expect(
      readings.readingsFor({
        readsPercentEncoded: true,
        readsDigitsOfEveryScript: true,
      }),
    ).toEqual([readings.written]);
  });
});

describe("mergeRanges", () => {
  test("sorts ranges, makes those that overlap one, and keeps those that only touch apart", () => {
    expect(
      mergeRanges([
        [10, 14],
        [0, 3],
        [2, 5],
        [5, 7],
        [11, 12],
        [20, 21],
      ]),
    ).toEqual([
      [0, 5],
      [5, 7],
      [10, 14],
      [20, 21],
    ]);
    expect(mergeRanges([])).toEqual([]);
    expect(mergeRanges([[3, 4]])).toEqual([[3, 4]]);
  });

  test("never changes the ranges it is handed", () => {
    const ranges: Array<TextRange> = [
      [0, 3],
      [2, 5],
    ];

    mergeRanges(ranges);

    expect(ranges).toEqual([
      [0, 3],
      [2, 5],
    ]);
  });
});

describe("findInEveryReading", () => {
  const atSigns: (reading: string) => Array<TextRange> = (
    reading: string,
  ): Array<TextRange> => {
    const found: Array<TextRange> = [];

    for (
      let at: number = reading.indexOf("@");
      at !== -1;
      at = reading.indexOf("@", at + 1)
    ) {
      found.push([at, at + 1]);
    }

    return found;
  };

  test("places what a reading finds on the characters the text writes it with", () => {
    const text: string = "a@b c%40d e%2540f";

    expect(
      textsOf(
        text,
        findInEveryReading({
          text,
          needs: { readsPercentEncoded: true },
          findIn: atSigns,
        }),
      ),
    ).toEqual(["@", "%40", "%2540"]);
  });

  test("reads only what it is asked to", () => {
    const text: string = "a@b c%40d";

    expect(
      textsOf(text, findInEveryReading({ text, needs: {}, findIn: atSigns })),
    ).toEqual(["@"]);
    expect(
      findInEveryReading({ text: "", needs: {}, findIn: atSigns }),
    ).toEqual([]);
  });
});

describe("acceptedRangesIn", () => {
  const ipv4: DataTypeDetector = IP_ADDRESS_DETECTORS[1]!;

  test("keeps the candidates the detector's validator accepts", () => {
    const text: string = "8.8.8.8 and 10.0.0.1 and 203.0.113.7";

    expect(textsOf(text, acceptedRangesIn(ipv4, text))).toEqual([
      "8.8.8.8",
      "203.0.113.7",
    ]);
  });

  test("asks the quick check first", () => {
    expect(passesQuickCheck(ipv4, "no dots here")).toBe(false);
    expect(acceptedRangesIn(ipv4, "no dots here")).toEqual([]);
    expect(acceptedRangesIn(ipv4, "")).toEqual([]);
  });

  test("places a value group's candidate on the group", () => {
    const detector: DataTypeDetector = {
      dataTypeId: "x",
      pattern: /key=([0-9]{3})/g,
      valueGroup: 1,
      confidenceWithoutContext: ipv4.confidenceWithoutContext,
      specificity: 1,
    };
    const text: string = "a key=123 b";

    expect(textsOf(text, acceptedRangesIn(detector, text))).toEqual(["123"]);
  });
});

describe("findDetectorRanges", () => {
  test("is what an IP Address rule hides, ScrubIpAddress.findRanges", () => {
    for (const text of [
      "client 8.8.8.8 and 2001:db8::1 and 10.0.0.1",
      "u=http%3A%2F%2F%5B2606%3A4700%3A%3A1111%5D%2F peer ip:2a00:1450::1",
      "remote:2a00:1450:4001:82a::200e src:2001:db8::7 time:12:30:45",
    ]) {
      expect(findDetectorRanges(IP_ADDRESS_DETECTORS, text)).toEqual(
        ScrubIpAddress.findRanges(text),
      );
    }
  });

  test("finds an email address percent-encoded or in any script, on its written characters", () => {
    const text: string =
      "GET /signup?email=jane.doe%40acmecorp.io to=张伟@acmecorp.io cc=почта@пример.рф";

    expect(
      textsOf(text, findDetectorRanges(EMAIL_ADDRESS_DETECTORS, text)),
    ).toEqual([
      "jane.doe%40acmecorp.io",
      "张伟@acmecorp.io",
      "почта@пример.рф",
    ]);
  });

  test("finds a card in any script's digits, alone or mixed, on its written characters", () => {
    const text: string =
      "a ４５３２ ０１５１ １２８３ ０３６６ b ٤٥٣٢٠١٥١١٢٨٣٠٣٦٦ c ４５３２ 0151 1283 0366";

    expect(
      textsOf(text, findDetectorRanges(CARD_NUMBER_DETECTORS, text)),
    ).toEqual([
      "４５３２ ０１５１ １２８３ ０３６６",
      "٤٥٣٢٠١٥١١٢٨٣٠٣٦٦",
      "４５３２ 0151 1283 0366",
    ]);
  });

  test("hides every finding the scanner makes of the same detectors, and nothing it does not", () => {
    for (const [detectors, text] of [
      [
        EMAIL_ADDRESS_DETECTORS,
        "to jane@acme.io, 张伟@acme.io, jane.doe%40acmecorp.io, logo@2x.png, 邮箱jane@acme.io已发送",
      ],
      [
        CARD_NUMBER_DETECTORS,
        "４１１１ １１１１ １１１１ １１１２ ٤٥٣٢٠١٥١١٢٨٣٠٣٦٦ 4532015112830366 ۴۵۳۲۰۱۵۱۱۲۸۳۰۳۶۶١",
      ],
    ] as Array<[ReadonlyArray<DataTypeDetector>, string]>) {
      const ranges: Array<TextRange> = findDetectorRanges(detectors, text);
      const found: Array<TextMatch> = findSensitiveValues(text, {
        detectors,
      });

      expect(found.length).toBeGreaterThan(0);

      for (const match of found) {
        expect({
          finding: text.slice(match.start, match.end),
          hidden: ranges.some(([start, end]: TextRange): boolean => {
            return start <= match.start && match.end <= end;
          }),
        }).toEqual({
          finding: text.slice(match.start, match.end),
          hidden: true,
        });
      }

      for (const [start, end] of ranges) {
        expect({
          hidden: text.slice(start, end),
          found: found.some((match: TextMatch): boolean => {
            return start <= match.start && match.end <= end;
          }),
        }).toEqual({ hidden: text.slice(start, end), found: true });
      }
    }
  });

  test("shares a text's readings with another finder", () => {
    const text: string = "u=jane%40acme.io";
    const readings: TextReadings = new TextReadings(text);

    expect(findDetectorRanges(EMAIL_ADDRESS_DETECTORS, text, readings)).toEqual(
      findDetectorRanges(EMAIL_ADDRESS_DETECTORS, text),
    );
    expect(readings.getPercentDecoded()).not.toBeNull();
    expect(findDetectorRanges(EMAIL_ADDRESS_DETECTORS, "")).toEqual([]);
  });
});
