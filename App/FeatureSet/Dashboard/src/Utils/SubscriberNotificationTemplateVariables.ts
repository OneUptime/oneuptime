import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberNotificationTemplateVariables, {
  SubscriberNotificationTemplateVariable,
} from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";

/**
 * Returns markdown documentation listing the template variables available for
 * the given event type. The actual default-template content is rendered
 * separately in the form (see SubscriberNotificationTemplateDefaults), so this
 * function focuses on the variable reference table only. The variables come
 * from the same list the senders fill, so the table cannot promise one they
 * do not provide.
 */
export const getSubscriberNotificationTemplateVariablesDocumentation: (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  notificationMethod?: StatusPageSubscriberNotificationMethod | undefined,
) => string = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  notificationMethod?: StatusPageSubscriberNotificationMethod | undefined,
): string => {
  const toRows: (
    variables: Array<SubscriberNotificationTemplateVariable>,
  ) => string = (
    variables: Array<SubscriberNotificationTemplateVariable>,
  ): string => {
    return variables
      .map((variable: SubscriberNotificationTemplateVariable): string => {
        return `| \`{{${variable.name}}}\` | ${variable.description} |`;
      })
      .join("\n");
  };

  if (!eventType) {
    return `**Available Template Variables**

Please select an **Event Type** above to see all available variables for that event.

| Variable | Description |
|----------|-------------|
${toRows(
  SubscriberNotificationTemplateVariables.getVariables(
    StatusPageSubscriberNotificationEventType.SubscriberSubscribed,
  ),
)}`;
  }

  if (
    eventType === StatusPageSubscriberNotificationEventType.SubscriberReport
  ) {
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
  }

  const webhookNote: string =
    notificationMethod === StatusPageSubscriberNotificationMethod.Webhook
      ? `

**Webhook templates** - the template is the JSON body webhook subscribers receive. Each variable is inserted as JSON-escaped text, so put it inside double quotes, for example \`"title": "{{incidentTitle}}"\`. A template that is not a JSON object is rejected when you save it.`
      : "";

  return `**Available Template Variables** - Use these variables in your template with the \`{{variableName}}\` syntax.${webhookNote}

| Variable | Description |
|----------|-------------|
${toRows(SubscriberNotificationTemplateVariables.getVariables(eventType))}`;
};
