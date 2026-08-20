import Phone from "../../../Types/Phone";
import { isHighRiskPhoneNumber } from "../../../Types/Call/CallRequest";
import { describe, expect, test } from "@jest/globals";

/*
 * isHighRiskPhoneNumber(phone) stringifies the Phone and returns true when the
 * resulting string starts with any of a fixed set of high-risk country dialing
 * codes. The matching is a plain String.prototype.startsWith over the raw
 * value, so behavior hinges on: the exact leading characters (including the
 * "+"), the ordering-independent "some" scan, and the boundary between a real
 * code and a number that merely shares leading digits with one.
 *
 * These tests exercise the real branches: every high-risk code (true path),
 * ordinary countries (false path), near-miss prefixes that share leading digits
 * but are not a code, the required leading "+", formatting/length boundaries,
 * and copy-constructed Phone objects.
 */

/*
 * The exact high-risk set encoded in CallRequest.ts. Kept as a local literal so
 * the test asserts against a known expectation rather than re-importing the
 * private constant.
 */
const HIGH_RISK_DIALING_CODES: Array<string> = [
  "+92",
  "+27",
  "+213",
  "+371",
  "+370",
  "+372",
  "+252",
  "+232",
  "+231",
  "+53",
  "+960",
  "+992",
  "+880",
  "+62",
  "+84",
  "+95",
];

type MakeValidNumberFunction = (dialingCode: string) => string;

/*
 * Build a phone string that starts with the given dialing code and satisfies
 * Phone's constructor regex (3 digits, 3 digits, then 4-7 digits => 10-13 total
 * digits). Padding with zeros to 12 total digits keeps every generated number
 * inside the valid range regardless of whether the code has 2 or 3 digits.
 */
const makeValidNumber: MakeValidNumberFunction = (
  dialingCode: string,
): string => {
  const digits: string = dialingCode.replace("+", "");
  const padding: string = "0000000000000".substring(0, 12 - digits.length);
  return "+" + digits + padding;
};

describe("isHighRiskPhoneNumber flags every high-risk dialing code", () => {
  test.each(HIGH_RISK_DIALING_CODES)(
    "flags a number starting with %s",
    (dialingCode: string) => {
      const phone: Phone = new Phone(makeValidNumber(dialingCode));
      expect(isHighRiskPhoneNumber(phone)).toBe(true);
    },
  );

  test("flags Tajikistan (+992) on its own three-digit code, not via +92", () => {
    /*
     * +992 does not start with +92, so it can only be flagged by its own
     * three-digit entry. This guards against a regression where only the
     * shorter code were present.
     */
    const phone: Phone = new Phone(makeValidNumber("+992"));
    expect(phone.toString().startsWith("+92")).toBe(false);
    expect(isHighRiskPhoneNumber(phone)).toBe(true);
  });
});

describe("isHighRiskPhoneNumber does not flag ordinary / low-risk countries", () => {
  const lowRiskNumbers: Array<string> = [
    "+15551234567", // United States / Canada (+1)
    "+442071234567", // United Kingdom (+44)
    "+491234567890", // Germany (+49)
    "+611234567890", // Australia (+61)
    "+331234567890", // France (+33)
    "+811234567890", // Japan (+81)
    "+861234567890", // China (+86)
    "+551234567890", // Brazil (+55)
    "+521234567890", // Mexico (+52) sits right next to Cuba (+53)
    "+919876543210", // India (+91) sits right next to Pakistan (+92)
  ];

  test.each(lowRiskNumbers)("does not flag %s", (phoneNumber: string) => {
    const phone: Phone = new Phone(phoneNumber);
    expect(isHighRiskPhoneNumber(phone)).toBe(false);
  });
});

describe("near-miss prefixes that only share leading digits are not flagged", () => {
  /*
   * Each entry starts with the same first digits as a real high-risk code but
   * diverges before the full code, so startsWith must return false. This is the
   * key discriminating branch: matching is prefix-exact, not "close enough".
   */
  const nearMisses: Array<[string, string]> = [
    ["+254123456789", "Kenya (+254) vs Somalia (+252)"],
    ["+994123456789", "Azerbaijan (+994) vs Tajikistan (+992)"],
    ["+886123456789", "Taiwan (+886) vs Bangladesh (+880)"],
    [
      "+373123456789",
      "Moldova (+373) vs Latvia/Lithuania/Estonia (+371/+370/+372)",
    ],
    ["+919876543210", "India (+91) vs Pakistan (+92)"],
    ["+521234567890", "Mexico (+52) vs Cuba (+53)"],
  ];

  test.each(nearMisses)("does not flag %s", (phoneNumber: string) => {
    const phone: Phone = new Phone(phoneNumber);
    expect(isHighRiskPhoneNumber(phone)).toBe(false);
  });
});

describe("the leading + is part of the match", () => {
  test("a high-risk number without the leading + is not flagged", () => {
    /*
     * The stored value is exactly what the caller passed. Without the "+", the
     * string is "920000000000", which does not start with "+92".
     */
    const phone: Phone = new Phone("920000000000");
    expect(phone.toString().startsWith("+")).toBe(false);
    expect(isHighRiskPhoneNumber(phone)).toBe(false);
  });

  test("the same digits with the leading + are flagged", () => {
    const phone: Phone = new Phone("+920000000000");
    expect(isHighRiskPhoneNumber(phone)).toBe(true);
  });
});

describe("formatting and length boundaries", () => {
  test("flags a high-risk number written with separators after the code", () => {
    /*
     * "+232-123-4567" is a valid Phone (3 digits, sep, 3 digits, sep, 4 digits)
     * whose string still starts with the Sierra Leone code "+232".
     */
    const phone: Phone = new Phone("+232-123-4567");
    expect(isHighRiskPhoneNumber(phone)).toBe(true);
  });

  test("flags the shortest valid high-risk number (10 digits)", () => {
    const phone: Phone = new Phone("+9200000000");
    expect(isHighRiskPhoneNumber(phone)).toBe(true);
  });

  test("flags the longest valid high-risk number (13 digits)", () => {
    const phone: Phone = new Phone("+9200000000000");
    expect(isHighRiskPhoneNumber(phone)).toBe(true);
  });
});

describe("Phone construction variants are evaluated identically", () => {
  test("a Phone copy-constructed from another Phone is still flagged", () => {
    const original: Phone = new Phone("+920000000000");
    const copy: Phone = new Phone(original);
    expect(copy.toString()).toEqual(original.toString());
    expect(isHighRiskPhoneNumber(copy)).toBe(true);
  });

  test("mutating a Phone to a high-risk value changes the result", () => {
    const phone: Phone = new Phone("+15551234567");
    expect(isHighRiskPhoneNumber(phone)).toBe(false);
    phone.phone = "+840000000000";
    expect(isHighRiskPhoneNumber(phone)).toBe(true);
  });
});

describe("return value contract", () => {
  test("always returns a strict boolean", () => {
    const flagged: boolean = isHighRiskPhoneNumber(new Phone("+920000000000"));
    const notFlagged: boolean = isHighRiskPhoneNumber(
      new Phone("+15551234567"),
    );
    expect(typeof flagged).toBe("boolean");
    expect(typeof notFlagged).toBe("boolean");
    expect(flagged).toBe(true);
    expect(notFlagged).toBe(false);
  });
});
