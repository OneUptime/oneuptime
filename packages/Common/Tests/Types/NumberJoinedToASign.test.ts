import {
  isNumberAlone,
  isNumberJoinedToASign,
} from "../../Types/ReadingDirection";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * A NUMBER KEEPS THE SIGNS A SENTENCE WRITES AGAINST IT.
 *
 * The bidi algorithm reads two numbers with one separator between them as
 * one number ("3/5", "09:30"), and a number sign in front of a number as
 * part of it ("#42"). Set apart in an isolate of its own, a number is cut
 * off from them: "{{online}}/{{count}}" in an Arabic sentence was drawn
 * "5/3". Such a number is left as it is (Types/Translator's
 * setsValuesApart); these are the rules that tell it.
 */

const LRM: string = String.fromCharCode(0x200e);
const RLM: string = String.fromCharCode(0x200f);
const ALM: string = String.fromCharCode(0x061c);
const MINUS: string = String.fromCharCode(0x2212);
const NBSP: string = String.fromCharCode(0x00a0);
const NNBSP: string = String.fromCharCode(0x202f);

describe("a number and nothing else", () => {
  test.each([
    "42",
    "0",
    "۴۲",
    "٤٢",
    "1,234.5",
    "1.234,5",
    `1${NBSP}234`,
    `1${NNBSP}234`,
    "1'234",
    "-3",
    `${MINUS}3`,
    "+5",
  ])("%p is a number", (value: string) => {
    expect(isNumberAlone(value)).toBe(true);
  });

  test("as Intl writes one in the languages read from the right, its marks and all", () => {
    for (const language of ["ar", "fa", "ar-EG", "ckb", "ps", "he", "ur"]) {
      for (const value of [1234567.891, -3, 0.5, 42]) {
        const written: string = value.toLocaleString(language);

        expect({ language, written, isNumber: isNumberAlone(written) }).toEqual(
          { language, written, isNumber: true },
        );
      }
    }

    // The marks themselves, written out.
    expect(isNumberAlone(`${LRM}${MINUS}۳`)).toBe(true);
    expect(isNumberAlone(`${ALM}-٣`)).toBe(true);
    expect(isNumberAlone(`${RLM}-٣`)).toBe(true);
    expect(isNumberAlone(`${LRM}-${LRM}۳`)).toBe(true);
    expect(isNumberAlone("۱٬۲۳۴٫۵")).toBe(true);
  });

  test.each([
    "",
    " ",
    "3 hosts",
    "۴ دقیقه پیش",
    "v2",
    "45%",
    "۴۵٪",
    "$5",
    "#42",
    "3/5",
    "09:30",
    "1,",
    ",5",
    "1..2",
    "--3",
    `${LRM}${LRM}3`,
    "3-",
  ])("%p is not", (value: string) => {
    expect(isNumberAlone(value)).toBe(false);
  });

  test("a value longer than any number Intl writes is not read as one", () => {
    expect(isNumberAlone("1".repeat(64))).toBe(true);
    expect(isNumberAlone("1".repeat(65))).toBe(false);
  });
});

describe("a number joined to a sign", () => {
  test("by one separator to a digit: a slash, a colon, a full stop, a comma, a minus", () => {
    // {{online}}/{{count}}, each side.
    expect(isNumberJoinedToASign("3", ": ", "/5")).toBe(true);
    expect(isNumberJoinedToASign("5", "3/", "")).toBe(true);
    // {{hours}}:{{minutes}}.
    expect(isNumberJoinedToASign("09", "", ":30")).toBe(true);
    expect(isNumberJoinedToASign("30", "9:", " ")).toBe(true);
    // {{major}}.{{minor}}, {{a}},{{b}}, {{from}}-{{to}}.
    expect(isNumberJoinedToASign("1", "", ".2")).toBe(true);
    expect(isNumberJoinedToASign("2", "1,", "")).toBe(true);
    expect(isNumberJoinedToASign("1", "", "-5")).toBe(true);
    // In Persian digits, and with the Arabic comma.
    expect(isNumberJoinedToASign("۵", "۳/", "")).toBe(true);
    expect(isNumberJoinedToASign("٣", "", "،٥")).toBe(true);
  });

  test("by a number sign in front of it", () => {
    // Persian's "#{{number}}" behind its right-to-left mark, Arabic's without one.
    expect(isNumberJoinedToASign("۴۲", `${RLM}#`, "")).toBe(true);
    expect(isNumberJoinedToASign("42", " #", ": ")).toBe(true);
    // The small and the full-width number signs.
    expect(isNumberJoinedToASign("42", "\u{FE5F}", "")).toBe(true);
    expect(isNumberJoinedToASign("42", "\u{FF03}", "")).toBe(true);
  });

  test("not by a separator with no digit on its other side", () => {
    // A sign between a number and a name joins nothing: {{count}}/{{name}}.
    expect(isNumberJoinedToASign("3", "", "/a")).toBe(false);
    expect(isNumberJoinedToASign("5", "x/", "")).toBe(false);
    // The full stop that ends a sentence, the comma before the next words.
    expect(isNumberJoinedToASign("5", "از ", ".")).toBe(false);
    expect(isNumberJoinedToASign("5", "", ", 6")).toBe(false);
    expect(isNumberJoinedToASign("5", "", "/")).toBe(false);
    expect(isNumberJoinedToASign("5", "/", "")).toBe(false);
  });

  test("not by two separators, nor by a sign the bidi algorithm reads apart", () => {
    expect(isNumberJoinedToASign("3", "", "//5")).toBe(false);
    expect(isNumberJoinedToASign("3", "", " / 5")).toBe(false);
    // A range's en dash, a multiplication sign, an equals sign.
    expect(isNumberJoinedToASign("3", "", "\u{2013}5")).toBe(false);
    expect(isNumberJoinedToASign("3", "", "\u{00D7}5")).toBe(false);
    expect(isNumberJoinedToASign("3", "", "=5")).toBe(false);
    // GitLab's "!{{number}}".
    expect(isNumberJoinedToASign("42", `${RLM}!`, "")).toBe(false);
    // A number sign after the number, or apart from it.
    expect(isNumberJoinedToASign("42", "", "#")).toBe(false);
    expect(isNumberJoinedToASign("42", "# ", "")).toBe(false);
  });

  /*
   * A number with a percent or a currency sign stays set apart: after
   * Arabic words the bidi algorithm draws "%45" either way, but at the
   * start of a sentence left as it is it drew "45%", and a sentence with
   * two drew them two ways.
   */
  test("not by a percent or a currency sign", () => {
    expect(isNumberJoinedToASign("45", "", "%")).toBe(false);
    expect(isNumberJoinedToASign("۴۵", "", "٪")).toBe(false);
    expect(isNumberJoinedToASign("5", "$", "")).toBe(false);
    expect(isNumberJoinedToASign("5", "", "€")).toBe(false);
    expect(isNumberJoinedToASign("5", "(±", "")).toBe(false);
  });

  test("only a number is: a name, a time or a count with its unit is set apart", () => {
    expect(isNumberJoinedToASign("3 hosts", "", "/5")).toBe(false);
    expect(isNumberJoinedToASign("Acme", "#", "")).toBe(false);
    expect(isNumberJoinedToASign("۴ دقیقه پیش", "", ":5")).toBe(false);
    expect(isNumberJoinedToASign("", "3/", "")).toBe(false);
  });
});

describe("its time", () => {
  test("a value of 400,000 digits and separators is decided at once", () => {
    const value: string = "1,2".repeat(130000);
    const run: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return isNumberJoinedToASign(value, "3/", "/5");
      },
      limitInMs: 2000,
    });

    expect(run.result).toBe(false);
    expect(run.inMs).toBeLessThan(2000);
  });
});
