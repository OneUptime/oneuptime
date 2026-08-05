import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";

/**
 * Returns markdown documentation listing the template variables available for
 * the given event type. The actual default-template content is rendered
 * separately in the form (see SubscriberNotificationTemplateDefaults), so this
 * function focuses on the variable reference table only.
 */
export const getSubscriberNotificationTemplateVariablesDocumentation: (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  notificationMethod?: StatusPageSubscriberNotificationMethod | undefined,
) => string = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  _notificationMethod?: StatusPageSubscriberNotificationMethod | undefined,
): string => {
  const commonVariablesRows: string = `| \`{{statusPageName}}\` | Name of the status page |
| \`{{statusPageUrl}}\` | URL of the status page |
| \`{{unsubscribeUrl}}\` | URL for subscribers to unsubscribe from notifications |
| \`{{resourcesAffected}}\` | List of affected resources/monitors |`;

  if (!eventType) {
    return `**Available Template Variables**

Please select an **Event Type** above to see all available variables for that event.

| Variable | Description |
|----------|-------------|
${commonVariablesRows}`;
  }

  let eventSpecificRows: string = "";

  switch (eventType) {
    case StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation:
      eventSpecificRows = `| \`{{confirmationUrl}}\` | URL the subscriber clicks to confirm their subscription |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberSubscribed:
      eventSpecificRows = `| \`{{statusPageUrl}}\` | URL of the status page (also covered by the common variables above) |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberManageSubscription:
      eventSpecificRows = `| \`{{manageSubscriptionUrl}}\` | URL the subscriber uses to manage or unsubscribe from notifications |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentDescription}}\` | Description of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentDescription}}\` | Description of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{incidentState}}\` | Current state of the incident (e.g., Investigating, Identified, Resolved) |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{incidentState}}\` | Current state of the incident |
| \`{{postedAt}}\` | Date and time when the note was posted |
| \`{{note}}\` | Content of the note |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{postmortemNote}}\` | Postmortem summary content |
| \`{{detailsUrl}}\` | URL to view the postmortem |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated:
      eventSpecificRows = `| \`{{announcementTitle}}\` | Title of the announcement |
| \`{{announcementDescription}}\` | Description/content of the announcement |
| \`{{detailsUrl}}\` | URL to view announcement details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated:
      eventSpecificRows = `| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceDescription}}\` | Description of the scheduled maintenance |
| \`{{scheduledStartTime}}\` | When the maintenance is scheduled to start |
| \`{{scheduledEndTime}}\` | When the maintenance is scheduled to end |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged:
      eventSpecificRows = `| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceDescription}}\` | Description of the scheduled maintenance |
| \`{{scheduledMaintenanceState}}\` | Current state (e.g., Scheduled, In Progress, Completed) |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated:
      eventSpecificRows = `| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceState}}\` | Current state of the scheduled maintenance |
| \`{{postedAt}}\` | Date and time when the note was posted |
| \`{{note}}\` | Content of the note |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated:
      eventSpecificRows = `| \`{{episodeTitle}}\` | Title of the incident |
| \`{{episodeDescription}}\` | Description of the incident |
| \`{{episodeSeverity}}\` | Severity level of the incident |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged:
      eventSpecificRows = `| \`{{episodeTitle}}\` | Title of the incident |
| \`{{episodeSeverity}}\` | Severity level of the incident |
| \`{{episodeState}}\` | Current state of the incident (e.g., Investigating, Identified, Resolved) |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated:
      eventSpecificRows = `| \`{{episodeTitle}}\` | Title of the incident |
| \`{{episodeSeverity}}\` | Severity level of the incident |
| \`{{note}}\` | Content of the note |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberReport:
      /*
       * The report email is rendered through the full Handlebars engine, so it
       * exposes a structured `report` object (not flat scalars) and supports
       * loops, conditionals and partials. Return a dedicated doc rather than the
       * common flat-variable table.
       */
      return `**Available Template Variables** - The report template is rendered with Handlebars, so you can use loops and conditionals in addition to \`{{variableName}}\` substitution.

| Variable | Description |
|----------|-------------|
| \`{{statusPageName}}\` | Name of the status page |
| \`{{statusPageUrl}}\` | URL of the status page |
| \`{{detailsUrl}}\` | URL to view the full status page |
| \`{{unsubscribeUrl}}\` | URL for subscribers to unsubscribe from notifications |
| \`{{subscriberEmailNotificationFooterText}}\` | Custom footer text configured for the status page |
| \`{{report.reportDates}}\` | The reporting period as a range (e.g. "30 days (Jun 29, 2026 - Jul 29, 2026)" for a rolling window, "Jul 1, 2026 - Jul 31, 2026" for a calendar one) |
| \`{{report.reportPeriodName}}\` | How a sentence refers to the period — "the last 30 days", "July 2026", "the week of Jul 27, 2026" |
| \`{{report.reportStartDate}}\` | First day of the period (e.g. "Jul 1, 2026") |
| \`{{report.reportEndDate}}\` | Last day of the period (e.g. "Jul 31, 2026") |
| \`{{report.reportTimezone}}\` | The timezone every date above was resolved in (e.g. "America/New_York") |
| \`{{report.averageUptimePercent}}\` | Average uptime across all resources (e.g. "99.95%") |
| \`{{report.totalDowntimeInHoursAndMinutes}}\` | Total downtime in the period |
| \`{{report.totalIncidents}}\` | Total number of incidents in the period |
| \`{{report.totalResources}}\` | Number of resources on the status page |
| \`{{report.resources}}\` | Array of per-resource breakdown rows, flat (loop over this) |
| \`{{report.hasGroups}}\` | \`true\` when the status page organises its resources into groups |
| \`{{report.rows}}\` | The group hierarchy flattened into render order — group rows and resource rows interleaved (loop over this) |
| \`{{report.groups}}\` | The group hierarchy as a nested tree (top level groups) |
| \`{{report.ungroupedResources}}\` | Resources that are not in any group |

**Per-resource fields** (available inside \`{{#each report.resources}}\`):

| Variable | Description |
|----------|-------------|
| \`{{this.resourceName}}\` | Name of the resource/monitor |
| \`{{this.uptimePercentAsString}}\` | Uptime for the resource (e.g. "99.9%") |
| \`{{this.downtimeInHoursAndMinutes}}\` | Downtime for the resource |
| \`{{this.totalIncidentCount}}\` | Number of incidents for the resource |
| \`{{this.groupName}}\` | Group the resource sits in (empty when ungrouped) |
| \`{{this.groupPath}}\` | Full group path, e.g. "Region 001 / Market 001 / Unit 0660" |

**Row fields** (available inside \`{{#each report.rows}}\`) — use these to reproduce the status page's nested group hierarchy without recursion:

| Variable | Description |
|----------|-------------|
| \`{{this.isGroup}}\` | \`true\` for a group header row, \`false\` for a resource row |
| \`{{this.name}}\` | Group name or resource name |
| \`{{this.depth}}\` | Nesting level — 0 for a top level group |
| \`{{this.indentInPixels}}\` | Indent to render the row with (16px per level) |
| \`{{this.uptimePercentAsString}}\` | Uptime — rolled up over the whole subtree on a group row |
| \`{{this.downtimeInHoursAndMinutes}}\` | Downtime for the row |
| \`{{this.totalIncidentCount}}\` | Incidents for the row |
| \`{{this.totalResources}}\` | Resources a group rolls up (0 on a resource row) |

**Group fields** (available inside \`{{#each report.groups}}\`): \`{{this.groupName}}\`, \`{{this.groupPath}}\`, \`{{this.depth}}\`, \`{{this.uptimePercentAsString}}\`, \`{{this.downtimeInHoursAndMinutes}}\`, \`{{this.totalIncidentCount}}\`, \`{{this.totalResources}}\`, \`{{this.resources}}\` (the group's own resources) and \`{{this.subGroups}}\` (groups nested under it).

**Example — loop and conditional:**

\`\`\`handlebars
{{#if report.totalResources}}
  {{#each report.rows}}
    {{#if this.isGroup}}
[group] {{this.name}}: {{this.uptimePercentAsString}} uptime
    {{else}}
{{this.name}}: {{this.uptimePercentAsString}} uptime
    {{/if}}
  {{/each}}
{{else}}
  No resources to report this period.
{{/if}}
\`\`\`

You may also use OneUptime's email partials (e.g. \`{{> Start this}}\`, \`{{> Footer this}}\`, \`{{> End this}}\`) if you want the standard chrome.`;

    default:
      return `**Available Template Variables**

Please select an event type to see available variables.`;
  }

  return `**Available Template Variables** - Use these variables in your template with the \`{{variableName}}\` syntax.

| Variable | Description |
|----------|-------------|
${commonVariablesRows}
${eventSpecificRows}`;
};
