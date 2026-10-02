/*
 * The words around an incident SLA rule's note reminder templates
 * (Incidents -> Settings -> SLA Rules, the Note Reminders step).
 *
 * The two template fields used to name five of the eight variables the
 * worker fills, run into one line above the editor. The variables are now
 * under the editor, every one of them
 * (Common/Utils/Incident/IncidentSlaNoteTemplateVariables), so the field says
 * what it is for instead.
 *
 * Kept in one React-free module so App/Tests/Dashboard/TemplateVariablesI18n
 * can check that each has an entry in all seventeen Dashboard locale files.
 * No string here may contain "{{": the translation lookup would read it as a
 * placeholder of its own.
 */

export const IncidentSlaNoteReminderCopy: {
  templateFieldDescription: string;
  templateVariablesDescription: string;
} = {
  templateFieldDescription:
    "The note posted at each interval, in Markdown. Leave it empty to use the default reminder.",
  templateVariablesDescription:
    "When a reminder is posted, these variables are filled in with the incident's values at that moment.",
};

export default IncidentSlaNoteReminderCopy;
