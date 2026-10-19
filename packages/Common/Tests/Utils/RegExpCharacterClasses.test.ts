import {
  isAsciiLetterCode,
  isDigitCode,
  isLineTerminatorCode,
  isWhiteSpaceCode,
  isWordCode,
} from "../../Utils/RegExpCharacterClasses";
import { describe, expect, test } from "@jest/globals";

/*
 * Code that reads text a character at a time in place of a pattern must
 * class every character as the pattern did. Each predicate is held to the
 * class it stands for on every UTF-16 code unit.
 */

const WHITE_SPACE: RegExp = /\s/;
const ANY_BUT_LINE_TERMINATOR: RegExp = /./;
const DIGIT: RegExp = /\d/;
const WORD: RegExp = /\w/;
const ASCII_LETTER: RegExp = /[A-Za-z]/;

type Reference = (character: string) => boolean;

const CLASSES: Array<[string, (code: number) => boolean, Reference]> = [
  [
    "white space (\\s)",
    isWhiteSpaceCode,
    (character: string): boolean => {
      return WHITE_SPACE.test(character);
    },
  ],
  [
    "a line terminator (what . does not match)",
    isLineTerminatorCode,
    (character: string): boolean => {
      return !ANY_BUT_LINE_TERMINATOR.test(character);
    },
  ],
  [
    "a digit (\\d)",
    isDigitCode,
    (character: string): boolean => {
      return DIGIT.test(character);
    },
  ],
  [
    "a word character (\\w)",
    isWordCode,
    (character: string): boolean => {
      return WORD.test(character);
    },
  ],
  [
    "an ASCII letter ([A-Za-z])",
    isAsciiLetterCode,
    (character: string): boolean => {
      return ASCII_LETTER.test(character);
    },
  ],
];

describe.each(CLASSES)(
  "%s",
  (
    _name: string,
    predicate: (code: number) => boolean,
    reference: Reference,
  ) => {
    test("agrees with the pattern's class on every code unit", () => {
      const disagreements: Array<string> = [];

      for (let code: number = 0; code <= 0xffff; code++) {
        if (predicate(code) !== reference(String.fromCharCode(code))) {
          disagreements.push(code.toString(16));
        }
      }

      expect(disagreements).toEqual([]);
    });
  },
);

describe("the classes the readers lean on", () => {
  test("every line terminator is also white space", () => {
    for (const code of [0x0a, 0x0d, 0x2028, 0x2029]) {
      expect(isLineTerminatorCode(code)).toBe(true);
      expect(isWhiteSpaceCode(code)).toBe(true);
    }
  });

  test("a letter outside ASCII is neither a word character nor an ASCII letter", () => {
    for (const character of ["é", "ſ", "\u212a", "ı"]) {
      const code: number = character.charCodeAt(0);

      expect(isWordCode(code)).toBe(false);
      expect(isAsciiLetterCode(code)).toBe(false);
    }
  });
});
