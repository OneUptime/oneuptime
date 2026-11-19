import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import { ROUTINE_EMAIL_EVENT_TYPES } from "../../../Types/NotificationSetting/RoutineEmailEvents";

describe("routine email preset allowlist", () => {
  test("contains only known, unique event types and cannot be mutated", () => {
    expect(ROUTINE_EMAIL_EVENT_TYPES).toHaveLength(24);
    expect(new Set(ROUTINE_EMAIL_EVENT_TYPES).size).toBe(24);
    expect(Object.isFrozen(ROUTINE_EMAIL_EVENT_TYPES)).toBe(true);
    for (const eventType of ROUTINE_EMAIL_EVENT_TYPES) {
      expect(Object.values(NotificationSettingEventType)).toContain(eventType);
    }
  });

  /*
   * Being made an owner of a table, a pipeline or a data store (#9681) is
   * the news every other owner-added email is: Reduce routine emails drops
   * it with theirs.
   */
  test.each([
    NotificationSettingEventType.SEND_DATA_ASSET_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_DATA_PIPELINE_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_DATA_STORE_OWNER_ADDED_NOTIFICATION,
  ])(
    "treats %s as routine, as every owner-added email",
    (eventType: NotificationSettingEventType) => {
      expect(ROUTINE_EMAIL_EVENT_TYPES).toContain(eventType);
    },
  );

  test.each([
    NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_REMINDER_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_EPISODE_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_EPISODE_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
    NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR,
    NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_AI_AGENT_STATUS_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION,
    NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_REMINDER_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
    NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
    NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
    NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
    NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
    NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION,
  ])(
    "preserves email preferences for %s",
    (eventType: NotificationSettingEventType) => {
      expect(ROUTINE_EMAIL_EVENT_TYPES).not.toContain(eventType);
    },
  );
});
