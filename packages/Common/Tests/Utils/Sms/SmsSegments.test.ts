import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import {
  countSmsSegments,
  fitsInSmsSegments,
  getGsm7Length,
  getSmsEncoding,
  GSM_7_BASIC_CHARACTERS,
  GSM_7_EXTENSION_CHARACTERS,
  GSM_7_MULTI_SEGMENT_LENGTH,
  GSM_7_SINGLE_SEGMENT_LENGTH,
  isGsm7Text,
  SmsEncoding,
  SmsSegmentCount,
  UCS_2_MULTI_SEGMENT_LENGTH,
  UCS_2_SINGLE_SEGMENT_LENGTH,
} from "../../../Utils/Sms/SmsSegments";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * HOW MANY PARTS AN SMS GOES OUT IN (Utils/Sms/SmsSegments).
 *
 * Every part is billed. A part holds 160 GSM-7 characters - an extension
 * character (^ { } \ [ ~ ] | € and form feed) taking two - or 70 UCS-2 code
 * units, and one character outside GSM-7 makes the whole text UCS-2. A
 * longer text goes out in parts of 153 or 67, and no part ends inside an
 * extension character's escape or inside a character beyond the Basic
 * Multilingual Plane.
 */

const CYRILLIC_ZHE: string = "\u{0436}";
const GRINNING_FACE: string = "\u{1F600}";
const RIGHT_SINGLE_QUOTE: string = "\u{2019}";

describe("the parts' sizes", () => {
  test("are the GSM 03.38 and UCS-2 ones Twilio bills by", () => {
    expect(GSM_7_SINGLE_SEGMENT_LENGTH).toBe(160);
    expect(GSM_7_MULTI_SEGMENT_LENGTH).toBe(153);
    expect(UCS_2_SINGLE_SEGMENT_LENGTH).toBe(70);
    expect(UCS_2_MULTI_SEGMENT_LENGTH).toBe(67);
  });
});

describe("the GSM 7-bit alphabet", () => {
  const basic: Array<string> = Array.from(GSM_7_BASIC_CHARACTERS);
  const extension: Array<string> = Array.from(GSM_7_EXTENSION_CHARACTERS);

  test("has the 127 characters of the basic table (128 less the escape) and the 10 of the extension table", () => {
    expect(basic.length).toBe(127);
    expect(new Set(basic).size).toBe(127);
    expect(extension.length).toBe(10);
    expect(new Set(extension).size).toBe(10);
    expect(
      extension.filter((character: string): boolean => {
        return basic.includes(character);
      }),
    ).toEqual([]);
  });

  test("holds every printable ASCII character but the backtick", () => {
    const missing: Array<string> = [];

    for (let code: number = 0x20; code <= 0x7e; code++) {
      const character: string = String.fromCharCode(code);

      if (getGsm7Length(character) === null) {
        missing.push(character);
      }
    }

    expect(missing).toEqual(["`"]);
  });

  test.each([
    ["a", 1],
    ["Z", 1],
    ["0", 1],
    ["@", 1],
    ["£", 1],
    ["é", 1],
    ["Ç", 1],
    ["ß", 1],
    ["Δ", 1],
    ["\n", 1],
    ["\r", 1],
    ["€", 2],
    ["{", 2],
    ["}", 2],
    ["[", 2],
    ["]", 2],
    ["~", 2],
    ["^", 2],
    ["|", 2],
    ["\\", 2],
    ["\f", 2],
  ])("%j takes %d place(s)", (character: string, places: number) => {
    expect(getGsm7Length(character)).toBe(places);
  });

  test.each([
    ["`"],
    ["\t"],
    ["ç"],
    ["á"],
    ["ł"],
    [RIGHT_SINGLE_QUOTE],
    ["\u{201C}"],
    ["\u{2013}"],
    ["\u{2026}"],
    ["\u{00A0}"],
    [CYRILLIC_ZHE],
    ["\u{6C7A}"],
    [GRINNING_FACE],
  ])("%j is not in it", (character: string) => {
    expect(getGsm7Length(character)).toBeNull();
  });
});

describe("the encoding", () => {
  test("is GSM-7 while every character is one of its", () => {
    expect(isGsm7Text("")).toBe(true);
    expect(isGsm7Text("Checkout API is down [eu-west-1] {50%} 5€")).toBe(true);
    expect(getSmsEncoding("Checkout API is down.")).toBe(SmsEncoding.Gsm7);
  });

  test("is UCS-2 for the whole text once a single character is not", () => {
    expect(isGsm7Text(`Checkout${RIGHT_SINGLE_QUOTE}s API is down.`)).toBe(
      false,
    );
    expect(getSmsEncoding(`${"a".repeat(500)}${GRINNING_FACE}`)).toBe(
      SmsEncoding.Ucs2,
    );
  });
});

describe("countSmsSegments in GSM-7", () => {
  const count: (text: string) => SmsSegmentCount = countSmsSegments;

  test("an empty text is still one part", () => {
    expect(count("")).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 0,
      segments: 1,
    });
  });

  test.each([
    [1, 1],
    [159, 1],
    [160, 1],
    [161, 2],
    [306, 2],
    [307, 3],
    [459, 3],
    [460, 4],
    [1530, 10],
    [1531, 11],
  ])(
    "%d plain characters go out in %d part(s)",
    (length: number, parts: number) => {
      expect(count("a".repeat(length))).toEqual({
        encoding: SmsEncoding.Gsm7,
        length: length,
        segments: parts,
      });
    },
  );

  test("an extension character takes two places", () => {
    expect(count("{".repeat(80)).length).toBe(160);
    expect(count("{".repeat(80)).segments).toBe(1);
    expect(count("{".repeat(81)).length).toBe(162);
    expect(count("{".repeat(81)).segments).toBe(2);
    expect(count(`${"a".repeat(158)}€`)).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 160,
      segments: 1,
    });
    expect(count(`${"a".repeat(159)}€`).segments).toBe(2);
  });

  test("a part never ends between an extension character's escape and the character", () => {
    // 306 places would be two parts of 153, but 76 pairs fill a part (152).
    expect(count("{".repeat(153))).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 306,
      segments: 3,
    });
    // 152 plain, then a pair that does not fit in the first part's last place.
    expect(count(`${"a".repeat(152)}[${"a".repeat(151)}`).segments).toBe(2);
    expect(count(`${"a".repeat(152)}[${"a".repeat(152)}`).segments).toBe(3);
  });

  test("the issue's page text of 14.0.76 took two parts", () => {
    const text: string =
      "This is a message from OneUptime. A new incident has been created: INC-21033 (API is down). To acknowledge this incident, or pass it on if you can't take it, please click on the following link https://oneuptime.com/l/XJlaZRsd";

    expect(text.length).toBe(225);
    expect(count(text)).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 225,
      segments: 2,
    });
  });
});

describe("countSmsSegments in UCS-2", () => {
  test.each([
    [1, 1],
    [70, 1],
    [71, 2],
    [134, 2],
    [135, 3],
    [201, 3],
    [202, 4],
  ])(
    "%d Cyrillic letters go out in %d part(s)",
    (length: number, parts: number) => {
      expect(countSmsSegments(CYRILLIC_ZHE.repeat(length))).toEqual({
        encoding: SmsEncoding.Ucs2,
        length: length,
        segments: parts,
      });
    },
  );

  test("one character outside GSM-7 makes a short text take two parts", () => {
    expect(countSmsSegments("a".repeat(100)).segments).toBe(1);
    expect(countSmsSegments(`${"a".repeat(99)}${RIGHT_SINGLE_QUOTE}`)).toEqual({
      encoding: SmsEncoding.Ucs2,
      length: 100,
      segments: 2,
    });
  });

  test("an extension character is one code unit in UCS-2, as any other", () => {
    expect(countSmsSegments(`{}${CYRILLIC_ZHE}`)).toEqual({
      encoding: SmsEncoding.Ucs2,
      length: 3,
      segments: 1,
    });
  });

  test("a character beyond the Basic Multilingual Plane takes two places", () => {
    expect(countSmsSegments(GRINNING_FACE.repeat(35))).toEqual({
      encoding: SmsEncoding.Ucs2,
      length: 70,
      segments: 1,
    });
    expect(countSmsSegments(GRINNING_FACE.repeat(36)).segments).toBe(2);
  });

  test("and is never split between two parts", () => {
    // 134 units would be two parts of 67, but 33 emoji fill a part (66).
    expect(countSmsSegments(GRINNING_FACE.repeat(67))).toEqual({
      encoding: SmsEncoding.Ucs2,
      length: 134,
      segments: 3,
    });
  });
});

describe("fitsInSmsSegments", () => {
  test("says whether the text goes out in that many parts or fewer", () => {
    expect(fitsInSmsSegments("a".repeat(160), 1)).toBe(true);
    expect(fitsInSmsSegments("a".repeat(161), 1)).toBe(false);
    expect(fitsInSmsSegments("a".repeat(161), 2)).toBe(true);
    expect(fitsInSmsSegments(CYRILLIC_ZHE.repeat(71), 1)).toBe(false);
    expect(fitsInSmsSegments(CYRILLIC_ZHE.repeat(71), 2)).toBe(true);
  });
});

describe("on texts drawn at random", () => {
  const ALPHABET: ReadonlyArray<string> = [
    "a",
    "Z",
    " ",
    ".",
    "é",
    "{",
    "€",
    "\n",
    CYRILLIC_ZHE,
    RIGHT_SINGLE_QUOTE,
    GRINNING_FACE,
    "\u{6C7A}",
  ];

  const drawText: (random: SeededRandom, longest: number) => string = (
    random: SeededRandom,
    longest: number,
  ): string => {
    const length: number = random(longest + 1);
    let text: string = "";

    for (let index: number = 0; index < length; index++) {
      text += ALPHABET[random(ALPHABET.length)];
    }

    return text;
  };

  test("the places are each character's own, and the parts as many as they need", () => {
    const random: SeededRandom = seededRandom(5114);

    for (let round: number = 0; round < 2000; round++) {
      const text: string = drawText(random, 400);
      const counted: SmsSegmentCount = countSmsSegments(text);
      const isGsm7: boolean = isGsm7Text(text);
      const places: number = Array.from(text).reduce(
        (total: number, character: string): number => {
          return (
            total + (isGsm7 ? getGsm7Length(character)! : character.length)
          );
        },
        0,
      );

      expect(counted.encoding).toBe(
        isGsm7 ? SmsEncoding.Gsm7 : SmsEncoding.Ucs2,
      );
      expect(counted.length).toBe(places);

      const single: number = isGsm7
        ? GSM_7_SINGLE_SEGMENT_LENGTH
        : UCS_2_SINGLE_SEGMENT_LENGTH;
      const multi: number = isGsm7
        ? GSM_7_MULTI_SEGMENT_LENGTH
        : UCS_2_MULTI_SEGMENT_LENGTH;

      if (places <= single) {
        expect(counted.segments).toBe(1);
      } else {
        // At least what the places fill, at most one place short in each part.
        expect(counted.segments).toBeGreaterThanOrEqual(
          Math.ceil(places / multi),
        );
        expect(counted.segments).toBeLessThanOrEqual(
          Math.ceil(places / (multi - 1)),
        );
      }
    }
  });

  test("a longer text in the same encoding never takes fewer parts", () => {
    const random: SeededRandom = seededRandom(160);

    for (let round: number = 0; round < 2000; round++) {
      const text: string = drawText(random, 300);
      const longer: string = text + drawText(random, 30);

      if (getSmsEncoding(text) === getSmsEncoding(longer)) {
        expect(countSmsSegments(longer).segments).toBeGreaterThanOrEqual(
          countSmsSegments(text).segments,
        );
      }
    }
  });

  test("counts 400,000 characters at once quickly", () => {
    const text: string = `${"{a".repeat(100000)}${GRINNING_FACE.repeat(100000)}`;
    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const counted: FastestRun<SmsSegmentCount> = fastestRun({
      run: (): SmsSegmentCount => {
        return countSmsSegments(text);
      },
      limitInMs: 2000,
    });

    expect(counted.result.encoding).toBe(SmsEncoding.Ucs2);
    expect(counted.result.length).toBe(400000);
    expect(counted.inMs).toBeLessThan(2000);
  });
});
