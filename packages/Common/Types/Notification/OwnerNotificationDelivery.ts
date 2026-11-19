/*
 * WHAT THE OWNERS OF A RECORD ARE TOLD, OWNER BY OWNER (issues #8199,
 * #8509, #8510): an incident, an alert, an episode of either, a monitor, a
 * scheduled maintenance event, a status page, an SLO, a network device, a
 * probe, an AI agent, or a table, data store or pipeline (#9681).
 *
 * Each owner notification job takes (marks) the record it is about - the
 * incident or alert just created, a state change, a note, an owner row, a
 * reminder that is due - so that no later run reads it again, then tells
 * each owner. A worker stopped hard between the two (an out-of-memory kill,
 * a node lost) used to leave the owners not told yet untold for good. So
 * before the take, the job writes one OwnerNotificationDelivery row per
 * owner it is about to tell, and each row says how far that owner got:
 */

/*
 * Which notification: one of the owner notification jobs. Stored, so a
 * value is never renamed.
 */
export enum OwnerNotificationKind {
  IncidentCreated = "IncidentCreated",
  IncidentStateChanged = "IncidentStateChanged",
  IncidentPublicNotePosted = "IncidentPublicNotePosted",
  IncidentInternalNotePosted = "IncidentInternalNotePosted",
  IncidentOwnerAdded = "IncidentOwnerAdded",
  IncidentReminder = "IncidentReminder",
  AlertCreated = "AlertCreated",
  AlertStateChanged = "AlertStateChanged",
  AlertInternalNotePosted = "AlertInternalNotePosted",
  AlertOwnerAdded = "AlertOwnerAdded",
  AlertReminder = "AlertReminder",
  IncidentEpisodeCreated = "IncidentEpisodeCreated",
  IncidentEpisodeStateChanged = "IncidentEpisodeStateChanged",
  IncidentEpisodeInternalNotePosted = "IncidentEpisodeInternalNotePosted",
  IncidentEpisodeIncidentAdded = "IncidentEpisodeIncidentAdded",
  IncidentEpisodeOwnerAdded = "IncidentEpisodeOwnerAdded",
  AlertEpisodeCreated = "AlertEpisodeCreated",
  AlertEpisodeStateChanged = "AlertEpisodeStateChanged",
  AlertEpisodeInternalNotePosted = "AlertEpisodeInternalNotePosted",
  AlertEpisodeAlertAdded = "AlertEpisodeAlertAdded",
  AlertEpisodeOwnerAdded = "AlertEpisodeOwnerAdded",
  MonitorCreated = "MonitorCreated",
  MonitorStatusChanged = "MonitorStatusChanged",
  MonitorOwnerAdded = "MonitorOwnerAdded",
  ScheduledMaintenanceCreated = "ScheduledMaintenanceCreated",
  ScheduledMaintenanceStateChanged = "ScheduledMaintenanceStateChanged",
  ScheduledMaintenancePublicNotePosted = "ScheduledMaintenancePublicNotePosted",
  ScheduledMaintenanceInternalNotePosted = "ScheduledMaintenanceInternalNotePosted",
  ScheduledMaintenanceOwnerAdded = "ScheduledMaintenanceOwnerAdded",
  ScheduledMaintenanceReminder = "ScheduledMaintenanceReminder",
  StatusPageCreated = "StatusPageCreated",
  StatusPageAnnouncementCreated = "StatusPageAnnouncementCreated",
  StatusPageOwnerAdded = "StatusPageOwnerAdded",
  ServiceLevelObjectiveOwnerAdded = "ServiceLevelObjectiveOwnerAdded",
  NetworkDeviceOwnerAdded = "NetworkDeviceOwnerAdded",
  ProbeOwnerAdded = "ProbeOwnerAdded",
  AIAgentOwnerAdded = "AIAgentOwnerAdded",
  /*
   * Data Observability's tables and pipelines, and the data stores Data
   * Observability and Data Security share: told as every other record's new
   * owners are (#9681).
   */
  DataAssetOwnerAdded = "DataAssetOwnerAdded",
  DataStoreOwnerAdded = "DataStoreOwnerAdded",
  DataPipelineOwnerAdded = "DataPipelineOwnerAdded",
  // Someone assigned to an incident with a role: told as its owners are (#8573).
  IncidentMemberAdded = "IncidentMemberAdded",
}

export enum OwnerNotificationDeliveryStatus {
  /*
   * Written before the record was taken: this owner is to be told. A run
   * that stopped leaves it so, and a later run tells them
   * (OwnerNotificationDeliveries.resume).
   */
  Pending = "Pending",
  /*
   * One run has set out to tell this owner, and no other may. Should it stop
   * here, nobody knows whether the notification went out, so it is never
   * sent again: the owner is told once at most.
   */
  Sending = "Sending",
  // Told: the notification was handed to the owner's notification settings.
  Sent = "Sent",
  /*
   * Not told: building or sending the owner's notification failed, the
   * record it is about is gone, or every run that set out to tell them
   * stopped part way.
   */
  Failed = "Failed",
}

/*
 * Whether the feed item a notification writes on its record - naming whom
 * it reached - is written yet (#8510). Kept on each of the notification's
 * rows, all alike. None for a notification that writes no feed item, and
 * for the rows written before this was kept.
 */
export enum OwnerNotificationFeedStatus {
  /*
   * To write: by the run that tells the owners, once it has. A run that
   * stopped after its last owner and before the feed item leaves it so, and
   * a later run writes it (OwnerNotificationDeliveries.resume).
   */
  Pending = "Pending",
  Written = "Written",
  /*
   * Not written, and never will be: the record is gone, nobody was told, or
   * every run that set out to write it stopped part way.
   */
  NotWritten = "NotWritten",
}
