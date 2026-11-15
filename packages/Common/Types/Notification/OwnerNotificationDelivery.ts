/*
 * WHAT THE OWNERS OF AN INCIDENT OR AN ALERT ARE TOLD, OWNER BY OWNER
 * (issue #8199).
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
