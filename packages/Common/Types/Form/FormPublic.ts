import Color from "../Color";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "../CustomField/CustomFieldDropdownOption";
import CustomFieldType from "../CustomField/CustomFieldType";
import { isCustomFieldValueEmpty } from "../CustomField/CustomFieldValueMapping";
import {
  CustomFieldValueValidationError,
  validateCustomFieldValues,
} from "../CustomField/CustomFieldValueValidator";
import Email from "../Email";
import { JSONObject, JSONValue } from "../JSON";
import { getPublicFormBranding, PublicFormImage } from "./FormBranding";
import ObjectID from "../ObjectID";
import {
  FORM_CHOICE_QUESTION_TYPES,
  FORM_QUESTION_TYPES,
  FORM_SUBMITTER_EMAIL_MAX_LENGTH,
  FORM_SUBMITTER_NAME_MAX_LENGTH,
  FORM_TEXT_ANSWER_MAX_LENGTH,
  FormField,
  FormFieldSource,
  FormSubmitterField,
  readFormFields,
} from "./FormField";
import {
  FormTargetFieldDefinition,
  FormTargetOptionsSource,
  getFormTargetField,
} from "./FormTargetCatalog";
import FormTargetType, { FORM_TARGET_TYPE_TEXT } from "./FormTargetType";
import {
  describeFormTemplate,
  findFormTemplate,
  FormQuestionAsked,
  FormTemplate,
  FormTemplateFieldSetting,
  FormTemplateFieldSettings,
  getFormQuestionAsked,
  getFormTemplateFieldSetting,
  isFormTemplateId,
  readFormTemplates,
} from "./FormTemplate";

/*
 * The public half of forms: what the page anyone with a form's link opens is
 * told about the form, what it sends back, and the one set of rules a
 * submission is held to.
 *
 * A form is filled in by people with no OneUptime account, so nothing on the
 * way in is trusted. The server builds what a submission creates only from
 * what validateFormSubmission hands back - a value assembled question by
 * question from the answers to the questions the form actually asks.
 * Anything else in the request (a projectId, a state, an answer to a
 * question the form does not ask) never reaches it. Every text is trimmed
 * and capped so it fits the column it lands in, a choice is one of the
 * choices offered, and a number, a date or a yes/no is checked as an API
 * write of that custom field type would be.
 *
 * buildPublicForm turns a stored form into what the page is told, and is
 * also what the dashboard's preview draws, so the preview is the page. A
 * hidden question is built with the rest - the server answers it - but
 * never told to the page unless one of the form's templates asks it; nor is
 * any template's answer to a question that template does not ask.
 *
 * A form's templates (FormTemplate) reach the page as how each asks the
 * page's questions (Required, Optional, Hidden: its fieldSettings) and its
 * answers to the questions it asks, each checked as a submission's answer to
 * that question would be (getFormTemplateAnswers), so a template never fills
 * in what the submit would refuse. Which questions a submission is asked,
 * and which it must answer, follow the template it starts from
 * (getPublicFormForTemplate) - on the page, in the preview and in the
 * server's check of the submission alike.
 *
 * Pure, with no database or React imports: the server enforces these rules,
 * and the public page can show the same limits before anything is sent.
 */

/*
 * How a question is answered on the public page. The values are the custom
 * field types', plus Email for the submitter's address, so each one is also
 * the form library's own field type of the same name.
 */
export enum PublicFormFieldType {
  Text = "Text",
  LongText = "LongText",
  Markdown = "Markdown",
  Number = "Number",
  Boolean = "Boolean",
  Date = "Date",
  DateTime = "DateTime",
  Dropdown = "Dropdown",
  MultiSelectDropdown = "MultiSelectDropdown",
  Email = "Email",
}

const PUBLIC_FORM_FIELD_TYPES: ReadonlyArray<string> =
  Object.values(PublicFormFieldType);

// The text types: their answers are capped in length.
export const PUBLIC_FORM_TEXT_FIELD_TYPES: ReadonlyArray<PublicFormFieldType> =
  [
    PublicFormFieldType.Text,
    PublicFormFieldType.LongText,
    PublicFormFieldType.Markdown,
    PublicFormFieldType.Email,
  ];

// Of those, the ones answered on several lines, which are cleaned as such.
export const PUBLIC_FORM_MULTI_LINE_FIELD_TYPES: ReadonlyArray<PublicFormFieldType> =
  [PublicFormFieldType.LongText, PublicFormFieldType.Markdown];

/*
 * The most entries a multi-select answer may have: this many, or the
 * question's number of options when it has more. The page sends each option
 * at most once, so a real answer never comes near it; what it bounds is a
 * request that sends a million entries, each of which would otherwise be
 * cleaned, compared and quoted back in the refusal.
 */
export const FORM_MULTI_SELECT_MAX_CHOICES: number = 100;

/*
 * A header the public page's own script adds to every request it makes, and
 * the value it gives it. Reading a form needs it: another site's page can
 * have a visitor's browser send that GET - an <img>, a link, a no-cors
 * fetch - carrying neither of the headers that say where a request came
 * from (over plain HTTP a browser sends neither on such a request), but it
 * cannot add a header of its own to one. A request that adds one is
 * preflighted first, and then carries the Origin that gives it away
 * (SameOriginRequest). The name is in lower case, as the server reads
 * header names.
 */
export const FORM_PAGE_HEADER: string = "x-oneuptime-form";
export const FORM_PAGE_HEADER_VALUE: string = "1";

// One option of a choice question.
export interface PublicFormFieldOption {
  /*
   * What the answer sends: the option's text for a question of the form's
   * own or a custom field, a record's id for a choice of records.
   */
  value: string;
  label: string;
  // A hex color, for options that have one (severities, labels, options).
  color?: string | undefined;
}

/*
 * One question as the public page renders it. Only what the page needs to
 * draw the input: never where the answer goes, a custom field's id or key,
 * or records the form does not offer.
 */
export interface PublicFormField {
  id: string;
  label: string;
  helpText?: string | undefined;
  type: PublicFormFieldType;
  isRequired: boolean;
  // Dropdown and MultiSelectDropdown only, in the order to list them.
  options?: Array<PublicFormFieldOption> | undefined;
  // The longest text answer it takes.
  maxLength?: number | undefined;
  // An option to choose to begin with: the form's own severity.
  defaultValue?: string | undefined;
  /*
   * The form hides it: it is asked only when the form is filled in from a
   * template that asks it (see getPublicFormForTemplate). A question the form
   * hides and no template asks is never told to the page.
   */
  isHidden?: boolean | undefined;
}

/*
 * A template as the public page is told about it: its name, whether the
 * form opens with it, how it asks the page's questions where it asks them
 * otherwise than the form (fieldSettings, by question id), and its answers
 * to the questions it asks - never to a question it does not ask, never one
 * the question would refuse. Answers are keyed by question id, in the shape
 * a submission sends them.
 */
export interface PublicFormTemplate {
  id: string;
  name: string;
  isDefault?: boolean | undefined;
  answers: JSONObject;
  // Left out for a template that asks every question as the form does.
  fieldSettings?: FormTemplateFieldSettings | undefined;
}

// Everything the public page is told about a form.
export interface PublicForm {
  name: string;
  // Shown at the top of the page, as Markdown.
  description?: string | undefined;
  /*
   * The questions, in the order to ask them: every question the form asks,
   * and every one it hides that a template asks (isHidden). Which of them
   * are asked, and required, follows the template the form is filled in
   * from: getPublicFormForTemplate.
   */
  fields: Array<PublicFormField>;
  isCaptchaRequired: boolean;
  /*
   * The form's branding (FormBranding), each only when the form has it: its
   * logo, shown in place of the OneUptime logo, the logo's alt text, and the
   * browser tab's icon.
   */
  logo?: PublicFormImage | undefined;
  logoAltText?: string | undefined;
  favicon?: PublicFormImage | undefined;
  /*
   * The templates a submission can start from, in the form's order; left
   * out for a form with none.
   */
  templates?: Array<PublicFormTemplate> | undefined;
}

/*
 * The answers, as the public page sends them: keyed by question id. And the
 * template the submitter started from, if any: the server answers the
 * form's hidden questions from it.
 */
export interface PublicFormSubmissionData {
  answers?: JSONObject | undefined;
  templateId?: string | undefined;
}

// The body of the submit request.
export interface PublicFormSubmissionRequest {
  data: PublicFormSubmissionData;
  captchaToken?: string | undefined;
}

// What the submitter is shown once the submission is made.
export interface PublicFormSubmissionResult {
  /*
   * The number of what the submission created, as the project shows it -
   * "INC-42", "#7" - for the submitter to quote.
   */
  reference?: string | undefined;
  // The form's thank-you text, as Markdown.
  successMessage?: string | undefined;
}

/*
 * The answers that passed, keyed by question id, each as it may be stored:
 * text cleaned, a yes/no a boolean, a choice the option's own value, a
 * multi-select a list of them. A question left unanswered is left out.
 */
export type ValidatedFormAnswers = JSONObject;

export type FormSubmissionValidationResult =
  | {
      isValid: false;
      errors: Array<string>;
    }
  | {
      isValid: true;
      answers: ValidatedFormAnswers;
    };

/*
 * One of the target's custom fields, as the server or the dashboard read it
 * from the project, for the questions linked to it.
 */
export interface FormCustomFieldDefinition {
  id: string;
  name: string;
  description?: string | null | undefined;
  customFieldType?: string | null | undefined;
  dropdownOptions?: string | null | undefined;
  /*
   * The dashboard's only, and never part of the public form: the field
   * copies its value from the monitors of what is created
   * (CustomFieldMappingService), and that value then replaces the answer.
   */
  isCopiedFromMonitor?: boolean | undefined;
}

// One of the project's records a choice question can offer.
export interface FormRecordOption {
  id: string;
  name: string;
  color?: string | undefined;
}

/*
 * Where a question's answer goes, for the server once the answers are
 * checked. Never sent to the public page.
 */
export type FormFieldBinding =
  | {
      source: FormFieldSource.Question;
      label: string;
      type: CustomFieldType;
    }
  | {
      source: FormFieldSource.TargetField;
      label: string;
      definition: FormTargetFieldDefinition;
    }
  | {
      source: FormFieldSource.TargetCustomField;
      label: string;
      customFieldId: string;
      customFieldName: string;
      customFieldType: CustomFieldType;
    }
  | {
      source: FormFieldSource.Submitter;
      label: string;
      submitterField: FormSubmitterField;
    };

export interface BuiltPublicForm {
  form: PublicForm;
  /*
   * The questions the form hides, in the form's order (isHidden): built as
   * the page's are, and told to it only when a template asks them. The form
   * itself never requires one.
   */
  hiddenFields: Array<PublicFormField>;
  // Every question the form can answer - asked or hidden - in its order.
  allFields: Array<PublicFormField>;
  /*
   * The questions the form's target cannot be created without (a
   * maintenance event's start and end): asked, and required, whatever a
   * template says. Never told to the page.
   */
  lockedFieldIds: Array<string>;
  // Where each question's answer goes, by question id.
  bindings: Record<string, FormFieldBinding>;
  /*
   * Questions the page does not ask, and why: a custom field that was
   * deleted, a choice whose records are all gone. The dashboard warns about
   * them; the page just leaves them out.
   */
  skipped: Array<{ fieldId: string; reason: FormSkippedFieldReason }>;
}

export enum FormSkippedFieldReason {
  // A question that is not stored as one this version can ask.
  Unreadable = "Unreadable",
  // Linked to a field the form's target does not have.
  UnknownTargetField = "UnknownTargetField",
  // Linked to a custom field that no longer exists.
  CustomFieldDeleted = "CustomFieldDeleted",
  // A choice with nothing left to choose from.
  NoOptions = "NoOptions",
}

export interface PublicFormSource {
  name?: string | null | undefined;
  description?: string | null | undefined;
  // The stored questions (Form.fields), read here with readFormFields.
  fields?: unknown;
  targetType: FormTargetType;
  /*
   * The form's branding as stored, when it was read: its logo and favicon
   * Files ({ file, fileType }) and the logo's alt text. Only what the page
   * may draw is passed on (getPublicFormBranding).
   */
  logoFile?: unknown;
  logoAltText?: string | null | undefined;
  faviconFile?: unknown;
  // The stored templates (Form.templates), read here with readFormTemplates.
  templates?: unknown;
}

export type BuildPublicFormFunction = (data: {
  form: PublicFormSource;
  // The target's custom fields in the project, those deleted since left out.
  customFields: Array<FormCustomFieldDefinition>;
  /*
   * The project's records each choice question may offer, by source. Only
   * the ones a question offers are listed on the page, in this order.
   */
  recordOptions: Partial<
    Record<FormTargetOptionsSource, Array<FormRecordOption>>
  >;
  // The option to choose to begin with, by target field key.
  defaultOptionValues?: Partial<Record<string, string>> | undefined;
  isCaptchaRequired: boolean;
}) => BuiltPublicForm;

const KNOWN_CUSTOM_FIELD_TYPES: ReadonlyArray<string> =
  Object.values(CustomFieldType);

type ToPublicTypeFunction = (type: CustomFieldType) => PublicFormFieldType;

// A custom field type as the page asks it: the values are shared.
const toPublicType: ToPublicTypeFunction = (
  type: CustomFieldType,
): PublicFormFieldType => {
  return PUBLIC_FORM_FIELD_TYPES.includes(type)
    ? (type as string as PublicFormFieldType)
    : PublicFormFieldType.Text;
};

type ReadCustomFieldTypeFunction = (value: unknown) => CustomFieldType;

/*
 * A custom field with no type - rows from before types were required - or a
 * type this version does not know is asked and checked as Text: text is
 * what an untyped field has always held.
 */
const readCustomFieldType: ReadCustomFieldTypeFunction = (
  value: unknown,
): CustomFieldType => {
  return typeof value === "string" && KNOWN_CUSTOM_FIELD_TYPES.includes(value)
    ? (value as CustomFieldType)
    : CustomFieldType.Text;
};

type ToOptionsFunction = (serialized: unknown) => Array<PublicFormFieldOption>;

// A dropdown's options in the custom fields' serialized format.
const toTextOptions: ToOptionsFunction = (
  serialized: unknown,
): Array<PublicFormFieldOption> => {
  const options: Array<PublicFormFieldOption> = [];
  const seen: Set<string> = new Set<string>();

  for (const option of parseCustomFieldDropdownOptions(serialized)) {
    if (seen.has(option.value)) {
      continue;
    }

    seen.add(option.value);

    const entry: PublicFormFieldOption = {
      value: option.value,
      label: option.value,
    };

    if ((option as CustomFieldDropdownOption).color) {
      entry.color = (option as CustomFieldDropdownOption).color;
    }

    options.push(entry);
  }

  return options;
};

type ReadColorFunction = (value: unknown) => string | undefined;

const readColor: ReadColorFunction = (value: unknown): string | undefined => {
  if (value instanceof Color) {
    return value.toString();
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return undefined;
};

type ToRecordOptionsFunction = (data: {
  records: Array<FormRecordOption>;
  allowedIds: Array<string> | undefined;
  mustChoose: boolean;
}) => Array<PublicFormFieldOption>;

/*
 * The records a choice question offers: the allowed ones in the project's
 * own order, or - for a question that may offer every record (severities)
 * and names none - all of them. A record named but since deleted is simply
 * not there to offer.
 */
const toRecordOptions: ToRecordOptionsFunction = (data: {
  records: Array<FormRecordOption>;
  allowedIds: Array<string> | undefined;
  mustChoose: boolean;
}): Array<PublicFormFieldOption> => {
  const allowed: Set<string> = new Set<string>(
    (data.allowedIds || []).map((id: string): string => {
      return id.toLowerCase();
    }),
  );

  if (allowed.size === 0 && data.mustChoose) {
    return [];
  }

  const options: Array<PublicFormFieldOption> = [];
  const seen: Set<string> = new Set<string>();

  for (const record of data.records || []) {
    const id: string =
      record && typeof record.id === "string" ? record.id.toLowerCase() : "";

    if (!ObjectID.isValidUUID(id) || seen.has(id)) {
      continue;
    }

    if (allowed.size > 0 && !allowed.has(id)) {
      continue;
    }

    seen.add(id);

    const option: PublicFormFieldOption = {
      value: id,
      label: typeof record.name === "string" ? record.name : "",
    };

    const color: string | undefined = readColor(record.color);

    if (color) {
      option.color = color;
    }

    options.push(option);
  }

  return options;
};

type ReadHelpTextFunction = (value: unknown) => string | undefined;

const readHelpText: ReadHelpTextFunction = (
  value: unknown,
): string | undefined => {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

/**
 * What the public page is told about a form, built question by question so
 * that nothing else about the form - its target, its settings, its link
 * key, its allowlist, its project - is ever sent, together with where each
 * question's answer goes (for the server) and the questions it could not
 * ask (for the dashboard's warnings).
 *
 * A question is left out when it cannot be answered: linked to a custom
 * field that was deleted or a field the target does not have, or a choice
 * with no option left. Its answers would have nowhere to go, or nothing to
 * be, and a page must not ask what it cannot take.
 *
 * A hidden question is built like any other, into hiddenFields, and into
 * the page's questions only when one of the form's templates asks it. The
 * form's templates are told to the page with how each asks the page's
 * questions, and with their answers to the questions each asks
 * (getFormTemplateAnswers) - never a template's answer to a question it
 * hides, nor a setting for a question the target cannot do without.
 */
export const buildPublicForm: BuildPublicFormFunction = (data: {
  form: PublicFormSource;
  customFields: Array<FormCustomFieldDefinition>;
  recordOptions: Partial<
    Record<FormTargetOptionsSource, Array<FormRecordOption>>
  >;
  defaultOptionValues?: Partial<Record<string, string>> | undefined;
  isCaptchaRequired: boolean;
}): BuiltPublicForm => {
  const publicForm: PublicForm = {
    name: typeof data.form.name === "string" ? data.form.name : "",
    fields: [],
    isCaptchaRequired: data.isCaptchaRequired === true,
  };

  if (
    typeof data.form.description === "string" &&
    data.form.description.trim().length > 0
  ) {
    publicForm.description = data.form.description;
  }

  Object.assign(
    publicForm,
    getPublicFormBranding({
      logoFile: data.form.logoFile,
      logoAltText: data.form.logoAltText,
      faviconFile: data.form.faviconFile,
    }),
  );

  const bindings: Record<string, FormFieldBinding> = {};
  const skipped: Array<{ fieldId: string; reason: FormSkippedFieldReason }> =
    [];
  const hiddenFields: Array<PublicFormField> = [];
  const allFields: Array<PublicFormField> = [];
  const lockedFieldIds: Array<string> = [];

  const customFieldsById: Map<string, FormCustomFieldDefinition> = new Map<
    string,
    FormCustomFieldDefinition
  >();

  for (const definition of data.customFields || []) {
    if (
      definition &&
      typeof definition.id === "string" &&
      typeof definition.name === "string" &&
      definition.name.length > 0
    ) {
      customFieldsById.set(definition.id.toLowerCase(), definition);
    }
  }

  const fields: Array<FormField> = readFormFields(data.form.fields);

  if (Array.isArray(data.form.fields)) {
    for (const entry of data.form.fields) {
      const id: unknown =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)["id"]
          : undefined;

      if (
        typeof id === "string" &&
        !fields.some((field: FormField): boolean => {
          return field.id === id;
        })
      ) {
        skipped.push({
          fieldId: id,
          reason: FormSkippedFieldReason.Unreadable,
        });
      }
    }
  }

  /*
   * Two custom fields of one project cannot share a name, but a deleted
   * field's name can come back; answers are stored on the record by name,
   * so a name is asked once.
   */
  const askedCustomFieldNames: Set<string> = new Set<string>();

  for (const field of fields) {
    const base: PublicFormField = {
      id: field.id,
      label: field.label,
      type: PublicFormFieldType.Text,
      isRequired: field.isRequired,
    };

    const helpText: string | undefined = readHelpText(field.helpText);

    if (helpText) {
      base.helpText = helpText;
    }

    switch (field.source) {
      case FormFieldSource.Question: {
        const type: CustomFieldType =
          field.type && FORM_QUESTION_TYPES.includes(field.type)
            ? field.type
            : CustomFieldType.Text;

        base.type = toPublicType(type);

        if (FORM_CHOICE_QUESTION_TYPES.includes(type)) {
          base.options = toTextOptions(field.dropdownOptions);

          if (base.options.length === 0) {
            skipped.push({
              fieldId: field.id,
              reason: FormSkippedFieldReason.NoOptions,
            });
            continue;
          }
        } else if (PUBLIC_FORM_TEXT_FIELD_TYPES.includes(base.type)) {
          base.maxLength = FORM_TEXT_ANSWER_MAX_LENGTH;
        }

        bindings[field.id] = {
          source: FormFieldSource.Question,
          label: field.label,
          type: type,
        };
        break;
      }

      case FormFieldSource.TargetField: {
        const definition: FormTargetFieldDefinition | undefined =
          getFormTargetField(data.form.targetType, field.targetField);

        if (!definition) {
          skipped.push({
            fieldId: field.id,
            reason: FormSkippedFieldReason.UnknownTargetField,
          });
          continue;
        }

        base.type = toPublicType(definition.inputType);

        if (definition.optionsSource) {
          base.options = toRecordOptions({
            records: data.recordOptions[definition.optionsSource] || [],
            allowedIds: field.allowedOptionIds,
            mustChoose: definition.mustChooseOptions === true,
          });

          if (base.options.length === 0) {
            skipped.push({
              fieldId: field.id,
              reason: FormSkippedFieldReason.NoOptions,
            });
            continue;
          }

          const defaultValue: string | undefined = (data.defaultOptionValues ||
            {})[definition.key];

          if (
            defaultValue &&
            base.type === PublicFormFieldType.Dropdown &&
            base.options.some((option: PublicFormFieldOption): boolean => {
              return option.value === defaultValue.toLowerCase();
            })
          ) {
            base.defaultValue = defaultValue.toLowerCase();
          }
        } else if (definition.maxLength) {
          base.maxLength = definition.maxLength;
        }

        bindings[field.id] = {
          source: FormFieldSource.TargetField,
          label: field.label,
          definition: definition,
        };

        if (definition.isRequiredByTarget && !definition.hasDefault) {
          lockedFieldIds.push(field.id);
        }
        break;
      }

      case FormFieldSource.TargetCustomField: {
        const definition: FormCustomFieldDefinition | undefined =
          field.customFieldId
            ? customFieldsById.get(field.customFieldId)
            : undefined;

        if (!definition || askedCustomFieldNames.has(definition.name)) {
          skipped.push({
            fieldId: field.id,
            reason: FormSkippedFieldReason.CustomFieldDeleted,
          });
          continue;
        }

        const type: CustomFieldType = readCustomFieldType(
          definition.customFieldType,
        );

        base.type = toPublicType(type);

        if (FORM_CHOICE_QUESTION_TYPES.includes(type)) {
          base.options = toTextOptions(definition.dropdownOptions);

          if (base.options.length === 0) {
            skipped.push({
              fieldId: field.id,
              reason: FormSkippedFieldReason.NoOptions,
            });
            continue;
          }
        } else if (PUBLIC_FORM_TEXT_FIELD_TYPES.includes(base.type)) {
          base.maxLength = FORM_TEXT_ANSWER_MAX_LENGTH;
        }

        askedCustomFieldNames.add(definition.name);

        bindings[field.id] = {
          source: FormFieldSource.TargetCustomField,
          label: field.label,
          customFieldId: definition.id.toLowerCase(),
          customFieldName: definition.name,
          customFieldType: type,
        };
        break;
      }

      case FormFieldSource.Submitter: {
        const submitterField: FormSubmitterField =
          field.submitterField || FormSubmitterField.Name;

        if (submitterField === FormSubmitterField.Email) {
          base.type = PublicFormFieldType.Email;
          base.maxLength = FORM_SUBMITTER_EMAIL_MAX_LENGTH;
        } else {
          base.type = PublicFormFieldType.Text;
          base.maxLength = FORM_SUBMITTER_NAME_MAX_LENGTH;
        }

        bindings[field.id] = {
          source: FormFieldSource.Submitter,
          label: field.label,
          submitterField: submitterField,
        };
        break;
      }

      default:
        continue;
    }

    allFields.push(base);

    if (field.isHidden) {
      /*
       * The form does not ask it, so the form never requires it: only a
       * template that asks it can.
       */
      base.isRequired = false;
      base.isHidden = true;
      hiddenFields.push(base);
    }
  }

  const templates: Array<FormTemplate> = readFormTemplates(data.form.templates);
  const locked: Set<string> = new Set<string>(lockedFieldIds);

  /*
   * How each template asks the questions the form can answer: a setting for
   * a question the form does not have, or cannot ask now, is not one, and
   * nor is a setting for a question the target cannot do without.
   */
  const settingsOf: Map<string, FormTemplateFieldSettings> = new Map<
    string,
    FormTemplateFieldSettings
  >();
  const askedByATemplate: Set<string> = new Set<string>();

  for (const template of templates) {
    const settings: FormTemplateFieldSettings = {};

    for (const field of allFields) {
      const setting: FormTemplateFieldSetting | undefined =
        getFormTemplateFieldSetting(template, field.id);

      if (!setting || locked.has(field.id)) {
        continue;
      }

      defineSetting(settings, field.id, setting);

      if (setting !== FormTemplateFieldSetting.Hidden) {
        askedByATemplate.add(field.id);
      }
    }

    settingsOf.set(template.id, settings);
  }

  // Every question the form asks, and every one it hides that a template asks.
  publicForm.fields = allFields.filter((field: PublicFormField): boolean => {
    return !field.isHidden || askedByATemplate.has(field.id);
  });

  const pageFieldIds: Set<string> = new Set<string>(
    publicForm.fields.map((field: PublicFormField): string => {
      return field.id;
    }),
  );

  if (templates.length > 0) {
    publicForm.templates = templates.map(
      (template: FormTemplate): PublicFormTemplate => {
        const publicTemplate: PublicFormTemplate = {
          id: template.id,
          name: template.name,
          answers: {},
        };

        const settings: FormTemplateFieldSettings =
          settingsOf.get(template.id) || {};
        const told: FormTemplateFieldSettings = {};

        for (const fieldId of Object.keys(settings)) {
          if (pageFieldIds.has(fieldId)) {
            defineSetting(told, fieldId, settings[fieldId]!);
          }
        }

        if (Object.keys(told).length > 0) {
          publicTemplate.fieldSettings = told;
        }

        // Its answers to the questions it asks, and to no other.
        publicTemplate.answers = getFormTemplateAnswers({
          template: template,
          fields: getPublicFormForTemplate({
            form: publicForm,
            template: publicTemplate,
          }).fields,
        });

        if (template.isDefault) {
          publicTemplate.isDefault = true;
        }

        return publicTemplate;
      },
    );
  }

  return {
    form: publicForm,
    hiddenFields: hiddenFields,
    allFields: allFields,
    lockedFieldIds: lockedFieldIds,
    bindings: bindings,
    skipped: skipped,
  };
};

type DefineSettingFunction = (
  target: FormTemplateFieldSettings,
  key: string,
  setting: FormTemplateFieldSetting,
) => void;

/*
 * Defined, not assigned: a key such as "__proto__" would set the object's
 * prototype instead of storing the setting.
 */
const defineSetting: DefineSettingFunction = (
  target: FormTemplateFieldSettings,
  key: string,
  setting: FormTemplateFieldSetting,
): void => {
  Object.defineProperty(target, key, {
    value: setting,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

export type GetPublicFormForTemplateFunction = (data: {
  form: PublicForm;
  // The template the form is filled in from; none for the form's own.
  template?:
    | { fieldSettings?: FormTemplateFieldSettings | null | undefined }
    | null
    | undefined;
}) => PublicForm;

/**
 * The form as it is asked when it is filled in from this template - or from
 * none: its questions narrowed to the ones that are asked, each required as
 * the template, or else the form, says (getFormQuestionAsked). A question
 * the form hides is asked only when the template asks it; one the template
 * hides is left out. The page draws these questions, the dashboard's preview
 * draws them, and the server holds a submission to them - so a template that
 * makes a question required is required everywhere at once.
 */
export const getPublicFormForTemplate: GetPublicFormForTemplateFunction =
  (data: {
    form: PublicForm;
    template?:
      | { fieldSettings?: FormTemplateFieldSettings | null | undefined }
      | null
      | undefined;
  }): PublicForm => {
    const fields: Array<PublicFormField> = [];

    for (const field of data.form.fields || []) {
      const asked: FormQuestionAsked = getFormQuestionAsked({
        isRequired: field.isRequired === true,
        isHidden: field.isHidden === true,
        setting: getFormTemplateFieldSetting(data.template, field.id),
      });

      if (!asked.isAsked) {
        continue;
      }

      const askedField: PublicFormField = {
        ...field,
        isRequired: asked.isRequired,
      };

      delete askedField.isHidden;
      fields.push(askedField);
    }

    return { ...data.form, fields: fields };
  };

/*
 * The message templates, worded as the form's own client-side checks word
 * them (Forms/Validation), so an answer refused by the server reads like
 * one refused in the browser. "{{field}}" is the question's label.
 */
const REQUIRED_MESSAGE: string = "{{field}} is required.";
const TOO_LONG_MESSAGE: string =
  "{{field}} cannot be more than {{maxLength}} characters.";
const MUST_BE_CHECKED_MESSAGE: string = "{{field}} must be checked.";
const TOO_MANY_CHOICES_MESSAGE: string =
  "{{field}} cannot have more than {{maxLength}} choices.";
const NOT_A_LIST_MESSAGE: string = "{{field}} takes one answer, not a list.";
const NESTED_CHOICE_MESSAGE: string =
  "{{field}} takes a list of its options, not lists or objects within it.";
const OBJECT_ANSWER_MESSAGE: string =
  "{{field}} takes one answer, not an object.";
const OBJECT_CHOICES_MESSAGE: string =
  "{{field}} takes a list of its options, not an object.";
const NOT_AN_OPTION_MESSAGE: string =
  "{{field}} must be one of the options the form lists.";
const NOT_OPTIONS_MESSAGE: string =
  "{{field}} must be chosen from the options the form lists.";
const NOT_TEXT_MESSAGE: string = "{{field}} must be text.";
const NOT_YES_NO_MESSAGE: string = "{{field}} must be checked or unchecked.";
const NOT_AN_EMAIL_MESSAGE: string = "{{field}} is not a valid email address.";

type FillMessageFunction = (
  template: string,
  values: { field: string; maxLength?: number },
) => string;

/*
 * Replacer functions, not replacement strings: a question named "Cost ($)"
 * or "$& total" must come out as typed, and a replacement string would read
 * its "$" patterns.
 */
const fillMessage: FillMessageFunction = (
  template: string,
  values: { field: string; maxLength?: number },
): string => {
  return template
    .replace("{{field}}", (): string => {
      return values.field;
    })
    .replace("{{maxLength}}", (): string => {
      return String(values.maxLength ?? "");
    });
};

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

type HasOwnFunction = (target: Record<string, unknown>, key: string) => boolean;

const hasOwn: HasOwnFunction = (
  target: Record<string, unknown>,
  key: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(target, key);
};

type IsSameJsonFunction = (first: unknown, second: unknown) => boolean;

/*
 * Whether two answers, as stored, are the same: text, numbers, yes/no and
 * lists of those (readFormTemplates reads nothing deeper), compared as JSON.
 */
const isSameJson: IsSameJsonFunction = (
  first: unknown,
  second: unknown,
): boolean => {
  return JSON.stringify(first) === JSON.stringify(second);
};

/*
 * Postgres cannot store a NUL character in a text column, nor in a jsonb
 * string, so one pasted into an answer would fail the insert - after the
 * checks here had passed. Nobody means to type one. no-control-regex is
 * disabled for these two on purpose: matching control characters is exactly
 * what they are for.
 */
// eslint-disable-next-line no-control-regex
const NUL_CHARACTERS: RegExp = /\u0000/g;

// Control characters, line breaks and tabs included.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_RUNS: RegExp = /[\u0000-\u001F\u007F]+/g;

const SPACE_RUNS: RegExp = / {2,}/g;

const LEADING_BLANK_LINES: RegExp = /^\s*\n/;

type CleanTextFunction = (value: string) => string;

/*
 * A one-line answer (a short answer, a title, a name): line breaks, tabs and
 * other control characters become spaces - a title is shown on one line in
 * lists, emails and chat messages - runs of spaces become one, and the ends
 * are trimmed.
 */
export const cleanSingleLineAnswer: CleanTextFunction = (
  value: string,
): string => {
  return value
    .replace(CONTROL_CHARACTER_RUNS, " ")
    .replace(SPACE_RUNS, " ")
    .trim();
};

/*
 * A Markdown or multi-line answer. Blank lines before the text and
 * whitespace after it are dropped, but the first line keeps its own
 * indentation: four spaces there start a code block, and trimming them would
 * turn a pasted log into a paragraph.
 */
export const cleanMultiLineAnswer: CleanTextFunction = (
  value: string,
): string => {
  return value
    .replace(NUL_CHARACTERS, "")
    .replace(LEADING_BLANK_LINES, "")
    .trimEnd();
};

// A choice, a number, a date or an address typed as text.
export const cleanScalarAnswer: CleanTextFunction = (value: string): string => {
  return value.replace(NUL_CHARACTERS, "").trim();
};

/*
 * Email alone finds an address anywhere in a text - "Jane <jane@x.test>"
 * passes it - so the whole answer must also be one ordinary address: the
 * dot-atom half of Email's own pattern, anchored at both ends.
 */
export const WHOLE_EMAIL_ADDRESS: RegExp =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

type CleanAnswerFunction = (field: PublicFormField, value: unknown) => unknown;

/*
 * An answer as it is checked and stored: text cleaned as its question shows
 * it, "true" / "false" as the booleans a checkbox stores, and a multi-select
 * as a list with each entry once. Anything else is left for the checks to
 * judge.
 */
const cleanAnswer: CleanAnswerFunction = (
  field: PublicFormField,
  value: unknown,
): unknown => {
  if (typeof value === "string") {
    switch (field.type) {
      case PublicFormFieldType.Text:
        return cleanSingleLineAnswer(value);

      case PublicFormFieldType.LongText:
      case PublicFormFieldType.Markdown:
        return cleanMultiLineAnswer(value);

      case PublicFormFieldType.Boolean: {
        const text: string = cleanScalarAnswer(value);

        if (text === "true") {
          return true;
        }

        if (text === "false") {
          return false;
        }

        return text;
      }

      case PublicFormFieldType.MultiSelectDropdown: {
        const text: string = cleanScalarAnswer(value);

        return text.length > 0 ? [text] : [];
      }

      default:
        return cleanScalarAnswer(value);
    }
  }

  if (
    Array.isArray(value) &&
    field.type === PublicFormFieldType.MultiSelectDropdown
  ) {
    const entries: Array<unknown> = [];
    const seen: Set<string> = new Set<string>();

    for (const entry of value) {
      const cleaned: unknown =
        typeof entry === "string" ? cleanScalarAnswer(entry) : entry;

      if (cleaned === "") {
        continue;
      }

      const key: string = `${typeof cleaned}:${String(cleaned)}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      entries.push(cleaned);
    }

    return entries;
  }

  return value;
};

type FindOptionFunction = (
  field: PublicFormField,
  value: unknown,
) => PublicFormFieldOption | undefined;

/*
 * The option an answer chose: the one whose value it is, as text, or - for
 * a choice of records, whose values are ids - the one whose id it is in
 * any case.
 */
const findOption: FindOptionFunction = (
  field: PublicFormField,
  value: unknown,
): PublicFormFieldOption | undefined => {
  if (
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isFinite(value))
  ) {
    return undefined;
  }

  const text: string = String(value);
  const options: Array<PublicFormFieldOption> = field.options || [];

  const exact: PublicFormFieldOption | undefined = options.find(
    (option: PublicFormFieldOption): boolean => {
      return option.value === text;
    },
  );

  if (exact || !ObjectID.isValidUUID(text.toLowerCase())) {
    return exact;
  }

  return options.find((option: PublicFormFieldOption): boolean => {
    return option.value === text.toLowerCase();
  });
};

type GetMaxChoicesFunction = (field: PublicFormField) => number;

// See FORM_MULTI_SELECT_MAX_CHOICES.
const getMaxChoices: GetMaxChoicesFunction = (
  field: PublicFormField,
): number => {
  return Math.max(FORM_MULTI_SELECT_MAX_CHOICES, (field.options || []).length);
};

type DefineAnswerFunction = (
  target: JSONObject,
  key: string,
  value: JSONValue,
) => void;

/*
 * Defined, not assigned: a key such as "__proto__" would set the object's
 * prototype instead of storing the answer. (Question ids cannot be such a
 * key - FORM_FIELD_ID_PATTERN - but the answers object is a stranger's.)
 */
const defineAnswer: DefineAnswerFunction = (
  target: JSONObject,
  key: string,
  value: JSONValue,
): void => {
  Object.defineProperty(target, key, {
    value: value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

type ValidateOneAnswerFunction = (data: {
  field: PublicFormField;
  answer: unknown;
  errors: Array<string>;
}) => JSONValue | undefined;

/*
 * One question's answer: undefined when it is unanswered or refused (the
 * problem recorded), otherwise the value to store.
 */
const validateOneAnswer: ValidateOneAnswerFunction = (data: {
  field: PublicFormField;
  answer: unknown;
  errors: Array<string>;
}): JSONValue | undefined => {
  const field: PublicFormField = data.field;
  const label: string = field.label;

  /*
   * An answer is one value - text, a number, a yes/no - or, for a
   * multi-select, a list of them; nothing the page sends is an object. So an
   * object is refused here, unread: checking it would turn all of it into
   * text before refusing it, and the request may carry millions of keys or a
   * nesting millions deep.
   */
  if (
    data.answer !== null &&
    typeof data.answer === "object" &&
    !Array.isArray(data.answer)
  ) {
    data.errors.push(
      fillMessage(
        field.type === PublicFormFieldType.MultiSelectDropdown
          ? OBJECT_CHOICES_MESSAGE
          : OBJECT_ANSWER_MESSAGE,
        { field: label },
      ),
    );
    return undefined;
  }

  /*
   * A list is bounded before anything reads its entries: cleaning,
   * de-duplicating and checking them all cost as much as the list is long.
   * Only a multi-select takes a list at all, and only as many entries as it
   * could have choices.
   */
  if (Array.isArray(data.answer) && data.answer.length > 0) {
    if (field.type !== PublicFormFieldType.MultiSelectDropdown) {
      data.errors.push(fillMessage(NOT_A_LIST_MESSAGE, { field: label }));
      return undefined;
    }

    const maxChoices: number = getMaxChoices(field);

    if (data.answer.length > maxChoices) {
      data.errors.push(
        fillMessage(TOO_MANY_CHOICES_MESSAGE, {
          field: label,
          maxLength: maxChoices,
        }),
      );
      return undefined;
    }

    /*
     * Each choice is one option, so a list or an object inside the list is
     * refused here, unread: turning a list nested thousands deep into text
     * overflows the stack - a refusal must never become a thrown error.
     */
    if (
      data.answer.some((entry: unknown): boolean => {
        return entry !== null && typeof entry === "object";
      })
    ) {
      data.errors.push(fillMessage(NESTED_CHOICE_MESSAGE, { field: label }));
      return undefined;
    }
  }

  const value: unknown = cleanAnswer(field, data.answer);

  if (isCustomFieldValueEmpty(value)) {
    if (field.isRequired) {
      data.errors.push(
        fillMessage(
          field.type === PublicFormFieldType.Boolean
            ? MUST_BE_CHECKED_MESSAGE
            : REQUIRED_MESSAGE,
          { field: label },
        ),
      );
    }

    return undefined;
  }

  switch (field.type) {
    case PublicFormFieldType.Text:
    case PublicFormFieldType.LongText:
    case PublicFormFieldType.Markdown:
    case PublicFormFieldType.Email: {
      if (typeof value !== "string") {
        data.errors.push(fillMessage(NOT_TEXT_MESSAGE, { field: label }));
        return undefined;
      }

      const maxLength: number = field.maxLength || FORM_TEXT_ANSWER_MAX_LENGTH;

      if (value.length > maxLength) {
        data.errors.push(
          fillMessage(TOO_LONG_MESSAGE, { field: label, maxLength: maxLength }),
        );
        return undefined;
      }

      if (field.type === PublicFormFieldType.Email) {
        if (!WHOLE_EMAIL_ADDRESS.test(value) || !Email.isValid(value)) {
          data.errors.push(fillMessage(NOT_AN_EMAIL_MESSAGE, { field: label }));
          return undefined;
        }

        // Lowercased, as Email stores it.
        return new Email(value).toString();
      }

      return value;
    }

    case PublicFormFieldType.Boolean: {
      if (typeof value !== "boolean") {
        data.errors.push(fillMessage(NOT_YES_NO_MESSAGE, { field: label }));
        return undefined;
      }

      /*
       * A required yes/no question is an acknowledgement: only a tick
       * answers it, as on the dashboard.
       */
      if (field.isRequired && value !== true) {
        data.errors.push(
          fillMessage(MUST_BE_CHECKED_MESSAGE, { field: label }),
        );
        return undefined;
      }

      return value;
    }

    case PublicFormFieldType.Dropdown: {
      const option: PublicFormFieldOption | undefined = findOption(
        field,
        value,
      );

      if (!option) {
        data.errors.push(fillMessage(NOT_AN_OPTION_MESSAGE, { field: label }));
        return undefined;
      }

      return option.value;
    }

    case PublicFormFieldType.MultiSelectDropdown: {
      const entries: Array<unknown> = Array.isArray(value) ? value : [value];
      const chosen: Array<string> = [];

      for (const entry of entries) {
        const option: PublicFormFieldOption | undefined = findOption(
          field,
          entry,
        );

        if (!option) {
          data.errors.push(fillMessage(NOT_OPTIONS_MESSAGE, { field: label }));
          return undefined;
        }

        if (!chosen.includes(option.value)) {
          chosen.push(option.value);
        }
      }

      return chosen;
    }

    case PublicFormFieldType.Number:
    case PublicFormFieldType.Date:
    case PublicFormFieldType.DateTime: {
      const typeErrors: Array<CustomFieldValueValidationError> =
        validateCustomFieldValues({
          definitions: [
            {
              name: label,
              customFieldType: field.type as string as CustomFieldType,
            },
          ],
          customFields: { [label]: value },
          storedCustomFields: {},
        });

      if (typeErrors.length > 0) {
        data.errors.push(
          ...typeErrors.map(
            (error: CustomFieldValueValidationError): string => {
              return error.message;
            },
          ),
        );
        return undefined;
      }

      if (typeof value === "string" || typeof value === "number") {
        return value;
      }

      data.errors.push(fillMessage(NOT_TEXT_MESSAGE, { field: label }));
      return undefined;
    }

    default:
      return undefined;
  }
};

export type ValidateFormSubmissionFunction = (data: {
  // The questions the form asks: buildPublicForm's form.fields.
  fields: Array<PublicFormField>;
  // The `data` of the request body, unread so far.
  data: unknown;
}) => FormSubmissionValidationResult;

/**
 * Checks a submission against the questions its form asks and returns
 * either every problem with it, or the answers that may be stored. Never
 * throws on a parsed JSON body, whatever it holds.
 *
 * Only the questions the form asks are read, by id; an answer under any
 * other key is dropped unread. Each answer is cleaned as its question shows
 * it; a required question must be answered (a required checkbox ticked);
 * text is capped at the question's maxLength; an email must be one whole
 * address; a choice must be one of the options offered (a multi-select at
 * most as many as it could have, none of them a list or an object); a
 * number, date or date and time must be one. An object is never an answer.
 *
 * No check costs more for a larger body: text is measured, a list is
 * counted and an object refused before anything reads what they hold.
 */
export const validateFormSubmission: ValidateFormSubmissionFunction = (data: {
  fields: Array<PublicFormField>;
  data: unknown;
}): FormSubmissionValidationResult => {
  if (!isPlainObject(data.data)) {
    return {
      isValid: false,
      errors: ["The submission must be an object holding the form's answers."],
    };
  }

  const rawAnswers: unknown = data.data["answers"];
  let answers: Record<string, unknown> = {};
  const errors: Array<string> = [];

  if (isPlainObject(rawAnswers)) {
    answers = rawAnswers;
  } else if (rawAnswers !== undefined && rawAnswers !== null) {
    errors.push("The answers must be an object keyed by question.");
  }

  const accepted: ValidatedFormAnswers = {};

  for (const field of data.fields || []) {
    const answer: unknown = hasOwn(answers, field.id)
      ? answers[field.id]
      : undefined;

    const value: JSONValue | undefined = validateOneAnswer({
      field: field,
      answer: answer,
      errors: errors,
    });

    if (value !== undefined) {
      defineAnswer(accepted, field.id, value);
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors: errors };
  }

  return { isValid: true, answers: accepted };
};

export type FormAnswerValidationResult =
  | {
      isValid: false;
      errors: Array<string>;
    }
  | {
      isValid: true;
      // Undefined for an answer left empty.
      value: JSONValue | undefined;
    };

export type ValidateFormAnswerFunction = (data: {
  field: PublicFormField;
  answer: unknown;
}) => FormAnswerValidationResult;

/**
 * One answer to one question, checked and cleaned exactly as a submission's
 * answer to it is (validateFormSubmission): the value to store, nothing for
 * an answer left empty, or why it is refused.
 */
export const validateFormAnswer: ValidateFormAnswerFunction = (data: {
  field: PublicFormField;
  answer: unknown;
}): FormAnswerValidationResult => {
  const errors: Array<string> = [];

  const value: JSONValue | undefined = validateOneAnswer({
    field: data.field,
    answer: data.answer,
    errors: errors,
  });

  if (errors.length > 0) {
    return { isValid: false, errors: errors };
  }

  return { isValid: true, value: value };
};

type AsOptionalFunction = (field: PublicFormField) => PublicFormField;

/*
 * A template need not answer every question: what it holds is checked as
 * an answer to the question, never against Required.
 */
const asOptional: AsOptionalFunction = (
  field: PublicFormField,
): PublicFormField => {
  return { ...field, isRequired: false };
};

export type GetFormTemplateAnswersFunction = (data: {
  template: { answers?: JSONObject | null | undefined } | null | undefined;
  // The questions to read the template's answers to.
  fields: Array<PublicFormField>;
}) => ValidatedFormAnswers;

/**
 * A template's answers to these questions, each checked and cleaned as a
 * submission's answer to it would be - but none required. An answer the
 * question would refuse (an option it no longer offers, a record since
 * deleted, text since made too long for it) is left out, as is an answer to
 * a question not listed. Never throws.
 */
export const getFormTemplateAnswers: GetFormTemplateAnswersFunction = (data: {
  template: { answers?: JSONObject | null | undefined } | null | undefined;
  fields: Array<PublicFormField>;
}): ValidatedFormAnswers => {
  const answers: ValidatedFormAnswers = {};
  const stored: unknown = data.template ? data.template.answers : undefined;

  if (!isPlainObject(stored)) {
    return answers;
  }

  for (const field of data.fields || []) {
    if (!hasOwn(stored, field.id)) {
      continue;
    }

    const result: FormAnswerValidationResult = validateFormAnswer({
      field: asOptional(field),
      answer: stored[field.id],
    });

    if (result.isValid && result.value !== undefined) {
      defineAnswer(answers, field.id, result.value);
    }
  }

  return answers;
};

// The most problems one refusal of a form's templates lists.
const MAX_LISTED_TEMPLATE_PROBLEMS: number = 8;

export type ValidateFormTemplateAnswersFunction = (data: {
  // The templates as they would be stored (Form.templates).
  templates: unknown;
  // Every question the form can answer, hidden ones too: allFields.
  fields: Array<PublicFormField>;
  /*
   * The questions the form's target cannot be created without
   * (BuiltPublicForm.lockedFieldIds): no template may make one optional, or
   * hide it.
   */
  lockedFieldIds?: Array<string> | undefined;
  // What the form creates, named in that refusal.
  targetType?: FormTargetType | undefined;
  /*
   * The templates the form holds now, for a write that changes them: an
   * answer or a setting a template already held, unchanged, is not judged
   * again.
   */
  heldTemplates?: unknown;
}) => string | null;

/**
 * Null when every answer every template holds suits its question, checked
 * as getFormTemplateAnswers reads it, and every question a template asks its
 * own way is one it may; otherwise one message naming every problem (the
 * first eight). An answer to a question the form cannot answer - one it does
 * not have, or one it cannot ask now (its custom field was deleted) - is
 * refused, and so is an answer its question would refuse; so is a setting
 * for a question the form cannot answer, and one that makes a question the
 * target cannot do without optional or hidden. The server runs this on every
 * write of a form's templates, so a template never quietly fills in less, or
 * asks otherwise, than it was saved with.
 *
 * Every change saves the whole list, so on a write that changes a form's
 * templates, what a template already held (heldTemplates: same template,
 * same question, same answer or setting) is not judged again: a question
 * removed or changed since must not keep an admin from saving another
 * template, or moving one. Such an answer or setting is never used
 * (getFormTemplateAnswers, buildPublicForm), and the next save of its own
 * template through the editor drops it.
 */
export const validateFormTemplateAnswers: ValidateFormTemplateAnswersFunction =
  (data: {
    templates: unknown;
    fields: Array<PublicFormField>;
    lockedFieldIds?: Array<string> | undefined;
    targetType?: FormTargetType | undefined;
    heldTemplates?: unknown;
  }): string | null => {
    const problems: Array<string> = [];
    const fieldsById: Map<string, PublicFormField> = new Map<
      string,
      PublicFormField
    >();
    const locked: Set<string> = new Set<string>(data.lockedFieldIds || []);
    const created: string = data.targetType
      ? FORM_TARGET_TYPE_TEXT[data.targetType].nounWithArticle
      : "the record the form creates";
    const held: Array<FormTemplate> = readFormTemplates(data.heldTemplates);

    for (const field of data.fields || []) {
      fieldsById.set(field.id, field);
    }

    readFormTemplates(data.templates).forEach(
      (template: FormTemplate, index: number): void => {
        const name: string = describeFormTemplate({
          index,
          name: template.name,
        });

        const heldTemplate: FormTemplate | undefined = findFormTemplate(
          held,
          template.id,
        );

        for (const key of Object.keys(template.answers)) {
          if (
            heldTemplate &&
            hasOwn(heldTemplate.answers, key) &&
            isSameJson(heldTemplate.answers[key], template.answers[key])
          ) {
            continue;
          }

          const field: PublicFormField | undefined = fieldsById.get(key);

          if (!field) {
            problems.push(
              `${name} answers a question the form does not ask (${key}).`,
            );
            continue;
          }

          const result: FormAnswerValidationResult = validateFormAnswer({
            field: asOptional(field),
            answer: template.answers[key],
          });

          if (!result.isValid) {
            problems.push(`${name}: ${result.errors.join(" ")}`);
          }
        }

        const settings: FormTemplateFieldSettings =
          template.fieldSettings || {};

        for (const key of Object.keys(settings)) {
          if (
            heldTemplate &&
            getFormTemplateFieldSetting(heldTemplate, key) === settings[key]
          ) {
            continue;
          }

          const field: PublicFormField | undefined = fieldsById.get(key);

          if (!field) {
            problems.push(
              `${name} has a setting for a question the form does not ask (${key}).`,
            );
            continue;
          }

          const setting: FormTemplateFieldSetting = settings[key]!;

          if (
            locked.has(key) &&
            setting !== FormTemplateFieldSetting.Required
          ) {
            problems.push(
              `${name}: ${field.label} cannot be ${
                setting === FormTemplateFieldSetting.Hidden
                  ? "hidden"
                  : "optional"
              }: ${created} cannot be created without it.`,
            );
          }
        }
      },
    );

    if (problems.length === 0) {
      return null;
    }

    const more: number = problems.length - MAX_LISTED_TEMPLATE_PROBLEMS;

    return `${problems.slice(0, MAX_LISTED_TEMPLATE_PROBLEMS).join(" ")}${
      more > 0
        ? ` And ${more} more ${more === 1 ? "problem" : "problems"}.`
        : ""
    }`;
  };

export type ReadFormSubmissionTemplateIdFunction = (
  data: unknown,
) => string | undefined;

/**
 * The template a submission says it started from (data.templateId), when it
 * names one in a template id's shape; anything else is no template.
 */
export const readFormSubmissionTemplateId: ReadFormSubmissionTemplateIdFunction =
  (data: unknown): string | undefined => {
    if (!isPlainObject(data)) {
      return undefined;
    }

    const templateId: unknown = data["templateId"];

    return isFormTemplateId(templateId) ? templateId : undefined;
  };

export type GetFormSubmissionTemplateFunction = (data: {
  // The form's stored templates (Form.templates).
  templates: unknown;
  // What the submission named: readFormSubmissionTemplateId.
  templateId: string | undefined;
}) => FormTemplate | undefined;

/**
 * The template a submission's hidden questions are answered from: the one
 * it names, while the form has it. A submission that names none started
 * from none - even on a form with a default, which only decides what the
 * page opens with - and one that names a template deleted since its page
 * was opened is taken as it was answered, without one.
 */
export const getFormSubmissionTemplate: GetFormSubmissionTemplateFunction =
  (data: {
    templates: unknown;
    templateId: string | undefined;
  }): FormTemplate | undefined => {
    if (!data.templateId) {
      return undefined;
    }

    return findFormTemplate(readFormTemplates(data.templates), data.templateId);
  };

export interface FormQuestionsForTemplate {
  /*
   * The questions the submission was asked, each required as the template
   * it started from (or the form) says: the request is read for these, and
   * for nothing else.
   */
  asked: Array<PublicFormField>;
  /*
   * Every other question the form can answer - the ones the form hides and
   * the template does not ask, and the ones the template hides: only the
   * template answers them.
   */
  answeredByTemplate: Array<PublicFormField>;
}

export type GetFormQuestionsForTemplateFunction = (data: {
  built: BuiltPublicForm;
  // The template the submission started from, while the form has it.
  templateId: string | null | undefined;
}) => FormQuestionsForTemplate;

/**
 * The questions of a submission that started from this template (or from
 * none), split the way the server reads them: the ones the page asked - as
 * the page itself worked them out, from what it was told
 * (getPublicFormForTemplate) - and the ones only the template answers.
 */
export const getFormQuestionsForTemplate: GetFormQuestionsForTemplateFunction =
  (data: {
    built: BuiltPublicForm;
    templateId: string | null | undefined;
  }): FormQuestionsForTemplate => {
    const asked: Array<PublicFormField> = getPublicFormForTemplate({
      form: data.built.form,
      template: findPublicFormTemplate(data.built.form, data.templateId),
    }).fields;

    const askedIds: Set<string> = new Set<string>(
      asked.map((field: PublicFormField): string => {
        return field.id;
      }),
    );

    return {
      asked: asked,
      answeredByTemplate: data.built.allFields.filter(
        (field: PublicFormField): boolean => {
          return !askedIds.has(field.id);
        },
      ),
    };
  };

export type FindPublicFormTemplateFunction = (
  form: PublicForm,
  templateId: string | null | undefined,
) => PublicFormTemplate | undefined;

// One of the templates the page was told about, by id.
export const findPublicFormTemplate: FindPublicFormTemplateFunction = (
  form: PublicForm,
  templateId: string | null | undefined,
): PublicFormTemplate | undefined => {
  if (!templateId) {
    return undefined;
  }

  return (form.templates || []).find(
    (template: PublicFormTemplate): boolean => {
      return template.id === templateId;
    },
  );
};

export type GetPublicFormStartTemplateFunction = (data: {
  form: PublicForm;
  // The template the page's link names (?template=<id>), if any.
  requestedTemplateId?: string | null | undefined;
}) => PublicFormTemplate | undefined;

/**
 * The template the public page opens with: the one its link names, while
 * the form has it; otherwise the form's default template; otherwise none -
 * a link naming a template since deleted opens the form as if it named
 * none.
 */
export const getPublicFormStartTemplate: GetPublicFormStartTemplateFunction =
  (data: {
    form: PublicForm;
    requestedTemplateId?: string | null | undefined;
  }): PublicFormTemplate | undefined => {
    return (
      findPublicFormTemplate(data.form, data.requestedTemplateId) ||
      (data.form.templates || []).find(
        (template: PublicFormTemplate): boolean => {
          return template.isDefault === true;
        },
      )
    );
  };

export type FormatFormSubmissionErrorsFunction = (
  errors: Array<string>,
) => string;

/** Every problem as one message, for an API error response. */
export const formatFormSubmissionErrors: FormatFormSubmissionErrorsFunction = (
  errors: Array<string>,
): string => {
  return errors.join(" ");
};

export type IsBlankFormAnswerFunction = (
  value: string,
  isMultiLine: boolean,
) => boolean;

/**
 * Whether the server finds nothing in a text answer once it has cleaned it,
 * and so refuses it for a required question: a one-line answer with its
 * control characters read as spaces, a multi-line one with its NUL
 * characters dropped - then, either way, trimmed.
 *
 * The form's own required check passes an answer of nothing but spaces, so
 * the page asks this too: the refusal then comes from the browser, in the
 * submitter's language, before a captcha answer is spent on it.
 */
export const isBlankFormAnswer: IsBlankFormAnswerFunction = (
  value: string,
  isMultiLine: boolean,
): boolean => {
  return isMultiLine
    ? cleanMultiLineAnswer(value).trim().length === 0
    : cleanSingleLineAnswer(value).length === 0;
};

export type IsWholeEmailAddressFunction = (value: string) => boolean;

/**
 * Whether the server takes an answer to an email question as an address:
 * cleaned as it cleans it, the whole answer must be one ordinary address.
 */
export const isWholeEmailAddress: IsWholeEmailAddressFunction = (
  value: string,
): boolean => {
  const address: string = cleanScalarAnswer(value);

  return WHOLE_EMAIL_ADDRESS.test(address) && Email.isValid(address);
};
