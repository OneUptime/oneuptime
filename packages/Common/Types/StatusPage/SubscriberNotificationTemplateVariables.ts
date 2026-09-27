import {
  CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX,
  isValidCustomFieldVariableKey,
} from "../CustomField/CustomFieldVariableKey";
import BadDataException from "../Exception/BadDataException";
import StatusPageSubscriberNotificationEventType from "./StatusPageSubscriberNotificationEventType";

export interface SubscriberNotificationTemplateVariable {
  name: string;
  description: string;
  /*
   * In the body of an EMAIL template this variable is HTML already (rendered
   * Markdown, or the resource list built from escaped names) and goes in as
   * it is. Every other variable is plain text there, and is HTML-escaped (see
   * SubscriberNotificationTemplateCompiler). A subject, SMS, Slack and Teams
   * get every variable as text, never as HTML.
   */
  isHtmlInEmailBody?: boolean;
}

/*
 * A family of variables whose names are not known in advance: one per
 * incident custom field, {{customFields.<key>}}, where <key> is the field's
 * Template Variable key (IncidentCustomField.variableKey). Which keys exist
 * depends on the project, so the family is listed by its prefix, and the
 * worker passes one variable for every field the project has - an empty
 * string when the incident holds no value for it.
 */
export interface SubscriberNotificationTemplateDynamicVariable {
  // What every name in the family starts with, dot included.
  prefix: string;
  // How the rest of the name is shown in the reference: "<key>".
  placeholder: string;
  // Whether what follows the prefix is a name in the family.
  isValidKey: (key: string) => boolean;
  description: string;
  /*
   * Some members are HTML in an email body - a Rich text field's rendered
   * Markdown, a Long text field's lines, a Date and time field's time
   * zones - and the rest are plain text, which is escaped there.
   */
  mayBeHtmlInEmailBody?: boolean;
}

/*
 * The variables every incident event offers on top of its own: the
 * incident's labels, the status pages it is on, and its custom fields.
 *
 * affectedStatusPages and the custom fields are internal data - a status
 * page's subscribers are usually outside the team, and the list of pages
 * names every other audience the incident reaches - so the worker never puts
 * them into a message on its own. They reach subscribers only where a
 * template author places them, and the template form warns about it.
 */
const INCIDENT_VARIABLES: Array<SubscriberNotificationTemplateVariable> = [
  {
    name: "incidentLabels",
    description: "Labels of the incident, separated by commas",
  },
  {
    name: "affectedStatusPages",
    description:
      "Names of every status page the incident is shown on, separated by commas. Internal: it names the status pages of every audience the incident reaches",
  },
];

const INCIDENT_DYNAMIC_VARIABLES: Array<SubscriberNotificationTemplateDynamicVariable> =
  [
    {
      prefix: CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX,
      placeholder: "<key>",
      isValidKey: isValidCustomFieldVariableKey,
      description:
        "The value of an incident custom field, by the field's Template Variable key. Internal: any custom field can be placed, whether or not it is marked to be included in subscriber notifications",
      mayBeHtmlInEmailBody: true,
    },
  ];

// The incident events, which offer INCIDENT_VARIABLES and the custom fields.
const INCIDENT_EVENT_TYPES: ReadonlyArray<StatusPageSubscriberNotificationEventType> =
  [
    StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
    StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
    StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
    StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
    StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished,
  ];

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
      {
        name: "resourcesAffected",
        description: "List of affected resources",
        isHtmlInEmailBody: true,
      },
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
            isHtmlInEmailBody: true,
          },
          { name: "incidentSeverity", description: "Severity of the incident" },
          { name: "detailsUrl", description: "URL to view incident details" },
          ...INCIDENT_VARIABLES,
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged:
        return [
          ...commonVariables,
          { name: "incidentTitle", description: "Title of the incident" },
          {
            name: "incidentDescription",
            description: "Description of the incident",
            isHtmlInEmailBody: true,
          },
          { name: "incidentSeverity", description: "Severity of the incident" },
          {
            name: "incidentState",
            description: "Current state of the incident",
          },
          { name: "detailsUrl", description: "URL to view incident details" },
          ...INCIDENT_VARIABLES,
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
          {
            name: "note",
            description: "Content of the note",
            isHtmlInEmailBody: true,
          },
          { name: "detailsUrl", description: "URL to view incident details" },
          ...INCIDENT_VARIABLES,
        ];

      case StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished:
        return [
          ...commonVariables,
          { name: "incidentTitle", description: "Title of the incident" },
          { name: "incidentSeverity", description: "Severity of the incident" },
          {
            name: "postmortemNote",
            description: "Content of the postmortem note",
            isHtmlInEmailBody: true,
          },
          { name: "detailsUrl", description: "URL to view incident details" },
          ...INCIDENT_VARIABLES,
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
            isHtmlInEmailBody: true,
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
            isHtmlInEmailBody: true,
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
            isHtmlInEmailBody: true,
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
            isHtmlInEmailBody: true,
          },
          {
            name: "scheduledMaintenanceState",
            description: "Current state of the scheduled maintenance",
          },
          { name: "postedAt", description: "When the note was posted" },
          {
            name: "note",
            description: "Content of the note",
            isHtmlInEmailBody: true,
          },
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
            isHtmlInEmailBody: true,
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
          {
            name: "note",
            description: "Content of the note",
            isHtmlInEmailBody: true,
          },
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

  // The variables that are HTML, not plain text, in an email template's body.
  public static getEmailBodyHtmlVariableNamesForEventType(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<string> {
    return this.getAvailableVariablesForEventType(eventType)
      .filter((variable: SubscriberNotificationTemplateVariable): boolean => {
        return variable.isHtmlInEmailBody === true;
      })
      .map((variable: SubscriberNotificationTemplateVariable): string => {
        return variable.name;
      });
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

  /*
   * The families of variables this event offers on top of the listed ones,
   * by prefix: the incident events' {{customFields.<key>}}.
   */
  public static getDynamicVariablesForEventType(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<SubscriberNotificationTemplateDynamicVariable> {
    return INCIDENT_EVENT_TYPES.includes(eventType)
      ? INCIDENT_DYNAMIC_VARIABLES.map(
          (
            variable: SubscriberNotificationTemplateDynamicVariable,
          ): SubscriberNotificationTemplateDynamicVariable => {
            return { ...variable };
          },
        )
      : [];
  }

  /*
   * The family this name belongs to, when it is one: the prefix followed by
   * a key of the family's shape (for a custom field, the shape its Template
   * Variable key is made in, which the template compiler fills). Null for a
   * listed variable, a bare prefix, or a name the event does not offer.
   */
  public static getDynamicVariableForName(
    eventType: StatusPageSubscriberNotificationEventType,
    name: string,
  ): SubscriberNotificationTemplateDynamicVariable | null {
    for (const variable of this.getDynamicVariablesForEventType(eventType)) {
      if (
        name.startsWith(variable.prefix) &&
        variable.isValidKey(name.slice(variable.prefix.length))
      ) {
        return variable;
      }
    }

    return null;
  }

  // Whether a template for this event can use {{name}}.
  public static isVariableOffered(
    eventType: StatusPageSubscriberNotificationEventType,
    name: string,
  ): boolean {
    return (
      this.getVariableNamesForEventType(eventType).includes(name) ||
      this.getDynamicVariableForName(eventType, name) !== null
    );
  }
}
