import { describe, expect, test } from "@jest/globals";
import Field from "../../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../../UI/Components/Forms/Types/FormValues";
import {
  FOLDED_FIELD_VALUE_MAX_LENGTH,
  FoldedFieldValue,
  getFoldedFieldValue,
  getFoldedFormFieldItems,
} from "../../../../../UI/Components/Forms/Utils/FoldedFormFields";
import { FoldedSectionItem } from "../../../../../UI/Components/FoldedSection/FoldedSectionItem";
import { PeoplePickerKind } from "../../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * What a folded form section ("More fields") lists on its header: its
 * fields by title, and for each one that is set, what it is set to - in a
 * few words, and only where that is short and safe to show. "Declared At ·
 * Initial State: Investigating · Labels: 2 · Private Incident: On".
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

function valueOf(
  candidate: Field<JSONObject>,
  values: Values,
): FoldedFieldValue | undefined {
  return getFoldedFieldValue(candidate, values);
}

describe("getFoldedFieldValue", () => {
  test("a switch says On or Off, to be looked up", () => {
    const toggle: Field<JSONObject> = field(
      "isPrivate",
      FormFieldSchemaType.Toggle,
    );

    expect(valueOf(toggle, { isPrivate: true })).toEqual({
      value: "On",
      translateValue: true,
    });
    expect(valueOf(toggle, { isPrivate: false })).toEqual({
      value: "Off",
      translateValue: true,
    });

    const checkbox: Field<JSONObject> = field(
      "notify",
      FormFieldSchemaType.Checkbox,
    );

    expect(valueOf(checkbox, { notify: true })).toEqual({
      value: "On",
      translateValue: true,
    });
  });

  test("a pick says the option's label, from whichever list the field offers", () => {
    const dropdown: Field<JSONObject> = field(
      "state",
      FormFieldSchemaType.Dropdown,
      {
        dropdownOptions: [
          { label: "Identified", value: "identified" },
          { label: "Investigating", value: "investigating" },
        ],
      },
    );

    expect(valueOf(dropdown, { state: "investigating" })).toEqual({
      value: "Investigating",
      translateValue: true,
    });

    // A dropdown can hold the option it was picked as.
    expect(
      valueOf(dropdown, {
        state: { label: "Identified", value: "identified" },
      } as unknown as Values),
    ).toEqual({ value: "Identified", translateValue: true });

    const grouped: Field<JSONObject> = field(
      "region",
      FormFieldSchemaType.Dropdown,
      {
        dropdownOptions: [
          {
            label: "Europe",
            options: [{ label: "Frankfurt", value: "fra" }],
          },
        ],
      },
    );

    expect(valueOf(grouped, { region: "fra" })).toEqual({
      value: "Frankfurt",
      translateValue: true,
    });

    const cards: Field<JSONObject> = field(
      "access",
      FormFieldSchemaType.CardSelect,
      {
        cardSelectOptions: [
          {
            value: "admin",
            title: "Project Admin",
            description: "Everything.",
            icon: "Settings" as never,
          },
        ],
      },
    );

    expect(valueOf(cards, { access: "admin" })).toEqual({
      value: "Project Admin",
      translateValue: true,
    });

    const radios: Field<JSONObject> = field(
      "layout",
      FormFieldSchemaType.RadioButton,
      { radioButtonOptions: [{ title: "Grid", value: "grid" }] },
    );

    expect(valueOf(radios, { layout: "grid" })).toEqual({
      value: "Grid",
      translateValue: true,
    });
  });

  test("a pick whose option is not known says nothing beyond being set", () => {
    const dropdown: Field<JSONObject> = field(
      "state",
      FormFieldSchemaType.Dropdown,
      { dropdownOptions: [] },
    );

    expect(valueOf(dropdown, { state: "gone" })).toBeUndefined();
  });

  test("a list of picks says how many", () => {
    const labels: Field<JSONObject> = field(
      "labels",
      FormFieldSchemaType.MultiSelectDropdown,
    );

    expect(valueOf(labels, { labels: ["a", "b"] })).toEqual({
      value: "2",
      translateValue: false,
    });
    expect(valueOf(labels, { labels: [] })).toBeUndefined();
  });

  test("a people picker says how many people and teams are picked", () => {
    const owners: Field<JSONObject> = {
      title: "Owners",
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: {
        kinds: [
          { kind: PeoplePickerKind.User, valueKey: "ownerUsers" },
          { kind: PeoplePickerKind.Team, valueKey: "ownerTeams" },
        ],
      },
    };

    expect(
      valueOf(owners, { ownerUsers: ["u1", "u2"], ownerTeams: ["t1"] }),
    ).toEqual({ value: "3", translateValue: false });
    expect(valueOf(owners, {})).toBeUndefined();
  });

  test("a number says itself", () => {
    const wait: Field<JSONObject> = field(
      "escalateAfterInMinutes",
      FormFieldSchemaType.Number,
    );

    expect(valueOf(wait, { escalateAfterInMinutes: 30 })).toEqual({
      value: "30",
      translateValue: false,
    });
    expect(valueOf(wait, { escalateAfterInMinutes: "45" })).toEqual({
      value: "45",
      translateValue: false,
    });
    expect(valueOf(wait, { escalateAfterInMinutes: NaN })).toBeUndefined();
  });

  test("a line of text says itself, cut to a few words", () => {
    const name: Field<JSONObject> = field("name", FormFieldSchemaType.Text);

    expect(valueOf(name, { name: "  Checkout web  " })).toEqual({
      value: "Checkout web",
      translateValue: false,
    });

    const long: string =
      "Payments in the European region are failing for every card brand";
    const shortened: FoldedFieldValue | undefined = valueOf(name, {
      name: long,
    });

    expect(shortened!.value.endsWith("…")).toBe(true);
    expect(shortened!.value.length).toBeLessThanOrEqual(
      FOLDED_FIELD_VALUE_MAX_LENGTH,
    );
    // Cut on a word.
    expect(long.startsWith(shortened!.value.slice(0, -1))).toBe(true);
    expect(shortened!.value.slice(0, -1).endsWith(" ")).toBe(false);
  });

  test("a date says the day, and a date and time the moment, as the reader's clock reads it", () => {
    const expires: Field<JSONObject> = field(
      "expiresAt",
      FormFieldSchemaType.Date,
    );
    const date: Date = new Date("2027-10-04T12:00:00.000Z");

    expect(valueOf(expires, { expiresAt: date.toISOString() })).toEqual({
      value: OneUptimeDate.getDateAsLocalFormattedString(date, true),
      translateValue: false,
    });

    const declaredAt: Field<JSONObject> = field(
      "declaredAt",
      FormFieldSchemaType.DateTime,
    );

    expect(valueOf(declaredAt, { declaredAt: date } as Values)).toEqual({
      value: OneUptimeDate.getDateAsLocalShortDateTimeString(date),
      translateValue: false,
    });

    expect(valueOf(expires, { expiresAt: "not a date" })).toBeUndefined();
  });

  test("never shows a secret, whatever its field type says", () => {
    expect(
      valueOf(field("password", FormFieldSchemaType.Password), {
        password: "hunter2",
      }),
    ).toBeUndefined();
    expect(
      valueOf(field("token", FormFieldSchemaType.EncryptedText), {
        token: "abc",
      }),
    ).toBeUndefined();
    expect(
      valueOf(field("clientSecret", FormFieldSchemaType.Text), {
        clientSecret: "s3cr3t",
      }),
    ).toBeUndefined();
    expect(
      valueOf(
        field("credential", FormFieldSchemaType.Text, {
          title: "API Key",
        }),
        { credential: "key" },
      ),
    ).toBeUndefined();
  });

  test("a paragraph, code, a colour or a custom editor says nothing beyond being set", () => {
    for (const fieldType of [
      FormFieldSchemaType.LongText,
      FormFieldSchemaType.Markdown,
      FormFieldSchemaType.JSON,
      FormFieldSchemaType.Color,
      FormFieldSchemaType.CustomComponent,
    ]) {
      expect(
        valueOf(field("value", fieldType), { value: "something" }),
      ).toBeUndefined();
    }
  });
});

describe("getFoldedFormFieldItems", () => {
  const DECLARE: Array<Field<JSONObject>> = [
    field("declaredAt", FormFieldSchemaType.DateTime, {
      title: "Declared At",
    }),
    field("initialState", FormFieldSchemaType.Dropdown, {
      title: "Initial State",
      dropdownOptions: [{ label: "Investigating", value: "investigating" }],
    }),
    field("labels", FormFieldSchemaType.MultiSelectDropdown, {
      title: "Labels",
    }),
    field("isPrivate", FormFieldSchemaType.Toggle, {
      title: "Private Incident",
    }),
  ];

  test("lists every field by title, in order, nothing set on a new form", () => {
    expect(getFoldedFormFieldItems(DECLARE, {})).toEqual([
      { key: "declaredAt", title: "Declared At", isSet: false },
      { key: "initialState", title: "Initial State", isSet: false },
      { key: "labels", title: "Labels", isSet: false },
      { key: "isPrivate", title: "Private Incident", isSet: false },
    ]);
  });

  test("says what each set field is set to", () => {
    const items: Array<FoldedSectionItem> = getFoldedFormFieldItems(DECLARE, {
      initialState: "investigating",
      labels: ["a", "b"],
      isPrivate: true,
    });

    expect(items).toEqual([
      { key: "declaredAt", title: "Declared At", isSet: false },
      {
        key: "initialState",
        title: "Initial State",
        isSet: true,
        value: "Investigating",
        translateValue: true,
      },
      { key: "labels", title: "Labels", isSet: true, value: "2" },
      {
        key: "isPrivate",
        title: "Private Incident",
        isSet: true,
        value: "On",
        translateValue: true,
      },
    ]);
  });

  test("a field at its default is not set", () => {
    const items: Array<FoldedSectionItem> = getFoldedFormFieldItems(
      [
        field("autoResolve", FormFieldSchemaType.Toggle, {
          title: "Auto Resolve",
          defaultValue: true,
        }),
        field("unit", FormFieldSchemaType.Dropdown, {
          title: "Unit",
          defaultValue: "seconds",
          dropdownOptions: [
            { label: "Seconds", value: "seconds" },
            { label: "Minutes", value: "minutes" },
          ],
        }),
      ],
      { autoResolve: true, unit: "seconds" },
    );

    expect(
      items.map((candidate: FoldedSectionItem): boolean => {
        return candidate.isSet;
      }),
    ).toEqual([false, false]);

    const changed: Array<FoldedSectionItem> = getFoldedFormFieldItems(
      [
        field("autoResolve", FormFieldSchemaType.Toggle, {
          title: "Auto Resolve",
          defaultValue: true,
        }),
      ],
      { autoResolve: false },
    );

    expect(changed[0]).toEqual({
      key: "autoResolve",
      title: "Auto Resolve",
      isSet: true,
      value: "Off",
      translateValue: true,
    });
  });

  test("a section that says it is not configured shows nothing as set", () => {
    const items: Array<FoldedSectionItem> = getFoldedFormFieldItems(
      [field("name", FormFieldSchemaType.Text, { title: "Name" })],
      { name: "Level 2" },
      { isSectionConfigured: false },
    );

    expect(items).toEqual([{ key: "name", title: "Name", isSet: false }]);
  });

  test("only the set fields, for a section whose title says what it holds", () => {
    expect(
      getFoldedFormFieldItems(
        DECLARE,
        { isPrivate: true },
        { onlySet: true },
      ),
    ).toEqual([
      {
        key: "isPrivate",
        title: "Private Incident",
        isSet: true,
        value: "On",
        translateValue: true,
      },
    ]);
  });

  test("skips a field without a title, lists a title once, and trims it", () => {
    const items: Array<FoldedSectionItem> = getFoldedFormFieldItems(
      [
        field("custom", FormFieldSchemaType.CustomComponent, { title: "" }),
        field("labels", FormFieldSchemaType.MultiSelectDropdown, {
          title: "Labels ",
        }),
        field("labelsAgain", FormFieldSchemaType.MultiSelectDropdown, {
          title: "Labels",
        }),
      ],
      {},
    );

    expect(items).toEqual([{ key: "labels", title: "Labels", isSet: false }]);
  });

  test("names a field by the key its form value is kept under", () => {
    const items: Array<FoldedSectionItem> = getFoldedFormFieldItems(
      [
        {
          title: "Template Variable",
          overrideFieldKey: "templateVariable",
          fieldType: FormFieldSchemaType.Text,
        },
      ],
      { templateVariable: "region" },
    );

    expect(items).toEqual([
      {
        key: "templateVariable",
        title: "Template Variable",
        isSet: true,
        value: "region",
      },
    ]);
  });
});
