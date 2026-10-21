import escapeRegExpDefault, { escapeRegExp } from "../../Utils/RegExpEscape";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * TEXT A REGULAR EXPRESSION MATCHES AS IT IS WRITTEN (RegExpEscape).
 *
 * escapeRegExp is the one escape product code uses to build a pattern out of
 * text: secrets to redact, a dashboard variable's name, a separator, span
 * names, a GitHub App's slug, a LIKE pattern's literal characters. It
 * escapes every character a pattern reads as syntax and nothing else, so the
 * pattern it gives matches the text and only the text, with or without the
 * u flag.
 */

const SYNTAX_CHARACTERS: ReadonlyArray<string> = [
  "\\",
  "^",
  "$",
  ".",
  "*",
  "+",
  "?",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "|",
];

const IMPORT_LINE: RegExp = /^import /m;

// A pattern that matches a text exactly when it is the whole text.
function wholePattern(text: string, flags: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}$`, flags);
}

describe("escapeRegExp", () => {
  test("escapes each character a pattern reads as syntax", () => {
    for (const character of SYNTAX_CHARACTERS) {
      expect(escapeRegExp(character)).toBe(`\\${character}`);
    }

    expect(escapeRegExp(SYNTAX_CHARACTERS.join(""))).toBe(
      SYNTAX_CHARACTERS.map((character: string): string => {
        return `\\${character}`;
      }).join(""),
    );
  });

  test("leaves every other printable ASCII character, and other scripts, as they are", () => {
    for (let code: number = 0x20; code < 0x7f; code++) {
      const character: string = String.fromCharCode(code);

      if (!SYNTAX_CHARACTERS.includes(character)) {
        expect([character, escapeRegExp(character)]).toEqual([
          character,
          character,
        ]);
      }
    }

    const otherScripts: string = [0xe9, 0x4e2d, 0x30ab, 0xd55c, 0x628, 0x1f680]
      .map((codePoint: number): string => {
        return String.fromCodePoint(codePoint);
      })
      .join("");

    expect(escapeRegExp(otherScripts)).toBe(otherScripts);
  });

  test("a backslash in the text is escaped too, so it cannot escape what follows it", () => {
    /*
     * An escape of the dots alone left "C:\d" read as "C:" and a digit: it
     * matched "C:7" and not itself.
     */
    const pattern: RegExp = wholePattern("C:\\d.log", "");

    expect(pattern.test("C:\\d.log")).toBe(true);
    expect(pattern.test("C:7.log")).toBe(false);
    expect(pattern.test("C:\\dxlog")).toBe(false);
  });

  test("the pattern matches the text itself, with and without the u flag", () => {
    const texts: Array<string> = generatedTexts(20000, 2718, [
      ...SYNTAX_CHARACTERS,
      "a",
      "Z",
      "0",
      " ",
      "-",
      "/",
      ",",
      "=",
      "<",
      ">",
      "!",
      "#",
      "&",
      ":",
      "\n",
      String.fromCodePoint(0x4e2d),
      String.fromCodePoint(0x1f680),
    ]);

    for (const text of texts) {
      expect([text, wholePattern(text, "").test(text)]).toEqual([text, true]);
      expect([text, wholePattern(text, "u").test(text)]).toEqual([text, true]);
    }
  });

  test("the pattern matches no other text", () => {
    const texts: Array<string> = Array.from(
      new Set(generatedTexts(600, 1618, [...SYNTAX_CHARACTERS, "a", "b"], 6)),
    );

    for (const text of texts) {
      const pattern: RegExp = wholePattern(text, "u");

      for (const other of texts) {
        if (other !== text) {
          expect([text, other, pattern.test(other)]).toEqual([
            text,
            other,
            false,
          ]);
        }
      }
    }
  });

  test("an escaped text joins an alternation as one alternative", () => {
    const pattern: RegExp = new RegExp(
      ["a|b", "(c)", "[d]"].map(escapeRegExp).join("|"),
      "g",
    );

    expect("x a|b y (c) z [d] a b c d".match(pattern)).toEqual([
      "a|b",
      "(c)",
      "[d]",
    ]);
  });

  test("it is the module's default export too, and the module imports nothing", () => {
    expect(escapeRegExpDefault).toBe(escapeRegExp);
    expect(
      fs.readFileSync(
        path.join(__dirname, "../../Utils/RegExpEscape.ts"),
        "utf8",
      ),
    ).not.toMatch(IMPORT_LINE);
  });

  test("four megabytes of syntax characters are escaped at once", () => {
    const text: string = SYNTAX_CHARACTERS.join("").repeat(
      Math.ceil((4 * 1024 * 1024) / SYNTAX_CHARACTERS.length),
    );
    const startedAt: number = performance.now();
    const escaped: string = escapeRegExp(text);
    const tookMs: number = performance.now() - startedAt;

    expect(escaped.length).toBe(text.length * 2);
    expect(tookMs).toBeLessThan(2000);
  });
});
