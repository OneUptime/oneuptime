import CustomFieldMappingSourceResource from "Common/Types/CustomField/CustomFieldMappingSourceResource";
import { CustomFieldRecordName } from "Common/Types/CustomField/CustomFieldOptionEdit";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import { CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE } from "Common/UI/Components/CustomFields/CustomFieldFormFields";

/*
 * Text the custom field settings pages show: the name of each field type (in
 * the "Field Type" picker, the table's Field Type column and its filter), the
 * incident-only settings (show and require on create, include in subscriber
 * notifications), and the card's description.
 *
 * Kept in one React-free module so the pages render these exact strings, and
 * App/Tests/Dashboard/CustomFieldSettingsI18n checks that each has an entry
 * in all seventeen Dashboard locale files - the dashboard translates a string
 * by looking up its English text, so a string with no entry silently stays
 * English.
 */

/*
 * Typed as a total Record so adding a member to CustomFieldType fails the
 * compile here rather than shipping a picker entry labelled with its own raw
 * enum key.
 */
export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  [CustomFieldType.Text]: "Text",
  [CustomFieldType.Number]: "Number",
  [CustomFieldType.Boolean]: "Boolean",
  [CustomFieldType.Dropdown]: "Dropdown (single select)",
  [CustomFieldType.MultiSelectDropdown]: "Dropdown (multi-select)",
  [CustomFieldType.Date]: "Date",
  [CustomFieldType.DateTime]: "Date and time",
  [CustomFieldType.LongText]: "Long text",
  [CustomFieldType.Markdown]: "Rich text (Markdown)",
};

export interface CustomFieldTypeOption {
  label: string;
  value: CustomFieldType;
}

/*
 * Every field type, in the enum's order, labelled for the picker. The value
 * is the enum's value, which is what a definition stores.
 */
export const getCustomFieldTypeOptions: () => Array<CustomFieldTypeOption> =
  (): Array<CustomFieldTypeOption> => {
    return Object.values(CustomFieldType).map(
      (value: CustomFieldType): CustomFieldTypeOption => {
        return {
          label: CUSTOM_FIELD_TYPE_LABELS[value] || value,
          value: value,
        };
      },
    );
  };

/*
 * A stored `customFieldType` as the settings pages name it: the picker's
 * label for a type OneUptime knows ("Dropdown (multi-select)", never
 * "MultiSelectDropdown"), the stored text itself for one it does not - so a
 * row never reads as blank - and undefined when there is no type at all.
 */
export const getCustomFieldTypeLabelForValue: (
  value: unknown,
) => string | undefined = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(CUSTOM_FIELD_TYPE_LABELS, value)) {
    return CUSTOM_FIELD_TYPE_LABELS[value as CustomFieldType];
  }

  return value;
};

/*
 * What the custom fields card says about itself. A definition whose order
 * means something (incident custom fields: the order the incident page, the
 * Details step and subscriber messages list them in) is reordered by
 * dragging its rows - there is no order to type in - and its card says so.
 */
export const CustomFieldsPageCopy: {
  description: string;
  reorderDescription: string;
} = {
  description:
    "Custom fields help you add new fields to your resources in OneUptime.",
  reorderDescription:
    "Custom fields help you add new fields to your resources in OneUptime. Drag a field to change where it appears.",
};

/*
 * The custom field form. Creating a field asks for its name, its description
 * and its type - and a dropdown's options - and nothing else: the maintainer,
 * "The only thing I should see by default is: field name, field description,
 * type. That's basically it." Whatever else a field can have is folded under
 * Advanced (an incident field's settings, and on Edit where its value is
 * copied from), and a field that copies its value from a monitor is made from
 * the card's More menu, in a dialog that asks only what such a field needs.
 */
export const CustomFieldFormCopy: {
  fieldTypeDescription: string;
  dropdownOptionsDescription: string;
  // Where a field's value comes from: the Edit form, under Advanced.
  mapValueFromTitle: string;
  mapValueFromDescription: string;
  mapValueByHand: string;
  fieldToCopyFromTitle: string;
  fieldToCopyFromDescription: string;
  // A new mapped field: the More menu item and its dialog.
  createMappedFieldTitle: string;
  createMappedFieldSubmit: string;
  // An incident field's template variable, read only, under Advanced on Edit.
  templateVariableTitle: string;
  templateVariableDescription: string;
  templateVariableNotLoaded: string;
} = {
  fieldTypeDescription:
    "Choose how data is entered for this field. Dropdown types also need a list of options below.",
  dropdownOptionsDescription:
    "Add the options that should appear in the dropdown and optionally choose a color for each value. Drag an option by its handle to change where it is listed.",
  mapValueFromTitle: "Map Value From",
  mapValueFromDescription:
    "Copy this field's value from a related resource instead of typing it in on every record. The value is filled in when a record is created and refreshed whenever the source changes.",
  mapValueByHand: "Enter values by hand",
  fieldToCopyFromTitle: "Field To Copy From",
  fieldToCopyFromDescription:
    "Only fields of the same type can be copied. Clearing the source does not clear values that were already copied.",
  createMappedFieldTitle: "Create Mapped Custom Field",
  createMappedFieldSubmit: "Create Custom Field",
  templateVariableTitle: "Template Variable",
  templateVariableDescription:
    "Use it in note templates and custom subscriber notification templates to show this field's value. It stays the same when the field is renamed.",
  templateVariableNotLoaded:
    "This field's template variable could not be loaded.",
};

/*
 * What the mapped field dialog says about the resource a field copies its
 * value from. A total Record, so a new source fails the compile here until
 * its text is written - a dialog stitched together from the source's title
 * could not be translated.
 */
export interface MappedCustomFieldSourceCopy {
  // The source's option in the Edit form's Map Value From dropdown.
  mapValueFromOption: string;
  // What the More menu item does, on hover.
  menuTooltip: string;
  // The mapped field dialog.
  dialogDescription: string;
  sourceFieldTitle: string;
  sourceFieldDescription: string;
  sourceFieldPlaceholder: string;
  noSourceFields: string;
}

export const MAPPED_CUSTOM_FIELD_SOURCE_COPY: Record<
  CustomFieldMappingSourceResource,
  MappedCustomFieldSourceCopy
> = {
  [CustomFieldMappingSourceResource.Monitor]: {
    mapValueFromOption: "Copy from a monitor custom field",
    menuTooltip:
      "A field whose value is copied from a monitor custom field instead of being typed in.",
    dialogDescription:
      "A mapped field copies its value from a monitor custom field, so nobody has to type it in. The value is filled in from the monitor and kept up to date when it changes there.",
    sourceFieldTitle: "Monitor Field",
    sourceFieldDescription:
      "The monitor custom field to copy. The new field gets its type and dropdown options.",
    sourceFieldPlaceholder: "Select a monitor custom field",
    noSourceFields:
      "There are no monitor custom fields to copy yet. Add one under Monitors > Settings > Custom Fields first.",
  },
};

/*
 * What the records of each resource's custom fields are called, by the
 * definition table, for the option editor's counts ("12 incidents have
 * it"). The model names ModelTable uses, so they are already translated;
 * App/Tests/Dashboard/CustomFieldSettingsI18n checks every definition table
 * has one.
 */
export const CUSTOM_FIELD_RECORD_NAMES: Record<string, CustomFieldRecordName> =
  {
    IncidentCustomField: { singular: "Incident", plural: "Incidents" },
    AlertCustomField: { singular: "Alert", plural: "Alerts" },
    MonitorCustomField: { singular: "Monitor", plural: "Monitors" },
    ScheduledMaintenanceCustomField: {
      singular: "Scheduled Maintenance Event",
      plural: "Scheduled Maintenance Events",
    },
    StatusPageCustomField: { singular: "Status Page", plural: "Status Pages" },
    OnCallDutyPolicyCustomField: {
      singular: "On-Call Policy",
      plural: "On-Call Policies",
    },
    TeamCustomField: { singular: "Team", plural: "Teams" },
    TeamMemberCustomField: { singular: "Team Member", plural: "Team Members" },
    InventoryItemCustomField: {
      singular: "Inventory Item",
      plural: "Inventory Items",
    },
  };

export const getCustomFieldRecordName: (
  definitionTableName: string | undefined,
) => CustomFieldRecordName | undefined = (
  definitionTableName: string | undefined,
): CustomFieldRecordName | undefined => {
  if (
    !definitionTableName ||
    !Object.prototype.hasOwnProperty.call(
      CUSTOM_FIELD_RECORD_NAMES,
      definitionTableName,
    )
  ) {
    return undefined;
  }

  return CUSTOM_FIELD_RECORD_NAMES[definitionTableName];
};

export const CUSTOM_FIELDS_DESCRIPTION: string =
  CustomFieldsPageCopy.description;

export const CUSTOM_FIELDS_REORDER_DESCRIPTION: string =
  CustomFieldsPageCopy.reorderDescription;

/*
 * The settings only an incident field has, as its form asks for them. They
 * are not columns of the settings table, which lists a field's name and type
 * only (CustomFieldDefinitionTable).
 */
export const IncidentCustomFieldSettingsCopy: {
  showOnCreateTitle: string;
  showOnCreateDescription: string;
  isRequiredOnCreateTitle: string;
  isRequiredOnCreateDescription: string;
  includeInSubscriberNotificationsTitle: string;
  includeInSubscriberNotificationsDescription: string;
  requiredBooleanMustBeChecked: string;
} = {
  showOnCreateTitle: "Show on Create",
  showOnCreateDescription:
    "Ask for this field in a Details step when an incident is declared from the dashboard. Incident templates can fill it in.",
  isRequiredOnCreateTitle: "Required on Create",
  isRequiredOnCreateDescription:
    "An incident cannot be declared from the dashboard until this field is filled in. For a Boolean field this means the box must be ticked. Incidents created by monitors, the API, Slack, Microsoft Teams or AI can still leave it empty, and it stays optional when an incident is edited later.",
  includeInSubscriberNotificationsTitle: "Include in Subscriber Notifications",
  includeInSubscriberNotificationsDescription:
    "Show this field and its value in the messages status page subscribers get about an incident: email, Slack, Microsoft Teams and webhooks. The default SMS is kept short and leaves it out. Subscribers are usually people outside your team, so only turn this on for fields that are safe to share with them.",
  requiredBooleanMustBeChecked: CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE,
};

export default IncidentCustomFieldSettingsCopy;
