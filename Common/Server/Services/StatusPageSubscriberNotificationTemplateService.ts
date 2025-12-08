import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import ObjectID from "../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationTemplateStatusPageService from "./StatusPageSubscriberNotificationTemplateStatusPageService";
import BadDataException from "../../Types/Exception/BadDataException";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Get template for a specific status page, event type, and notification method.
   * Returns null if no custom template is found (caller should use default template).
   */
  public async getTemplateForStatusPage(data: {
    statusPageId: ObjectID;
    eventType: StatusPageSubscriberNotificationEventType;
    notificationMethod: StatusPageSubscriberNotificationMethod;
  }): Promise<Model | null> {
    const { statusPageId, eventType, notificationMethod } = data;

    // First find the template link for this status page
    const templateLinks: Array<StatusPageSubscriberNotificationTemplateStatusPage> =
      await StatusPageSubscriberNotificationTemplateStatusPageService.findBy({
        query: {
          statusPageId: statusPageId,
        },
        select: {
          statusPageSubscriberNotificationTemplateId: true,
        },
        skip: 0,
        limit: 100,
        props: {
          isRoot: true,
        },
      });

    if (templateLinks.length === 0) {
      return null;
    }

    // Get the template IDs
    const templateIds: Array<ObjectID> = templateLinks
      .map((link: StatusPageSubscriberNotificationTemplateStatusPage) => {
        return link.statusPageSubscriberNotificationTemplateId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return id !== undefined;
      });

    if (templateIds.length === 0) {
      return null;
    }

    // Find the specific template matching the event type and notification method
    const templates = await this.findBy({
      query: {
        eventType: eventType,
        notificationMethod: notificationMethod,
      },
      select: {
        _id: true,
        templateName: true,
        templateBody: true,
        emailSubject: true,
        eventType: true,
        notificationMethod: true,
      },
      skip: 0,
      limit: 100,
      props: {
        isRoot: true,
      },
    });

    // Find a template that matches one of the linked template IDs
    for (const template of templates) {
      if (
        templateIds.some((id: ObjectID) => {
          return id.toString() === template._id?.toString();
        })
      ) {
        return template;
      }
    }

    return null;
  }

  /**
   * Get available variables for a specific event type.
   * These variables can be used in templates with {{variableName}} syntax.
   */
  public static getAvailableVariablesForEventType(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<{ name: string; description: string }> {
    const commonVariables = [
      { name: "statusPageName", description: "Name of the status page" },
      { name: "statusPageUrl", description: "URL of the status page" },
      {
        name: "unsubscribeUrl",
        description: "URL to unsubscribe from notifications",
      },
      { name: "resourcesAffected", description: "List of affected resources" },
    ];

    switch (eventType) {
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

      case StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated:
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
        return [
          ...commonVariables,
          {
            name: "scheduledMaintenanceTitle",
            description: "Title of the scheduled maintenance",
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

      default:
        throw new BadDataException(`Unknown event type: ${eventType}`);
    }
  }

  /**
   * Compile a template with the given variables.
   * Replaces {{variableName}} with the actual values.
   */
  public static compileTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    let compiledTemplate = template;

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      compiledTemplate = compiledTemplate.replace(regex, value || "");
    }

    return compiledTemplate;
  }
}

export default new Service();
