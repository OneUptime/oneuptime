import AuditLogExportSettingsUtil, {
  AuditLogExportSettings,
} from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AuditLogExportRecord,
  toAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  AuditLogExportBatch,
  AuditLogExportDelivery,
} from "../../../Server/AuditLogExport/Destinations/Types";

/*
 * What the audit log export suites share: audit log rows as ClickHouse
 * answers them, the records they become, a batch of them and settings that
 * pass the save checks. Not a test file itself.
 */

export const PROJECT_A: string = "0f9e8d7c-6b5a-4493-8211-00aa11bb22cc";
export const PROJECT_B: string = "1f9e8d7c-6b5a-4493-8211-00aa11bb22cc";

// An audit log row of the table, as its JSON answer has it.
export function auditLogRow(data: {
  id?: string | undefined;
  createdAt: string;
  projectId?: string | undefined;
  resourceName?: string | undefined;
  changes?: Array<JSONObject> | undefined;
}): JSONObject {
  return {
    _id: data.id || ObjectID.generate().toString(),
    // ClickHouse's DateTime, in UTC.
    createdAt: data.createdAt.replace("T", " ").replace(".000Z", ""),
    projectId: data.projectId || PROJECT_A,
    action: "Update",
    resourceType: "Monitor",
    resourceId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    resourceName: data.resourceName || "API health",
    rootResourceType: "Monitor",
    rootResourceId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    userId: "11111111-2222-4333-8444-555555555555",
    userName: "Jane Doe",
    userEmail: "jane@example.com",
    userType: "User",
    apiKeyId: null,
    apiKeyName: null,
    mcpOAuthGrantId: null,
    mcpClientName: null,
    workflowId: null,
    workflowName: null,
    changes: JSON.stringify(
      data.changes || [
        { field: "name", oldValue: "API", newValue: "API health" },
      ],
    ),
  };
}

export function auditLogRecord(
  data: Parameters<typeof auditLogRow>[0],
): AuditLogExportRecord {
  return toAuditLogExportRecord(auditLogRow(data))!;
}

export function batchOf(
  records: Array<AuditLogExportRecord>,
  isTest: boolean = false,
): AuditLogExportBatch {
  return {
    id: records[0]!.id,
    records,
    firstCreatedAt: new Date(records[0]!.createdAt),
    isTest,
  };
}

// Settings as a save keeps them (validated: they would have been refused otherwise).
export function settingsOf(data: {
  type: AuditLogExportDestinationType;
  config: JSONObject;
  secrets?: JSONObject | undefined;
}): AuditLogExportSettings {
  return AuditLogExportSettingsUtil.validate({
    type: data.type,
    config: data.config,
    secrets: data.secrets || {},
    requireRequiredSecrets: true,
  });
}

export function deliveryOf(data: {
  settings: AuditLogExportSettings;
  batch: AuditLogExportBatch;
}): AuditLogExportDelivery {
  return {
    settings: data.settings,
    batch: data.batch,
    egress: { targetLabel: "Test" },
  };
}
