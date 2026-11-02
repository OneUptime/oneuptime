import BadDataException from "../../Types/Exception/BadDataException";
import Phone from "../../Types/Phone";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";

describe("Testing Class Phone", () => {
  test("Should create a phone if the phone is valid phone number", () => {
    expect(new Phone("+251912974103").toString()).toEqual("+251912974103");
    expect(new Phone("961-770-7727").phone).toEqual("961-770-7727");
    expect(new Phone("943-627-0355").phone).toEqual("943-627-0355");
    expect(new Phone("282.652.3201").phone).toEqual("282.652.3201");
  });

  test("Phone.phone should be mutatable", () => {
    const value: Phone = new Phone("+251912974103");
    value.phone = "+251925974121";
    expect(value.phone).toEqual("+251925974121");
    expect(value.toString()).toEqual("+251925974121");
  });

  test("Creating phone number with invalid format should throw BadDataException", () => {
    expect(() => {
      new Phone("25192599879079074121");
    }).toThrowError(BadDataException);
  });

  test("try to mutating Phone.phone with invalid value should throw a BadDataException", () => {
    const valid: string = "+251912974103";
    const invalid: string = "278@$90> ";
    const value: Phone = new Phone(valid);
    expect(() => {
      value.phone = invalid;
    }).toThrowError(BadDataException);
    expect(() => {
      value.phone = "278@$90> ";
    }).toThrow("Phone is not in valid format: 278@$90>");
    expect(value.phone).toBe(valid);
    expect(() => {
      value.phone = "hgjuit879";
    }).toThrowError(BadDataException);
  });
});

/*
 * The phone number is required on OneUptime Cloud's sign-up form, and the form
 * asks this class whether it is valid. People group a number the way it is
 * said, not three-three-four, so "+1 415 555 1234" and "+44 7911 123456" were
 * refused and the person was left to guess what was wrong with them.
 *
 * A number with separators anywhere else is taken as its digits, which is the
 * form SMS and call providers want. Everything taken before is taken exactly
 * as before: a stored number is checked here again each time it is read
 * (fromDatabase), so one refused now would be a row nothing could read.
 */
describe("a number typed the way people write them", () => {
  test.each([
    ["+1 415 555 1234", "+14155551234"],
    ["+1-415-555-1234", "+14155551234"],
    ["+1 (415) 555-1234", "+14155551234"],
    ["+1.415.555.1234", "+14155551234"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+44 7911 123456", "+447911123456"],
    ["+49 151 12345678", "+4915112345678"],
    ["+33 1 23 45 67 89", "+33123456789"],
    ["+91 98765 43210", "+919876543210"],
    ["+61 412 345 678", "+61412345678"],
    ["+971 50 123 4567", "+971501234567"],
    ["+65 9066 5484", "+6590665484"],
    ["1-415-555-1234", "14155551234"],
    ["1 415 555 1234", "14155551234"],
    ["07911 123456", "07911123456"],
    ["98765 43210", "9876543210"],
    ["  +44 7911 123456  ", "+447911123456"],
  ])("%s is taken, as %s", (typed: string, stored: string) => {
    expect(new Phone(typed).phone).toBe(stored);
  });

  test.each([
    "+14155551234",
    "+442079460958",
    "+251912974103",
    "(415) 555-1234",
    "415-555-1234",
    "415 555 1234",
    "4155551234",
    "961-770-7727",
    "282.652.3201",
    "+123-456-7890",
  ])(
    "%s, which was always taken, stays exactly as it was typed",
    (typed: string) => {
      expect(new Phone(typed).phone).toBe(typed);
    },
  );

  test("every shape the old check took is still taken, character for character", () => {
    /*
     * The old rule, spelled out here on purpose: this is what rows already
     * stored were written under.
     */
    const separators: Array<string> = ["", "-", " ", "."];
    const random: SeededRandom = seededRandom(5517);
    const digits: (count: number) => string = (count: number): string => {
      return Array.from({ length: count }, () => {
        return random(10).toString();
      }).join("");
    };

    for (let draw: number = 0; draw < 2000; draw++) {
      const first: string = digits(3);
      const open: string = random(2) === 0 ? "(" : "";
      const close: string = random(2) === 0 ? ")" : "";
      const typed: string = [
        random(2) === 0 ? "+" : "",
        open,
        first,
        close,
        separators[random(separators.length)],
        digits(3),
        separators[random(separators.length)],
        digits(4 + random(4)),
      ].join("");

      expect(new Phone(typed).phone).toBe(typed);
    }
  });

  test("what is stored for a number typed with separators reads back unchanged", () => {
    const stored: string = new Phone("+44 20 7946 0958").phone;

    expect(new Phone(stored).phone).toBe(stored);
    expect(Phone.isSameNumber("+44 20 7946 0958", new Phone(stored))).toBe(
      true,
    );
  });

  test.each([
    "",
    "12345",
    "1234567",
    "+1 415",
    "1234567890123456",
    "+1 415 555 1234 56789",
    "++14155551234",
    "1+4155551234",
    "415-555-1234 ext 12",
    "call me",
    "hgjuit879",
    "278@$90>",
    "25192599879079074121",
  ])("%p is still refused", (typed: string) => {
    expect(() => {
      new Phone(typed);
    }).toThrowError(BadDataException);
  });

  test("a value far longer than any number is refused without being read through", () => {
    expect(() => {
      new Phone(`+${" ".repeat(1024 * 1024)}1`);
    }).toThrowError(BadDataException);
  });
});

/*
 * Phone.isSameNumber is what decides that a number a person verified for SMS
 * is the number they are adding for calls (UserCallService
 * .isNumberVerifiedForSms). A number is stored as it was typed, so the same
 * line can be two different strings; a false "same" would make a number live
 * that nobody proved, so anything doubtful is "not the same".
 */
describe("Phone.isSameNumber", () => {
  test("the same number typed the same way is the same", () => {
    expect(Phone.isSameNumber("+15551230100", "+15551230100")).toBe(true);
    expect(
      Phone.isSameNumber(new Phone("+15551230100"), new Phone("+15551230100")),
    ).toBe(true);
  });

  test("spaces, dashes, dots and brackets do not make a different number", () => {
    expect(Phone.isSameNumber("+1 (555) 123-0100", "+15551230100")).toBe(true);
    expect(Phone.isSameNumber("+1.555.123.0100", "+1-555-123-0100")).toBe(true);
    expect(Phone.isSameNumber("+65 9066 5484", new Phone("+6590665484"))).toBe(
      true,
    );
  });

  test("a different number is not the same", () => {
    expect(Phone.isSameNumber("+15551230100", "+15551230101")).toBe(false);
    expect(Phone.isSameNumber("+6590665484", "+6590665485")).toBe(false);
  });

  test("a number with its country code and one without are not matched", () => {
    expect(Phone.isSameNumber("+15551230100", "5551230100")).toBe(false);
  });

  test("nothing is never the same as anything, itself included", () => {
    expect(Phone.isSameNumber(undefined, "+15551230100")).toBe(false);
    expect(Phone.isSameNumber("+15551230100", null)).toBe(false);
    expect(Phone.isSameNumber(undefined, undefined)).toBe(false);
    expect(Phone.isSameNumber("", "")).toBe(false);
    expect(Phone.isSameNumber("+", "+")).toBe(false);
  });
});
