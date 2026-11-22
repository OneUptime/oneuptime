/*
 * WHICH OF A RECORD'S COLUMNS AN AUDIT LOG ENTRY CAN HOLD, AND WHICH NAME
 * IT: the one list the Enterprise recorder writes entries by
 * (ee/Server/AuditLog/AuditLogRecorder) and the audit log's reads hold
 * entries to their readers by (Server/Utils/AuditLog/AuditLogReadAccess).
 */

/*
 * The columns no entry records, whatever a change wrote: the row's id, its
 * timestamps, its version and its slug - bookkeeping, never what somebody
 * changed.
 */
export const AUDIT_LOG_UNRECORDED_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
  "slug",
];

/*
 * The columns an entry is named by, in the order they are tried: the
 * first that holds a name, of those somebody may read. A row with none of
 * them is named by its model's own columns (EnableAuditLogOn
 * .resourceNameColumns) or by a row it names (resourceNameRelation).
 */
export const AUDIT_LOG_NAME_COLUMNS: ReadonlyArray<string> = [
  "name",
  "title",
  "displayName",
];
