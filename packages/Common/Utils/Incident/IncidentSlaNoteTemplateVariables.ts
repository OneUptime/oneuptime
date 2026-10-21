import {
  TemplateVariable,
  TemplateVariableGroups,
} from "../../Types/Template/TemplateVariable";

/*
 * The {{variables}} an incident SLA rule's note reminders can use - the
 * internal and the public reminder an SLA rule posts on an interval while
 * the incident is open. The worker that posts them fills exactly these
 * (App/FeatureSet/Workers/Jobs/IncidentSla/SendNoteReminders, pinned by
 * App/Tests/Workers/Jobs/IncidentSla/SlaNoteTemplateVariables).
 *
 * The SLA rule form offers them under each reminder's editor (the Markdown
 * editor's Template variables), where they used to be five of eight names
 * run into the field's description. Each description is English, and the
 * key its translation is looked up by.
 *
 * Pure, so the worker's test and the dashboard can both import it.
 */
export const INCIDENT_SLA_NOTE_TEMPLATE_VARIABLES: ReadonlyArray<TemplateVariable> =
  [
    { name: "incidentTitle", description: "Title" },
    { name: "incidentNumber", description: "Incident Number" },
    { name: "elapsedTime", description: "Time Open" },
    { name: "slaStatus", description: "SLA Status" },
    { name: "responseDeadline", description: "Response Deadline" },
    { name: "resolutionDeadline", description: "Resolution Deadline" },
    { name: "timeToResponseDeadline", description: "Time Left to Respond" },
    { name: "timeToResolutionDeadline", description: "Time Left to Resolve" },
  ];

export const INCIDENT_SLA_NOTE_TEMPLATE_VARIABLE_GROUPS: TemplateVariableGroups =
  [{ variables: INCIDENT_SLA_NOTE_TEMPLATE_VARIABLES }];
