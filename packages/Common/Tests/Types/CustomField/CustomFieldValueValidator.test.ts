import { CustomFieldDefinition } from "../../../Types/CustomField/CustomFieldDefinition";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  CustomFieldValueValidationError,
  formatCustomFieldValueValidationErrors,
  validateCustomFieldValues,
} from "../../../Types/CustomField/CustomFieldValueValidator";
import { describe, expect, test } from "@jest/globals";

/*
 * The server now checks custom field values against their definitions, in
 * front of writes that have worked for years. What must hold:
 *
 *   - a value this write CHANGES must fit its field;
 *   - a value it does not change passes, however it looks - the Custom
 *     Fields card sends the whole bag back, so a legacy value (an option an
 *     admin has since removed, text stored before the field became a
 *     Number) must not block saving the other fields;
 *   - unknown keys, empty values and untyped fields pass.
 */

const DEFINITIONS: Array<CustomFieldDefinition> = [
  { name: "Summary", customFieldType: CustomFieldType.Text },
  { name: "Details", customFieldType: CustomFieldType.LongText },
  { name: "Notes", customFieldType: CustomFieldType.Markdown },
  { name: "Estimated Duration", customFieldType: CustomFieldType.Number },
  { name: "Acknowledgement", customFieldType: CustomFieldType.Boolean },
  { name: "Started On", customFieldType: CustomFieldType.Date },
  { name: "Expected Resolution", customFieldType: CustomFieldType.DateTime },
  {
    name: "Impact",
    customFieldType: CustomFieldType.Dropdown,
    dropdownOptions: "Low\nMedium\nHigh",
  },
  {
    name: "Regions",
    customFieldType: CustomFieldType.MultiSelectDropdown,
    dropdownOptions: JSON.stringify([
      { value: "East", color: "#ff0000" },
      { value: "West", color: "#00ff00" },
      { value: "North" },
    ]),
  },
  {
    name: "Unfinished Dropdown",
    customFieldType: CustomFieldType.Dropdown,
  },
  { name: "Untyped" },
];

type ValidateFunction = (
  customFields: unknown,
  storedCustomFields?: unknown,
) => Array<CustomFieldValueValidationError>;

const validate: ValidateFunction = (
  customFields: unknown,
  storedCustomFields?: unknown,
): Array<CustomFieldValueValidationError> => {
  return validateCustomFieldValues({
    definitions: DEFINITIONS,
    customFields,
    storedCustomFields,
  });
};

type FieldNamesFunction = (
  errors: Array<CustomFieldValueValidationError>,
) => Array<string>;

const fieldNames: FieldNamesFunction = (
  errors: Array<CustomFieldValueValidationError>,
): Array<string> => {
  return errors.map((error: CustomFieldValueValidationError) => {
    return error.fieldName;
  });
};

describe("validateCustomFieldValues - values that fit", () => {
  test.each([
    ["Summary", "Payments are slow"],
    ["Summary", 42],
    ["Summary", true],
    ["Details", "Line one\nLine two"],
    ["Notes", "**Bold** and a [link](https://example.com)"],
    ["Estimated Duration", 90],
    ["Estimated Duration", 0],
    ["Estimated Duration", -1.5],
    ["Estimated Duration", "0"],
    ["Estimated Duration", " 42 "],
    ["Estimated Duration", "3.5"],
    ["Acknowledgement", true],
    ["Acknowledgement", false],
    ["Acknowledgement", "true"],
    ["Acknowledgement", "false"],
    ["Started On", "2026-09-27"],
    ["Started On", "2026-09-27T00:00:00.000Z"],
    ["Expected Resolution", "2026-09-27T14:30:00.000Z"],
    ["Expected Resolution", new Date("2026-09-27T14:30:00.000Z")],
    ["Impact", "High"],
    ["Regions", ["East", "West"]],
    ["Regions", "North"],
    ["Unfinished Dropdown", "Anything"],
    ["Untyped", { any: "thing" }],
  ])("%s accepts %j", (name: string, value: unknown) => {
    expect(validate({ [name]: value })).toEqual([]);
  });
});

describe("validateCustomFieldValues - values that do not fit", () => {
  test.each([
    ["Summary", { nested: true }],
    ["Summary", ["a", "b"]],
    ["Details", { nested: true }],
    ["Notes", ["**a**"]],
    ["Estimated Duration", "banana"],
    ["Estimated Duration", "   "],
    ["Estimated Duration", true],
    ["Estimated Duration", ["1"]],
    ["Acknowledgement", "yes"],
    ["Acknowledgement", 1],
    ["Started On", "not a date"],
    ["Started On", 20260927],
    ["Expected Resolution", "tomorrow-ish"],
    ["Expected Resolution", new Date("invalid")],
    ["Impact", "Critical"],
    ["Impact", ["High"]],
    ["Impact", { value: "High" }],
    ["Regions", ["East", "South"]],
    ["Regions", "South"],
    ["Regions", [{ value: "East" }]],
  ])("%s refuses %j", (name: string, value: unknown) => {
    const errors: Array<CustomFieldValueValidationError> = validate({
      [name]: value,
    });

    expect(fieldNames(errors)).toEqual([name]);
    expect(errors[0]!.message).toContain(`"${name}"`);
  });

  test("names the options a dropdown value has to be one of", () => {
    const errors: Array<CustomFieldValueValidationError> = validate({
      Impact: "Critical",
    });

    expect(errors[0]!.message).toBe(
      '"Critical" is not one of the options for "Impact". Choose one of: "Low", "Medium", "High".',
    );
  });

  test("names every new multi-select entry that is not an option", () => {
    const errors: Array<CustomFieldValueValidationError> = validate({
      Regions: ["East", "South", "Central"],
    });

    expect(errors[0]!.message).toBe(
      '"South", "Central" are not among the options for "Regions". Choose from: "East", "West", "North".',
    );
  });

  test("reports every field that does not fit, in the order sent", () => {
    const errors: Array<CustomFieldValueValidationError> = validate({
      Impact: "Critical",
      Summary: "fine",
      "Estimated Duration": "soon",
    });

    expect(fieldNames(errors)).toEqual(["Impact", "Estimated Duration"]);
    expect(formatCustomFieldValueValidationErrors(errors)).toBe(
      `${errors[0]!.message} ${errors[1]!.message}`,
    );
  });

  test("keeps a long value and a long option list to one line", () => {
    const options: Array<string> = Array.from(
      { length: 25 },
      (_value: unknown, index: number) => {
        return `Option ${index + 1}`;
      },
    );

    const errors: Array<CustomFieldValueValidationError> =
      validateCustomFieldValues({
        definitions: [
          {
            name: "Big",
            customFieldType: CustomFieldType.Dropdown,
            dropdownOptions: options.join("\n"),
          },
        ],
        customFields: { Big: "x".repeat(500) },
      });

    expect(errors[0]!.message).toContain("...");
    expect(errors[0]!.message).toContain("and 15 more");
    expect(errors[0]!.message.length).toBeLessThan(400);
  });

  /*
   * The message is logged and sent back whole, and a write can send any
   * number of entries: a million of them must not come back as a message
   * the size of the request.
   */
  test("lists the first ten multi-select entries that are not options, and counts the rest", () => {
    const entries: Array<string> = Array.from(
      { length: 1000 },
      (_value: unknown, index: number) => {
        return `x${index}`;
      },
    );

    const errors: Array<CustomFieldValueValidationError> = validate({
      Regions: ["East", ...entries],
    });

    expect(errors[0]!.message).toBe(
      `${entries
        .slice(0, 10)
        .map((entry: string) => {
          return `"${entry}"`;
        })
        .join(
          ", ",
        )} and 990 more are not among the options for "Regions". Choose from: "East", "West", "North".`,
    );
    expect(errors[0]!.message).not.toContain('"x10"');
  });
});

describe("validateCustomFieldValues - only what this write changes", () => {
  test("an unchanged legacy dropdown value passes", () => {
    // "Severe" was an option once; the admin has since removed it.
    expect(
      validate(
        { Impact: "Severe", Summary: "edited" },
        { Impact: "Severe", Summary: "before" },
      ),
    ).toEqual([]);
  });

  test("an unchanged value of the wrong type passes", () => {
    // Stored as free text before the field became a Number.
    expect(
      validate(
        { "Estimated Duration": "about an hour", Impact: "High" },
        { "Estimated Duration": "about an hour" },
      ),
    ).toEqual([]);
  });

  test("changing a legacy value to another invalid one fails", () => {
    expect(
      fieldNames(validate({ Impact: "Critical" }, { Impact: "Severe" })),
    ).toEqual(["Impact"]);
  });

  test("changing a legacy value to a valid one passes", () => {
    expect(validate({ Impact: "High" }, { Impact: "Severe" })).toEqual([]);
  });

  test("a multi-select keeps its removed options, and only new ones are checked", () => {
    expect(
      validate({ Regions: ["Old", "East"] }, { Regions: ["Old"] }),
    ).toEqual([]);

    expect(
      fieldNames(validate({ Regions: ["Old", "South"] }, { Regions: ["Old"] })),
    ).toEqual(["Regions"]);
  });

  test("a multi-select in a different order is unchanged", () => {
    expect(
      validate({ Regions: ["Gone", "Old"] }, { Regions: ["Old", "Gone"] }),
    ).toEqual([]);
  });

  test("a multi-select that was a single value keeps it", () => {
    expect(validate({ Regions: ["Old", "West"] }, { Regions: "Old" })).toEqual(
      [],
    );
  });

  test("a date sent as a Date matches the same stored string", () => {
    expect(
      validate(
        { "Expected Resolution": new Date("2026-09-27T14:30:00.000Z") },
        { "Expected Resolution": "2026-09-27T14:30:00.000Z" },
      ),
    ).toEqual([]);
  });

  test("every value counts as changed on create", () => {
    expect(fieldNames(validate({ Impact: "Severe" }, {}))).toEqual(["Impact"]);
    expect(fieldNames(validate({ Impact: "Severe" }))).toEqual(["Impact"]);
    expect(fieldNames(validate({ Impact: "Severe" }, null))).toEqual([
      "Impact",
    ]);
  });
});

describe("validateCustomFieldValues - what always passes", () => {
  test("keys with no definition pass", () => {
    expect(
      validate({ "Deleted Field": { anything: [1, 2] }, Renamed: "banana" }),
    ).toEqual([]);
  });

  test("keys match definitions by exact name", () => {
    // A differently cased key is some other (unknown) key, not "Impact".
    expect(validate({ impact: "Critical" })).toEqual([]);
  });

  test.each([[null], [undefined], [""], [[]]])(
    "clearing a field with %j passes",
    (value: unknown) => {
      expect(
        validate(
          {
            Impact: value,
            Regions: value,
            "Estimated Duration": value,
            Acknowledgement: value,
          },
          { Impact: "High", Regions: ["East"] },
        ),
      ).toEqual([]);
    },
  );

  test("false and 0 are values, and are checked as such", () => {
    expect(
      validate({ Acknowledgement: false, "Estimated Duration": 0 }),
    ).toEqual([]);
    expect(fieldNames(validate({ Impact: 0 }))).toEqual(["Impact"]);
  });

  test.each([[null], [undefined], ["a string"], [["an", "array"]], [42]])(
    "a bag that is not an object (%j) is left to the rest of the write",
    (customFields: unknown) => {
      expect(validate(customFields)).toEqual([]);
    },
  );

  test("a stored bag that is not an object counts as empty", () => {
    expect(fieldNames(validate({ Impact: "Nope" }, "garbage"))).toEqual([
      "Impact",
    ]);
    expect(validate({ Impact: "High" }, ["garbage"])).toEqual([]);
  });

  test("no definitions means nothing to check", () => {
    expect(
      validateCustomFieldValues({
        definitions: [],
        customFields: { Impact: "anything" },
      }),
    ).toEqual([]);
  });

  test("a field type this version does not know passes", () => {
    expect(
      validateCustomFieldValues({
        definitions: [
          {
            name: "Future",
            customFieldType: "Geolocation" as CustomFieldType,
          },
        ],
        customFields: { Future: { lat: 1, lng: 2 } },
      }),
    ).toEqual([]);
  });
});
