/*
 * The text under a subscriber notification template's variable reference
 * for an incident event: who may place custom fields and labels, and the
 * project's incident custom fields with the template variable each is
 * placed by (IncidentCustomFieldTemplateVariables).
 *
 * Kept in one React-free module so the component renders these exact strings
 * and App/Tests/Dashboard/IncidentCustomFieldTemplateVariablesI18n can check
 * that each has an entry in all seventeen Dashboard locale files - the
 * dashboard translates a string by looking up its English text, so a string
 * with no entry silently stays English.
 *
 * No string here may contain "{{": the translation lookup would read it as a
 * placeholder of its own. The variables themselves are shown as code, outside
 * the lookup.
 */

export const IncidentCustomFieldTemplateVariablesCopy: {
  placementPermission: string;
  customFieldsTitle: string;
  customFieldsDescription: string;
  variableColumnTitle: string;
  fieldNameColumnTitle: string;
  fieldTypeColumnTitle: string;
  includedColumnTitle: string;
  yes: string;
  no: string;
  noCustomFields: string;
  customFieldsUnavailable: string;
} = {
  // The save refuses it otherwise (SubscriberTemplateIncidentRecordAccess).
  placementPermission:
    "Only someone who can read every incident and its custom fields can save a template that places a custom field or the incident's labels. The status page roles on their own cannot add them.",
  customFieldsTitle: "Incident Custom Fields",
  customFieldsDescription:
    "Place a field's value in this template with its template variable. A field the incident has no value for is left empty. Fields with Include in Subscriber Notifications turned on are already in the default email, Slack, Microsoft Teams and webhook messages; the default SMS is kept short and leaves them out.",
  variableColumnTitle: "Template Variable",
  fieldNameColumnTitle: "Field Name",
  fieldTypeColumnTitle: "Field Type",
  includedColumnTitle: "In Subscriber Notifications",
  yes: "Yes",
  no: "No",
  noCustomFields: "This project has no incident custom fields.",
  customFieldsUnavailable:
    "The project's incident custom fields could not be loaded. Reading them needs permission to view incident custom fields and a plan that includes custom fields.",
};

export default IncidentCustomFieldTemplateVariablesCopy;
