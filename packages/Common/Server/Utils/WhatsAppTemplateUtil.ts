import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import WhatsAppTemplateMessages, {
  WhatsAppTemplateIds,
  WhatsAppTemplateId,
  WhatsAppTemplateLanguage,
} from "../../Types/WhatsApp/WhatsAppTemplates";
import WhatsAppMessage, {
  WhatsAppMessagePayload,
} from "../../Types/WhatsApp/WhatsAppMessage";
import { getWhatsAppTemplateIdOfEvent } from "../../Types/WhatsApp/WhatsAppEventTemplates";
import {
  TemplatePlaceholder,
  replaceTemplatePlaceholders,
} from "../../Utils/TemplatePlaceholders";

const DEFAULT_ACTION_LINK: string = "https://oneuptime.com/dashboard";

const templateDashboardLinkVariableMap: Partial<
  Record<WhatsAppTemplateId, string>
> = {
  [WhatsAppTemplateIds.AlertCreated]: "alert_link",
  [WhatsAppTemplateIds.AlertCreatedOwnerNotification]: "alert_link",
  [WhatsAppTemplateIds.AlertNotePostedOwnerNotification]: "alert_link",
  [WhatsAppTemplateIds.AlertStateChangedOwnerNotification]: "alert_link",
  [WhatsAppTemplateIds.AlertOwnerAddedNotification]: "alert_link",
  [WhatsAppTemplateIds.AlertEpisodeCreatedOwnerNotification]: "episode_link",
  [WhatsAppTemplateIds.AlertEpisodeNotePostedOwnerNotification]: "episode_link",
  [WhatsAppTemplateIds.AlertEpisodeStateChangedOwnerNotification]:
    "episode_link",
  [WhatsAppTemplateIds.AlertEpisodeOwnerAddedNotification]: "episode_link",
  [WhatsAppTemplateIds.IncidentEpisodeCreatedOwnerNotification]: "episode_link",
  [WhatsAppTemplateIds.IncidentEpisodeNotePostedOwnerNotification]:
    "episode_link",
  [WhatsAppTemplateIds.IncidentEpisodeStateChangedOwnerNotification]:
    "episode_link",
  [WhatsAppTemplateIds.IncidentEpisodeOwnerAddedNotification]: "episode_link",
  [WhatsAppTemplateIds.IncidentCreated]: "incident_link",
  [WhatsAppTemplateIds.IncidentCreatedOwnerNotification]: "incident_link",
  [WhatsAppTemplateIds.IncidentNotePostedOwnerNotification]: "incident_link",
  [WhatsAppTemplateIds.IncidentStateChangedOwnerNotification]: "incident_link",
  [WhatsAppTemplateIds.IncidentOwnerAddedNotification]: "incident_link",
  [WhatsAppTemplateIds.IncidentMemberAddedNotification]: "incident_link",
  [WhatsAppTemplateIds.IncidentReminderOwnerNotification]: "incident_link",
  [WhatsAppTemplateIds.AlertReminderOwnerNotification]: "alert_link",
  [WhatsAppTemplateIds.MonitorOwnerAddedNotification]: "monitor_link",
  [WhatsAppTemplateIds.MonitorCreatedOwnerNotification]: "monitor_link",
  [WhatsAppTemplateIds.MonitorStatusChangedOwnerNotification]: "monitor_link",
  [WhatsAppTemplateIds.MonitorProbeStatusChangedNotification]: "monitor_link",
  [WhatsAppTemplateIds.MonitorNoProbesMonitoringNotification]: "monitor_link",
  [WhatsAppTemplateIds.ScheduledMaintenanceCreatedOwnerNotification]:
    "maintenance_link",
  [WhatsAppTemplateIds.ScheduledMaintenanceNotePostedOwnerNotification]:
    "maintenance_link",
  [WhatsAppTemplateIds.ScheduledMaintenanceOwnerAddedNotification]:
    "maintenance_link",
  [WhatsAppTemplateIds.ScheduledMaintenanceStateChangedOwnerNotification]:
    "maintenance_link",
  [WhatsAppTemplateIds.ScheduledMaintenanceReminderOwnerNotification]:
    "event_link",
  [WhatsAppTemplateIds.StatusPageAnnouncementCreatedOwnerNotification]:
    "status_page_link",
  [WhatsAppTemplateIds.StatusPageCreatedOwnerNotification]: "status_page_link",
  [WhatsAppTemplateIds.StatusPageOwnerAddedNotification]: "status_page_link",
  [WhatsAppTemplateIds.ProbeStatusChangedOwnerNotification]: "probe_link",
  [WhatsAppTemplateIds.ProbeOwnerAddedNotification]: "probe_link",
  [WhatsAppTemplateIds.AIAgentStatusChangedOwnerNotification]: "ai_agent_link",
  [WhatsAppTemplateIds.AIAgentOwnerAddedNotification]: "ai_agent_link",
  [WhatsAppTemplateIds.OnCallUserIsOnRosterNotification]: "schedule_link",
  [WhatsAppTemplateIds.OnCallUserIsNextNotification]: "schedule_link",
  [WhatsAppTemplateIds.OnCallUserNoLongerActiveNotification]: "schedule_link",
  [WhatsAppTemplateIds.OnCallUserAddedToPolicyNotification]: "policy_link",
  [WhatsAppTemplateIds.OnCallUserRemovedFromPolicyNotification]: "policy_link",
  [WhatsAppTemplateIds.VerificationCode]: "dashboard_link",
};

export function getWhatsAppTemplateIdForEventType(
  eventType: NotificationSettingEventType,
): WhatsAppTemplateId {
  /*
   * Only an event with an approved template is sent on WhatsApp
   * (Types/WhatsApp/WhatsAppEventTemplates, which Notification Settings reads
   * too): one without is never handed to WhatsApp, as nothing would arrive.
   */
  const templateId: WhatsAppTemplateId | null =
    getWhatsAppTemplateIdOfEvent(eventType);

  if (!templateId) {
    throw new Error(
      `WhatsApp template is not defined for event type ${eventType}.`,
    );
  }

  return templateId;
}

export function getWhatsAppTemplateStringForEventType(
  eventType: NotificationSettingEventType,
): string {
  const templateId: WhatsAppTemplateId =
    getWhatsAppTemplateIdForEventType(eventType);

  const templateContent: string | undefined =
    WhatsAppTemplateMessages[templateId];

  if (!templateContent) {
    throw new Error(
      `WhatsApp template content is not defined for event type ${eventType}.`,
    );
  }

  return templateContent;
}

function renderTemplateContent(
  templateContent: string,
  variables: Record<string, string>,
  context: string,
): string {
  return replaceTemplatePlaceholders(
    templateContent,
    (placeholder: TemplatePlaceholder): string => {
      const key: string = placeholder.inner;
      const value: string | undefined = variables[key];

      if (value === undefined) {
        throw new Error(
          `Missing variable "${key}" for WhatsApp template ${context}.`,
        );
      }

      return value;
    },
  );
}

export function createWhatsAppMessageFromTemplate({
  templateString,
  actionLink,
  eventType,
  templateKey,
  templateVariables,
}: {
  templateString?: string;
  actionLink?: string | undefined;
  eventType?: NotificationSettingEventType;
  templateKey?: WhatsAppTemplateId;
  templateVariables?: Record<string, string>;
}): WhatsAppMessagePayload {
  const resolvedTemplateKey: WhatsAppTemplateId | undefined =
    templateKey ??
    (eventType ? getWhatsAppTemplateIdForEventType(eventType) : undefined);

  if (!resolvedTemplateKey) {
    throw new Error(
      "WhatsApp template key or event type must be provided to create WhatsApp message.",
    );
  }

  const resolvedActionLink: string = (actionLink ?? DEFAULT_ACTION_LINK).trim();

  const templateVariablesWithDefaults: Record<string, string> = {
    ...(templateVariables ?? {}),
  };

  const dashboardLinkVariableName: string | undefined =
    templateDashboardLinkVariableMap[resolvedTemplateKey];

  if (dashboardLinkVariableName) {
    const providedLink: string | undefined =
      templateVariablesWithDefaults[dashboardLinkVariableName] ??
      templateVariables?.[dashboardLinkVariableName];

    const finalLink: string = (providedLink || resolvedActionLink).trim();

    templateVariablesWithDefaults[dashboardLinkVariableName] = finalLink;
  }

  const resolvedTemplateContent: string | undefined =
    templateString ?? WhatsAppTemplateMessages[resolvedTemplateKey];

  if (!resolvedTemplateContent) {
    throw new Error(
      `WhatsApp template content is not defined for template ${resolvedTemplateKey}.`,
    );
  }

  const body: string = renderTemplateContent(
    resolvedTemplateContent,
    templateVariablesWithDefaults,
    resolvedTemplateKey,
  );

  return {
    body,
    templateKey: resolvedTemplateKey,
    templateVariables: templateVariablesWithDefaults,
    templateLanguageCode: WhatsAppTemplateLanguage[resolvedTemplateKey],
  };
}

export function appendRecipientToWhatsAppMessage(
  payload: WhatsAppMessagePayload,
  to: WhatsAppMessage["to"],
): WhatsAppMessage {
  return {
    ...payload,
    to,
  };
}

export default {
  createWhatsAppMessageFromTemplate,
  appendRecipientToWhatsAppMessage,
  getWhatsAppTemplateIdForEventType,
  getWhatsAppTemplateStringForEventType,
};
