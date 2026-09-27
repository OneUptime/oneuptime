import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import { CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE } from "Common/UI/Components/CustomFields/CustomFieldFormFields";

/*
 * Text the custom field settings pages show: the name of each field type in
 * the "Field Type" picker, and the incident-only settings (order, show and
 * require on create, include in subscriber notifications, template key).
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

// A number reads the same in every language, so it is not in the copy below.
export const SORT_ORDER_PLACEHOLDER: string = "1";

export const IncidentCustomFieldSettingsCopy: {
  sortOrderTitle: string;
  sortOrderDescription: string;
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
  sortOrderTitle: "Order",
  sortOrderDescription:
    "Where this field appears among the incident's custom fields and in the Details step when an incident is declared. Lowest first; fields without an order come after the ones that have one.",
  showOnCreateTitle: "Show on Create",
  showOnCreateDescription:
    "Ask for this field in a Details step when an incident is declared from the dashboard. Incident templates can fill it in.",
  isRequiredOnCreateTitle: "Required on Create",
  isRequiredOnCreateDescription:
    "An incident cannot be declared from the dashboard until this field is filled in. For a Boolean field this means the box must be ticked. Incidents created by monitors, the API, Slack, Microsoft Teams or AI can still leave it empty, and it stays optional when an incident is edited later.",
  includeInSubscriberNotificationsTitle: "Include in Subscriber Notifications",
  includeInSubscriberNotificationsDescription:
    "Show this field and its value in the emails status page subscribers get about an incident. Subscribers are usually people outside your team, so only turn this on for fields that are safe to share with them.",
  includeInSubscriberNotificationsColumnTitle: "In Subscriber Notifications",
  variableKeyColumnTitle: "Template Variable",
  variableKeyColumnDescription:
    "Use this in a custom subscriber notification template to show the field's value. It is made from the field's name when the field is created and does not change when the field is renamed.",
  requiredBooleanMustBeChecked: CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE,
};

export default IncidentCustomFieldSettingsCopy;
