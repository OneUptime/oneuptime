import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import {
  TemplateVariable,
  TemplateVariableGroup,
} from "Common/Types/Template/TemplateVariable";

/*
 * The variables a custom subscriber notification template can use, for each
 * event type - described once, here, and shown two ways:
 *
 *   - as the markdown reference table of a template's Template Variables
 *     Reference card (getSubscriberNotificationTemplateVariablesDocumentation);
 *   - as the template editor's Template variables, under the body and the
 *     email subject, each a click (or a "{{") away from going in where the
 *     cursor is (getSubscriberNotificationTemplateVariableGroups).
 *
 * The descriptions are English and are shown as they are: the reference is
 * markdown, and the editor's list looks them up like any label, finding no
 * translation.
 */

export interface SubscriberTemplateVariableRow {
  name: string;
  description: string;
}

const STATUS_PAGE_ROWS: Array<SubscriberTemplateVariableRow> = [
  { name: "statusPageName", description: "Name of the status page" },
  { name: "statusPageUrl", description: "URL of the status page" },
  {
    name: "unsubscribeUrl",
    description: "URL for subscribers to unsubscribe from notifications",
  },
];

const RESOURCES_AFFECTED_ROW: SubscriberTemplateVariableRow = {
  name: "resourcesAffected",
  description: "List of affected resources/monitors",
};

/*
 * Every incident event also offers the incident's labels, the status pages
 * it is on, and its custom fields (see SubscriberNotificationTemplateVariables).
 */
const INCIDENT_ROWS: Array<SubscriberTemplateVariableRow> = [
  {
    name: "incidentLabels",
    description: "Labels of the incident, separated by commas",
  },
  {
    name: "affectedStatusPages",
    description:
      "Names of every status page the incident is shown on, separated by commas",
  },
];

/*
 * The custom fields are a family of variables, one per field, so the
 * reference documents them as one row with the key left open, named after
 * the incident as in a note template: {{incident.customFields.<key>}}. The
 * template form lists the project's fields and their variables themselves.
 * Templates saved with the older {{customFields.<key>}} are still filled, but
 * it is not shown here.
 */
const INCIDENT_CUSTOM_FIELDS_ROW_MARKDOWN: string =
  "| `{{incident.customFields.<key>}}` | The value of an incident custom field. Each field's variable is listed below |";

// The variables only one kind of event offers, in the order the reference lists them.
const EVENT_ROWS: Record<
  StatusPageSubscriberNotificationEventType,
  Array<SubscriberTemplateVariableRow>
> = {
  [StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation]:
    [
      {
        name: "confirmationUrl",
        description: "URL the subscriber clicks to confirm their subscription",
      },
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberSubscribed]: [
    {
      name: "statusPageUrl",
      description:
        "URL of the status page (also covered by the common variables above)",
    },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberManageSubscription]: [
    {
      name: "manageSubscriptionUrl",
      description:
        "URL the subscriber uses to manage or unsubscribe from notifications",
    },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated]: [
    { name: "incidentTitle", description: "Title of the incident" },
    { name: "incidentDescription", description: "Description of the incident" },
    { name: "incidentSeverity", description: "Severity level of the incident" },
    { name: "detailsUrl", description: "URL to view incident details" },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged]: [
    { name: "incidentTitle", description: "Title of the incident" },
    { name: "incidentDescription", description: "Description of the incident" },
    { name: "incidentSeverity", description: "Severity level of the incident" },
    {
      name: "incidentState",
      description:
        "Current state of the incident (e.g., Investigating, Identified, Resolved)",
    },
    { name: "detailsUrl", description: "URL to view incident details" },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated]: [
    { name: "incidentTitle", description: "Title of the incident" },
    { name: "incidentSeverity", description: "Severity level of the incident" },
    { name: "incidentState", description: "Current state of the incident" },
    { name: "postedAt", description: "Date and time when the note was posted" },
    { name: "note", description: "Content of the note" },
    { name: "detailsUrl", description: "URL to view incident details" },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated]: [
    { name: "incidentTitle", description: "Title of the incident" },
    { name: "incidentSeverity", description: "Severity level of the incident" },
    { name: "incidentState", description: "Current state of the incident" },
    { name: "postedAt", description: "Date and time when the note was posted" },
    { name: "note", description: "Content of the note" },
    { name: "detailsUrl", description: "URL to view incident details" },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished]:
    [
      { name: "incidentTitle", description: "Title of the incident" },
      {
        name: "incidentSeverity",
        description: "Severity level of the incident",
      },
      { name: "postmortemNote", description: "Postmortem summary content" },
      { name: "detailsUrl", description: "URL to view the postmortem" },
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated]: [
    { name: "announcementTitle", description: "Title of the announcement" },
    {
      name: "announcementDescription",
      description: "Description/content of the announcement",
    },
    { name: "detailsUrl", description: "URL to view announcement details" },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated]: [
    { name: "announcementTitle", description: "Title of the announcement" },
    {
      name: "announcementDescription",
      description: "Description/content of the announcement",
    },
    { name: "detailsUrl", description: "URL to view announcement details" },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated]:
    [
      {
        name: "scheduledMaintenanceTitle",
        description: "Title of the scheduled maintenance",
      },
      {
        name: "scheduledMaintenanceDescription",
        description: "Description of the scheduled maintenance",
      },
      {
        name: "scheduledStartTime",
        description: "When the maintenance is scheduled to start",
      },
      {
        name: "scheduledEndTime",
        description: "When the maintenance is scheduled to end",
      },
      {
        name: "detailsUrl",
        description: "URL to view scheduled maintenance details",
      },
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged]:
    [
      {
        name: "scheduledMaintenanceTitle",
        description: "Title of the scheduled maintenance",
      },
      {
        name: "scheduledMaintenanceDescription",
        description: "Description of the scheduled maintenance",
      },
      {
        name: "scheduledMaintenanceState",
        description: "Current state (e.g., Scheduled, In Progress, Completed)",
      },
      {
        name: "detailsUrl",
        description: "URL to view scheduled maintenance details",
      },
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated]:
    [
      {
        name: "scheduledMaintenanceTitle",
        description: "Title of the scheduled maintenance",
      },
      {
        name: "scheduledMaintenanceDescription",
        description: "Description of the scheduled maintenance",
      },
      {
        name: "scheduledMaintenanceState",
        description: "Current state of the scheduled maintenance",
      },
      {
        name: "postedAt",
        description: "Date and time when the note was posted",
      },
      { name: "note", description: "Content of the note" },
      {
        name: "detailsUrl",
        description: "URL to view scheduled maintenance details",
      },
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated]:
    [
      {
        name: "scheduledMaintenanceTitle",
        description: "Title of the scheduled maintenance",
      },
      {
        name: "scheduledMaintenanceDescription",
        description: "Description of the scheduled maintenance",
      },
      {
        name: "scheduledMaintenanceState",
        description: "Current state of the scheduled maintenance",
      },
      {
        name: "postedAt",
        description: "Date and time when the note was posted",
      },
      { name: "note", description: "Content of the note" },
      {
        name: "detailsUrl",
        description: "URL to view scheduled maintenance details",
      },
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated]: [
    { name: "episodeTitle", description: "Title of the incident" },
    { name: "episodeDescription", description: "Description of the incident" },
    { name: "episodeSeverity", description: "Severity level of the incident" },
    { name: "detailsUrl", description: "URL to view incident details" },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged]: [
    { name: "episodeTitle", description: "Title of the incident" },
    { name: "episodeSeverity", description: "Severity level of the incident" },
    {
      name: "episodeState",
      description:
        "Current state of the incident (e.g., Investigating, Identified, Resolved)",
    },
    { name: "detailsUrl", description: "URL to view incident details" },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated]: [
    { name: "episodeTitle", description: "Title of the incident" },
    { name: "episodeSeverity", description: "Severity level of the incident" },
    { name: "note", description: "Content of the note" },
    { name: "detailsUrl", description: "URL to view incident details" },
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated]: [
    { name: "episodeTitle", description: "Title of the incident" },
    { name: "episodeSeverity", description: "Severity level of the incident" },
    { name: "note", description: "Content of the note" },
    { name: "detailsUrl", description: "URL to view incident details" },
  ],
  // The report's own reference, below, is richer than a flat list.
  [StatusPageSubscriberNotificationEventType.SubscriberReport]: [],
};

// The events about an incident, which also offer its labels, pages and fields.
const INCIDENT_EVENTS: Array<StatusPageSubscriberNotificationEventType> = [
  StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
  StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
  StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
  StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
  StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished,
];

/*
 * Messages about the subscription itself are not about any resource, so
 * they do not offer {{resourcesAffected}} (see
 * SubscriberNotificationTemplateVariables).
 */
const SUBSCRIPTION_EVENTS: Array<StatusPageSubscriberNotificationEventType> = [
  StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation,
  StatusPageSubscriberNotificationEventType.SubscriberSubscribed,
  StatusPageSubscriberNotificationEventType.SubscriberManageSubscription,
];

/*
 * The report email is rendered through the full Handlebars engine, so it
 * exposes a structured `report` object (not flat scalars) and supports
 * loops, conditionals and partials. Its top-level variables are a table
 * like any other event's; what is reached inside its loops is documented
 * after them.
 */
const REPORT_ROWS: Array<SubscriberTemplateVariableRow> = [
  { name: "statusPageName", description: "Name of the status page" },
  { name: "statusPageUrl", description: "URL of the status page" },
  { name: "detailsUrl", description: "URL to view the full status page" },
  {
    name: "unsubscribeUrl",
    description: "URL for subscribers to unsubscribe from notifications",
  },
  {
    name: "subscriberEmailNotificationFooterText",
    description: "Custom footer text configured for the status page",
  },
  {
    name: "report.reportDates",
    description:
      'The reporting period as a range (e.g. "30 days (Jun 29, 2026 - Jul 29, 2026)" for a rolling window, "Jul 1, 2026 - Jul 31, 2026" for a calendar one)',
  },
  {
    name: "report.reportPeriodName",
    description:
      'How a sentence refers to the period — "the last 30 days", "July 2026", "the week of Jul 27, 2026"',
  },
  {
    name: "report.reportStartDate",
    description: 'First day of the period (e.g. "Jul 1, 2026")',
  },
  {
    name: "report.reportEndDate",
    description: 'Last day of the period (e.g. "Jul 31, 2026")',
  },
  {
    name: "report.reportTimezone",
    description:
      'The timezone every date above was resolved in (e.g. "America/New_York")',
  },
  {
    name: "report.averageUptimePercent",
    description: 'Average uptime across all resources (e.g. "99.95%")',
  },
  {
    name: "report.totalDowntimeInHoursAndMinutes",
    description: "Total downtime in the period",
  },
  {
    name: "report.totalIncidents",
    description: "Total number of incidents in the period",
  },
  {
    name: "report.totalResources",
    description: "Number of resources on the status page",
  },
  {
    name: "report.resources",
    description: "Array of per-resource breakdown rows, flat (loop over this)",
  },
  {
    name: "report.hasGroups",
    description:
      "`true` when the status page organises its resources into groups",
  },
  {
    name: "report.rows",
    description:
      "The group hierarchy flattened into render order — group rows and resource rows interleaved (loop over this)",
  },
  {
    name: "report.groups",
    description: "The group hierarchy as a nested tree (top level groups)",
  },
  {
    name: "report.ungroupedResources",
    description: "Resources that are not in any group",
  },
];

// Inside the report's loops: the fields of each resource, row and group, and an example.
export const SUBSCRIBER_REPORT_LOOP_DOCUMENTATION: string = `**Per-resource fields** (available inside \`{{#each report.resources}}\`):

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

type IsEventFunction = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
) => boolean;

export const isIncidentSubscriberNotificationEvent: IsEventFunction = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
): boolean => {
  return Boolean(eventType && INCIDENT_EVENTS.includes(eventType));
};

const isSubscriptionEvent: IsEventFunction = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
): boolean => {
  return Boolean(eventType && SUBSCRIPTION_EVENTS.includes(eventType));
};

const isReportEvent: IsEventFunction = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
): boolean => {
  return (
    eventType === StatusPageSubscriberNotificationEventType.SubscriberReport
  );
};

type RowsToMarkdownFunction = (
  rows: Array<SubscriberTemplateVariableRow>,
) => string;

const rowsToMarkdown: RowsToMarkdownFunction = (
  rows: Array<SubscriberTemplateVariableRow>,
): string => {
  return rows
    .map((row: SubscriberTemplateVariableRow): string => {
      return `| \`{{${row.name}}}\` | ${row.description} |`;
    })
    .join("\n");
};

// The variables every message about something offers: the status page's, and what it is about.
const commonRows: (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
) => Array<SubscriberTemplateVariableRow> = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
): Array<SubscriberTemplateVariableRow> => {
  return isSubscriptionEvent(eventType)
    ? STATUS_PAGE_ROWS
    : [...STATUS_PAGE_ROWS, RESOURCES_AFFECTED_ROW];
};

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
  if (!eventType) {
    return `**Available Template Variables**

Please select an **Event Type** above to see all available variables for that event.

| Variable | Description |
|----------|-------------|
${rowsToMarkdown(commonRows(undefined))}`;
  }

  if (isReportEvent(eventType)) {
    return `**Available Template Variables** - The report template is rendered with Handlebars, so you can use loops and conditionals in addition to \`{{variableName}}\` substitution.

| Variable | Description |
|----------|-------------|
${rowsToMarkdown(REPORT_ROWS)}

${SUBSCRIBER_REPORT_LOOP_DOCUMENTATION}`;
  }

  const eventRows: Array<SubscriberTemplateVariableRow> | undefined =
    EVENT_ROWS[eventType];

  if (!eventRows) {
    return `**Available Template Variables**

Please select an event type to see available variables.`;
  }

  const eventSpecificRows: string = isIncidentSubscriberNotificationEvent(
    eventType,
  )
    ? `${rowsToMarkdown([...eventRows, ...INCIDENT_ROWS])}
${INCIDENT_CUSTOM_FIELDS_ROW_MARKDOWN}`
    : rowsToMarkdown(eventRows);

  return `**Available Template Variables** - Use these variables in your template with the \`{{variableName}}\` syntax.

| Variable | Description |
|----------|-------------|
${rowsToMarkdown(commonRows(eventType))}
${eventSpecificRows}`;
};

// Group titles in the template editor's list; each is looked up in the page's language.
export const SUBSCRIBER_TEMPLATE_STATUS_PAGE_GROUP_TITLE: string =
  "Status Page";

type EventGroupTitleFunction = (
  eventType: StatusPageSubscriberNotificationEventType,
) => string | undefined;

const eventGroupTitle: EventGroupTitleFunction = (
  eventType: StatusPageSubscriberNotificationEventType,
): string | undefined => {
  if (isIncidentSubscriberNotificationEvent(eventType)) {
    return "Incident";
  }

  if (eventType.includes("Episode")) {
    return "Incident Episode";
  }

  if (eventType.includes("Scheduled Maintenance")) {
    return "Scheduled Maintenance";
  }

  if (eventType.includes("Announcement")) {
    return "Announcement";
  }

  return undefined;
};

type RowsToVariablesFunction = (
  rows: Array<SubscriberTemplateVariableRow>,
  taken: Set<string>,
) => Array<TemplateVariable>;

// The rows as variables to pick, each name once.
const rowsToVariables: RowsToVariablesFunction = (
  rows: Array<SubscriberTemplateVariableRow>,
  taken: Set<string>,
): Array<TemplateVariable> => {
  const variables: Array<TemplateVariable> = [];

  for (const row of rows) {
    if (taken.has(row.name)) {
      continue;
    }

    taken.add(row.name);
    variables.push({
      name: row.name,
      // The table's markdown, as plain words.
      description: row.description.replace(/`/g, ""),
    });
  }

  return variables;
};

/**
 * The variables a template for this event can use, grouped as the template
 * editor lists them: the status page's, then the event's own. The incident
 * custom fields are the project's, so the form adds them itself; the report's
 * loop fields are not variables to pick, and are in
 * SUBSCRIBER_REPORT_LOOP_DOCUMENTATION.
 */
export const getSubscriberNotificationTemplateVariableGroups: (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
) => Array<TemplateVariableGroup> = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
): Array<TemplateVariableGroup> => {
  const taken: Set<string> = new Set<string>();

  if (isReportEvent(eventType)) {
    return [{ variables: rowsToVariables(REPORT_ROWS, taken) }];
  }

  const groups: Array<TemplateVariableGroup> = [
    {
      title: SUBSCRIBER_TEMPLATE_STATUS_PAGE_GROUP_TITLE,
      variables: rowsToVariables(commonRows(eventType), taken),
    },
  ];

  if (!eventType) {
    return groups;
  }

  const eventVariables: Array<TemplateVariable> = rowsToVariables(
    isIncidentSubscriberNotificationEvent(eventType)
      ? [...(EVENT_ROWS[eventType] || []), ...INCIDENT_ROWS]
      : EVENT_ROWS[eventType] || [],
    taken,
  );

  if (eventVariables.length > 0) {
    groups.push({
      title: eventGroupTitle(eventType),
      variables: eventVariables,
    });
  }

  return groups;
};
