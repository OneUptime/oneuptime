import Color from "../../../Types/Color";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FORM_TEXT_ANSWER_MAX_LENGTH,
  FormField,
  FormFieldSource,
  FormSubmitterField,
  createSubmitterField,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import {
  BuiltPublicForm,
  FORM_MULTI_SELECT_MAX_CHOICES,
  FORM_PAGE_HEADER,
  FORM_PAGE_HEADER_VALUE,
  FormCustomFieldDefinition,
  FormRecordOption,
  FormSkippedFieldReason,
  FormSubmissionValidationResult,
  PUBLIC_FORM_MULTI_LINE_FIELD_TYPES,
  PUBLIC_FORM_TEXT_FIELD_TYPES,
  PublicFormField,
  PublicFormFieldType,
  buildPublicForm,
  cleanMultiLineAnswer,
  cleanScalarAnswer,
  cleanSingleLineAnswer,
  formatFormSubmissionErrors,
  isBlankFormAnswer,
  isWholeEmailAddress,
  validateFormSubmission,
} from "../../../Types/Form/FormPublic";
import {
  FORM_DESCRIPTION_MAX_LENGTH,
  FORM_INCIDENT_TITLE_MAX_LENGTH,
  FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
  FormTargetOptionsSource,
} from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The public half of a form: what a stranger's browser is told about it
 * (buildPublicForm), and what a stranger's submission is held to before
 * anything is created from it (validateFormSubmission).
 *
 * Both are boundaries the server relies on. What matters most is what can
 * NOT get through: the form's target, settings, link key or project; a
 * custom field's id; a record the form does not offer; an answer to a
 * question the form does not ask; text longer than its column; and any
 * request - however large or deeply nested - turning a refusal into a
 * thrown error.
 */

const SEVERITY_HIGH: string = "0a0a0a0a-0000-4000-8000-000000000001";
const SEVERITY_LOW: string = "0a0a0a0a-0000-4000-8000-000000000002";
const MONITOR_API: string = "0b0b0b0b-0000-4000-8000-000000000001";
const MONITOR_WEB: string = "0b0b0b0b-0000-4000-8000-000000000002";
const MONITOR_DB: string = "0b0b0b0b-0000-4000-8000-000000000003";
const LABEL_EU: string = "0c0c0c0c-0000-4000-8000-000000000001";
const PAGE_MAIN: string = "0d0d0d0d-0000-4000-8000-000000000001";
const CF_REGION: string = "0e0e0e0e-0000-4000-8000-000000000001";
const CF_IMPACT: string = "0e0e0e0e-0000-4000-8000-000000000002";
const CF_UNTYPED: string = "0e0e0e0e-0000-4000-8000-000000000003";

const RECORDS: Partial<Record<FormTargetOptionsSource, Array<FormRecordOption>>> =
  {
    [FormTargetOptionsSource.IncidentSeverity]: [
      { id: SEVERITY_HIGH, name: "High", color: "#ff0000" },
      { id: SEVERITY_LOW, name: "Low" },
    ],
    [FormTargetOptionsSource.Monitor]: [
      { id: MONITOR_API, name: "API" },
      { id: MONITOR_WEB, name: "Website" },
      { id: MONITOR_DB, name: "Database" },
    ],
    [FormTargetOptionsSource.Label]: [
      { id: LABEL_EU, name: "eu", color: new Color("#00ff00") as never },
    ],
    [FormTargetOptionsSource.StatusPage]: [{ id: PAGE_MAIN, name: "Main" }],
  };

const CUSTOM_FIELDS: Array<FormCustomFieldDefinition> = [
  {
    id: CF_REGION,
    name: "Region",
    description: "Where the problem is",
    customFieldType: CustomFieldType.Dropdown,
    dropdownOptions: "EU\nUS\nAPAC",
  },
  {
    id: CF_IMPACT,
    name: "Impact",
    customFieldType: CustomFieldType.Number,
  },
  {
    id: CF_UNTYPED,
    name: "Legacy",
    customFieldType: null,
  },
];

// A form that asks something of every kind.
const FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "What is wrong?",
    helpText: "  One line.  ",
    isRequired: true,
  },
  {
    id: "description",
    source: FormFieldSource.TargetField,
    targetField: "description",
    label: "Description",
    isRequired: false,
  },
  {
    id: "severity",
    source: FormFieldSource.TargetField,
    targetField: "incidentSeverityId",
    label: "How bad is it?",
    isRequired: false,
  },
  {
    id: "monitors",
    source: FormFieldSource.TargetField,
    targetField: "monitors",
    label: "Affected Monitors",
    isRequired: false,
    // In the opposite order to the project's: the project's order wins.
    allowedOptionIds: [MONITOR_WEB, MONITOR_API],
  },
  {
    id: "region",
    source: FormFieldSource.TargetCustomField,
    customFieldId: CF_REGION,
    label: "Region",
    isRequired: true,
  },
  {
    id: "impact",
    source: FormFieldSource.TargetCustomField,
    customFieldId: CF_IMPACT,
    label: "Impact",
    isRequired: false,
  },
  {
    id: "office",
    source: FormFieldSource.Question,
    type: CustomFieldType.Dropdown,
    dropdownOptions: "Berlin\nLondon\nBerlin",
    label: "Which office?",
    isRequired: false,
  },
  {
    id: "checked",
    source: FormFieldSource.Question,
    type: CustomFieldType.Boolean,
    label: "I have checked the status page",
    isRequired: true,
  },
  createSubmitterField({
    submitterField: FormSubmitterField.Name,
    isRequired: false,
    id: "name",
  }),
  createSubmitterField({
    submitterField: FormSubmitterField.Email,
    isRequired: true,
    id: "email",
  }),
];

type BuildFunction = (
  overrides?: Partial<{
    fields: unknown;
    targetType: FormTargetType;
    customFields: Array<FormCustomFieldDefinition>;
    recordOptions: Partial<
      Record<FormTargetOptionsSource, Array<FormRecordOption>>
    >;
    defaultOptionValues: Partial<Record<string, string>>;
    isCaptchaRequired: boolean;
    name: unknown;
    description: unknown;
  }>,
) => BuiltPublicForm;

const build: BuildFunction = (overrides = {}): BuiltPublicForm => {
  return buildPublicForm({
    form: {
      name: ("name" in overrides ? overrides.name : "Report a Problem") as
        | string
        | undefined,
      description: ("description" in overrides
        ? overrides.description
        : "Tell us **what** is broken.") as string | undefined,
      fields: "fields" in overrides ? overrides.fields : FIELDS,
      targetType: overrides.targetType || FormTargetType.Incident,
    },
    customFields: overrides.customFields || CUSTOM_FIELDS,
    recordOptions: overrides.recordOptions || RECORDS,
    defaultOptionValues: overrides.defaultOptionValues,
    isCaptchaRequired: overrides.isCaptchaRequired === true,
  });
};

type FieldOfFunction = (built: BuiltPublicForm, id: string) => PublicFormField;

const fieldOf: FieldOfFunction = (
  built: BuiltPublicForm,
  id: string,
): PublicFormField => {
  const field: PublicFormField | undefined = built.form.fields.find(
    (candidate: PublicFormField): boolean => {
      return candidate.id === id;
    },
  );

  expect(field).toBeDefined();

  return field!;
};

type ValidateFunction = (
  answers: unknown,
  fields?: Array<PublicFormField>,
) => FormSubmissionValidationResult;

const PUBLIC_FIELDS: Array<PublicFormField> = build().form.fields;

const validate: ValidateFunction = (
  answers: unknown,
  fields: Array<PublicFormField> = PUBLIC_FIELDS,
): FormSubmissionValidationResult => {
  return validateFormSubmission({ fields, data: { answers } });
};

// Every required question answered.
const REQUIRED_ANSWERS: JSONObject = {
  title: "The checkout is down",
  region: "EU",
  checked: true,
  email: "ada@example.com",
};

type ErrorsOfFunction = (answers: unknown) => Array<string>;

const errorsOf: ErrorsOfFunction = (answers: unknown): Array<string> => {
  const result: FormSubmissionValidationResult = validate(answers);

  if (result.isValid) {
    return [];
  }

  return result.errors;
};

type AnswersOfFunction = (answers: unknown) => JSONObject;

const answersOf: AnswersOfFunction = (answers: unknown): JSONObject => {
  const result: FormSubmissionValidationResult = validate(answers);

  if (!result.isValid) {
    throw new Error(`Expected the answers to pass: ${result.errors.join(" ")}`);
  }

  return result.answers;
};

describe("the page's header and limits", () => {
  test("the header the page's script adds to every request", () => {
    expect(FORM_PAGE_HEADER).toBe("x-oneuptime-form");
    // Lower case: Node reads header names that way.
    expect(FORM_PAGE_HEADER).toBe(FORM_PAGE_HEADER.toLowerCase());
    expect(FORM_PAGE_HEADER_VALUE).toBe("1");
  });

  test("text answers are capped, and the multi-line ones are cleaned as such", () => {
    expect(PUBLIC_FORM_TEXT_FIELD_TYPES).toEqual([
      PublicFormFieldType.Text,
      PublicFormFieldType.LongText,
      PublicFormFieldType.Markdown,
      PublicFormFieldType.Email,
    ]);
    expect(PUBLIC_FORM_MULTI_LINE_FIELD_TYPES).toEqual([
      PublicFormFieldType.LongText,
      PublicFormFieldType.Markdown,
    ]);
    expect(FORM_MULTI_SELECT_MAX_CHOICES).toBe(100);
  });

  test("the page's types are the custom field types, plus Email", () => {
    for (const type of Object.values(PublicFormFieldType)) {
      if (type !== PublicFormFieldType.Email) {
        expect(Object.values(CustomFieldType)).toContain(type);
      }
    }
  });
});

describe("buildPublicForm: what the page is told about the form", () => {
  test("its name, its description and whether a captcha is asked", () => {
    const built: BuiltPublicForm = build({ isCaptchaRequired: true });

    expect(built.form.name).toBe("Report a Problem");
    expect(built.form.description).toBe("Tell us **what** is broken.");
    expect(built.form.isCaptchaRequired).toBe(true);
    expect(build().form.isCaptchaRequired).toBe(false);
  });

  test("no description key for a blank one, and an empty name for none", () => {
    expect("description" in build({ description: "   " }).form).toBe(false);
    expect("description" in build({ description: null }).form).toBe(false);
    expect(build({ name: null }).form.name).toBe("");
  });

  test("tells the page nothing but the name, description, questions and captcha", () => {
    const built: BuiltPublicForm = build();

    expect(Object.keys(built.form).sort()).toEqual([
      "description",
      "fields",
      "isCaptchaRequired",
      "name",
    ]);

    for (const field of built.form.fields) {
      for (const key of Object.keys(field)) {
        expect([
          "id",
          "label",
          "helpText",
          "type",
          "isRequired",
          "options",
          "maxLength",
          "defaultValue",
        ]).toContain(key);
      }
    }

    // No custom field id, no target field key, no source.
    const serialized: string = JSON.stringify(built.form);

    expect(serialized).not.toContain(CF_REGION);
    expect(serialized).not.toContain(CF_IMPACT);
    expect(serialized).not.toContain("TargetCustomField");
    expect(serialized).not.toContain("incidentSeverityId");
  });

  test("asks the questions in the form's order, with their labels and help texts", () => {
    const built: BuiltPublicForm = build();

    expect(
      built.form.fields.map((field: PublicFormField): string => {
        return field.id;
      }),
    ).toEqual([
      "title",
      "description",
      "severity",
      "monitors",
      "region",
      "impact",
      "office",
      "checked",
      "name",
      "email",
    ]);
    expect(fieldOf(built, "title").label).toBe("What is wrong?");
    expect(fieldOf(built, "title").helpText).toBe("One line.");
    expect("helpText" in fieldOf(built, "description")).toBe(false);
    expect(built.skipped).toEqual([]);
  });

  describe("fields of what the form creates", () => {
    test("an incident's title is one line of up to 500 characters", () => {
      expect(fieldOf(build(), "title")).toEqual({
        id: "title",
        label: "What is wrong?",
        helpText: "One line.",
        type: PublicFormFieldType.Text,
        isRequired: true,
        maxLength: FORM_INCIDENT_TITLE_MAX_LENGTH,
      });
    });

    test("a maintenance event's title, up to 100", () => {
      const built: BuiltPublicForm = build({
        targetType: FormTargetType.ScheduledMaintenance,
        fields: getDefaultFormFields(FormTargetType.ScheduledMaintenance),
      });

      expect(built.form.fields[0]!.maxLength).toBe(
        FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
      );
      expect(built.form.fields[2]!.type).toBe(PublicFormFieldType.DateTime);
      expect(built.form.fields[3]!.type).toBe(PublicFormFieldType.DateTime);
    });

    test("the description is Markdown of up to 20,000 characters", () => {
      expect(fieldOf(build(), "description")).toMatchObject({
        type: PublicFormFieldType.Markdown,
        maxLength: FORM_DESCRIPTION_MAX_LENGTH,
      });
    });

    test("the severity offers every severity, with its color, when the form did not narrow it", () => {
      expect(fieldOf(build(), "severity").options).toEqual([
        { value: SEVERITY_HIGH, label: "High", color: "#ff0000" },
        { value: SEVERITY_LOW, label: "Low" },
      ]);
    });

    test("and only the ones it chose when it did", () => {
      const built: BuiltPublicForm = build({
        fields: [
          {
            id: "severity",
            source: FormFieldSource.TargetField,
            targetField: "incidentSeverityId",
            label: "How bad?",
            isRequired: true,
            allowedOptionIds: [SEVERITY_LOW],
          },
        ],
      });

      expect(fieldOf(built, "severity").options).toEqual([
        { value: SEVERITY_LOW, label: "Low" },
      ]);
    });

    test("starts on the form's own severity, when it is one the question offers", () => {
      expect(
        fieldOf(
          build({
            defaultOptionValues: {
              incidentSeverityId: SEVERITY_LOW.toUpperCase(),
            },
          }),
          "severity",
        ).defaultValue,
      ).toBe(SEVERITY_LOW);

      const narrowed: BuiltPublicForm = build({
        fields: [
          {
            id: "severity",
            source: FormFieldSource.TargetField,
            targetField: "incidentSeverityId",
            label: "How bad?",
            isRequired: false,
            allowedOptionIds: [SEVERITY_HIGH],
          },
        ],
        defaultOptionValues: { incidentSeverityId: SEVERITY_LOW },
      });

      expect("defaultValue" in fieldOf(narrowed, "severity")).toBe(false);
    });

    test("a multi-select offers only the records chosen for it, in the project's order", () => {
      expect(fieldOf(build(), "monitors")).toEqual({
        id: "monitors",
        label: "Affected Monitors",
        type: PublicFormFieldType.MultiSelectDropdown,
        isRequired: false,
        options: [
          { value: MONITOR_API, label: "API" },
          { value: MONITOR_WEB, label: "Website" },
        ],
      });
    });

    test("a color object is sent as its text", () => {
      const built: BuiltPublicForm = build({
        fields: [
          {
            id: "labels",
            source: FormFieldSource.TargetField,
            targetField: "labels",
            label: "Labels",
            isRequired: false,
            allowedOptionIds: [LABEL_EU],
          },
        ],
      });

      expect(fieldOf(built, "labels").options).toEqual([
        { value: LABEL_EU, label: "eu", color: "#00ff00" },
      ]);
    });

    test("a question that offers nothing it can list is left out, and says why", () => {
      const built: BuiltPublicForm = build({
        fields: [
          {
            id: "none-chosen",
            source: FormFieldSource.TargetField,
            targetField: "monitors",
            label: "Monitors",
            isRequired: false,
          },
          {
            id: "all-deleted",
            source: FormFieldSource.TargetField,
            targetField: "labels",
            label: "Labels",
            isRequired: false,
            allowedOptionIds: ["0f0f0f0f-0000-4000-8000-000000000001"],
          },
        ],
      });

      expect(built.form.fields).toEqual([]);
      expect(built.skipped).toEqual([
        { fieldId: "none-chosen", reason: FormSkippedFieldReason.NoOptions },
        { fieldId: "all-deleted", reason: FormSkippedFieldReason.NoOptions },
      ]);
    });

    test("records with no usable id, or listed twice, are not offered", () => {
      const built: BuiltPublicForm = build({
        recordOptions: {
          [FormTargetOptionsSource.IncidentSeverity]: [
            { id: "nope", name: "Broken" },
            { id: SEVERITY_HIGH.toUpperCase(), name: "High" },
            { id: SEVERITY_HIGH, name: "High again" },
            null as unknown as FormRecordOption,
          ],
        },
        fields: [FIELDS[2]],
      });

      expect(fieldOf(built, "severity").options).toEqual([
        { value: SEVERITY_HIGH, label: "High" },
      ]);
    });

    test("a field the form's target does not have is left out", () => {
      const built: BuiltPublicForm = build({
        targetType: FormTargetType.ScheduledMaintenance,
        fields: [FIELDS[2]],
      });

      expect(built.form.fields).toEqual([]);
      expect(built.skipped).toEqual([
        {
          fieldId: "severity",
          reason: FormSkippedFieldReason.UnknownTargetField,
        },
      ]);
    });
  });

  describe("custom fields", () => {
    test("asked with their own type and options", () => {
      const built: BuiltPublicForm = build();

      expect(fieldOf(built, "region")).toEqual({
        id: "region",
        label: "Region",
        type: PublicFormFieldType.Dropdown,
        isRequired: true,
        options: [
          { value: "EU", label: "EU" },
          { value: "US", label: "US" },
          { value: "APAC", label: "APAC" },
        ],
      });
      expect(fieldOf(built, "impact")).toEqual({
        id: "impact",
        label: "Impact",
        type: PublicFormFieldType.Number,
        isRequired: false,
      });
    });

    test("a field with no type, or one this version does not know, is asked as text", () => {
      const built: BuiltPublicForm = build({
        fields: [
          {
            id: "legacy",
            source: FormFieldSource.TargetCustomField,
            customFieldId: CF_UNTYPED,
            label: "Legacy",
            isRequired: false,
          },
        ],
      });

      expect(fieldOf(built, "legacy")).toMatchObject({
        type: PublicFormFieldType.Text,
        maxLength: FORM_TEXT_ANSWER_MAX_LENGTH,
      });
    });

    test("found by id whatever its case", () => {
      const built: BuiltPublicForm = build({
        customFields: [{ ...CUSTOM_FIELDS[0]!, id: CF_REGION.toUpperCase() }],
        fields: [FIELDS[4]],
      });

      expect(built.form.fields).toHaveLength(1);
      expect(built.bindings["region"]).toMatchObject({
        customFieldId: CF_REGION,
        customFieldName: "Region",
      });
    });

    test("a deleted custom field's question is left out", () => {
      const built: BuiltPublicForm = build({ customFields: [] });

      expect(
        built.skipped.filter(
          (entry: { fieldId: string; reason: FormSkippedFieldReason }) => {
            return entry.reason === FormSkippedFieldReason.CustomFieldDeleted;
          },
        ),
      ).toEqual([
        { fieldId: "region", reason: FormSkippedFieldReason.CustomFieldDeleted },
        { fieldId: "impact", reason: FormSkippedFieldReason.CustomFieldDeleted },
      ]);
    });

    test("a choice field with no options left is left out", () => {
      const built: BuiltPublicForm = build({
        customFields: [{ ...CUSTOM_FIELDS[0]!, dropdownOptions: "" }],
        fields: [FIELDS[4]],
      });

      expect(built.skipped).toEqual([
        { fieldId: "region", reason: FormSkippedFieldReason.NoOptions },
      ]);
    });

    test("a custom field is asked once, by name, even when two questions name it", () => {
      const built: BuiltPublicForm = build({
        customFields: [
          CUSTOM_FIELDS[0]!,
          // A field deleted and made again under the same name.
          { ...CUSTOM_FIELDS[0]!, id: CF_UNTYPED },
        ],
        fields: [
          FIELDS[4],
          {
            id: "region-again",
            source: FormFieldSource.TargetCustomField,
            customFieldId: CF_UNTYPED,
            label: "Region again",
            isRequired: false,
          },
        ],
      });

      expect(built.form.fields).toHaveLength(1);
      expect(built.skipped).toEqual([
        {
          fieldId: "region-again",
          reason: FormSkippedFieldReason.CustomFieldDeleted,
        },
      ]);
    });
  });

  describe("questions of the form's own", () => {
    test("a dropdown lists its options once each", () => {
      expect(fieldOf(build(), "office").options).toEqual([
        { value: "Berlin", label: "Berlin" },
        { value: "London", label: "London" },
      ]);
    });

    test("colored options keep their colors", () => {
      const built: BuiltPublicForm = build({
        fields: [
          {
            id: "office",
            source: FormFieldSource.Question,
            type: CustomFieldType.MultiSelectDropdown,
            dropdownOptions: JSON.stringify([
              { value: "Berlin", color: "#111111" },
              { value: "London" },
            ]),
            label: "Offices",
            isRequired: false,
          },
        ],
      });

      expect(fieldOf(built, "office").options).toEqual([
        { value: "Berlin", label: "Berlin", color: "#111111" },
        { value: "London", label: "London" },
      ]);
    });

    test.each([
      [CustomFieldType.Text, PublicFormFieldType.Text, FORM_TEXT_ANSWER_MAX_LENGTH],
      [
        CustomFieldType.LongText,
        PublicFormFieldType.LongText,
        FORM_TEXT_ANSWER_MAX_LENGTH,
      ],
      [
        CustomFieldType.Markdown,
        PublicFormFieldType.Markdown,
        FORM_TEXT_ANSWER_MAX_LENGTH,
      ],
      [CustomFieldType.Number, PublicFormFieldType.Number, undefined],
      [CustomFieldType.Boolean, PublicFormFieldType.Boolean, undefined],
      [CustomFieldType.Date, PublicFormFieldType.Date, undefined],
      [CustomFieldType.DateTime, PublicFormFieldType.DateTime, undefined],
    ])(
      "a %s question is a %s input, capped at %p",
      (
        type: CustomFieldType,
        publicType: PublicFormFieldType,
        maxLength: number | undefined,
      ) => {
        const built: BuiltPublicForm = build({
          fields: [
            {
              id: "q",
              source: FormFieldSource.Question,
              type,
              label: "Q",
              isRequired: false,
            },
          ],
        });

        expect(fieldOf(built, "q").type).toBe(publicType);
        expect(fieldOf(built, "q").maxLength).toBe(maxLength);
      },
    );
  });

  test("the submitter's name and email fit their columns, the email checked as one", () => {
    const built: BuiltPublicForm = build();

    expect(fieldOf(built, "name")).toEqual({
      id: "name",
      label: "Your Name",
      type: PublicFormFieldType.Text,
      isRequired: false,
      maxLength: 100,
    });
    expect(fieldOf(built, "email")).toEqual({
      id: "email",
      label: "Your Email",
      type: PublicFormFieldType.Email,
      isRequired: true,
      maxLength: 100,
    });
  });

  test("says where each answer goes, for the server only", () => {
    const built: BuiltPublicForm = build();

    expect(built.bindings["title"]).toMatchObject({
      source: FormFieldSource.TargetField,
      label: "What is wrong?",
    });
    expect(
      (built.bindings["title"] as { definition: { key: string } }).definition
        .key,
    ).toBe("title");
    expect(built.bindings["region"]).toEqual({
      source: FormFieldSource.TargetCustomField,
      label: "Region",
      customFieldId: CF_REGION,
      customFieldName: "Region",
      customFieldType: CustomFieldType.Dropdown,
    });
    expect(built.bindings["office"]).toEqual({
      source: FormFieldSource.Question,
      label: "Which office?",
      type: CustomFieldType.Dropdown,
    });
    expect(built.bindings["email"]).toEqual({
      source: FormFieldSource.Submitter,
      label: "Your Email",
      submitterField: FormSubmitterField.Email,
    });
  });

  test("stored entries it cannot read are reported, by id when they have one", () => {
    const built: BuiltPublicForm = build({
      fields: [
        { id: "broken", source: "Banana", label: "Broken", isRequired: false },
        { source: FormFieldSource.Question, label: "No id" },
        null,
        FIELDS[0],
      ],
    });

    expect(built.form.fields).toHaveLength(1);
    expect(built.skipped).toEqual([
      { fieldId: "broken", reason: FormSkippedFieldReason.Unreadable },
    ]);
  });

  test.each([[undefined], [null], ["x"], [{}]])(
    "no questions stored (%p) is a form that asks nothing",
    (fields: unknown) => {
      const built: BuiltPublicForm = build({ fields });

      expect(built.form.fields).toEqual([]);
      expect(built.bindings).toEqual({});
    },
  );
});

describe("validateFormSubmission: the shape of the request", () => {
  test.each([[null], ["answers"], [[]], [5]])(
    "a body whose data is not an object (%p) is refused",
    (data: unknown) => {
      expect(validateFormSubmission({ fields: PUBLIC_FIELDS, data })).toEqual({
        isValid: false,
        errors: ["The submission must be an object holding the form's answers."],
      });
    },
  );

  test("answers that are not an object are refused", () => {
    expect(errorsOf("everything")).toContain(
      "The answers must be an object keyed by question.",
    );
    expect(errorsOf([1, 2])).toContain(
      "The answers must be an object keyed by question.",
    );
  });

  test("no answers at all is every required question unanswered", () => {
    expect(errorsOf(undefined)).toEqual([
      "What is wrong? is required.",
      "Region is required.",
      "I have checked the status page must be checked.",
      "Your Email is required.",
    ]);
  });

  test("the required answers alone pass, and only answered questions are kept", () => {
    expect(answersOf(REQUIRED_ANSWERS)).toEqual({
      title: "The checkout is down",
      region: "EU",
      checked: true,
      email: "ada@example.com",
    });
  });

  test("an answer to a question the form does not ask is dropped, unread", () => {
    const answers: JSONObject = answersOf({
      ...REQUIRED_ANSWERS,
      projectId: "anything",
      isVisibleOnStatusPage: true,
      currentIncidentStateId: SEVERITY_HIGH,
    });

    expect(Object.keys(answers).sort()).toEqual([
      "checked",
      "email",
      "region",
      "title",
    ]);
  });

  test("an own __proto__ key in the answers sets no prototype and is not an answer", () => {
    const raw: JSONObject = JSON.parse(
      `{"title":"Down","region":"EU","checked":true,"email":"a@b.co","__proto__":{"polluted":true}}`,
    );

    const answers: JSONObject = answersOf(raw);

    expect(Object.getPrototypeOf(answers)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.keys(answers)).not.toContain("__proto__");
  });

  test("every problem is listed, in the form's order", () => {
    expect(
      errorsOf({
        title: "x".repeat(FORM_INCIDENT_TITLE_MAX_LENGTH + 1),
        region: "Mars",
        checked: false,
        email: "not an email",
      }),
    ).toEqual([
      "What is wrong? cannot be more than 500 characters.",
      "Region must be one of the options the form lists.",
      "I have checked the status page must be checked.",
      "Your Email is not a valid email address.",
    ]);
  });

  test("formatFormSubmissionErrors makes one message of them", () => {
    expect(formatFormSubmissionErrors(["A is required.", "B is required."])).toBe(
      "A is required. B is required.",
    );
    expect(formatFormSubmissionErrors([])).toBe("");
  });
});

describe("validateFormSubmission: text", () => {
  test("a one-line answer becomes one line, its spaces collapsed", () => {
    expect(
      answersOf({
        ...REQUIRED_ANSWERS,
        title: "  The   checkout\n\tis\r\ndown  ",
      })["title"],
    ).toBe("The checkout is down");
  });

  test("a Markdown answer keeps its lines and the first line's indentation", () => {
    expect(
      answersOf({
        ...REQUIRED_ANSWERS,
        description: "\n\n    $ curl /health\n    500\n\nIt broke.\u0000  \n\n",
      })["description"],
    ).toBe("    $ curl /health\n    500\n\nIt broke.");
  });

  test("a required answer of nothing but spaces, tabs or line breaks is no answer", () => {
    for (const title of ["", "   ", "\t\n\r\n", "\u0000"]) {
      expect(errorsOf({ ...REQUIRED_ANSWERS, title })).toEqual([
        "What is wrong? is required.",
      ]);
    }
  });

  test("an optional answer left blank is not stored", () => {
    expect("description" in answersOf({ ...REQUIRED_ANSWERS, description: "  \n " })).toBe(
      false,
    );
  });

  test("text is capped at its question's length, exactly", () => {
    expect(
      answersOf({
        ...REQUIRED_ANSWERS,
        title: "x".repeat(FORM_INCIDENT_TITLE_MAX_LENGTH),
      })["title"],
    ).toHaveLength(FORM_INCIDENT_TITLE_MAX_LENGTH);
    expect(
      errorsOf({
        ...REQUIRED_ANSWERS,
        description: "x".repeat(FORM_DESCRIPTION_MAX_LENGTH + 1),
      }),
    ).toEqual(["Description cannot be more than 20000 characters."]);
  });

  test("text must be text", () => {
    expect(errorsOf({ ...REQUIRED_ANSWERS, title: 42 })).toEqual([
      "What is wrong? must be text.",
    ]);
    expect(errorsOf({ ...REQUIRED_ANSWERS, title: true })).toEqual([
      "What is wrong? must be text.",
    ]);
  });

  test("a label with dollar signs comes out as typed", () => {
    const fields: Array<PublicFormField> = [
      {
        id: "cost",
        label: "Cost ($) $& $1",
        type: PublicFormFieldType.Text,
        isRequired: true,
      },
    ];

    expect(validate({}, fields)).toEqual({
      isValid: false,
      errors: ["Cost ($) $& $1 is required."],
    });
  });
});

describe("validateFormSubmission: the submitter's email", () => {
  test("one ordinary address, stored lowercased", () => {
    expect(
      answersOf({ ...REQUIRED_ANSWERS, email: "  Ada.Lovelace@Example.COM " })[
        "email"
      ],
    ).toBe("ada.lovelace@example.com");
  });

  test.each([
    ["Ada <ada@example.com>"],
    ["ada@example.com, bob@example.com"],
    ["mailto:ada@example.com"],
    ["ada@"],
    ["@example.com"],
    ["ada example.com"],
  ])("not %p", (email: string) => {
    expect(errorsOf({ ...REQUIRED_ANSWERS, email })).toEqual([
      "Your Email is not a valid email address.",
    ]);
  });

  test("isWholeEmailAddress says the same as the server", () => {
    expect(isWholeEmailAddress(" ada@example.com ")).toBe(true);
    expect(isWholeEmailAddress("Ada <ada@example.com>")).toBe(false);
    expect(isWholeEmailAddress("")).toBe(false);
  });
});

describe("validateFormSubmission: checkboxes", () => {
  test("a required checkbox must be ticked", () => {
    expect(errorsOf({ ...REQUIRED_ANSWERS, checked: false })).toEqual([
      "I have checked the status page must be checked.",
    ]);
    expect(errorsOf({ ...REQUIRED_ANSWERS, checked: "false" })).toEqual([
      "I have checked the status page must be checked.",
    ]);
  });

  test("\"true\" and \"false\" are read as yes and no", () => {
    expect(answersOf({ ...REQUIRED_ANSWERS, checked: "true" })["checked"]).toBe(
      true,
    );
  });

  test("an optional checkbox left unticked is stored as no", () => {
    const fields: Array<PublicFormField> = [
      {
        id: "ok",
        label: "OK?",
        type: PublicFormFieldType.Boolean,
        isRequired: false,
      },
    ];

    expect(validate({ ok: false }, fields)).toEqual({
      isValid: true,
      answers: { ok: false },
    });
  });

  test("anything else is refused", () => {
    expect(errorsOf({ ...REQUIRED_ANSWERS, checked: "yes" })).toEqual([
      "I have checked the status page must be checked or unchecked.",
    ]);
    expect(errorsOf({ ...REQUIRED_ANSWERS, checked: 1 })).toEqual([
      "I have checked the status page must be checked or unchecked.",
    ]);
  });
});

describe("validateFormSubmission: choices", () => {
  test("a dropdown answer is one of its options, exactly", () => {
    expect(
      answersOf({ ...REQUIRED_ANSWERS, office: " London " })["office"],
    ).toBe("London");
    expect(errorsOf({ ...REQUIRED_ANSWERS, office: "london" })).toEqual([
      "Which office? must be one of the options the form lists.",
    ]);
  });

  test("a record is chosen by its id in any case, and stored lowercased", () => {
    expect(
      answersOf({ ...REQUIRED_ANSWERS, severity: SEVERITY_HIGH.toUpperCase() })[
        "severity"
      ],
    ).toBe(SEVERITY_HIGH);
  });

  test("a record the question does not offer is refused", () => {
    expect(
      errorsOf({ ...REQUIRED_ANSWERS, monitors: [MONITOR_DB] }),
    ).toEqual([
      "Affected Monitors must be chosen from the options the form lists.",
    ]);
  });

  test("a multi-select keeps each choice once, in the order given", () => {
    expect(
      answersOf({
        ...REQUIRED_ANSWERS,
        monitors: [MONITOR_WEB, MONITOR_API, MONITOR_WEB.toUpperCase(), ""],
      })["monitors"],
    ).toEqual([MONITOR_WEB, MONITOR_API]);
  });

  test("a single choice sent as text is a list of one", () => {
    expect(
      answersOf({ ...REQUIRED_ANSWERS, monitors: MONITOR_API })["monitors"],
    ).toEqual([MONITOR_API]);
  });

  test("an empty list is no answer", () => {
    expect("monitors" in answersOf({ ...REQUIRED_ANSWERS, monitors: [] })).toBe(
      false,
    );
  });

  test("a list is refused for a question that takes one answer", () => {
    expect(errorsOf({ ...REQUIRED_ANSWERS, region: ["EU"] })).toEqual([
      "Region takes one answer, not a list.",
    ]);
  });

  test("an object is never an answer", () => {
    expect(errorsOf({ ...REQUIRED_ANSWERS, region: { value: "EU" } })).toEqual([
      "Region takes one answer, not an object.",
    ]);
    expect(
      errorsOf({ ...REQUIRED_ANSWERS, monitors: { 0: MONITOR_API } }),
    ).toEqual(["Affected Monitors takes a list of its options, not an object."]);
  });

  test("lists and objects inside a multi-select's answer are refused, unread", () => {
    expect(
      errorsOf({ ...REQUIRED_ANSWERS, monitors: [[MONITOR_API]] }),
    ).toEqual([
      "Affected Monitors takes a list of its options, not lists or objects within it.",
    ]);
    expect(
      errorsOf({ ...REQUIRED_ANSWERS, monitors: [{ id: MONITOR_API }] }),
    ).toEqual([
      "Affected Monitors takes a list of its options, not lists or objects within it.",
    ]);
  });

  test("at most 100 choices, or as many options as the question has", () => {
    const tooMany: Array<string> = [];

    for (let index: number = 0; index <= FORM_MULTI_SELECT_MAX_CHOICES; index++) {
      tooMany.push(MONITOR_API);
    }

    expect(errorsOf({ ...REQUIRED_ANSWERS, monitors: tooMany })).toEqual([
      "Affected Monitors cannot have more than 100 choices.",
    ]);

    // A question with more options than that takes as many.
    const options: Array<string> = [];

    for (let index: number = 0; index < 150; index++) {
      options.push(`Option ${index}`);
    }

    const fields: Array<PublicFormField> = [
      {
        id: "many",
        label: "Many",
        type: PublicFormFieldType.MultiSelectDropdown,
        isRequired: false,
        options: options.map((value: string) => {
          return { value, label: value };
        }),
      },
    ];

    expect(validate({ many: options }, fields).isValid).toBe(true);
  });
});

describe("validateFormSubmission: numbers and dates", () => {
  test("a number is one", () => {
    expect(answersOf({ ...REQUIRED_ANSWERS, impact: 42 })["impact"]).toBe(42);
    expect(errorsOf({ ...REQUIRED_ANSWERS, impact: "lots" }).length).toBe(1);
    expect(errorsOf({ ...REQUIRED_ANSWERS, impact: "lots" })[0]).toContain(
      "Impact",
    );
  });

  test("a date and time is one", () => {
    const fields: Array<PublicFormField> = [
      {
        id: "when",
        label: "When?",
        type: PublicFormFieldType.DateTime,
        isRequired: true,
      },
    ];

    expect(validate({ when: "2026-10-02T10:00:00.000Z" }, fields)).toEqual({
      isValid: true,
      answers: { when: "2026-10-02T10:00:00.000Z" },
    });
    expect(validate({ when: "yesterday-ish" }, fields).isValid).toBe(false);
    expect(validate({ when: "" }, fields)).toEqual({
      isValid: false,
      errors: ["When? is required."],
    });
  });
});

describe("validateFormSubmission never throws", () => {
  test("on a list nested thousands deep", () => {
    let nested: unknown = MONITOR_API;

    for (let depth: number = 0; depth < 5000; depth++) {
      nested = [nested];
    }

    expect(() => {
      errorsOf({ ...REQUIRED_ANSWERS, monitors: nested, region: nested });
    }).not.toThrow();
  });

  test("on an object with many keys, or a huge list", () => {
    const wide: Record<string, string> = {};

    for (let index: number = 0; index < 50000; index++) {
      wide[`k${index}`] = "v";
    }

    const huge: Array<string> = new Array<string>(200000).fill(MONITOR_API);

    const started: number = Date.now();

    expect(errorsOf({ ...REQUIRED_ANSWERS, region: wide, monitors: huge })).toEqual(
      [
        // In the form's order: the monitors are asked before the region.
        "Affected Monitors cannot have more than 100 choices.",
        "Region takes one answer, not an object.",
      ],
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("on fields it was not given", () => {
    expect(
      validateFormSubmission({
        fields: undefined as unknown as Array<PublicFormField>,
        data: { answers: { anything: 1 } },
      }),
    ).toEqual({ isValid: true, answers: {} });
  });
});

describe("cleaning answers", () => {
  test("cleanSingleLineAnswer", () => {
    expect(cleanSingleLineAnswer("  a\n\nb\tc   d\u0000e  ")).toBe("a b c d e");
  });

  test("cleanMultiLineAnswer", () => {
    expect(cleanMultiLineAnswer("\n  \n  code\nmore\u0000  \n")).toBe(
      "  code\nmore",
    );
  });

  test("cleanScalarAnswer", () => {
    expect(cleanScalarAnswer("  EU\u0000 ")).toBe("EU");
  });

  test("isBlankFormAnswer reads an answer as the server cleans it", () => {
    expect(isBlankFormAnswer(" \t\n ", false)).toBe(true);
    expect(isBlankFormAnswer("\u0000\n", true)).toBe(true);
    expect(isBlankFormAnswer("    code", true)).toBe(false);
    expect(isBlankFormAnswer(" x ", false)).toBe(false);
  });
});

describe("the module stays pure", () => {
  test("imports only other pure modules of Common", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Types/Form/FormPublic.ts"),
      "utf8",
    );

    for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
      expect(match[1]).toMatch(/^\.\.?\//);
      expect(match[1]).not.toMatch(/Server|UI\/|Models|react/);
    }
  });
});
