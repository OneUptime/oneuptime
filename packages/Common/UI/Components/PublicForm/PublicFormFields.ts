import { DropdownOption } from "../Dropdown/Dropdown";
import Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import { translateValidationMessage } from "../Forms/Validation";
import Color from "../../../Types/Color";
import {
  isBlankFormAnswer,
  isWholeEmailAddress,
  PUBLIC_FORM_MULTI_LINE_FIELD_TYPES,
  PublicForm,
  PublicFormField,
  PublicFormFieldOption,
  PublicFormFieldType,
} from "../../../Types/Form/FormPublic";
import { JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * A form's questions as inputs: what the public page anyone with a form's
 * link opens draws (Accounts, Pages/Form), and what the dashboard's form
 * builder previews - one builder, so the preview is the page.
 *
 * Every answer is held under its own key (getPublicFormFieldKey), never
 * under the question's label: two questions may share a label, and the
 * submit request keys answers by question id.
 *
 * The browser asks what it can of the server's own rules (FormPublic) before
 * anything is sent - a required answer of nothing but spaces, an email that
 * is not one whole address, a required checkbox left unticked - so the
 * submitter is told in their own language, before a captcha answer is spent.
 * The server checks everything again, and has the last word.
 */

const FORM_KEY_PREFIX: string = "answer_";

export type GetPublicFormFieldKeyFunction = (fieldId: string) => string;

// Where the form holds a question's answer.
export const getPublicFormFieldKey: GetPublicFormFieldKeyFunction = (
  fieldId: string,
): string => {
  return `${FORM_KEY_PREFIX}${fieldId}`;
};

type ToSchemaTypeFunction = (type: PublicFormFieldType) => FormFieldSchemaType;

/*
 * A question's type as the form library's: the values are shared, apart
 * from a yes/no question, which is a toggle there.
 */
const toSchemaType: ToSchemaTypeFunction = (
  type: PublicFormFieldType,
): FormFieldSchemaType => {
  switch (type) {
    case PublicFormFieldType.Boolean:
      return FormFieldSchemaType.Toggle;
    case PublicFormFieldType.LongText:
      return FormFieldSchemaType.LongText;
    case PublicFormFieldType.Markdown:
      return FormFieldSchemaType.Markdown;
    case PublicFormFieldType.Number:
      return FormFieldSchemaType.Number;
    case PublicFormFieldType.Date:
      return FormFieldSchemaType.Date;
    case PublicFormFieldType.DateTime:
      return FormFieldSchemaType.DateTime;
    case PublicFormFieldType.Dropdown:
      return FormFieldSchemaType.Dropdown;
    case PublicFormFieldType.MultiSelectDropdown:
      return FormFieldSchemaType.MultiSelectDropdown;
    case PublicFormFieldType.Email:
      return FormFieldSchemaType.Email;
    default:
      return FormFieldSchemaType.Text;
  }
};

type ToDropdownOptionsFunction = (
  options: Array<PublicFormFieldOption> | undefined,
) => Array<DropdownOption>;

const toDropdownOptions: ToDropdownOptionsFunction = (
  options: Array<PublicFormFieldOption> | undefined,
): Array<DropdownOption> => {
  return (options || []).map(
    (option: PublicFormFieldOption): DropdownOption => {
      const dropdownOption: DropdownOption = {
        label: option.label || option.value,
        value: option.value,
      };

      if (option.color) {
        try {
          dropdownOption.color = new Color(option.color);
        } catch {
          // A color this page cannot draw is simply not drawn.
        }
      }

      return dropdownOption;
    },
  );
};

export interface BuildPublicFormFieldsOptions {
  // Prefixed to each input's test id.
  dataTestIdPrefix?: string | undefined;
}

export type BuildPublicFormFieldsFunction = (
  form: PublicForm,
  options?: BuildPublicFormFieldsOptions,
) => Array<Field<JSONObject>>;

/** One input per question, in the order the form asks them. */
export const buildPublicFormFields: BuildPublicFormFieldsFunction = (
  form: PublicForm,
  options?: BuildPublicFormFieldsOptions,
): Array<Field<JSONObject>> => {
  const prefix: string = options?.dataTestIdPrefix || "form-field";

  return (form.fields || []).map(
    (question: PublicFormField): Field<JSONObject> => {
      const key: string = getPublicFormFieldKey(question.id);
      const label: string = question.label;

      const field: Field<JSONObject> = {
        field: { [key]: true },
        title: label,
        fieldType: toSchemaType(question.type),
        required: question.isRequired,
        spanFullRow: true,
        dataTestId: `${prefix}-${question.id}`,
      };

      if (question.helpText) {
        field.description = question.helpText;
      }

      if (
        question.type === PublicFormFieldType.Dropdown ||
        question.type === PublicFormFieldType.MultiSelectDropdown
      ) {
        field.dropdownOptions = toDropdownOptions(question.options);
      }

      if (question.maxLength) {
        field.validation = { maxLength: question.maxLength };
      }

      // Uploading an image needs a signed-in user; a submitter may be none.
      if (question.type === PublicFormFieldType.Markdown) {
        field.allowImageUpload = false;
      }

      if (question.type === PublicFormFieldType.Email) {
        field.disableSpellCheck = true;
      }

      field.customValidation = (
        values: FormValues<JSONObject>,
      ): string | null => {
        const value: unknown = (values as JSONObject)[key];

        /*
         * A required yes/no question is an acknowledgement: only a tick
         * answers it. `required` alone cannot say that - the form turns an
         * unticked box into "false" before its own required check.
         */
        if (question.type === PublicFormFieldType.Boolean) {
          if (question.isRequired && value !== true && value !== "true") {
            return translateValidationMessage("{{field}} must be checked.", {
              field: label,
            });
          }

          return null;
        }

        if (typeof value !== "string") {
          return null;
        }

        /*
         * The form's own required check passes an answer of nothing but
         * spaces, which the server then refuses.
         */
        if (
          question.isRequired &&
          (question.type === PublicFormFieldType.Text ||
            question.type === PublicFormFieldType.LongText ||
            question.type === PublicFormFieldType.Markdown ||
            question.type === PublicFormFieldType.Email) &&
          isBlankFormAnswer(
            value,
            PUBLIC_FORM_MULTI_LINE_FIELD_TYPES.includes(question.type),
          )
        ) {
          return translateValidationMessage("{{field}} is required.", {
            field: label,
          });
        }

        /*
         * The form's own email check finds an address anywhere in the text;
         * the server wants the whole answer to be one, so "Ada
         * <ada@example.com>" is refused here, in the submitter's language.
         */
        if (
          question.type === PublicFormFieldType.Email &&
          value.trim().length > 0 &&
          !isWholeEmailAddress(value)
        ) {
          return translateValidationMessage("Email is not valid.");
        }

        return null;
      };

      return field;
    },
  );
};

export type GetPublicFormInitialValuesFunction = (
  form: PublicForm,
) => JSONObject;

/*
 * What the form starts with: the option a question chooses to begin with
 * (the form's own severity), and nothing else.
 */
export const getPublicFormInitialValues: GetPublicFormInitialValuesFunction = (
  form: PublicForm,
): JSONObject => {
  const values: JSONObject = {};

  for (const question of form.fields || []) {
    if (question.defaultValue) {
      values[getPublicFormFieldKey(question.id)] = question.defaultValue;
    }
  }

  return values;
};

type ReadChoiceFunction = (value: unknown) => string;

// A choice can be held as the option it was picked as, or its value.
const readChoice: ReadChoiceFunction = (value: unknown): string => {
  const picked: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)["value"]
      : value;

  if (typeof picked === "string") {
    return picked.trim();
  }

  if (typeof picked === "number" && Number.isFinite(picked)) {
    return String(picked);
  }

  return "";
};

export type PackPublicFormAnswersFunction = (data: {
  form: PublicForm;
  // Everything the page's form submitted, keyed as getPublicFormFieldKey.
  values: JSONObject;
}) => JSONObject;

/**
 * The answers the submit request sends, keyed by question id: only the
 * questions the form asks, each as the server reads it (a choice as its
 * value, a multi-select as a list of values, a checkbox as true or false).
 * An answer left empty is left out. The server cleans every answer again.
 */
export const packPublicFormAnswers: PackPublicFormAnswersFunction = (data: {
  form: PublicForm;
  values: JSONObject;
}): JSONObject => {
  const answers: JSONObject = {};
  const values: JSONObject = data.values || {};

  for (const question of data.form.fields || []) {
    const raw: unknown = values[getPublicFormFieldKey(question.id)];
    let answer: JSONValue | undefined = undefined;

    switch (question.type) {
      case PublicFormFieldType.Boolean:
        if (raw === true || raw === "true") {
          answer = true;
        } else if (raw === false || raw === "false") {
          answer = false;
        }
        break;

      case PublicFormFieldType.Dropdown: {
        const choice: string = readChoice(raw);

        if (choice) {
          answer = choice;
        }
        break;
      }

      case PublicFormFieldType.MultiSelectDropdown: {
        const entries: Array<unknown> = Array.isArray(raw)
          ? raw
          : raw === undefined || raw === null || raw === ""
            ? []
            : [raw];

        const choices: Array<string> = [];

        for (const entry of entries) {
          const choice: string = readChoice(entry);

          if (choice && !choices.includes(choice)) {
            choices.push(choice);
          }
        }

        if (choices.length > 0) {
          answer = choices;
        }
        break;
      }

      case PublicFormFieldType.Number:
        if (typeof raw === "number" && Number.isFinite(raw)) {
          answer = raw;
        } else if (typeof raw === "string" && raw.trim()) {
          answer = raw.trim();
        }
        break;

      default:
        if (raw instanceof Date && !isNaN(raw.getTime())) {
          answer = raw.toISOString();
        } else if (typeof raw === "string" && raw.trim()) {
          answer = raw;
        }
        break;
    }

    if (answer !== undefined) {
      Object.defineProperty(answers, question.id, {
        value: answer,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }

  return answers;
};
