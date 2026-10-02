import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  buildPublicFormFields,
  getPublicFormFieldKey,
  getPublicFormInitialValues,
  packPublicFormAnswers,
} from "../../../UI/Components/PublicForm/PublicFormFields";
import {
  PublicForm,
  PublicFormFieldType,
  validateFormSubmission,
} from "../../../Types/Form/FormPublic";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The inputs a form's public page (and the builder's preview) draws for its
 * questions, and the answers it sends: each question's input of its type,
 * the checks the server makes done in the browser first - so a refusal comes
 * in the submitter's language, before a captcha answer is spent - and the
 * answers packed exactly as the server reads them.
 */

const SEVERITY_ID: string = "0a0a0a0a-0000-4000-8000-000000000001";

const FORM: PublicForm = {
  name: "Report a Problem",
  fields: [
    {
      id: "title",
      label: "What is wrong?",
      helpText: "One line.",
      type: PublicFormFieldType.Text,
      isRequired: true,
      maxLength: 500,
    },
    {
      id: "details",
      label: "Details",
      type: PublicFormFieldType.Markdown,
      isRequired: true,
      maxLength: 20000,
    },
    {
      id: "steps",
      label: "Steps",
      type: PublicFormFieldType.LongText,
      isRequired: false,
    },
    {
      id: "severity",
      label: "How bad?",
      type: PublicFormFieldType.Dropdown,
      isRequired: false,
      options: [
        { value: SEVERITY_ID, label: "Critical", color: "#ff0000" },
        { value: "minor", label: "Minor" },
      ],
      defaultValue: SEVERITY_ID,
    },
    {
      id: "offices",
      label: "Offices",
      type: PublicFormFieldType.MultiSelectDropdown,
      isRequired: false,
      options: [
        { value: "Berlin", label: "Berlin" },
        { value: "London", label: "" },
      ],
    },
    {
      id: "count",
      label: "How many?",
      type: PublicFormFieldType.Number,
      isRequired: false,
    },
    {
      id: "checked",
      label: "I checked",
      type: PublicFormFieldType.Boolean,
      isRequired: true,
    },
    {
      id: "when",
      label: "When?",
      type: PublicFormFieldType.DateTime,
      isRequired: false,
    },
    {
      id: "day",
      label: "Day",
      type: PublicFormFieldType.Date,
      isRequired: false,
    },
    {
      id: "email",
      label: "Your Email",
      type: PublicFormFieldType.Email,
      isRequired: true,
      maxLength: 100,
    },
  ],
  isCaptchaRequired: false,
};

type FieldOfFunction = (id: string) => Field<JSONObject>;

const fieldOf: FieldOfFunction = (id: string): Field<JSONObject> => {
  return buildPublicFormFields(FORM).find((field: Field<JSONObject>) => {
    return Object.keys(field.field || {})[0] === getPublicFormFieldKey(id);
  })!;
};

type CheckFunction = (id: string, value: unknown) => string | null;

const check: CheckFunction = (id: string, value: unknown): string | null => {
  return fieldOf(id).customValidation!({
    [getPublicFormFieldKey(id)]: value,
  } as never);
};

describe("buildPublicFormFields: one input per question", () => {
  test("each question's answer is held under its own key", () => {
    expect(getPublicFormFieldKey("title")).toBe("answer_title");
    expect(
      buildPublicFormFields(FORM).map((field: Field<JSONObject>): string => {
        return Object.keys(field.field || {})[0]!;
      }),
    ).toEqual(
      FORM.fields.map((field: { id: string }): string => {
        return `answer_${field.id}`;
      }),
    );
  });

  test.each([
    ["title", FormFieldSchemaType.Text],
    ["details", FormFieldSchemaType.Markdown],
    ["steps", FormFieldSchemaType.LongText],
    ["severity", FormFieldSchemaType.Dropdown],
    ["offices", FormFieldSchemaType.MultiSelectDropdown],
    ["count", FormFieldSchemaType.Number],
    ["checked", FormFieldSchemaType.Toggle],
    ["when", FormFieldSchemaType.DateTime],
    ["day", FormFieldSchemaType.Date],
    ["email", FormFieldSchemaType.Email],
  ])("%s is drawn as a %s input", (id: string, type: FormFieldSchemaType) => {
    expect(fieldOf(id).fieldType).toBe(type);
  });

  test("with its label, help text, required flag, full width and test id", () => {
    expect(fieldOf("title")).toMatchObject({
      title: "What is wrong?",
      description: "One line.",
      required: true,
      spanFullRow: true,
      dataTestId: "form-field-title",
      validation: { maxLength: 500 },
    });
    expect(fieldOf("steps").description).toBeUndefined();
    expect(fieldOf("steps").validation).toBeUndefined();
  });

  test("a test id prefix of the caller's choosing, as the builder's preview uses", () => {
    expect(
      buildPublicFormFields(FORM, {
        dataTestIdPrefix: "form-preview-field",
      })[0]!.dataTestId,
    ).toBe("form-preview-field-title");
  });

  test("a choice lists its options, with their colors", () => {
    const options: Array<{ label: string; value: unknown; color?: unknown }> =
      fieldOf("severity").dropdownOptions as never;

    expect(
      options.map((option: { label: string; value: unknown }) => {
        return [option.label, option.value];
      }),
    ).toEqual([
      ["Critical", SEVERITY_ID],
      ["Minor", "minor"],
    ]);
    expect(String(options[0]!.color)).toBe("#ff0000");
    expect(options[1]!.color).toBeUndefined();
    // An option with no label shows its value.
    expect(
      (fieldOf("offices").dropdownOptions as Array<{ label: string }>)[1]!
        .label,
    ).toBe("London");
  });

  test("Markdown cannot upload images: a submitter may have no account", () => {
    expect(fieldOf("details").allowImageUpload).toBe(false);
  });

  test("an email is not spell-checked", () => {
    expect(fieldOf("email").disableSpellCheck).toBe(true);
  });
});

describe("buildPublicFormFields: the checks made before anything is sent", () => {
  test("a required text answer of nothing but spaces is no answer, as the server reads it", () => {
    expect(check("title", "   ")).toBe("What is wrong? is required.");
    expect(check("title", "\t\n")).toBe("What is wrong? is required.");
    expect(check("title", "Down")).toBeNull();
    expect(check("details", "\n\n  \n")).toBe("Details is required.");
    // Four spaces open a code block in Markdown: not blank.
    expect(check("details", "    $ curl")).toBeNull();
  });

  test("an optional text answer may be blank", () => {
    expect(check("steps", "   ")).toBeNull();
  });

  test("a required checkbox must be ticked", () => {
    expect(check("checked", false)).toBe("I checked must be checked.");
    expect(check("checked", undefined)).toBe("I checked must be checked.");
    expect(check("checked", true)).toBeNull();
    expect(check("checked", "true")).toBeNull();
  });

  test("an email must be one whole address", () => {
    expect(check("email", "Jane <jane@example.com>")).toBe(
      "Email is not valid.",
    );
    expect(check("email", "jane@example.com")).toBeNull();
    expect(check("email", "  ")).toBe("Your Email is required.");
  });

  test("anything that is not text is left to the inputs' own checks", () => {
    expect(check("count", 4)).toBeNull();
    expect(check("severity", { value: SEVERITY_ID })).toBeNull();
  });
});

describe("getPublicFormInitialValues", () => {
  test("starts a question on its default, and nothing else", () => {
    expect(getPublicFormInitialValues(FORM)).toEqual({
      answer_severity: SEVERITY_ID,
    });
  });
});

describe("packPublicFormAnswers: the answers, as the server reads them", () => {
  test("keyed by question, only those answered", () => {
    expect(
      packPublicFormAnswers({
        form: FORM,
        values: {
          answer_title: "Down",
          answer_details: "",
          answer_severity: { value: SEVERITY_ID, label: "Critical" } as never,
          answer_offices: [
            { value: "Berlin", label: "Berlin" },
            "London",
            "Berlin",
            "",
          ] as never,
          answer_count: 3,
          answer_checked: "true",
          answer_when: new Date("2026-10-02T10:00:00.000Z") as never,
          answer_email: "jane@example.com",
          unknown: "ignored",
        },
      }),
    ).toEqual({
      title: "Down",
      severity: SEVERITY_ID,
      offices: ["Berlin", "London"],
      count: 3,
      checked: true,
      when: "2026-10-02T10:00:00.000Z",
      email: "jane@example.com",
    });
  });

  test("an unticked checkbox is sent as no; an untouched one not at all", () => {
    expect(
      packPublicFormAnswers({ form: FORM, values: { answer_checked: false } }),
    ).toEqual({ checked: false });
    expect(packPublicFormAnswers({ form: FORM, values: {} })).toEqual({});
  });

  test("a number typed as text is sent as typed, for the server to check", () => {
    expect(
      packPublicFormAnswers({ form: FORM, values: { answer_count: " 7 " } }),
    ).toEqual({ count: "7" });
  });

  test("a single multi-select choice is a list of one; an invalid date is no answer", () => {
    expect(
      packPublicFormAnswers({
        form: FORM,
        values: {
          answer_offices: "Berlin",
          answer_when: new Date("not a date") as never,
        },
      }),
    ).toEqual({ offices: ["Berlin"] });
  });

  test("what it packs is what the server accepts", () => {
    const answers: JSONObject = packPublicFormAnswers({
      form: FORM,
      values: {
        answer_title: "Down",
        answer_details: "It broke.",
        answer_checked: true,
        answer_email: "jane@example.com",
        answer_offices: ["London"] as never,
        answer_severity: SEVERITY_ID,
      },
    });

    expect(
      validateFormSubmission({ fields: FORM.fields, data: { answers } }),
    ).toEqual({ isValid: true, answers });
  });
});
