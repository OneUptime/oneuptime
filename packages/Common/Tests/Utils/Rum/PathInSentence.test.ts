import { describe, expect, test } from "@jest/globals";
import {
  isPathSetApartInSentence,
  PATH_DIRECTION_SCAN_LENGTH,
  PATH_LEFT_TO_RIGHT_ISOLATE,
  PATH_POP_DIRECTIONAL_ISOLATE,
  setPathApartInSentence,
} from "../../../Utils/Rum/PathInSentence";
import { LEFT_TO_RIGHT_ISOLATE } from "../../../Types/CodeInSentence";
import {
  isSetApartInSentence,
  LEFT_TO_RIGHT,
  POP_DIRECTIONAL_ISOLATE,
  TEXT_DIRECTION_SCAN_LENGTH,
} from "../../../Types/ReadingDirection";

/*
 * The Rum modules' copy of the rule that sets a path apart in a sentence
 * read from the left. A module in Common/{Utils,Types}/Rum imports nothing
 * from the rest of Common (the browser recorder inlines them), so the rule
 * is written out there; these tests hold it to Types/ReadingDirection's
 * isSetApartInSentence(path, LEFT_TO_RIGHT) and Types/CodeInSentence's
 * marks, so a script added to one cannot be missing from the other.
 */
describe("a path in a sentence read from the left", () => {
  const LAST_CODE_POINT: number = 0x10ffff;

  test("uses the reading-direction helpers' marks and scan length", () => {
    expect(PATH_LEFT_TO_RIGHT_ISOLATE).toBe(LEFT_TO_RIGHT_ISOLATE);
    expect(PATH_POP_DIRECTIONAL_ISOLATE).toBe(POP_DIRECTIONAL_ISOLATE);
    expect(PATH_DIRECTION_SCAN_LENGTH).toBe(TEXT_DIRECTION_SCAN_LENGTH);
  });

  test("sets a character apart exactly when the reading-direction rule does, for every code point", () => {
    const disagreements: Array<string> = [];
    let setApartCount: number = 0;

    for (let codePoint: number = 0; codePoint <= LAST_CODE_POINT; codePoint++) {
      const character: string = String.fromCodePoint(codePoint);
      const isSetApart: boolean = isPathSetApartInSentence(character);

      if (isSetApart !== isSetApartInSentence(character, LEFT_TO_RIGHT)) {
        disagreements.push(`U+${codePoint.toString(16).toUpperCase()}`);
      }

      setApartCount += isSetApart ? 1 : 0;
    }

    expect(disagreements).toEqual([]);
    // Thousands of letters, of every script on the list, are set apart.
    expect(setApartCount).toBeGreaterThan(1000);
  });

  test("sets apart a letter of each script read from the right, and nothing else", () => {
    const setApart: Array<string> = [
      // Arabic, and the Tatweel Arabic stretches its words with.
      "ب",
      String.fromCodePoint(0x0640),
      // Hebrew, Syriac, Thaana, N'Ko, Samaritan, Mandaic.
      String.fromCodePoint(0x05d0),
      String.fromCodePoint(0x0710),
      String.fromCodePoint(0x0780),
      String.fromCodePoint(0x07ca),
      String.fromCodePoint(0x0800),
      String.fromCodePoint(0x0840),
      // Adlam and Hanifi Rohingya, outside the Basic Multilingual Plane.
      String.fromCodePoint(0x1e900),
      String.fromCodePoint(0x10d00),
    ];

    for (const character of setApart) {
      expect(isPathSetApartInSentence(`/a${character}`)).toBe(true);
    }

    const keptAsWritten: Array<string> = [
      "/café",
      "/製品",
      "/हिन्दी",
      // Arabic's digits and comma are no letters.
      `/${String.fromCodePoint(0x0663)}`,
      `/${String.fromCodePoint(0x060c)}`,
      "",
    ];

    for (const path of keptAsWritten) {
      expect(isPathSetApartInSentence(path)).toBe(false);
    }
  });

  test("reads only the start of a path, as the reading-direction rule does", () => {
    const paths: Array<string> = [
      // The last letter read is Arabic.
      `/${"a".repeat(PATH_DIRECTION_SCAN_LENGTH - 2)}ب`,
      // The first letter not read is.
      `/${"a".repeat(PATH_DIRECTION_SCAN_LENGTH - 1)}ب`,
      // An Adlam letter cut in two by the end of what is read.
      `/${"a".repeat(PATH_DIRECTION_SCAN_LENGTH - 2)}${String.fromCodePoint(0x1e900)}`,
    ];

    expect(
      paths.map((path: string): boolean => {
        return isPathSetApartInSentence(path);
      }),
    ).toEqual([true, false, false]);

    for (const path of paths) {
      expect(isPathSetApartInSentence(path)).toBe(
        isSetApartInSentence(path, LEFT_TO_RIGHT),
      );
    }
  });

  test("sets a path apart left to right, and leaves the rest as written", () => {
    expect(setPathApartInSentence("/الرئيسية")).toBe(
      `${LEFT_TO_RIGHT_ISOLATE}/الرئيسية${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(setPathApartInSentence("/café")).toBe("/café");
    expect(setPathApartInSentence("")).toBe("");
  });
});
