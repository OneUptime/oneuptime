import { describe, expect, test } from "@jest/globals";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import {
  getCustomFieldMappingCompatibilityError,
  isCustomFieldValueEmpty,
  MergedCustomFields,
  mergeMappedCustomFieldValues,
  ResolvedCustomFieldValue,
  resolveMappedCustomFieldValue,
} from "../../../Types/CustomField/CustomFieldValueMapping";

/*
 * The rules that decide what a mapped custom field is worth
 * (OneUptime/oneuptime#3549).
 *
 * The single most important property asserted here is that resolution has NO
 * path that produces "clear this value". Every "nothing to write" answer comes
 * back as `hasValue: false`, and the merge only ever adds or replaces keys.
 * The failure this guards against is concrete: an admin turns a mapping on for
 * a field 3,000 alerts have been filled in by hand, no monitor has a value for
 * it yet, and a resolver that treated "source is empty" as "clear the target"
 * would erase all 3,000 through a hook-free write with no audit row.
 */

describe("resolveMappedCustomFieldValue", () => {
  test("writes nothing when there are no source records", () => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: [],
      targetFieldType: CustomFieldType.Text,
    });

    expect(resolution.hasValue).toBe(false);
    expect(resolution.value).toBeUndefined();
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["empty array", []],
  ])(
    "writes nothing when the only source value is %s",
    (_label: string, value: unknown) => {
      const resolution: ResolvedCustomFieldValue =
        resolveMappedCustomFieldValue({
          sourceValues: [value],
          targetFieldType: CustomFieldType.Text,
        });

      expect(resolution.hasValue).toBe(false);
    },
  );

  /*
   * A Boolean custom field set to "No" stores a real `false`, and a Number
   * field set to zero stores "0". A falsy emptiness check would treat both as
   * absent and stop them ever being inherited.
   */
  test.each([
    ["false", false],
    ["zero", 0],
    ["the string zero", "0"],
  ])("treats %s as a real value", (_label: string, value: unknown) => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: [value],
      targetFieldType: CustomFieldType.Boolean,
    });

    expect(resolution.hasValue).toBe(true);
    expect(resolution.value).toEqual(value);
  });

  test("uses the single source's value", () => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: ["Acme"],
      targetFieldType: CustomFieldType.Text,
    });

    expect(resolution).toEqual({ hasValue: true, value: "Acme" });
  });

  test("ignores sources that hold nothing and uses the ones that do", () => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: [undefined, "", "Acme", null],
      targetFieldType: CustomFieldType.Text,
    });

    expect(resolution).toEqual({ hasValue: true, value: "Acme" });
  });

  test("uses the agreed value when every source says the same thing", () => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: ["Acme", "Acme", "Acme"],
      targetFieldType: CustomFieldType.Text,
    });

    expect(resolution).toEqual({ hasValue: true, value: "Acme" });
  });

  /*
   * Incident.monitors and ScheduledMaintenance.monitors are ManyToMany
   * relations with no ORDER BY, so "the first monitor" is not a stable
   * concept: picking a winner would make the value change on its own between
   * syncs and churn every derived facet and metric with it.
   */
  test("writes nothing for a single-value field whose sources disagree", () => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: ["Acme", "Globex"],
      targetFieldType: CustomFieldType.Dropdown,
    });

    expect(resolution.hasValue).toBe(false);
  });

  test("the answer does not depend on the order the sources were read in", () => {
    const forwards: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: ["Acme", "Globex", "Initech"],
      targetFieldType: CustomFieldType.MultiSelectDropdown,
    });

    const backwards: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: ["Initech", "Globex", "Acme"],
      targetFieldType: CustomFieldType.MultiSelectDropdown,
    });

    expect(forwards).toEqual(backwards);
  });

  test("unions disagreeing sources for a multi-select field, sorted", () => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: [["b", "a"], ["c"], []],
      targetFieldType: CustomFieldType.MultiSelectDropdown,
    });

    expect(resolution).toEqual({ hasValue: true, value: ["a", "b", "c"] });
  });

  /*
   * ["a","b"] and ["b","a"] are one answer, not two. Without order-insensitive
   * comparison they would look like disagreement and the field would flip
   * between the two arrays forever.
   */
  test("treats two multi-select arrays with the same members as agreeing", () => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: [
        ["a", "b"],
        ["b", "a"],
      ],
      targetFieldType: CustomFieldType.MultiSelectDropdown,
    });

    expect(resolution.hasValue).toBe(true);
    expect(resolution.value).toEqual(["a", "b"]);
  });

  test("a bare string source is folded into a multi-select union", () => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: ["a", ["b"]],
      targetFieldType: CustomFieldType.MultiSelectDropdown,
    });

    expect(resolution).toEqual({ hasValue: true, value: ["a", "b"] });
  });

  test("an unset target field type still resolves an agreed value", () => {
    const resolution: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: ["Acme"],
    });

    expect(resolution).toEqual({ hasValue: true, value: "Acme" });
  });
});

describe("isCustomFieldValueEmpty", () => {
  test.each([
    [undefined, true],
    [null, true],
    ["", true],
    [[], true],
    [false, false],
    [0, false],
    ["0", false],
    ["Acme", false],
    [["a"], false],
    [{}, false],
  ])("%p is empty: %p", (value: unknown, expected: boolean) => {
    expect(isCustomFieldValueEmpty(value)).toBe(expected);
  });
});

describe("mergeMappedCustomFieldValues", () => {
  test("leaves keys the mapping does not own alone", () => {
    const merged: MergedCustomFields = mergeMappedCustomFieldValues({
      existingCustomFields: { Vendor: "Old", Owner: "kate" },
      resolvedValues: { Vendor: "New" },
    });

    expect(merged.customFields).toEqual({ Vendor: "New", Owner: "kate" });
    expect(merged.hasChanged).toBe(true);
  });

  test("reports no change when the stored value already matches", () => {
    const merged: MergedCustomFields = mergeMappedCustomFieldValues({
      existingCustomFields: { Vendor: "Acme" },
      resolvedValues: { Vendor: "Acme" },
    });

    expect(merged.hasChanged).toBe(false);
  });

  test("reports no change for a multi-select whose members match in another order", () => {
    const merged: MergedCustomFields = mergeMappedCustomFieldValues({
      existingCustomFields: { Vendor: ["b", "a"] },
      resolvedValues: { Vendor: ["a", "b"] },
    });

    expect(merged.hasChanged).toBe(false);
  });

  test("fills in a key that was never set", () => {
    const merged: MergedCustomFields = mergeMappedCustomFieldValues({
      existingCustomFields: null,
      resolvedValues: { Vendor: "Acme" },
    });

    expect(merged.customFields).toEqual({ Vendor: "Acme" });
    expect(merged.hasChanged).toBe(true);
  });

  /*
   * The returned bag is written straight into a jsonb column and is also the
   * value a compare-and-set was computed against; sharing the caller's object
   * would let a later mutation change a row that is already persisted.
   */
  test("does not mutate the bag it was given", () => {
    const existing: JSONObject = { Vendor: "Old" };

    mergeMappedCustomFieldValues({
      existingCustomFields: existing,
      resolvedValues: { Vendor: "New" },
    });

    expect(existing).toEqual({ Vendor: "Old" });
  });

  test("an empty resolution changes nothing", () => {
    const merged: MergedCustomFields = mergeMappedCustomFieldValues({
      existingCustomFields: { Vendor: "Acme" },
      resolvedValues: {},
    });

    expect(merged.customFields).toEqual({ Vendor: "Acme" });
    expect(merged.hasChanged).toBe(false);
  });
});

describe("getCustomFieldMappingCompatibilityError", () => {
  test("accepts two fields of the same simple type", () => {
    expect(
      getCustomFieldMappingCompatibilityError({
        targetFieldType: CustomFieldType.Text,
        sourceFieldType: CustomFieldType.Text,
        sourceFieldName: "Vendor",
      }),
    ).toBeNull();
  });

  test("rejects a type mismatch", () => {
    const error: string | null = getCustomFieldMappingCompatibilityError({
      targetFieldType: CustomFieldType.Boolean,
      sourceFieldType: CustomFieldType.Date,
      sourceFieldName: "Vendor",
    });

    expect(error).toContain("Boolean");
    expect(error).toContain("Date");
  });

  /*
   * `customFieldType` is a nullable column, so two untyped definitions would
   * otherwise pass an `undefined === undefined` check and let any value shape
   * flow between them.
   */
  test("rejects a target with no field type", () => {
    expect(
      getCustomFieldMappingCompatibilityError({
        sourceFieldType: CustomFieldType.Text,
        sourceFieldName: "Vendor",
      }),
    ).toContain("field type");
  });

  test("rejects a source with no field type", () => {
    expect(
      getCustomFieldMappingCompatibilityError({
        targetFieldType: CustomFieldType.Text,
        sourceFieldName: "Vendor",
      }),
    ).toContain("does not have a field type");
  });

  test("accepts a dropdown whose source options are all offered here", () => {
    expect(
      getCustomFieldMappingCompatibilityError({
        targetFieldType: CustomFieldType.Dropdown,
        sourceFieldType: CustomFieldType.Dropdown,
        targetDropdownOptions: "Acme\nGlobex\nInitech",
        sourceDropdownOptions: "Acme\nGlobex",
        sourceFieldName: "Vendor",
      }),
    ).toBeNull();
  });

  /*
   * Nothing on the server validates a value against its definition, so a
   * mapped value outside the target's option list would be stored, drawn as
   * an uncoloured badge, and be unfilterable — the facet's options come from
   * the target definition. Saving the mapping is the only moment anyone can
   * be told.
   */
  test("rejects a dropdown source that can hold options this field does not offer", () => {
    const error: string | null = getCustomFieldMappingCompatibilityError({
      targetFieldType: CustomFieldType.Dropdown,
      sourceFieldType: CustomFieldType.Dropdown,
      targetDropdownOptions: "Acme\nGlobex",
      sourceDropdownOptions: "Acme\nAWS",
      sourceFieldName: "Vendor",
    });

    expect(error).toContain("AWS");
  });

  test("compares dropdown options across the legacy and JSON storage formats", () => {
    expect(
      getCustomFieldMappingCompatibilityError({
        targetFieldType: CustomFieldType.MultiSelectDropdown,
        sourceFieldType: CustomFieldType.MultiSelectDropdown,
        targetDropdownOptions: JSON.stringify([
          { value: "Acme", color: "#112233" },
          { value: "Globex" },
        ]),
        sourceDropdownOptions: "Acme\nGlobex",
        sourceFieldName: "Vendor",
      }),
    ).toBeNull();
  });
});
