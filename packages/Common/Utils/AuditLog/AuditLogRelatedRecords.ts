import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * THE RECORDS A CHANGE NAMES, BY THEIR NAMES (#10470).
 *
 * An audit log entry records a related record by its id: a monitor's status
 * (`currentMonitorStatusId`) as a UUID, and a relation's records (`labels`,
 * an incident's `monitors`) as `{ _id, name }`, with the name they had when
 * the change was made. The changes dialog read two UUIDs, Before and After,
 * or a list as JSON. When it opens it now asks for the names of every
 * record its changes name, once (GET /audit-log/:id/related-record-names,
 * Server/Utils/AuditLog/AuditLogRelatedNames): read then, with the reader's
 * own permissions, and never stored - an entry is immutable, and a name can
 * change. Each record reads as one of:
 *
 *   - Named: its name now;
 *   - Deleted: it is gone, said only to a reader who would read it if it
 *     were there - with the name the entry recorded, where that name is
 *     theirs to read;
 *   - Hidden: one the reader may not read, or may not tell apart from one
 *     deleted: "Name hidden", and its id.
 *
 * A value the reader may not read (#10642) names no record: its change is
 * hidden, and nothing of it is asked for. A record whose table has no name
 * is in none of the three, and keeps its id.
 */

export enum AuditLogRelatedRecordState {
  Named = "Named",
  Deleted = "Deleted",
  Hidden = "Hidden",
}

export interface AuditLogRelatedRecord {
  state: AuditLogRelatedRecordState;
  // Named: its name now. Deleted: the name the entry recorded, if any.
  name?: string | undefined;
}

// Each field's related records, by lower-cased id.
export type AuditLogRelatedRecords = Map<
  string,
  Map<string, AuditLogRelatedRecord>
>;

// The longest name a record is read back with.
export const MAX_AUDIT_LOG_RELATED_NAME_LENGTH: number = 300;

const STATES: ReadonlyArray<string> = Object.values(AuditLogRelatedRecordState);

// A record's id as it is compared: lower case, or null for anything that is no id.
export function readAuditLogRecordId(value: unknown): string | null {
  let text: string | null = null;

  if (typeof value === "string") {
    text = value;
  } else if (value instanceof ObjectID) {
    text = value.toString();
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const id: unknown = (value as JSONObject)["_id"];

    text = typeof id === "string" ? id : null;
  }

  const trimmed: string = (text || "").trim();

  return trimmed && ObjectID.isValidUUID(trimmed)
    ? trimmed.toLowerCase()
    : null;
}

/*
 * The ids of the records a change's value names, in its order, each once:
 * an id, a `{ _id, name }`, or a list of either. Anything else names none.
 */
export function readAuditLogRecordIds(value: unknown): Array<string> {
  const values: Array<unknown> = Array.isArray(value) ? value : [value];
  const ids: Array<string> = [];

  for (const item of values) {
    const id: string | null = readAuditLogRecordId(item);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * The name a value recorded for one of its records - a `{ _id, name }`
 * naming it - or null. What it holds is what the reader was handed: a name
 * they may not read was left out of it (#10642).
 */
export function readAuditLogRecordedName(
  value: unknown,
  id: string,
): string | null {
  const values: Array<unknown> = Array.isArray(value) ? value : [value];

  for (const item of values) {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      readAuditLogRecordId(item) === id
    ) {
      const name: unknown = (item as JSONObject)["name"];

      if (typeof name === "string" && name.trim()) {
        return name.trim();
      }
    }
  }

  return null;
}

function readRecord(value: unknown): AuditLogRelatedRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const state: unknown = (value as JSONObject)["state"];

  if (typeof state !== "string" || !STATES.includes(state)) {
    return null;
  }

  const name: unknown = (value as JSONObject)["name"];
  const record: AuditLogRelatedRecord = {
    state: state as AuditLogRelatedRecordState,
  };

  // A hidden record carries no name, whatever was sent.
  if (
    state !== AuditLogRelatedRecordState.Hidden &&
    typeof name === "string" &&
    name.trim()
  ) {
    record.name = name.trim().slice(0, MAX_AUDIT_LOG_RELATED_NAME_LENGTH);
  }

  // A record said to be named has a name: one that has none is no answer.
  if (state === AuditLogRelatedRecordState.Named && !record.name) {
    return null;
  }

  return record;
}

// The answer as it is sent: `{ fields: { [field]: { [id]: { state, name? } } } }`.
export function toAuditLogRelatedRecordsJSON(
  records: AuditLogRelatedRecords,
): JSONObject {
  const fields: JSONObject = {};

  for (const [field, byId] of records) {
    const json: JSONObject = {};

    for (const [id, record] of byId) {
      json[id] = record.name
        ? { state: record.state, name: record.name }
        : { state: record.state };
    }

    fields[field] = json;
  }

  return { fields };
}

// The answer as it is read back: anything that is not one is left out.
export function readAuditLogRelatedRecords(
  json: unknown,
): AuditLogRelatedRecords {
  const records: AuditLogRelatedRecords = new Map();
  const fields: unknown =
    json && typeof json === "object" && !Array.isArray(json)
      ? (json as JSONObject)["fields"]
      : null;

  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return records;
  }

  for (const [field, byIdJson] of Object.entries(fields as JSONObject)) {
    if (!byIdJson || typeof byIdJson !== "object" || Array.isArray(byIdJson)) {
      continue;
    }

    const byId: Map<string, AuditLogRelatedRecord> = new Map();

    for (const [rawId, value] of Object.entries(byIdJson as JSONObject)) {
      const id: string | null = readAuditLogRecordId(rawId);
      const record: AuditLogRelatedRecord | null = readRecord(value);

      if (id && record) {
        byId.set(id, record);
      }
    }

    if (byId.size > 0) {
      records.set(field, byId);
    }
  }

  return records;
}
