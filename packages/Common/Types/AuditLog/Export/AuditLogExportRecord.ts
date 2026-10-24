import { JSONArray, JSONObject, JSONValue } from "../../JSON";

/*
 * ONE AUDIT LOG ENTRY AS IT IS EXPORTED: the JSON object every
 * destination receives, one per entry - a line of an NDJSON file, an
 * element of a webhook's batch, the message of a syslog record.
 *
 * The schema is a contract with whatever reads the export (an Athena or
 * BigQuery table, a SIEM's parser), so it is versioned and stable:
 *
 *   - every key is always present, null when the entry has no value, so a
 *     reader never has to tell "missing" from "empty";
 *   - the names are the audit log's own (the API reference's AuditLog
 *     columns), so the export and the API read the same way;
 *   - keys are only ever added in a new schemaVersion, never renamed or
 *     removed within one.
 *
 * Nothing secret is in an entry: the recorder leaves out every field
 * nobody may read (passwords, keys, tokens) before it is written, and the
 * export carries the entry as recorded.
 */

export const AUDIT_LOG_EXPORT_SCHEMA_VERSION: number = 1;

export interface AuditLogExportChange {
  field: string;
  // Present for an update and a delete: the value before.
  oldValue?: JSONValue | undefined;
  // Present for a create, an update and a download: the value after.
  newValue?: JSONValue | undefined;
}

export interface AuditLogExportRecord {
  schemaVersion: number;
  // The entry's own id: the same entry exported twice has the same id.
  id: string;
  // When the change was recorded, ISO 8601 in UTC.
  createdAt: string;
  projectId: string | null;
  // Create, Update, Delete or Download.
  action: string | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceName: string | null;
  rootResourceType: string | null;
  rootResourceId: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  // User, API, MasterAdmin, Workflow or System.
  userType: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
  mcpOAuthGrantId: string | null;
  mcpClientName: string | null;
  workflowId: string | null;
  workflowName: string | null;
  changes: Array<AuditLogExportChange>;
}

/*
 * The keys of a record, in the order they are written: the order of the
 * schema above, so every line of a file reads alike.
 */
export const AUDIT_LOG_EXPORT_RECORD_KEYS: ReadonlyArray<
  keyof AuditLogExportRecord
> = [
  "schemaVersion",
  "id",
  "createdAt",
  "projectId",
  "action",
  "resourceType",
  "resourceId",
  "resourceName",
  "rootResourceType",
  "rootResourceId",
  "userId",
  "userName",
  "userEmail",
  "userType",
  "apiKeyId",
  "apiKeyName",
  "mcpOAuthGrantId",
  "mcpClientName",
  "workflowId",
  "workflowName",
  "changes",
];

// The audit log columns a record is read from: every key but schemaVersion and id, plus _id.
export const AUDIT_LOG_EXPORT_SOURCE_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "createdAt",
  "projectId",
  "action",
  "resourceType",
  "resourceId",
  "resourceName",
  "rootResourceType",
  "rootResourceId",
  "userId",
  "userName",
  "userEmail",
  "userType",
  "apiKeyId",
  "apiKeyName",
  "mcpOAuthGrantId",
  "mcpClientName",
  "workflowId",
  "workflowName",
  "changes",
];

function readText(value: JSONValue | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text: string = typeof value === "string" ? value : String(value);

  return text.length > 0 ? text : null;
}

/*
 * ClickHouse answers a DateTime as "2026-10-19 10:00:00" in UTC; a reader
 * may already have made a Date or an ISO string of it.
 */
export function readAuditLogExportDate(
  value: JSONValue | Date | undefined,
): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text: string | null = readText(value as JSONValue | undefined);

  if (!text) {
    return null;
  }

  const trimmed: string = text.trim();
  const isoText: string = trimmed.includes("T")
    ? trimmed
    : `${trimmed.replace(" ", "T")}Z`;
  const date: Date = new Date(isoText);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readChange(value: JSONValue): AuditLogExportChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entry: JSONObject = value as JSONObject;
  const field: string | null = readText(entry["field"]);

  if (!field) {
    return null;
  }

  const change: AuditLogExportChange = { field };

  if (Object.prototype.hasOwnProperty.call(entry, "oldValue")) {
    change.oldValue =
      entry["oldValue"] === undefined ? null : (entry["oldValue"] as JSONValue);
  }

  if (Object.prototype.hasOwnProperty.call(entry, "newValue")) {
    change.newValue =
      entry["newValue"] === undefined ? null : (entry["newValue"] as JSONValue);
  }

  return change;
}

/*
 * The changes as recorded: the column holds a JSON array (as text, the
 * way ClickHouse stores it, or already parsed). Anything that is not an
 * array of { field, oldValue?, newValue? } is left out rather than sent
 * in a shape the schema does not promise.
 */
export function readAuditLogExportChanges(
  value: JSONValue | undefined,
): Array<AuditLogExportChange> {
  let parsed: unknown = value;

  if (typeof value === "string") {
    if (!value.trim()) {
      return [];
    }

    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const changes: Array<AuditLogExportChange> = [];

  for (const item of parsed as JSONArray) {
    const change: AuditLogExportChange | null = readChange(item);

    if (change) {
      changes.push(change);
    }
  }

  return changes;
}

/*
 * One audit log row, as the audit table answers it (JSON), as the record
 * the destinations receive. Null for a row with no id or no time, which
 * the export cannot place.
 */
export function toAuditLogExportRecord(
  row: JSONObject,
): AuditLogExportRecord | null {
  const id: string | null = readText(row["_id"]);
  const createdAt: Date | null = readAuditLogExportDate(row["createdAt"]);

  if (!id || !createdAt) {
    return null;
  }

  return {
    schemaVersion: AUDIT_LOG_EXPORT_SCHEMA_VERSION,
    id,
    createdAt: createdAt.toISOString(),
    projectId: readText(row["projectId"]),
    action: readText(row["action"]),
    resourceType: readText(row["resourceType"]),
    resourceId: readText(row["resourceId"]),
    resourceName: readText(row["resourceName"]),
    rootResourceType: readText(row["rootResourceType"]),
    rootResourceId: readText(row["rootResourceId"]),
    userId: readText(row["userId"]),
    userName: readText(row["userName"]),
    userEmail: readText(row["userEmail"]),
    userType: readText(row["userType"]),
    apiKeyId: readText(row["apiKeyId"]),
    apiKeyName: readText(row["apiKeyName"]),
    mcpOAuthGrantId: readText(row["mcpOAuthGrantId"]),
    mcpClientName: readText(row["mcpClientName"]),
    workflowId: readText(row["workflowId"]),
    workflowName: readText(row["workflowName"]),
    changes: readAuditLogExportChanges(row["changes"]),
  };
}

/*
 * A record as one line of JSON, its keys in schema order. Never holds a
 * line break: JSON.stringify escapes those inside strings, so one entry
 * is always one line of an NDJSON file.
 */
export function serializeAuditLogExportRecord(
  record: AuditLogExportRecord,
): string {
  const ordered: Record<string, unknown> = {};

  for (const key of AUDIT_LOG_EXPORT_RECORD_KEYS) {
    ordered[key] = record[key];
  }

  return JSON.stringify(ordered);
}

/*
 * A record that marks a test: what "Test" writes, so a person setting a
 * destination up sees one arrive in its real shape. Its action says what
 * it is, and nothing in it names a project's data.
 */
export const AUDIT_LOG_EXPORT_TEST_ACTION: string = "Test";

export function buildAuditLogExportTestRecord(data: {
  now: Date;
  id: string;
  projectId: string | null;
}): AuditLogExportRecord {
  return {
    schemaVersion: AUDIT_LOG_EXPORT_SCHEMA_VERSION,
    id: data.id,
    createdAt: data.now.toISOString(),
    projectId: data.projectId,
    action: AUDIT_LOG_EXPORT_TEST_ACTION,
    resourceType: "Audit Log Export",
    resourceId: null,
    resourceName: "Audit log export test",
    rootResourceType: null,
    rootResourceId: null,
    userId: null,
    userName: null,
    userEmail: null,
    userType: "System",
    apiKeyId: null,
    apiKeyName: null,
    mcpOAuthGrantId: null,
    mcpClientName: null,
    workflowId: null,
    workflowName: null,
    changes: [],
  };
}
