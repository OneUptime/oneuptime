import { describe, expect, test } from "@jest/globals";
import CustomFieldFeedChange, {
  CustomFieldFeedChangeItem,
} from "../../../../Server/Utils/CustomField/CustomFieldFeedChange";
import { CustomFieldDefinition } from "../../../../Types/CustomField/CustomFieldDefinition";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import OneUptimeDate from "../../../../Types/Date";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * WHAT AN UPDATE CHANGED OF AN INCIDENT'S CUSTOM FIELDS, IN ITS FEED.
 *
 * Customer feedback asked to set an incident's custom fields from Slack.
 * Setting one there - or on the Custom Fields card, or through the API - left
 * no trace in the incident's feed, and so none in its Slack and Microsoft
 * Teams channels. The "updated" feed item now lists the fields whose value
 * changed, each with its new value as a person reads it, or that it was
 * cleared. A bag written back as it was (the Custom Fields card sends every
 * field with each save) lists nothing.
 */

const DEFINITIONS: Array<CustomFieldDefinition> = [
  {
    name: "Customer Impact",
    customFieldType: CustomFieldType.Dropdown,
    dropdownOptions: "High\nMedium\nLow",
  },
  { name: "Ticket", customFieldType: CustomFieldType.Text },
  { name: "Affected Users", customFieldType: CustomFieldType.Number },
  { name: "Public", customFieldType: CustomFieldType.Boolean },
  {
    name: "Regions",
    customFieldType: CustomFieldType.MultiSelectDropdown,
    dropdownOptions: "eu-west\nus-east\nap-south",
  },
  { name: "Due", customFieldType: CustomFieldType.Date },
  { name: "Started", customFieldType: CustomFieldType.DateTime },
  { name: "Summary", customFieldType: CustomFieldType.Markdown },
];

const STORED: Record<string, unknown> = {
  "Customer Impact": "Medium",
  Ticket: "OPS-118",
  "Affected Users": 1200,
  Public: false,
  Regions: ["eu-west", "us-east"],
  Due: "2026-10-20",
  Started: "2026-10-15T09:30:00.000Z",
  Summary: "Checkout fails for some cards.",
};

function changesOf(
  written: unknown,
  before: unknown = STORED,
): Array<CustomFieldFeedChangeItem> {
  return CustomFieldFeedChange.getChanges({
    written: written,
    before: before,
    definitions: DEFINITIONS,
  });
}

describe("CustomFieldFeedChange.getChanges: only what really changed", () => {
  test("the bag written back as it is - as the Custom Fields card sends it with every save - changes nothing", () => {
    expect(changesOf({ ...STORED })).toEqual([]);
  });

  test("each field's value is compared as its type reads it", () => {
    expect(
      changesOf({
        ...STORED,
        // "1200" and 1200 are one number.
        "Affected Users": "1200",
        // "false" from an older form is No.
        Public: "false",
        // The same options in another order are one selection.
        Regions: ["us-east", "eu-west"],
        // The day the dashboard stores as the picked day's midnight instant.
        Due: "2026-10-20T00:00:00.000Z",
        // The same instant, written another way.
        Started: "2026-10-15T09:30:00Z",
      }),
    ).toEqual([]);
  });

  test("a field changed is listed with its new value, in the order the definitions list them - not the bag's", () => {
    /*
     * The database keeps a bag's keys in an order of its own (shortest
     * first), so the Custom Fields card writes them back in any order: the
     * feed lists them as the card does.
     */
    const written: Record<string, unknown> = Object.fromEntries(
      Object.entries({
        ...STORED,
        Ticket: "OPS-200",
        "Customer Impact": "High",
        Summary: "Fixed for most cards.",
      }).reverse(),
    );

    expect(changesOf(written)).toEqual([
      { name: "Customer Impact", value: "High" },
      { name: "Ticket", value: "OPS-200" },
      { name: "Summary", value: "Fixed for most cards." },
    ]);
  });

  test("a field no definition names comes after those that are, in the order the bag lists them", () => {
    expect(
      changesOf({
        "Old Field": "b",
        ...STORED,
        "Older Field": "c",
        Ticket: "OPS-200",
      }),
    ).toEqual([
      { name: "Ticket", value: "OPS-200" },
      { name: "Old Field", value: "b" },
      { name: "Older Field", value: "c" },
    ]);
  });

  test("a field emptied - an empty text, null, an empty list - is listed as cleared (null)", () => {
    expect(
      changesOf({
        ...STORED,
        Ticket: "",
        Summary: null,
        Regions: [],
      }),
    ).toEqual([
      { name: "Ticket", value: null },
      { name: "Regions", value: null },
      { name: "Summary", value: null },
    ]);
  });

  test("a field left out of a bag the update writes is gone from the incident: cleared, in its place among the fields", () => {
    const rest: Record<string, unknown> = { ...STORED };
    delete rest["Ticket"];
    delete rest["Due"];

    expect(changesOf({ ...rest, Public: true })).toEqual([
      { name: "Ticket", value: null },
      { name: "Public", value: true },
      { name: "Due", value: null },
    ]);
  });

  test("a field that held nothing and is left out, or written empty, changed nothing", () => {
    expect(
      changesOf(
        { Ticket: "OPS-1", Summary: "" },
        { Ticket: "OPS-1", Summary: "", Due: null, Regions: [] },
      ),
    ).toEqual([]);
  });

  test("a value set where the incident held none", () => {
    expect(changesOf({ Ticket: "OPS-1" }, {})).toEqual([
      { name: "Ticket", value: "OPS-1" },
    ]);
    // Nothing read before the update: every value written is new.
    expect(changesOf({ Ticket: "OPS-1" }, null)).toEqual([
      { name: "Ticket", value: "OPS-1" },
    ]);
  });

  test("a field no definition names any more (deleted) is compared as text", () => {
    expect(
      changesOf(
        { "Old Field": "a", "Older Field": 7 },
        { "Old Field": "a", "Older Field": "8" },
      ),
    ).toEqual([{ name: "Older Field", value: 7 }]);
  });

  test.each([
    ["nothing (the update does not write the custom fields)", undefined],
    ["null", null],
    ["a list", ["Ticket"]],
    ["text", "Ticket=OPS-1"],
    ["a date", new Date("2026-10-15T00:00:00.000Z")],
  ])(
    "written as %s: no change is listed",
    (_name: string, written: unknown) => {
      expect(changesOf(written)).toEqual([]);
    },
  );
});

describe("CustomFieldFeedChange.getFeedMarkdown: the feed item's lines", () => {
  function markdownOf(changes: Array<CustomFieldFeedChangeItem>): string {
    return CustomFieldFeedChange.getFeedMarkdown({
      changes: changes,
      definitions: DEFINITIONS,
    }).toString();
  }

  test("a heading, then a line for each field with its new value - as the item's other headings read", () => {
    expect(
      markdownOf([
        { name: "Customer Impact", value: "High" },
        { name: "Ticket", value: null },
      ]),
    ).toBe(
      "\n\n**📝 Custom Fields**:\n\n- **Customer Impact**: High\n- **Ticket**: cleared\n",
    );
  });

  test("nothing changed: no lines at all", () => {
    expect(markdownOf([])).toBe("");
    expect(
      CustomFieldFeedChange.getFeedMarkdown({
        changes: [],
        definitions: DEFINITIONS,
      }).isEmpty(),
    ).toBe(true);
  });

  test("each value as a person reads it: Yes or No, a list, the day picked", () => {
    expect(
      markdownOf([
        { name: "Public", value: true },
        { name: "Regions", value: ["eu-west", "ap-south"] },
        { name: "Due", value: "2026-09-26T22:00:00.000Z" },
        { name: "Affected Users", value: 12.5 },
      ]),
    ).toBe(
      "\n\n**📝 Custom Fields**:\n\n- **Public**: Yes\n- **Regions**: eu-west, ap-south\n- **Due**: 2026-09-27\n- **Affected Users**: 12.5\n",
    );
  });

  test("a value is text, on one line: Markdown in it does not act, a line break does not end the bullet", () => {
    expect(
      markdownOf([
        {
          name: "Summary",
          value: "**Bold** [a link](https://evil.test)\n- not a bullet",
        },
      ]),
    ).toBe(
      "\n\n**📝 Custom Fields**:\n\n- **Summary**: \\*\\*Bold\\*\\* \\[a link\\](https://evil.test) - not a bullet\n",
    );
  });

  test("a field's name is text too", () => {
    expect(
      markdownOf([{ name: "*Impact* [x](https://evil.test)", value: "High" }]),
    ).toBe(
      "\n\n**📝 Custom Fields**:\n\n- **\\*Impact\\* \\[x\\](https://evil.test)**: High\n",
    );
  });

  test("the first 20 fields, then how many more", () => {
    const changes: Array<CustomFieldFeedChangeItem> = Array.from(
      { length: 23 },
      (_value: unknown, index: number): CustomFieldFeedChangeItem => {
        return { name: `Field ${index + 1}`, value: `v${index + 1}` };
      },
    );

    const lines: Array<string> = markdownOf(changes)
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- ");
      });

    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe("- **Field 1**: v1");
    expect(lines[19]).toBe("- **Field 20**: v20");
    expect(lines[20]).toBe("- and 3 more");
  });
});

describe("CustomFieldFeedChange.toReadableValue", () => {
  test.each([
    [CustomFieldType.Boolean, true, "Yes"],
    [CustomFieldType.Boolean, "true", "Yes"],
    [CustomFieldType.Boolean, false, "No"],
    [CustomFieldType.Date, "2026-10-20", "2026-10-20"],
    [CustomFieldType.Date, "2026-10-20T04:00:00.000Z", "2026-10-20"],
    // As the feed's other times read: "Oct 15 2026, 09:30 UTC", zone named.
    [
      CustomFieldType.DateTime,
      "2026-10-15T09:30:00.000Z",
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        new Date("2026-10-15T09:30:00.000Z"),
      ),
    ],
    // Text that is no time reads as it is.
    [CustomFieldType.DateTime, "soon", "soon"],
    [CustomFieldType.MultiSelectDropdown, ["a", "", "b"], "a, b"],
    [CustomFieldType.Number, 0, "0"],
    [CustomFieldType.Text, "  spaced   out\n\ttext ", "spaced out text"],
    [undefined, { nested: true }, '{"nested":true}'],
  ])(
    "%s %p reads %p",
    (type: CustomFieldType | undefined, value: unknown, expected: string) => {
      expect(
        CustomFieldFeedChange.toReadableValue({
          customFieldType: type,
          value: value,
        }),
      ).toBe(expected);
    },
  );

  test.each([[null], [undefined], [""], [[]]])(
    "%p reads as nothing",
    (value: unknown) => {
      expect(
        CustomFieldFeedChange.toReadableValue({
          customFieldType: CustomFieldType.Text,
          value: value,
        }),
      ).toBe("");
    },
  );

  test("a long value is cut on its line: the incident has it all", () => {
    const read: string = CustomFieldFeedChange.toReadableValue({
      customFieldType: CustomFieldType.LongText,
      value: "word ".repeat(100),
    });

    expect(Array.from(read).length).toBeLessThanOrEqual(200);
    expect(read.endsWith("…")).toBe(true);
  });

  test("a value of 400,000 characters is read in well under two seconds", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        CustomFieldFeedChange.toReadableValue({
          customFieldType: CustomFieldType.LongText,
          value: `${" \n\t".repeat(133334)}x`,
        });
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("CustomFieldFeedChange.isSame", () => {
  test.each([
    [CustomFieldType.Number, "42", 42, true],
    [CustomFieldType.Number, "42", 43, false],
    // Not numbers: compared as text.
    [CustomFieldType.Number, "lots", "lots", true],
    [
      CustomFieldType.DateTime,
      "2026-10-15T09:30:00Z",
      "2026-10-15T09:30:00.000Z",
      true,
    ],
    [
      CustomFieldType.DateTime,
      "2026-10-15T09:30:00Z",
      "2026-10-15T09:31:00Z",
      false,
    ],
    [CustomFieldType.Date, "2026-10-20", "2026-10-21", false],
    [CustomFieldType.Boolean, true, "true", true],
    [CustomFieldType.Boolean, true, false, false],
    [CustomFieldType.Text, "", null, true],
    [CustomFieldType.Text, "a", null, false],
    [CustomFieldType.MultiSelectDropdown, ["a", "b"], ["b", "a"], true],
    [CustomFieldType.MultiSelectDropdown, ["a"], ["a", "b"], false],
  ])(
    "%s: %p and %p are the same: %p",
    (type: CustomFieldType, a: unknown, b: unknown, same: boolean) => {
      expect(CustomFieldFeedChange.isSame({ type: type, a: a, b: b })).toBe(
        same,
      );
    },
  );
});
