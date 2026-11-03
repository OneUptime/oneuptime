import { describe, expect, test } from "@jest/globals";
import {
  BULK_ADD_EMAIL_NOT_VALID,
  BULK_ADD_PHONE_NOT_VALID,
  BULK_ADD_RESULT_LABELS,
  StatusPageBulkAddEntry,
  getBulkCsvEntries,
  getBulkEmailEntries,
  getBulkPhoneEntries,
  hasBulkAddEntryToAdd,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageBulkAddEntries";

/*
 * WHAT ADD IN BULK ADDS (fu-bulk-actions).
 *
 * Add in Bulk on a status page's subscriber lists and on its private users
 * reads what was pasted, or a CSV file's rows, as one entry per line, in
 * the order they were written. Every entry is accounted for in the result:
 * a line that is not an address or a number is skipped with why - nothing
 * is sent for it - and a line that says the same as one before it is added
 * once. The pages parsed this each in a parser of their own, and reported
 * the skipped lines only as a count.
 */

function values(entries: Array<StatusPageBulkAddEntry>): Array<string> {
  return entries.map((entry: StatusPageBulkAddEntry): string => {
    return entry.value;
  });
}

function skipped(
  entries: Array<StatusPageBulkAddEntry>,
): Array<[string, string]> {
  return entries
    .filter((entry: StatusPageBulkAddEntry): boolean => {
      return Boolean(entry.skippedReason);
    })
    .map((entry: StatusPageBulkAddEntry): [string, string] => {
      return [entry.value, entry.skippedReason!];
    });
}

describe("email addresses pasted into Add in Bulk", () => {
  test("one a line, or separated by commas, semicolons or spaces, in the order pasted", () => {
    expect(
      values(
        getBulkEmailEntries(
          "ada@example.com\nbob@example.com, cy@example.com;dee@example.com  eve@example.com",
        ),
      ),
    ).toEqual([
      "ada@example.com",
      "bob@example.com",
      "cy@example.com",
      "dee@example.com",
      "eve@example.com",
    ]);
  });

  test("an address is kept in lower case, as the server keeps it, and added once however it is written", () => {
    const entries: Array<StatusPageBulkAddEntry> = getBulkEmailEntries(
      "Ada@Example.com\nada@example.com\nADA@EXAMPLE.COM\nbob@example.com",
    );

    expect(values(entries)).toEqual(["ada@example.com", "bob@example.com"]);
    expect(skipped(entries)).toEqual([]);
  });

  test("a line that is not an address is skipped as written, with why, where it was pasted", () => {
    const entries: Array<StatusPageBulkAddEntry> = getBulkEmailEntries(
      "ada@example.com\nNot-An-Address\nbob@example.com\n@example.com",
    );

    expect(values(entries)).toEqual([
      "ada@example.com",
      "Not-An-Address",
      "bob@example.com",
      "@example.com",
    ]);
    expect(skipped(entries)).toEqual([
      ["Not-An-Address", BULK_ADD_EMAIL_NOT_VALID],
      ["@example.com", BULK_ADD_EMAIL_NOT_VALID],
    ]);
    expect(BULK_ADD_EMAIL_NOT_VALID).toBe("Email is not valid.");
  });

  test("a line that is not an address, pasted twice, is listed once", () => {
    expect(skipped(getBulkEmailEntries("oops\nOOPS\nada@example.com"))).toEqual(
      [["oops", BULK_ADD_EMAIL_NOT_VALID]],
    );
  });

  test("empty lines and blanks around a line are nothing", () => {
    expect(
      values(getBulkEmailEntries("\n\n   ada@example.com   \n\n,,;\n")),
    ).toEqual(["ada@example.com"]);
    expect(getBulkEmailEntries("")).toEqual([]);
    expect(getBulkEmailEntries("   \n  ")).toEqual([]);
  });
});

describe("phone numbers pasted into Add in Bulk", () => {
  test("one a line, or separated by commas or semicolons - never by the spaces a number is written with", () => {
    expect(
      values(
        getBulkPhoneEntries(
          "+1 415 555 0100\n+44 20 7946 0958, +61 2 9374 4000;+33 1 42 68 53 00",
        ),
      ),
    ).toEqual([
      "+1 415 555 0100",
      "+44 20 7946 0958",
      "+61 2 9374 4000",
      "+33 1 42 68 53 00",
    ]);
  });

  test("one number once, however it is written: the page takes each number once", () => {
    const entries: Array<StatusPageBulkAddEntry> = getBulkPhoneEntries(
      "+14155550100\n+1 415 555 0100\n+1 (415) 555-0100\n+442079460958",
    );

    // The first spelling is the one added, as it was written.
    expect(values(entries)).toEqual(["+14155550100", "+442079460958"]);
  });

  test("a line that is not a number is skipped as written, with why", () => {
    const entries: Array<StatusPageBulkAddEntry> = getBulkPhoneEntries(
      "+14155550100\ncall me\n12",
    );

    expect(skipped(entries)).toEqual([
      ["call me", BULK_ADD_PHONE_NOT_VALID],
      ["12", BULK_ADD_PHONE_NOT_VALID],
    ]);
    expect(BULK_ADD_PHONE_NOT_VALID).toBe("Phone number is not valid.");
  });
});

describe("a CSV file's rows in Add in Bulk", () => {
  test("each row an entry, in the file's order, named by its URL and keeping its other columns", () => {
    const entries: Array<StatusPageBulkAddEntry> = getBulkCsvEntries(
      [
        {
          workspaceName: "Acme",
          webhookUrl: " https://hooks.slack.com/services/T1/B1/one ",
        },
        {
          workspaceName: "Acme",
          webhookUrl: "https://hooks.slack.com/services/T1/B2/two",
        },
        { workspaceName: "Missing URL" },
      ],
      "webhookUrl",
    );

    expect(values(entries)).toEqual([
      "https://hooks.slack.com/services/T1/B1/one",
      "https://hooks.slack.com/services/T1/B2/two",
      "",
    ]);
    expect(entries[0]!.row?.["workspaceName"]).toBe("Acme");
    // A URL is checked as it is added, by the server's own rules.
    expect(skipped(entries)).toEqual([]);
  });
});

describe("whether Add in Bulk has anything to send", () => {
  test("only when one entry is not skipped", () => {
    expect(hasBulkAddEntryToAdd([])).toBe(false);
    expect(hasBulkAddEntryToAdd(getBulkEmailEntries("nope\nnot this"))).toBe(
      false,
    );
    expect(
      hasBulkAddEntryToAdd(getBulkEmailEntries("nope\nada@example.com")),
    ).toBe(true);
  });
});

describe("the result's words", () => {
  test("say what Add in Bulk did: added, not added, skipped", () => {
    expect(BULK_ADD_RESULT_LABELS).toEqual({
      succeeded: {
        one: "{{count}} {{itemName}} added",
        other: "{{count}} {{itemsName}} added",
      },
      failed: {
        one: "{{count}} {{itemName}} not added",
        other: "{{count}} {{itemsName}} not added",
      },
      unchanged: {
        one: "{{count}} {{itemName}} skipped",
        other: "{{count}} {{itemsName}} skipped",
      },
    });
  });
});
