import {
  EditableDropdownOption,
  getDropdownOptionRenames,
  getDropdownOptionText,
  getDuplicateDropdownOptionTexts,
  getRetiredDropdownOptionValues,
  isRenamedDropdownOption,
  moveDropdownOption,
  RemovedDropdownOption,
  RetiredDropdownOptionValue,
} from "../../../../UI/Components/CustomFields/DropdownOptionsEditState";
import { CustomFieldDropdownOption } from "../../../../Types/CustomField/CustomFieldDropdownOption";
import { CustomFieldOptionUsage } from "../../../../Types/CustomField/CustomFieldOptionEdit";
import { describe, expect, test } from "@jest/globals";

/*
 * What the option editor works out from its rows while a saved dropdown
 * field is edited (#4564): which rows are renames, which values records hold
 * that the field will no longer offer (and how many records hold them),
 * what the save renames, and which rows repeat another's text.
 */

const ORIGINAL: Array<CustomFieldDropdownOption> = [
  { value: "Facility A", color: "#ef4444" },
  { value: "Facility B" },
  { value: "Facility C", color: "#16a34a" },
];

// The rows as the editor opens them: each saved option, with its text as it was.
function opened(): Array<EditableDropdownOption> {
  return ORIGINAL.map(
    (
      option: CustomFieldDropdownOption,
      index: number,
    ): EditableDropdownOption => {
      const row: EditableDropdownOption = {
        id: index,
        value: option.value,
        originalValue: option.value,
      };

      if (option.color) {
        row.color = option.color;
      }

      return row;
    },
  );
}

const USAGE: CustomFieldOptionUsage = {
  values: [
    { value: "Facility A", count: 12 },
    { value: "Facility B", count: 4 },
    { value: "Old Site", count: 3 },
    { value: "Ancient", count: 1 },
  ],
  copiedBy: [],
};

function retiredValues(
  entries: Array<RetiredDropdownOptionValue>,
): Array<[string, number | undefined, boolean]> {
  return entries.map(
    (
      entry: RetiredDropdownOptionValue,
    ): [string, number | undefined, boolean] => {
      return [entry.value, entry.count, entry.wasOption];
    },
  );
}

describe("getDropdownOptionText and isRenamedDropdownOption", () => {
  test("a row saves as its text, trimmed", () => {
    expect(getDropdownOptionText({ value: "  Facility A " })).toBe(
      "Facility A",
    );
    expect(getDropdownOptionText({ value: "" })).toBe("");
  });

  test("a saved option whose text changed is a rename; one added in the editor never is", () => {
    expect(
      isRenamedDropdownOption({
        id: 0,
        value: "Facility Alpha",
        originalValue: "Facility A",
      }),
    ).toBe(true);

    // The same text, give or take spaces: no rename.
    expect(
      isRenamedDropdownOption({
        id: 0,
        value: " Facility A ",
        originalValue: "Facility A",
      }),
    ).toBe(false);

    // Cleared: taken out, not renamed to nothing.
    expect(
      isRenamedDropdownOption({
        id: 0,
        value: " ",
        originalValue: "Facility A",
      }),
    ).toBe(false);

    expect(isRenamedDropdownOption({ id: 9, value: "Facility D" })).toBe(false);
  });
});

describe("getDuplicateDropdownOptionTexts", () => {
  test("the texts more than one row has, trimmed, empty rows not counted", () => {
    expect([
      ...getDuplicateDropdownOptionTexts([
        { value: "Low" },
        { value: " Low" },
        { value: "High" },
        { value: "" },
        { value: "  " },
        { value: "high" },
      ]),
    ]).toEqual(["Low"]);

    expect(getDuplicateDropdownOptionTexts(ORIGINAL).size).toBe(0);
  });
});

describe("getRetiredDropdownOptionValues", () => {
  test("nothing changed: only the values records hold that were never options", () => {
    expect(
      retiredValues(
        getRetiredDropdownOptionValues({
          originalOptions: ORIGINAL,
          options: opened(),
          removed: [],
          usage: USAGE,
        }),
      ),
    ).toEqual([
      ["Old Site", 3, false],
      ["Ancient", 1, false],
    ]);
  });

  test("an option taken out is listed first, with its count, its color and how to put it back", () => {
    const rows: Array<EditableDropdownOption> = opened();
    const removed: Array<RemovedDropdownOption> = [
      { option: rows[0]!, index: 0 },
    ];

    const retired: Array<RetiredDropdownOptionValue> =
      getRetiredDropdownOptionValues({
        originalOptions: ORIGINAL,
        options: rows.slice(1),
        removed: removed,
        usage: USAGE,
      });

    expect(retired[0]).toEqual({
      value: "Facility A",
      color: "#ef4444",
      count: 12,
      wasOption: true,
      removed: removed[0],
    });
    expect(retiredValues(retired)).toEqual([
      ["Facility A", 12, true],
      ["Old Site", 3, false],
      ["Ancient", 1, false],
    ]);
  });

  test("an option whose text was cleared is taken out too", () => {
    const rows: Array<EditableDropdownOption> = opened();
    rows[1] = { ...rows[1]!, value: "   " };

    expect(
      retiredValues(
        getRetiredDropdownOptionValues({
          originalOptions: ORIGINAL,
          options: rows,
          removed: [],
          usage: USAGE,
        }),
      )[0],
    ).toEqual(["Facility B", 4, true]);
  });

  test("a renamed option is not taken out: its records follow it", () => {
    const rows: Array<EditableDropdownOption> = opened();
    rows[0] = { ...rows[0]!, value: "Facility Alpha" };

    expect(
      retiredValues(
        getRetiredDropdownOptionValues({
          originalOptions: ORIGINAL,
          options: rows,
          removed: [],
          usage: USAGE,
        }),
      ).map((entry: [string, number | undefined, boolean]): string => {
        return entry[0];
      }),
    ).not.toContain("Facility A");
  });

  test("a value another row offers again is not retired", () => {
    const rows: Array<EditableDropdownOption> = opened();
    const removed: Array<RemovedDropdownOption> = [
      { option: rows[1]!, index: 1 },
    ];

    // Facility B taken out, and typed into a new row; Old Site typed into another.
    const next: Array<EditableDropdownOption> = [
      rows[0]!,
      rows[2]!,
      { id: 10, value: "Facility B" },
      { id: 11, value: "Old Site " },
    ];

    expect(
      retiredValues(
        getRetiredDropdownOptionValues({
          originalOptions: ORIGINAL,
          options: next,
          removed: removed,
          usage: USAGE,
        }),
      ),
    ).toEqual([["Ancient", 1, false]]);
  });

  test("with counts, an option nobody chose touches nothing and is not listed", () => {
    const rows: Array<EditableDropdownOption> = opened();

    expect(
      getRetiredDropdownOptionValues({
        originalOptions: ORIGINAL,
        options: rows.slice(0, 2),
        removed: [{ option: rows[2]!, index: 2 }],
        usage: USAGE,
      }).map((entry: RetiredDropdownOptionValue): string => {
        return entry.value;
      }),
    ).toEqual(["Old Site", "Ancient"]);
  });

  test("without counts, every option taken out is listed, as some record may hold it", () => {
    const rows: Array<EditableDropdownOption> = opened();

    for (const usage of [null, undefined]) {
      expect(
        retiredValues(
          getRetiredDropdownOptionValues({
            originalOptions: ORIGINAL,
            options: rows.slice(0, 2),
            removed: [{ option: rows[2]!, index: 2 }],
            usage: usage,
          }),
        ),
      ).toEqual([["Facility C", undefined, true]]);
    }
  });

  test("a value is listed once, however it is reached", () => {
    expect(
      getRetiredDropdownOptionValues({
        originalOptions: [...ORIGINAL, { value: "Facility A" }],
        options: [],
        removed: [],
        usage: {
          values: [
            { value: "Facility A", count: 2 },
            { value: "Old Site", count: 1 },
            { value: "Old Site", count: 1 },
          ],
          copiedBy: [],
        },
      }).map((entry: RetiredDropdownOptionValue): string => {
        return entry.value;
      }),
    ).toEqual(["Facility A", "Old Site"]);
  });
});

describe("getDropdownOptionRenames", () => {
  test("every saved option whose text changed, as it reads now", () => {
    const rows: Array<EditableDropdownOption> = opened();
    rows[0] = { ...rows[0]!, value: " Facility Alpha " };
    rows[2] = { ...rows[2]!, value: "Facility Gamma" };

    expect(
      getDropdownOptionRenames({
        options: rows,
        retired: [],
        replacements: {},
      }),
    ).toEqual([
      { from: "Facility A", to: "Facility Alpha" },
      { from: "Facility C", to: "Facility Gamma" },
    ]);
  });

  test("a swap is two renames, sent together", () => {
    const rows: Array<EditableDropdownOption> = opened();
    rows[0] = { ...rows[0]!, value: "Facility B" };
    rows[1] = { ...rows[1]!, value: "Facility A" };

    expect(
      getDropdownOptionRenames({
        options: rows,
        retired: [],
        replacements: {},
      }),
    ).toEqual([
      { from: "Facility A", to: "Facility B" },
      { from: "Facility B", to: "Facility A" },
    ]);
  });

  test("a retired value an option was picked for becomes that option, as the row reads now", () => {
    const rows: Array<EditableDropdownOption> = opened();
    rows[2] = { ...rows[2]!, value: "Facility Gamma" };

    const retired: Array<RetiredDropdownOptionValue> = [
      { value: "Old Site", count: 3, wasOption: false },
      { value: "Ancient", count: 1, wasOption: false },
    ];

    expect(
      getDropdownOptionRenames({
        options: rows,
        retired: retired,
        // Old Site onto the renamed row; Ancient kept.
        replacements: { "Old Site": rows[2]!.id, Ancient: undefined },
      }),
    ).toEqual([
      { from: "Facility C", to: "Facility Gamma" },
      { from: "Old Site", to: "Facility Gamma" },
    ]);
  });

  test("a pick whose row is gone, or empty, renames nothing", () => {
    const rows: Array<EditableDropdownOption> = opened();
    rows[1] = { ...rows[1]!, value: "" };

    expect(
      getDropdownOptionRenames({
        options: rows,
        retired: [
          { value: "Old Site", count: 3, wasOption: false },
          { value: "Ancient", count: 1, wasOption: false },
        ],
        replacements: { "Old Site": 99, Ancient: rows[1]!.id },
      }),
    ).toEqual([]);
  });

  test("a pick for a value that is no longer retired is ignored", () => {
    expect(
      getDropdownOptionRenames({
        options: opened(),
        retired: [],
        replacements: { "Old Site": 0 },
      }),
    ).toEqual([]);
  });

  test("a value is renamed once at most: the first it is given wins", () => {
    const rows: Array<EditableDropdownOption> = opened();
    rows[0] = { ...rows[0]!, value: "Facility Alpha" };

    expect(
      getDropdownOptionRenames({
        options: rows,
        retired: [{ value: "Facility A", count: 12, wasOption: true }],
        replacements: { "Facility A": rows[1]!.id },
      }),
    ).toEqual([{ from: "Facility A", to: "Facility Alpha" }]);
  });

  test("a value such as __proto__ or constructor is a value like any other", () => {
    expect(
      getDropdownOptionRenames({
        options: opened(),
        retired: [{ value: "constructor", count: 1, wasOption: false }],
        replacements: {},
      }),
    ).toEqual([]);

    expect(
      getDropdownOptionRenames({
        options: opened(),
        retired: [{ value: "__proto__", count: 1, wasOption: false }],
        replacements: JSON.parse('{"__proto__": 0}') as Record<
          string,
          number | undefined
        >,
      }),
    ).toEqual([{ from: "__proto__", to: "Facility A" }]);
  });
});

describe("moveDropdownOption", () => {
  test("moves one row to where it was dropped", () => {
    expect(moveDropdownOption(["A", "B", "C", "D"], 3, 0)).toEqual([
      "D",
      "A",
      "B",
      "C",
    ]);
    expect(moveDropdownOption(["A", "B", "C", "D"], 0, 2)).toEqual([
      "B",
      "C",
      "A",
      "D",
    ]);
  });

  test("the same place, or one off the list, changes nothing and hands the list back", () => {
    const list: Array<string> = ["A", "B"];

    expect(moveDropdownOption(list, 1, 1)).toBe(list);
    expect(moveDropdownOption(list, -1, 0)).toBe(list);
    expect(moveDropdownOption(list, 0, 2)).toBe(list);
    expect(moveDropdownOption(list, 5, 0)).toBe(list);
  });

  test("does not change the list it was handed", () => {
    const list: Array<string> = ["A", "B", "C"];

    moveDropdownOption(list, 0, 2);

    expect(list).toEqual(["A", "B", "C"]);
  });
});
