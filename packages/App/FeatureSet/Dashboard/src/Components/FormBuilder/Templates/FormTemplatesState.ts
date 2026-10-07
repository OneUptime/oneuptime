import {
  BuiltPublicForm,
  getFormTemplateAnswers,
  PublicFormField,
} from "Common/Types/Form/FormPublic";
import {
  FORM_TEMPLATE_NAME_MAX_LENGTH,
  FormTemplate,
  generateFormTemplateId,
  getFormTemplateLink,
} from "Common/Types/Form/FormTemplate";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  getPublicFormValuesFromAnswers,
  packPublicFormAnswers,
} from "Common/UI/Components/PublicForm/PublicFormFields";
import { getFormShareLink } from "../FormShareLink";

/*
 * Everything the Templates page does with a template apart from drawing it:
 * the questions its editor asks, what the editor starts with, the template
 * the editor's answers make, what the list says a template fills in, and the
 * link that opens the form with it. Pure and React-free, so the page's rules
 * are tested on their own; the list operations themselves (add, duplicate,
 * move, delete, default) are FormTemplate's.
 *
 * The editor is the form itself: every question the form can answer, hidden
 * ones too, drawn by the builder the public page draws its questions with
 * (buildPublicFormFields), none of them required - a template answers what
 * it likes. Its answers are packed exactly as a submission's are
 * (packPublicFormAnswers), so the server reads a template's answers as it
 * reads a submission's.
 */

// Where the editor holds the template's name and Default, apart from answers.
export const TEMPLATE_NAME_KEY: string = "templateName";
export const TEMPLATE_DEFAULT_KEY: string = "templateIsDefault";

export interface FormTemplateEditorQuestion {
  // As the editor asks it: never required.
  field: PublicFormField;
  // Not on the public form: only templates answer it.
  isHidden: boolean;
}

export type GetFormTemplateEditorQuestionsFunction = (
  built: BuiltPublicForm,
) => Array<FormTemplateEditorQuestion>;

/**
 * The questions a template can answer, in the form's order: every question
 * the form can answer, hidden ones too, none required.
 */
export const getFormTemplateEditorQuestions: GetFormTemplateEditorQuestionsFunction =
  (built: BuiltPublicForm): Array<FormTemplateEditorQuestion> => {
    const hiddenIds: Set<string> = new Set<string>(
      built.hiddenFields.map((field: PublicFormField): string => {
        return field.id;
      }),
    );

    return built.allFields.map(
      (field: PublicFormField): FormTemplateEditorQuestion => {
        return {
          field: { ...field, isRequired: false },
          isHidden: hiddenIds.has(field.id),
        };
      },
    );
  };

type FieldsOfFunction = (
  questions: Array<FormTemplateEditorQuestion>,
) => Array<PublicFormField>;

const fieldsOf: FieldsOfFunction = (
  questions: Array<FormTemplateEditorQuestion>,
): Array<PublicFormField> => {
  return questions.map(
    (question: FormTemplateEditorQuestion): PublicFormField => {
      return question.field;
    },
  );
};

export type GetFormTemplateEditorValuesFunction = (data: {
  // The template being edited; undefined for a new one.
  template: FormTemplate | undefined;
  questions: Array<FormTemplateEditorQuestion>;
}) => JSONObject;

/**
 * What the editor starts with: the template's name and Default, and its
 * answers that still suit their questions - an answer to a question since
 * removed, or one its question would now refuse, is left out, so saving
 * the template drops it.
 */
export const getFormTemplateEditorValues: GetFormTemplateEditorValuesFunction =
  (data: {
    template: FormTemplate | undefined;
    questions: Array<FormTemplateEditorQuestion>;
  }): JSONObject => {
    const fields: Array<PublicFormField> = fieldsOf(data.questions);

    return {
      ...getPublicFormValuesFromAnswers({
        fields: fields,
        answers: getFormTemplateAnswers({
          template: data.template,
          fields: fields,
        }),
      }),
      [TEMPLATE_NAME_KEY]: data.template ? data.template.name : "",
      [TEMPLATE_DEFAULT_KEY]: data.template?.isDefault === true,
    };
  };

export type ReadFormTemplateFromEditorFunction = (data: {
  values: JSONObject;
  questions: Array<FormTemplateEditorQuestion>;
  // The template being edited, whose id the result keeps; undefined for new.
  template: FormTemplate | undefined;
}) => FormTemplate;

/**
 * The template the editor's values make: its name, trimmed and cut to fit,
 * Default when it is ticked, and an answer for every question the editor
 * was given an answer to - packed as a submission's answers are.
 */
export const readFormTemplateFromEditor: ReadFormTemplateFromEditorFunction =
  (data: {
    values: JSONObject;
    questions: Array<FormTemplateEditorQuestion>;
    template: FormTemplate | undefined;
  }): FormTemplate => {
    const name: unknown = data.values[TEMPLATE_NAME_KEY];

    const template: FormTemplate = {
      id: data.template ? data.template.id : generateFormTemplateId(),
      name:
        typeof name === "string"
          ? name.trim().slice(0, FORM_TEMPLATE_NAME_MAX_LENGTH)
          : "",
      answers: packPublicFormAnswers({
        form: {
          name: "",
          fields: fieldsOf(data.questions),
          isCaptchaRequired: false,
        },
        values: data.values,
      }),
    };

    const isDefault: unknown = data.values[TEMPLATE_DEFAULT_KEY];

    if (isDefault === true || isDefault === "true") {
      template.isDefault = true;
    }

    return template;
  };

export type GetFormTemplateAnsweredLabelsFunction = (data: {
  template: FormTemplate;
  questions: Array<FormTemplateEditorQuestion>;
}) => Array<string>;

/**
 * The questions a template fills in, by label, in the form's order: only
 * the answers that still suit their questions, as the public form reads it.
 */
export const getFormTemplateAnsweredLabels: GetFormTemplateAnsweredLabelsFunction =
  (data: {
    template: FormTemplate;
    questions: Array<FormTemplateEditorQuestion>;
  }): Array<string> => {
    const fields: Array<PublicFormField> = fieldsOf(data.questions);
    const answers: JSONObject = getFormTemplateAnswers({
      template: data.template,
      fields: fields,
    });

    return fields
      .filter((field: PublicFormField): boolean => {
        return Object.prototype.hasOwnProperty.call(answers, field.id);
      })
      .map((field: PublicFormField): string => {
        return field.label;
      });
  };

export type GetFormTemplateShareLinkFunction = (data: {
  shareKey: ObjectID | string;
  templateId: string;
}) => string;

// The link that opens the form with this template filled in.
export const getFormTemplateShareLink: GetFormTemplateShareLinkFunction =
  (data: { shareKey: ObjectID | string; templateId: string }): string => {
    return getFormTemplateLink({
      formLink: getFormShareLink(data.shareKey).toString(),
      templateId: data.templateId,
    });
  };
