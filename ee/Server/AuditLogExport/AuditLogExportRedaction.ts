import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getAuditLogRedactedColumns,
  redactAuditLogValue,
} from "Common/Types/AuditLog/AuditLogRedaction";
import {
  AuditLogExportChange,
  AuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import { getColumnAccessControlForAllColumns } from "Common/Types/Database/AccessControl/ColumnAccessControl";
import { getAuditLogResourceTypesOfModel } from "Common/Utils/AuditLog/AuditLogResourceTypes";

/*
 * NOTHING SECRET LEAVES IN AN EXPORTED ENTRY, whenever it was recorded.
 *
 * The recorder leaves out the fields nobody may read and writes secrets as
 * "[REDACTED]" (Common/Types/AuditLog/AuditLogRedaction). An entry recorded
 * before a field was listed there still holds its value in the audit log
 * until its retention ends - so every entry is redacted again here, on its
 * way out, by its resource type: the model's redacted columns (listed,
 * encrypted and hashed) and the columns nobody may read. A field is still
 * named, so the entry says it changed; only its values become the marker.
 *
 * A change's summary lines (schema version 2) pass through as they are:
 * they name settings and paths - a workflow's steps, the keys of JSON that
 * changed - never a value, and the recorder writes none for a secret.
 */

export type AuditLogExportModelType = { new (): BaseModel };

/*
 * The fields of a model an exported entry never carries the values of: its
 * redacted columns (listed, encrypted and hashed) and the columns nobody
 * may read.
 */
function getRedactedFieldsOf(model: BaseModel): Set<string> {
  const fields: Set<string> = getAuditLogRedactedColumns(model);
  const access: Record<string, { read?: Array<unknown> }> =
    getColumnAccessControlForAllColumns(model) as Record<
      string,
      { read?: Array<unknown> }
    >;

  for (const column of Object.keys(access)) {
    const read: Array<unknown> | undefined = access[column]?.read;

    if (Array.isArray(read) && read.length === 0) {
      fields.add(column);
    }
  }

  return fields;
}

/*
 * Each resource type an entry can name, with the fields an exported entry
 * of it never carries the values of, for `modelTypes`.
 *
 * A model's entries are keyed by every type they can be stored under
 * (getAuditLogResourceTypesOfModel): the singular name the model keeps for
 * the API and this log (AuditLogRecorder), which a renamed model's name on
 * screen is not - an Ingestion Key's entries are stored as "Telemetry
 * Ingestion Key", and keyed by "Ingestion Key" they were sent out
 * unredacted (#7580) - its name on screen, as the audit log reads a type by
 * either, and the name it had before it was renamed, which its older
 * entries carry.
 *
 * A type two models' entries carry redacts what either model redacts: an
 * entry of it can be about either. "Subscriber Notification Template" is
 * the template's, and a status page's link to one had it too until #10664.
 * Keyed one model at a time, the link's fields overwrote the template's,
 * and a template's entry was redacted by the link's fields alone.
 */
export function buildExportRedactedFieldsByResourceType(
  modelTypes: ReadonlyArray<AuditLogExportModelType>,
): Map<string, Set<string>> {
  const map: Map<string, Set<string>> = new Map<string, Set<string>>();

  for (const modelType of modelTypes) {
    const model: BaseModel = new modelType();

    if (!model.enableAuditLogOn) {
      continue;
    }

    const fields: Set<string> = getRedactedFieldsOf(model);

    for (const resourceType of getAuditLogResourceTypesOfModel(model)) {
      map.set(
        resourceType,
        new Set<string>([...(map.get(resourceType) || []), ...fields]),
      );
    }
  }

  return map;
}

let redactedFieldsByResourceType: Map<string, Set<string>> | null = null;

function getRedactedFieldsByResourceType(): Map<string, Set<string>> {
  if (!redactedFieldsByResourceType) {
    redactedFieldsByResourceType = buildExportRedactedFieldsByResourceType(
      AllModelTypes as Array<AuditLogExportModelType>,
    );
  }

  return redactedFieldsByResourceType;
}

// The fields of a resource type an exported entry never carries the values of.
export function getExportRedactedFields(
  resourceType: string | null,
): Set<string> {
  if (!resourceType) {
    return new Set<string>();
  }

  return (
    getRedactedFieldsByResourceType().get(resourceType) || new Set<string>()
  );
}

export function redactAuditLogExportRecord(
  record: AuditLogExportRecord,
): AuditLogExportRecord {
  const fields: Set<string> = getExportRedactedFields(record.resourceType);

  if (fields.size === 0) {
    return record;
  }

  let changed: boolean = false;

  const changes: Array<AuditLogExportChange> = record.changes.map(
    (change: AuditLogExportChange): AuditLogExportChange => {
      if (!fields.has(change.field)) {
        return change;
      }

      changed = true;

      const redacted: AuditLogExportChange = { field: change.field };

      if (Object.prototype.hasOwnProperty.call(change, "oldValue")) {
        redacted.oldValue = redactAuditLogValue(change.oldValue) as
          | string
          | null;
      }

      if (Object.prototype.hasOwnProperty.call(change, "newValue")) {
        redacted.newValue = redactAuditLogValue(change.newValue) as
          | string
          | null;
      }

      if (Object.prototype.hasOwnProperty.call(change, "summary")) {
        redacted.summary = change.summary ?? null;
      }

      return redacted;
    },
  );

  return changed ? { ...record, changes } : record;
}
