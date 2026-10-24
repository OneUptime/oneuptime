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
 */

type ModelType = { new (): BaseModel };

let redactedFieldsByResourceType: Map<string, Set<string>> | null = null;

function getRedactedFieldsByResourceType(): Map<string, Set<string>> {
  if (redactedFieldsByResourceType) {
    return redactedFieldsByResourceType;
  }

  const map: Map<string, Set<string>> = new Map<string, Set<string>>();

  for (const modelType of AllModelTypes as Array<ModelType>) {
    const model: BaseModel = new modelType();

    if (!model.enableAuditLogOn) {
      continue;
    }

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

    // The resource type an entry names: the model's singular name (AuditLogRecorder).
    const resourceType: string =
      model.singularName ||
      (model as unknown as { constructor: { name: string } }).constructor.name;

    map.set(resourceType, fields);
  }

  redactedFieldsByResourceType = map;

  return map;
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

      return redacted;
    },
  );

  return changed ? { ...record, changes } : record;
}
