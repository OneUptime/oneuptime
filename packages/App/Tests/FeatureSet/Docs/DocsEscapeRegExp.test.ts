import { escapeRegExp } from "./DocsTranslationChecks";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import { describe, expect, it } from "@jest/globals";

/*
 * escapeRegExp is the one place the docs tests escape text for a pattern
 * built from it (DocsCodeScanningGuard fails on a suite that escapes text
 * itself). Every character a pattern reads as syntax gets a backslash, so a
 * pattern built from any text matches that text and nothing else.
 *
 * Escaping only some of them is what code scanning reported (#2215, #1868):
 * with only its dots escaped, "C:\d" is the pattern C:\d, which matches
 * "C:7" and not "C:\d" - a backslash in the text starts an escape of its
 * own. The suites build patterns from Dashboard labels, routes, attribute
 * names and source code, any of which may hold a bracket, a parenthesis or
 * a backslash.
 */

// Each character a pattern reads as syntax outside a character class.
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

// Pieces texts are drawn from: syntax, letters, and what a suite's text holds.
const ALPHABET: ReadonlyArray<string> = [
  ...SYNTAX_CHARACTERS,
  "a",
  "B",
  "0",
  "-",
  "/",
  " ",
  "\n",
  ":",
  "\u{4E2D}",
  "\u{064A}",
  "\u{1F600}",
  // Text that reads as an escape, or a replacement's substitution.
  "\\d",
  "\\u0041",
  "$&",
  "$1",
];

// A pattern of the text alone, from start to end.
const exactly: (text: string, flags?: string) => RegExp = (
  text: string,
  flags: string = "",
): RegExp => {
  return new RegExp(`^${escapeRegExp(text)}$`, flags);
};

describe("escapeRegExp", () => {
  it("puts a backslash before each character a pattern reads as syntax", () => {
    for (const character of SYNTAX_CHARACTERS) {
      expect({ character, escaped: escapeRegExp(character) }).toEqual({
        character,
        escaped: `\\${character}`,
      });
    }

    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
    expect(escapeRegExp("\\")).toBe("\\\\");
    expect(escapeRegExp("(beta)")).toBe("\\(beta\\)");
  });

  it("leaves every other character as it is: letters, digits, other punctuation and other scripts", () => {
    const plain: string = `abcXYZ019 -/,#:;=!<>@%&'"\`~_\n\t\u{4E2D}\u{30AB}\u{D55C}\u{0628}\u{06F3}\u{1F600}`;

    expect(escapeRegExp(plain)).toBe(plain);
  });

  it.each([
    // The texts the suites build patterns from.
    "props.showIncidentsOnStatusPage",
    "faas.name",
    "Azure OpenAI / Microsoft Foundry",
    "/otlp/v1/profiles",
    "{{count}} devices are not reporting their details",
    "Price ($)",
    "[Preview] Status (beta)?",
    "a|b",
    "^start$",
    "x+y*z",
    // What a dots-only escape gets wrong.
    "C:\\d",
    "\\.",
  ])(
    "builds a pattern that matches %j and no text around it",
    (text: string) => {
      for (const flags of ["", "u"]) {
        expect({
          text,
          flags,
          matches: exactly(text, flags).test(text),
        }).toEqual({
          text,
          flags,
          matches: true,
        });
        expect(exactly(text, flags).test(`${text}x`)).toBe(false);
        expect(exactly(text, flags).test(`x${text}`)).toBe(false);
        expect(exactly(text, flags).test(text.slice(1))).toBe(false);
      }
    },
  );

  it("keeps a backslash in the text a backslash, as a dots-only escape does not", () => {
    // "C:\d" with only its dots escaped is the pattern C:\d: a digit.
    const dotsOnly: RegExp = new RegExp("^C:\\d$");

    expect(dotsOnly.test("C:\\d")).toBe(false);
    expect(dotsOnly.test("C:7")).toBe(true);

    expect(exactly("C:\\d").test("C:\\d")).toBe(true);
    expect(exactly("C:\\d").test("C:7")).toBe(false);
  });

  it("escapes text inside a longer pattern too", () => {
    const path: RegExp = new RegExp(
      `\\*\\*${escapeRegExp("Settings (beta)")}\\*\\* > \\*\\*${escapeRegExp("SSO [SAML]")}\\*\\*`,
    );

    expect(path.test("Open **Settings (beta)** > **SSO [SAML]**.")).toBe(true);
    expect(path.test("Open **Settings beta** > **SSO S**.")).toBe(false);
  });

  it("builds a pattern that matches its text, with and without the u flag, for 20,000 texts", () => {
    const texts: Array<string> = generatedTexts(20000, 2215, ALPHABET);
    const misread: Array<string> = texts.filter((text: string): boolean => {
      return !exactly(text).test(text) || !exactly(text, "u").test(text);
    });

    expect(misread).toEqual([]);
    expect(new Set(texts).size).toBeGreaterThan(15000);
  });

  it("builds a pattern that matches no other text: 600 texts, each against every other", () => {
    const texts: Array<string> = Array.from(
      new Set(generatedTexts(600, 2216, ALPHABET, 8)),
    );
    const crossed: Array<string> = [];

    for (const text of texts) {
      const pattern: RegExp = exactly(text);

      for (const other of texts) {
        if (other !== text && pattern.test(other)) {
          crossed.push(
            `${JSON.stringify(text)} matched ${JSON.stringify(other)}`,
          );
        }
      }
    }

    expect(crossed).toEqual([]);
    // Short texts repeat; the rest are different.
    expect(texts.length).toBeGreaterThan(450);
  });
});
