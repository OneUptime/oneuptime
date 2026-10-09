import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FormField,
  FormFieldSource,
  FormSubmitterField,
} from "../../../Types/Form/FormField";
import {
  BuiltPublicForm,
  buildPublicForm,
  PublicFormField,
  validateFormTemplateAnswers,
} from "../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import {
  FORM_TEMPLATE_NAME_MAX_LENGTH,
  FormTemplate,
  FormTemplateFieldSetting,
  FormTemplateFieldSettings,
  isFormTemplateId,
  readFormTemplateIdFromSearch,
  validateFormTemplates,
} from "../../../Types/Form/FormTemplate";
import { JSONObject } from "../../../Types/JSON";
import { ACCOUNTS_URL } from "../../../UI/Config";
import { getPublicFormFieldKey } from "../../../UI/Components/PublicForm/PublicFormFields";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import {
  fitFormTemplateToQuestions,
  FORM_DEFAULT_CHOICE,
  FORM_TEMPLATE_FIELD_SETTING_TEXT,
  FormTemplateEditorQuestion,
  FormTemplateSettingChoice,
  getFormTemplateAnsweredLabels,
  getFormTemplateEditorQuestions,
  getFormTemplateEditorSettings,
  getFormTemplateEditorValues,
  getFormTemplateQuestionAsked,
  getFormTemplateSettingChoices,
  getFormTemplateSettingSummary,
  getFormTemplateShareLink,
  readFormTemplateFromEditor,
  setFormTemplateSetting,
  TEMPLATE_DEFAULT_KEY,
  TEMPLATE_FIELD_SETTINGS_KEY,
  TEMPLATE_NAME_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Templates/FormTemplatesState";
import { describe, expect, test } from "@jest/globals";

/*
 * The Templates page's rules, without drawing it: the questions a
 * template's editor asks (every question the form can answer, hidden ones
 * too, none required, each with how the form asks it), how the template
 * asks each one (the Questions rows: Form default, Required, Optional,
 * Hidden), what the editor starts with, the template its values make
 * (answers packed as a submission's are, so the server reads them alike),
 * what a template's row says it fills in and changes, a copy as it is
 * saved, and its link.
 */

const SEVERITY_ID: string = "0a0a0a0a-0000-4000-8000-000000000001";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "Title",
    isRequired: true,
  },
  {
    id: "description",
    source: FormFieldSource.TargetField,
    targetField: "description",
    label: "Description",
    isRequired: false,
    isHidden: true,
  },
  {
    id: "severity",
    source: FormFieldSource.TargetField,
    targetField: "incidentSeverityId",
    label: "Severity",
    isRequired: false,
  },
  {
    id: "offices",
    source: FormFieldSource.Question,
    type: CustomFieldType.MultiSelectDropdown,
    dropdownOptions: "Berlin\nLondon",
    label: "Offices",
    isRequired: false,
  },
  {
    id: "confirmed",
    source: FormFieldSource.Question,
    type: CustomFieldType.Boolean,
    label: "Confirmed",
    isRequired: true,
  },
  {
    id: "email",
    source: FormFieldSource.Submitter,
    submitterField: FormSubmitterField.Email,
    label: "Your Email",
    isRequired: true,
  },
];

const BUILT: BuiltPublicForm = buildPublicForm({
  form: { name: "F", fields: FIELDS, targetType: FormTargetType.Incident },
  customFields: [],
  recordOptions: {
    [FormTargetOptionsSource.IncidentSeverity]: [
      { id: SEVERITY_ID, name: "Critical" },
    ],
  },
  isCaptchaRequired: false,
});

const QUESTIONS: Array<FormTemplateEditorQuestion> =
  getFormTemplateEditorQuestions(BUILT);

const OUTAGE: FormTemplate = {
  id: "outage",
  name: "Application Outage",
  isDefault: true,
  answers: {
    title: "The application is down",
    description: "We are aware of an outage.",
    severity: SEVERITY_ID,
    offices: ["Berlin"],
    confirmed: true,
  },
};

describe("the questions a template's editor asks", () => {
  test("every question the form can answer, hidden ones too, in the form's order", () => {
    expect(
      QUESTIONS.map((question: FormTemplateEditorQuestion): string => {
        return question.field.id;
      }),
    ).toEqual([
      "title",
      "description",
      "severity",
      "offices",
      "confirmed",
      "email",
    ]);
  });

  test("says which are hidden", () => {
    expect(
      QUESTIONS.filter((question: FormTemplateEditorQuestion): boolean => {
        return question.isHidden;
      }).map((question: FormTemplateEditorQuestion): string => {
        return question.field.id;
      }),
    ).toEqual(["description"]);
  });

  test("none is required: a template answers what it likes", () => {
    for (const question of QUESTIONS) {
      expect(question.field.isRequired).toBe(false);
    }

    // What the public page asks is left as it was.
    expect(
      BUILT.form.fields.find((field: PublicFormField): boolean => {
        return field.id === "title";
      })!.isRequired,
    ).toBe(true);
  });
});

describe("what the editor starts with", () => {
  test("a new template: no name, not the default, nothing answered, every question asked as the form asks it", () => {
    expect(
      getFormTemplateEditorValues({
        template: undefined,
        questions: QUESTIONS,
      }),
    ).toEqual({
      [TEMPLATE_NAME_KEY]: "",
      [TEMPLATE_DEFAULT_KEY]: false,
      [TEMPLATE_FIELD_SETTINGS_KEY]: {},
    });
  });

  test("a template being edited: its name, Default, and its answers where the inputs hold them", () => {
    expect(
      getFormTemplateEditorValues({ template: OUTAGE, questions: QUESTIONS }),
    ).toEqual({
      [TEMPLATE_NAME_KEY]: "Application Outage",
      [TEMPLATE_DEFAULT_KEY]: true,
      [TEMPLATE_FIELD_SETTINGS_KEY]: {},
      [getPublicFormFieldKey("title")]: "The application is down",
      [getPublicFormFieldKey("description")]: "We are aware of an outage.",
      [getPublicFormFieldKey("severity")]: SEVERITY_ID,
      [getPublicFormFieldKey("offices")]: ["Berlin"],
      [getPublicFormFieldKey("confirmed")]: true,
    });
  });

  test("an answer to a question since removed, or one it would now refuse, is left out - so saving drops it", () => {
    expect(
      getFormTemplateEditorValues({
        template: {
          id: "stale",
          name: "Stale",
          answers: { removed: "x", offices: ["Paris"], title: "Down" },
          fieldSettings: { removed: FormTemplateFieldSetting.Hidden },
        },
        questions: QUESTIONS,
      }),
    ).toEqual({
      [TEMPLATE_NAME_KEY]: "Stale",
      [TEMPLATE_DEFAULT_KEY]: false,
      [TEMPLATE_FIELD_SETTINGS_KEY]: {},
      [getPublicFormFieldKey("title")]: "Down",
    });
  });
});

describe("the template the editor's answers make", () => {
  test("a new template gets a fresh id; its name is trimmed", () => {
    const template: FormTemplate = readFormTemplateFromEditor({
      values: {
        [TEMPLATE_NAME_KEY]: "  Planned Maintenance  ",
        [getPublicFormFieldKey("title")]: "Maintenance tonight",
      },
      questions: QUESTIONS,
      template: undefined,
    });

    expect(isFormTemplateId(template.id)).toBe(true);
    expect(template).toEqual({
      id: template.id,
      name: "Planned Maintenance",
      answers: { title: "Maintenance tonight" },
    });
  });

  test("an edited template keeps its id - links name it", () => {
    expect(
      readFormTemplateFromEditor({
        values: { [TEMPLATE_NAME_KEY]: "Outage" },
        questions: QUESTIONS,
        template: OUTAGE,
      }).id,
    ).toBe("outage");
  });

  test("Default ticked makes it the default; unticked, it carries no Default at all", () => {
    expect(
      readFormTemplateFromEditor({
        values: { [TEMPLATE_NAME_KEY]: "A", [TEMPLATE_DEFAULT_KEY]: true },
        questions: QUESTIONS,
        template: undefined,
      }).isDefault,
    ).toBe(true);
    expect(
      readFormTemplateFromEditor({
        values: { [TEMPLATE_NAME_KEY]: "A", [TEMPLATE_DEFAULT_KEY]: "true" },
        questions: QUESTIONS,
        template: undefined,
      }).isDefault,
    ).toBe(true);
    expect(
      readFormTemplateFromEditor({
        values: { [TEMPLATE_NAME_KEY]: "A", [TEMPLATE_DEFAULT_KEY]: false },
        questions: QUESTIONS,
        template: OUTAGE,
      }),
    ).not.toHaveProperty("isDefault");
  });

  test("a name too long is cut to fit; a name that is not text is no name", () => {
    expect(
      readFormTemplateFromEditor({
        values: { [TEMPLATE_NAME_KEY]: "x".repeat(150) },
        questions: QUESTIONS,
        template: undefined,
      }).name,
    ).toHaveLength(FORM_TEMPLATE_NAME_MAX_LENGTH);
    expect(
      readFormTemplateFromEditor({
        values: { [TEMPLATE_NAME_KEY]: 7 as unknown as string },
        questions: QUESTIONS,
        template: undefined,
      }).name,
    ).toBe("");
  });

  test("answers are packed as a submission's: a choice as its value, a hidden question's too", () => {
    const template: FormTemplate = readFormTemplateFromEditor({
      values: {
        [TEMPLATE_NAME_KEY]: "Outage",
        [getPublicFormFieldKey("severity")]: {
          value: SEVERITY_ID,
          label: "Critical",
        } as unknown as string,
        [getPublicFormFieldKey("offices")]: ["London"] as unknown as string,
        [getPublicFormFieldKey("description")]: "Standard text.",
        [getPublicFormFieldKey("confirmed")]: true,
        // Not a question of the form: never kept.
        projectId: "never",
      },
      questions: QUESTIONS,
      template: undefined,
    });

    expect(template.answers).toEqual({
      severity: SEVERITY_ID,
      offices: ["London"],
      description: "Standard text.",
      confirmed: true,
    });
  });

  test("what the editor makes, the server accepts", () => {
    const template: FormTemplate = readFormTemplateFromEditor({
      values: getFormTemplateEditorValues({
        template: OUTAGE,
        questions: QUESTIONS,
      }),
      questions: QUESTIONS,
      template: OUTAGE,
    });

    expect(template).toEqual(OUTAGE);
    expect(
      validateFormTemplateAnswers({
        templates: [template],
        fields: BUILT.allFields,
      }),
    ).toBeNull();
  });
});

describe("what a template's row says it fills in", () => {
  test("the labels of the questions it answers, in the form's order", () => {
    expect(
      getFormTemplateAnsweredLabels({ template: OUTAGE, questions: QUESTIONS }),
    ).toEqual(["Title", "Description", "Severity", "Offices", "Confirmed"]);
  });

  test("an answer that no longer suits its question is not counted", () => {
    expect(
      getFormTemplateAnsweredLabels({
        template: {
          id: "a",
          name: "A",
          answers: {
            offices: ["Paris"],
            removed: "x",
            email: "ops@example.com",
          },
        },
        questions: QUESTIONS,
      }),
    ).toEqual(["Your Email"]);
  });

  test("a template that answers nothing says nothing", () => {
    expect(
      getFormTemplateAnsweredLabels({
        template: { id: "a", name: "A", answers: {} as JSONObject },
        questions: QUESTIONS,
      }),
    ).toEqual([]);
  });
});

describe("a template's link", () => {
  test("is the form's link, naming the template", () => {
    const link: string = getFormTemplateShareLink({
      shareKey: SHARE_KEY,
      templateId: "outage",
    });

    expect(link).toBe(
      `${ACCOUNTS_URL.toString()}/form/${SHARE_KEY}?template=outage`,
    );
    expect(readFormTemplateIdFromSearch(link.slice(link.indexOf("?")))).toBe(
      "outage",
    );
  });
});

/*
 * How a template asks each question (issue #4563): the Questions rows of
 * its editor, what they start with, what they save, and what the list says
 * a template changes.
 */

// A maintenance form: when the work starts and ends, every template asks.
const MAINTENANCE_FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "Title",
    isRequired: true,
  },
  {
    id: "starts",
    source: FormFieldSource.TargetField,
    targetField: "startsAt",
    label: "Starts At",
    isRequired: true,
  },
  {
    id: "ends",
    source: FormFieldSource.TargetField,
    targetField: "endsAt",
    label: "Ends At",
    isRequired: true,
  },
  {
    id: "ticket",
    source: FormFieldSource.Question,
    type: CustomFieldType.Text,
    label: "Change Ticket",
    isRequired: false,
  },
];

const MAINTENANCE_BUILT: BuiltPublicForm = buildPublicForm({
  form: {
    name: "M",
    fields: MAINTENANCE_FIELDS,
    targetType: FormTargetType.ScheduledMaintenance,
  },
  customFields: [],
  recordOptions: {},
  isCaptchaRequired: false,
});

const MAINTENANCE_QUESTIONS: Array<FormTemplateEditorQuestion> =
  getFormTemplateEditorQuestions(MAINTENANCE_BUILT);

function question(
  questions: Array<FormTemplateEditorQuestion>,
  id: string,
): FormTemplateEditorQuestion {
  return questions.find((candidate: FormTemplateEditorQuestion): boolean => {
    return candidate.field.id === id;
  })!;
}

const Required: FormTemplateFieldSetting = FormTemplateFieldSetting.Required;
const Optional: FormTemplateFieldSetting = FormTemplateFieldSetting.Optional;
const Hidden: FormTemplateFieldSetting = FormTemplateFieldSetting.Hidden;

describe("how the form asks each question, as the editor knows it", () => {
  test("each question says whether the form requires it, hides it, or cannot do without it", () => {
    expect(
      QUESTIONS.map((candidate: FormTemplateEditorQuestion): unknown => {
        return [
          candidate.field.id,
          candidate.isRequired,
          candidate.isHidden,
          candidate.isLocked,
        ];
      }),
    ).toEqual([
      ["title", true, false, false],
      ["description", false, true, false],
      ["severity", false, false, false],
      ["offices", false, false, false],
      ["confirmed", true, false, false],
      ["email", true, false, false],
    ]);
  });

  test("a maintenance event's start and end are questions no template can change", () => {
    expect(
      MAINTENANCE_QUESTIONS.filter(
        (candidate: FormTemplateEditorQuestion): boolean => {
          return candidate.isLocked;
        },
      ).map((candidate: FormTemplateEditorQuestion): string => {
        return candidate.field.id;
      }),
    ).toEqual(["starts", "ends"]);
  });

  test("the editor's own copy of a question carries no hidden mark: it is asked there", () => {
    expect(question(QUESTIONS, "description").field).not.toHaveProperty(
      "isHidden",
    );
  });
});

describe("the choices a question's row offers", () => {
  function choices(candidate: FormTemplateEditorQuestion): Array<string> {
    return getFormTemplateSettingChoices(candidate).map(
      (choice: FormTemplateSettingChoice): string => {
        return `${choice.value}=${choice.label}`;
      },
    );
  }

  test("the form's own setting first, saying what it is, then Required, Optional and Hidden", () => {
    expect(choices(question(QUESTIONS, "title"))).toEqual([
      `${FORM_DEFAULT_CHOICE}=Form default (Required)`,
      "Required=Required",
      "Optional=Optional",
      "Hidden=Hidden",
    ]);
  });

  test("the form default names a question the form hides as hidden, and an optional one as optional", () => {
    expect(choices(question(QUESTIONS, "description"))[0]).toBe(
      `${FORM_DEFAULT_CHOICE}=${FormsCopy.settingFormDefaultHidden}`,
    );
    expect(choices(question(QUESTIONS, "severity"))[0]).toBe(
      `${FORM_DEFAULT_CHOICE}=${FormsCopy.settingFormDefaultOptional}`,
    );
    expect(choices(question(MAINTENANCE_QUESTIONS, "starts"))[0]).toBe(
      `${FORM_DEFAULT_CHOICE}=${FormsCopy.settingFormDefaultRequired}`,
    );
  });

  test("each setting is named with the dashboard's words", () => {
    expect(FORM_TEMPLATE_FIELD_SETTING_TEXT).toEqual({
      Required: FormsCopy.settingRequired,
      Optional: FormsCopy.settingOptional,
      Hidden: FormsCopy.settingHidden,
    });
    expect([
      FormsCopy.settingFormDefaultRequired,
      FormsCopy.settingFormDefaultOptional,
      FormsCopy.settingFormDefaultHidden,
    ]).toEqual([
      "Form default (Required)",
      "Form default (Optional)",
      "Form default (Hidden)",
    ]);
  });
});

describe("setFormTemplateSetting - one row's picker chose", () => {
  test("a setting is set, and replaced", () => {
    const set: FormTemplateFieldSettings = setFormTemplateSetting({
      settings: {},
      fieldId: "severity",
      choice: "Hidden",
    });

    expect(set).toEqual({ severity: Hidden });
    expect(
      setFormTemplateSetting({
        settings: set,
        fieldId: "severity",
        choice: "Required",
      }),
    ).toEqual({ severity: Required });
  });

  test("the form's default takes the setting out, and leaves the others", () => {
    expect(
      setFormTemplateSetting({
        settings: { severity: Hidden, title: Optional },
        fieldId: "severity",
        choice: FORM_DEFAULT_CHOICE,
      }),
    ).toEqual({ title: Optional });
  });

  test("anything that is not a setting is the form's default", () => {
    expect(
      setFormTemplateSetting({
        settings: { severity: Hidden },
        fieldId: "severity",
        choice: "Sometimes",
      }),
    ).toEqual({});
  });

  test("settings that are not settings are none, and values that are not one are dropped", () => {
    for (const settings of [null, undefined, "Hidden", ["Hidden"]]) {
      expect(
        setFormTemplateSetting({
          settings,
          fieldId: "title",
          choice: "Optional",
        }),
      ).toEqual({ title: Optional });
    }

    expect(
      setFormTemplateSetting({
        settings: { title: "required", email: Hidden },
        fieldId: "severity",
        choice: "Required",
      }),
    ).toEqual({ email: Hidden, severity: Required });
  });

  test("never changes the settings it was handed", () => {
    const settings: FormTemplateFieldSettings = { severity: Hidden };

    setFormTemplateSetting({ settings, fieldId: "severity", choice: "Required" });
    setFormTemplateSetting({ settings, fieldId: "title", choice: "Optional" });

    expect(settings).toEqual({ severity: Hidden });
  });

  test("a question may be called constructor", () => {
    const set: FormTemplateFieldSettings = setFormTemplateSetting({
      settings: {},
      fieldId: "constructor",
      choice: "Hidden",
    });

    expect(Object.keys(set)).toEqual(["constructor"]);
    expect(set["constructor"]).toBe(Hidden);
  });
});

describe("getFormTemplateEditorSettings - the settings a template can keep", () => {
  test("the editor's questions only, in the form's order", () => {
    expect(
      Object.entries(
        getFormTemplateEditorSettings({
          settings: {
            email: Hidden,
            removed: Required,
            title: Optional,
            severity: "sometimes",
          },
          questions: QUESTIONS,
        }),
      ),
    ).toEqual([
      ["title", Optional],
      ["email", Hidden],
    ]);
  });

  test("never one for a question the target cannot do without", () => {
    expect(
      getFormTemplateEditorSettings({
        settings: { starts: Hidden, ends: Required, ticket: Hidden },
        questions: MAINTENANCE_QUESTIONS,
      }),
    ).toEqual({ ticket: Hidden });
  });

  test("none from anything that is not settings", () => {
    for (const settings of [null, undefined, "Hidden", ["Hidden"], 7]) {
      expect(
        getFormTemplateEditorSettings({ settings, questions: QUESTIONS }),
      ).toEqual({});
    }
  });
});

describe("the template the editor's settings make", () => {
  const PLANNED: FormTemplate = {
    id: "planned",
    name: "Planned Maintenance",
    answers: { title: "Planned maintenance", description: "Standard text." },
    fieldSettings: { description: Required, offices: Hidden, email: Optional },
  };

  test("the editor starts with the template's settings", () => {
    expect(
      getFormTemplateEditorValues({ template: PLANNED, questions: QUESTIONS })[
        TEMPLATE_FIELD_SETTINGS_KEY
      ],
    ).toEqual(PLANNED.fieldSettings);
  });

  test("its settings are saved with it", () => {
    const template: FormTemplate = readFormTemplateFromEditor({
      values: {
        [TEMPLATE_NAME_KEY]: "Planned",
        [TEMPLATE_FIELD_SETTINGS_KEY]: {
          severity: Required,
          description: Optional,
        } as unknown as JSONObject,
      },
      questions: QUESTIONS,
      template: undefined,
    });

    expect(template.fieldSettings).toEqual({
      description: Optional,
      severity: Required,
    });
  });

  test("a template that asks every question as the form does saves no settings", () => {
    for (const settings of [{}, undefined, null]) {
      expect(
        readFormTemplateFromEditor({
          values: {
            [TEMPLATE_NAME_KEY]: "A",
            [TEMPLATE_FIELD_SETTINGS_KEY]: settings as unknown as JSONObject,
          },
          questions: QUESTIONS,
          template: undefined,
        }),
      ).not.toHaveProperty("fieldSettings");
    }
  });

  test("a setting for a question the editor does not ask, or one the target cannot do without, is never saved", () => {
    expect(
      readFormTemplateFromEditor({
        values: {
          [TEMPLATE_NAME_KEY]: "Night Work",
          [TEMPLATE_FIELD_SETTINGS_KEY]: {
            starts: Hidden,
            removed: Hidden,
            ticket: Required,
          } as unknown as JSONObject,
        },
        questions: MAINTENANCE_QUESTIONS,
        template: undefined,
      }).fieldSettings,
    ).toEqual({ ticket: Required });
  });

  test("what the editor makes of a template with settings is that template - and the server accepts it", () => {
    const template: FormTemplate = readFormTemplateFromEditor({
      values: getFormTemplateEditorValues({
        template: PLANNED,
        questions: QUESTIONS,
      }),
      questions: QUESTIONS,
      template: PLANNED,
    });

    expect(template).toEqual(PLANNED);
    expect(validateFormTemplates([template])).toBeNull();
    expect(
      validateFormTemplateAnswers({
        templates: [template],
        fields: BUILT.allFields,
        lockedFieldIds: BUILT.lockedFieldIds,
        targetType: FormTargetType.Incident,
      }),
    ).toBeNull();
  });

  test("a maintenance template the editor makes passes the server's check of what it may not hide", () => {
    const template: FormTemplate = readFormTemplateFromEditor({
      values: {
        [TEMPLATE_NAME_KEY]: "Night Work",
        [TEMPLATE_FIELD_SETTINGS_KEY]: {
          starts: Hidden,
          ends: Optional,
          title: Hidden,
        } as unknown as JSONObject,
      },
      questions: MAINTENANCE_QUESTIONS,
      template: undefined,
    });

    expect(
      validateFormTemplateAnswers({
        templates: [template],
        fields: MAINTENANCE_BUILT.allFields,
        lockedFieldIds: MAINTENANCE_BUILT.lockedFieldIds,
        targetType: FormTargetType.ScheduledMaintenance,
      }),
    ).toBeNull();
  });
});

describe("getFormTemplateQuestionAsked - whether starting from the template asks a question", () => {
  test("the template's setting, or else the form's", () => {
    const settings: FormTemplateFieldSettings = {
      description: Optional,
      title: Hidden,
    };

    expect(
      QUESTIONS.map((candidate: FormTemplateEditorQuestion): unknown => {
        const asked: { isAsked: boolean; isRequired: boolean } =
          getFormTemplateQuestionAsked({ question: candidate, settings });

        return [candidate.field.id, asked.isAsked, asked.isRequired];
      }),
    ).toEqual([
      ["title", false, false],
      ["description", true, false],
      ["severity", true, false],
      ["offices", true, false],
      ["confirmed", true, true],
      ["email", true, true],
    ]);
  });

  test("no settings: the form's own; a question the form hides is not asked", () => {
    for (const settings of [undefined, null, "junk"]) {
      expect(
        getFormTemplateQuestionAsked({
          question: question(QUESTIONS, "description"),
          settings,
        }).isAsked,
      ).toBe(false);
    }
  });

  test("a question the target cannot do without is asked whatever the settings say", () => {
    expect(
      getFormTemplateQuestionAsked({
        question: question(MAINTENANCE_QUESTIONS, "starts"),
        settings: { starts: Hidden },
      }),
    ).toEqual({ isAsked: true, isRequired: true });
  });
});

describe("what a template's row says it changes", () => {
  test("each question it asks its own way, with how, in the form's order", () => {
    expect(
      getFormTemplateSettingSummary({
        template: {
          id: "a",
          name: "A",
          answers: {},
          fieldSettings: {
            email: Hidden,
            removed: Required,
            description: Required,
          },
        },
        questions: QUESTIONS,
      }),
    ).toEqual([
      { fieldId: "description", label: "Description", setting: Required },
      { fieldId: "email", label: "Your Email", setting: Hidden },
    ]);
  });

  test("a template that asks every question as the form does changes nothing", () => {
    expect(
      getFormTemplateSettingSummary({ template: OUTAGE, questions: QUESTIONS }),
    ).toEqual([]);
  });
});

describe("fitFormTemplateToQuestions - a copy keeps only what it can use", () => {
  test("drops answers and settings a question removed or changed since left behind", () => {
    expect(
      fitFormTemplateToQuestions({
        template: {
          id: "copy",
          name: "Outage 2",
          answers: { title: "Down", removed: "x", offices: ["Paris"] },
          fieldSettings: { removed: Hidden, severity: Required },
        },
        questions: QUESTIONS,
      }),
    ).toEqual({
      id: "copy",
      name: "Outage 2",
      answers: { title: "Down" },
      fieldSettings: { severity: Required },
    });
  });

  test("a copy left with no settings carries none; one that fits is kept as it is", () => {
    expect(
      fitFormTemplateToQuestions({
        template: {
          id: "copy",
          name: "Copy",
          answers: {},
          fieldSettings: { removed: Hidden },
        },
        questions: QUESTIONS,
      }),
    ).not.toHaveProperty("fieldSettings");

    expect(
      fitFormTemplateToQuestions({ template: OUTAGE, questions: QUESTIONS }),
    ).toEqual(OUTAGE);
  });
});
