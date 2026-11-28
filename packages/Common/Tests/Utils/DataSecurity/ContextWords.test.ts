import { describe, expect, test } from "@jest/globals";
import {
  anyWordIn,
  anyWordNear,
  containsWord,
} from "../../../Utils/DataSecurity/ContextWords";
import { containsWord as scannersContainsWord } from "../../../Utils/DataSecurity/TextScanner";

/*
 * THE WORDS AROUND A VALUE THAT SAY WHAT IT IS - READ ONE WAY BY THE
 * SCANNER AND BY THE RULES (#11114).
 *
 * The scanner judges every candidate by its detector's words near it, and
 * a rule built on the detectors judges a candidate of a type that is one
 * only beside its words the same way: both read the words here.
 */

describe("containsWord", () => {
  test("is the one the scanner reads words with", () => {
    expect(scannersContainsWord).toBe(containsWord);
  });

  test("finds a word, never part of a longer one", () => {
    expect(containsWord("tel 02012345678", "tel")).toBe(true);
    expect(containsWord("tel:02012345678", "tel")).toBe(true);
    expect(containsWord("(tel)", "tel")).toBe(true);
    expect(containsWord("telemetry 02012345678", "tel")).toBe(false);
    expect(containsWord("hotel 02012345678", "tel")).toBe(false);
    expect(containsWord("callback 02012345678", "call")).toBe(false);
    expect(containsWord("call_02012345678", "call")).toBe(true);
    expect(containsWord("ssn=536221234", "ssn")).toBe(true);
    expect(containsWord("ssns 536221234", "ssn")).toBe(false);
  });

  test("finds a word of several words, as written", () => {
    expect(containsWord("social security number: 1", "social security")).toBe(
      true,
    );
    expect(containsWord("social  security", "social security")).toBe(false);
    expect(containsWord("asocial security", "social security")).toBe(false);
  });

  test("finds the second time a word is a word, after it was part of another", () => {
    expect(containsWord("telemetry tel 1", "tel")).toBe(true);
    expect(containsWord("telemetrytel", "tel")).toBe(false);
  });
});

describe("anyWordNear", () => {
  // "tel" starts 4 characters before the value, and "xyz" ends 4 after it.
  const text: string = "abc tel 0201234567 xyz";
  const start: number = text.indexOf("0201");
  const end: number = start + "0201234567".length;

  test("finds a word before the value within its reach, and not past it", () => {
    expect(anyWordNear(text, start, end, ["tel"], 4, 0)).toBe(true);
    expect(anyWordNear(text, start, end, ["tel"], 3, 0)).toBe(false);
  });

  test("finds a word after the value within its reach, and not past it", () => {
    expect(anyWordNear(text, start, end, ["xyz"], 0, 4)).toBe(true);
    expect(anyWordNear(text, start, end, ["xyz"], 0, 3)).toBe(false);
  });

  test("finds any of the words, and none of none", () => {
    expect(anyWordNear(text, start, end, ["phone", "tel"], 8, 0)).toBe(true);
    expect(anyWordNear(text, start, end, ["phone", "mobile"], 64, 32)).toBe(
      false,
    );
    expect(anyWordNear(text, start, end, [], 64, 32)).toBe(false);
    expect(anyWordNear(text, start, end, undefined, 64, 32)).toBe(false);
  });

  test("reads only to the text's ends", () => {
    expect(anyWordNear("tel 1", 4, 5, ["tel"], 1000, 1000)).toBe(true);
    expect(anyWordNear("1 tel", 0, 1, ["tel"], 1000, 1000)).toBe(true);
  });
});

describe("anyWordIn", () => {
  test("finds a word anywhere, in a longer word too: what rules a text out cheaply", () => {
    expect(anyWordIn("telemetry", ["tel"])).toBe(true);
    expect(anyWordIn("order 02012345678", ["tel", "phone"])).toBe(false);
    expect(anyWordIn("anything", undefined)).toBe(false);
    expect(anyWordIn("anything", [])).toBe(false);
  });
});
