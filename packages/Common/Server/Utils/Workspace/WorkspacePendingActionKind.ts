/*
 * What a press does that OneUptime can finish once the account is connected.
 *
 * In a file of its own that imports nothing, as WorkspaceEventType is. It
 * was declared in WorkspaceConnectRequest, which imported the member
 * actions and imports the database configuration, and through them the
 * services and the chats' cards, whose tables of the presses OneUptime
 * finishes read it while they load. Loaded while WorkspaceConnectRequest
 * was still loading them, they read it as undefined and threw ("Cannot
 * read properties of undefined (reading 'Acknowledge')"): the list order
 * tests (BuiltInRowsByPlace) did not load at all. Read from here, it is
 * whole in any load order (WorkspaceEnumsLoadOrder).
 * WorkspaceConnectRequest still exports it, taken from here before
 * anything else it imports.
 */
export enum WorkspacePendingActionKind {
  Acknowledge = "Acknowledge",
  Resolve = "Resolve",
  MarkAsOngoing = "MarkAsOngoing",
  MarkAsComplete = "MarkAsComplete",
  // A message pinned, or given a note emoji: saved as a note on the record.
  SavePrivateNote = "SavePrivateNote",
  SavePublicNote = "SavePublicNote",
  /*
   * Approve on a public note's approval message (WorkspacePublicNoteApproval):
   * decided once connected, only while the note is what the message showed.
   */
  ApprovePublicNote = "ApprovePublicNote",
}
