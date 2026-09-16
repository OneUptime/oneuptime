import BadDataException from "../Exception/BadDataException";
import StatusPageSubscriberNotificationEventType from "./StatusPageSubscriberNotificationEventType";

export interface SubscriberNotificationTemplateVariable {
  name: string;
  description: string;
}

/*
 * The variables a custom status page subscriber notification template can use
 * for each event type, as {{variableName}}.
 *
 * This is a promise to template authors: the worker that sends an event must
 * pass every one of these to the template, on every channel, or the
 * placeholder renders as an empty string. The worker tests hold each worker to
 * this list, and the dashboard's variable reference is tested against it.
 *
 * Kept free of database dependencies so both of those can import it.
 */
export default class SubscriberNotificationTemplateVariables {
  public static getAvailableVariablesForEventType(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<SubscriberNotificationTemplateVariable> {
    /*
     * Messages about the subscription itself (confirm, welcome, manage) and
     * the uptime report are not about any resource, so they only get the
     * status page variables. Everything that reports an event also gets the
     * resources it affects on the receiving status page.
     */
    const statusPageVariables: Array<SubscriberNotificationTemplateVariable> = [
      { name: "statusPageName", description: "Name of the status page" },
      { name: "statusPageUrl", description: "URL of the status page" },
      {
        name: "unsubscribeUrl",
        description: "URL to unsubscribe from notifications",
      },
    ];

    const commonVariables: Array<SubscriberNotificationTemplateVariable> = [
      ...statusPageVariables,
      { name: "resourcesAffected", description: "List of affected resources" },
    ];

    switch (eventType) {
      case StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation:
        return [
          ...statusPageVariables,
          {
            name: "confirmationUrl",
            description:
              "URL the subscriber opens to confirm their subscription",
          },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberSubscribed:
        return [...statusPageVariables];

      case StatusPageSubscriberNotificationEventType.SubscriberManageSubscription:
        return [
          ...statusPageVariables,
          {
            name: "manageSubscriptionUrl",
            description:
              "URL the subscriber uses to manage or cancel their subscription",
          },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated:
        return [
          ...commonVariables,
          { name: "incidentTitle", description: "Title of the incident" },
          {
            name: "incidentDescription",
            description: "Description of the incident",
          },
          { name: "incidentSeverity", description: "Severity of the incident" },
          { name: "detailsUrl", description: "URL to view incident details" },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged:
        return [
          ...commonVariables,
          { name: "incidentTitle", description: "Title of the incident" },
          {
            name: "incidentDescription",
            description: "Description of the incident",
          },
          { name: "incidentSeverity", description: "Severity of the incident" },
          {
            name: "incidentState",
            description: "Current state of the incident",
          },
          { name: "detailsUrl", description: "URL to view incident details" },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated:
      case StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated:
        return [
          ...commonVariables,
          { name: "incidentTitle", description: "Title of the incident" },
          { name: "incidentSeverity", description: "Severity of the incident" },
          {
            name: "incidentState",
            description: "Current state of the incident",
          },
          { name: "postedAt", description: "When the note was posted" },
          { name: "note", description: "Content of the note" },
          { name: "detailsUrl", description: "URL to view incident details" },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished:
        return [
          ...commonVariables,
          { name: "incidentTitle", description: "Title of the incident" },
          { name: "incidentSeverity", description: "Severity of the incident" },
          {
            name: "postmortemNote",
            description: "Content of the postmortem note",
          },
          { name: "detailsUrl", description: "URL to view incident details" },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated:
      case StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated:
        return [
          ...commonVariables,
          {
            name: "announcementTitle",
            description: "Title of the announcement",
          },
          {
            name: "announcementDescription",
            description: "Description of the announcement",
          },
          {
            name: "detailsUrl",
            description: "URL to view announcement details",
          },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated:
        return [
          ...commonVariables,
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
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged:
        return [
          ...commonVariables,
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
            name: "detailsUrl",
            description: "URL to view scheduled maintenance details",
          },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated:
      case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated:
        return [
          ...commonVariables,
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
          { name: "postedAt", description: "When the note was posted" },
          { name: "note", description: "Content of the note" },
          {
            name: "detailsUrl",
            description: "URL to view scheduled maintenance details",
          },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated:
        return [
          ...commonVariables,
          { name: "episodeTitle", description: "Title of the incident" },
          {
            name: "episodeDescription",
            description: "Description of the incident",
          },
          { name: "episodeSeverity", description: "Severity of the incident" },
          { name: "detailsUrl", description: "URL to view incident details" },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged:
        return [
          ...commonVariables,
          { name: "episodeTitle", description: "Title of the incident" },
          { name: "episodeSeverity", description: "Severity of the incident" },
          {
            name: "episodeState",
            description: "Current state of the incident",
          },
          { name: "detailsUrl", description: "URL to view incident details" },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated:
      case StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated:
        return [
          ...commonVariables,
          { name: "episodeTitle", description: "Title of the incident" },
          { name: "episodeSeverity", description: "Severity of the incident" },
          { name: "note", description: "Content of the note" },
          { name: "detailsUrl", description: "URL to view incident details" },
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberReport:
        /*
         * The report template is rendered through the full Handlebars engine
         * with the structured `report` object, so the per-resource fields are
         * accessed inside {{#each report.resources}} rather than as flat
         * scalars. The entries below document the top-level paths.
         */
        return [
          ...statusPageVariables,
          {
            name: "report.reportDates",
            description: "The reporting period as a range",
          },
          {
            name: "report.reportPeriodName",
            description:
              'How a sentence refers to the period - "the last 30 days", "July 2026"',
          },
          {
            name: "report.reportStartDate",
            description: "First day of the reporting period",
          },
          {
            name: "report.reportEndDate",
            description: "Last day of the reporting period",
          },
          {
            name: "report.reportTimezone",
            description: "The timezone the reporting period was resolved in",
          },
          {
            name: "report.averageUptimePercent",
            description: "Average uptime across all resources",
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
            description:
              "Array of per-resource rows (resourceName, uptimePercentAsString, downtimeInHoursAndMinutes, totalIncidentCount, groupName, groupPath) to loop over with {{#each}}",
          },
          {
            name: "report.hasGroups",
            description:
              "true when the status page organises its resources into groups",
          },
          {
            name: "report.rows",
            description:
              "The status page's group hierarchy flattened into render order (isGroup, name, depth, indentInPixels, uptimePercentAsString, downtimeInHoursAndMinutes, totalIncidentCount, totalResources) to loop over with {{#each}}",
          },
          {
            name: "report.groups",
            description:
              "The group hierarchy as a nested tree (groupName, groupPath, depth, uptimePercentAsString, downtimeInHoursAndMinutes, totalIncidentCount, totalResources, resources, subGroups)",
          },
          {
            name: "report.ungroupedResources",
            description: "Per-resource rows for resources that are in no group",
          },
        ];

      default:
        throw new BadDataException(`Unknown event type: ${eventType}`);
    }
  }

  public static getVariableNamesForEventType(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<string> {
    return this.getAvailableVariablesForEventType(eventType).map(
      (variable: SubscriberNotificationTemplateVariable): string => {
        return variable.name;
      },
    );
  }
}
