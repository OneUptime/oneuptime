import {
  customFieldValueToDate,
  customFieldValueToText,
  formatCustomFieldBoolean,
  formatCustomFieldCalendarDate,
} from "../../../Types/CustomField/CustomFieldValueFormat";
import { sortCustomFieldDefinitions } from "../../../Types/CustomField/CustomFieldOrder";
import { sortCustomFieldDefinitions as sortFromForms } from "../../../UI/Components/CustomFields/CustomFieldFormFields";
import { describe, expect, test } from "@jest/globals";

/*
 * How a stored custom field value reads as words, shared by an incident
 * note's placeholders and the status page subscriber messages, and the order
 * fields are shown in, shared by the dashboard and the server.
 */

describe("customFieldValueToText", () => {
  test.each([
    [undefined, ""],
    [null, ""],
    ["", ""],
    ["Site 03", "Site 03"],
    [0, "0"],
    [12.5, "12.5"],
    [false, "false"],
    [["Site 03", "", null, "Site 07"], "Site 03, Site 07"],
    [[], ""],
    [new Date("2026-09-27T14:05:00.000Z"), "2026-09-27T14:05:00.000Z"],
    [new Date("not a date"), ""],
    [{ a: 1 }, '{"a":1}'],
  ] as Array<[unknown, string]>)(
    "%p reads as %p",
    (value: unknown, text: string) => {
      expect(customFieldValueToText(value)).toBe(text);
    },
  );
});

describe("customFieldValueToDate", () => {
  test("reads an ISO string and a Date, and nothing else", () => {
    expect(
      customFieldValueToDate(" 2026-09-27T14:05:00.000Z ")?.toISOString(),
    ).toBe("2026-09-27T14:05:00.000Z");
    expect(
      customFieldValueToDate(new Date("2026-09-27T14:05:00.000Z"))?.getTime(),
    ).toBe(Date.parse("2026-09-27T14:05:00.000Z"));
    expect(customFieldValueToDate("soon")).toBeNull();
    expect(customFieldValueToDate("")).toBeNull();
    expect(customFieldValueToDate(12)).toBeNull();
    expect(customFieldValueToDate(new Date("x"))).toBeNull();
  });
});

describe("formatCustomFieldBoolean", () => {
  test.each([
    [true, "Yes"],
    [false, "No"],
    ["true", "Yes"],
    ["false", "No"],
    ["maybe", "maybe"],
    [1, "1"],
  ] as Array<[unknown, string]>)(
    "%p reads as %p",
    (value: unknown, text: string) => {
      expect(formatCustomFieldBoolean(value)).toBe(text);
    },
  );
});

describe("formatCustomFieldCalendarDate", () => {
  test.each([
    // Midnight UTC is the picked day, even for a reader west of UTC.
    ["2026-09-27T00:00:00.000Z", "2026-09-27"],
    ["2026-09-27", "2026-09-27"],
    [" 2026-09-27T23:59:59.000Z", "2026-09-27"],
    [new Date("2026-09-27T12:00:00.000Z"), "2026-09-27"],
    ["next week", "next week"],
  ] as Array<[unknown, string]>)(
    "%p reads as %p",
    (value: unknown, text: string) => {
      expect(formatCustomFieldCalendarDate(value)).toBe(text);
    },
  );
});

describe("sortCustomFieldDefinitions", () => {
  test("is the one the forms use", () => {
    expect(sortFromForms).toBe(sortCustomFieldDefinitions);
  });

  test("orders by sortOrder, lowest first, then keeps the given order", () => {
    const sorted: Array<{ name: string; sortOrder?: number | null }> =
      sortCustomFieldDefinitions([
        { name: "none-a" },
        { name: "two", sortOrder: 2 },
        { name: "one", sortOrder: 1 },
        { name: "none-b", sortOrder: null },
        { name: "two-b", sortOrder: 2 },
        { name: "nan", sortOrder: Number.NaN },
      ]);

    expect(
      sorted.map((definition: { name: string }) => {
        return definition.name;
      }),
    ).toEqual(["one", "two", "two-b", "none-a", "none-b", "nan"]);
  });
});
