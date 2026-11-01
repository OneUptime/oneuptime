import {
  FIRST_STRONG_ISOLATE,
  isSetApartInSentence,
  LEFT_TO_RIGHT,
  POP_DIRECTIONAL_ISOLATE,
  RIGHT_TO_LEFT,
  setApartInSentence,
  TEXT_DIRECTION_SCAN_LENGTH,
} from "../../Types/ReadingDirection";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * A VALUE PUT INTO A SENTENCE, SET APART FROM IT.
 *
 * In a Persian sentence a name in Latin letters is a left-to-right run, and
 * a number after it joins that run: "... داشبورد Meraki (Acme Retail)، ۴
 * دقیقه پیش." drew its digit and comma beside the name. A value that could
 * move its neighbours is set apart in a Unicode isolate (FSI ... PDI); a
 * value of the sentence's own script is left as it is.
 */

const isolated: (value: string) => string = (value: string): string => {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
};

describe("the isolate's marks", () => {
  test("are FIRST STRONG ISOLATE (U+2068) and POP DIRECTIONAL ISOLATE (U+2069)", () => {
    expect(FIRST_STRONG_ISOLATE.codePointAt(0)).toBe(0x2068);
    expect(POP_DIRECTIONAL_ISOLATE.codePointAt(0)).toBe(0x2069);
    expect(FIRST_STRONG_ISOLATE).toHaveLength(1);
    expect(POP_DIRECTIONAL_ISOLATE).toHaveLength(1);
  });
});

describe("in a sentence read right to left (Persian)", () => {
  test("a name in Latin letters is set apart", () => {
    expect(isSetApartInSentence("Acme Retail", RIGHT_TO_LEFT)).toBe(true);
    expect(setApartInSentence("Acme Retail", RIGHT_TO_LEFT)).toBe(
      isolated("Acme Retail"),
    );
  });

  test("an address, a host and an email are set apart", () => {
    for (const value of [
      "10.0.0.1",
      "fdf9:9ef6:88c2::1",
      "core-rtr-01.acme.example",
      "sara@acme-commerce.example",
      "TRUSTED_PROXY_HOPS=2",
    ]) {
      expect({
        value,
        isSetApart: isSetApartInSentence(value, RIGHT_TO_LEFT),
      }).toEqual({ value, isSetApart: true });
    }
  });

  test("a time or a count is set apart, in Persian digits or Latin ones", () => {
    for (const value of ["۴ دقیقه پیش", "۴۱۲", "412", "09:05", "۱۵:۰۷"]) {
      expect({
        value,
        isSetApart: isSetApartInSentence(value, RIGHT_TO_LEFT),
      }).toEqual({ value, isSetApart: true });
    }
  });

  test("Persian words alone are left as they are", () => {
    for (const value of ["مانیتورها", "حادثه‌ها", "همین حالا", "مالک پروژه"]) {
      expect({
        value,
        written: setApartInSentence(value, RIGHT_TO_LEFT),
      }).toEqual({ value, written: value });
    }
  });

  test("Persian words with a Latin name in them are set apart whole", () => {
    expect(setApartInSentence("داشبورد Meraki", RIGHT_TO_LEFT)).toBe(
      isolated("داشبورد Meraki"),
    );
  });
});

describe("in a sentence read left to right (English, German)", () => {
  test("a name in Persian letters is set apart", () => {
    expect(setApartInSentence("سارا احمدی", LEFT_TO_RIGHT)).toBe(
      isolated("سارا احمدی"),
    );
    expect(setApartInSentence("Sara احمدی", LEFT_TO_RIGHT)).toBe(
      isolated("Sara احمدی"),
    );
  });

  test("English words, numbers and times are left as they are", () => {
    for (const value of [
      "Checkout API",
      "412",
      "09:05",
      "vor 5 Minuten",
      "10.0.0.1",
    ]) {
      expect({
        value,
        written: setApartInSentence(value, LEFT_TO_RIGHT),
      }).toEqual({ value, written: value });
    }
  });
});

describe("what is never set apart", () => {
  test("an empty value", () => {
    expect(setApartInSentence("", RIGHT_TO_LEFT)).toBe("");
    expect(setApartInSentence("", LEFT_TO_RIGHT)).toBe("");
    expect(isSetApartInSentence("", RIGHT_TO_LEFT)).toBe(false);
  });

  test("punctuation and spaces alone", () => {
    for (const value of [" ", "·", "-", "...", "،"]) {
      expect({
        value,
        rightToLeft: setApartInSentence(value, RIGHT_TO_LEFT),
        leftToRight: setApartInSentence(value, LEFT_TO_RIGHT),
      }).toEqual({ value, rightToLeft: value, leftToRight: value });
    }
  });

  test("only the start of a long value is read", () => {
    const persianStart: string = "ب".repeat(TEXT_DIRECTION_SCAN_LENGTH);

    // A Latin letter past the read start is not seen.
    expect(isSetApartInSentence(`${persianStart}a`, RIGHT_TO_LEFT)).toBe(false);
    // One inside it is.
    expect(isSetApartInSentence(`a${persianStart}`, RIGHT_TO_LEFT)).toBe(true);
  });
});

describe("its time", () => {
  /*
   * A value can be a whole log line someone sent: deciding takes time in
   * line with the value, and stops at TEXT_DIRECTION_SCAN_LENGTH.
   */
  test("400,000 characters of Persian words are decided at once", () => {
    const value: string = "مانیتور ".repeat(50000);
    const run: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return isSetApartInSentence(value, RIGHT_TO_LEFT);
      },
      limitInMs: 2000,
    });

    expect(run.result).toBe(false);
    expect(run.inMs).toBeLessThan(2000);
  });
});
