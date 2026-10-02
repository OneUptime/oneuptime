/*
 * The text the dashboard shows where it decides which incident custom fields
 * are asked for when an incident is declared from a template (issue #4114):
 * an incident template's "Custom Fields on Create" card
 * (IncidentCustomFieldSettingsCard) and wizard step; the values behind the
 * labels are Common/Types/CustomField/CustomFieldCreateSettings.
 *
 * Kept in one module free of React and of the dashboard's UI code, so the
 * card, the wizard and App/Tests/Dashboard/IncidentCustomFieldCreateSettingsI18n
 * all read these exact strings - the dashboard translates a string by looking
 * up its English text, so a string with no entry in the seventeen Dashboard
 * locale files silently stays English.
 *
 * No string here may contain "{{": the translation lookup would read it as
 * one of its own placeholders. That is also why "Default (Required)" and its
 * two siblings are whole strings rather than "Default ({{setting}})".
 */

/*
 * The step of a new incident template that holds its settings. Its own step,
 * after the one that fills in the template's custom field VALUES
 * (INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID): a value and whether the field is
 * asked for are separate choices.
 */
export const INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID: string =
  "custom-field-settings";
export const INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE: string =
  "Custom Fields on Create";

export const IncidentCustomFieldCreateSettingsCopy: {
  // An incident template: the card on its page, and the wizard step.
  templateTitle: string;
  templateDescription: string;
  templateEditButton: string;
  /*
   * "Default", saying what the field does without a setting of its own - the
   * project's Show on Create and Required on Create.
   */
  templateDefaultRequired: string;
  templateDefaultOptional: string;
  templateDefaultNotShown: string;
  /*
   * The same, beside a setting of the template's own: what the field does
   * when the template leaves it alone.
   */
  templateProjectDefaultRequired: string;
  templateProjectDefaultOptional: string;
  templateProjectDefaultNotShown: string;
  templateHidden: string;
  templateNotFound: string;

  required: string;
  optional: string;
} = {
  templateTitle: INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE,
  templateDescription:
    "Choose which custom fields the Details step asks for when an incident is declared from this template, and which of them must be filled in. Fields left on Default follow their own Show on Create and Required on Create settings.",
  templateEditButton: "Edit Custom Fields on Create",
  templateDefaultRequired: "Default (Required)",
  templateDefaultOptional: "Default (Optional)",
  templateDefaultNotShown: "Default (Not Shown)",
  templateProjectDefaultRequired: "Project default: Required",
  templateProjectDefaultOptional: "Project default: Optional",
  templateProjectDefaultNotShown: "Project default: Not Shown",
  templateHidden: "Hidden",
  templateNotFound:
    "This template's custom field settings could not be loaded. The template may have been deleted.",

  required: "Required",
  optional: "Optional",
};

export default IncidentCustomFieldCreateSettingsCopy;
