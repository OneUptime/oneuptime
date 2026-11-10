import { JSONArray, JSONObject, JSONValue } from "../../JSON";
import { readAuditLogChange } from "../../../Utils/AuditLog/AuditLogTypedValues";

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
 *
 * A typed value - a phone number, an email address, a URL - is what it
 * holds, "+14155550100", in every version: the recorder records it so, and
 * an entry recorded before it did, as { "_type": "Phone", "value": ... },
 * is read so on its way out (readAuditLogExportTypedValues). That changes
 * no key, so it is no new version: a value has always been whatever its
 * field holds, and the { _type, value } JSON was never part of the schema.
 *
 * THE VERSIONS. Each export says which version it sends
 * (AuditLogExport.schemaVersion), and every record says which it is:
 *
 *   1  the record as it was first sent. Each change is { field, oldValue?,
 *      newValue? }; a field the audit log describes rather than copies - a
 *      workflow's steps - goes out as its short before and after ("3 steps
 *      and 2 connections").
 *   2  version 1, and each change also carries `summary`: what changed, in
 *      plain lines - the steps a workflow save added, changed, removed or
 *      connected, the paths that changed in JSON ("Changed requestHeaders ›
 *      Authorization") - or null when the entry has none. The lines name
 *      settings and paths, never values.
 *
 * An export saved before version 2 existed keeps version 1, so nothing that
 * reads it has to change; a new export sends the newest version.
 */

export type AuditLogExportSchemaVersion = 1 | 2;

// Every version an export can send, oldest first.
export const AUDIT_LOG_EXPORT_SCHEMA_VERSIONS: ReadonlyArray<AuditLogExportSchemaVersion> =
  [1, 2];

// The first version: what an export that never chose one sends.
export const AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION: AuditLogExportSchemaVersion = 1;

// The newest version: what a new export sends unless it asks for an older one.
export const AUDIT_LOG_EXPORT_SCHEMA_VERSION: AuditLogExportSchemaVersion = 2;

// The first version whose changes carry their summary lines.
export const AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION: AuditLogExportSchemaVersion = 2;

export function isAuditLogExportSchemaVersion(
  value: unknown,
): value is AuditLogExportSchemaVersion {
  return AUDIT_LOG_EXPORT_SCHEMA_VERSIONS.includes(
    value as AuditLogExportSchemaVersion,
  );
}

/*
 * The version an export sends, as its row (or a form) holds it - the
 * number, or its text: the first version when it holds none, or one this
 * release does not know, so a reader is never sent a shape nobody chose.
 */
export function readAuditLogExportSchemaVersion(
  value: unknown,
): AuditLogExportSchemaVersion {
  const version: unknown =
    typeof value === "string" && value.trim() !== ""
      ? Number(value.trim())
      : value;

  return isAuditLogExportSchemaVersion(version)
    ? version
    : AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION;
}

export interface AuditLogExportChange {
  field: string;
  // Present for an update and a delete: the value before.
  oldValue?: JSONValue | undefined;
  // Present for a create, an update and a download: the value after.
  newValue?: JSONValue | undefined;
  /*
   * From version 2: what changed, in plain lines, or null when the entry
   * has none. Always present in version 2, never in version 1.
   */
  summary?: Array<string> | null | undefined;
}

export interface AuditLogExportRecord {
  schemaVersion: AuditLogExportSchemaVersion;
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

/*
 * What changed, as a change recorded it: its text lines, as written, in
 * order - anything else (a number, an object, a blank line) is left out,
 * as the audit log's own table leaves it out. Null when no line is left.
 */
export function readAuditLogExportSummary(
  value: JSONValue | undefined,
): Array<string> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const lines: Array<string> = [];

  for (const line of value as Array<JSONValue>) {
    if (typeof line === "string" && line.trim().length > 0) {
      lines.push(line);
    }
  }

  return lines.length > 0 ? lines : null;
}

function readChange(
  value: JSONValue,
  schemaVersion: AuditLogExportSchemaVersion,
): AuditLogExportChange | null {
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

  if (schemaVersion >= AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION) {
    change.summary = readAuditLogExportSummary(
      entry["summary"] as JSONValue | undefined,
    );
  }

  return change;
}

/*
 * The changes as recorded: the column holds a JSON array (as text, the
 * way ClickHouse stores it, or already parsed). Anything that is not an
 * array of { field, oldValue?, newValue? } is left out rather than sent
 * in a shape the schema does not promise - and in version 1 the recorded
 * summary lines are not sent either, so a version 1 record is what it
 * always was.
 */
export function readAuditLogExportChanges(
  value: JSONValue | undefined,
  schemaVersion: AuditLogExportSchemaVersion = AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION,
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
    const change: AuditLogExportChange | null = readChange(item, schemaVersion);

    if (change) {
      changes.push(change);
    }
  }

  return changes;
}

/*
 * One audit log row, as the audit table answers it (JSON), as the record
 * the destinations receive, in the version the export sends - the first
 * when none is named. Null for a row with no id or no time, which the
 * export cannot place.
 */
export function toAuditLogExportRecord(
  row: JSONObject,
  schemaVersion: AuditLogExportSchemaVersion = AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION,
): AuditLogExportRecord | null {
  const id: string | null = readText(row["_id"]);
  const createdAt: Date | null = readAuditLogExportDate(row["createdAt"]);

  if (!id || !createdAt) {
    return null;
  }

  return {
    schemaVersion,
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
    changes: readAuditLogExportChanges(row["changes"], schemaVersion),
  };
}

/*
 * A record as the recorder writes entries now (issue #6325): a phone
 * number, an email address or a URL an entry recorded as its JSON before -
 * { "_type": "Phone", "value": "+14155550100" } - goes out as what it
 * holds, "+14155550100", in every version, and with no summary lines when
 * that leaves both values plain, as a change recorded today has none; a
 * hash goes out as "[REDACTED]". Everything else is as recorded, and a
 * record with no typed value in it comes back as it is, the same object.
 *
 * It runs after the export's redaction (AuditLogExportRedaction), so a
 * secret field is the marker before anything reads it. toAuditLogExportRecord
 * stays the row as recorded, which the version 1 guard holds to the line
 * version 1 first wrote.
 */
export function readAuditLogExportTypedValues(
  record: AuditLogExportRecord,
): AuditLogExportRecord {
  let isChanged: boolean = false;

  const changes: Array<AuditLogExportChange> = record.changes.map(
    (change: AuditLogExportChange): AuditLogExportChange => {
      const read: AuditLogExportChange = readAuditLogChange(change);

      if (read !== change) {
        isChanged = true;
      }

      return read;
    },
  );

  return isChanged ? { ...record, changes } : record;
}

/*
 * A record as one line of JSON, its keys in schema order. Never holds a
 * line break: JSON.stringify escapes \n and \r inside strings, and the
 * Unicode line and paragraph separators it leaves as they are - which some
 * readers split lines on (Python's splitlines) - are escaped here, so one
 * entry is always one line of an NDJSON file, whatever reads it.
 */
const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);

export function serializeAuditLogExportRecord(
  record: AuditLogExportRecord,
): string {
  const ordered: Record<string, unknown> = {};

  for (const key of AUDIT_LOG_EXPORT_RECORD_KEYS) {
    ordered[key] = record[key];
  }

  return JSON.stringify(ordered)
    .split(LINE_SEPARATOR)
    .join("\\u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join("\\u2029");
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
  // The version the export sends: the test arrives as its entries will.
  schemaVersion?: AuditLogExportSchemaVersion | undefined;
}): AuditLogExportRecord {
  return {
    schemaVersion: data.schemaVersion || AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION,
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
