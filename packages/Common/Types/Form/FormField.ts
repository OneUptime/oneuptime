import { parseCustomFieldDropdownOptions } from "../CustomField/CustomFieldDropdownOption";
import CustomFieldType from "../CustomField/CustomFieldType";
import ColumnLength from "../Database/ColumnLength";
import ObjectID from "../ObjectID";
import {
  FormTargetFieldDefinition,
  getFormTargetField,
  getFormTargetFields,
  getFormTargetFieldsThatMustBeAsked,
  isChoiceTargetField,
} from "./FormTargetCatalog";
import FormTargetType, { FORM_TARGET_TYPE_TEXT } from "./FormTargetType";

/*
 * The questions a form asks, in the order it asks them: Form.fields, the
 * form builder's output.
 *
 * Every question has a source that says where its answer goes:
 *
 *   - Question: one of the form's own questions - a short answer, a
 *     paragraph, a dropdown, a date and so on. Its answer is kept with the
 *     submission and written on the private note the created record gets.
 *   - TargetField: one of the built-in fields of what the form creates (the
 *     incident's title, its severity, a maintenance event's start). Its
 *     answer becomes that field's value. See FormTargetCatalog.
 *   - TargetCustomField: one of the project's custom fields of what the form
 *     creates (an incident custom field, a scheduled maintenance custom
 *     field), by its id. Its answer becomes the record's value for it.
 *   - Submitter: the submitter's name or email. Kept with the submission and
 *     named on the private note; never on the record itself.
 *
 * A question's answers are keyed by its id, which never changes once the
 * question exists, so relabelling a question keeps its submissions readable.
 *
 * Read the stored value with readFormFields (it never throws, and drops what
 * it cannot use), and check a value before storing it with
 * validateFormFields, which the server runs on every write - from the
 * dashboard, the API, Terraform or a workflow.
 *
 * Pure, with no database or React imports, so the server, the builder and
 * the public page read questions the same way.
 */

export enum FormFieldSource {
  Question = "Question",
  TargetField = "TargetField",
  TargetCustomField = "TargetCustomField",
  Submitter = "Submitter",
}

export enum FormSubmitterField {
  Name = "Name",
  Email = "Email",
}

export interface FormField {
  id: string;
  source: FormFieldSource;
  // The question as the submitter reads it.
  label: string;
  // Shown under the question.
  helpText?: string | undefined;
  isRequired: boolean;

  // Question only: how it is answered.
  type?: CustomFieldType | undefined;
  /*
   * Question only, for a Dropdown or MultiSelectDropdown: its options, in
   * the custom fields' serialized format (parseCustomFieldDropdownOptions),
   * so the custom field inputs and checks read them unchanged.
   */
  dropdownOptions?: string | undefined;

  // TargetField only: the target field's key (FormTargetCatalog).
  targetField?: string | undefined;
  /*
   * TargetField only, for a field answered by choosing records: the ids of
   * the records the public page offers. See mustChooseOptions.
   */
  allowedOptionIds?: Array<string> | undefined;

  // TargetCustomField only: the custom field's id.
  customFieldId?: string | undefined;

  // Submitter only.
  submitterField?: FormSubmitterField | undefined;
}

// The most questions one form asks.
export const FORM_MAX_FIELDS: number = 50;

export const FORM_FIELD_LABEL_MAX_LENGTH: number = 200;

export const FORM_FIELD_HELP_TEXT_MAX_LENGTH: number = 1000;

// The most options a dropdown question offers.
export const FORM_QUESTION_MAX_OPTIONS: number = 100;

export const FORM_QUESTION_OPTION_MAX_LENGTH: number = ColumnLength.ShortText;

// The most records a choice field may offer on the public page.
export const FORM_FIELD_MAX_ALLOWED_OPTIONS: number = 100;

/*
 * The longest answer to a text question or a text custom field. Answers are
 * kept with the submission (and custom field answers on the record), and
 * the request body may be up to 50 MB.
 */
export const FORM_TEXT_ANSWER_MAX_LENGTH: number = 10000;

// FormSubmission.submitterName and submitterEmail are varchar(100).
export const FORM_SUBMITTER_NAME_MAX_LENGTH: number = ColumnLength.ShortText;
export const FORM_SUBMITTER_EMAIL_MAX_LENGTH: number = ColumnLength.Email;

/*
 * A question's id: letters, digits, "-" and "_", starting with a letter or
 * digit, at most 64 characters. Ids are keys of the answers object, so a
 * name such as "__proto__" or "constructor"-like trickery must not be one,
 * and a dot or a bracket would be read as a path by the form library.
 */
export const FORM_FIELD_ID_PATTERN: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// The types a question of the form's own can have, in the palette's order.
export const FORM_QUESTION_TYPES: ReadonlyArray<CustomFieldType> = [
  CustomFieldType.Text,
  CustomFieldType.LongText,
  CustomFieldType.Markdown,
  CustomFieldType.Number,
  CustomFieldType.Dropdown,
  CustomFieldType.MultiSelectDropdown,
  CustomFieldType.Boolean,
  CustomFieldType.Date,
  CustomFieldType.DateTime,
];

export const FORM_CHOICE_QUESTION_TYPES: ReadonlyArray<CustomFieldType> = [
  CustomFieldType.Dropdown,
  CustomFieldType.MultiSelectDropdown,
];

export const FORM_SUBMITTER_FIELDS: ReadonlyArray<FormSubmitterField> = [
  FormSubmitterField.Name,
  FormSubmitterField.Email,
];

export interface FormSubmitterFieldDefinition {
  field: FormSubmitterField;
  title: string;
  description: string;
  defaultLabel: string;
}

export const FORM_SUBMITTER_FIELD_DEFINITIONS: Readonly<
  Record<FormSubmitterField, FormSubmitterFieldDefinition>
> = {
  [FormSubmitterField.Name]: {
    field: FormSubmitterField.Name,
    title: "Name",
    description: "Who is submitting. Kept with the submission.",
    defaultLabel: "Your Name",
  },
  [FormSubmitterField.Email]: {
    field: FormSubmitterField.Email,
    title: "Email",
    description: "How to reach the submitter. Kept with the submission.",
    defaultLabel: "Your Email",
  },
};

const FORM_FIELD_SOURCES: ReadonlyArray<string> = Object.values(FormFieldSource);

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

export type GenerateFormFieldIdFunction = () => string;

// A fresh id for a new question.
export const generateFormFieldId: GenerateFormFieldIdFunction = (): string => {
  return ObjectID.generate().toString();
};

export type IsFormFieldIdFunction = (value: unknown) => value is string;

export const isFormFieldId: IsFormFieldIdFunction = (
  value: unknown,
): value is string => {
  return typeof value === "string" && FORM_FIELD_ID_PATTERN.test(value);
};

type ReadTextFunction = (value: unknown) => string | undefined;

const readOptionalText: ReadTextFunction = (
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const text: string = value.trim();

  return text.length > 0 ? text : undefined;
};

type ReadIdListFunction = (value: unknown) => Array<string>;

// A list of record ids, lowercased, each once, in order; junk dropped.
const readIdList: ReadIdListFunction = (value: unknown): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Array<string> = [];

  for (const entry of value) {
    const id: string =
      typeof entry === "string" ? entry.trim().toLowerCase() : "";

    if (ObjectID.isValidUUID(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
};

type ReadFieldFunction = (value: unknown) => FormField | null;

/*
 * One stored question as the builder and the public page read it, or null
 * for an entry that cannot be one: no usable id, an unknown source, or a
 * source without what it needs (a question with an unknown type, a linked
 * field with no key or custom field id, a submitter field of no kind).
 * Properties that do not belong to its source are left behind.
 */
const readField: ReadFieldFunction = (value: unknown): FormField | null => {
  if (!isPlainObject(value)) {
    return null;
  }

  const id: unknown = value["id"];
  const source: unknown = value["source"];

  if (
    !isFormFieldId(id) ||
    typeof source !== "string" ||
    !FORM_FIELD_SOURCES.includes(source)
  ) {
    return null;
  }

  const field: FormField = {
    id: id,
    source: source as FormFieldSource,
    label: typeof value["label"] === "string" ? value["label"].trim() : "",
    isRequired: value["isRequired"] === true,
  };

  const helpText: string | undefined = readOptionalText(value["helpText"]);

  if (helpText) {
    field.helpText = helpText;
  }

  switch (field.source) {
    case FormFieldSource.Question: {
      const type: unknown = value["type"];

      if (
        typeof type !== "string" ||
        !(FORM_QUESTION_TYPES as ReadonlyArray<string>).includes(type)
      ) {
        return null;
      }

      field.type = type as CustomFieldType;

      if (
        FORM_CHOICE_QUESTION_TYPES.includes(field.type) &&
        typeof value["dropdownOptions"] === "string" &&
        value["dropdownOptions"].trim()
      ) {
        field.dropdownOptions = value["dropdownOptions"];
      }

      return field;
    }

    case FormFieldSource.TargetField: {
      const targetField: string | undefined = readOptionalText(
        value["targetField"],
      );

      if (!targetField) {
        return null;
      }

      field.targetField = targetField;

      const allowedOptionIds: Array<string> = readIdList(
        value["allowedOptionIds"],
      );

      if (allowedOptionIds.length > 0) {
        field.allowedOptionIds = allowedOptionIds;
      }

      return field;
    }

    case FormFieldSource.TargetCustomField: {
      const customFieldId: string =
        typeof value["customFieldId"] === "string"
          ? value["customFieldId"].trim().toLowerCase()
          : "";

      if (!ObjectID.isValidUUID(customFieldId)) {
        return null;
      }

      field.customFieldId = customFieldId;

      return field;
    }

    case FormFieldSource.Submitter: {
      const submitterField: unknown = value["submitterField"];

      if (
        typeof submitterField !== "string" ||
        !(FORM_SUBMITTER_FIELDS as ReadonlyArray<string>).includes(
          submitterField,
        )
      ) {
        return null;
      }

      field.submitterField = submitterField as FormSubmitterField;

      return field;
    }

    default:
      return null;
  }
};

export type ReadFormFieldsFunction = (value: unknown) => Array<FormField>;

/**
 * A form's stored questions, in order, as the builder and the public page
 * read them: entries that cannot be a question are dropped, and so is a
 * second question with an id already listed. Never throws.
 */
export const readFormFields: ReadFormFieldsFunction = (
  value: unknown,
): Array<FormField> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const fields: Array<FormField> = [];
  const ids: Set<string> = new Set<string>();

  for (const entry of value.slice(0, FORM_MAX_FIELDS)) {
    const field: FormField | null = readField(entry);

    if (!field || ids.has(field.id)) {
      continue;
    }

    ids.add(field.id);
    fields.push(field);
  }

  return fields;
};

export type DescribeFormFieldFunction = (data: {
  index: number;
  label?: unknown;
}) => string;

/*
 * How a problem names the question it is about: its position, and its
 * label when it has one - "Question 3 ("What broke?")".
 */
export const describeFormField: DescribeFormFieldFunction = (data: {
  index: number;
  label?: unknown;
}): string => {
  const label: string =
    typeof data.label === "string" ? data.label.trim().slice(0, 60) : "";

  return label
    ? `Question ${data.index + 1} ("${label}")`
    : `Question ${data.index + 1}`;
};

type CheckFieldFunction = (data: {
  entry: Record<string, unknown>;
  name: string;
  targetType: FormTargetType;
  problems: Array<string>;
}) => void;

// The checks every question shares: its label, help text and Required.
const checkCommonProperties: CheckFieldFunction = (data: {
  entry: Record<string, unknown>;
  name: string;
  targetType: FormTargetType;
  problems: Array<string>;
}): void => {
  const label: unknown = data.entry["label"];

  if (typeof label !== "string" || label.trim().length === 0) {
    data.problems.push(`${data.name} needs a label.`);
  } else if (label.trim().length > FORM_FIELD_LABEL_MAX_LENGTH) {
    data.problems.push(
      `${data.name}: the label cannot be more than ${FORM_FIELD_LABEL_MAX_LENGTH} characters.`,
    );
  }

  const helpText: unknown = data.entry["helpText"];

  if (helpText !== undefined && helpText !== null) {
    if (typeof helpText !== "string") {
      data.problems.push(`${data.name}: the help text must be text.`);
    } else if (helpText.trim().length > FORM_FIELD_HELP_TEXT_MAX_LENGTH) {
      data.problems.push(
        `${data.name}: the help text cannot be more than ${FORM_FIELD_HELP_TEXT_MAX_LENGTH} characters.`,
      );
    }
  }

  const isRequired: unknown = data.entry["isRequired"];

  if (isRequired !== undefined && typeof isRequired !== "boolean") {
    data.problems.push(`${data.name}: Required must be true or false.`);
  }
};

// A question of the form's own: its type, and a choice question's options.
const checkQuestion: CheckFieldFunction = (data: {
  entry: Record<string, unknown>;
  name: string;
  targetType: FormTargetType;
  problems: Array<string>;
}): void => {
  const type: unknown = data.entry["type"];

  if (
    typeof type !== "string" ||
    !(FORM_QUESTION_TYPES as ReadonlyArray<string>).includes(type)
  ) {
    data.problems.push(
      `${data.name} must have one of these types: ${FORM_QUESTION_TYPES.join(", ")}.`,
    );
    return;
  }

  if (!FORM_CHOICE_QUESTION_TYPES.includes(type as CustomFieldType)) {
    return;
  }

  const serialized: unknown = data.entry["dropdownOptions"];

  if (serialized !== undefined && typeof serialized !== "string") {
    data.problems.push(`${data.name}: its options must be text.`);
    return;
  }

  const options: Array<string> = parseCustomFieldDropdownOptions(
    serialized,
  ).map((option: { value: string }): string => {
    return option.value;
  });

  if (options.length === 0) {
    data.problems.push(`${data.name} needs at least one option to choose from.`);
    return;
  }

  if (options.length > FORM_QUESTION_MAX_OPTIONS) {
    data.problems.push(
      `${data.name} cannot have more than ${FORM_QUESTION_MAX_OPTIONS} options.`,
    );
  }

  const tooLong: string | undefined = options.find(
    (option: string): boolean => {
      return option.length > FORM_QUESTION_OPTION_MAX_LENGTH;
    },
  );

  if (tooLong) {
    data.problems.push(
      `${data.name}: an option cannot be more than ${FORM_QUESTION_OPTION_MAX_LENGTH} characters.`,
    );
  }

  if (new Set(options).size !== options.length) {
    data.problems.push(`${data.name} lists the same option twice.`);
  }
};

// A built-in field of the target: one it has, and the records it offers.
const checkTargetField: CheckFieldFunction = (data: {
  entry: Record<string, unknown>;
  name: string;
  targetType: FormTargetType;
  problems: Array<string>;
}): void => {
  const definition: FormTargetFieldDefinition | undefined =
    getFormTargetField(data.targetType, data.entry["targetField"]);

  if (!definition) {
    data.problems.push(
      `${data.name} is linked to a field ${FORM_TARGET_TYPE_TEXT[data.targetType].nounWithArticle} does not have. Fields it can be linked to: ${getFormTargetFields(
        data.targetType,
      )
        .map((field: FormTargetFieldDefinition): string => {
          return field.key;
        })
        .join(", ")}.`,
    );
    return;
  }

  const allowed: unknown = data.entry["allowedOptionIds"];

  if (!isChoiceTargetField(definition)) {
    if (
      allowed !== undefined &&
      allowed !== null &&
      !(Array.isArray(allowed) && allowed.length === 0)
    ) {
      data.problems.push(
        `${data.name}: ${definition.title} is not answered by choosing, so it takes no allowed options.`,
      );
    }
    return;
  }

  if (allowed !== undefined && allowed !== null && !Array.isArray(allowed)) {
    data.problems.push(`${data.name}: the allowed options must be a list.`);
    return;
  }

  const entries: Array<unknown> = Array.isArray(allowed) ? allowed : [];

  if (entries.length > FORM_FIELD_MAX_ALLOWED_OPTIONS) {
    data.problems.push(
      `${data.name} cannot offer more than ${FORM_FIELD_MAX_ALLOWED_OPTIONS} options.`,
    );
    return;
  }

  const invalid: boolean = entries.some((entry: unknown): boolean => {
    return (
      typeof entry !== "string" ||
      !ObjectID.isValidUUID(entry.trim().toLowerCase())
    );
  });

  if (invalid) {
    data.problems.push(`${data.name}: every allowed option must be an id.`);
    return;
  }

  if (definition.mustChooseOptions && entries.length === 0) {
    data.problems.push(
      `${data.name}: choose which ${definition.title.toLowerCase()} the form offers. A public form only lists the ones you choose.`,
    );
  }
};

const checkTargetCustomField: CheckFieldFunction = (data: {
  entry: Record<string, unknown>;
  name: string;
  targetType: FormTargetType;
  problems: Array<string>;
}): void => {
  const customFieldId: unknown = data.entry["customFieldId"];

  if (
    typeof customFieldId !== "string" ||
    !ObjectID.isValidUUID(customFieldId.trim().toLowerCase())
  ) {
    data.problems.push(`${data.name} must name a custom field by its id.`);
  }
};

const checkSubmitterField: CheckFieldFunction = (data: {
  entry: Record<string, unknown>;
  name: string;
  targetType: FormTargetType;
  problems: Array<string>;
}): void => {
  const submitterField: unknown = data.entry["submitterField"];

  if (
    typeof submitterField !== "string" ||
    !(FORM_SUBMITTER_FIELDS as ReadonlyArray<string>).includes(submitterField)
  ) {
    data.problems.push(
      `${data.name} must ask for the submitter's ${FORM_SUBMITTER_FIELDS.join(" or ").toLowerCase()}.`,
    );
  }
};

const CHECKS_BY_SOURCE: Record<FormFieldSource, CheckFieldFunction> = {
  [FormFieldSource.Question]: checkQuestion,
  [FormFieldSource.TargetField]: checkTargetField,
  [FormFieldSource.TargetCustomField]: checkTargetCustomField,
  [FormFieldSource.Submitter]: checkSubmitterField,
};

// The most problems one refusal lists.
const MAX_LISTED_PROBLEMS: number = 8;

export type ValidateFormFieldsFunction = (data: {
  value: unknown;
  targetType: FormTargetType;
}) => string | null;

/**
 * Null when the questions can be stored for a form of this target;
 * otherwise one message naming every problem (the first eight). Checked:
 *
 *   - a list of at most FORM_MAX_FIELDS questions, each an object with a
 *     unique id, a known source, a label and Required as true or false;
 *   - a question of the form's own has a known type, and a dropdown has
 *     between one and FORM_QUESTION_MAX_OPTIONS distinct options;
 *   - a linked field is one the target has, asked once, and a field
 *     answered by choosing offers record ids (and must offer some when the
 *     public page only lists chosen ones);
 *   - a custom field is named by its id, and asked once;
 *   - the submitter's name and email are asked once each;
 *   - every field the target cannot do without, and that nothing else
 *     supplies (a maintenance event's start and end), is asked and required.
 *
 * Whether a linked custom field, or an allowed record, still exists in the
 * project is the server's to check: this module has no database.
 */
export const validateFormFields: ValidateFormFieldsFunction = (data: {
  value: unknown;
  targetType: FormTargetType;
}): string | null => {
  if (data.value === null || data.value === undefined) {
    return null;
  }

  if (!Array.isArray(data.value)) {
    return "Fields must be a list of questions.";
  }

  if (data.value.length > FORM_MAX_FIELDS) {
    return `A form cannot have more than ${FORM_MAX_FIELDS} questions.`;
  }

  const problems: Array<string> = [];
  const ids: Set<string> = new Set<string>();
  const targetFields: Set<string> = new Set<string>();
  const customFields: Set<string> = new Set<string>();
  const submitterFields: Set<string> = new Set<string>();

  data.value.forEach((entry: unknown, index: number): void => {
    if (!isPlainObject(entry)) {
      problems.push(`${describeFormField({ index })} must be an object.`);
      return;
    }

    const name: string = describeFormField({ index, label: entry["label"] });
    const id: unknown = entry["id"];

    if (!isFormFieldId(id)) {
      problems.push(
        `${name} needs an id of letters, digits, "-" and "_", starting with a letter or digit, at most 64 characters.`,
      );
    } else if (ids.has(id)) {
      problems.push(`${name} has the same id as another question.`);
    } else {
      ids.add(id);
    }

    const source: unknown = entry["source"];

    if (typeof source !== "string" || !FORM_FIELD_SOURCES.includes(source)) {
      problems.push(
        `${name} must have one of these sources: ${FORM_FIELD_SOURCES.join(", ")}.`,
      );
      return;
    }

    checkCommonProperties({
      entry,
      name,
      targetType: data.targetType,
      problems,
    });

    CHECKS_BY_SOURCE[source as FormFieldSource]({
      entry,
      name,
      targetType: data.targetType,
      problems,
    });

    // Each linked field, custom field and submitter detail is asked once.
    if (source === FormFieldSource.TargetField) {
      const key: string = String(entry["targetField"] || "");

      if (key && targetFields.has(key)) {
        problems.push(`${name} asks for a field another question already asks.`);
      }

      targetFields.add(key);
    }

    if (source === FormFieldSource.TargetCustomField) {
      const key: string = String(entry["customFieldId"] || "").toLowerCase();

      if (key && customFields.has(key)) {
        problems.push(
          `${name} asks for a custom field another question already asks.`,
        );
      }

      customFields.add(key);
    }

    if (source === FormFieldSource.Submitter) {
      const key: string = String(entry["submitterField"] || "");

      if (key && submitterFields.has(key)) {
        problems.push(
          `${name} asks for a submitter detail another question already asks.`,
        );
      }

      submitterFields.add(key);
    }
  });

  // What the target cannot be created without, nothing else supplies.
  for (const required of getFormTargetFieldsThatMustBeAsked(data.targetType)) {
    const asking: Record<string, unknown> | undefined = (
      data.value as Array<unknown>
    ).find((entry: unknown): entry is Record<string, unknown> => {
      return (
        isPlainObject(entry) &&
        entry["source"] === FormFieldSource.TargetField &&
        entry["targetField"] === required.key
      );
    });

    if (!asking) {
      problems.push(
        `A form that creates ${FORM_TARGET_TYPE_TEXT[data.targetType].nounWithArticle} must ask for ${required.title}.`,
      );
    } else if (asking["isRequired"] !== true) {
      problems.push(
        `${required.title} must be required: ${FORM_TARGET_TYPE_TEXT[data.targetType].nounWithArticle} cannot be created without it.`,
      );
    }
  }

  if (problems.length === 0) {
    return null;
  }

  const more: number = problems.length - MAX_LISTED_PROBLEMS;

  return `${problems.slice(0, MAX_LISTED_PROBLEMS).join(" ")}${
    more > 0
      ? ` And ${more} more ${more === 1 ? "problem" : "problems"}.`
      : ""
  }`;
};

export type CreateQuestionFieldFunction = (data: {
  type: CustomFieldType;
  label: string;
  id?: string | undefined;
  dropdownOptions?: string | undefined;
}) => FormField;

/** A new question of the form's own. */
export const createQuestionField: CreateQuestionFieldFunction = (data: {
  type: CustomFieldType;
  label: string;
  id?: string | undefined;
  dropdownOptions?: string | undefined;
}): FormField => {
  const field: FormField = {
    id: data.id || generateFormFieldId(),
    source: FormFieldSource.Question,
    label: data.label,
    isRequired: false,
    type: data.type,
  };

  if (FORM_CHOICE_QUESTION_TYPES.includes(data.type)) {
    field.dropdownOptions =
      data.dropdownOptions ||
      JSON.stringify([{ value: "Option 1" }, { value: "Option 2" }]);
  }

  return field;
};

export type CreateTargetFieldFunction = (data: {
  definition: FormTargetFieldDefinition;
  id?: string | undefined;
}) => FormField;

/**
 * A new question for a built-in field of the target, with the label and
 * help text the catalog suggests. A field the target cannot do without and
 * that nothing else supplies starts required.
 */
export const createTargetField: CreateTargetFieldFunction = (data: {
  definition: FormTargetFieldDefinition;
  id?: string | undefined;
}): FormField => {
  const field: FormField = {
    id: data.id || generateFormFieldId(),
    source: FormFieldSource.TargetField,
    label: data.definition.defaultLabel,
    isRequired:
      data.definition.isRequiredByTarget && !data.definition.hasDefault,
    targetField: data.definition.key,
  };

  if (data.definition.defaultHelpText) {
    field.helpText = data.definition.defaultHelpText;
  }

  return field;
};

export type CreateCustomFieldFieldFunction = (data: {
  customFieldId: string;
  name: string;
  description?: string | null | undefined;
  id?: string | undefined;
}) => FormField;

/** A new question for one of the target's custom fields. */
export const createCustomFieldField: CreateCustomFieldFieldFunction = (data: {
  customFieldId: string;
  name: string;
  description?: string | null | undefined;
  id?: string | undefined;
}): FormField => {
  const field: FormField = {
    id: data.id || generateFormFieldId(),
    source: FormFieldSource.TargetCustomField,
    label: data.name.slice(0, FORM_FIELD_LABEL_MAX_LENGTH),
    isRequired: false,
    customFieldId: data.customFieldId.toLowerCase(),
  };

  const helpText: string | undefined = readOptionalText(data.description);

  if (helpText) {
    field.helpText = helpText.slice(0, FORM_FIELD_HELP_TEXT_MAX_LENGTH);
  }

  return field;
};

export type CreateSubmitterFieldFunction = (data: {
  submitterField: FormSubmitterField;
  isRequired?: boolean | undefined;
  id?: string | undefined;
}) => FormField;

/** A new question for the submitter's name or email. */
export const createSubmitterField: CreateSubmitterFieldFunction = (data: {
  submitterField: FormSubmitterField;
  isRequired?: boolean | undefined;
  id?: string | undefined;
}): FormField => {
  return {
    id: data.id || generateFormFieldId(),
    source: FormFieldSource.Submitter,
    label: FORM_SUBMITTER_FIELD_DEFINITIONS[data.submitterField].defaultLabel,
    isRequired: data.isRequired === true,
    submitterField: data.submitterField,
  };
};

export type GetDefaultFormFieldsFunction = (
  targetType: FormTargetType,
) => Array<FormField>;

/**
 * The questions a new form starts with, so it works the moment it is
 * created: the target's title, its description, every field it cannot do
 * without (a maintenance event's start and end), and who is submitting -
 * required, so the people who act on a submission can follow it up.
 */
export const getDefaultFormFields: GetDefaultFormFieldsFunction = (
  targetType: FormTargetType,
): Array<FormField> => {
  const fields: Array<FormField> = [];

  for (const definition of getFormTargetFields(targetType)) {
    if (
      definition.key === "title" ||
      definition.key === "description" ||
      (definition.isRequiredByTarget && !definition.hasDefault)
    ) {
      const field: FormField = createTargetField({ definition });

      // The title is what the people acting on it read first.
      if (definition.key === "title") {
        field.isRequired = true;
      }

      fields.push(field);
    }
  }

  fields.push(
    createSubmitterField({
      submitterField: FormSubmitterField.Name,
      isRequired: true,
    }),
    createSubmitterField({
      submitterField: FormSubmitterField.Email,
      isRequired: true,
    }),
  );

  return fields;
};

export type ConvertFormFieldsForTargetFunction = (data: {
  fields: Array<FormField>;
  from: FormTargetType;
  to: FormTargetType;
}) => Array<FormField>;

/**
 * The questions of a form whose target changes, as they are kept for the
 * new one. Nothing the submitter is asked disappears:
 *
 *   - a question of the form's own and a submitter detail stay as they are;
 *   - a built-in field the new target also has stays linked to it (an
 *     incident's title becomes the maintenance event's title), keeping only
 *     the allowed records that still make sense, and is required when the
 *     new target needs it;
 *   - any other linked field - a built-in field the new target lacks, or
 *     one of the old target's custom fields - becomes a question of the
 *     form's own with the same label, help text and Required, answered the
 *     same way (a choice of records becomes a short answer, since the
 *     records belonged to the old target);
 *
 * and then every field the new target cannot do without is added at the
 * end, required.
 */
export const convertFormFieldsForTarget: ConvertFormFieldsForTargetFunction =
  (data: {
    fields: Array<FormField>;
    from: FormTargetType;
    to: FormTargetType;
  }): Array<FormField> => {
    if (data.from === data.to) {
      return data.fields.map((field: FormField): FormField => {
        return { ...field };
      });
    }

    const converted: Array<FormField> = data.fields.map(
      (field: FormField): FormField => {
        if (
          field.source === FormFieldSource.Question ||
          field.source === FormFieldSource.Submitter
        ) {
          return { ...field };
        }

        if (field.source === FormFieldSource.TargetField) {
          const before: FormTargetFieldDefinition | undefined =
            getFormTargetField(data.from, field.targetField);
          const after: FormTargetFieldDefinition | undefined =
            getFormTargetField(data.to, field.targetField);

          if (
            after &&
            before &&
            after.inputType === before.inputType &&
            after.optionsSource === before.optionsSource
          ) {
            const kept: FormField = { ...field };

            if (after.isRequiredByTarget && !after.hasDefault) {
              kept.isRequired = true;
            }

            return kept;
          }

          const question: FormField = {
            id: field.id,
            source: FormFieldSource.Question,
            label: field.label,
            isRequired: field.isRequired,
            type:
              before && !isChoiceTargetField(before)
                ? before.inputType
                : CustomFieldType.Text,
          };

          if (field.helpText) {
            question.helpText = field.helpText;
          }

          return question;
        }

        // A custom field of the old target.
        const question: FormField = {
          id: field.id,
          source: FormFieldSource.Question,
          label: field.label,
          isRequired: field.isRequired,
          type: CustomFieldType.Text,
        };

        if (field.helpText) {
          question.helpText = field.helpText;
        }

        return question;
      },
    );

    for (const definition of getFormTargetFieldsThatMustBeAsked(data.to)) {
      const exists: boolean = converted.some((field: FormField): boolean => {
        return (
          field.source === FormFieldSource.TargetField &&
          field.targetField === definition.key
        );
      });

      if (!exists) {
        converted.push(createTargetField({ definition }));
      }
    }

    return converted;
  };

export type FindTargetFieldFunction = (
  fields: Array<FormField>,
  key: string,
) => FormField | undefined;

// The question that asks for a built-in field of the target, if any.
export const findTargetField: FindTargetFieldFunction = (
  fields: Array<FormField>,
  key: string,
): FormField | undefined => {
  return fields.find((field: FormField): boolean => {
    return (
      field.source === FormFieldSource.TargetField && field.targetField === key
    );
  });
};

export type FindCustomFieldFieldFunction = (
  fields: Array<FormField>,
  customFieldId: string,
) => FormField | undefined;

// The question that asks for one of the target's custom fields, if any.
export const findCustomFieldField: FindCustomFieldFieldFunction = (
  fields: Array<FormField>,
  customFieldId: string,
): FormField | undefined => {
  const id: string = customFieldId.toLowerCase();

  return fields.find((field: FormField): boolean => {
    return (
      field.source === FormFieldSource.TargetCustomField &&
      field.customFieldId === id
    );
  });
};

export type FindSubmitterFieldFunction = (
  fields: Array<FormField>,
  submitterField: FormSubmitterField,
) => FormField | undefined;

// The question that asks for the submitter's name or email, if any.
export const findSubmitterField: FindSubmitterFieldFunction = (
  fields: Array<FormField>,
  submitterField: FormSubmitterField,
): FormField | undefined => {
  return fields.find((field: FormField): boolean => {
    return (
      field.source === FormFieldSource.Submitter &&
      field.submitterField === submitterField
    );
  });
};
