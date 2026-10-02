import { JSONObject, JSONValue } from "../JSON";
import {
  PublicFormField,
  PublicFormFieldOption,
  PublicFormFieldType,
  ValidatedFormAnswers,
} from "./FormPublic";

/*
 * One answer as a submission keeps it (FormSubmission.answers): the
 * question as it was worded when the form was submitted, the value that was
 * stored, and the value as a person reads it - the name of a chosen severity
 * rather than its id, "Yes" rather than true.
 *
 * Kept whole, so a submission still reads the way it was sent after the
 * form's questions are reworded, reordered or removed, and after a chosen
 * record is renamed or deleted.
 *
 * Pure, with no database or React imports.
 */
export interface FormSubmissionAnswer {
  fieldId: string;
  label: string;
  value: JSONValue;
  displayValue: string;
}

// What a submission's "Yes" and "No" read as.
export const FORM_ANSWER_YES: string = "Yes";
export const FORM_ANSWER_NO: string = "No";

type GetOptionLabelFunction = (
  field: PublicFormField,
  value: unknown,
) => string;

const getOptionLabel: GetOptionLabelFunction = (
  field: PublicFormField,
  value: unknown,
): string => {
  const option: PublicFormFieldOption | undefined = (field.options || []).find(
    (candidate: PublicFormFieldOption): boolean => {
      return candidate.value === value;
    },
  );

  return option ? option.label || option.value : String(value);
};

export type GetFormAnswerDisplayValueFunction = (
  field: PublicFormField,
  value: JSONValue,
) => string;

/** The value as a person reads it. */
export const getFormAnswerDisplayValue: GetFormAnswerDisplayValueFunction = (
  field: PublicFormField,
  value: JSONValue,
): string => {
  switch (field.type) {
    case PublicFormFieldType.Boolean:
      return value === true ? FORM_ANSWER_YES : FORM_ANSWER_NO;

    case PublicFormFieldType.Dropdown:
      return getOptionLabel(field, value);

    case PublicFormFieldType.MultiSelectDropdown:
      return (Array.isArray(value) ? value : [value])
        .map((entry: JSONValue): string => {
          return getOptionLabel(field, entry);
        })
        .join(", ");

    default:
      return value === null || value === undefined ? "" : String(value);
  }
};

export type GetFormSubmissionAnswersFunction = (data: {
  fields: Array<PublicFormField>;
  answers: ValidatedFormAnswers;
}) => Array<FormSubmissionAnswer>;

/**
 * The answers to keep with a submission, in the order the form asked its
 * questions: one entry per question answered, none for a question left
 * empty.
 */
export const getFormSubmissionAnswers: GetFormSubmissionAnswersFunction =
  (data: {
    fields: Array<PublicFormField>;
    answers: ValidatedFormAnswers;
  }): Array<FormSubmissionAnswer> => {
    const kept: Array<FormSubmissionAnswer> = [];

    for (const field of data.fields) {
      if (!Object.prototype.hasOwnProperty.call(data.answers, field.id)) {
        continue;
      }

      const value: JSONValue = data.answers[field.id] as JSONValue;

      kept.push({
        fieldId: field.id,
        label: field.label,
        value: value,
        displayValue: getFormAnswerDisplayValue(field, value),
      });
    }

    return kept;
  };

export type ReadFormSubmissionAnswersFunction = (
  value: unknown,
) => Array<FormSubmissionAnswer>;

/**
 * A submission's stored answers as the dashboard reads them: entries that
 * are not answers are dropped. Never throws.
 */
export const readFormSubmissionAnswers: ReadFormSubmissionAnswersFunction = (
  value: unknown,
): Array<FormSubmissionAnswer> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const answers: Array<FormSubmissionAnswer> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const row: JSONObject = entry as JSONObject;

    if (typeof row["fieldId"] !== "string") {
      continue;
    }

    const displayValue: unknown = row["displayValue"];
    const answerValue: JSONValue = (row["value"] ?? null) as JSONValue;

    answers.push({
      fieldId: row["fieldId"],
      label: typeof row["label"] === "string" ? row["label"] : "",
      value: answerValue,
      displayValue:
        typeof displayValue === "string"
          ? displayValue
          : answerValue === null
            ? ""
            : String(answerValue),
    });
  }

  return answers;
};
