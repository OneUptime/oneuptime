import { describe, expect, test } from "@jest/globals";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import {
  EMAIL_ADDRESS_DETECTORS,
  IP_ADDRESS_DETECTORS,
} from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { CARD_NUMBER_DETECTORS } from "../../../Utils/DataSecurity/Detectors/FinancialDetectors";
import {
  acceptedRangesIn,
  cutsAnEscape,
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
    expect(readings.getPlusAsSpace()).toBeNull();
    expect(readings.getDigitsOfEveryScript()).toEqual([]);
    expect(readings.getDigitsOfEveryScriptPlusAsSpace()).toEqual([]);
    expect(
      readings.readingsFor({
        readsPercentEncoded: true,
        readsDigitsOfEveryScript: true,
        readsPlusAsSpace: true,
      }),
    ).toEqual([readings.written]);
  });

  /*
   * #11199: a value typed into a form, its spaces written "+" in the URL's
   * query string - its groups apart by a character no pattern reads as a
   * group's end.
   */
  test("adds the reading of a URL's query string, a '+' for a space, for a detector that asks", () => {
    const text: string = "card=4539+1488+0343+6467&phone=%2B44+20";
    const readings: TextReadings = new TextReadings(text);
    const read: Array<TextReading> = readings.readingsFor({
      readsPercentEncoded: true,
      readsPlusAsSpace: true,
    });

    expect(
      read.map((reading: TextReading): string => {
        return reading.text;
      }),
    ).toEqual([
      text,
      "card=4539+1488+0343+6467&phone=+44+20",
      "card=4539 1488 0343 6467&phone=+44 20",
    ]);
    // "+" for a space is one character for one: a card's characters are where they are written.
    expect(read[2]!.toWritten(5)).toBe(5);
    expect(read[2]!.toWritten(24)).toBe(24);
    // The escaped "+" is read where its escape is: "%2B" starts at 31.
    expect(read[2]!.toWritten(31)).toBe(31);
    expect(read[2]!.toWritten(read[2]!.text.length)).toBe(text.length);
  });

  test("reads the query string's '+'s only for a detector that asks", () => {
    const readings: TextReadings = new TextReadings("iban=DE44+5001+0517");

    expect(
      readings
        .readingsFor({ readsPercentEncoded: true })
        .map((reading: TextReading): string => {
          return reading.text;
        }),
    ).toEqual(["iban=DE44+5001+0517"]);
    expect(
      readings
        .readingsFor({ readsPlusAsSpace: true })
        .map((reading: TextReading): string => {
          return reading.text;
        }),
    ).toEqual(["iban=DE44+5001+0517", "iban=DE44 5001 0517"]);
  });

  test("reads every script's digits in the query string's reading too, placed on its '+'s", () => {
    const text: string = "card=٤٥٣٩+١٤٨٨+٠٣٤٣+٦٤٦٧";
    const readings: TextReadings = new TextReadings(text);

    expect(readings.getPlusAsSpace()!.text).toBe("card=٤٥٣٩ ١٤٨٨ ٠٣٤٣ ٦٤٦٧");
    expect(
      readings.getDigitsOfEveryScriptPlusAsSpace().map((each: TextReading) => {
        return each.text;
      }),
    ).toEqual(["card=4539 1488 0343 6467"]);
    // Only a detector that reads both is read so.
    expect(
      readings
        .readingsFor({ readsDigitsOfEveryScript: true })
        .map((each: TextReading): string => {
          return each.text;
        }),
    ).toEqual([text, "card=4539+1488+0343+6467"]);
    expect(
      readings
        .readingsFor({ readsDigitsOfEveryScript: true, readsPlusAsSpace: true })
        .map((each: TextReading): string => {
          return each.text;
        }),
    ).toEqual([
      text,
      "card=٤٥٣٩ ١٤٨٨ ٠٣٤٣ ٦٤٦٧",
      "card=4539+1488+0343+6467",
      "card=4539 1488 0343 6467",
    ]);
  });

  test("reads each kind once, the query string's too", () => {
    const readings: TextReadings = new TextReadings("a+b ４+５");

    expect(readings.getPlusAsSpace()).toBe(readings.getPlusAsSpace());
    expect(readings.getDigitsOfEveryScriptPlusAsSpace()).toBe(
      readings.getDigitsOfEveryScriptPlusAsSpace(),
    );
  });

  test("reads a candidate's words as written, with its escapes read and as a query string writes them - every script's digits change no word", () => {
    const readings: TextReadings = new TextReadings(
      "date+of+birth=12%2F03%2F1985 ٤",
    );

    expect(
      readings
        .wordReadingsFor({
          readsPercentEncoded: true,
          readsPlusAsSpace: true,
          readsDigitsOfEveryScript: true,
        })
        .map((each: TextReading): string => {
          return each.text;
        }),
    ).toEqual([
      "date+of+birth=12%2F03%2F1985 ٤",
      "date+of+birth=12/03/1985 ٤",
      "date of birth=12/03/1985 ٤",
    ]);
    expect(
      readings.wordReadingsFor({ readsDigitsOfEveryScript: true }),
    ).toEqual([readings.written]);
  });

  /*
   * In a text a form wrote, a "+" is a space: read with its escapes alone,
   * "(718) 487-63058" - %28718%29+487-63058 - holds +487-63058, an
   * international number's shape. A detector that reads the query
   * string's reading finds its candidates there, and not there.
   */
  test("finds a detector's candidates as a form wrote the text, not with its escapes read alone", () => {
    const formText: string = "q=%28718%29+487-63058";
    const readings: TextReadings = new TextReadings(formText);
    const needs: {
      readsPercentEncoded: boolean;
      readsPlusAsSpace: boolean;
      readsDigitsOfEveryScript: boolean;
    } = {
      readsPercentEncoded: true,
      readsPlusAsSpace: true,
      readsDigitsOfEveryScript: true,
    };

    expect(
      readings.readingsFor(needs).map((each: TextReading): string => {
        return each.text;
      }),
    ).toEqual([formText, "q=(718)+487-63058", "q=(718) 487-63058"]);
    expect(
      readings.detectorReadingsFor(needs).map((each: TextReading): string => {
        return each.text;
      }),
    ).toEqual([formText, "q=(718) 487-63058"]);
    // A detector that reads no query string reads the escapes' reading still.
    expect(
      readings
        .detectorReadingsFor({ readsPercentEncoded: true })
        .map((each: TextReading): string => {
          return each.text;
        }),
    ).toEqual([formText, "q=(718)+487-63058"]);
  });

  test("keeps the escapes' reading where no form wrote the text: an escaped '+' may be a value's own", () => {
    // A centenarian's personnummer in a URL, its "+" escaped: as a flat query string reads it, and as one inside the URL.
    const text: string = "pnr=19991231%2B1234";
    const readings: TextReadings = new TextReadings(text);

    expect(
      readings
        .detectorReadingsFor({
          readsPercentEncoded: true,
          readsPlusAsSpace: true,
        })
        .map((each: TextReading): string => {
          return each.text;
        }),
    ).toEqual([text, "pnr=19991231+1234", "pnr=19991231 1234"]);
  });
});

describe("cutsAnEscape", () => {
  test("a range that starts or ends on an escape's hex digit cuts it", () => {
    const text: string = "q=%2212345678901%22&x=1";

    // 2212345678901: the quote's "22" first, glued to the value.
    expect(cutsAnEscape(text, 3, 16)).toBe(true);
    // 12345678901%2: the next escape's "%2" last.
    expect(cutsAnEscape(text, 5, 18)).toBe(true);
    expect(cutsAnEscape(text, 5, 17)).toBe(true);
  });

  test("a range of whole escapes and characters cuts none", () => {
    const text: string = "q=%2212345678901%22&x=1";

    expect(cutsAnEscape(text, 5, 16)).toBe(false);
    expect(cutsAnEscape(text, 2, 19)).toBe(false);
    expect(cutsAnEscape("4111%201111", 0, 11)).toBe(false);
    expect(cutsAnEscape("plain text", 0, 5)).toBe(false);
    // A "%" no escape follows is a percent sign.
    expect(cutsAnEscape("100%x 12", 4, 8)).toBe(false);
  });

  test("a card glued to an escape's digits as written is no card, to the scanner and the detectors' ranges alike", () => {
    // "22" of %22 and fourteen digits are sixteen as written: 2225..., a Mastercard's shape.
    const text: string = "q=%7B%22n%22%3A%2225042970296403%22%7D";

    expect(
      findSensitiveValues(text, { detectors: CARD_NUMBER_DETECTORS }),
    ).toEqual([]);
    expect(findDetectorRanges(CARD_NUMBER_DETECTORS, text)).toEqual([]);
  });

  test("an IP address glued to an escape is taken as written, by the scanner and its rule alike", () => {
    // 99%2001::1: a percent sign glued to an address, or an escape - read as written too (#10467).
    const text: string = "load 99%2001::1";

    expect(
      textsOf(text, findDetectorRanges(IP_ADDRESS_DETECTORS, text)),
    ).toEqual(["2001::1"]);
    expect(
      findSensitiveValues(text, { detectors: IP_ADDRESS_DETECTORS }).map(
        (match: TextMatch): string => {
          return text.slice(match.start, match.end);
        },
      ),
    ).toEqual(["2001::1"]);
  });

  test("a card the escapes' reading holds whole is found there, on its written characters", () => {
    const text: string = "q=%7B%22n%22%3A%224539148803436467%22%7D";

    expect(
      findSensitiveValues(text, { detectors: CARD_NUMBER_DETECTORS }).map(
        (match: TextMatch): string => {
          return text.slice(match.start, match.end);
        },
      ),
    ).toEqual(["4539148803436467"]);
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

  /*
   * #11199: a card in a URL, its groups apart by an escaped space, by the
   * "+" a query string writes a space as, or by that "+" escaped again in
   * a URL inside a query string - each found on every character it is
   * written with, its escapes and "+"s whole.
   */
  test("finds a card in a URL, %20 or '+' between its groups, on its written characters", () => {
    const form: string =
      "GET /pay?a=4539%201488%200343%206467&b=4539+1488+0343+6467&d=٤٥٣٩+١٤٨٨+٠٣٤٣+٦٤٦٧";

    expect(
      textsOf(form, findDetectorRanges(CARD_NUMBER_DETECTORS, form)),
    ).toEqual([
      "4539%201488%200343%206467",
      "4539+1488+0343+6467",
      "٤٥٣٩+١٤٨٨+٠٣٤٣+٦٤٦٧",
    ]);

    // In a URL inside the query string, the "+"s its own query string wrote escaped.
    const nested: string =
      "GET /login?next=%2Fpay%3Fc%3D4539%2B1488%2B0343%2B6467 HTTP/1.1";

    expect(
      textsOf(nested, findDetectorRanges(CARD_NUMBER_DETECTORS, nested)),
    ).toEqual(["4539%2B1488%2B0343%2B6467"]);
  });

  test("in a text a form wrote, an escaped '+' is the '+' it escaped: no card's groups apart", () => {
    const text: string = "GET /pay?q=a+b&c=4539%2B1488%2B0343%2B6467";

    expect(findDetectorRanges(CARD_NUMBER_DETECTORS, text)).toEqual([]);
  });

  test("finds no card a check digit off, however its groups are written", () => {
    for (const text of [
      "card=4539%201488%200343%206468",
      "card=4539+1488+0343+6468",
      "card=4539+1488+0343+64671",
      "sum=1234+5678+9012+3456",
    ]) {
      expect([text, findDetectorRanges(CARD_NUMBER_DETECTORS, text)]).toEqual([
        text,
        [],
      ]);
    }
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
