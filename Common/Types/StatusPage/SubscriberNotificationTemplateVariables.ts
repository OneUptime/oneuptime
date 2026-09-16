import StatusPageSubscriberNotificationEventType from "./StatusPageSubscriberNotificationEventType";

/*
 * The variables a custom status page subscriber notification template can use,
 * per event type. Senders fill every one of them for their event, the
 * dashboard documents them next to the template editor, and the template
 * service reports them, so all three read this one list and cannot drift.
 *
 * Every value is text. Email, SMS, Slack and Microsoft Teams templates get it
 * as-is; a Webhook template gets it JSON-escaped (see
 * StatusPageSubscriberWebhookTemplate), so a variable belongs inside a JSON
 * string there.
 *
 * The recurring report is the exception: it is rendered with Handlebars over a
 * structured `report` object, so its entries name the top-level paths.
 */

export interface SubscriberNotificationTemplateVariable {
  name: string;
  description: string;
}

const variable: (
  name: string,
  description: string,
) => SubscriberNotificationTemplateVariable = (
  name: string,
  description: string,
): SubscriberNotificationTemplateVariable => {
  return { name, description };
};

const STATUS_PAGE_VARIABLES: Array<SubscriberNotificationTemplateVariable> = [
  variable("statusPageName", "Name of the status page"),
  variable("statusPageUrl", "URL of the status page"),
  variable("statusPageId", "ID of the status page"),
  variable(
    "unsubscribeUrl",
    "URL for subscribers to manage or unsubscribe from notifications",
  ),
];

const RESOURCE_VARIABLES: Array<SubscriberNotificationTemplateVariable> = [
  ...STATUS_PAGE_VARIABLES,
  variable("resourcesAffected", "List of affected resources/monitors"),
];

const INCIDENT_IDENTITY: Array<SubscriberNotificationTemplateVariable> = [
  variable("incidentId", "ID of the incident"),
  variable("incidentNumber", "Number of the incident (e.g. 42)"),
  variable("incidentTitle", "Title of the incident"),
];

const EPISODE_IDENTITY: Array<SubscriberNotificationTemplateVariable> = [
  variable("episodeId", "ID of the incident episode"),
  variable("episodeTitle", "Title of the incident"),
];

const SCHEDULED_MAINTENANCE_IDENTITY: Array<SubscriberNotificationTemplateVariable> =
  [
    variable("scheduledMaintenanceId", "ID of the scheduled maintenance event"),
    variable("scheduledMaintenanceTitle", "Title of the scheduled maintenance"),
    variable(
      "scheduledMaintenanceDescription",
      "Description of the scheduled maintenance",
    ),
  ];

const incidentSeverity: SubscriberNotificationTemplateVariable = variable(
  "incidentSeverity",
  "Severity level of the incident",
);
const episodeSeverity: SubscriberNotificationTemplateVariable = variable(
  "episodeSeverity",
  "Severity level of the incident",
);
const postedAt: SubscriberNotificationTemplateVariable = variable(
  "postedAt",
  "Date and time when the note was posted",
);
const note: SubscriberNotificationTemplateVariable = variable(
  "note",
  "Content of the note",
);

const detailsUrl: (
  subject: string,
) => SubscriberNotificationTemplateVariable = (
  subject: string,
): SubscriberNotificationTemplateVariable => {
  return variable("detailsUrl", `URL to view ${subject} details`);
};

const INCIDENT_NOTE_VARIABLES: Array<SubscriberNotificationTemplateVariable> = [
  ...RESOURCE_VARIABLES,
  ...INCIDENT_IDENTITY,
  incidentSeverity,
  variable("incidentState", "Current state of the incident"),
  postedAt,
  note,
  detailsUrl("incident"),
];

const EPISODE_NOTE_VARIABLES: Array<SubscriberNotificationTemplateVariable> = [
  ...RESOURCE_VARIABLES,
  ...EPISODE_IDENTITY,
  episodeSeverity,
  note,
  detailsUrl("incident"),
];

const ANNOUNCEMENT_VARIABLES: Array<SubscriberNotificationTemplateVariable> = [
  ...RESOURCE_VARIABLES,
  variable("announcementId", "ID of the announcement"),
  variable("announcementTitle", "Title of the announcement"),
  variable(
    "announcementDescription",
    "Description/content of the announcement",
  ),
  detailsUrl("announcement"),
];

const SCHEDULED_MAINTENANCE_NOTE_VARIABLES: Array<SubscriberNotificationTemplateVariable> =
  [
    ...RESOURCE_VARIABLES,
    ...SCHEDULED_MAINTENANCE_IDENTITY,
    variable(
      "scheduledMaintenanceState",
      "Current state of the scheduled maintenance",
    ),
    postedAt,
    note,
    detailsUrl("scheduled maintenance"),
  ];

const REPORT_VARIABLES: Array<SubscriberNotificationTemplateVariable> = [
  variable("statusPageName", "Name of the status page"),
  variable("statusPageUrl", "URL of the status page"),
  variable("detailsUrl", "URL to view the full status page"),
  variable(
    "unsubscribeUrl",
    "URL for subscribers to unsubscribe from notifications",
  ),
  variable(
    "subscriberEmailNotificationFooterText",
    "Custom footer text configured for the status page",
  ),
  variable("report.reportDates", "The reporting period as a range"),
  variable(
    "report.reportPeriodName",
    'How a sentence refers to the period - "the last 30 days", "July 2026"',
  ),
  variable("report.reportStartDate", "First day of the reporting period"),
  variable("report.reportEndDate", "Last day of the reporting period"),
  variable(
    "report.reportTimezone",
    "The timezone the reporting period was resolved in",
  ),
  variable(
    "report.averageUptimePercent",
    "Average uptime across all resources",
  ),
  variable(
    "report.totalDowntimeInHoursAndMinutes",
    "Total downtime in the period",
  ),
  variable("report.totalIncidents", "Total number of incidents in the period"),
  variable("report.totalResources", "Number of resources on the status page"),
  variable(
    "report.resources",
    "Array of per-resource rows (resourceName, uptimePercentAsString, downtimeInHoursAndMinutes, totalIncidentCount, groupName, groupPath) to loop over with {{#each}}",
  ),
  variable(
    "report.hasGroups",
    "true when the status page organises its resources into groups",
  ),
  variable(
    "report.rows",
    "The status page's group hierarchy flattened into render order (isGroup, name, depth, indentInPixels, uptimePercentAsString, downtimeInHoursAndMinutes, totalIncidentCount, totalResources) to loop over with {{#each}}",
  ),
  variable(
    "report.groups",
    "The group hierarchy as a nested tree (groupName, groupPath, depth, uptimePercentAsString, downtimeInHoursAndMinutes, totalIncidentCount, totalResources, resources, subGroups)",
  ),
  variable(
    "report.ungroupedResources",
    "Per-resource rows for resources that are in no group",
  ),
];

const VARIABLES_BY_EVENT_TYPE: Record<
  StatusPageSubscriberNotificationEventType,
  Array<SubscriberNotificationTemplateVariable>
> = {
  [StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation]:
    [
      ...STATUS_PAGE_VARIABLES,
      variable(
        "confirmationUrl",
        "URL the subscriber clicks to confirm their subscription",
      ),
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberSubscribed]:
    STATUS_PAGE_VARIABLES,
  [StatusPageSubscriberNotificationEventType.SubscriberManageSubscription]: [
    ...STATUS_PAGE_VARIABLES,
    variable(
      "manageSubscriptionUrl",
      "URL the subscriber uses to manage or unsubscribe from notifications",
    ),
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated]: [
    ...RESOURCE_VARIABLES,
    ...INCIDENT_IDENTITY,
    variable("incidentDescription", "Description of the incident"),
    incidentSeverity,
    detailsUrl("incident"),
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged]: [
    ...RESOURCE_VARIABLES,
    ...INCIDENT_IDENTITY,
    variable("incidentDescription", "Description of the incident"),
    incidentSeverity,
    variable(
      "incidentState",
      "Current state of the incident (e.g., Investigating, Identified, Resolved)",
    ),
    detailsUrl("incident"),
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated]:
    INCIDENT_NOTE_VARIABLES,
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated]:
    INCIDENT_NOTE_VARIABLES,
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished]:
    [
      ...RESOURCE_VARIABLES,
      ...INCIDENT_IDENTITY,
      incidentSeverity,
      variable("postmortemNote", "Postmortem summary content"),
      variable("detailsUrl", "URL to view the postmortem"),
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated]: [
    ...RESOURCE_VARIABLES,
    ...EPISODE_IDENTITY,
    variable("episodeDescription", "Description of the incident"),
    episodeSeverity,
    detailsUrl("incident"),
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged]: [
    ...RESOURCE_VARIABLES,
    ...EPISODE_IDENTITY,
    episodeSeverity,
    variable(
      "episodeState",
      "Current state of the incident (e.g., Investigating, Identified, Resolved)",
    ),
    detailsUrl("incident"),
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated]:
    EPISODE_NOTE_VARIABLES,
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated]:
    EPISODE_NOTE_VARIABLES,
  [StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated]:
    ANNOUNCEMENT_VARIABLES,
  [StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated]:
    ANNOUNCEMENT_VARIABLES,
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated]:
    [
      ...RESOURCE_VARIABLES,
      ...SCHEDULED_MAINTENANCE_IDENTITY,
      variable(
        "scheduledStartTime",
        "When the maintenance is scheduled to start",
      ),
      variable("scheduledEndTime", "When the maintenance is scheduled to end"),
      detailsUrl("scheduled maintenance"),
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged]:
    [
      ...RESOURCE_VARIABLES,
      ...SCHEDULED_MAINTENANCE_IDENTITY,
      variable(
        "scheduledMaintenanceState",
        "Current state (e.g., Scheduled, In Progress, Completed)",
      ),
      detailsUrl("scheduled maintenance"),
    ],
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated]:
    SCHEDULED_MAINTENANCE_NOTE_VARIABLES,
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated]:
    SCHEDULED_MAINTENANCE_NOTE_VARIABLES,
  [StatusPageSubscriberNotificationEventType.SubscriberReport]:
    REPORT_VARIABLES,
};

export default class SubscriberNotificationTemplateVariables {
  public static getVariables(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<SubscriberNotificationTemplateVariable> {
    return (VARIABLES_BY_EVENT_TYPE[eventType] || []).map(
      (
        item: SubscriberNotificationTemplateVariable,
      ): SubscriberNotificationTemplateVariable => {
        return { ...item };
      },
    );
  }

  public static getVariableNames(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<string> {
    return this.getVariables(eventType).map(
      (item: SubscriberNotificationTemplateVariable): string => {
        return item.name;
      },
    );
  }
}
