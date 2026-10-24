import EnableAuditLogOn from "../BaseDatabase/EnableAuditLogOn";

/*
 * Secrets in the audit log: which fields of a resource an entry records
 * as changed but never with their value.
 *
 * The audit log is read by roles that may not read every field of what it
 * records (Read Audit Log, Settings Admin), and its entries leave OneUptime
 * when the audit log is exported. So a field holding a secret - an API key,
 * a heartbeat monitor's key, a status page's password - is recorded as
 * changed, by whom and when, with AUDIT_LOG_REDACTED_VALUE in place of each
 * value:
 *
 *   - the columns the model lists in @EnableAuditLog({ redactColumns });
 *   - every encrypted column (TableColumn encrypted: true) and every hashed
 *     one (hashed: true): a value stored that way is a secret by definition.
 *
 * Columns nobody may read (read: []) are left out of entries altogether, as
 * before (the recorder's redacted fields). The recorder applies this when it
 * writes an entry, and the Enterprise exporter applies it again to every
 * entry it sends, so an entry written before a column was listed never
 * leaves with its value either.
 */

export const AUDIT_LOG_REDACTED_VALUE: string = "[REDACTED]";

// What this needs of a model: its audit configuration and its stored secrets.
export interface AuditLogRedactionModel {
  enableAuditLogOn?: EnableAuditLogOn | undefined;
  getEncryptedColumns: () => { columns: Array<string> };
  getHashedColumns: () => { columns: Array<string> };
}

export function getAuditLogRedactedColumns(
  model: AuditLogRedactionModel,
): Set<string> {
  return new Set<string>([
    ...(model.enableAuditLogOn?.redactColumns || []),
    ...model.getEncryptedColumns().columns,
    ...model.getHashedColumns().columns,
  ]);
}

/*
 * A recorded value as an entry carries it when its field is redacted:
 * nothing when there was nothing, else the marker.
 */
export function redactAuditLogValue(value: unknown): unknown {
  return value === null || value === undefined
    ? null
    : AUDIT_LOG_REDACTED_VALUE;
}
