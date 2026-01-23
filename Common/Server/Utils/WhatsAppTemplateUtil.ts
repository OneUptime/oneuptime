import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import WhatsAppTemplateMessages, {
  WhatsAppTemplateIds,
  WhatsAppTemplateId,
  WhatsAppTemplateLanguage,
} from "../../Types/WhatsApp/WhatsAppTemplates";
import WhatsAppMessage, {
  WhatsAppMessagePayload,
} from "../../Types/WhatsApp/WhatsAppMessage";

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
  [WhatsAppTemplateIds.AlertEpisodeStateChangedOwnerNotification]: "episode_link",
  [WhatsAppTemplateIds.AlertEpisodeOwnerAddedNotification]: "episode_link",
  [WhatsAppTemplateIds.IncidentCreated]: "incident_link",
  [WhatsAppTemplateIds.IncidentCreatedOwnerNotification]: "incident_link",
  [WhatsAppTemplateIds.IncidentNotePostedOwnerNotification]: "incident_link",
  [WhatsAppTemplateIds.IncidentStateChangedOwnerNotification]: "incident_link",
  [WhatsAppTemplateIds.IncidentOwnerAddedNotification]: "incident_link",
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

const templateIdByEventType: Record<
  NotificationSettingEventType,
  WhatsAppTemplateId
> = {
  [NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentCreatedOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentNotePostedOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentStateChangedOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentOwnerAddedNotification,
  [NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.AlertCreatedOwnerNotification,
  [NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.AlertNotePostedOwnerNotification,
  [NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.AlertStateChangedOwnerNotification,
  [NotificationSettingEventType.SEND_ALERT_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.AlertOwnerAddedNotification,
  [NotificationSettingEventType.SEND_ALERT_EPISODE_CREATED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.AlertEpisodeCreatedOwnerNotification,
  [NotificationSettingEventType.SEND_ALERT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.AlertEpisodeNotePostedOwnerNotification,
  [NotificationSettingEventType.SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.AlertEpisodeStateChangedOwnerNotification,
  [NotificationSettingEventType.SEND_ALERT_EPISODE_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.AlertEpisodeOwnerAddedNotification,
  [NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.MonitorOwnerAddedNotification,
  [NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.MonitorCreatedOwnerNotification,
  [NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.MonitorStatusChangedOwnerNotification,
  [NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES]:
    WhatsAppTemplateIds.MonitorProbeStatusChangedNotification,
  [NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR]:
    WhatsAppTemplateIds.MonitorNoProbesMonitoringNotification,
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.ScheduledMaintenanceCreatedOwnerNotification,
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.ScheduledMaintenanceNotePostedOwnerNotification,
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.ScheduledMaintenanceOwnerAddedNotification,
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.ScheduledMaintenanceStateChangedOwnerNotification,
  [NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.StatusPageAnnouncementCreatedOwnerNotification,
  [NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.StatusPageCreatedOwnerNotification,
  [NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.StatusPageOwnerAddedNotification,
  [NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.ProbeStatusChangedOwnerNotification,
  [NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.ProbeOwnerAddedNotification,
  [NotificationSettingEventType.SEND_AI_AGENT_STATUS_CHANGED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.AIAgentStatusChangedOwnerNotification,
  [NotificationSettingEventType.SEND_AI_AGENT_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.AIAgentOwnerAddedNotification,
  [NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER]:
    WhatsAppTemplateIds.OnCallUserIsOnRosterNotification,
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER]:
    WhatsAppTemplateIds.OnCallUserIsNextNotification,
  [NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY]:
    WhatsAppTemplateIds.OnCallUserAddedToPolicyNotification,
  [NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY]:
    WhatsAppTemplateIds.OnCallUserRemovedFromPolicyNotification,
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER]:
    WhatsAppTemplateIds.OnCallUserNoLongerActiveNotification,
};

export function getWhatsAppTemplateIdForEventType(
  eventType: NotificationSettingEventType,
): WhatsAppTemplateId {
  const templateId: WhatsAppTemplateId | undefined =
    templateIdByEventType[eventType];

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
  return templateContent.replace(
    /\{\{(.*?)\}\}/g,
    (_match: string, key: string) => {
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
