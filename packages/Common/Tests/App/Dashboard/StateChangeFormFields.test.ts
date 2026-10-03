import { describe, expect, test } from "@jest/globals";
import {
  STATE_CHANGE_NOTE_SECTION_ID,
  STATE_CHANGE_NOTIFY_FIELD_KEY,
  getStateChangeFormFields,
  getStateChangeNoteSection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/StateChangeFormFields";
import {
  BulkStateChangeNoteTemplate,
  BulkStateChangeNoteType,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/BulkStateChange";
import { JSONObject } from "../../../Types/JSON";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { isFormSectionConfigured } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The body every state change dialog shares (Acknowledge, Resolve and the
 * other states on an incident, alert, episode or scheduled maintenance
 * event, and the bulk Change State): what decides the change open - the
 * notify checkbox, where the event reaches a status page - and the optional
 * note folded under "Add a public note" / "Add a private note", with its
 * template picker. These tests pin that shape and what each piece does.
 */

const QUIET: string =
  "Unticked by default because status page subscribers were not notified when this incident was declared.";

const TEMPLATES: Array<BulkStateChangeNoteTemplate> = [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    templateName: "Investigating update",
    note: "We are looking into {{incident.title}}.",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    templateName: "Empty",
    note: "",
  },
];

function keyOf(field: Field<JSONObject>): string {
  return field.overrideFieldKey || Object.keys(field.field || {})[0] || "";
}

function byKey(fields: Fields<JSONObject>, key: string): Field<JSONObject> {
  const found: Field<JSONObject> | undefined = fields.find(
    (field: Field<JSONObject>): boolean => {
      return keyOf(field) === key;
    },
  );

  if (!found) {
    throw new Error(`no ${key} field`);
  }

  return found;
}

function incidentFields(
  overrides?: Partial<Parameters<typeof getStateChangeFormFields>[0]>,
): Fields<JSONObject> {
  return getStateChangeFormFields<JSONObject>({
    noteType: BulkStateChangeNoteType.Public,
    noteDescription:
      "Post a public note about this state change to the status page.",
    noteTemplates: TEMPLATES,
    notifySubscribers: { byDefault: true, quietDescription: QUIET },
    ...(overrides || {}),
  });
}

function alertFields(
  overrides?: Partial<Parameters<typeof getStateChangeFormFields>[0]>,
): Fields<JSONObject> {
  return getStateChangeFormFields<JSONObject>({
    noteType: BulkStateChangeNoteType.Private,
    noteDescription:
      "Add an optional private note about this state change. Only your team can see it.",
    noteTemplates: TEMPLATES,
    ...(overrides || {}),
  });
}

describe("the state change dialog's body", () => {
  test("asks whether subscribers hear about it first, then folds the template and the public note", () => {
    const fields: Fields<JSONObject> = incidentFields();

    expect(fields.map(keyOf)).toEqual([
      STATE_CHANGE_NOTIFY_FIELD_KEY,
      "publicNoteTemplate",
      "publicNote",
    ]);
    expect(
      fields.map((field: Field<JSONObject>): string | undefined => {
        return field.title;
      }),
    ).toEqual([
      "Notify Status Page Subscribers",
      "Select Note Template",
      "Public Note",
    ]);
  });

  test("keeps only the decision open: everything but the checkbox is in the one folded section", () => {
    const fields: Fields<JSONObject> = incidentFields();
    const notify: Field<JSONObject> = byKey(
      fields,
      STATE_CHANGE_NOTIFY_FIELD_KEY,
    );

    expect(notify.collapsibleSection).toBeUndefined();

    const folded: Array<Field<JSONObject>> = fields.filter(
      (field: Field<JSONObject>): boolean => {
        return field !== notify;
      },
    );

    expect(folded).toHaveLength(2);

    // The same section object, so BasicForm draws one folded line.
    expect(folded[0]!.collapsibleSection).toBe(folded[1]!.collapsibleSection);
    expect(folded[0]!.collapsibleSection).toEqual({
      id: STATE_CHANGE_NOTE_SECTION_ID,
      title: "Add a public note",
      openWhenConfigured: false,
    });
  });

  test("an alert or episode has no checkbox: just the private note, folded", () => {
    const fields: Fields<JSONObject> = alertFields();

    expect(fields.map(keyOf)).toEqual(["privateNoteTemplate", "privateNote"]);
    expect(
      fields.some((field: Field<JSONObject>): boolean => {
        return field.fieldType === FormFieldSchemaType.Checkbox;
      }),
    ).toBe(false);

    for (const field of fields) {
      expect(field.collapsibleSection).toEqual({
        id: STATE_CHANGE_NOTE_SECTION_ID,
        title: "Add a private note",
        openWhenConfigured: false,
      });
    }

    expect(byKey(fields, "privateNote").title).toBe("Private Note");
  });

  test("the note is an optional Markdown editor with the help line it is given", () => {
    for (const [fields, key, description] of [
      [
        incidentFields(),
        "publicNote",
        "Post a public note about this state change to the status page.",
      ],
      [
        alertFields(),
        "privateNote",
        "Add an optional private note about this state change. Only your team can see it.",
      ],
    ] as Array<[Fields<JSONObject>, string, string]>) {
      const note: Field<JSONObject> = byKey(fields, key);

      expect(note.fieldType).toBe(FormFieldSchemaType.Markdown);
      expect(note.required).toBe(false);
      expect(note.description).toBe(description);
      // Sent under the key the state timeline services read.
      expect(note.overrideFieldKey).toBe(key);
      expect(note.field).toEqual({ [key]: true });
      expect(note.showEvenIfPermissionDoesNotExist).toBe(true);
    }
  });

  test("a note title of its own wins over the default one", () => {
    expect(
      byKey(alertFields({ noteTitle: "Episode Note" }), "privateNote").title,
    ).toBe("Episode Note");
  });

  test("the folded line is worded for who reads the note", () => {
    expect(
      getStateChangeNoteSection<JSONObject>(BulkStateChangeNoteType.Public),
    ).toEqual({
      id: STATE_CHANGE_NOTE_SECTION_ID,
      title: "Add a public note",
      openWhenConfigured: false,
    });
    expect(
      getStateChangeNoteSection<JSONObject>(BulkStateChangeNoteType.Private)
        .title,
    ).toBe("Add a private note");
  });
});

describe("the notify checkbox", () => {
  test("starts on with the usual line for an event that notified its subscribers", () => {
    const notify: Field<JSONObject> = byKey(
      incidentFields(),
      STATE_CHANGE_NOTIFY_FIELD_KEY,
    );

    expect(notify.fieldType).toBe(FormFieldSchemaType.Checkbox);
    expect(notify.field).toEqual({
      shouldStatusPageSubscribersBeNotified: true,
    });
    expect(notify.defaultValue).toBe(true);
    expect(notify.required).toBe(false);
    expect(notify.description).toBe("Notify subscribers of this state change.");
  });

  test("starts off and says why for a quiet event", () => {
    const notify: Field<JSONObject> = byKey(
      incidentFields({
        notifySubscribers: { byDefault: false, quietDescription: QUIET },
      }),
      STATE_CHANGE_NOTIFY_FIELD_KEY,
    );

    expect(notify.defaultValue).toBe(false);
    expect(notify.description).toBe(QUIET);
  });

  test("never shows an empty line: off with no reason given keeps the usual one", () => {
    const notify: Field<JSONObject> = byKey(
      incidentFields({ notifySubscribers: { byDefault: false } }),
      STATE_CHANGE_NOTIFY_FIELD_KEY,
    );

    expect(notify.defaultValue).toBe(false);
    expect(notify.description).toBe("Notify subscribers of this state change.");
  });

  test("the quiet line is not used while the box starts on", () => {
    expect(
      byKey(
        incidentFields({
          notifySubscribers: { byDefault: true, quietDescription: QUIET },
        }),
        STATE_CHANGE_NOTIFY_FIELD_KEY,
      ).description,
    ).toBe("Notify subscribers of this state change.");
  });
});

describe("the note template picker", () => {
  test("lists the project's templates by name", () => {
    const picker: Field<JSONObject> = byKey(
      incidentFields(),
      "publicNoteTemplate",
    );

    expect(picker.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(picker.required).toBe(false);
    expect(picker.dropdownOptions).toEqual([
      { value: TEMPLATES[0]!.id, label: "Investigating update" },
      { value: TEMPLATES[1]!.id, label: "Empty" },
    ]);
    expect(picker.showIf!({})).toBe(true);
  });

  test("is hidden when the project has no templates", () => {
    const picker: Field<JSONObject> = byKey(
      incidentFields({ noteTemplates: [] }),
      "publicNoteTemplate",
    );

    expect(picker.showIf!({})).toBe(false);
    expect(picker.dropdownOptions).toEqual([]);
  });

  test("picking a template writes it into the note and keeps everything else", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();
    const current: FormValues<JSONObject> = {
      [STATE_CHANGE_NOTIFY_FIELD_KEY]: false,
      privateNote: "a draft",
    };

    byKey(alertFields(), "privateNoteTemplate").onChange!(
      TEMPLATES[0]!.id,
      current,
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues).toHaveBeenCalledWith({
      [STATE_CHANGE_NOTIFY_FIELD_KEY]: false,
      privateNote: "We are looking into {{incident.title}}.",
    });
    // The values it was handed are left alone.
    expect(current["privateNote"]).toBe("a draft");
  });

  test("fills a picked template's placeholders when it is told how", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();
    const fillTemplate: MockFunction = getJestMockFunction();
    fillTemplate.mockImplementation((...args: Array<unknown>): string => {
      return String(args[0]).replace("{{incident.title}}", "Checkout latency");
    });

    byKey(
      incidentFields({
        fillTemplate: fillTemplate as unknown as (note: string) => string,
      }),
      "publicNoteTemplate",
    ).onChange!(TEMPLATES[0]!.id, {}, setNewFormValues);

    expect(fillTemplate).toHaveBeenCalledWith(
      "We are looking into {{incident.title}}.",
    );
    expect(setNewFormValues).toHaveBeenCalledWith({
      publicNote: "We are looking into Checkout latency.",
    });
  });

  test("an unknown or empty template changes nothing, and fills nothing", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();
    const fillTemplate: MockFunction = getJestMockFunction();

    const picker: Field<JSONObject> = byKey(
      incidentFields({
        fillTemplate: fillTemplate as unknown as (note: string) => string,
      }),
      "publicNoteTemplate",
    );

    picker.onChange!(
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      {},
      setNewFormValues,
    );
    picker.onChange!(TEMPLATES[1]!.id, {}, setNewFormValues);
    picker.onChange!("", {}, setNewFormValues);

    expect(setNewFormValues).not.toHaveBeenCalled();
    expect(fillTemplate).not.toHaveBeenCalled();
  });
});

describe("the folded note says Configured while something is in it", () => {
  function isConfigured(values: FormValues<JSONObject>): boolean {
    const folded: Array<Field<JSONObject>> = incidentFields().filter(
      (field: Field<JSONObject>): boolean => {
        return Boolean(field.collapsibleSection);
      },
    );
    const section: FormFieldCollapsibleSection<JSONObject> =
      folded[0]!.collapsibleSection!;

    return isFormSectionConfigured({ section, fields: folded, values });
  }

  test("not while it is empty", () => {
    expect(isConfigured({})).toBe(false);
    expect(isConfigured({ publicNote: "" })).toBe(false);
    expect(isConfigured({ publicNote: "   \n " })).toBe(false);
  });

  test("once a note is written or a template picked", () => {
    expect(isConfigured({ publicNote: "Rolled back the deploy." })).toBe(true);
    expect(isConfigured({ publicNoteTemplate: TEMPLATES[0]!.id })).toBe(true);
  });

  test("not because of the checkbox, which is not in it", () => {
    expect(isConfigured({ [STATE_CHANGE_NOTIFY_FIELD_KEY]: false })).toBe(
      false,
    );
  });
});
