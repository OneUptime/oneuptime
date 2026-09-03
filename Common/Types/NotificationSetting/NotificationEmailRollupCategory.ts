import NotificationSettingEventType from "./NotificationSettingEventType";

/*
 * Why this file exists: the burst counter that decides whether an owner email
 * is sent now or coalesced into a rollup has to be scoped to something
 * narrower than "this recipient". Scoped per recipient alone, a probe
 * connection storm - the noisiest event the product produces, and the one
 * event seeded on by default with no cooldown - would push the first incident
 * email of a real outage over the threshold and delay it. The category is that
 * scope. It is also the heading the rollup email groups its rows under, so one
 * classification serves both the throttle and the reader.
 *
 * The VALUES below are stable machine codes, never display strings, because
 * they are persisted in UserNotificationEmailRollupItem.rollupCategory.
 * Changing a value orphans every existing row that carries the old one: the
 * burst count for that category silently restarts from zero, and any row still
 * pending a flush can never be matched to its bucket again. This is precisely
 * the hazard NotificationSettingEventType already lives with - its stored
 * value IS the English prose sentence shown in the UI, so no member of it can
 * ever be reworded - and there is no reason to repeat that mistake on purpose.
 * Display text lives in ROLLUP_CATEGORY_LABEL below, where it is free to
 * change on any afternoon.
 */
export enum RollupCategory {
  Incidents = "incidents",
  Alerts = "alerts",
  IncidentEpisodes = "incident-episodes",
  AlertEpisodes = "alert-episodes",
  Monitors = "monitors",
  ScheduledMaintenance = "scheduled-maintenance",
  StatusPages = "status-pages",
  Probes = "probes",
  AIAgents = "ai-agents",
  Slos = "slos",
  OnCall = "on-call",
  Other = "other",
}

/*
 * The human-readable heading for each category. Separate from the enum value
 * on purpose: this map is presentation, the enum value is storage, and only
 * one of the two is safe to edit.
 */
export const ROLLUP_CATEGORY_LABEL: Record<RollupCategory, string> = {
  [RollupCategory.Incidents]: "Incidents",
  [RollupCategory.Alerts]: "Alerts",
  [RollupCategory.IncidentEpisodes]: "Incident Episodes",
  [RollupCategory.AlertEpisodes]: "Alert Episodes",
  [RollupCategory.Monitors]: "Monitors",
  [RollupCategory.ScheduledMaintenance]: "Scheduled Maintenance",
  [RollupCategory.StatusPages]: "Status Pages",
  [RollupCategory.Probes]: "Probes",
  [RollupCategory.AIAgents]: "AI Agents",
  [RollupCategory.Slos]: "SLOs",
  [RollupCategory.OnCall]: "On Call",
  [RollupCategory.Other]: "Other",
};

/*
 * Every NotificationSettingEventType, classified. The grouping follows the
 * comment groups the enum already declares about itself, so the two files say
 * the same thing and a reader only has to learn one taxonomy.
 *
 * This is deliberately an exhaustive Record rather than a lookup with a
 * default: because the key type is the enum itself, adding a 48th member to
 * NotificationSettingEventType is a COMPILE ERROR here until somebody decides
 * which bucket it belongs in. That is the same idiom the Dashboard's
 * EVENT_LIBRARY uses, and it is the whole reason to spell out 47 lines instead
 * of matching on a name prefix - a prefix match would quietly file a new
 * resource type under the wrong heading, or under none, and nobody would
 * notice until a customer read the email.
 */
export const ROLLUP_CATEGORY_BY_EVENT_TYPE: Record<
  NotificationSettingEventType,
  RollupCategory
> = {
  // Incident
  [NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION]:
    RollupCategory.Incidents,
  [NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION]:
    RollupCategory.Incidents,
  [NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION]:
    RollupCategory.Incidents,
  [NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.Incidents,
  [NotificationSettingEventType.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION]:
    RollupCategory.Incidents,
  [NotificationSettingEventType.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION]:
    RollupCategory.Incidents,

  // Alerts
  [NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION]:
    RollupCategory.Alerts,
  [NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION]:
    RollupCategory.Alerts,
  [NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION]:
    RollupCategory.Alerts,
  [NotificationSettingEventType.SEND_ALERT_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.Alerts,
  [NotificationSettingEventType.SEND_ALERT_REMINDER_OWNER_NOTIFICATION]:
    RollupCategory.Alerts,

  // Alert Episodes
  [NotificationSettingEventType.SEND_ALERT_EPISODE_CREATED_OWNER_NOTIFICATION]:
    RollupCategory.AlertEpisodes,
  [NotificationSettingEventType.SEND_ALERT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION]:
    RollupCategory.AlertEpisodes,
  [NotificationSettingEventType.SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION]:
    RollupCategory.AlertEpisodes,
  [NotificationSettingEventType.SEND_ALERT_EPISODE_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.AlertEpisodes,
  [NotificationSettingEventType.SEND_ALERT_ADDED_TO_EPISODE_OWNER_NOTIFICATION]:
    RollupCategory.AlertEpisodes,

  // Incident Episodes
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_CREATED_OWNER_NOTIFICATION]:
    RollupCategory.IncidentEpisodes,
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION]:
    RollupCategory.IncidentEpisodes,
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION]:
    RollupCategory.IncidentEpisodes,
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.IncidentEpisodes,
  [NotificationSettingEventType.SEND_INCIDENT_ADDED_TO_EPISODE_OWNER_NOTIFICATION]:
    RollupCategory.IncidentEpisodes,

  // Monitors
  [NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.Monitors,
  [NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION]:
    RollupCategory.Monitors,
  [NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION]:
    RollupCategory.Monitors,
  [NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES]:
    RollupCategory.Monitors,
  [NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR]:
    RollupCategory.Monitors,

  // Scheduled Maintenance
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION]:
    RollupCategory.ScheduledMaintenance,
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION]:
    RollupCategory.ScheduledMaintenance,
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.ScheduledMaintenance,
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION]:
    RollupCategory.ScheduledMaintenance,
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_REMINDER_OWNER_NOTIFICATION]:
    RollupCategory.ScheduledMaintenance,

  // Status Page
  [NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION]:
    RollupCategory.StatusPages,
  [NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION]:
    RollupCategory.StatusPages,
  [NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.StatusPages,

  // Probe Status change Notification
  [NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION]:
    RollupCategory.Probes,
  [NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.Probes,

  // AI Agent Status change Notification
  [NotificationSettingEventType.SEND_AI_AGENT_STATUS_CHANGED_OWNER_NOTIFICATION]:
    RollupCategory.AIAgents,
  [NotificationSettingEventType.SEND_AI_AGENT_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.AIAgents,

  // SLO
  [NotificationSettingEventType.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION]:
    RollupCategory.Slos,
  [NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION]:
    RollupCategory.Slos,

  /*
   * On Call Notifications, including the two shift reminders. Five of these
   * seven are never rolled up at all (see NotificationEmailRollupPolicy); they
   * are classified anyway so the Record stays exhaustive, and so that the one
   * row per notification the write path records for accounting has a heading
   * whichever way the policy is later tuned.
   */
  [NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER]:
    RollupCategory.OnCall,
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER]:
    RollupCategory.OnCall,
  [NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY]:
    RollupCategory.OnCall,
  [NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY]:
    RollupCategory.OnCall,
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER]:
    RollupCategory.OnCall,
  [NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS]:
    RollupCategory.OnCall,
  [NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED]:
    RollupCategory.OnCall,
};

/*
 * The order the rollup email lists its sections in, most urgent first.
 *
 * A rollup exists because something happened forty times in ten minutes, so
 * the reader is scanning, not reading. Ordering sections by how much they can
 * cost - an incident before the monitor that declared it, and both before the
 * probe that noticed - means the first thing under the summary is the first
 * thing worth clicking. Ordering by count instead would put a flapping probe
 * above a production incident precisely when that is most wrong, and ordering
 * by recency would move the sections around between two rollups five minutes
 * apart, which is exactly the shape a reader learns to skim.
 *
 * Categories with no items in a given rollup are not rendered at all, so this
 * being longer than any one email's section list is expected.
 *
 * Every RollupCategory MUST appear here exactly once - a category missing
 * from this array would silently drop its section out of every rollup email.
 * That is pinned by NotificationEmailRollupCategory.test.ts rather than by the
 * type system, because an array cannot express "exhaustive" the way the
 * Record above can.
 */
export const ROLLUP_CATEGORY_ORDER: ReadonlyArray<RollupCategory> = [
  RollupCategory.Incidents,
  RollupCategory.IncidentEpisodes,
  RollupCategory.Alerts,
  RollupCategory.AlertEpisodes,
  RollupCategory.Slos,
  RollupCategory.Monitors,
  RollupCategory.ScheduledMaintenance,
  RollupCategory.Probes,
  RollupCategory.AIAgents,
  RollupCategory.StatusPages,
  RollupCategory.OnCall,
  RollupCategory.Other,
];

export type GetRollupCategoryFunction = (
  eventType: NotificationSettingEventType,
) => RollupCategory;

/*
 * The `?? Other` is not defending against a hole in the Record above - the
 * type system already guarantees there is none. It defends against a value
 * that was never a member of the enum in the first place: an eventType read
 * back out of Postgres and cast, or a row written by an older build whose
 * member has since been renamed. Falling back to Other keeps that row in the
 * rollup under a slightly vague heading instead of throwing on a send path
 * whose whole point is to be no worse than sending the email directly.
 */
export const getRollupCategory: GetRollupCategoryFunction = (
  eventType: NotificationSettingEventType,
): RollupCategory => {
  return ROLLUP_CATEGORY_BY_EVENT_TYPE[eventType] ?? RollupCategory.Other;
};

export default RollupCategory;
