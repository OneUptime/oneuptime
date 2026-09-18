import {
  CustomFieldDropdownOption,
  getCustomFieldDropdownOption,
  normalizeCustomFieldDropdownOptionColor,
  parseCustomFieldDropdownOptions,
  serializeCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import { describe, expect, test } from "@jest/globals";

describe("CustomFieldDropdownOption color normalization", () => {
  test("accepts a six-digit hex color", () => {
    expect(normalizeCustomFieldDropdownOptionColor("#12abEF")).toEqual(
      "#12abef",
    );
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeCustomFieldDropdownOptionColor("  #22C55E  ")).toEqual(
      "#22c55e",
    );
  });

  test.each(["fff", "#fff", "22c55e", "#22c55g", "red", "", "   "])(
    "rejects an unsupported color value: %s",
    (value: string) => {
      expect(normalizeCustomFieldDropdownOptionColor(value)).toBeUndefined();
    },
  );

  test("rejects non-string colors", () => {
    expect(normalizeCustomFieldDropdownOptionColor(null)).toBeUndefined();
    expect(normalizeCustomFieldDropdownOptionColor(123)).toBeUndefined();
    expect(normalizeCustomFieldDropdownOptionColor({})).toBeUndefined();
  });
});

describe("CustomFieldDropdownOption parsing", () => {
  test("parses the legacy one-value-per-line format", () => {
    expect(parseCustomFieldDropdownOptions("Low\nMedium\nHigh")).toEqual([
      { value: "Low" },
      { value: "Medium" },
      { value: "High" },
    ]);
  });

  test("trims values and drops blank legacy lines", () => {
    expect(
      parseCustomFieldDropdownOptions("  Low  \n\n  \n\tHigh\t\n"),
    ).toEqual([{ value: "Low" }, { value: "High" }]);
  });

  test("keeps punctuation in legacy values", () => {
    expect(
      parseCustomFieldDropdownOptions("Needs review, urgent\n[Internal]"),
    ).toEqual([{ value: "Needs review, urgent" }, { value: "[Internal]" }]);
  });

  test("parses colored structured options", () => {
    expect(
      parseCustomFieldDropdownOptions(
        '[{"value":"Low","color":"#22c55e"},{"value":"High","color":"#ef4444"}]',
      ),
    ).toEqual([
      { value: "Low", color: "#22c55e" },
      { value: "High", color: "#ef4444" },
    ]);
  });

  test("preserves a legacy option that looks like a JSON array", () => {
    expect(parseCustomFieldDropdownOptions('["Low","High"]')).toEqual([
      { value: '["Low","High"]' },
    ]);
  });

  test("accepts label as a compatibility alias for value", () => {
    expect(
      parseCustomFieldDropdownOptions('[{"label":"High","color":"#EF4444"}]'),
    ).toEqual([{ value: "High", color: "#ef4444" }]);
  });

  test("trims structured values and normalizes colors", () => {
    expect(
      parseCustomFieldDropdownOptions(
        '[{"value":"  High  ","color":"  #EF4444  "}]',
      ),
    ).toEqual([{ value: "High", color: "#ef4444" }]);
  });

  test("keeps an option but drops its invalid color", () => {
    expect(
      parseCustomFieldDropdownOptions(
        '[{"value":"High","color":"javascript:alert(1)"}]',
      ),
    ).toEqual([{ value: "High" }]);
  });

  test("drops malformed structured entries without dropping valid neighbors", () => {
    expect(
      parseCustomFieldDropdownOptions(
        '[null,42,{},[],{"value":""},{"value":"Low"},{"label":"High","color":"invalid"}]',
      ),
    ).toEqual([{ value: "Low" }, { value: "High" }]);
  });

  test("preserves duplicate values because existing definitions may contain them", () => {
    expect(parseCustomFieldDropdownOptions("Low\nLow")).toEqual([
      { value: "Low" },
      { value: "Low" },
    ]);
  });

  test("falls back to legacy parsing for malformed JSON", () => {
    expect(parseCustomFieldDropdownOptions("[Needs review")).toEqual([
      { value: "[Needs review" },
    ]);
  });

  test("returns an empty array for empty and non-string input", () => {
    expect(parseCustomFieldDropdownOptions("")).toEqual([]);
    expect(parseCustomFieldDropdownOptions("  \n\t ")).toEqual([]);
    expect(parseCustomFieldDropdownOptions(undefined)).toEqual([]);
    expect(parseCustomFieldDropdownOptions(null)).toEqual([]);
    expect(parseCustomFieldDropdownOptions(42)).toEqual([]);
    expect(parseCustomFieldDropdownOptions({ value: "High" })).toEqual([]);
  });
});

describe("CustomFieldDropdownOption serialization", () => {
  test("keeps the compact legacy format when no option has a color", () => {
    expect(
      serializeCustomFieldDropdownOptions([
        { value: "Low" },
        { value: "High" },
      ]),
    ).toEqual("Low\nHigh");
  });

  test("uses structured storage when any option has a color", () => {
    expect(
      serializeCustomFieldDropdownOptions([
        { value: "Low", color: "#22c55e" },
        { value: "High" },
      ]),
    ).toEqual('[{"value":"Low","color":"#22c55e"},{"value":"High"}]');
  });

  test("trims values, normalizes colors, and drops empty options", () => {
    expect(
      serializeCustomFieldDropdownOptions([
        { value: "  Low  ", color: "  #22C55E  " },
        { value: "   ", color: "#ef4444" },
        { value: "High", color: "not-a-color" },
      ]),
    ).toEqual('[{"value":"Low","color":"#22c55e"},{"value":"High"}]');
  });

  test("returns to legacy storage after the last color is cleared", () => {
    expect(
      serializeCustomFieldDropdownOptions([
        { value: "Low", color: undefined },
        { value: "High" },
      ]),
    ).toEqual("Low\nHigh");
  });

  test("returns an empty string when there are no valid options", () => {
    expect(serializeCustomFieldDropdownOptions([])).toEqual("");
    expect(serializeCustomFieldDropdownOptions([{ value: "  " }])).toEqual("");
  });

  test("does not mutate the caller's options", () => {
    const options: Array<CustomFieldDropdownOption> = [
      { value: "  Low  ", color: "#22C55E" },
    ];

    serializeCustomFieldDropdownOptions(options);

    expect(options).toEqual([{ value: "  Low  ", color: "#22C55E" }]);
  });

  test("round-trips colored values including punctuation", () => {
    const options: Array<CustomFieldDropdownOption> = [
      { value: "Needs review, urgent", color: "#f97316" },
      { value: "[Internal]", color: "#64748b" },
    ];

    expect(
      parseCustomFieldDropdownOptions(
        serializeCustomFieldDropdownOptions(options),
      ),
    ).toEqual(options);
  });
});

describe("CustomFieldDropdownOption lookup", () => {
  const serializedOptions: string =
    '[{"value":"Low","color":"#22c55e"},{"value":"High","color":"#ef4444"}]';

  test("returns the exact matching option", () => {
    expect(getCustomFieldDropdownOption(serializedOptions, "High")).toEqual({
      value: "High",
      color: "#ef4444",
    });
  });

  test("stringifies primitive saved values for matching", () => {
    expect(getCustomFieldDropdownOption("1\n2", 2)).toEqual({ value: "2" });
  });

  test("does not use a case-insensitive match", () => {
    expect(
      getCustomFieldDropdownOption(serializedOptions, "high"),
    ).toBeUndefined();
  });

  test("returns undefined for missing, null, and unknown values", () => {
    expect(
      getCustomFieldDropdownOption(serializedOptions, "Critical"),
    ).toBeUndefined();
    expect(
      getCustomFieldDropdownOption(serializedOptions, null),
    ).toBeUndefined();
    expect(
      getCustomFieldDropdownOption(serializedOptions, undefined),
    ).toBeUndefined();
  });
});
