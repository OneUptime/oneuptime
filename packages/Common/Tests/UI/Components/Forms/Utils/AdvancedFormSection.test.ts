import { describe, expect, test } from "@jest/globals";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  ADVANCED_FORM_SECTION_TITLE,
  getAdvancedFormSection,
  isFormFieldValueSet,
  isFormSectionConfigured,
} from "../../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { PeoplePickerKind } from "../../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * "There should be an advanced section, which should be collapsed by
 * default. You can expand it and click on those options." - the maintainer,
 * on the Create Custom Field form.
 *
 * getAdvancedFormSection is the one way a form folds its rarely needed
 * options away: folded on Create and on Edit alike, and saying "Configured"
 * on its header while anything in it is set - worked out from the fields
 * themselves unless the form says otherwise. These are the rules behind
 * that "set"; BasicFormCollapsibleSections draws them.
 */

type Values = FormValues<JSONObject>;

function field(
  key: string,
  fieldType: FormFieldSchemaType,
  extra: Partial<Field<JSONObject>> = {},
): Field<JSONObject> {
  return {
    field: { [key]: true },
    title: key,
    fieldType,
    ...extra,
  };
}

describe("getAdvancedFormSection", () => {
  test("is titled Advanced and stays folded when something in it is set", () => {
    const section: FormFieldCollapsibleSection<JSONObject> =
      getAdvancedFormSection<JSONObject>();

    expect(section).toEqual({
      id: ADVANCED_FORM_SECTION_ID,
      title: ADVANCED_FORM_SECTION_TITLE,
      openWhenConfigured: false,
    });
    expect(ADVANCED_FORM_SECTION_TITLE).toBe("Advanced");
    expect(ADVANCED_FORM_SECTION_ID).toBe("advanced");
    // Worked out from its fields unless the form says otherwise.
    expect(section.isConfigured).toBeUndefined();
  });

  test("takes an id, a description and its own idea of set", () => {
    const isConfigured: (values: Values) => boolean = (
      values: Values,
    ): boolean => {
      return Boolean(values["routing"]);
    };

    const section: FormFieldCollapsibleSection<JSONObject> =
      getAdvancedFormSection<JSONObject>({
        id: "alert-advanced",
        description: "Rarely needed.",
        isConfigured,
      });

    expect(section.id).toBe("alert-advanced");
    expect(section.title).toBe("Advanced");
    expect(section.description).toBe("Rarely needed.");
    expect(section.isConfigured).toBe(isConfigured);
    expect(section.openWhenConfigured).toBe(false);
  });

  test("takes what its defaults do, to say while it is folded", () => {
    const getSummary: (values: Values) => Array<string> | undefined = (
      values: Values,
    ): Array<string> | undefined => {
      return values["expiresAt"]
        ? undefined
        : ["The key expires a year from today."];
    };

    const section: FormFieldCollapsibleSection<JSONObject> =
      getAdvancedFormSection<JSONObject>({ getSummary });

    // Handed to BasicForm as the section's own summary, unchanged.
    expect(section.getSummary).toBe(getSummary);
    expect(section.getSummary!({} as Values)).toEqual([
      "The key expires a year from today.",
    ]);
    expect(
      section.getSummary!({ expiresAt: "2030-01-15" } as Values),
    ).toBeUndefined();
    // Still an Advanced section: folded, and set by its fields.
    expect(section.title).toBe(ADVANCED_FORM_SECTION_TITLE);
    expect(section.openWhenConfigured).toBe(false);
    expect(section.isConfigured).toBeUndefined();
  });

  test("says nothing folded unless asked to", () => {
    expect(getAdvancedFormSection<JSONObject>().getSummary).toBeUndefined();
    expect(
      getAdvancedFormSection<JSONObject>({ description: "Rarely needed." })
        .getSummary,
    ).toBeUndefined();
  });

  test("builds a new section each time, so no form changes another's", () => {
    expect(getAdvancedFormSection()).not.toBe(getAdvancedFormSection());
  });
});

describe("isFormFieldValueSet", () => {
  test("a switch is set when it is on, and only then", () => {
    const toggle: Field<JSONObject> = field(
      "showOnCreate",
      FormFieldSchemaType.Toggle,
    );

    expect(isFormFieldValueSet(toggle, { showOnCreate: true })).toBe(true);
    expect(isFormFieldValueSet(toggle, { showOnCreate: false })).toBe(false);
    expect(isFormFieldValueSet(toggle, {})).toBe(false);
    expect(isFormFieldValueSet(toggle, { showOnCreate: null })).toBe(false);

    const checkbox: Field<JSONObject> = field(
      "agree",
      FormFieldSchemaType.Checkbox,
    );

    expect(isFormFieldValueSet(checkbox, { agree: true })).toBe(true);
    expect(isFormFieldValueSet(checkbox, { agree: false })).toBe(false);
  });

  test("a switch that defaults to on is set when it is turned off", () => {
    const autoResolve: Field<JSONObject> = field(
      "autoResolve",
      FormFieldSchemaType.Toggle,
      { defaultValue: true },
    );

    expect(isFormFieldValueSet(autoResolve, { autoResolve: false })).toBe(true);
    expect(isFormFieldValueSet(autoResolve, { autoResolve: true })).toBe(false);
    // Not touched: it is what the form starts with.
    expect(isFormFieldValueSet(autoResolve, {})).toBe(false);
  });

  test("text is set when it holds something other than blanks or its default", () => {
    const text: Field<JSONObject> = field("notes", FormFieldSchemaType.Text);

    expect(isFormFieldValueSet(text, { notes: "Restart it" })).toBe(true);
    expect(isFormFieldValueSet(text, { notes: "" })).toBe(false);
    expect(isFormFieldValueSet(text, { notes: "   " })).toBe(false);
    expect(isFormFieldValueSet(text, {})).toBe(false);

    const withDefault: Field<JSONObject> = field(
      "title",
      FormFieldSchemaType.Text,
      { defaultValue: "Default title" },
    );

    expect(isFormFieldValueSet(withDefault, { title: "Default title" })).toBe(
      false,
    );
    expect(isFormFieldValueSet(withDefault, { title: "My title" })).toBe(true);
  });

  test("a computed default counts as the default", () => {
    const withComputedDefault: Field<JSONObject> = field(
      "title",
      FormFieldSchemaType.Text,
      {
        getDefaultValue: (values: Values): string => {
          return `Copy of ${values["name"]}`;
        },
      },
    );

    expect(
      isFormFieldValueSet(withComputedDefault, {
        name: "Checkout",
        title: "Copy of Checkout",
      }),
    ).toBe(false);
    expect(
      isFormFieldValueSet(withComputedDefault, {
        name: "Checkout",
        title: "Checkout runbook",
      }),
    ).toBe(true);
  });

  test("a dropdown is set when something is picked, as a value or as its option", () => {
    const dropdown: Field<JSONObject> = field(
      "mapFromResourceType",
      FormFieldSchemaType.Dropdown,
    );

    expect(
      isFormFieldValueSet(dropdown, { mapFromResourceType: "Monitor" }),
    ).toBe(true);
    expect(
      isFormFieldValueSet(dropdown, {
        mapFromResourceType: { label: "Monitor", value: "Monitor" },
      }),
    ).toBe(true);
    // "Enter values by hand" is the empty choice.
    expect(isFormFieldValueSet(dropdown, { mapFromResourceType: "" })).toBe(
      false,
    );
    expect(
      isFormFieldValueSet(dropdown, {
        mapFromResourceType: { label: "Enter values by hand", value: "" },
      }),
    ).toBe(false);
  });

  test("a list is set when it has entries", () => {
    const multi: Field<JSONObject> = field(
      "labels",
      FormFieldSchemaType.MultiSelectDropdown,
    );

    expect(isFormFieldValueSet(multi, { labels: ["label-1"] })).toBe(true);
    expect(isFormFieldValueSet(multi, { labels: [] })).toBe(false);
  });

  test("a number is set unless it is its default, zero included", () => {
    const number: Field<JSONObject> = field(
      "minutes",
      FormFieldSchemaType.Number,
    );

    expect(isFormFieldValueSet(number, { minutes: 0 })).toBe(true);
    expect(isFormFieldValueSet(number, { minutes: 15 })).toBe(true);
    expect(isFormFieldValueSet(number, { minutes: Number.NaN })).toBe(false);

    const withDefault: Field<JSONObject> = field(
      "minutes",
      FormFieldSchemaType.Number,
      { defaultValue: 15 },
    );

    expect(isFormFieldValueSet(withDefault, { minutes: 15 })).toBe(false);
    expect(isFormFieldValueSet(withDefault, { minutes: 30 })).toBe(true);
  });

  test("a date is set unless it is its default", () => {
    const date: Field<JSONObject> = field(
      "startsAt",
      FormFieldSchemaType.Date,
      {
        defaultValue: new Date("2026-10-02T00:00:00.000Z"),
      },
    );

    expect(
      isFormFieldValueSet(date, {
        startsAt: new Date("2026-10-02T00:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isFormFieldValueSet(date, {
        startsAt: new Date("2026-10-03T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  test("an object is set when it has keys", () => {
    const json: Field<JSONObject> = field("headers", FormFieldSchemaType.JSON);

    expect(isFormFieldValueSet(json, { headers: { a: "b" } })).toBe(true);
    expect(isFormFieldValueSet(json, { headers: {} })).toBe(false);
  });

  test("reads a field kept under an override key", () => {
    const overridden: Field<JSONObject> = {
      overrideFieldKey: "customFieldSettings:impact",
      title: "Impact",
      fieldType: FormFieldSchemaType.Dropdown,
    };

    expect(
      isFormFieldValueSet(overridden, {
        "customFieldSettings:impact": "Required",
      }),
    ).toBe(true);
    expect(isFormFieldValueSet(overridden, {})).toBe(false);
  });

  test("a people picker is set when anyone is picked, in any of its kinds", () => {
    const owners: Field<JSONObject> = {
      field: { owners: true },
      title: "Owners",
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: {
        kinds: [
          { kind: PeoplePickerKind.User, valueKey: "ownerUsers" },
          { kind: PeoplePickerKind.Team, valueKey: "ownerTeams" },
        ],
      },
    };

    expect(isFormFieldValueSet(owners, {})).toBe(false);
    expect(
      isFormFieldValueSet(owners, { ownerUsers: [], ownerTeams: [] }),
    ).toBe(false);
    expect(isFormFieldValueSet(owners, { ownerTeams: ["team-1"] })).toBe(true);
    expect(isFormFieldValueSet(owners, { ownerUsers: ["user-1"] })).toBe(true);
  });

  test("a field that names nothing is never set", () => {
    expect(
      isFormFieldValueSet(
        { title: "Read only line", fieldType: FormFieldSchemaType.Text },
        { anything: "value" },
      ),
    ).toBe(false);
  });
});

describe("isFormSectionConfigured", () => {
  const SECTION: FormFieldCollapsibleSection<JSONObject> =
    getAdvancedFormSection<JSONObject>();

  const FIELDS: Array<Field<JSONObject>> = [
    field("showOnCreate", FormFieldSchemaType.Toggle, {
      collapsibleSection: SECTION,
    }),
    field("includeInSubscriberNotifications", FormFieldSchemaType.Toggle, {
      collapsibleSection: SECTION,
    }),
  ];

  test("is configured when any of its fields is set", () => {
    expect(
      isFormSectionConfigured({
        section: SECTION,
        fields: FIELDS,
        values: {},
      }),
    ).toBe(false);
    expect(
      isFormSectionConfigured({
        section: SECTION,
        fields: FIELDS,
        values: {
          showOnCreate: false,
          includeInSubscriberNotifications: false,
        },
      }),
    ).toBe(false);
    expect(
      isFormSectionConfigured({
        section: SECTION,
        fields: FIELDS,
        values: { includeInSubscriberNotifications: true },
      }),
    ).toBe(true);
  });

  test("only counts the fields it is given - the ones on screen", () => {
    expect(
      isFormSectionConfigured({
        section: SECTION,
        fields: [FIELDS[0]!],
        values: { includeInSubscriberNotifications: true },
      }),
    ).toBe(false);
  });

  test("asks the section's own isConfigured first", () => {
    const own: FormFieldCollapsibleSection<JSONObject> = {
      ...SECTION,
      isConfigured: (values: Values): boolean => {
        return values["routing"] === "custom";
      },
    };

    expect(
      isFormSectionConfigured({
        section: own,
        fields: FIELDS,
        values: { showOnCreate: true },
      }),
    ).toBe(false);
    expect(
      isFormSectionConfigured({
        section: own,
        fields: FIELDS,
        values: { routing: "custom" },
      }),
    ).toBe(true);
  });
});
