import EmailAddressList from "../../../Utils/Email/EmailAddressList";
import { describe, expect, test } from "@jest/globals";

/*
 * The addresses in a To or Cc header. The inbound email webhook routes mail to
 * monitors and workflows by them, and the Incoming Email trigger hands them to
 * a workflow as one line, so a display name read as a recipient - or a real
 * recipient missed - would send an email to the wrong place or nowhere.
 */

describe("EmailAddressList.parse", () => {
  test("reads a single bare address", () => {
    expect(EmailAddressList.parse("jane@example.com")).toEqual([
      "jane@example.com",
    ]);
  });

  test('reads the address out of "Name <address>"', () => {
    expect(EmailAddressList.parse("Jane Doe <jane@example.com>")).toEqual([
      "jane@example.com",
    ]);
  });

  test("reads every address of a list, in order", () => {
    expect(
      EmailAddressList.parse(
        "Jane Doe <jane@example.com>, ops@example.com, <alerts@example.org>",
      ),
    ).toEqual(["jane@example.com", "ops@example.com", "alerts@example.org"]);
  });

  test("a comma inside a quoted display name does not split the mailbox", () => {
    expect(
      EmailAddressList.parse(
        '"Doe, Jane" <jane@example.com>, "Ops; Night shift" <ops@example.com>',
      ),
    ).toEqual(["jane@example.com", "ops@example.com"]);
  });

  test("an escaped quote inside a display name keeps the name whole", () => {
    expect(
      EmailAddressList.parse(
        '"Jane \\"JD\\", Doe" <jane@example.com>, ops@example.com',
      ),
    ).toEqual(["jane@example.com", "ops@example.com"]);
  });

  test("semicolons separate too, the way Outlook writes a list", () => {
    expect(
      EmailAddressList.parse("jane@example.com; ops@example.com;"),
    ).toEqual(["jane@example.com", "ops@example.com"]);
  });

  test("lowercases, so addresses compare the way the inbound path compares them", () => {
    expect(EmailAddressList.parse("Jane <Jane.Doe@Example.COM>")).toEqual([
      "jane.doe@example.com",
    ]);
  });

  test("lists an address once, however often it is written", () => {
    expect(
      EmailAddressList.parse(
        "jane@example.com, Jane <JANE@example.com>, jane@example.com",
      ),
    ).toEqual(["jane@example.com"]);
  });

  test("reads the mailboxes of a group, and nothing of the group's name", () => {
    expect(
      EmailAddressList.parse(
        "Ops team: jane@example.com, Bob <bob@example.com>;, carol@example.com",
      ),
    ).toEqual(["jane@example.com", "bob@example.com", "carol@example.com"]);
  });

  test("an empty group names nobody", () => {
    expect(EmailAddressList.parse("undisclosed-recipients:;")).toEqual([]);
  });

  test("a comment is not part of the address", () => {
    expect(
      EmailAddressList.parse("jane@example.com (Jane Doe), ops@example.com"),
    ).toEqual(["jane@example.com", "ops@example.com"]);
  });

  test.each([null, undefined, "", "   ", "not an address", "Jane Doe"])(
    "finds nothing in %p",
    (header: string | null | undefined) => {
      expect(EmailAddressList.parse(header)).toEqual([]);
    },
  );

  test("leaves out what is not an address and keeps what is", () => {
    expect(
      EmailAddressList.parse("Jane Doe, <>, @example.com, ops@example.com"),
    ).toEqual(["ops@example.com"]);
  });

  test("keeps plus-addressed and dotted local parts as they are", () => {
    expect(
      EmailAddressList.parse(
        "jane.doe+alerts@example.com, a_b-c@sub.example.org",
      ),
    ).toEqual(["jane.doe+alerts@example.com", "a_b-c@sub.example.org"]);
  });
});

describe("EmailAddressList.merge", () => {
  test("joins lists in order, trimmed, lowercased and once each", () => {
    expect(
      EmailAddressList.merge(
        ["jane@example.com", " OPS@example.com "],
        undefined,
        ["ops@example.com", "bob@example.com"],
        null,
        [],
      ),
    ).toEqual(["jane@example.com", "ops@example.com", "bob@example.com"]);
  });

  test("drops empty entries", () => {
    expect(EmailAddressList.merge(["", "  ", "jane@example.com"])).toEqual([
      "jane@example.com",
    ]);
  });
});

describe("EmailAddressList.format", () => {
  test("writes the addresses as one line", () => {
    expect(
      EmailAddressList.format(["jane@example.com", "ops@example.com"]),
    ).toBe("jane@example.com, ops@example.com");
  });

  test("is empty for no addresses", () => {
    expect(EmailAddressList.format([])).toBe("");
    expect(EmailAddressList.format(undefined)).toBe("");
  });

  test("round-trips through parse", () => {
    const addresses: Array<string> = EmailAddressList.parse(
      '"Doe, Jane" <jane@example.com>, ops@example.com',
    );

    expect(EmailAddressList.parse(EmailAddressList.format(addresses))).toEqual(
      addresses,
    );
  });
});
