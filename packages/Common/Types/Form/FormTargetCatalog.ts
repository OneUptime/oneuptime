import CustomFieldType from "../CustomField/CustomFieldType";
import ColumnLength from "../Database/ColumnLength";
import FormTargetType from "./FormTargetType";

/*
 * The built-in fields of each target that a form can ask for: the "Incident
 * fields" and "Scheduled maintenance fields" of the form builder's palette.
 * A question added from here is linked to that field, and its answer becomes
 * the field's value on the record the submission creates.
 *
 * Everything else about a target - its custom fields, its settings that are
 * never asked (owners, a template, on-call policies) - lives elsewhere: the
 * custom fields are read from the project, and the settings are the form's
 * targetSettings (FormTargetSettings).
 *
 * Pure, with no database or React imports: the server checks a form's
 * fields against it, and the dashboard's builder draws its palette from it.
 */

/*
 * Where a choice field's options come from: the project's records of one
 * kind. The answer is the record's id.
 */
export enum FormTargetOptionsSource {
  IncidentSeverity = "IncidentSeverity",
  Monitor = "Monitor",
  Label = "Label",
  StatusPage = "StatusPage",
}

export interface FormTargetFieldDefinition {
  // The record's property the answer is written to, e.g. "title".
  key: string;
  // The field's own name, as the palette and the On Submit page show it.
  title: string;
  // What the palette says about it.
  description: string;
  // The label a new question for it starts with; the admin can change it.
  defaultLabel: string;
  // The help text a new question for it starts with, if any.
  defaultHelpText?: string | undefined;
  /*
   * How it is answered. Text, Markdown and DateTime answer with a value;
   * Dropdown and MultiSelectDropdown with the id of one or more of the
   * project's records (optionsSource).
   */
  inputType: CustomFieldType;
  // The longest text answer the record's column can hold.
  maxLength?: number | undefined;
  optionsSource?: FormTargetOptionsSource | undefined;
  /*
   * Whether the admin must pick which records the public page offers. A
   * monitor's, label's or status page's name is the project's own business:
   * a public form lists only the ones somebody chose to put on it.
   * Severities are what a reporter is asked about, and are offered all
   * together unless the admin narrows them.
   */
  mustChooseOptions?: boolean | undefined;
  // The record cannot exist without a value for it.
  isRequiredByTarget: boolean;
  /*
   * Whether the form's On Submit settings can supply the value when the
   * form does not ask for it, or the submitter leaves it empty. A field
   * that is required by the target and has no default must be asked, and
   * must be required, on every form of that target.
   */
  hasDefault: boolean;
}

// The longest title an incident takes: Incident.title is a varchar(500).
export const FORM_INCIDENT_TITLE_MAX_LENGTH: number = ColumnLength.LongText;

/*
 * The longest title a scheduled maintenance event takes:
 * ScheduledMaintenance.title is a varchar(100).
 */
export const FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH: number =
  ColumnLength.ShortText;

/*
 * The longest description a submission writes. The record's column is
 * text, but a description is read in emails, chat messages and on status
 * pages, and the request body may be up to 50 MB.
 */
export const FORM_DESCRIPTION_MAX_LENGTH: number = 20000;

const INCIDENT_FIELDS: Array<FormTargetFieldDefinition> = [
  {
    key: "title",
    title: "Title",
    description: "A one-line summary that becomes the incident's title.",
    defaultLabel: "Title",
    defaultHelpText: "A short summary of what is wrong.",
    inputType: CustomFieldType.Text,
    maxLength: FORM_INCIDENT_TITLE_MAX_LENGTH,
    isRequiredByTarget: true,
    hasDefault: true,
  },
  {
    key: "description",
    title: "Description",
    description: "Rich text that becomes the incident's description.",
    defaultLabel: "Description",
    defaultHelpText: "What happened, who is affected and what you have tried.",
    inputType: CustomFieldType.Markdown,
    maxLength: FORM_DESCRIPTION_MAX_LENGTH,
    isRequiredByTarget: false,
    hasDefault: false,
  },
  {
    key: "incidentSeverityId",
    title: "Severity",
    description: "The submitter picks one of your incident severities.",
    defaultLabel: "Severity",
    inputType: CustomFieldType.Dropdown,
    optionsSource: FormTargetOptionsSource.IncidentSeverity,
    mustChooseOptions: false,
    isRequiredByTarget: true,
    hasDefault: true,
  },
  {
    key: "monitors",
    title: "Monitors",
    description:
      "The submitter picks the affected monitors from a list you choose.",
    defaultLabel: "Affected Monitors",
    inputType: CustomFieldType.MultiSelectDropdown,
    optionsSource: FormTargetOptionsSource.Monitor,
    mustChooseOptions: true,
    isRequiredByTarget: false,
    hasDefault: true,
  },
  {
    key: "labels",
    title: "Labels",
    description: "The submitter picks labels from a list you choose.",
    defaultLabel: "Labels",
    inputType: CustomFieldType.MultiSelectDropdown,
    optionsSource: FormTargetOptionsSource.Label,
    mustChooseOptions: true,
    isRequiredByTarget: false,
    hasDefault: true,
  },
  {
    key: "impactStartedAt",
    title: "Impact Started At",
    description: "When the problem started, as the submitter remembers it.",
    defaultLabel: "When did it start?",
    inputType: CustomFieldType.DateTime,
    isRequiredByTarget: false,
    hasDefault: false,
  },
];

const SCHEDULED_MAINTENANCE_FIELDS: Array<FormTargetFieldDefinition> = [
  {
    key: "title",
    title: "Title",
    description:
      "A one-line summary that becomes the scheduled maintenance event's title.",
    defaultLabel: "Title",
    defaultHelpText: "A short summary of the maintenance.",
    inputType: CustomFieldType.Text,
    maxLength: FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
    isRequiredByTarget: true,
    hasDefault: true,
  },
  {
    key: "description",
    title: "Description",
    description:
      "Rich text that becomes the scheduled maintenance event's description.",
    defaultLabel: "Description",
    defaultHelpText: "What will change, and what people should expect.",
    inputType: CustomFieldType.Markdown,
    maxLength: FORM_DESCRIPTION_MAX_LENGTH,
    isRequiredByTarget: false,
    hasDefault: false,
  },
  {
    key: "startsAt",
    title: "Starts At",
    description: "When the maintenance starts.",
    defaultLabel: "Starts At",
    inputType: CustomFieldType.DateTime,
    isRequiredByTarget: true,
    hasDefault: false,
  },
  {
    key: "endsAt",
    title: "Ends At",
    description: "When the maintenance ends.",
    defaultLabel: "Ends At",
    inputType: CustomFieldType.DateTime,
    isRequiredByTarget: true,
    hasDefault: false,
  },
  {
    key: "monitors",
    title: "Monitors",
    description:
      "The submitter picks the affected monitors from a list you choose.",
    defaultLabel: "Affected Monitors",
    inputType: CustomFieldType.MultiSelectDropdown,
    optionsSource: FormTargetOptionsSource.Monitor,
    mustChooseOptions: true,
    isRequiredByTarget: false,
    hasDefault: true,
  },
  {
    key: "statusPages",
    title: "Status Pages",
    description: "The submitter picks status pages from a list you choose.",
    defaultLabel: "Status Pages",
    inputType: CustomFieldType.MultiSelectDropdown,
    optionsSource: FormTargetOptionsSource.StatusPage,
    mustChooseOptions: true,
    isRequiredByTarget: false,
    hasDefault: true,
  },
  {
    key: "labels",
    title: "Labels",
    description: "The submitter picks labels from a list you choose.",
    defaultLabel: "Labels",
    inputType: CustomFieldType.MultiSelectDropdown,
    optionsSource: FormTargetOptionsSource.Label,
    mustChooseOptions: true,
    isRequiredByTarget: false,
    hasDefault: true,
  },
];

export const FORM_TARGET_FIELDS: Readonly<
  Record<FormTargetType, ReadonlyArray<FormTargetFieldDefinition>>
> = {
  [FormTargetType.Incident]: INCIDENT_FIELDS,
  [FormTargetType.ScheduledMaintenance]: SCHEDULED_MAINTENANCE_FIELDS,
};

export type GetFormTargetFieldsFunction = (
  targetType: FormTargetType,
) => ReadonlyArray<FormTargetFieldDefinition>;

// The fields a form of this target can ask, in the palette's order.
export const getFormTargetFields: GetFormTargetFieldsFunction = (
  targetType: FormTargetType,
): ReadonlyArray<FormTargetFieldDefinition> => {
  return FORM_TARGET_FIELDS[targetType] || [];
};

export type GetFormTargetFieldFunction = (
  targetType: FormTargetType,
  key: unknown,
) => FormTargetFieldDefinition | undefined;

/** One field of a target by its key, or undefined for a key it does not have. */
export const getFormTargetField: GetFormTargetFieldFunction = (
  targetType: FormTargetType,
  key: unknown,
): FormTargetFieldDefinition | undefined => {
  if (typeof key !== "string") {
    return undefined;
  }

  return getFormTargetFields(targetType).find(
    (field: FormTargetFieldDefinition): boolean => {
      return field.key === key;
    },
  );
};

export type GetFormTargetFieldsThatMustBeAskedFunction = (
  targetType: FormTargetType,
) => Array<FormTargetFieldDefinition>;

/*
 * The fields every form of this target must ask, and require: the target
 * cannot exist without them, and nothing else can supply them.
 */
export const getFormTargetFieldsThatMustBeAsked: GetFormTargetFieldsThatMustBeAskedFunction =
  (targetType: FormTargetType): Array<FormTargetFieldDefinition> => {
    return getFormTargetFields(targetType).filter(
      (field: FormTargetFieldDefinition): boolean => {
        return field.isRequiredByTarget && !field.hasDefault;
      },
    );
  };

export type IsChoiceTargetFieldFunction = (
  field: FormTargetFieldDefinition | undefined,
) => boolean;

// Whether the field is answered by choosing records rather than typing.
export const isChoiceTargetField: IsChoiceTargetFieldFunction = (
  field: FormTargetFieldDefinition | undefined,
): boolean => {
  return Boolean(field && field.optionsSource);
};
