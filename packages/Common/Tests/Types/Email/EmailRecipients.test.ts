import { describe, expect, test } from "@jest/globals";
import Email from "../../../Types/Email";
import {
  getCcAddresses,
  getReplyToAddress,
  readEmailAddress,
  readEmailAddresses,
  toMailboxAddress,
} from "../../../Types/Email/EmailRecipients";

/*
 * WHO AN EMAIL IS COPIED TO, AND WHERE A REPLY GOES, AS EVERY TRANSPORT
 * SENDS THEM (issue #8893): each one mailbox, each once, never the To again.
 * App's CopiesAndRepliesOnEveryMailTransport sends them through every
 * transport; these pin the rules themselves.
 */

const TO: Email = new Email("support@oneuptime.test");

describe("toMailboxAddress", () => {
  test("one mailbox, as it is sent: trimmed, lower case", () => {
    expect(toMailboxAddress(" Jane@Acme.test ")).toBe("jane@acme.test");
    expect(toMailboxAddress(new Email("Jane@Acme.test"))).toBe(
      "jane@acme.test",
    );
  });

  test.each([
    [""],
    ["jane"],
    ["jane@acme.test, mallory@evil.test"],
    ["Jane <jane@acme.test>"],
  ])('"%s" is not one mailbox', (value: string) => {
    expect(toMailboxAddress(value)).toBeNull();
  });

  test("nothing is no address", () => {
    expect(toMailboxAddress(null)).toBeNull();
    expect(toMailboxAddress(undefined)).toBeNull();
  });

  test("a stored value that holds a list is no address, though it reads back", () => {
    const stored: Email = Email.fromDatabase(
      "jane@acme.test, mallory@evil.test",
    ) as Email;

    expect(stored.isMalformed()).toBe(true);
    expect(toMailboxAddress(stored)).toBeNull();
  });
});

describe("getCcAddresses", () => {
  test("no copies is none", () => {
    expect(getCcAddresses({ toEmail: TO })).toEqual([]);
    expect(getCcAddresses({ toEmail: TO, ccEmails: [] })).toEqual([]);
  });

  test("each copy once, in the order given", () => {
    expect(
      getCcAddresses({
        toEmail: TO,
        ccEmails: [
          new Email("jane@acme.test"),
          new Email("bob@acme.test"),
          new Email("JANE@acme.test"),
        ],
      }),
    ).toEqual(["jane@acme.test", "bob@acme.test"]);
  });

  test("never the To again: a self-hosted admin who writes to their own address gets one email", () => {
    expect(
      getCcAddresses({
        toEmail: TO,
        ccEmails: [new Email("Support@OneUptime.test")],
      }),
    ).toEqual([]);
  });

  test("a copy that is not one mailbox is left out, and the rest stay", () => {
    expect(
      getCcAddresses({
        toEmail: TO,
        ccEmails: [
          Email.fromDatabase("a@acme.test, b@acme.test") as Email,
          new Email("jane@acme.test"),
        ],
      }),
    ).toEqual(["jane@acme.test"]);
  });
});

describe("getReplyToAddress", () => {
  test("the address a reply goes to, or none", () => {
    expect(
      getReplyToAddress({ replyToEmail: new Email("Jane@acme.test") }),
    ).toBe("jane@acme.test");
    expect(getReplyToAddress({})).toBeNull();
  });
});

describe("reading them as they cross JSON", () => {
  test("a list of addresses, each one mailbox", () => {
    expect(
      readEmailAddresses([
        "jane@acme.test",
        "Jane <jane@acme.test>",
        { _type: "Email", value: "x@acme.test" },
        42,
        "bob@acme.test",
      ]).map((email: Email): string => {
        return email.toString();
      }),
    ).toEqual(["jane@acme.test", "bob@acme.test"]);
  });

  test("anything that is not a list is no addresses", () => {
    expect(readEmailAddresses("jane@acme.test")).toEqual([]);
    expect(readEmailAddresses(undefined)).toEqual([]);
    expect(readEmailAddresses(null)).toEqual([]);
  });

  test("one address, or none", () => {
    expect(readEmailAddress("jane@acme.test")?.toString()).toBe(
      "jane@acme.test",
    );
    expect(readEmailAddress("a@acme.test, b@acme.test")).toBeUndefined();
    expect(readEmailAddress(["jane@acme.test"])).toBeUndefined();
    expect(readEmailAddress(undefined)).toBeUndefined();
  });
});
