import Email, { MAX_EMAIL_ADDRESS_LENGTH } from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import { ObjectType } from "../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * AN EMAIL VALUE IS ONE MAILBOX, AND IS READ IN TIME IN LINE WITH ITS LENGTH.
 *
 * Email.isValid decides whether a value is an address, and it runs on text an
 * unauthenticated caller sends (sign-ups, status page subscriptions, password
 * resets) and on much else besides. Two properties are pinned here:
 *
 *  1. ONE MAILBOX. The whole value must be a single address. A list, a
 *     display name with an address, a group, or any leading or trailing text
 *     is refused - not read as whichever address sits inside it, which is
 *     what a mail sender would otherwise deliver to.
 *  2. IN LINE WITH THE LENGTH. The value is capped at the longest real
 *     address (254) before any pattern runs, and the pattern itself reads a
 *     value once from left to right, so even a value built to be awkward is
 *     decided quickly.
 *
 * Every real single address accepted before is still accepted.
 * ---------------------------------------------------------------------------
 */

describe("an email value is one mailbox", () => {
  test("accepts a single address, in every real shape", () => {
    const accepted: Array<string> = [
      "user@example.com",
      "user.name+tag@example.co.uk",
      "user_name@sub.domain.example.com",
      "user-name@example.io",
      "u@e.co",
      "dev@oneuptime.com",
      "firstname.lastname@example.com",
      "o'brien@example.com",
      "a!#$%&'*+/=?^_`{|}~-b@example.com",
      '"john.doe"@example.com',
      "user@[192.168.1.1]",
    ];

    for (const value of accepted) {
      expect({ value, valid: Email.isValid(value) }).toEqual({
        value,
        valid: true,
      });
      expect(new Email(value).toString()).toEqual(value.toLowerCase());
    }
  });

  test("refuses anything that is more than one mailbox", () => {
    const refused: Array<string> = [
      "a@example.com,b@example.com",
      "a@example.com;b@example.com",
      "a@example.com b@example.com",
      "a@example.com\nb@example.com",
      "Alice <a@example.com>",
      '"Alice" <a@example.com>',
      "team: a@example.com",
      "x:victim@example.com",
      "a@example.com, b@example.com, c@example.com",
      "before a@example.com",
      "a@example.com after",
      "<a@example.com>",
    ];

    for (const value of refused) {
      expect({ value, valid: Email.isValid(value) }).toEqual({
        value,
        valid: false,
      });
      expect(() => {
        return new Email(value);
      }).toThrow(BadDataException);
    }
  });

  test("refuses the plainly malformed, as before", () => {
    for (const value of [
      "",
      "userexample.com",
      "@example.com",
      "user@",
      "user@@example.com",
      "user @example.com",
    ]) {
      expect(Email.isValid(value)).toBe(false);
    }
  });
});

describe("an email value is bounded in length", () => {
  test("refuses a value longer than the longest real address", () => {
    expect(MAX_EMAIL_ADDRESS_LENGTH).toBe(254);

    const tooLong: string = "a".repeat(64) + "@" + "b".repeat(190) + ".com";
    expect(tooLong.length).toBeGreaterThan(MAX_EMAIL_ADDRESS_LENGTH);
    expect(Email.isValid(tooLong)).toBe(false);
  });

  test("accepts a value right at the bound", () => {
    const local: string = "a".repeat(64);
    const domain: string = "b".repeat(185) + ".com"; // keeps the whole <= 254
    const value: string = `${local}@${domain}`;
    expect(value.length).toBeLessThanOrEqual(MAX_EMAIL_ADDRESS_LENGTH);
    expect(Email.isValid(value)).toBe(true);
  });
});

/*
 * The worst cases the old pattern could be made to spend unbounded time on,
 * each decided in well under two seconds now. Several of these ran for
 * minutes before, and one for 13 seconds at only 71 characters.
 */
describe("an email value is read in time in line with its length", () => {
  const LENGTH: number = 400000;

  const repeat: (unit: string, length: number) => string = (
    unit: string,
    length: number,
  ): string => {
    return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  };

  test.each([
    ["letters", repeat("a", LENGTH)],
    ["letters and dots", repeat("a.", LENGTH)],
    ["an address then dotted labels", "a@" + repeat("a.", LENGTH)],
    [
      "an open bracket then dotted digits",
      "a@[1.1.1.a:" + repeat("\\a", LENGTH),
    ],
    ["an open bracket then escapes", "6@[0.3.0.5:[" + repeat("\\.]", LENGTH)],
    ["a quoted local part of escapes", '"' + repeat("\\\\", LENGTH)],
    ["dots then a tail", repeat(".", LENGTH) + "-.aa"],
  ])("decides %s quickly", (_label: string, value: string) => {
    const startedAt: number = Date.now();
    Email.isValid(value);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  test("decides the short awkward bracket value quickly", () => {
    // 71 characters took about 13 seconds before.
    const value: string = "a@[1.1.1.a:" + "\\a".repeat(30);
    const startedAt: number = Date.now();
    Email.isValid(value);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

/*
 * A value stored before the one-mailbox check existed must still read and
 * render, but can never be written back or newly created.
 */
describe("a value stored before the check still reads, but never writes", () => {
  const legacyList: string = "a@example.com,b@example.com";

  test("fromDatabase keeps a legacy value rather than failing the read", () => {
    const email: Email | null = Email.fromDatabase(legacyList);
    expect(email).not.toBeNull();
    expect(email!.isMalformed()).toBe(true);
    expect(email!.toString()).toBe(legacyList);
  });

  test("fromJSON keeps a legacy value so it still renders", () => {
    const email: Email = Email.fromJSON({
      _type: ObjectType.Email,
      value: legacyList,
    });
    expect(email.isMalformed()).toBe(true);
    expect(email.toString()).toBe(legacyList);
  });

  test("toDatabase refuses to write a value that is not one mailbox", () => {
    const email: Email = Email.fromJSON({
      _type: ObjectType.Email,
      value: legacyList,
    });
    expect(() => {
      return Email.toDatabase(email);
    }).toThrow(BadDataException);
  });

  test("a well formed stored value reads as a normal address", () => {
    const email: Email | null = Email.fromDatabase("user@example.com");
    expect(email!.isMalformed()).toBe(false);
    expect(Email.toDatabase(email!)).toBe("user@example.com");
  });
});
