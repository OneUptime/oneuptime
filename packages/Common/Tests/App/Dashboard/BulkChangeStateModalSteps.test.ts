import { describe, expect, test } from "@jest/globals";
import {
  BULK_CHANGE_STATE_FORM_STEPS,
  NOTIFY_SUBSCRIBERS_FIELD_KEY,
  getBulkChangeStateFormLayout,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/BulkChangeStateModal";
import { JSONObject } from "../../../Types/JSON";
import Field from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";

/*
 * The bulk Change State modal behind the alerts, episodes and scheduled
 * maintenance tables asks up to four questions: the new state, a note
 * template, the note and whether status page subscribers hear about it. All
 * four make a long form, so it walks two steps - the change itself, then the
 * note - and anything shorter stays one page.
 */

const STATE_KEY: string = "currentAlertStateId";

function field(key: string): Field<JSONObject> {
  return {
    field: { [key]: true },
    title: key,
    fieldType: FormFieldSchemaType.Text,
    required: false,
  };
}

function keyOf(item: Field<JSONObject>): string {
  return Object.keys(item.field || {})[0] || "";
}

const ALL_FOUR: Fields<JSONObject> = [
  field(STATE_KEY),
  field("noteTemplateId"),
  field("note"),
  field(NOTIFY_SUBSCRIBERS_FIELD_KEY),
];

describe("the bulk Change State form's layout", () => {
  test("walks two steps when it asks all four questions", () => {
    const layout: {
      fields: Fields<JSONObject>;
      steps: Array<FormStep<JSONObject>> | undefined;
    } = getBulkChangeStateFormLayout({
      fields: ALL_FOUR,
      stateFieldKey: STATE_KEY,
    });

    expect(layout.steps).toBe(BULK_CHANGE_STATE_FORM_STEPS);
    expect(
      (layout.steps || []).map((step: FormStep<JSONObject>): string => {
        return step.title;
      }),
    ).toEqual(["State", "Note"]);
  });

  test("asks for the state and the subscriber switch first, then the template and the note", () => {
    const layout: { fields: Fields<JSONObject> } = getBulkChangeStateFormLayout(
      {
        fields: ALL_FOUR,
        stateFieldKey: STATE_KEY,
      },
    );

    expect(
      layout.fields.map((item: Field<JSONObject>): [string, unknown] => {
        return [keyOf(item), item.stepId];
      }),
    ).toEqual([
      [STATE_KEY, "state"],
      [NOTIFY_SUBSCRIBERS_FIELD_KEY, "state"],
      ["noteTemplateId", "note"],
      ["note", "note"],
    ]);
  });

  test("leaves the fields it is handed as they were", () => {
    getBulkChangeStateFormLayout({
      fields: ALL_FOUR,
      stateFieldKey: STATE_KEY,
    });

    for (const item of ALL_FOUR) {
      expect(item.stepId).toBeUndefined();
    }
  });

  test.each([
    ["state, template and note", [STATE_KEY, "noteTemplateId", "note"]],
    [
      "state, note and the subscriber switch",
      [STATE_KEY, "note", NOTIFY_SUBSCRIBERS_FIELD_KEY],
    ],
    ["state and note", [STATE_KEY, "note"]],
  ])("stays one page with %s", (_name: string, keys: Array<string>) => {
    const fields: Fields<JSONObject> = keys.map(field);
    const layout: {
      fields: Fields<JSONObject>;
      steps: Array<FormStep<JSONObject>> | undefined;
    } = getBulkChangeStateFormLayout({ fields, stateFieldKey: STATE_KEY });

    expect(layout.steps).toBeUndefined();
    expect(layout.fields).toBe(fields);
  });
});
