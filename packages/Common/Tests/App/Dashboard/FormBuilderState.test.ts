import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FORM_MAX_FIELDS,
  FormField,
  FormFieldSource,
  FormSubmitterField,
  createQuestionField,
  getDefaultFormFields,
  getDefaultQuestionOptions,
  isFormFieldId,
  validateFormFields,
} from "../../../Types/Form/FormField";
import { FormCustomFieldDefinition } from "../../../Types/Form/FormPublic";
import { getFormTargetField } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import {
  FormFieldIssue,
  FormFieldsChange,
  FormPaletteState,
  areFormFieldsEqual,
  createPaletteField,
  duplicateFormField,
  findCustomFieldDefinition,
  getFormFieldAnswerType,
  getFormFieldIssues,
  getFormPaletteState,
  getQuestionOptions,
  insertFormField,
  isFormFieldLocked,
  moveFormField,
  moveFormFieldBy,
  removeFormField,
  updateFormField,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderState";
import { describe, expect, test } from "@jest/globals";

/*
 * The form builder's rules, without drawing it: what the palette still
 * offers, where an added question goes, how questions move, what an edit
 * changes, what may be deleted or duplicated, and what a card warns about.
 */

const REGION_ID: string = "d0000000-0000-4000-8000-0000000000f1";
const GONE_ID: string = "d0000000-0000-4000-8000-0000000000f9";
const MONITOR_ID: string = "c1000000-0000-4000-8000-0000000000f1";

const CUSTOM_FIELDS: Array<FormCustomFieldDefinition> = [
  {
    id: REGION_ID,
    name: "Region",
    description: "Where it is",
    customFieldType: CustomFieldType.Dropdown,
    dropdownOptions: "EU\nUS",
  },
];

function question(id: string, label: string = id): FormField {
  return createQuestionField({ type: CustomFieldType.Text, label, id });
}

function ids(fields: Array<FormField>): Array<string> {
  return fields.map((field: FormField): string => {
    return field.id;
  });
}

describe("getFormPaletteState: what the palette still offers", () => {
  test("marks what the form already asks as added", () => {
    const state: FormPaletteState = getFormPaletteState({
      fields: [
        ...getDefaultFormFields(FormTargetType.Incident),
        {
          id: "region",
          source: FormFieldSource.TargetCustomField,
          customFieldId: REGION_ID.toUpperCase(),
          label: "Region",
          isRequired: false,
        },
      ],
      targetType: FormTargetType.Incident,
      customFields: CUSTOM_FIELDS,
    });

    expect(
      state.targetFields.map(
        (entry: { definition: { key: string }; isAdded: boolean }) => {
          return `${entry.definition.key}:${entry.isAdded}`;
        },
      ),
    ).toEqual([
      "title:true",
      "description:true",
      "incidentSeverityId:false",
      "monitors:false",
      "labels:false",
      "impactStartedAt:false",
    ]);
    expect(state.customFields[0]!.isAdded).toBe(true);
    expect(
      state.submitterFields.map(
        (entry: { submitterField: string; isAdded: boolean }) => {
          return `${entry.submitterField}:${entry.isAdded}`;
        },
      ),
    ).toEqual(["Name:true", "Email:true"]);
    expect(state.isFull).toBe(false);
  });

  test("offers the fields of the form's own target", () => {
    expect(
      getFormPaletteState({
        fields: [],
        targetType: FormTargetType.ScheduledMaintenance,
        customFields: [],
      }).targetFields.map((entry: { definition: { key: string } }) => {
        return entry.definition.key;
      }),
    ).toEqual([
      "title",
      "description",
      "startsAt",
      "endsAt",
      "monitors",
      "statusPages",
      "labels",
    ]);
  });

  test("is full at as many questions as a form can have", () => {
    const fields: Array<FormField> = [];

    for (let index: number = 0; index < FORM_MAX_FIELDS; index++) {
      fields.push(question(`q${index}`));
    }

    expect(
      getFormPaletteState({
        fields,
        targetType: FormTargetType.Incident,
        customFields: [],
      }).isFull,
    ).toBe(true);
  });
});

describe("insertFormField: where an added question goes", () => {
  const FIELDS: Array<FormField> = [
    question("a"),
    question("b"),
    question("c"),
  ];

  test("right after the selected question, and selected", () => {
    const change: FormFieldsChange = insertFormField({
      fields: FIELDS,
      field: question("new"),
      afterId: "a",
    });

    expect(ids(change.fields)).toEqual(["a", "new", "b", "c"]);
    expect(change.selectedId).toBe("new");
  });

  test("at the end with nothing selected, or a selection that is gone", () => {
    expect(
      ids(insertFormField({ fields: FIELDS, field: question("new") }).fields),
    ).toEqual(["a", "b", "c", "new"]);
    expect(
      ids(
        insertFormField({
          fields: FIELDS,
          field: question("new"),
          afterId: "x",
        }).fields,
      ),
    ).toEqual(["a", "b", "c", "new"]);
  });

  test("nowhere once the form is full", () => {
    const full: Array<FormField> = [];

    for (let index: number = 0; index < FORM_MAX_FIELDS; index++) {
      full.push(question(`q${index}`));
    }

    const change: FormFieldsChange = insertFormField({
      fields: full,
      field: question("new"),
      afterId: "q3",
    });

    expect(change.fields).toHaveLength(FORM_MAX_FIELDS);
    expect(change.selectedId).toBe("q3");
  });

  test("never changes the list it is given", () => {
    insertFormField({ fields: FIELDS, field: question("new"), afterId: "a" });

    expect(ids(FIELDS)).toEqual(["a", "b", "c"]);
  });
});

describe("createPaletteField: the question a palette entry adds", () => {
  test("a question of the form's own, with a fresh id", () => {
    const field: FormField = createPaletteField({
      kind: "question",
      type: CustomFieldType.Dropdown,
      label: "Untitled question",
    });

    expect(isFormFieldId(field.id)).toBe(true);
    expect(field).toMatchObject({
      source: FormFieldSource.Question,
      type: CustomFieldType.Dropdown,
      label: "Untitled question",
      dropdownOptions: getDefaultQuestionOptions(),
    });
  });

  test("a field of what the form creates, a custom field, the submitter's email", () => {
    expect(
      createPaletteField({
        kind: "target",
        definition: getFormTargetField(FormTargetType.Incident, "monitors")!,
      }),
    ).toMatchObject({
      source: FormFieldSource.TargetField,
      targetField: "monitors",
      label: "Affected Monitors",
    });
    expect(
      createPaletteField({
        kind: "customField",
        definition: CUSTOM_FIELDS[0]!,
      }),
    ).toMatchObject({
      source: FormFieldSource.TargetCustomField,
      customFieldId: REGION_ID,
      label: "Region",
      helpText: "Where it is",
    });
    expect(
      createPaletteField({
        kind: "submitter",
        submitterField: FormSubmitterField.Email,
      }),
    ).toMatchObject({
      source: FormFieldSource.Submitter,
      submitterField: FormSubmitterField.Email,
      label: "Your Email",
    });
  });
});

describe("moving questions", () => {
  const FIELDS: Array<FormField> = [
    question("a"),
    question("b"),
    question("c"),
  ];

  test("a drag moves one question from one place to another", () => {
    expect(
      ids(moveFormField({ fields: FIELDS, fromIndex: 0, toIndex: 2 })),
    ).toEqual(["b", "c", "a"]);
    expect(
      ids(moveFormField({ fields: FIELDS, fromIndex: 2, toIndex: 0 })),
    ).toEqual(["c", "a", "b"]);
  });

  test.each([
    [-1, 1],
    [0, 3],
    [3, 0],
    [1, 1],
  ])(
    "a drag from %p to %p changes nothing",
    (fromIndex: number, toIndex: number) => {
      expect(
        ids(moveFormField({ fields: FIELDS, fromIndex, toIndex })),
      ).toEqual(["a", "b", "c"]);
    },
  );

  test("Move Up and Move Down move one place, and stop at the ends", () => {
    expect(
      ids(moveFormFieldBy({ fields: FIELDS, id: "b", offset: -1 })),
    ).toEqual(["b", "a", "c"]);
    expect(
      ids(moveFormFieldBy({ fields: FIELDS, id: "b", offset: 1 })),
    ).toEqual(["a", "c", "b"]);
    expect(
      ids(moveFormFieldBy({ fields: FIELDS, id: "a", offset: -1 })),
    ).toEqual(["a", "b", "c"]);
    expect(
      ids(moveFormFieldBy({ fields: FIELDS, id: "c", offset: 1 })),
    ).toEqual(["a", "b", "c"]);
    expect(
      ids(moveFormFieldBy({ fields: FIELDS, id: "zz", offset: 1 })),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("updateFormField: an edit on the selected card", () => {
  test("changes the question it names, keeping its id and source", () => {
    const fields: Array<FormField> = updateFormField({
      fields: [question("a"), question("b")],
      id: "b",
      changes: {
        label: "New label",
        id: "hijack",
        source: FormFieldSource.Submitter,
      } as Partial<FormField>,
    });

    expect(fields[1]).toMatchObject({
      id: "b",
      source: FormFieldSource.Question,
      label: "New label",
    });
    expect(fields[0]!.label).toBe("a");
  });

  test("a question that becomes a choice starts with two options; one that stops being one drops them", () => {
    const [dropdown]: Array<FormField> = updateFormField({
      fields: [question("a")],
      id: "a",
      changes: { type: CustomFieldType.Dropdown },
    });

    expect(dropdown!.dropdownOptions).toBe(getDefaultQuestionOptions());

    const [text]: Array<FormField> = updateFormField({
      fields: [dropdown!],
      id: "a",
      changes: { type: CustomFieldType.Number },
    });

    expect(text!.dropdownOptions).toBeUndefined();
  });

  test("switching between dropdown and multi-select keeps the options", () => {
    const [multi]: Array<FormField> = updateFormField({
      fields: [
        createQuestionField({
          type: CustomFieldType.Dropdown,
          label: "Offices",
          id: "o",
          dropdownOptions: "Berlin\nLondon",
        }),
      ],
      id: "o",
      changes: { type: CustomFieldType.MultiSelectDropdown },
    });

    expect(multi!.dropdownOptions).toBe("Berlin\nLondon");
  });

  test("emptying the options does not bring the defaults back", () => {
    const [cleared]: Array<FormField> = updateFormField({
      fields: [
        createQuestionField({
          type: CustomFieldType.Dropdown,
          label: "Offices",
          id: "o",
        }),
      ],
      id: "o",
      changes: { dropdownOptions: "" },
    });

    expect(cleared!.dropdownOptions).toBe("");
  });

  test("an emptied help text is removed rather than stored empty", () => {
    const [field]: Array<FormField> = updateFormField({
      fields: [{ ...question("a"), helpText: "Help" }],
      id: "a",
      changes: { helpText: "" },
    });

    expect("helpText" in field!).toBe(false);
  });
});

describe("updateFormField: hiding a question", () => {
  test("a hidden question is not required: nobody is asked it", () => {
    const [hidden]: Array<FormField> = updateFormField({
      fields: [{ ...question("a"), isRequired: true }],
      id: "a",
      changes: { isHidden: true },
    });

    expect(hidden).toMatchObject({ isHidden: true, isRequired: false });
  });

  test("Required cannot be turned back on while the question is hidden", () => {
    const [hidden]: Array<FormField> = updateFormField({
      fields: [{ ...question("a"), isHidden: true }],
      id: "a",
      changes: { isRequired: true },
    });

    expect(hidden!.isRequired).toBe(false);
  });

  test("a question shown again carries no Hidden at all, and keeps Required as it was left", () => {
    const [shown]: Array<FormField> = updateFormField({
      fields: [{ ...question("a"), isHidden: true }],
      id: "a",
      changes: { isHidden: false },
    });

    expect(shown).not.toHaveProperty("isHidden");
    expect(shown!.isRequired).toBe(false);
  });

  test("an edit that does not touch Hidden leaves a hidden question hidden", () => {
    const [edited]: Array<FormField> = updateFormField({
      fields: [{ ...question("a"), isHidden: true }],
      id: "a",
      changes: { label: "Routing code" },
    });

    expect(edited).toMatchObject({
      label: "Routing code",
      isHidden: true,
      isRequired: false,
    });
  });

  test("what hiding makes is what the server accepts: the incident's description, hidden", () => {
    const defaults: Array<FormField> = getDefaultFormFields(
      FormTargetType.Incident,
    );
    const description: FormField = defaults.find(
      (field: FormField): boolean => {
        return field.targetField === "description";
      },
    )!;

    const fields: Array<FormField> = updateFormField({
      fields: defaults,
      id: description.id,
      changes: { isHidden: true },
    });

    expect(
      fields.find((field: FormField): boolean => {
        return field.id === description.id;
      }),
    ).toMatchObject({ isHidden: true, isRequired: false });
    expect(
      validateFormFields({
        value: fields,
        targetType: FormTargetType.Incident,
      }),
    ).toBeNull();
  });

  test("a question duplicated while hidden is copied hidden", () => {
    const change: FormFieldsChange = duplicateFormField({
      fields: [{ ...question("a"), isHidden: true }],
      id: "a",
    });

    expect(change.fields[1]).toMatchObject({ isHidden: true });
  });
});

describe("what may be deleted or duplicated", () => {
  const MAINTENANCE: Array<FormField> = getDefaultFormFields(
    FormTargetType.ScheduledMaintenance,
  );

  test("a maintenance event's start and end cannot be deleted; anything else can", () => {
    for (const field of MAINTENANCE) {
      const locked: boolean = isFormFieldLocked({
        field,
        targetType: FormTargetType.ScheduledMaintenance,
      });

      expect({
        field: field.targetField || field.submitterField,
        locked,
      }).toEqual({
        field: field.targetField || field.submitterField,
        locked:
          field.targetField === "startsAt" || field.targetField === "endsAt",
      });
    }

    const starts: FormField = MAINTENANCE[2]!;
    const change: FormFieldsChange = removeFormField({
      fields: MAINTENANCE,
      id: starts.id,
      targetType: FormTargetType.ScheduledMaintenance,
    });

    expect(change.fields).toHaveLength(MAINTENANCE.length);
    expect(change.selectedId).toBe(starts.id);
  });

  test("deleting a question removes it and selects nothing", () => {
    const change: FormFieldsChange = removeFormField({
      fields: MAINTENANCE,
      id: MAINTENANCE[0]!.id,
      targetType: FormTargetType.ScheduledMaintenance,
    });

    expect(change.fields).toHaveLength(MAINTENANCE.length - 1);
    expect(change.selectedId).toBeNull();
  });

  test("deleting a question that is not there changes nothing", () => {
    expect(
      removeFormField({
        fields: MAINTENANCE,
        id: "gone",
        targetType: FormTargetType.ScheduledMaintenance,
      }),
    ).toEqual({ fields: MAINTENANCE, selectedId: null });
  });

  test("a question of the form's own is duplicated right below, with a new id", () => {
    const change: FormFieldsChange = duplicateFormField({
      fields: [question("a", "Office"), question("b")],
      id: "a",
    });

    expect(change.fields).toHaveLength(3);
    expect(change.fields[1]!.label).toBe("Office");
    expect(change.fields[1]!.id).not.toBe("a");
    expect(change.selectedId).toBe(change.fields[1]!.id);
  });

  test("a linked question cannot be duplicated: each field is asked once", () => {
    const change: FormFieldsChange = duplicateFormField({
      fields: MAINTENANCE,
      id: MAINTENANCE[0]!.id,
    });

    expect(change.fields).toEqual(MAINTENANCE);
    expect(change.selectedId).toBe(MAINTENANCE[0]!.id);
  });
});

describe("what a card warns about", () => {
  type IssuesFunction = (
    field: FormField,
    targetType?: FormTargetType,
  ) => Array<FormFieldIssue>;

  const issues: IssuesFunction = (
    field: FormField,
    targetType: FormTargetType = FormTargetType.Incident,
  ): Array<FormFieldIssue> => {
    return getFormFieldIssues({
      field,
      targetType,
      customFields: CUSTOM_FIELDS,
    });
  };

  test("a question with no label", () => {
    expect(issues(question("a", "  "))).toEqual([FormFieldIssue.NoLabel]);
  });

  test("a custom field that was deleted", () => {
    expect(
      issues({
        id: "x",
        source: FormFieldSource.TargetCustomField,
        customFieldId: GONE_ID,
        label: "Gone",
        isRequired: false,
      }),
    ).toEqual([FormFieldIssue.CustomFieldDeleted]);
    expect(
      issues({
        id: "x",
        source: FormFieldSource.TargetCustomField,
        customFieldId: REGION_ID.toUpperCase(),
        label: "Region",
        isRequired: false,
      }),
    ).toEqual([]);
  });

  test("monitors offered from none; a severity offering every one is fine", () => {
    expect(
      issues({
        id: "m",
        source: FormFieldSource.TargetField,
        targetField: "monitors",
        label: "Monitors",
        isRequired: false,
      }),
    ).toEqual([FormFieldIssue.NoAllowedOptions]);
    expect(
      issues({
        id: "m",
        source: FormFieldSource.TargetField,
        targetField: "monitors",
        label: "Monitors",
        isRequired: false,
        allowedOptionIds: [MONITOR_ID],
      }),
    ).toEqual([]);
    expect(
      issues({
        id: "s",
        source: FormFieldSource.TargetField,
        targetField: "incidentSeverityId",
        label: "Severity",
        isRequired: false,
      }),
    ).toEqual([]);
  });

  test("a dropdown with no options", () => {
    expect(
      issues({
        ...createQuestionField({
          type: CustomFieldType.MultiSelectDropdown,
          label: "Offices",
          id: "o",
        }),
        dropdownOptions: "",
      }),
    ).toEqual([FormFieldIssue.NoOptions]);
    expect(
      getQuestionOptions(
        createQuestionField({
          type: CustomFieldType.Dropdown,
          label: "x",
          id: "d",
        }),
      ),
    ).toEqual(["Option 1", "Option 2"]);
  });
});

describe("answer types and lookups", () => {
  test("a linked field answers with its catalog type; a custom field with its own; the email as an email", () => {
    expect(
      getFormFieldAnswerType({
        field: {
          id: "w",
          source: FormFieldSource.TargetField,
          targetField: "impactStartedAt",
          label: "When",
          isRequired: false,
        },
        targetType: FormTargetType.Incident,
        customFields: CUSTOM_FIELDS,
      }),
    ).toBe(CustomFieldType.DateTime);
    expect(
      getFormFieldAnswerType({
        field: {
          id: "r",
          source: FormFieldSource.TargetCustomField,
          customFieldId: REGION_ID,
          label: "Region",
          isRequired: false,
        },
        targetType: FormTargetType.Incident,
        customFields: CUSTOM_FIELDS,
      }),
    ).toBe(CustomFieldType.Dropdown);
    expect(
      getFormFieldAnswerType({
        field: {
          id: "g",
          source: FormFieldSource.TargetCustomField,
          customFieldId: GONE_ID,
          label: "Gone",
          isRequired: false,
        },
        targetType: FormTargetType.Incident,
        customFields: CUSTOM_FIELDS,
      }),
    ).toBe(CustomFieldType.Text);
    expect(
      getFormFieldAnswerType({
        field: getDefaultFormFields(FormTargetType.Incident)[3]!,
        targetType: FormTargetType.Incident,
        customFields: [],
      }),
    ).toBe("Email");
  });

  test("a custom field is found by id in any case", () => {
    expect(
      findCustomFieldDefinition(CUSTOM_FIELDS, REGION_ID.toUpperCase()),
    ).toBe(CUSTOM_FIELDS[0]);
    expect(findCustomFieldDefinition(CUSTOM_FIELDS, undefined)).toBeUndefined();
  });

  test("two lists of questions are equal when every question is", () => {
    const fields: Array<FormField> = getDefaultFormFields(
      FormTargetType.Incident,
    );

    expect(areFormFieldsEqual(fields, JSON.parse(JSON.stringify(fields)))).toBe(
      true,
    );
    expect(
      areFormFieldsEqual(fields, [
        { ...fields[0]!, label: "Changed" },
        ...fields.slice(1),
      ]),
    ).toBe(false);
  });
});
