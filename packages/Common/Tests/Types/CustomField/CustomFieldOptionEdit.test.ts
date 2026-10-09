import {
  CustomFieldOptionRename,
  CustomFieldOptionRenameMap,
  CustomFieldOptionUsage,
  getCustomFieldOptionRenamesProblem,
  getCustomFieldOptionUsageCount,
  getCustomFieldOptionValues,
  MAX_DROPDOWN_OPTION_RENAMES,
  readCustomFieldOptionRenames,
  readCustomFieldOptionUsage,
  ReadCustomFieldOptionRenamesResult,
  RENAMED_DROPDOWN_OPTIONS_KEY,
  RenamedCustomFieldOptionList,
  RenamedCustomFieldOptionValue,
  renameCustomFieldOptionsInList,
  renameCustomFieldOptionValue,
  toCustomFieldOptionRenameMap,
} from "../../../Types/CustomField/CustomFieldOptionEdit";
import {
  CustomFieldDropdownOption,
  serializeCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { describe, expect, test } from "@jest/globals";

/*
 * Editing a dropdown field's options after records hold them (#4564). A
 * record stores an answer as the option's text, so the only way to tell a
 * rename from "remove one, add another" is for the write to say so: a list of
 * { from, to } pairs in its miscDataProps. These are the rules that list
 * follows, and the one mapping every store of values - records, templates,
 * saved views, form templates - is moved through.
 */

const map: (pairs: Array<[string, string]>) => CustomFieldOptionRenameMap = (
  pairs: Array<[string, string]>,
): CustomFieldOptionRenameMap => {
  return toCustomFieldOptionRenameMap(
    pairs.map(([from, to]: [string, string]): CustomFieldOptionRename => {
      return { from, to };
    }),
  );
};

describe("the key a write carries its renames under", () => {
  test("is renamedDropdownOptions, as the API documents it", () => {
    expect(RENAMED_DROPDOWN_OPTIONS_KEY).toBe("renamedDropdownOptions");
  });
});

describe("readCustomFieldOptionRenames", () => {
  test("nothing sent is no renames, and no problem", () => {
    for (const value of [undefined, null]) {
      expect(readCustomFieldOptionRenames(value)).toEqual({
        renames: [],
        problem: null,
      });
    }
  });

  test("reads the pairs in order, trimmed", () => {
    const read: ReadCustomFieldOptionRenamesResult =
      readCustomFieldOptionRenames([
        { from: " Facility A ", to: "Facility Alpha" },
        { from: "Facility B", to: "  Facility Beta" },
      ]);

    expect(read.problem).toBeNull();
    expect(read.renames).toEqual([
      { from: "Facility A", to: "Facility Alpha" },
      { from: "Facility B", to: "Facility Beta" },
    ]);
  });

  test("a pair that renames a value to itself is dropped, not refused", () => {
    expect(
      readCustomFieldOptionRenames([
        { from: "Same", to: " Same " },
        { from: "Old", to: "New" },
      ]),
    ).toEqual({ renames: [{ from: "Old", to: "New" }], problem: null });
  });

  test("ignores keys other than from and to", () => {
    expect(
      readCustomFieldOptionRenames([
        { from: "Old", to: "New", color: "#ff0000", count: 4 },
      ]).renames,
    ).toEqual([{ from: "Old", to: "New" }]);
  });

  test("anything but a list is refused whole", () => {
    for (const value of [
      "Old->New",
      { from: "Old", to: "New" },
      { Old: "New" },
      42,
      true,
    ]) {
      const read: ReadCustomFieldOptionRenamesResult =
        readCustomFieldOptionRenames(value);

      expect(read.renames).toEqual([]);
      expect(read.problem).toBe(
        'renamedDropdownOptions must be a list of { "from", "to" } pairs.',
      );
    }
  });

  test("a list with one entry that is not a pair of text is refused whole: half a rename moves some values and not others", () => {
    for (const bad of [
      "Old",
      ["Old", "New"],
      null,
      { from: "Old" },
      { to: "New" },
      { from: 1, to: "One" },
      { from: "One", to: 1 },
      { from: "Old", to: null },
    ]) {
      const read: ReadCustomFieldOptionRenamesResult =
        readCustomFieldOptionRenames([{ from: "Fine", to: "Good" }, bad]);

      expect(read.renames).toEqual([]);
      expect(read.problem).toContain(
        'Each entry of renamedDropdownOptions must be { "from"',
      );
    }
  });

  test("refuses renaming from or to empty text", () => {
    for (const pair of [
      { from: "", to: "New" },
      { from: "Old", to: "" },
      { from: "   ", to: "New" },
      { from: "Old", to: "\n\t" },
    ]) {
      expect(readCustomFieldOptionRenames([pair])).toEqual({
        renames: [],
        problem: "An option cannot be renamed from or to empty text.",
      });
    }
  });

  test("a value renamed twice is refused: it can become only one option", () => {
    const read: ReadCustomFieldOptionRenamesResult =
      readCustomFieldOptionRenames([
        { from: "Old", to: "New" },
        { from: " Old", to: "Newer" },
      ]);

    expect(read.renames).toEqual([]);
    expect(read.problem).toBe(
      '"Old" is renamed more than once. A value can become only one option.',
    );
  });

  test("two values may become the same option (a merge), and a swap is two pairs", () => {
    expect(
      readCustomFieldOptionRenames([
        { from: "EU-West", to: "Europe" },
        { from: "EU-Central", to: "Europe" },
      ]).problem,
    ).toBeNull();

    expect(
      readCustomFieldOptionRenames([
        { from: "High", to: "Low" },
        { from: "Low", to: "High" },
      ]).renames,
    ).toEqual([
      { from: "High", to: "Low" },
      { from: "Low", to: "High" },
    ]);
  });

  test("a value such as __proto__ is a value like any other", () => {
    expect(
      readCustomFieldOptionRenames([{ from: "__proto__", to: "constructor" }])
        .renames,
    ).toEqual([{ from: "__proto__", to: "constructor" }]);
  });

  test("a quoted value is cut short in the message", () => {
    const long: string = "x".repeat(200);

    const read: ReadCustomFieldOptionRenamesResult =
      readCustomFieldOptionRenames([
        { from: long, to: "a" },
        { from: long, to: "b" },
      ]);

    expect(read.problem).toBe(
      `"${"x".repeat(80)}..." is renamed more than once. A value can become only one option.`,
    );
  });

  test(`at most ${MAX_DROPDOWN_OPTION_RENAMES} renames in one save`, () => {
    const pairs: Array<CustomFieldOptionRename> = [];

    for (let index: number = 0; index <= MAX_DROPDOWN_OPTION_RENAMES; index++) {
      pairs.push({ from: `Old ${index}`, to: `New ${index}` });
    }

    expect(readCustomFieldOptionRenames(pairs)).toEqual({
      renames: [],
      problem: `One save can rename at most ${MAX_DROPDOWN_OPTION_RENAMES} options.`,
    });

    expect(
      readCustomFieldOptionRenames(pairs.slice(0, MAX_DROPDOWN_OPTION_RENAMES))
        .renames,
    ).toHaveLength(MAX_DROPDOWN_OPTION_RENAMES);
  });
});

describe("getCustomFieldOptionRenamesProblem", () => {
  const OPTIONS: string = "Facility Alpha\nFacility B\nFacility C";

  test("no renames is never a problem, whatever the field", () => {
    expect(
      getCustomFieldOptionRenamesProblem({
        renames: [],
        customFieldType: CustomFieldType.Text,
        dropdownOptions: undefined,
      }),
    ).toBeNull();
  });

  test("only a dropdown has options to rename", () => {
    for (const type of [
      CustomFieldType.Text,
      CustomFieldType.Number,
      CustomFieldType.Boolean,
      CustomFieldType.Date,
      undefined,
      null,
      "Unknown",
    ]) {
      expect(
        getCustomFieldOptionRenamesProblem({
          renames: [{ from: "A", to: "Facility Alpha" }],
          customFieldType: type,
          dropdownOptions: OPTIONS,
        }),
      ).toBe("Only a dropdown field has options to rename.");
    }
  });

  test("a rename onto one of the field's options is fine, single or multi-select", () => {
    for (const type of [
      CustomFieldType.Dropdown,
      CustomFieldType.MultiSelectDropdown,
    ]) {
      expect(
        getCustomFieldOptionRenamesProblem({
          renames: [{ from: "Facility A", to: "Facility Alpha" }],
          customFieldType: type,
          dropdownOptions: OPTIONS,
        }),
      ).toBeNull();
    }
  });

  test("the value moved need not be an option: a value no longer offered can be tidied onto one", () => {
    expect(
      getCustomFieldOptionRenamesProblem({
        renames: [{ from: "Old Site, retired in 2024", to: "Facility C" }],
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: OPTIONS,
      }),
    ).toBeNull();
  });

  test("a value may move off an option that stays - a new option with the old text", () => {
    expect(
      getCustomFieldOptionRenamesProblem({
        renames: [{ from: "Facility B", to: "Facility C" }],
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: OPTIONS,
      }),
    ).toBeNull();
  });

  test("a rename onto text the field does not offer is refused: the value would land on no option", () => {
    expect(
      getCustomFieldOptionRenamesProblem({
        renames: [{ from: "Facility A", to: "Facility Z" }],
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: OPTIONS,
      }),
    ).toBe(
      '"Facility Z" is not one of the field\'s options. A value can only be renamed to an option the field offers.',
    );

    expect(
      getCustomFieldOptionRenamesProblem({
        renames: [
          { from: "Facility A", to: "Facility Y" },
          { from: "Facility B", to: "Facility Alpha" },
          { from: "Facility C", to: "Facility Z" },
        ],
        customFieldType: CustomFieldType.MultiSelectDropdown,
        dropdownOptions: OPTIONS,
      }),
    ).toBe(
      '"Facility Y", "Facility Z" are not among the field\'s options. A value can only be renamed to an option the field offers.',
    );
  });

  test("names at most ten of the options it cannot rename to", () => {
    const renames: Array<CustomFieldOptionRename> = [];

    for (let index: number = 0; index < 15; index++) {
      renames.push({ from: `Old ${index}`, to: `Missing ${index}` });
    }

    const problem: string | null = getCustomFieldOptionRenamesProblem({
      renames,
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: OPTIONS,
    });

    expect(problem).toContain('"Missing 9"');
    expect(problem).not.toContain('"Missing 10"');
  });

  test("reads options with colors as well as one per line", () => {
    const colored: string = serializeCustomFieldDropdownOptions([
      { value: "Red", color: "#ef4444" },
      { value: "Green" },
    ]);

    expect(colored.startsWith("[")).toBe(true);

    expect(
      getCustomFieldOptionRenamesProblem({
        renames: [{ from: "Crimson", to: "Red" }],
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: colored,
      }),
    ).toBeNull();

    expect(
      getCustomFieldOptionRenamesProblem({
        renames: [{ from: "Crimson", to: "Blue" }],
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: colored,
      }),
    ).toContain('"Blue" is not one of');
  });

  test("a field with no options at all accepts no rename", () => {
    for (const dropdownOptions of [undefined, null, "", "   "]) {
      expect(
        getCustomFieldOptionRenamesProblem({
          renames: [{ from: "A", to: "B" }],
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions,
        }),
      ).toContain('"B" is not one of');
    }
  });
});

describe("toCustomFieldOptionRenameMap", () => {
  test("maps each value to the option it becomes, the first pair winning", () => {
    const renames: CustomFieldOptionRenameMap = toCustomFieldOptionRenameMap([
      { from: "A", to: "Alpha" },
      { from: "B", to: "Beta" },
      { from: "A", to: "Ignored" },
    ]);

    expect([...renames.entries()]).toEqual([
      ["A", "Alpha"],
      ["B", "Beta"],
    ]);
  });

  test("has no prototype to trip over", () => {
    const renames: CustomFieldOptionRenameMap = map([
      ["constructor", "Builder"],
    ]);

    expect(renames.get("constructor")).toBe("Builder");
    expect(renames.get("toString")).toBeUndefined();
    expect(renames.has("__proto__")).toBe(false);
  });
});

describe("renameCustomFieldOptionValue", () => {
  const RENAMES: CustomFieldOptionRenameMap = map([
    ["Facility A", "Facility Alpha"],
    ["1", "One"],
    ["true", "Yes"],
  ]);

  test("a single value that was renamed holds the option's new text", () => {
    expect(renameCustomFieldOptionValue("Facility A", RENAMES)).toEqual({
      value: "Facility Alpha",
      changed: true,
    });
  });

  test("a single value that was not renamed is left exactly as it is", () => {
    for (const value of ["Facility B", "facility a", "Facility A ", ""]) {
      expect(renameCustomFieldOptionValue(value, RENAMES)).toEqual({
        value,
        changed: false,
      });
    }
  });

  test("a number or yes/no sent over the API is matched by its text", () => {
    expect(renameCustomFieldOptionValue(1, RENAMES)).toEqual({
      value: "One",
      changed: true,
    });
    expect(renameCustomFieldOptionValue(true, RENAMES)).toEqual({
      value: "Yes",
      changed: true,
    });
    expect(renameCustomFieldOptionValue(2, RENAMES)).toEqual({
      value: 2,
      changed: false,
    });
  });

  test("a list has each renamed entry replaced where it was", () => {
    expect(
      renameCustomFieldOptionValue(
        ["Facility C", "Facility A", "Facility B"],
        RENAMES,
      ),
    ).toEqual({
      value: ["Facility C", "Facility Alpha", "Facility B"],
      changed: true,
    });
  });

  test("an entry a rename makes repeat an earlier one is dropped - merged, not doubled", () => {
    const merge: CustomFieldOptionRenameMap = map([["EU-West", "Europe"]]);

    expect(
      renameCustomFieldOptionValue(["Europe", "EU-West", "Asia"], merge),
    ).toEqual({ value: ["Europe", "Asia"], changed: true });

    expect(
      renameCustomFieldOptionValue(["EU-West", "Asia", "Europe"], merge),
    ).toEqual({ value: ["Europe", "Asia"], changed: true });

    const twoIntoOne: CustomFieldOptionRenameMap = map([
      ["EU-West", "Europe"],
      ["EU-Central", "Europe"],
    ]);

    expect(
      renameCustomFieldOptionValue(["EU-Central", "EU-West"], twoIntoOne),
    ).toEqual({ value: ["Europe"], changed: true });
  });

  test("renames are made all at once, so a swap swaps", () => {
    const swap: CustomFieldOptionRenameMap = map([
      ["High", "Low"],
      ["Low", "High"],
    ]);

    expect(renameCustomFieldOptionValue("High", swap)).toEqual({
      value: "Low",
      changed: true,
    });
    expect(renameCustomFieldOptionValue(["Low", "High"], swap)).toEqual({
      value: ["High", "Low"],
      changed: true,
    });

    // And a chain does not run on: A becomes B, and B becomes C.
    const chain: CustomFieldOptionRenameMap = map([
      ["A", "B"],
      ["B", "C"],
    ]);

    expect(renameCustomFieldOptionValue(["A", "B"], chain)).toEqual({
      value: ["B", "C"],
      changed: true,
    });
  });

  test("a list none of whose entries is renamed is left as it is, repeats and all", () => {
    const value: Array<string> = ["Facility B", "Facility B"];

    const renamed: RenamedCustomFieldOptionValue = renameCustomFieldOptionValue(
      value,
      RENAMES,
    );

    expect(renamed.changed).toBe(false);
    expect(renamed.value).toBe(value);
  });

  test("a list that is renamed loses the repeats it already had too", () => {
    expect(
      renameCustomFieldOptionValue(
        ["Facility B", "Facility A", "Facility B"],
        RENAMES,
      ),
    ).toEqual({ value: ["Facility B", "Facility Alpha"], changed: true });
  });

  test("tells the text '1' and the number 1 apart, as the database does", () => {
    const renames: CustomFieldOptionRenameMap = map([["2", "1"]]);

    expect(renameCustomFieldOptionValue([1, "2"], renames)).toEqual({
      value: [1, "1"],
      changed: true,
    });
  });

  test("leaves list entries that are not values where they are", () => {
    const nested: { region: string } = { region: "Facility A" };

    expect(
      renameCustomFieldOptionValue([nested, "Facility A", null], RENAMES),
    ).toEqual({ value: [nested, "Facility Alpha", null], changed: true });
  });

  test("anything else is left exactly as it is", () => {
    const object: { value: string } = { value: "Facility A" };

    for (const value of [undefined, null, object, Number.NaN, []]) {
      const renamed: RenamedCustomFieldOptionValue =
        renameCustomFieldOptionValue(value, RENAMES);

      expect(renamed.changed).toBe(false);
      expect(renamed.value).toBe(value);
    }
  });

  test("no renames changes nothing", () => {
    const value: Array<string> = ["Facility A"];

    expect(renameCustomFieldOptionValue(value, new Map())).toEqual({
      value,
      changed: false,
    });
  });
});

describe("renameCustomFieldOptionsInList", () => {
  const OPTIONS: Array<CustomFieldDropdownOption> = [
    { value: "Facility A", color: "#ef4444" },
    { value: "Facility B" },
    { value: "Facility C", color: "#16a34a" },
  ];

  test("a renamed option keeps its place and its color", () => {
    const result: RenamedCustomFieldOptionList = renameCustomFieldOptionsInList(
      {
        options: OPTIONS,
        renames: map([["Facility A", "Facility Alpha"]]),
      },
    );

    expect(result).toEqual({
      options: [
        { value: "Facility Alpha", color: "#ef4444" },
        { value: "Facility B" },
        { value: "Facility C", color: "#16a34a" },
      ],
      changed: true,
    });
  });

  test("an option renamed onto one already listed is merged into it", () => {
    expect(
      renameCustomFieldOptionsInList({
        options: OPTIONS,
        renames: map([["Facility C", "Facility B"]]),
      }),
    ).toEqual({
      options: [
        { value: "Facility A", color: "#ef4444" },
        { value: "Facility B" },
      ],
      changed: true,
    });

    // Listed first, the merged option keeps the place and color of the first.
    expect(
      renameCustomFieldOptionsInList({
        options: OPTIONS,
        renames: map([["Facility A", "Facility C"]]),
      }).options,
    ).toEqual([
      { value: "Facility C", color: "#ef4444" },
      { value: "Facility B" },
    ]);
  });

  test("appends the options it is to add, with their colors, unless offered", () => {
    expect(
      renameCustomFieldOptionsInList({
        options: OPTIONS,
        renames: new Map(),
        addOptions: [
          { value: "Facility B" },
          { value: "Facility D", color: "#3b82f6" },
          { value: "Facility E" },
        ],
      }),
    ).toEqual({
      options: [
        ...OPTIONS,
        { value: "Facility D", color: "#3b82f6" },
        { value: "Facility E" },
      ],
      changed: true,
    });
  });

  test("renames first, then adds, so an added option that is a renamed one's new name is not doubled", () => {
    expect(
      renameCustomFieldOptionsInList({
        options: OPTIONS,
        renames: map([["Facility A", "Facility Alpha"]]),
        addOptions: [{ value: "Facility Alpha" }],
      }).options.map((option: CustomFieldDropdownOption): string => {
        return option.value;
      }),
    ).toEqual(["Facility Alpha", "Facility B", "Facility C"]);
  });

  test("nothing to rename or add is no change", () => {
    expect(
      renameCustomFieldOptionsInList({
        options: OPTIONS,
        renames: map([["Not an option", "Facility B"]]),
        addOptions: [{ value: "Facility C" }],
      }),
    ).toEqual({ options: OPTIONS, changed: false });
  });

  test("does not change the options it was handed", () => {
    const options: Array<CustomFieldDropdownOption> = [
      { value: "Facility A", color: "#ef4444" },
    ];

    renameCustomFieldOptionsInList({
      options,
      renames: map([["Facility A", "Facility Alpha"]]),
    });

    expect(options).toEqual([{ value: "Facility A", color: "#ef4444" }]);
  });
});

describe("getCustomFieldOptionValues", () => {
  test("the values of a list, either format", () => {
    expect(getCustomFieldOptionValues("Low\nHigh")).toEqual(["Low", "High"]);
    expect(
      getCustomFieldOptionValues(
        JSON.stringify([{ value: "Low", color: "#16a34a" }, { value: "High" }]),
      ),
    ).toEqual(["Low", "High"]);
    expect(getCustomFieldOptionValues(undefined)).toEqual([]);
    expect(getCustomFieldOptionValues("")).toEqual([]);
  });
});

describe("readCustomFieldOptionUsage and getCustomFieldOptionUsageCount", () => {
  test("reads the counts and the fields that copy this one", () => {
    expect(
      readCustomFieldOptionUsage({
        values: [
          { value: "Facility A", count: 12 },
          { value: "Old Site", count: 3 },
        ],
        copiedBy: [{ resource: "Incident", fieldName: "Facility" }],
      }),
    ).toEqual({
      values: [
        { value: "Facility A", count: 12 },
        { value: "Old Site", count: 3 },
      ],
      copiedBy: [{ resource: "Incident", fieldName: "Facility" }],
    });
  });

  test("drops what is malformed instead of trusting it", () => {
    expect(
      readCustomFieldOptionUsage({
        values: [
          { value: "Good", count: 2.9 },
          { value: "Negative", count: -1 },
          { value: "Infinite", count: Number.POSITIVE_INFINITY },
          { value: 5, count: 1 },
          { value: "No count" },
          "Facility A",
          null,
        ],
        copiedBy: [
          { resource: "Incident" },
          { resource: "Alert", fieldName: "Region" },
          "Incident",
        ],
      }),
    ).toEqual({
      values: [{ value: "Good", count: 2 }],
      copiedBy: [{ resource: "Alert", fieldName: "Region" }],
    });

    for (const value of [undefined, null, "x", [], { values: "x" }]) {
      expect(readCustomFieldOptionUsage(value)).toEqual({
        values: [],
        copiedBy: [],
      });
    }
  });

  test("how many records hold a value: a count, 0 when none, unknown without counts", () => {
    const usage: CustomFieldOptionUsage = {
      values: [{ value: "Facility A", count: 12 }],
      copiedBy: [],
    };

    expect(getCustomFieldOptionUsageCount(usage, "Facility A")).toBe(12);
    expect(getCustomFieldOptionUsageCount(usage, "Facility B")).toBe(0);
    expect(getCustomFieldOptionUsageCount(null, "Facility A")).toBeUndefined();
    expect(
      getCustomFieldOptionUsageCount(undefined, "Facility A"),
    ).toBeUndefined();
  });
});
