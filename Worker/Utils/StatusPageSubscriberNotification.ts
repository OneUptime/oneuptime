import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceType,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";

export interface NotificationTemplateResult {
  subject: string | undefined;
  body: string;
  useDefaultTemplate: boolean;
}

export interface TemplateVariables {
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
  resourcesAffected: string;
  detailsUrl: string;
  // Incident variables
  incidentTitle?: string;
  incidentDescription?: string;
  incidentSeverity?: string;
  incidentState?: string;
  // Announcement variables
  announcementTitle?: string;
  announcementDescription?: string;
  // Scheduled Maintenance variables
  scheduledMaintenanceTitle?: string;
  scheduledMaintenanceDescription?: string;
  scheduledMaintenanceState?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  // Note variables
  postedAt?: string;
  note?: string;
  // Other
  [key: string]: string | undefined;
}

/**
 * Get custom template for a status page, or return null if no custom template exists.
 */
export async function getCustomTemplate(data: {
  statusPageId: ObjectID;
  eventType: StatusPageSubscriberNotificationEventType;
  notificationMethod: StatusPageSubscriberNotificationMethod;
}): Promise<StatusPageSubscriberNotificationTemplate | null> {
  try {
    const template =
      await StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
        {
          statusPageId: data.statusPageId,
          eventType: data.eventType,
          notificationMethod: data.notificationMethod,
        },
      );

    if (template) {
      logger.debug(
        `Found custom template '${template.templateName}' for status page ${data.statusPageId}, event type ${data.eventType}, method ${data.notificationMethod}`,
      );
    }

    return template;
  } catch (err) {
    logger.error(
      `Error getting custom template for status page ${data.statusPageId}: ${err}`,
    );
    return null;
  }
}

/**
 * Compile a custom template with variables, or return default content.
 */
export function compileCustomTemplate(data: {
  template: StatusPageSubscriberNotificationTemplate | null;
  variables: TemplateVariables;
  defaultSubject: string | undefined;
  defaultBody: string;
}): NotificationTemplateResult {
  const { template, variables, defaultSubject, defaultBody } = data;

  if (!template || !template.templateBody) {
    return {
      subject: defaultSubject,
      body: defaultBody,
      useDefaultTemplate: true,
    };
  }

  // Convert variables to Record<string, string>
  const variableRecord: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    variableRecord[key] = value || "";
  }

  const compiledBody =
    StatusPageSubscriberNotificationTemplateServiceType.compileTemplate(
      template.templateBody,
      variableRecord,
    );

  let compiledSubject = defaultSubject;
  if (template.emailSubject) {
    compiledSubject =
      StatusPageSubscriberNotificationTemplateServiceType.compileTemplate(
        template.emailSubject,
        variableRecord,
      );
  }

  return {
    subject: compiledSubject,
    body: compiledBody,
    useDefaultTemplate: false,
  };
}

/**
 * Get notification content for a subscriber, using custom template if available.
 */
export async function getNotificationContent(data: {
  statusPageId: ObjectID;
  eventType: StatusPageSubscriberNotificationEventType;
  notificationMethod: StatusPageSubscriberNotificationMethod;
  variables: TemplateVariables;
  defaultSubject?: string;
  defaultBody: string;
}): Promise<NotificationTemplateResult> {
  const {
    statusPageId,
    eventType,
    notificationMethod,
    variables,
    defaultSubject,
    defaultBody,
  } = data;

  const template = await getCustomTemplate({
    statusPageId,
    eventType,
    notificationMethod,
  });

  return compileCustomTemplate({
    template,
    variables,
    defaultSubject,
    defaultBody,
  });
}

export default {
  getCustomTemplate,
  compileCustomTemplate,
  getNotificationContent,
};
