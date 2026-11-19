import NotificationSettingEventType from "../NotificationSetting/NotificationSettingEventType";
import { WhatsAppTemplateId, WhatsAppTemplateIds } from "./WhatsAppTemplates";

/*
 * WHICH NOTIFICATION SETTINGS WHATSAPP CAN SEND (#9715).
 *
 * WhatsApp delivers only messages made from a template Meta has approved,
 * for OneUptime Cloud and for every installation's own WhatsApp Business
 * account (Admin Dashboard > Settings > WhatsApp lists them). A message with
 * no template is refused before it reaches Meta and delivers nothing, so an
 * event is sent on WhatsApp only through the approved template written
 * against it here.
 *
 * One map, read by the server and the Dashboard alike:
 *
 *   - the senders build each event's WhatsApp message from it
 *     (Server/Utils/WhatsAppTemplateUtil, createWhatsAppMessageFromTemplate),
 *     and an event that is not here hands over no WhatsApp message at all;
 *   - User Settings > Notification Settings offers the WhatsApp switch only
 *     for an event that is here, and says WhatsApp is not available for the
 *     others, so no switch promises a message nothing sends.
 *
 * An event with no template (SLO status changes, the owner-added events of
 * services, infrastructure, dashboards and the rest, missed calls, security
 * cases, public note approvals, a reassigned shift) needs a new template
 * approved by Meta before it can be added here - for OneUptime Cloud by a
 * maintainer, and by every self-hosted installation in its own account.
 * Reusing an approved template is fine where its words are true of the
 * event, as a shift reminder's "you are next on-call" is.
 */
export const WHATSAPP_TEMPLATE_BY_EVENT_TYPE: Readonly<
  Partial<Record<NotificationSettingEventType, WhatsAppTemplateId>>
> = Object.freeze({
  [NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentCreatedOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentNotePostedOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentStateChangedOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentOwnerAddedNotification,
  [NotificationSettingEventType.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentMemberAddedNotification,
  [NotificationSettingEventType.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentReminderOwnerNotification,
  /*
   * An SLA breach says what the approved "still open" reminder says - the
   * incident, its state, how long it has been open - which is true of a
   * missed response or resolution deadline, where the "has been created"
   * template it had borrowed was not.
   */
  [NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentReminderOwnerNotification,
  [NotificationSettingEventType.SEND_ALERT_REMINDER_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.AlertReminderOwnerNotification,
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
  [NotificationSettingEventType.SEND_ALERT_ADDED_TO_EPISODE_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.AlertAddedToEpisodeOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_CREATED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentEpisodeCreatedOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentEpisodeNotePostedOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentEpisodeStateChangedOwnerNotification,
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_OWNER_ADDED_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentEpisodeOwnerAddedNotification,
  [NotificationSettingEventType.SEND_INCIDENT_ADDED_TO_EPISODE_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.IncidentAddedToEpisodeOwnerNotification,
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
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_REMINDER_OWNER_NOTIFICATION]:
    WhatsAppTemplateIds.ScheduledMaintenanceReminderOwnerNotification,
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
  /*
   * A reminder that a shift starts soon says what the approved "you are next
   * on-call for <policy> on <schedule>" template says, word for word
   * (OnCallShiftReminderRunner). A shift reassigned to someone else has no
   * template whose words are true of it, so it is not here.
   */
  [NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS]:
    WhatsAppTemplateIds.OnCallUserIsNextNotification,
});

// The approved template an event is sent on WhatsApp through, or null when it has none.
export function getWhatsAppTemplateIdOfEvent(
  eventType: NotificationSettingEventType,
): WhatsAppTemplateId | null {
  return WHATSAPP_TEMPLATE_BY_EVENT_TYPE[eventType] || null;
}

// Whether WhatsApp can send this event: it has an approved template.
export function hasWhatsAppTemplate(
  eventType: NotificationSettingEventType,
): boolean {
  return getWhatsAppTemplateIdOfEvent(eventType) !== null;
}

/*
 * Whether a channel of a notification setting (its column: "alertByEmail",
 * "alertByWhatsApp") can send this event at all. Every channel can, except
 * WhatsApp for an event it has no approved template for. A switch on a
 * channel that cannot is never offered, and one already on sends nothing.
 */
export function isNotificationChannelOfferedForEvent(data: {
  channel: string;
  eventType: NotificationSettingEventType;
}): boolean {
  if (data.channel === "alertByWhatsApp") {
    return hasWhatsAppTemplate(data.eventType);
  }

  return true;
}
