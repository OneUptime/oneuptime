import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import {
  buildCustomFieldFormFields,
  CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE,
  CustomFieldFormDefinition,
  getCustomFieldDetailContentClassName,
  getCustomFieldDisplayValue,
  sortCustomFieldDefinitions,
  toCustomFieldFormDefinition,
} from "../../../../UI/Components/CustomFields/CustomFieldFormFields";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Validation from "../../../../UI/Components/Forms/Validation";
import { describe, expect, test } from "@jest/globals";

/*
 * buildCustomFieldFormFields is the one place that turns a project's custom
 * field definitions into form inputs: for the Custom Fields card, the Details
 * step of declaring an incident, and the incident template pages. What it
 * must get right:
 *
 *   - every field optional unless the caller asks for "Required on create";
 *   - a required Boolean means "must be ticked", which `required` alone does
 *     not enforce;
 *   - the field type is the definition's type, by value;
 *   - dropdowns carry their options (and colors);
 *   - the order is the fields' sortOrder, those without one last.
 */

function definition(
  overrides: Partial<CustomFieldFormDefinition> & { name: string },
): CustomFieldFormDefinition {
  return {
    customFieldType: CustomFieldType.Text,
    ...overrides,
  };
}

type FieldNamed = (
  fields: Array<Field<JSONObject>>,
  name: string,
) => Field<JSONObject>;

const fieldNamed: FieldNamed = (
  fields: Array<Field<JSONObject>>,
  name: string,
): Field<JSONObject> => {
  const field: Field<JSONObject> | undefined = fields.find(
    (candidate: Field<JSONObject>) => {
      return Boolean(candidate.field && (candidate.field as JSONObject)[name]);
    },
  );

  if (!field) {
    throw new Error(`No field for ${name}`);
  }

  return field;
};

describe("buildCustomFieldFormFields", () => {
  test("keys each input by the field's name and passes its type through", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [
        definition({
          name: "Additional Information",
          customFieldType: CustomFieldType.LongText,
          description: "Anything else responders should know.",
        }),
        definition({
          name: "Incident Details",
          customFieldType: CustomFieldType.Markdown,
        }),
        definition({
          name: "Estimated Duration",
          customFieldType: CustomFieldType.Number,
        }),
      ],
    });

    expect(fields).toHaveLength(3);
    expect(fields[0]).toEqual({
      field: { "Additional Information": true },
      title: "Additional Information",
      description: "Anything else responders should know.",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "",
      dropdownOptions: undefined,
    });
    expect(fields[1]!.fieldType).toBe(FormFieldSchemaType.Markdown);
    expect(fields[1]!.description).toBeUndefined();
    expect(fields[2]!.fieldType).toBe(FormFieldSchemaType.Number);
  });

  test("gives dropdowns their options and colors", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [
        definition({
          name: "Impact",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: JSON.stringify([
            { value: "High", color: "#ff0000" },
            { value: "Low" },
          ]),
        }),
        definition({
          name: "Regions",
          customFieldType: CustomFieldType.MultiSelectDropdown,
          dropdownOptions: "East\nWest",
        }),
      ],
    });

    const impact: Array<DropdownOption> = fieldNamed(fields, "Impact")
      .dropdownOptions as Array<DropdownOption>;

    expect(
      impact.map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual(["High", "Low"]);
    expect(impact[0]!.color?.toString().toLowerCase()).toBe("#ff0000");
    expect(impact[1]!.color).toBeUndefined();

    expect(
      (
        fieldNamed(fields, "Regions").dropdownOptions as Array<DropdownOption>
      ).map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual(["East", "West"]);
  });

  test("leaves every field optional by default, even ones required on create", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [
        definition({ name: "Impact", isRequiredOnCreate: true }),
        definition({
          name: "Acknowledgement",
          customFieldType: CustomFieldType.Boolean,
          isRequiredOnCreate: true,
        }),
      ],
    });

    for (const field of fields) {
      expect(field.required).toBe(false);
      expect(field.customValidation).toBeUndefined();
    }
  });

  test("requires the fields marked required on create when asked to", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [
        definition({ name: "Impact", isRequiredOnCreate: true }),
        definition({ name: "Notes" }),
      ],
      enforceRequiredOnCreate: true,
    });

    expect(fieldNamed(fields, "Impact").required).toBe(true);
    expect(fieldNamed(fields, "Notes").required).toBe(false);
  });

  test("a required Boolean has to be ticked, not just touched", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [
        definition({
          name: "Acknowledgement",
          customFieldType: CustomFieldType.Boolean,
          isRequiredOnCreate: true,
        }),
      ],
      enforceRequiredOnCreate: true,
    });

    const acknowledgement: Field<JSONObject> = {
      ...fields[0]!,
      name: "Acknowledgement",
    };

    expect(acknowledgement.required).toBe(true);
    expect(
      acknowledgement.customValidation!({
        Acknowledgement: true,
      } as FormValues<JSONObject>),
    ).toBeNull();

    /*
     * The form's own check: an unticked toggle holds false, which the
     * required check reads as the string "false" and lets through. Only the
     * custom validation catches it.
     */
    const errors: Record<string, string> = Validation.validate<JSONObject>({
      formFields: [acknowledgement],
      values: { Acknowledgement: false } as FormValues<JSONObject>,
      onValidate: undefined,
    });

    expect(errors["Acknowledgement"]).toBe("Acknowledgement must be checked.");
    expect(CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE).toBe(
      "{{field}} must be checked.",
    );

    // Never touched at all is refused by `required` itself.
    expect(
      Validation.validate<JSONObject>({
        formFields: [acknowledgement],
        values: {} as FormValues<JSONObject>,
        onValidate: undefined,
      })["Acknowledgement"],
    ).toBeDefined();

    expect(
      Validation.validate<JSONObject>({
        formFields: [acknowledgement],
        values: { Acknowledgement: true } as FormValues<JSONObject>,
        onValidate: undefined,
      })["Acknowledgement"],
    ).toBeUndefined();
  });

  test("a Boolean that is not required accepts an unticked box", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [
        definition({
          name: "Customer Facing",
          customFieldType: CustomFieldType.Boolean,
        }),
      ],
      enforceRequiredOnCreate: true,
    });

    expect(fields[0]!.customValidation).toBeUndefined();
  });

  test("puts every field on the step it is given", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [definition({ name: "Impact" }), definition({ name: "B" })],
      stepId: "details",
    });

    for (const field of fields) {
      expect(field.stepId).toBe("details");
    }

    expect(
      buildCustomFieldFormFields({
        definitions: [definition({ name: "Impact" })],
      })[0]!.stepId,
    ).toBeUndefined();
  });

  test("keeps the order it is given", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [
        definition({ name: "Zeta", sortOrder: 1 }),
        definition({ name: "Alpha", sortOrder: 2 }),
      ],
    });

    expect(
      fields.map((field: Field<JSONObject>) => {
        return field.title;
      }),
    ).toEqual(["Zeta", "Alpha"]);
  });
});

describe("sortCustomFieldDefinitions", () => {
  test("orders by sortOrder, lowest first, and puts fields without one last", () => {
    const sorted: Array<CustomFieldFormDefinition> = sortCustomFieldDefinitions(
      [
        definition({ name: "No order A" }),
        definition({ name: "Third", sortOrder: 10 }),
        definition({ name: "First", sortOrder: -5 }),
        definition({ name: "No order B", sortOrder: null }),
        definition({ name: "Second", sortOrder: 0 }),
      ],
    );

    expect(
      sorted.map((item: CustomFieldFormDefinition) => {
        return item.name;
      }),
    ).toEqual(["First", "Second", "Third", "No order A", "No order B"]);
  });

  test("keeps the given order among equals", () => {
    const sorted: Array<CustomFieldFormDefinition> = sortCustomFieldDefinitions(
      [
        definition({ name: "B", sortOrder: 1 }),
        definition({ name: "A", sortOrder: 1 }),
        definition({ name: "D" }),
        definition({ name: "C" }),
      ],
    );

    expect(
      sorted.map((item: CustomFieldFormDefinition) => {
        return item.name;
      }),
    ).toEqual(["B", "A", "D", "C"]);
  });

  test("does not reorder the list it was given", () => {
    const list: Array<CustomFieldFormDefinition> = [
      definition({ name: "B", sortOrder: 2 }),
      definition({ name: "A", sortOrder: 1 }),
    ];

    sortCustomFieldDefinitions(list);

    expect(list[0]!.name).toBe("B");
  });

  test("treats a non-number order as none", () => {
    const sorted: Array<{ name: string; sortOrder?: number | null }> =
      sortCustomFieldDefinitions([
        { name: "Broken", sortOrder: NaN },
        { name: "Set", sortOrder: 3 },
      ]);

    expect(sorted[0]!.name).toBe("Set");
  });
});

describe("toCustomFieldFormDefinition", () => {
  test("reads a definition model", () => {
    const item: IncidentCustomField = new IncidentCustomField();
    item.name = "Acknowledgement";
    item.description = "Confirm the customer was told";
    item.customFieldType = CustomFieldType.Boolean;
    item.sortOrder = 3;
    item.showOnCreate = true;
    item.isRequiredOnCreate = true;

    expect(toCustomFieldFormDefinition(item)).toEqual({
      name: "Acknowledgement",
      description: "Confirm the customer was told",
      customFieldType: CustomFieldType.Boolean,
      dropdownOptions: undefined,
      sortOrder: 3,
      showOnCreate: true,
      isRequiredOnCreate: true,
    });
  });

  test("reads the other resources' definitions, which have no incident settings", () => {
    expect(
      toCustomFieldFormDefinition({
        name: "Vendor",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "AWS\nGCP",
      }),
    ).toEqual({
      name: "Vendor",
      description: undefined,
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "AWS\nGCP",
      sortOrder: null,
      showOnCreate: false,
      isRequiredOnCreate: false,
    });
  });

  test.each([
    [null],
    [undefined],
    ["text"],
    [{}],
    [{ name: "" }],
    [{ name: 7 }],
  ])("has nothing to read in %j", (item: unknown) => {
    expect(toCustomFieldFormDefinition(item)).toBeNull();
  });
});

describe("getCustomFieldDisplayValue", () => {
  test.each([
    [CustomFieldType.Markdown, 5, "5"],
    [CustomFieldType.Markdown, true, "true"],
    [CustomFieldType.Markdown, false, "false"],
    [CustomFieldType.LongText, 0, "0"],
    [CustomFieldType.Text, 12.5, "12.5"],
    [CustomFieldType.Text, ["a", "b"], "a, b"],
    // Text stays the text it is.
    [CustomFieldType.Markdown, "**bold**", "**bold**"],
    // Other types keep their values: Detail draws those itself.
    [CustomFieldType.Number, 5, 5],
    [CustomFieldType.Boolean, false, false],
    [CustomFieldType.MultiSelectDropdown, ["a"], ["a"]],
    [undefined, 5, 5],
  ] as Array<[CustomFieldType | undefined, unknown, unknown]>)(
    "a %s field holding %p is shown as %p",
    (type: CustomFieldType | undefined, value: unknown, shown: unknown) => {
      expect(
        getCustomFieldDisplayValue({ customFieldType: type, value: value }),
      ).toEqual(shown);
    },
  );

  test.each([null, undefined])("%p stays empty", (value: unknown) => {
    expect(
      getCustomFieldDisplayValue({
        customFieldType: CustomFieldType.Markdown,
        value: value,
      }),
    ).toBe(value);
  });
});

describe("getCustomFieldDetailContentClassName", () => {
  test("keeps line breaks for Long text only", () => {
    expect(getCustomFieldDetailContentClassName(CustomFieldType.LongText)).toBe(
      "whitespace-pre-wrap",
    );

    for (const type of Object.values(CustomFieldType)) {
      if (type !== CustomFieldType.LongText) {
        expect(getCustomFieldDetailContentClassName(type)).toBeUndefined();
      }
    }

    expect(getCustomFieldDetailContentClassName(undefined)).toBeUndefined();
  });
});
