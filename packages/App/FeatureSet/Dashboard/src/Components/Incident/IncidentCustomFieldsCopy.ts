/*
 * The text the dashboard shows where incident custom field values are asked
 * for or filled in outside the Custom Fields card: the Details step of
 * declaring an incident, an incident template's custom field values, and the
 * placeholders of a note template.
 *
 * Kept in one module free of React and of the dashboard's UI code, so the
 * pages render these exact strings and App/Tests/Dashboard/
 * IncidentCustomFieldsI18n can check that each has an entry in all seventeen
 * Dashboard locale files - the dashboard translates a string
 * by looking up its English text, so a string with no entry silently stays
 * English. (The placeholder list itself is in
 * Common/Utils/Incident/IncidentNoteTemplateVariables, and is checked too.)
 *
 * No string here may contain "{{": the translation lookup would read it as
 * one of its own placeholders.
 */

/*
 * The Details step of declaring an incident (the fields marked "Show on
 * Create"), and the step of a new incident template that sets its custom
 * field values. A step's title is its English text.
 */
export const INCIDENT_DETAILS_STEP_ID: string = "custom-field-details";
export const INCIDENT_DETAILS_STEP_TITLE: string = "Details";
export const INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID: string = "custom-fields";
export const INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_TITLE: string =
  "Custom Fields";

export const IncidentCustomFieldsCopy: {
  detailsStepTitle: string;
  templateCustomFieldsStepTitle: string;
  templateCustomFieldsCardTitle: string;
  templateCustomFieldsCardDescription: string;
  noteTemplatePlaceholdersIntro: string;
} = {
  detailsStepTitle: INCIDENT_DETAILS_STEP_TITLE,
  templateCustomFieldsStepTitle: INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_TITLE,
  templateCustomFieldsCardTitle: "Custom Fields",
  templateCustomFieldsCardDescription:
    "The custom field values an incident declared from this template starts with. Fields asked for in the Details step can still be changed when the incident is declared.",
  noteTemplatePlaceholdersIntro:
    "When this template is used in an incident's notes, these placeholders are filled in with the incident's values. A placeholder with no value stays as written.",
};

export default IncidentCustomFieldsCopy;
