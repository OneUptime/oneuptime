import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FORM_TEXT_ANSWER_MAX_LENGTH,
  FormField,
  FormFieldSource,
  FormSubmitterField,
} from "../../../Types/Form/FormField";
import {
  BuiltPublicForm,
  FormAnswerValidationResult,
  FormCustomFieldDefinition,
  FormRecordOption,
  FormSkippedFieldReason,
  FormSubmissionValidationResult,
  PublicForm,
  PublicFormField,
  PublicFormFieldType,
  PublicFormTemplate,
  buildPublicForm,
  findPublicFormTemplate,
  getFormSubmissionTemplate,
  getFormTemplateAnswers,
  getPublicFormStartTemplate,
  readFormSubmissionTemplateId,
  validateFormAnswer,
  validateFormSubmission,
  validateFormTemplateAnswers,
} from "../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { FormTemplate } from "../../../Types/Form/FormTemplate";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Templates and hidden questions on the public side of a form.
 *
 * A hidden question is built like any other - the server answers it - but
 * is never told to the page, never required, and never answered by the
 * request. A template reaches the page only as its answers to the
 * questions the page asks, each checked as a submission's answer to that
 * question would be; the server checks every answer of every template the
 * same way when the templates are written, and answers the hidden questions
 * from the template a submission names.
 */

const SEVERITY_HIGH: string = "0a0a0a0a-0000-4000-8000-000000000001";
const SEVERITY_LOW: string = "0a0a0a0a-0000-4000-8000-000000000002";
const MONITOR_API: string = "0b0b0b0b-0000-4000-8000-000000000001";
const MONITOR_WEB: string = "0b0b0b0b-0000-4000-8000-000000000002";
const MONITOR_SECRET: string = "0b0b0b0b-0000-4000-8000-000000000009";
const CF_TYPE: string = "0e0e0e0e-0000-4000-8000-000000000001";
const CF_GONE: string = "0e0e0e0e-0000-4000-8000-0000000000ff";

const RECORDS: Partial<
  Record<FormTargetOptionsSource, Array<FormRecordOption>>
> = {
  [FormTargetOptionsSource.IncidentSeverity]: [
    { id: SEVERITY_HIGH, name: "High" },
    { id: SEVERITY_LOW, name: "Low" },
  ],
  [FormTargetOptionsSource.Monitor]: [
    { id: MONITOR_API, name: "API" },
    { id: MONITOR_WEB, name: "Website" },
    { id: MONITOR_SECRET, name: "Payroll" },
  ],
};

const CUSTOM_FIELDS: Array<FormCustomFieldDefinition> = [
  {
    id: CF_TYPE,
    name: "Notification Type",
    customFieldType: CustomFieldType.Dropdown,
    dropdownOptions: "Outage\nDegradation\nRestored",
  },
];

// The incident description, hidden: only templates write it.
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
    id: "monitors",
    source: FormFieldSource.TargetField,
    targetField: "monitors",
    label: "Affected Monitors",
    isRequired: false,
    allowedOptionIds: [MONITOR_API, MONITOR_WEB],
  },
  {
    id: "notificationType",
    source: FormFieldSource.TargetCustomField,
    customFieldId: CF_TYPE,
    label: "Notification Type",
    isRequired: false,
    isHidden: true,
  },
  {
    id: "office",
    source: FormFieldSource.Question,
    type: CustomFieldType.Dropdown,
    dropdownOptions: "Berlin\nLondon",
    label: "Office",
    isRequired: false,
  },
  {
    id: "confirmed",
    source: FormFieldSource.Question,
    type: CustomFieldType.Boolean,
    label: "I have checked the status page",
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

const OUTAGE: FormTemplate = {
  id: "outage",
  name: "Application Outage",
  answers: {
    title: "The application is down",
    description: "We are aware of an outage and are working on it.",
    severity: SEVERITY_HIGH,
    monitors: [MONITOR_API],
    notificationType: "Outage",
    office: "Berlin",
  },
};

const RESTORED: FormTemplate = {
  id: "restored",
  name: "Service Restored",
  isDefault: true,
  answers: {
    title: "Service restored",
    notificationType: "Restored",
  },
};

type BuildFunction = (data?: {
  fields?: Array<FormField>;
  templates?: unknown;
  customFields?: Array<FormCustomFieldDefinition>;
}) => BuiltPublicForm;

const build: BuildFunction = (data?: {
  fields?: Array<FormField>;
  templates?: unknown;
  customFields?: Array<FormCustomFieldDefinition>;
}): BuiltPublicForm => {
  return buildPublicForm({
    form: {
      name: "Department A",
      fields: data?.fields || FIELDS,
      targetType: FormTargetType.Incident,
      templates:
        data && "templates" in data ? data.templates : [OUTAGE, RESTORED],
    },
    customFields: data?.customFields || CUSTOM_FIELDS,
    recordOptions: RECORDS,
    isCaptchaRequired: false,
  });
};

function idsOf(fields: Array<PublicFormField>): Array<string> {
  return fields.map((field: PublicFormField): string => {
    return field.id;
  });
}

function fieldOf(built: BuiltPublicForm, id: string): PublicFormField {
  return built.allFields.find((field: PublicFormField): boolean => {
    return field.id === id;
  })!;
}

describe("hidden questions", () => {
  test("are built, but never told to the page", () => {
    const built: BuiltPublicForm = build();

    expect(idsOf(built.form.fields)).toEqual([
      "title",
      "severity",
      "monitors",
      "office",
      "confirmed",
      "email",
    ]);
    expect(idsOf(built.hiddenFields)).toEqual([
      "description",
      "notificationType",
    ]);
  });

  test("every question the form can answer is in allFields, in the form's order", () => {
    expect(idsOf(build().allFields)).toEqual(
      FIELDS.map((field: FormField): string => {
        return field.id;
      }),
    );
  });

  test("still say where their answer goes", () => {
    const built: BuiltPublicForm = build();

    expect(built.bindings["description"]).toMatchObject({
      source: FormFieldSource.TargetField,
      definition: { key: "description" },
    });
    expect(built.bindings["notificationType"]).toMatchObject({
      source: FormFieldSource.TargetCustomField,
      customFieldName: "Notification Type",
    });
  });

  test("nothing about one - its id, label or a template's answer to it - is in what the page is told", () => {
    const told: string = JSON.stringify(build().form);

    expect(told).not.toContain("description");
    expect(told).not.toContain("notificationType");
    expect(told).not.toContain("Notification Type");
    expect(told).not.toContain("We are aware of an outage");
    // A custom field's id is never told either.
    expect(told).not.toContain(CF_TYPE);
  });

  test("are never required, even when a stored row says so", () => {
    const built: BuiltPublicForm = build({
      fields: FIELDS.map((field: FormField): FormField => {
        return field.id === "description"
          ? { ...field, isRequired: true }
          : field;
      }),
    });

    expect(fieldOf(built, "description").isRequired).toBe(false);
  });

  test("are never answered by the request: an answer under a hidden question's id is not read", () => {
    const built: BuiltPublicForm = build();

    const result: FormSubmissionValidationResult = validateFormSubmission({
      fields: built.form.fields,
      data: {
        answers: {
          title: "Down",
          confirmed: true,
          email: "ada@example.com",
          description: "<!channel> injected",
          notificationType: "Outage",
        },
      },
    });

    expect(result.isValid).toBe(true);
    expect(result.isValid && Object.keys(result.answers).sort()).toEqual(
      ["confirmed", "email", "title"].sort(),
    );
  });

  test("one that cannot be answered is skipped like any other, and is not among the hidden ones", () => {
    const built: BuiltPublicForm = build({
      fields: [
        ...FIELDS,
        {
          id: "gone",
          source: FormFieldSource.TargetCustomField,
          customFieldId: CF_GONE,
          label: "Gone",
          isRequired: false,
          isHidden: true,
        },
      ],
    });

    expect(built.skipped).toContainEqual({
      fieldId: "gone",
      reason: FormSkippedFieldReason.CustomFieldDeleted,
    });
    expect(idsOf(built.hiddenFields)).not.toContain("gone");
    expect(idsOf(built.allFields)).not.toContain("gone");
  });

  test("a form with none has none", () => {
    const built: BuiltPublicForm = build({
      fields: FIELDS.map((field: FormField): FormField => {
        const shown: FormField = { ...field };
        delete shown.isHidden;
        return shown;
      }),
    });

    expect(built.hiddenFields).toEqual([]);
    expect(built.allFields).toEqual(built.form.fields);
  });
});

describe("templates on the page", () => {
  test("are listed in the form's order, with their names and the default", () => {
    const templates: Array<PublicFormTemplate> = build().form.templates!;

    expect(
      templates.map((template: PublicFormTemplate): unknown => {
        return [template.id, template.name, template.isDefault];
      }),
    ).toEqual([
      ["outage", "Application Outage", undefined],
      ["restored", "Service Restored", true],
    ]);
  });

  test("carry their answers to the questions the page asks, and only those", () => {
    expect(build().form.templates![0]!.answers).toEqual({
      title: "The application is down",
      severity: SEVERITY_HIGH,
      monitors: [MONITOR_API],
      office: "Berlin",
    });
  });

  test("a form with none tells the page none", () => {
    expect(build({ templates: [] }).form).not.toHaveProperty("templates");
    expect(build({ templates: null }).form).not.toHaveProperty("templates");
    expect(build({ templates: "junk" }).form).not.toHaveProperty("templates");
  });

  test("an answer its question would refuse is not offered", () => {
    const built: BuiltPublicForm = build({
      templates: [
        {
          id: "stale",
          name: "Stale",
          answers: {
            // A record the question does not offer, or no longer exists.
            monitors: [MONITOR_SECRET],
            severity: "0a0a0a0a-0000-4000-8000-0000000000ee",
            // An option since removed.
            office: "Paris",
            // Text longer than the question takes.
            title: "x".repeat(600),
            // A yes/no that is not one.
            confirmed: "maybe",
            // Not an address.
            email: "Ada <ada@example.com>",
            // A question the form does not have.
            removed: "Gone",
          },
        },
      ],
    });

    expect(built.form.templates).toEqual([
      { id: "stale", name: "Stale", answers: {} },
    ]);
  });

  test("an answer is offered cleaned, as a submission's would be stored", () => {
    const built: BuiltPublicForm = build({
      templates: [
        {
          id: "clean",
          name: "Clean",
          answers: {
            title: "  Down\nagain  ",
            email: "ADA@Example.COM",
            confirmed: "true",
            severity: SEVERITY_LOW.toUpperCase(),
          },
        },
      ],
    });

    expect(built.form.templates![0]!.answers).toEqual({
      title: "Down again",
      email: "ada@example.com",
      confirmed: true,
      severity: SEVERITY_LOW,
    });
  });

  test("a required question is not required of a template", () => {
    const built: BuiltPublicForm = build({
      templates: [
        {
          id: "partial",
          name: "Partial",
          // The checkbox is required of a submission: a template may leave it.
          answers: { confirmed: false, office: "London" },
        },
      ],
    });

    expect(built.form.templates![0]!.answers).toEqual({
      confirmed: false,
      office: "London",
    });
  });
});

describe("validateFormAnswer - one answer, checked as a submission's", () => {
  const built: BuiltPublicForm = build();

  test("hands back the value to store", () => {
    expect(
      validateFormAnswer({ field: fieldOf(built, "title"), answer: " Down " }),
    ).toEqual({ isValid: true, value: "Down" });
  });

  test("an empty answer to a question that is not required is nothing to store", () => {
    expect(
      validateFormAnswer({ field: fieldOf(built, "office"), answer: "" }),
    ).toEqual({ isValid: true, value: undefined });
  });

  test("says why an answer is refused", () => {
    const result: FormAnswerValidationResult = validateFormAnswer({
      field: fieldOf(built, "office"),
      answer: "Paris",
    });

    expect(result).toEqual({
      isValid: false,
      errors: ["Office must be one of the options the form lists."],
    });
  });

  test("holds a required question to Required, as a submission is", () => {
    expect(
      validateFormAnswer({ field: fieldOf(built, "title"), answer: "" }),
    ).toEqual({ isValid: false, errors: ["Title is required."] });
  });
});

describe("getFormTemplateAnswers", () => {
  const built: BuiltPublicForm = build();

  test("a template's valid answers to the questions listed", () => {
    expect(
      getFormTemplateAnswers({ template: OUTAGE, fields: built.hiddenFields }),
    ).toEqual({
      description: "We are aware of an outage and are working on it.",
      notificationType: "Outage",
    });
  });

  test.each([null, undefined])(
    "no template (%j) answers nothing",
    (value: null | undefined) => {
      expect(
        getFormTemplateAnswers({ template: value, fields: built.allFields }),
      ).toEqual({});
    },
  );

  test("answers that are not an object answer nothing", () => {
    expect(
      getFormTemplateAnswers({
        template: { answers: "down" as unknown as JSONObject },
        fields: built.allFields,
      }),
    ).toEqual({});
  });

  test("a key such as __proto__ never becomes the result's prototype", () => {
    const answers: JSONObject = JSON.parse(
      '{"__proto__": {"polluted": true}, "title": "Down"}',
    ) as JSONObject;

    const read: JSONObject = getFormTemplateAnswers({
      template: { answers },
      fields: built.allFields,
    });

    expect(read).toEqual({ title: "Down" });
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
  });

  test("an answer list sent where one answer is asked is refused, not read", () => {
    expect(
      getFormTemplateAnswers({
        template: { answers: { office: ["Berlin", "London"] } },
        fields: built.allFields,
      }),
    ).toEqual({});
  });
});

describe("validateFormTemplateAnswers - what the server checks when templates are written", () => {
  const built: BuiltPublicForm = build();

  test("accepts templates whose every answer suits its question, hidden ones too", () => {
    expect(
      validateFormTemplateAnswers({
        templates: [OUTAGE, RESTORED],
        fields: built.allFields,
      }),
    ).toBeNull();
  });

  test.each([undefined, null, [], "junk"])(
    "accepts no templates (%j)",
    (templates: unknown) => {
      expect(
        validateFormTemplateAnswers({ templates, fields: built.allFields }),
      ).toBeNull();
    },
  );

  test("refuses an answer to a question the form does not ask, naming it", () => {
    expect(
      validateFormTemplateAnswers({
        templates: [{ id: "a", name: "Outage", answers: { removed: "x" } }],
        fields: built.allFields,
      }),
    ).toBe(
      'Template 1 ("Outage") answers a question the form does not ask (removed).',
    );
  });

  test("refuses an answer its question would refuse, in the submission's words", () => {
    expect(
      validateFormTemplateAnswers({
        templates: [
          OUTAGE,
          { id: "b", name: "Maintenance", answers: { office: "Paris" } },
        ],
        fields: built.allFields,
      }),
    ).toBe(
      'Template 2 ("Maintenance"): Office must be one of the options the form lists.',
    );
  });

  test("checks a hidden question's answer as well: it is written to the record", () => {
    expect(
      validateFormTemplateAnswers({
        templates: [
          { id: "a", name: "Outage", answers: { notificationType: "Panic" } },
        ],
        fields: built.allFields,
      }),
    ).toBe(
      'Template 1 ("Outage"): Notification Type must be one of the options the form lists.',
    );
  });

  test("refuses a record the form does not offer: a template cannot name another one", () => {
    expect(
      validateFormTemplateAnswers({
        templates: [
          { id: "a", name: "Outage", answers: { monitors: [MONITOR_SECRET] } },
        ],
        fields: built.allFields,
      }),
    ).toBe(
      'Template 1 ("Outage"): Affected Monitors must be chosen from the options the form lists.',
    );
  });

  test("refuses text longer than its question takes", () => {
    expect(
      validateFormTemplateAnswers({
        templates: [
          {
            id: "a",
            name: "Outage",
            answers: { office: "Berlin", email: "x".repeat(200) },
          },
        ],
        fields: built.allFields,
      }),
    ).toContain('Template 1 ("Outage"): Your Email cannot be more than');
  });

  test("never requires an answer of a template", () => {
    expect(
      validateFormTemplateAnswers({
        templates: [{ id: "a", name: "Empty", answers: {} }],
        fields: built.allFields,
      }),
    ).toBeNull();
  });

  test("names every problem, the first eight of them", () => {
    const templates: Array<FormTemplate> = Array.from(
      { length: 10 },
      (_value: unknown, index: number): FormTemplate => {
        return {
          id: `t${index}`,
          name: `T${index}`,
          answers: { office: "Paris" },
        };
      },
    );

    const problem: string | null = validateFormTemplateAnswers({
      templates,
      fields: built.allFields,
    });

    expect(problem).toContain('Template 8 ("T7")');
    expect(problem).not.toContain('Template 9 ("T8")');
    expect(problem).toContain("And 2 more problems.");
  });

  test("a long text answer of a question of the form's own is held to its limit", () => {
    const fields: Array<FormField> = [
      {
        id: "notes",
        source: FormFieldSource.Question,
        type: CustomFieldType.LongText,
        label: "Notes",
        isRequired: false,
      },
    ];

    const notes: BuiltPublicForm = build({ fields, templates: [] });

    expect(
      validateFormTemplateAnswers({
        templates: [
          {
            id: "a",
            name: "A",
            answers: { notes: "x".repeat(FORM_TEXT_ANSWER_MAX_LENGTH + 1) },
          },
        ],
        fields: notes.allFields,
      }),
    ).toBe(
      `Template 1 ("A"): Notes cannot be more than ${FORM_TEXT_ANSWER_MAX_LENGTH} characters.`,
    );
  });
});

describe("the template a submission started from", () => {
  test("readFormSubmissionTemplateId reads data.templateId when it is a template's id", () => {
    expect(readFormSubmissionTemplateId({ templateId: "outage" })).toBe(
      "outage",
    );
    expect(
      readFormSubmissionTemplateId({ answers: {}, templateId: "outage" }),
    ).toBe("outage");
  });

  test.each([
    ["no data", undefined],
    ["data that is not an object", "outage"],
    ["a list", ["outage"]],
    ["no templateId", { answers: {} }],
    ["a templateId that is not text", { templateId: 7 }],
    ["a templateId that is not an id", { templateId: "../outage" }],
    ["an empty templateId", { templateId: "" }],
  ])("is none for %s", (_label: string, data: unknown) => {
    expect(readFormSubmissionTemplateId(data)).toBeUndefined();
  });

  test("getFormSubmissionTemplate finds the template it names", () => {
    expect(
      getFormSubmissionTemplate({
        templates: [OUTAGE, RESTORED],
        templateId: "outage",
      }),
    ).toEqual(OUTAGE);
  });

  test("a template deleted since the page was opened is none: the submission stands as answered", () => {
    expect(
      getFormSubmissionTemplate({
        templates: [OUTAGE, RESTORED],
        templateId: "deleted",
      }),
    ).toBeUndefined();
  });

  test("a submission that names none started from none, even on a form with a default", () => {
    expect(
      getFormSubmissionTemplate({
        templates: [OUTAGE, RESTORED],
        templateId: undefined,
      }),
    ).toBeUndefined();
  });

  test("templates that cannot be read are none", () => {
    expect(
      getFormSubmissionTemplate({ templates: "junk", templateId: "outage" }),
    ).toBeUndefined();
  });
});

describe("the template the page opens with", () => {
  const form: PublicForm = build().form;

  test("the one its link names", () => {
    expect(
      getPublicFormStartTemplate({ form, requestedTemplateId: "outage" })?.id,
    ).toBe("outage");
  });

  test("otherwise the form's default", () => {
    expect(getPublicFormStartTemplate({ form })?.id).toBe("restored");
    expect(
      getPublicFormStartTemplate({ form, requestedTemplateId: "deleted" })?.id,
    ).toBe("restored");
  });

  test("otherwise none", () => {
    const noDefault: PublicForm = build({ templates: [OUTAGE] }).form;

    expect(getPublicFormStartTemplate({ form: noDefault })).toBeUndefined();
    expect(
      getPublicFormStartTemplate({ form: build({ templates: [] }).form }),
    ).toBeUndefined();
  });

  test("findPublicFormTemplate finds one by id, and nothing for none", () => {
    expect(findPublicFormTemplate(form, "restored")?.name).toBe(
      "Service Restored",
    );
    expect(findPublicFormTemplate(form, null)).toBeUndefined();
    expect(findPublicFormTemplate(form, "deleted")).toBeUndefined();
  });

  test("the types the page answers with are unchanged by templates", () => {
    expect(fieldOf(build(), "monitors").type).toBe(
      PublicFormFieldType.MultiSelectDropdown,
    );
  });
});
