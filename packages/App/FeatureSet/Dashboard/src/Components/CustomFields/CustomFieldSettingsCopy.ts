import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import { CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE } from "Common/UI/Components/CustomFields/CustomFieldFormFields";

/*
 * Text the custom field settings pages show: the name of each field type in
 * the "Field Type" picker, the incident-only settings (show and require on
 * create, include in subscriber notifications, template key), and the card's
 * description.
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

export const CUSTOM_FIELDS_DESCRIPTION: string =
  CustomFieldsPageCopy.description;

export const CUSTOM_FIELDS_REORDER_DESCRIPTION: string =
  CustomFieldsPageCopy.reorderDescription;

export const IncidentCustomFieldSettingsCopy: {
  showOnCreateTitle: string;
  showOnCreateDescription: string;
  isRequiredOnCreateTitle: string;
  isRequiredOnCreateDescription: string;
  includeInSubscriberNotificationsTitle: string;
  includeInSubscriberNotificationsDescription: string;
  includeInSubscriberNotificationsColumnTitle: string;
  variableKeyColumnTitle: string;
  variableKeyColumnDescription: string;
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
  includeInSubscriberNotificationsColumnTitle: "In Subscriber Notifications",
  variableKeyColumnTitle: "Template Variable",
  variableKeyColumnDescription:
    "Use this in a custom subscriber notification template to show the field's value. It is made from the field's name when the field is created and does not change when the field is renamed.",
  requiredBooleanMustBeChecked: CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE,
};

export default IncidentCustomFieldSettingsCopy;
