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
