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
  isFormTemplateId,
  readFormTemplateIdFromSearch,
} from "../../../Types/Form/FormTemplate";
import { JSONObject } from "../../../Types/JSON";
import { ACCOUNTS_URL } from "../../../UI/Config";
import { getPublicFormFieldKey } from "../../../UI/Components/PublicForm/PublicFormFields";
import {
  FormTemplateEditorQuestion,
  getFormTemplateAnsweredLabels,
  getFormTemplateEditorQuestions,
  getFormTemplateEditorValues,
  getFormTemplateShareLink,
  readFormTemplateFromEditor,
  TEMPLATE_DEFAULT_KEY,
  TEMPLATE_NAME_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Templates/FormTemplatesState";
import { describe, expect, test } from "@jest/globals";

/*
 * The Templates page's rules, without drawing it: the questions a
 * template's editor asks (every question the form can answer, hidden ones
 * too, none required), what it starts with, the template its answers make
 * (packed as a submission's are, so the server reads them alike), what a
 * template's row says it fills in, and its link.
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
  test("a new template: no name, not the default, nothing answered", () => {
    expect(
      getFormTemplateEditorValues({
        template: undefined,
        questions: QUESTIONS,
      }),
    ).toEqual({
      [TEMPLATE_NAME_KEY]: "",
      [TEMPLATE_DEFAULT_KEY]: false,
    });
  });

  test("a template being edited: its name, Default, and its answers where the inputs hold them", () => {
    expect(
      getFormTemplateEditorValues({ template: OUTAGE, questions: QUESTIONS }),
    ).toEqual({
      [TEMPLATE_NAME_KEY]: "Application Outage",
      [TEMPLATE_DEFAULT_KEY]: true,
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
        },
        questions: QUESTIONS,
      }),
    ).toEqual({
      [TEMPLATE_NAME_KEY]: "Stale",
      [TEMPLATE_DEFAULT_KEY]: false,
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
