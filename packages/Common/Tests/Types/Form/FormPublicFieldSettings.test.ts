import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FormField,
  FormFieldSource,
  FormSubmitterField,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import {
  BuiltPublicForm,
  buildPublicForm,
  FormCustomFieldDefinition,
  FormQuestionsForTemplate,
  FormRecordOption,
  FormSubmissionValidationResult,
  getFormQuestionsForTemplate,
  getPublicFormForTemplate,
  PublicForm,
  PublicFormField,
  PublicFormTemplate,
  validateFormSubmission,
  validateFormTemplateAnswers,
} from "../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import {
  FormTemplate,
  FormTemplateFieldSetting,
} from "../../../Types/Form/FormTemplate";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A template that asks the form's questions its own way (issue #4563), on
 * the public side: what the page is told, the form as one template asks it
 * - which the page draws, the dashboard previews and the server holds a
 * submission to - and what the server checks when templates are written.
 *
 * The form is the one the issue describes: a department's incident form
 * whose Application Outage template requires the application and the
 * facilities and hides the maintenance date, and whose Planned Maintenance
 * template requires the date. The date is hidden on the form itself, so
 * only a template that asks it shows it.
 */

const SEVERITY_HIGH: string = "0a0a0a0a-0000-4000-8000-000000000001";
const CF_TICKET: string = "0e0e0e0e-0000-4000-8000-000000000001";
const CF_GONE: string = "0e0e0e0e-0000-4000-8000-0000000000ff";

const Required: FormTemplateFieldSetting = FormTemplateFieldSetting.Required;
const Optional: FormTemplateFieldSetting = FormTemplateFieldSetting.Optional;
const Hidden: FormTemplateFieldSetting = FormTemplateFieldSetting.Hidden;

const RECORDS: Partial<
  Record<FormTargetOptionsSource, Array<FormRecordOption>>
> = {
  [FormTargetOptionsSource.IncidentSeverity]: [
    { id: SEVERITY_HIGH, name: "High" },
  ],
};

const CUSTOM_FIELDS: Array<FormCustomFieldDefinition> = [
  {
    id: CF_TICKET,
    name: "Ticket",
    customFieldType: CustomFieldType.Text,
  },
];

const FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "Title",
    isRequired: true,
  },
  {
    id: "app",
    source: FormFieldSource.Question,
    type: CustomFieldType.Text,
    label: "Application Name",
    isRequired: false,
  },
  {
    id: "facilities",
    source: FormFieldSource.Question,
    type: CustomFieldType.MultiSelectDropdown,
    dropdownOptions: "Headquarters\nWarehouse",
    label: "Affected Facilities",
    isRequired: true,
  },
  {
    id: "window",
    source: FormFieldSource.Question,
    type: CustomFieldType.Text,
    label: "Scheduled Maintenance Date",
    isRequired: false,
    isHidden: true,
  },
  {
    id: "notes",
    source: FormFieldSource.Question,
    type: CustomFieldType.LongText,
    label: "Internal Notes",
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
    id: "ticket",
    source: FormFieldSource.TargetCustomField,
    customFieldId: CF_TICKET,
    label: "Ticket",
    isRequired: false,
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
    app: "Checkout",
    window: "Tonight 22:00",
    notes: "Escalate to the platform team.",
    severity: SEVERITY_HIGH,
  },
  fieldSettings: {
    app: Required,
    facilities: Required,
    window: Hidden,
  },
};

const MAINTENANCE: FormTemplate = {
  id: "maintenance",
  name: "Planned Maintenance",
  isDefault: true,
  answers: {
    title: "Planned maintenance",
    window: "Saturday 02:00",
    email: "ops@example.com",
  },
  fieldSettings: {
    app: Required,
    facilities: Optional,
    window: Required,
    email: Hidden,
  },
};

const RESTORED: FormTemplate = {
  id: "restored",
  name: "Service Restored",
  answers: { title: "Service restored", notes: "Close the bridge." },
};

type BuildFunction = (data?: {
  fields?: Array<FormField>;
  templates?: unknown;
  targetType?: FormTargetType;
}) => BuiltPublicForm;

const build: BuildFunction = (data?: {
  fields?: Array<FormField>;
  templates?: unknown;
  targetType?: FormTargetType;
}): BuiltPublicForm => {
  return buildPublicForm({
    form: {
      name: "Department A",
      fields: data?.fields || FIELDS,
      targetType: data?.targetType || FormTargetType.Incident,
      templates:
        data && "templates" in data
          ? data.templates
          : [OUTAGE, MAINTENANCE, RESTORED],
    },
    customFields: CUSTOM_FIELDS,
    recordOptions: RECORDS,
    isCaptchaRequired: false,
  });
};

function idsOf(fields: Array<PublicFormField>): Array<string> {
  return fields.map((field: PublicFormField): string => {
    return field.id;
  });
}

function requiredOf(fields: Array<PublicFormField>): Record<string, boolean> {
  const required: Record<string, boolean> = {};

  for (const field of fields) {
    required[field.id] = field.isRequired;
  }

  return required;
}

function templateOf(form: PublicForm, id: string): PublicFormTemplate {
  return form.templates!.find((template: PublicFormTemplate): boolean => {
    return template.id === id;
  })!;
}

describe("what the page is told", () => {
  test("every question the form asks, and every one it hides that a template asks - in the form's order", () => {
    // The date is hidden on the form, and asked by Planned Maintenance.
    expect(idsOf(build().form.fields)).toEqual([
      "title",
      "app",
      "facilities",
      "window",
      "severity",
      "ticket",
      "email",
    ]);
  });

  test("a question the form hides is marked hidden, and the form alone never requires it", () => {
    const window: PublicFormField = build().form.fields.find(
      (field: PublicFormField): boolean => {
        return field.id === "window";
      },
    )!;

    expect(window.isHidden).toBe(true);
    expect(window.isRequired).toBe(false);
  });

  test("a question the form hides and no template asks is never told: nor its label, nor any template's answer to it", () => {
    const told: string = JSON.stringify(build().form);

    expect(told).not.toContain('"notes"');
    expect(told).not.toContain("Internal Notes");
    expect(told).not.toContain("Escalate to the platform team.");
    expect(told).not.toContain("Close the bridge.");
  });

  test("a form whose templates ask nothing of a hidden question tells the page what it always did", () => {
    const built: BuiltPublicForm = build({
      templates: [RESTORED, { ...OUTAGE, fieldSettings: undefined }],
    });

    expect(idsOf(built.form.fields)).toEqual([
      "title",
      "app",
      "facilities",
      "severity",
      "ticket",
      "email",
    ]);
    expect(built.form.fields.some((field: PublicFormField): boolean => {
      return field.isHidden === true;
    })).toBe(false);
  });

  test("each template is told with how it asks the page's questions", () => {
    const form: PublicForm = build().form;

    expect(templateOf(form, "outage").fieldSettings).toEqual({
      app: Required,
      facilities: Required,
      window: Hidden,
    });
    expect(templateOf(form, "maintenance").fieldSettings).toEqual({
      app: Required,
      facilities: Optional,
      window: Required,
      email: Hidden,
    });
    // A template that sets nothing says nothing.
    expect(templateOf(form, "restored")).not.toHaveProperty("fieldSettings");
  });

  test("a setting is told only for a question on the page: not one the form cannot ask, nor one hidden that nobody asks", () => {
    const form: PublicForm = build({
      fields: [
        ...FIELDS,
        {
          id: "gone",
          source: FormFieldSource.TargetCustomField,
          customFieldId: CF_GONE,
          label: "Gone",
          isRequired: false,
        },
      ],
      templates: [
        {
          id: "a",
          name: "A",
          answers: {},
          fieldSettings: {
            gone: "Required",
            removed: "Required",
            notes: "Hidden",
            app: "Optional",
          },
        },
      ],
    }).form;

    expect(templateOf(form, "a").fieldSettings).toEqual({ app: Optional });
  });

  test("a template's answers are told for the questions it asks, and no other", () => {
    const form: PublicForm = build().form;

    // Outage hides the date: its answer to it never leaves the server.
    expect(templateOf(form, "outage").answers).toEqual({
      title: "The application is down",
      app: "Checkout",
      severity: SEVERITY_HIGH,
    });

    // Maintenance asks the date, so its answer fills it in; it hides the email.
    expect(templateOf(form, "maintenance").answers).toEqual({
      title: "Planned maintenance",
      window: "Saturday 02:00",
    });

    // Restored asks as the form does: the date stays hidden, unanswered on the page.
    expect(templateOf(form, "restored").answers).toEqual({
      title: "Service restored",
    });
  });

  test("the questions the target cannot do without are listed for the server, never told to the page", () => {
    const fields: Array<FormField> = getDefaultFormFields(
      FormTargetType.ScheduledMaintenance,
    );

    const built: BuiltPublicForm = build({
      fields,
      targetType: FormTargetType.ScheduledMaintenance,
      templates: [],
    });

    // A maintenance event's start and end.
    expect(built.lockedFieldIds).toEqual(
      fields
        .filter((field: FormField): boolean => {
          return (
            field.targetField === "startsAt" || field.targetField === "endsAt"
          );
        })
        .map((field: FormField): string => {
          return field.id;
        }),
    );
    expect(built.lockedFieldIds).toHaveLength(2);

    // An incident has none.
    expect(build().lockedFieldIds).toEqual([]);
    expect(JSON.stringify(built.form)).not.toContain("locked");
  });

  test("a template's setting for a question the target cannot do without is not told: it is always asked, required", () => {
    const fields: Array<FormField> = [
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
    ];

    const built: BuiltPublicForm = build({
      fields,
      targetType: FormTargetType.ScheduledMaintenance,
      templates: [
        {
          id: "a",
          name: "A",
          answers: {},
          fieldSettings: { starts: "Hidden", ends: "Optional", title: "Hidden" },
        },
      ],
    });

    expect(built.lockedFieldIds).toEqual(["starts", "ends"]);
    expect(templateOf(built.form, "a").fieldSettings).toEqual({
      title: Hidden,
    });
    expect(
      requiredOf(
        getPublicFormForTemplate({
          form: built.form,
          template: templateOf(built.form, "a"),
        }).fields,
      ),
    ).toEqual({ starts: true, ends: true });
  });
});

describe("getPublicFormForTemplate - the form as one template asks it", () => {
  const form: PublicForm = build().form;

  test("with no template, the form's own questions as the form asks them", () => {
    const asked: Array<PublicFormField> = getPublicFormForTemplate({
      form,
    }).fields;

    expect(requiredOf(asked)).toEqual({
      title: true,
      app: false,
      facilities: true,
      severity: false,
      ticket: false,
      email: true,
    });
  });

  test("Application Outage requires the application and the facilities, and hides the date", () => {
    expect(
      requiredOf(
        getPublicFormForTemplate({
          form,
          template: templateOf(form, "outage"),
        }).fields,
      ),
    ).toEqual({
      title: true,
      app: true,
      facilities: true,
      severity: false,
      ticket: false,
      email: true,
    });
  });

  test("Planned Maintenance asks the date the form hides, requires it, lets the facilities be left, and hides the email", () => {
    const asked: Array<PublicFormField> = getPublicFormForTemplate({
      form,
      template: templateOf(form, "maintenance"),
    }).fields;

    expect(idsOf(asked)).toEqual([
      "title",
      "app",
      "facilities",
      "window",
      "severity",
      "ticket",
    ]);
    expect(requiredOf(asked)).toEqual({
      title: true,
      app: true,
      facilities: false,
      window: true,
      severity: false,
      ticket: false,
    });
  });

  test("a template that sets nothing asks the form as the form does", () => {
    expect(
      getPublicFormForTemplate({ form, template: templateOf(form, "restored") }),
    ).toEqual(getPublicFormForTemplate({ form }));
  });

  test("a question it asks is told to the page as any other: no hidden mark left on it", () => {
    const window: PublicFormField = getPublicFormForTemplate({
      form,
      template: templateOf(form, "maintenance"),
    }).fields.find((field: PublicFormField): boolean => {
      return field.id === "window";
    })!;

    expect(window).toEqual({
      id: "window",
      label: "Scheduled Maintenance Date",
      type: "Text",
      isRequired: true,
      maxLength: 10000,
    });
  });

  test("everything else about the form is as it was", () => {
    const asked: PublicForm = getPublicFormForTemplate({
      form,
      template: templateOf(form, "outage"),
    });

    expect(asked.name).toBe(form.name);
    expect(asked.templates).toBe(form.templates);
    expect(asked.isCaptchaRequired).toBe(form.isCaptchaRequired);
  });

  test("a setting for a question it does not have, or that is not one, changes nothing", () => {
    expect(
      getPublicFormForTemplate({
        form,
        template: {
          fieldSettings: {
            removed: "Required",
            title: "Sometimes",
          } as never,
        },
      }),
    ).toEqual(getPublicFormForTemplate({ form }));
  });

  test("never changes the form it was handed", () => {
    const before: string = JSON.stringify(form);

    getPublicFormForTemplate({ form, template: templateOf(form, "outage") });
    getPublicFormForTemplate({
      form,
      template: templateOf(form, "maintenance"),
    });

    expect(JSON.stringify(form)).toBe(before);
  });

  test("asking an asked form again changes nothing", () => {
    const template: PublicFormTemplate = templateOf(form, "maintenance");
    const once: PublicForm = getPublicFormForTemplate({ form, template });

    expect(getPublicFormForTemplate({ form: once, template })).toEqual(once);
  });

  test("a form with no questions asks none", () => {
    expect(
      getPublicFormForTemplate({
        form: { name: "Empty", fields: [], isCaptchaRequired: false },
        template: templateOf(form, "outage"),
      }).fields,
    ).toEqual([]);
  });
});

describe("getFormQuestionsForTemplate - what the server reads from the request, and what from the template", () => {
  const built: BuiltPublicForm = build();

  function split(templateId: string | undefined): {
    asked: Array<string>;
    answeredByTemplate: Array<string>;
  } {
    const questions: FormQuestionsForTemplate = getFormQuestionsForTemplate({
      built,
      templateId,
    });

    return {
      asked: idsOf(questions.asked),
      answeredByTemplate: idsOf(questions.answeredByTemplate),
    };
  }

  test("with no template: the form's hidden questions are the template's to answer - there is none", () => {
    expect(split(undefined)).toEqual({
      asked: ["title", "app", "facilities", "severity", "ticket", "email"],
      answeredByTemplate: ["window", "notes"],
    });
  });

  test("a template that hides a question takes it from the request", () => {
    expect(split("outage")).toEqual({
      asked: ["title", "app", "facilities", "severity", "ticket", "email"],
      answeredByTemplate: ["window", "notes"],
    });
  });

  test("a template that asks a hidden question hands it to the request", () => {
    expect(split("maintenance")).toEqual({
      asked: ["title", "app", "facilities", "window", "severity", "ticket"],
      answeredByTemplate: ["notes", "email"],
    });
  });

  test("a template the form does not have is no template", () => {
    expect(split("deleted")).toEqual(split(undefined));
  });

  test("every question is in exactly one of the two", () => {
    for (const templateId of [undefined, "outage", "maintenance", "restored"]) {
      const questions: FormQuestionsForTemplate = getFormQuestionsForTemplate({
        built,
        templateId,
      });

      expect(
        [...idsOf(questions.asked), ...idsOf(questions.answeredByTemplate)].sort(),
      ).toEqual(idsOf(built.allFields).sort());
    }
  });

  test("the asked questions carry the template's Required", () => {
    expect(
      requiredOf(
        getFormQuestionsForTemplate({ built, templateId: "maintenance" }).asked,
      ),
    ).toEqual({
      title: true,
      app: true,
      facilities: false,
      window: true,
      severity: false,
      ticket: false,
    });
  });
});

describe("a submission is held to the questions its template asks", () => {
  const built: BuiltPublicForm = build();

  function check(
    templateId: string | undefined,
    answers: JSONObject,
  ): FormSubmissionValidationResult {
    return validateFormSubmission({
      fields: getFormQuestionsForTemplate({ built, templateId }).asked,
      data: { answers },
    });
  }

  test("a question the template makes required must be answered", () => {
    const result: FormSubmissionValidationResult = check("outage", {
      title: "Down",
      facilities: ["Headquarters"],
      email: "ada@example.com",
    });

    expect(result).toEqual({
      isValid: false,
      errors: ["Application Name is required."],
    });
  });

  test("the same answers pass without the template: the form leaves it optional", () => {
    expect(
      check(undefined, {
        title: "Down",
        facilities: ["Headquarters"],
        email: "ada@example.com",
      }).isValid,
    ).toBe(true);
  });

  test("a question the template makes optional may be left empty, though the form requires it", () => {
    expect(
      check("maintenance", {
        title: "Patch",
        app: "Checkout",
        window: "Saturday",
      }),
    ).toEqual({
      isValid: true,
      answers: { title: "Patch", app: "Checkout", window: "Saturday" },
    });
  });

  test("a hidden question the template asks, and requires, must be answered", () => {
    expect(
      check("maintenance", { title: "Patch", app: "Checkout" }),
    ).toEqual({
      isValid: false,
      errors: ["Scheduled Maintenance Date is required."],
    });
  });

  test("a question the template hides is never read from the request - even a required one", () => {
    expect(
      check("maintenance", {
        title: "Patch",
        app: "Checkout",
        window: "Saturday",
        email: "not an address at all",
      }),
    ).toEqual({
      isValid: true,
      answers: { title: "Patch", app: "Checkout", window: "Saturday" },
    });
  });

  test("a question the form hides is not read without a template that asks it", () => {
    const result: FormSubmissionValidationResult = check("outage", {
      title: "Down",
      app: "Checkout",
      facilities: ["Headquarters"],
      email: "ada@example.com",
      window: "<!channel> injected",
      notes: "injected",
    });

    expect(result.isValid && Object.keys(result.answers).sort()).toEqual(
      ["app", "email", "facilities", "title"].sort(),
    );
  });
});

describe("validateFormTemplateAnswers - the settings the server lets a template keep", () => {
  const built: BuiltPublicForm = build();

  function check(
    templates: unknown,
    extra: {
      heldTemplates?: unknown;
      targetType?: FormTargetType;
    } = {},
  ): string | null {
    return validateFormTemplateAnswers({
      templates,
      fields: built.allFields,
      lockedFieldIds: built.lockedFieldIds,
      targetType: extra.targetType || FormTargetType.Incident,
      heldTemplates: extra.heldTemplates,
    });
  }

  test("accepts a setting for any question the form can answer, hidden ones too", () => {
    expect(check([OUTAGE, MAINTENANCE, RESTORED])).toBeNull();
    expect(
      check([
        {
          id: "a",
          name: "A",
          answers: {},
          fieldSettings: { notes: "Required", ticket: "Hidden" },
        },
      ]),
    ).toBeNull();
  });

  test("refuses a setting for a question the form does not ask, naming it", () => {
    expect(
      check([
        {
          id: "a",
          name: "A",
          answers: {},
          fieldSettings: { removed: "Hidden" },
        },
      ]),
    ).toBe(
      'Template 1 ("A") has a setting for a question the form does not ask (removed).',
    );
  });

  test("refuses a setting for a question the form cannot ask now: its custom field was deleted", () => {
    const withGone: BuiltPublicForm = build({
      fields: [
        ...FIELDS,
        {
          id: "gone",
          source: FormFieldSource.TargetCustomField,
          customFieldId: CF_GONE,
          label: "Gone",
          isRequired: false,
        },
      ],
    });

    expect(
      validateFormTemplateAnswers({
        templates: [
          { id: "a", name: "A", answers: {}, fieldSettings: { gone: "Hidden" } },
        ],
        fields: withGone.allFields,
      }),
    ).toBe(
      'Template 1 ("A") has a setting for a question the form does not ask (gone).',
    );
  });

  describe("a question the target cannot be created without", () => {
    const fields: Array<FormField> = getDefaultFormFields(
      FormTargetType.ScheduledMaintenance,
    ).map((field: FormField, index: number): FormField => {
      return {
        ...field,
        id: ["title", "description", "starts", "ends", "name", "email"][
          index
        ]!,
      };
    });

    const maintenance: BuiltPublicForm = build({
      fields,
      targetType: FormTargetType.ScheduledMaintenance,
      templates: [],
    });

    function checkMaintenance(
      setting: string,
      targetType?: FormTargetType,
    ): string | null {
      return validateFormTemplateAnswers({
        templates: [
          {
            id: "a",
            name: "Night Work",
            answers: {},
            fieldSettings: { starts: setting },
          },
        ],
        fields: maintenance.allFields,
        lockedFieldIds: maintenance.lockedFieldIds,
        targetType,
      });
    }

    test("cannot be hidden", () => {
      expect(
        checkMaintenance("Hidden", FormTargetType.ScheduledMaintenance),
      ).toBe(
        'Template 1 ("Night Work"): Starts At cannot be hidden: a scheduled maintenance event cannot be created without it.',
      );
    });

    test("cannot be optional", () => {
      expect(
        checkMaintenance("Optional", FormTargetType.ScheduledMaintenance),
      ).toBe(
        'Template 1 ("Night Work"): Starts At cannot be optional: a scheduled maintenance event cannot be created without it.',
      );
    });

    test("may be required, as it always is", () => {
      expect(
        checkMaintenance("Required", FormTargetType.ScheduledMaintenance),
      ).toBeNull();
    });

    test("names what the form creates in general, when it is not said", () => {
      expect(checkMaintenance("Hidden")).toBe(
        'Template 1 ("Night Work"): Starts At cannot be hidden: the record the form creates cannot be created without it.',
      );
    });

    test("every other question of the form may be hidden", () => {
      expect(
        validateFormTemplateAnswers({
          templates: [
            {
              id: "a",
              name: "Night Work",
              answers: {},
              fieldSettings: {
                title: "Hidden",
                description: "Required",
                name: "Hidden",
                email: "Optional",
              },
            },
          ],
          fields: maintenance.allFields,
          lockedFieldIds: maintenance.lockedFieldIds,
          targetType: FormTargetType.ScheduledMaintenance,
        }),
      ).toBeNull();
    });
  });

  describe("what a template already held is not judged again", () => {
    const STALE: JSONObject = {
      id: "stale",
      name: "Stale",
      answers: { removed: "x", facilities: ["Paris"] },
      fieldSettings: { removed: "Hidden" },
    };

    test("a list saved again with a template that went stale is accepted", () => {
      expect(
        check([STALE, OUTAGE], { heldTemplates: [STALE, OUTAGE] }),
      ).toBeNull();
    });

    test("the same stale values are refused in a template that did not hold them", () => {
      expect(
        check([{ ...STALE, id: "copy", name: "Copy" }], {
          heldTemplates: [STALE],
        }),
      ).toBe(
        'Template 1 ("Copy") answers a question the form does not ask (removed). Template 1 ("Copy"): Affected Facilities must be chosen from the options the form lists. Template 1 ("Copy") has a setting for a question the form does not ask (removed).',
      );
    });

    test("an answer or a setting changed since is judged whole", () => {
      expect(
        check(
          [
            {
              ...STALE,
              answers: { removed: "y", facilities: ["Paris"] },
              fieldSettings: { removed: "Required" },
            },
          ],
          { heldTemplates: [STALE] },
        ),
      ).toBe(
        'Template 1 ("Stale") answers a question the form does not ask (removed). Template 1 ("Stale") has a setting for a question the form does not ask (removed).',
      );
    });

    test("held values are compared whole: a list answer with another entry is new", () => {
      expect(
        check(
          [
            {
              ...STALE,
              answers: { facilities: ["Paris", "Headquarters"] },
              fieldSettings: undefined,
            },
          ],
          { heldTemplates: [STALE] },
        ),
      ).toBe(
        'Template 1 ("Stale"): Affected Facilities must be chosen from the options the form lists.',
      );
    });

    test("nothing held, nothing skipped: a create judges every template whole", () => {
      expect(check([STALE])).not.toBeNull();
      expect(check([STALE], { heldTemplates: null })).not.toBeNull();
      expect(check([STALE], { heldTemplates: "junk" })).not.toBeNull();
    });
  });
});
