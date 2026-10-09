import {
  BuiltPublicForm,
  getFormTemplateAnswers,
  PublicFormField,
} from "Common/Types/Form/FormPublic";
import {
  FORM_TEMPLATE_FIELD_SETTINGS,
  FORM_TEMPLATE_NAME_MAX_LENGTH,
  FormQuestionAsked,
  FormTemplate,
  FormTemplateFieldSetting,
  FormTemplateFieldSettings,
  generateFormTemplateId,
  getFormQuestionAsked,
  getFormTemplateFieldSetting,
  getFormTemplateLink,
  isFormTemplateFieldSetting,
} from "Common/Types/Form/FormTemplate";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  getPublicFormValuesFromAnswers,
  packPublicFormAnswers,
} from "Common/UI/Components/PublicForm/PublicFormFields";
import { getFormShareLink } from "../FormShareLink";
import FormsCopy from "../FormsCopy";

/*
 * Everything the Templates page does with a template apart from drawing it:
 * the questions its editor asks, how the template asks each of them, what
 * the editor starts with, the template the editor's values make, what the
 * list says a template fills in and changes, a copy as it is saved, and the
 * link that opens the form with one. Pure and React-free, so the page's
 * rules are tested on their own; the list operations themselves (add,
 * duplicate, move, delete, default) are FormTemplate's.
 *
 * The editor is the form itself, in two parts. Questions: how the template
 * asks each question - as the form does, or Required, Optional or Hidden
 * (FormTemplate.fieldSettings) - one row per question. Answers: every
 * question the form can answer, hidden ones too, drawn by the builder the
 * public page draws its questions with (buildPublicFormFields), none of them
 * required - a template answers what it likes. Its answers are packed
 * exactly as a submission's are (packPublicFormAnswers), so the server reads
 * a template's answers as it reads a submission's.
 */

// Where the editor holds the template's name, Default and settings.
export const TEMPLATE_NAME_KEY: string = "templateName";
export const TEMPLATE_DEFAULT_KEY: string = "templateIsDefault";
export const TEMPLATE_FIELD_SETTINGS_KEY: string = "templateFieldSettings";

/*
 * The editor's choice for a question the template asks as the form does:
 * no setting at all. Never stored.
 */
export const FORM_DEFAULT_CHOICE: string = "FormDefault";

export interface FormTemplateEditorQuestion {
  // As the editor's Answers ask it: never required.
  field: PublicFormField;
  // How the form asks it: hidden, required (never both).
  isHidden: boolean;
  isRequired: boolean;
  /*
   * The form's target cannot be created without it: every template asks
   * it, required, and none may say otherwise.
   */
  isLocked: boolean;
}

export type GetFormTemplateEditorQuestionsFunction = (
  built: BuiltPublicForm,
) => Array<FormTemplateEditorQuestion>;

/**
 * The questions a template can answer and ask its own way, in the form's
 * order: every question the form can answer, hidden ones too, each with how
 * the form asks it. As the editor asks them, none is required.
 */
export const getFormTemplateEditorQuestions: GetFormTemplateEditorQuestionsFunction =
  (built: BuiltPublicForm): Array<FormTemplateEditorQuestion> => {
    const hiddenIds: Set<string> = new Set<string>(
      built.hiddenFields.map((field: PublicFormField): string => {
        return field.id;
      }),
    );
    const lockedIds: Set<string> = new Set<string>(built.lockedFieldIds || []);

    return built.allFields.map(
      (field: PublicFormField): FormTemplateEditorQuestion => {
        const isHidden: boolean = hiddenIds.has(field.id);
        const editorField: PublicFormField = { ...field, isRequired: false };

        delete editorField.isHidden;

        return {
          field: editorField,
          isHidden: isHidden,
          isRequired: !isHidden && field.isRequired === true,
          isLocked: lockedIds.has(field.id),
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

export type GetFormTemplateEditorSettingsFunction = (data: {
  // Stored settings, or the editor's value: anything.
  settings: unknown;
  questions: Array<FormTemplateEditorQuestion>;
}) => FormTemplateFieldSettings;

/**
 * The settings a template can keep: one per question the editor asks, in
 * the form's order, for every question but the ones the target cannot do
 * without - a setting for a question since removed, or that is not a
 * setting, is left out, so saving the template drops it.
 */
export const getFormTemplateEditorSettings: GetFormTemplateEditorSettingsFunction =
  (data: {
    settings: unknown;
    questions: Array<FormTemplateEditorQuestion>;
  }): FormTemplateFieldSettings => {
    const kept: FormTemplateFieldSettings = {};

    if (
      !data.settings ||
      typeof data.settings !== "object" ||
      Array.isArray(data.settings)
    ) {
      return kept;
    }

    const stored: FormTemplateFieldSettings =
      data.settings as FormTemplateFieldSettings;

    for (const question of data.questions) {
      const setting: FormTemplateFieldSetting | undefined =
        getFormTemplateFieldSetting(
          { fieldSettings: stored },
          question.field.id,
        );

      if (!setting || question.isLocked) {
        continue;
      }

      Object.defineProperty(kept, question.field.id, {
        value: setting,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    return kept;
  };

export type GetFormTemplateEditorValuesFunction = (data: {
  // The template being edited; undefined for a new one.
  template: FormTemplate | undefined;
  questions: Array<FormTemplateEditorQuestion>;
}) => JSONObject;

/**
 * What the editor starts with: the template's name, Default and settings,
 * and its answers that still suit their questions - an answer to a question
 * since removed, or one its question would now refuse, is left out, and so
 * is a setting for a question since removed, so saving the template drops
 * them.
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
      [TEMPLATE_FIELD_SETTINGS_KEY]: getFormTemplateEditorSettings({
        settings: data.template?.fieldSettings,
        questions: data.questions,
      }) as unknown as JSONObject,
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
 * Default when it is ticked, how it asks each question it asks its own way
 * (none when it asks every question as the form does), and an answer for
 * every question the editor was given an answer to - packed as a
 * submission's answers are.
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

    const fieldSettings: FormTemplateFieldSettings =
      getFormTemplateEditorSettings({
        settings: data.values[TEMPLATE_FIELD_SETTINGS_KEY],
        questions: data.questions,
      });

    if (Object.keys(fieldSettings).length > 0) {
      template.fieldSettings = fieldSettings;
    }

    const isDefault: unknown = data.values[TEMPLATE_DEFAULT_KEY];

    if (isDefault === true || isDefault === "true") {
      template.isDefault = true;
    }

    return template;
  };

export type GetFormTemplateQuestionAskedFunction = (data: {
  question: FormTemplateEditorQuestion;
  // The template's settings: stored, or the editor's value.
  settings: unknown;
}) => FormQuestionAsked;

/**
 * How a question is asked when someone starts from the template: the
 * template's setting, or the form's own (getFormQuestionAsked).
 */
export const getFormTemplateQuestionAsked: GetFormTemplateQuestionAskedFunction =
  (data: {
    question: FormTemplateEditorQuestion;
    settings: unknown;
  }): FormQuestionAsked => {
    const settings: FormTemplateFieldSettings | undefined =
      data.settings &&
      typeof data.settings === "object" &&
      !Array.isArray(data.settings)
        ? (data.settings as FormTemplateFieldSettings)
        : undefined;

    return getFormQuestionAsked({
      isRequired: data.question.isRequired,
      isHidden: data.question.isHidden,
      isLocked: data.question.isLocked,
      setting: getFormTemplateFieldSetting(
        { fieldSettings: settings },
        data.question.field.id,
      ),
    });
  };

export interface FormTemplateSettingChoice {
  // FORM_DEFAULT_CHOICE, or a setting.
  value: string;
  // English: the dashboard translates it where it is drawn.
  label: string;
}

export type GetFormTemplateSettingChoicesFunction = (
  question: FormTemplateEditorQuestion,
) => Array<FormTemplateSettingChoice>;

/**
 * What a question's row offers: the form's own setting first, saying what
 * it is - "Form default (Hidden)" - then Required, Optional and Hidden.
 */
export const getFormTemplateSettingChoices: GetFormTemplateSettingChoicesFunction =
  (question: FormTemplateEditorQuestion): Array<FormTemplateSettingChoice> => {
    let defaultLabel: string = FormsCopy.settingFormDefaultOptional;

    if (question.isHidden) {
      defaultLabel = FormsCopy.settingFormDefaultHidden;
    } else if (question.isRequired || question.isLocked) {
      defaultLabel = FormsCopy.settingFormDefaultRequired;
    }

    return [
      { value: FORM_DEFAULT_CHOICE, label: defaultLabel },
      ...FORM_TEMPLATE_FIELD_SETTINGS.map(
        (setting: FormTemplateFieldSetting): FormTemplateSettingChoice => {
          return {
            value: setting,
            label: FORM_TEMPLATE_FIELD_SETTING_TEXT[setting],
          };
        },
      ),
    ];
  };

// How each setting is named, in the editor and on the list.
export const FORM_TEMPLATE_FIELD_SETTING_TEXT: Record<
  FormTemplateFieldSetting,
  string
> = {
  [FormTemplateFieldSetting.Required]: FormsCopy.settingRequired,
  [FormTemplateFieldSetting.Optional]: FormsCopy.settingOptional,
  [FormTemplateFieldSetting.Hidden]: FormsCopy.settingHidden,
};

export type SetFormTemplateSettingFunction = (data: {
  settings: unknown;
  fieldId: string;
  // FORM_DEFAULT_CHOICE, or a setting: what the row's picker chose.
  choice: string;
}) => FormTemplateFieldSettings;

/**
 * The editor's settings once one row's picker has chosen: the question's
 * setting replaced, or - for the form's default - taken out. The other
 * questions keep theirs.
 */
export const setFormTemplateSetting: SetFormTemplateSettingFunction = (data: {
  settings: unknown;
  fieldId: string;
  choice: string;
}): FormTemplateFieldSettings => {
  const next: FormTemplateFieldSettings = {};
  const current: Record<string, unknown> =
    data.settings &&
    typeof data.settings === "object" &&
    !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};

  for (const key of Object.keys(current)) {
    const setting: unknown = current[key];

    if (key === data.fieldId || !isFormTemplateFieldSetting(setting)) {
      continue;
    }

    Object.defineProperty(next, key, {
      value: setting,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  if (isFormTemplateFieldSetting(data.choice)) {
    Object.defineProperty(next, data.fieldId, {
      value: data.choice,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return next;
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

export interface FormTemplateSettingSummary {
  fieldId: string;
  label: string;
  setting: FormTemplateFieldSetting;
}

export type GetFormTemplateSettingSummaryFunction = (data: {
  template: FormTemplate;
  questions: Array<FormTemplateEditorQuestion>;
}) => Array<FormTemplateSettingSummary>;

/**
 * The questions a template asks its own way, with how, in the form's order:
 * only settings it can keep (getFormTemplateEditorSettings) - none for a
 * question since removed.
 */
export const getFormTemplateSettingSummary: GetFormTemplateSettingSummaryFunction =
  (data: {
    template: FormTemplate;
    questions: Array<FormTemplateEditorQuestion>;
  }): Array<FormTemplateSettingSummary> => {
    const settings: FormTemplateFieldSettings = getFormTemplateEditorSettings({
      settings: data.template.fieldSettings,
      questions: data.questions,
    });

    const summary: Array<FormTemplateSettingSummary> = [];

    for (const question of data.questions) {
      const setting: FormTemplateFieldSetting | undefined =
        getFormTemplateFieldSetting(
          { fieldSettings: settings },
          question.field.id,
        );

      if (setting) {
        summary.push({
          fieldId: question.field.id,
          label: question.field.label,
          setting: setting,
        });
      }
    }

    return summary;
  };

export type FitFormTemplateToQuestionsFunction = (data: {
  template: FormTemplate;
  questions: Array<FormTemplateEditorQuestion>;
}) => FormTemplate;

/**
 * A template with only what it can still use, as the editor would save it:
 * its answers that suit their questions, cleaned as the page offers them
 * (getFormTemplateAnswers), and its settings for questions the form asks
 * (getFormTemplateEditorSettings). For a copy (Duplicate): the server judges
 * a new template whole, so a copy must not carry over an answer to a
 * question removed since its original was saved.
 */
export const fitFormTemplateToQuestions: FitFormTemplateToQuestionsFunction =
  (data: {
    template: FormTemplate;
    questions: Array<FormTemplateEditorQuestion>;
  }): FormTemplate => {
    const fitted: FormTemplate = {
      ...data.template,
      answers: getFormTemplateAnswers({
        template: data.template,
        fields: fieldsOf(data.questions),
      }),
    };

    const settings: FormTemplateFieldSettings = getFormTemplateEditorSettings({
      settings: data.template.fieldSettings,
      questions: data.questions,
    });

    if (Object.keys(settings).length > 0) {
      fitted.fieldSettings = settings;
    } else {
      delete fitted.fieldSettings;
    }

    return fitted;
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
