/*
 * The text under a subscriber notification template's variable reference
 * for an incident event: the warning that custom fields and the affected
 * status pages are internal data, and the project's incident custom fields
 * with the template variable each is placed by
 * (IncidentCustomFieldTemplateVariables).
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
  internalDataWarningTitle: string;
  internalDataWarning: string;
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
  internalDataWarningTitle: "Internal data",
  internalDataWarning:
    "Custom field values and the list of affected status pages come from your team's incident records. The subscribers of a status page are usually outside your team, and the affected status pages name every audience the incident reaches. Place them only in templates whose subscribers may see them.",
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
