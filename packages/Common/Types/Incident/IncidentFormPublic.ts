import { parseCustomFieldDropdownOptions } from "../CustomField/CustomFieldDropdownOption";
import CustomFieldType from "../CustomField/CustomFieldType";
import { isCustomFieldValueEmpty } from "../CustomField/CustomFieldValueMapping";
import {
  CustomFieldValueValidationError,
  validateCustomFieldValues,
} from "../CustomField/CustomFieldValueValidator";
import ColumnLength from "../Database/ColumnLength";
import Email from "../Email";
import { JSONObject, JSONValue } from "../JSON";

/*
 * The public half of incident forms: what the page anyone with a form's link
 * opens is told about the form, what it sends back, and the one set of rules
 * a submission is held to.
 *
 * A form is filled in by people with no OneUptime account, so nothing on the
 * way in is trusted. The server builds the incident only from what
 * validateIncidentFormSubmission hands back - a value assembled field by
 * field from the answers the form actually asks for. Anything else in the
 * request (a projectId, a state, isPrivate, an answer to a field the form
 * does not ask) never reaches it. Every text is trimmed and capped so it fits
 * the column it lands in, and every custom field answer is checked with the
 * same rules as an API write (validateCustomFieldValues) plus the form's own
 * Required.
 *
 * Pure, with no database or React imports: the server enforces these rules,
 * and the public page can show the same limits before anything is sent.
 */

/*
 * How the form treats one of its built-in questions. Only the description
 * has a setting today: Title is always asked and always required.
 */
export enum IncidentFormFieldSetting {
  Required = "Required",
  Optional = "Optional",
  Hidden = "Hidden",
}

// Every setting, in the order a picker lists them.
export const INCIDENT_FORM_FIELD_SETTINGS: ReadonlyArray<IncidentFormFieldSetting> =
  [
    IncidentFormFieldSetting.Required,
    IncidentFormFieldSetting.Optional,
    IncidentFormFieldSetting.Hidden,
  ];

// What a form asks for the description when nobody chose otherwise.
export const DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING: IncidentFormFieldSetting =
  IncidentFormFieldSetting.Optional;

export type IsIncidentFormFieldSettingFunction = (
  value: unknown,
) => value is IncidentFormFieldSetting;

/** Whether a value is one of the settings, spelled exactly as stored. */
export const isIncidentFormFieldSetting: IsIncidentFormFieldSettingFunction = (
  value: unknown,
): value is IncidentFormFieldSetting => {
  return (
    typeof value === "string" &&
    (INCIDENT_FORM_FIELD_SETTINGS as ReadonlyArray<string>).includes(value)
  );
};

/*
 * The longest answers a form takes. Each is at most the column the answer is
 * stored in, so a submission that passes here cannot then fail to save:
 *
 *   - the title becomes Incident.title, a varchar(500);
 *   - the description becomes Incident.description (text) - capped anyway,
 *     since the request body may be up to 50 MB and an incident description
 *     is read in emails, Slack and on status pages;
 *   - each custom field text answer is stored in Incident.customFields;
 *   - the reporter's name and email are stored on IncidentFormSubmission, in
 *     a varchar(100) each (an email longer than that is not one anybody can
 *     sign up to OneUptime with either).
 */
export const INCIDENT_FORM_TITLE_MAX_LENGTH: number = ColumnLength.LongText;
export const INCIDENT_FORM_DESCRIPTION_MAX_LENGTH: number = 20000;
export const INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH: number = 10000;
export const INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH: number =
  ColumnLength.ShortText;
export const INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH: number =
  ColumnLength.Email;

/*
 * The most entries a multi-select answer may have: this many, or the
 * field's number of options when it has more. The page sends each option
 * at most once, so a real answer never comes near it; what it bounds is a
 * request that sends a million entries, each of which would otherwise be
 * cleaned, sorted and quoted back in the refusal (or, for a field nobody
 * gave options to, stored on the incident).
 */
export const INCIDENT_FORM_MULTI_SELECT_MAX_CHOICES: number = 100;

/*
 * The titles of the built-in questions. The public page labels its fields
 * with them (through its locale files) and the server names them in its
 * error messages, so both say "Your Email is required." about the same box.
 */
export interface IncidentFormQuestionLabels {
  title: string;
  description: string;
  severity: string;
  reporterName: string;
  reporterEmail: string;
}

export const INCIDENT_FORM_QUESTION_LABELS: IncidentFormQuestionLabels = {
  title: "Title",
  description: "Description",
  severity: "Severity",
  reporterName: "Your Name",
  reporterEmail: "Your Email",
};

/*
 * The message templates, worded as the form's own client-side checks word
 * them (Forms/Validation and CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE), so an
 * answer refused by the server reads like one refused in the browser.
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

type FillMessageFunction = (
  template: string,
  values: { field: string; maxLength?: number },
) => string;

/*
 * Replacer functions, not replacement strings: a field named "Cost ($)" or
 * "$& total" must come out as typed, and a replacement string would read its
 * "$" patterns.
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

/*
 * One custom field the form asks for, as the public page renders it. Only
 * what the page needs to draw the input: never the field's id, its template
 * variable key, its project-wide switches or its mapping, and a dropdown's
 * options only for a dropdown.
 */
export interface PublicIncidentFormField {
  name: string;
  description?: string | undefined;
  customFieldType: CustomFieldType;
  dropdownOptions?: string | undefined;
  isRequired: boolean;
}

// A severity the reporter can pick, when the form lets them pick one.
export interface PublicIncidentFormSeverity {
  _id: string;
  name: string;
  color?: string | undefined;
}

// Everything the public page is told about a form.
export interface PublicIncidentForm {
  name: string;
  // Shown at the top of the page, as Markdown.
  description?: string | undefined;
  descriptionSetting: IncidentFormFieldSetting;
  isReporterDetailsRequired: boolean;
  // Only when the form lets the reporter choose the severity.
  severities?: Array<PublicIncidentFormSeverity> | undefined;
  // The form's own severity, to preselect in that list.
  defaultIncidentSeverityId?: string | undefined;
  // The custom fields the form asks for, in the order to show them.
  customFields: Array<PublicIncidentFormField>;
  isCaptchaRequired: boolean;
}

/*
 * The answers, as the public page sends them. Custom field answers are keyed
 * by the field's name, as PublicIncidentFormField names it.
 */
export interface PublicIncidentFormSubmissionData {
  title: string;
  description?: string | undefined;
  incidentSeverityId?: string | undefined;
  reporterName?: string | undefined;
  reporterEmail?: string | undefined;
  customFields?: JSONObject | undefined;
}

// The body of the submit request.
export interface PublicIncidentFormSubmissionRequest {
  data: PublicIncidentFormSubmissionData;
  captchaToken?: string | undefined;
}

// What the reporter is shown once the incident is declared.
export interface PublicIncidentFormSubmissionResult {
  // The incident's number as the project shows it, e.g. "INC-42" or "#42".
  incidentNumber?: string | undefined;
  // The form's thank-you text, as Markdown.
  successMessage?: string | undefined;
}

/*
 * The form's settings a submission is checked against. Every property is
 * optional so an IncidentForm read from the database can be passed as it is;
 * a setting that was not read falls back to the column's default, and the
 * two switches fall back to their stricter side.
 */
export interface IncidentFormSubmissionRules {
  descriptionSetting?: IncidentFormFieldSetting | string | null | undefined;
  isReporterDetailsRequired?: boolean | null | undefined;
  allowReporterToChooseSeverity?: boolean | null | undefined;
}

/*
 * A custom field the form asks for: one of getIncidentFormAskedDefinitions'
 * results, whose isRequiredOnCreate says whether the FORM requires it.
 * Loose enough that IncidentCustomField rows can be passed as they are.
 */
export interface IncidentFormAskedDefinition {
  name?: string | null | undefined;
  description?: string | null | undefined;
  customFieldType?: string | null | undefined;
  dropdownOptions?: string | null | undefined;
  isRequiredOnCreate?: boolean | null | undefined;
}

// A submission that passed: what the incident may be built from.
export interface ValidatedIncidentFormSubmission {
  title: string;
  // Only when the form asks for it and the reporter wrote something.
  description?: string | undefined;
  // Only when the form lets the reporter choose, and they chose.
  incidentSeverityId?: string | undefined;
  reporterName?: string | undefined;
  // Lowercased, as Email stores it.
  reporterEmail?: string | undefined;
  /*
   * The answers to the fields the form asks for, keyed by field name. An
   * answer left empty is left out, so a template's value for that field
   * still applies (see mergeTemplateCustomFields).
   */
  customFields: JSONObject;
}

export type IncidentFormSubmissionValidationResult =
  | {
      isValid: false;
      errors: Array<string>;
    }
  | {
      isValid: true;
      value: ValidatedIncidentFormSubmission;
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

type CleanTextFunction = (value: string) => string;

/*
 * A one-line answer (the title, the reporter's name): line breaks, tabs and
 * other control characters become spaces - a title is shown on one line in
 * lists, emails and chat messages - runs of spaces become one, and the ends
 * are trimmed.
 */
const cleanSingleLine: CleanTextFunction = (value: string): string => {
  return value
    .replace(CONTROL_CHARACTER_RUNS, " ")
    .replace(/ {2,}/g, " ")
    .trim();
};

/*
 * A Markdown or multi-line answer. Blank lines before the text and
 * whitespace after it are dropped, but the first line keeps its own
 * indentation: four spaces there start a code block, and trimming them would
 * turn the reporter's pasted log into a paragraph.
 */
const cleanMultiLine: CleanTextFunction = (value: string): string => {
  return value
    .replace(NUL_CHARACTERS, "")
    .replace(/^\s*\n/, "")
    .trimEnd();
};

// A dropdown option, a number or a date typed as text.
const cleanScalarText: CleanTextFunction = (value: string): string => {
  return value.replace(NUL_CHARACTERS, "").trim();
};

type NormalizedFieldFunction = (
  definition: IncidentFormAskedDefinition,
) => PublicIncidentFormField | null;

const KNOWN_CUSTOM_FIELD_TYPES: ReadonlyArray<string> =
  Object.values(CustomFieldType);

const DROPDOWN_TYPES: ReadonlyArray<CustomFieldType> = [
  CustomFieldType.Dropdown,
  CustomFieldType.MultiSelectDropdown,
];

/*
 * One asked definition as the public page sees it and as its answers are
 * checked. A field with no type - rows from before types were required - or
 * a type this version does not know is asked and checked as Text: the admin
 * put it on the form, and text is what an untyped field has always held.
 */
const toPublicField: NormalizedFieldFunction = (
  definition: IncidentFormAskedDefinition,
): PublicIncidentFormField | null => {
  if (
    !definition ||
    typeof definition.name !== "string" ||
    definition.name.length === 0
  ) {
    return null;
  }

  const customFieldType: CustomFieldType =
    typeof definition.customFieldType === "string" &&
    KNOWN_CUSTOM_FIELD_TYPES.includes(definition.customFieldType)
      ? (definition.customFieldType as CustomFieldType)
      : CustomFieldType.Text;

  const field: PublicIncidentFormField = {
    name: definition.name,
    customFieldType: customFieldType,
    isRequired: definition.isRequiredOnCreate === true,
  };

  if (
    typeof definition.description === "string" &&
    definition.description.trim().length > 0
  ) {
    field.description = definition.description;
  }

  if (
    DROPDOWN_TYPES.includes(customFieldType) &&
    typeof definition.dropdownOptions === "string" &&
    definition.dropdownOptions.trim().length > 0
  ) {
    field.dropdownOptions = definition.dropdownOptions;
  }

  return field;
};

export type GetPublicIncidentFormFieldsFunction = (
  askedDefinitions: Array<IncidentFormAskedDefinition>,
) => Array<PublicIncidentFormField>;

/**
 * The custom fields the public page shows, in the order given (pass the
 * result of getIncidentFormAskedDefinitions). A definition without a name is
 * left out, and so is a second one with a name already listed - answers are
 * keyed by name, so it could not be told apart.
 */
export const getPublicIncidentFormFields: GetPublicIncidentFormFieldsFunction =
  (
    askedDefinitions: Array<IncidentFormAskedDefinition>,
  ): Array<PublicIncidentFormField> => {
    const fields: Array<PublicIncidentFormField> = [];
    const seenNames: Set<string> = new Set<string>();

    for (const definition of askedDefinitions || []) {
      const field: PublicIncidentFormField | null = toPublicField(definition);

      if (!field || seenNames.has(field.name)) {
        continue;
      }

      seenNames.add(field.name);
      fields.push(field);
    }

    return fields;
  };

type ReadDescriptionSettingFunction = (
  value: unknown,
) => IncidentFormFieldSetting;

// A stored setting, or the column's default for anything else.
const readDescriptionSetting: ReadDescriptionSettingFunction = (
  value: unknown,
): IncidentFormFieldSetting => {
  return isIncidentFormFieldSetting(value)
    ? value
    : DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING;
};

/*
 * The form, as far as the public page is concerned. Loose for the same
 * reason as IncidentFormSubmissionRules: an IncidentForm row fits.
 */
export interface PublicIncidentFormSource extends IncidentFormSubmissionRules {
  name?: string | null | undefined;
  description?: string | null | undefined;
  incidentSeverityId?: { toString: () => string } | string | null | undefined;
}

export type GetPublicIncidentFormFunction = (data: {
  form: PublicIncidentFormSource;
  askedDefinitions: Array<IncidentFormAskedDefinition>;
  // The project's severities, in the order to list them.
  severities: Array<PublicIncidentFormSeverity>;
  isCaptchaRequired: boolean;
}) => PublicIncidentForm;

/**
 * What the public page is told about a form, built field by field so that
 * nothing else about the form - its share key, its template, its IP
 * allowlist, its project - is ever sent. The project's severities are only
 * listed when the reporter may choose one.
 */
export const getPublicIncidentForm: GetPublicIncidentFormFunction = (data: {
  form: PublicIncidentFormSource;
  askedDefinitions: Array<IncidentFormAskedDefinition>;
  severities: Array<PublicIncidentFormSeverity>;
  isCaptchaRequired: boolean;
}): PublicIncidentForm => {
  const publicForm: PublicIncidentForm = {
    name: typeof data.form.name === "string" ? data.form.name : "",
    descriptionSetting: readDescriptionSetting(data.form.descriptionSetting),
    isReporterDetailsRequired: data.form.isReporterDetailsRequired !== false,
    customFields: getPublicIncidentFormFields(data.askedDefinitions),
    isCaptchaRequired: data.isCaptchaRequired === true,
  };

  if (
    typeof data.form.description === "string" &&
    data.form.description.trim().length > 0
  ) {
    publicForm.description = data.form.description;
  }

  if (data.form.allowReporterToChooseSeverity === true) {
    const severities: Array<PublicIncidentFormSeverity> = [];

    // Only the three properties the page draws, whatever the caller passed.
    for (const severity of data.severities || []) {
      if (!severity || typeof severity._id !== "string" || !severity._id) {
        continue;
      }

      const listed: PublicIncidentFormSeverity = {
        _id: severity._id,
        name: typeof severity.name === "string" ? severity.name : "",
      };

      if (typeof severity.color === "string" && severity.color) {
        listed.color = severity.color;
      }

      severities.push(listed);
    }

    publicForm.severities = severities;

    const formSeverityId: string = data.form.incidentSeverityId
      ? data.form.incidentSeverityId.toString().toLowerCase()
      : "";

    const formSeverity: PublicIncidentFormSeverity | undefined =
      severities.find((severity: PublicIncidentFormSeverity): boolean => {
        return severity._id.toLowerCase() === formSeverityId;
      });

    if (formSeverity) {
      publicForm.defaultIncidentSeverityId = formSeverity._id;
    }
  }

  return publicForm;
};

type CleanAnswerFunction = (
  field: PublicIncidentFormField,
  value: unknown,
) => unknown;

/*
 * An answer as it is checked and stored: text cleaned as its field shows
 * it, "true" / "false" as the booleans the dashboard's own checkbox stores,
 * and a multi-select as a list with each option once. Anything else is left
 * for the checks to judge.
 */
const cleanAnswer: CleanAnswerFunction = (
  field: PublicIncidentFormField,
  value: unknown,
): unknown => {
  if (typeof value === "string") {
    switch (field.customFieldType) {
      case CustomFieldType.Text:
        return cleanSingleLine(value);

      case CustomFieldType.LongText:
      case CustomFieldType.Markdown:
        return cleanMultiLine(value);

      case CustomFieldType.Boolean: {
        const text: string = cleanScalarText(value);

        if (text === "true") {
          return true;
        }

        if (text === "false") {
          return false;
        }

        return text;
      }

      case CustomFieldType.MultiSelectDropdown: {
        const text: string = cleanScalarText(value);

        return text.length > 0 ? [text] : [];
      }

      default:
        return cleanScalarText(value);
    }
  }

  if (
    Array.isArray(value) &&
    field.customFieldType === CustomFieldType.MultiSelectDropdown
  ) {
    const entries: Array<unknown> = [];
    const seen: Set<string> = new Set<string>();

    for (const entry of value) {
      const cleaned: unknown =
        typeof entry === "string" ? cleanScalarText(entry) : entry;

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

type IsTooLongFunction = (value: unknown, maxLength: number) => boolean;

// A text answer, or any text entry of a list, longer than the cap.
const isTooLong: IsTooLongFunction = (
  value: unknown,
  maxLength: number,
): boolean => {
  if (typeof value === "string") {
    return value.length > maxLength;
  }

  if (Array.isArray(value)) {
    return value.some((entry: unknown): boolean => {
      return typeof entry === "string" && entry.length > maxLength;
    });
  }

  return false;
};

type ValidateAnswersFunction = (data: {
  fields: Array<PublicIncidentFormField>;
  answers: Record<string, unknown>;
  errors: Array<string>;
}) => JSONObject;

type GetMaxChoicesFunction = (field: PublicIncidentFormField) => number;

// See INCIDENT_FORM_MULTI_SELECT_MAX_CHOICES.
const getMaxChoices: GetMaxChoicesFunction = (
  field: PublicIncidentFormField,
): number => {
  return Math.max(
    INCIDENT_FORM_MULTI_SELECT_MAX_CHOICES,
    parseCustomFieldDropdownOptions(field.dropdownOptions).length,
  );
};

/*
 * The custom field answers a submission may store. Only the fields the form
 * asks for are read; an answer keyed by any other name is dropped unread.
 */
const validateAnswers: ValidateAnswersFunction = (data: {
  fields: Array<PublicIncidentFormField>;
  answers: Record<string, unknown>;
  errors: Array<string>;
}): JSONObject => {
  const accepted: JSONObject = {};

  for (const field of data.fields) {
    const answer: unknown = hasOwn(data.answers, field.name)
      ? data.answers[field.name]
      : undefined;

    /*
     * A list is bounded before anything reads its entries: cleaning,
     * de-duplicating and checking them, and quoting the ones that are not
     * options back in the refusal, all cost as much as the list is long,
     * and the request may carry millions. Only a multi-select takes a list
     * at all, and only as many entries as it could have choices.
     */
    if (Array.isArray(answer) && answer.length > 0) {
      if (field.customFieldType !== CustomFieldType.MultiSelectDropdown) {
        data.errors.push(
          fillMessage(NOT_A_LIST_MESSAGE, { field: field.name }),
        );
        continue;
      }

      const maxChoices: number = getMaxChoices(field);

      if (answer.length > maxChoices) {
        data.errors.push(
          fillMessage(TOO_MANY_CHOICES_MESSAGE, {
            field: field.name,
            maxLength: maxChoices,
          }),
        );
        continue;
      }

      /*
       * Each choice is one option, so a list or an object inside the list
       * is refused here, unread: turning a list nested thousands deep into
       * text, as cleaning and checking the entries would, overflows the
       * stack - a refusal must never become a thrown error.
       */
      if (
        answer.some((entry: unknown): boolean => {
          return entry !== null && typeof entry === "object";
        })
      ) {
        data.errors.push(
          fillMessage(NESTED_CHOICE_MESSAGE, { field: field.name }),
        );
        continue;
      }
    }

    const value: unknown = cleanAnswer(field, answer);

    if (isCustomFieldValueEmpty(value)) {
      if (field.isRequired) {
        data.errors.push(
          fillMessage(
            field.customFieldType === CustomFieldType.Boolean
              ? MUST_BE_CHECKED_MESSAGE
              : REQUIRED_MESSAGE,
            { field: field.name },
          ),
        );
      }

      continue;
    }

    if (isTooLong(value, INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH)) {
      data.errors.push(
        fillMessage(TOO_LONG_MESSAGE, {
          field: field.name,
          maxLength: INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH,
        }),
      );
      continue;
    }

    const typeErrors: Array<CustomFieldValueValidationError> =
      validateCustomFieldValues({
        definitions: [
          {
            name: field.name,
            customFieldType: field.customFieldType,
            dropdownOptions: field.dropdownOptions,
          },
        ],
        customFields: { [field.name]: value },
        storedCustomFields: {},
      });

    if (typeErrors.length > 0) {
      data.errors.push(
        ...typeErrors.map((error: CustomFieldValueValidationError): string => {
          return error.message;
        }),
      );
      continue;
    }

    /*
     * A required yes/no question is an acknowledgement: only a tick answers
     * it, as on the dashboard (CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE).
     */
    if (
      field.isRequired &&
      field.customFieldType === CustomFieldType.Boolean &&
      value !== true
    ) {
      data.errors.push(
        fillMessage(MUST_BE_CHECKED_MESSAGE, { field: field.name }),
      );
      continue;
    }

    /*
     * Defined, not assigned: a field may be named "__proto__", and assigning
     * that name would set the object's prototype instead of storing the
     * answer.
     */
    Object.defineProperty(accepted, field.name, {
      value: value as JSONValue,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return accepted;
};

/*
 * Email alone finds an address anywhere in a text - "Jane <jane@x.test>"
 * passes it - so the whole answer must also be one ordinary address: the
 * dot-atom half of Email's own pattern, anchored at both ends.
 */
export const WHOLE_EMAIL_ADDRESS: RegExp =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

type ReadTextAnswerFunction = (data: {
  value: unknown;
  label: string;
  clean: CleanTextFunction;
  errors: Array<string>;
}) => string | null;

/*
 * One of the built-in text questions: "" when it was not answered, the
 * cleaned text when it was, and null - with the problem recorded - when the
 * answer is not text at all, so the caller does not also call it missing.
 */
const readTextAnswer: ReadTextAnswerFunction = (data: {
  value: unknown;
  label: string;
  clean: CleanTextFunction;
  errors: Array<string>;
}): string | null => {
  if (data.value === undefined || data.value === null) {
    return "";
  }

  if (typeof data.value !== "string") {
    data.errors.push(`${data.label} must be text.`);
    return null;
  }

  return data.clean(data.value);
};

type CheckLengthFunction = (data: {
  text: string;
  label: string;
  isRequired: boolean;
  maxLength: number;
  errors: Array<string>;
}) => void;

// Required and too-long checks for a built-in text question.
const checkLength: CheckLengthFunction = (data: {
  text: string;
  label: string;
  isRequired: boolean;
  maxLength: number;
  errors: Array<string>;
}): void => {
  if (data.text.length === 0) {
    if (data.isRequired) {
      data.errors.push(fillMessage(REQUIRED_MESSAGE, { field: data.label }));
    }

    return;
  }

  if (data.text.length > data.maxLength) {
    data.errors.push(
      fillMessage(TOO_LONG_MESSAGE, {
        field: data.label,
        maxLength: data.maxLength,
      }),
    );
  }
};

export type ValidateIncidentFormSubmissionFunction = (data: {
  form: IncidentFormSubmissionRules;
  // What getIncidentFormAskedDefinitions returns for the form.
  askedDefinitions: Array<IncidentFormAskedDefinition>;
  // The project's severities; only read when the reporter may choose one.
  severities: Array<{ _id: string }>;
  // The `data` of the request body, unread so far.
  data: unknown;
}) => IncidentFormSubmissionValidationResult;

/**
 * Checks a submission against its form and returns either every problem
 * with it, or the answers the incident may be built from. Never throws on a
 * parsed JSON body, whatever it holds.
 *
 * - Title: always required, one line, at most 500 characters.
 * - Description: ignored when the form hides it; required or optional
 *   otherwise, at most 20000 characters.
 * - Severity: only read when the form lets the reporter choose, and then it
 *   must be one of the project's severities. Leaving it out means the
 *   form's own severity.
 * - Name and email: required unless the form says otherwise; when given,
 *   the name is at most 100 characters and the email one valid address of
 *   at most 100.
 * - Custom fields: only those the form asks, each checked as an API write
 *   would be, required ones filled in (a required yes/no ticked), text at
 *   most 10000 characters, a list only for a multi-select and then with at
 *   most 100 choices (or as many as it has options), none of them a list
 *   or an object. Answers to anything else are dropped.
 */
export const validateIncidentFormSubmission: ValidateIncidentFormSubmissionFunction =
  (data: {
    form: IncidentFormSubmissionRules;
    askedDefinitions: Array<IncidentFormAskedDefinition>;
    severities: Array<{ _id: string }>;
    data: unknown;
  }): IncidentFormSubmissionValidationResult => {
    if (!isPlainObject(data.data)) {
      return {
        isValid: false,
        errors: [
          "The submission must be an object holding the form's answers.",
        ],
      };
    }

    const input: Record<string, unknown> = data.data;
    const form: IncidentFormSubmissionRules = data.form || {};
    const labels: IncidentFormQuestionLabels = INCIDENT_FORM_QUESTION_LABELS;
    const errors: Array<string> = [];

    // Title: always asked, always required.
    const title: string | null = readTextAnswer({
      value: input["title"],
      label: labels.title,
      clean: cleanSingleLine,
      errors: errors,
    });

    if (title !== null) {
      checkLength({
        text: title,
        label: labels.title,
        isRequired: true,
        maxLength: INCIDENT_FORM_TITLE_MAX_LENGTH,
        errors: errors,
      });
    }

    // Description: not even read when the form hides it.
    const descriptionSetting: IncidentFormFieldSetting = readDescriptionSetting(
      form.descriptionSetting,
    );

    let description: string | null = "";

    if (descriptionSetting !== IncidentFormFieldSetting.Hidden) {
      description = readTextAnswer({
        value: input["description"],
        label: labels.description,
        clean: cleanMultiLine,
        errors: errors,
      });

      if (description !== null) {
        checkLength({
          text: description,
          label: labels.description,
          isRequired: descriptionSetting === IncidentFormFieldSetting.Required,
          maxLength: INCIDENT_FORM_DESCRIPTION_MAX_LENGTH,
          errors: errors,
        });
      }
    }

    // Severity: only a choice the form offers, and only when it offers one.
    let incidentSeverityId: string | undefined = undefined;

    if (form.allowReporterToChooseSeverity === true) {
      const requested: unknown = input["incidentSeverityId"];

      const isUnanswered: boolean =
        requested === undefined ||
        requested === null ||
        (typeof requested === "string" && requested.trim().length === 0);

      if (!isUnanswered) {
        const requestedId: string =
          typeof requested === "string" ? requested.trim().toLowerCase() : "";

        const listed: { _id: string } | undefined = requestedId
          ? (data.severities || []).find(
              (severity: { _id: string }): boolean => {
                return (
                  typeof severity?._id === "string" &&
                  severity._id.toLowerCase() === requestedId
                );
              },
            )
          : undefined;

        if (listed) {
          incidentSeverityId = listed._id;
        } else {
          errors.push(
            `${labels.severity} must be one of the severities this form lists.`,
          );
        }
      }
    }

    // The reporter: required unless the form says otherwise.
    const detailsRequired: boolean = form.isReporterDetailsRequired !== false;

    const reporterName: string | null = readTextAnswer({
      value: input["reporterName"],
      label: labels.reporterName,
      clean: cleanSingleLine,
      errors: errors,
    });

    if (reporterName !== null) {
      checkLength({
        text: reporterName,
        label: labels.reporterName,
        isRequired: detailsRequired,
        maxLength: INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH,
        errors: errors,
      });
    }

    let reporterEmail: string | null = readTextAnswer({
      value: input["reporterEmail"],
      label: labels.reporterEmail,
      clean: cleanScalarText,
      errors: errors,
    });

    if (reporterEmail !== null) {
      const errorCount: number = errors.length;

      checkLength({
        text: reporterEmail,
        label: labels.reporterEmail,
        isRequired: detailsRequired,
        maxLength: INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH,
        errors: errors,
      });

      if (reporterEmail.length > 0 && errors.length === errorCount) {
        if (
          WHOLE_EMAIL_ADDRESS.test(reporterEmail) &&
          Email.isValid(reporterEmail)
        ) {
          reporterEmail = new Email(reporterEmail).toString();
        } else {
          errors.push(`${labels.reporterEmail} is not a valid email address.`);
        }
      }
    }

    // Custom fields: only the ones the form asks for are read.
    const rawAnswers: unknown = input["customFields"];
    let answers: Record<string, unknown> = {};

    if (isPlainObject(rawAnswers)) {
      answers = rawAnswers;
    } else if (rawAnswers !== undefined && rawAnswers !== null) {
      errors.push(
        "The custom field answers must be an object keyed by field name.",
      );
    }

    const customFields: JSONObject = validateAnswers({
      fields: getPublicIncidentFormFields(data.askedDefinitions || []),
      answers: answers,
      errors: errors,
    });

    if (errors.length > 0) {
      return { isValid: false, errors: errors };
    }

    const value: ValidatedIncidentFormSubmission = {
      title: title || "",
      customFields: customFields,
    };

    if (description) {
      value.description = description;
    }

    if (incidentSeverityId) {
      value.incidentSeverityId = incidentSeverityId;
    }

    if (reporterName) {
      value.reporterName = reporterName;
    }

    if (reporterEmail) {
      value.reporterEmail = reporterEmail;
    }

    return { isValid: true, value: value };
  };

export type FormatIncidentFormSubmissionErrorsFunction = (
  errors: Array<string>,
) => string;

/** Every problem as one message, for an API error response. */
export const formatIncidentFormSubmissionErrors: FormatIncidentFormSubmissionErrorsFunction =
  (errors: Array<string>): string => {
    return errors.join(" ");
  };
