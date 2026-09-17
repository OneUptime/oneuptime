import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../UI/Components/Types/FieldType";
import { describe, expect, test } from "@jest/globals";

/*
 * CustomFieldsDetail does not translate a definition's `customFieldType` into a
 * render type - it hands the raw string to a Detail field and to a form field
 * as their `fieldType`, through an `as any` that erases the enum on the way.
 * Nothing in the compiler is watching that seam, so a member added here without
 * a same-VALUE member in FieldType and FormFieldSchemaType type-checks, builds,
 * ships, and only then shows itself: the Detail column falls off the end of the
 * render switch and paints an empty cell, and the form falls off the end of the
 * input switch and paints a control the user cannot type into. The field looks
 * present and is silently unusable, which is the worst shape a regression can
 * take because nothing throws and nothing logs.
 *
 * These are value-set comparisons rather than key comparisons on purpose. The
 * three enums are free to spell a member however reads best on their own side -
 * `Boolean` reaches the form as `FormFieldSchemaType.Toggle`, which is written
 * `Toggle = "Boolean"` for exactly this reason - and only the value crosses the
 * seam. A key-based check would both miss real breakage and reject that legal
 * spelling.
 */

const customFieldTypeEntries: Array<[string, string]> = Object.entries(
  CustomFieldType,
) as Array<[string, string]>;

const fieldTypeValues: Set<string> = new Set<string>(
  Object.values(FieldType) as Array<string>,
);

const formFieldSchemaTypeValues: Set<string> = new Set<string>(
  Object.values(FormFieldSchemaType) as Array<string>,
);

describe("CustomFieldType corresponds to FieldType", () => {
  test.each(customFieldTypeEntries)(
    "CustomFieldType.%s is a FieldType value",
    (_key: string, value: string) => {
      expect(fieldTypeValues.has(value)).toBe(true);
    },
  );
});

describe("CustomFieldType corresponds to FormFieldSchemaType", () => {
  test.each(customFieldTypeEntries)(
    "CustomFieldType.%s is a FormFieldSchemaType value",
    (_key: string, value: string) => {
      expect(formFieldSchemaTypeValues.has(value)).toBe(true);
    },
  );
});

describe("CustomFieldType member set", () => {
  test("has at least one member so the correspondence loops cannot pass vacuously", () => {
    /*
     * The two blocks above are generated from this enum. If it were ever
     * emptied - a bad merge, a barrel file re-export that resolves to {} - the
     * per-member assertions would simply stop existing and the suite would go
     * green while guarding nothing.
     */
    expect(customFieldTypeEntries.length).toBeGreaterThan(0);
  });

  test("has no duplicate values", () => {
    /*
     * Two keys sharing a value collapse at runtime: the second one wins every
     * lookup, and a definition saved under the first key renders as the second
     * one's type. It also makes the loops above lie, because a duplicate is
     * checked twice and the shadowed member is never exercised on its own.
     */
    const values: Array<string> = customFieldTypeEntries.map(
      ([, value]: [string, string]) => {
        return value;
      },
    );

    expect(new Set<string>(values).size).toBe(values.length);
  });

  test("includes Date and DateTime", () => {
    /*
     * The date members are what the jsonb range filters and the ISO-8601
     * storage format exist for. Losing them is a silent feature removal - old
     * definitions keep their stored `customFieldType` string in the database
     * and would then fall through every switch that reads this enum.
     */
    expect(CustomFieldType.Date).toEqual("Date");
    expect(CustomFieldType.DateTime).toEqual("DateTime");
  });
});

describe("CustomFieldType correspondence is by value, not by key", () => {
  test("Boolean reaches the form as Toggle, which is only visible by value", () => {
    /*
     * This is the case that proves the checks above have to compare values.
     * FormFieldSchemaType has no member named `Boolean`; it names the same
     * value `Toggle`. A correspondence test written against key names would
     * fail here on code that works perfectly, and would then be "fixed" by
     * relaxing it into something that no longer catches a missing member.
     */
    expect(Object.keys(FormFieldSchemaType)).not.toContain("Boolean");
    expect(FormFieldSchemaType.Toggle).toEqual(CustomFieldType.Boolean);
  });
});
