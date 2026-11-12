import { describe, expect, test } from "@jest/globals";
import Phone from "../../Types/Phone";
import { ObjectType } from "../../Types/JSON";
import {
  getPhoneNumberDirection,
  getPhoneNumbersOfValue,
  getPhoneNumberValueText,
  phoneNumberInLine,
  phoneNumberListInLine,
} from "../../Types/PhoneNumberDirection";
import { LEFT_TO_RIGHT, RIGHT_TO_LEFT } from "../../Types/ReadingDirection";
import { withoutIsolateMarks } from "../Helpers/IsolateMarks";

/*
 * ISSUE #6605: A PHONE NUMBER READS +447700900123 IN EVERY LANGUAGE.
 *
 * On a Persian or Arabic page, laid out right to left, a run of digits
 * after a "+" has no letter to say which way it reads, so it took the
 * page's way and its "+" was drawn after the digits: 447700900123+. These
 * are the rules every surface that prints a number reads - the component
 * (PhoneNumberText) and the lines that can only be text (a sentence's
 * value, a native tooltip).
 */

// The marks, written out so the test does not read them from the code it checks.
const LRI: string = String.fromCharCode(0x2066);
const RLI: string = String.fromCharCode(0x2067);
const FSI: string = String.fromCharCode(0x2068);
const PDI: string = String.fromCharCode(0x2069);

const UK: string = "+447700900123";
const US: string = "+14155550100";
const MASKED: string = "+1 ••• ••• 4821";

describe("which way a phone number reads", () => {
  test.each([
    ["an E.164 number", UK],
    ["a number written with spaces", "+44 7700 900123"],
    ["a national number with brackets", "(415) 555-0100"],
    ["a number with no plus", "07911123456"],
    ["a masked number", MASKED],
    ["a number in Persian digits", "+۹۸۹۱۲۳۴۵۶۷۸۹"],
    ["a number in Arabic-Indic digits", "+٩٧١٥٠١٢٣٤٥٦٧"],
  ])(
    "%s reads left to right, though it has no letter",
    (_name: string, number: string) => {
      expect(getPhoneNumberDirection(number)).toBe(LEFT_TO_RIGHT);
    },
  );

  test("a name given in a number's place reads the way its letters do", () => {
    // A Twilio number's friendly name, renamed by its owner.
    expect(getPhoneNumberDirection("Support line")).toBe(LEFT_TO_RIGHT);
    expect(getPhoneNumberDirection("خط پشتیبانی")).toBe(RIGHT_TO_LEFT);
    expect(getPhoneNumberDirection("خط الدعم 2")).toBe(RIGHT_TO_LEFT);
  });

  test("no number at all reads left to right too", () => {
    expect(getPhoneNumberDirection("")).toBe(LEFT_TO_RIGHT);
    expect(getPhoneNumberDirection(undefined)).toBe(LEFT_TO_RIGHT);
    expect(getPhoneNumberDirection(null)).toBe(LEFT_TO_RIGHT);
  });
});

describe("the number a stored value holds", () => {
  test("a Phone, its text, and the JSON of one not read into its model", () => {
    expect(getPhoneNumberValueText(new Phone(UK))).toBe(UK);
    expect(getPhoneNumberValueText(` ${UK} `)).toBe(UK);
    expect(
      getPhoneNumberValueText({ _type: ObjectType.Phone, value: UK }),
    ).toBe(UK);
  });

  test("anything else is no number - never [object Object]", () => {
    expect(getPhoneNumberValueText(undefined)).toBe("");
    expect(getPhoneNumberValueText(null)).toBe("");
    expect(getPhoneNumberValueText({ value: UK })).toBe("");
    expect(getPhoneNumberValueText({ _type: "Email", value: UK })).toBe("");
    expect(getPhoneNumberValueText([UK])).toBe("");
    expect(getPhoneNumberValueText(42)).toBe("");
  });

  test("a value holds one number, or each of a list typed as one value", () => {
    expect(getPhoneNumbersOfValue(new Phone(UK))).toEqual([UK]);
    expect(getPhoneNumbersOfValue(`+6581234567, ${UK}`)).toEqual([
      "+6581234567",
      UK,
    ]);
    // Commas, semicolons and lines separate a list, as its form takes it.
    expect(getPhoneNumbersOfValue(`+6581234567;${UK}\n${US},`)).toEqual([
      "+6581234567",
      UK,
      US,
    ]);
    expect(getPhoneNumbersOfValue("")).toEqual([]);
    expect(getPhoneNumbersOfValue(" , ")).toEqual([]);
    expect(getPhoneNumbersOfValue(undefined)).toEqual([]);
  });
});

describe("a phone number in a line that can only be text", () => {
  test.each(["fa", "ar", "fa-IR", "ar-EG"])(
    "on a page read right to left (%s) it is set apart in an isolate that reads left to right",
    (language: string) => {
      expect(phoneNumberInLine(UK, language)).toBe(`${LRI}${UK}${PDI}`);
      expect(phoneNumberInLine(MASKED, language)).toBe(`${LRI}${MASKED}${PDI}`);
      // What it says is the number, as it was.
      expect(withoutIsolateMarks(phoneNumberInLine(UK, language))).toBe(UK);
    },
  );

  /*
   * A number copied from an English page carries no invisible mark: pasted
   * into a phone field, LRI and PDI are not a phone number's characters
   * (Phone refuses them), and the line reads right without them.
   */
  test.each(["en", "de", "ja", "zh", "fr", undefined, null, ""])(
    "on a page read left to right (%s) it is left exactly as it is",
    (language: string | undefined | null) => {
      expect(phoneNumberInLine(UK, language)).toBe(UK);
      expect(phoneNumberInLine(` ${US} `, language)).toBe(US);
      expect(() => {
        return new Phone(phoneNumberInLine(UK, language));
      }).not.toThrow();
    },
  );

  test("a name in a number's place is set apart only where it reads the other way", () => {
    expect(phoneNumberInLine("Support line", "fa")).toBe(
      `${LRI}Support line${PDI}`,
    );
    expect(phoneNumberInLine("Support line", "en")).toBe("Support line");
    expect(phoneNumberInLine("خط پشتیبانی", "fa")).toBe("خط پشتیبانی");
    expect(phoneNumberInLine("خط پشتیبانی", "en")).toBe(
      `${RLI}خط پشتیبانی${PDI}`,
    );
  });

  test("no number is nothing, on any page", () => {
    for (const language of ["en", "fa", "ar"]) {
      expect(phoneNumberInLine("", language)).toBe("");
      expect(phoneNumberInLine("  ", language)).toBe("");
      expect(phoneNumberInLine(undefined, language)).toBe("");
      expect(phoneNumberInLine(null, language)).toBe("");
    }
  });

  test("its isolate is a left-to-right one, never one that guesses from the first letter", () => {
    /*
     * A first-strong isolate (FSI) reads a number left to right as well,
     * but only because it has no letter: the number is set apart with the
     * isolate that says so.
     */
    expect(phoneNumberInLine(UK, "fa").startsWith(FSI)).toBe(false);
    expect(phoneNumberInLine(UK, "fa").startsWith(LRI)).toBe(true);
  });
});

describe("phone numbers listed in a line that can only be text", () => {
  const OTHERS: Array<string> = ["+6590001111", "+447700900124"];

  test("on an English page: the numbers as they are, separated by commas, as before", () => {
    expect(phoneNumberListInLine(OTHERS, "en")).toBe(
      "+6590001111, +447700900124",
    );
    expect(phoneNumberListInLine(OTHERS, undefined)).toBe(
      "+6590001111, +447700900124",
    );
  });

  test.each([
    ["fa", "، "],
    ["ar", "، "],
  ])(
    "on a %s page: each number set apart, separated the reader's way",
    (language: string, separator: string) => {
      const line: string = phoneNumberListInLine(OTHERS, language);

      expect(line).toBe(
        `${LRI}+6590001111${PDI}${separator}${LRI}+447700900124${PDI}`,
      );
      expect(withoutIsolateMarks(line)).toBe(
        `+6590001111${separator}+447700900124`,
      );
    },
  );

  test("in Japanese: the ideographic comma, and no mark", () => {
    expect(phoneNumberListInLine(OTHERS, "ja")).toBe(
      "+6590001111、+447700900124",
    );
  });

  test("an empty entry is left out, and an empty list is nothing", () => {
    expect(phoneNumberListInLine(["", UK, "  "], "fa")).toBe(
      `${LRI}${UK}${PDI}`,
    );
    expect(phoneNumberListInLine([], "fa")).toBe("");
  });
});
