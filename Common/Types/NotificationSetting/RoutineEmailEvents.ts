import NotificationSettingEventType from "./NotificationSettingEventType";

/*
 * Keep this an explicit allowlist: newly introduced events retain their existing
 * email preference until someone deliberately classifies them as routine.
 */
export const ROUTINE_EMAIL_EVENT_TYPES: ReadonlyArray<NotificationSettingEventType> =
  Object.freeze([
    NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_EPISODE_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_EPISODE_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_AI_AGENT_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_ADDED_TO_EPISODE_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_ADDED_TO_EPISODE_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
    NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
    NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION,
  ]);
