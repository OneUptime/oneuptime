import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  buildTelemetrySecurityEvent,
  cutTelemetryText,
} from "./TelemetrySecurityEvent";

/*
 * WHAT ONEUPTIME'S OWN AUDIT LOG SAYS ABOUT AN ATTACK - read from the
 * changes made in the project (Server/Utils/SecurityEvent/TelemetryScan/
 * AuditLogSecurityScan.ts):
 *
 *   API keys        created (a new way in) and deleted;
 *   roles           custom roles changed, and roles given to API keys and
 *                   teams (who may do what);
 *   teams           created, changed or deleted;
 *   MCP clients     an AI client given access to the project;
 *   packet captures downloaded (network traffic leaving OneUptime);
 *   security        a protected entity, an audit log export or a security
 *   controls        playbook changed or removed;
 *   mass deletes    one actor deleting many records at once.
 *
 * The audit log is OneUptime Enterprise's (ee/Server/AuditLog), written for
 * the projects that turned it on; elsewhere it is empty and this finds
 * nothing. Only the records whose type is in AUDIT_SECURITY_RESOURCE_TYPES
 * are read, by the scan as by this.
 *
 * Pure: the scan hands it the records it read.
 */

export enum AuditResourceType {
  ApiKey = "API Key",
  CustomRole = "Custom Role",
  ApiKeyCustomRole = "API Key Custom Role",
  TeamCustomRole = "Team Custom Role",
  Team = "Team",
  McpClientAuthorization = "MCP Client Authorization",
  PacketCapture = "Packet Capture",
  ProtectedEntity = "Protected Entity",
  AuditLogExport = "Audit Log Export",
  SecurityPlaybook = "Security Playbook",
}

// The record types the scan reads: each audited model's singular name.
export const AUDIT_SECURITY_RESOURCE_TYPES: ReadonlyArray<string> =
  Object.values(AuditResourceType);

// Deletes by one actor in one window that make it a mass delete.
export const MASS_DELETE_MIN_DELETES: number = 25;

export const ACCOUNT_CHANGE_CLASS_UID: number = 3001;
export const ENTITY_MANAGEMENT_CLASS_UID: number = 3004;
export const USER_ACCESS_MANAGEMENT_CLASS_UID: number = 3005;
export const GROUP_MANAGEMENT_CLASS_UID: number = 3006;
export const API_ACTIVITY_CLASS_UID: number = 6003;

export const AUDIT_ATTRIBUTES: {
  recordId: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  action: string;
  actorType: string;
  userId: string;
  userEmail: string;
  apiKeyName: string;
  mcpClientName: string;
  workflowName: string;
  deletes: string;
  sampleResourceTypes: string;
} = {
  recordId: "oneuptime.audit_log.id",
  resourceType: "audit.resource_type",
  resourceId: "audit.resource_id",
  resourceName: "audit.resource_name",
  action: "audit.action",
  actorType: "audit.actor_type",
  userId: "audit.user_id",
  userEmail: "audit.user_email",
  apiKeyName: "audit.api_key_name",
  mcpClientName: "audit.mcp_client_name",
  workflowName: "audit.workflow_name",
  deletes: "audit.deletes",
  sampleResourceTypes: "audit.sample_resource_types",
};

// One audit record as the scan reads it.
export interface AuditScanRecord {
  id: string;
  createdAt: Date;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  action: string;
  userId: string;
  userName: string;
  userEmail: string;
  userType: string;
  apiKeyId: string;
  apiKeyName: string;
  mcpClientName: string;
  workflowName: string;
}

// One actor's deletes in a window, as the database summed them.
export interface MassDeleteRow {
  userId: string;
  userName: string;
  userEmail: string;
  userType: string;
  apiKeyId: string;
  apiKeyName: string;
  deletes: number;
  sampleResourceTypes: Array<string>;
  firstAt: Date;
  lastAt: Date;
}

export interface AuditSignalReading {
  signal: SecurityTelemetrySignal;
  severity: OcsfSeverity;
  classUid: number;
  activityName: string;
}

/*
 * What one audit record is, or null when it is no security signal (a
 * rename of an API key, a playbook edited, a team's role revoked ...).
 */
export function classifyAuditRecord(
  record: Pick<AuditScanRecord, "resourceType" | "action">,
): AuditSignalReading | null {
  const action: string = record.action;

  switch (record.resourceType) {
    case AuditResourceType.ApiKey:
      if (action === AuditLogAction.Create) {
        return {
          signal: SecurityTelemetrySignal.ApiKeyCreated,
          severity: OcsfSeverity.Low,
          classUid: ACCOUNT_CHANGE_CLASS_UID,
          activityName: "Create",
        };
      }

      if (action === AuditLogAction.Delete) {
        return {
          signal: SecurityTelemetrySignal.ApiKeyDeleted,
          severity: OcsfSeverity.Informational,
          classUid: ACCOUNT_CHANGE_CLASS_UID,
          activityName: "Delete",
        };
      }

      return null;
    case AuditResourceType.CustomRole:
    case AuditResourceType.ApiKeyCustomRole:
    case AuditResourceType.TeamCustomRole:
      if (
        action === AuditLogAction.Create ||
        action === AuditLogAction.Update
      ) {
        return {
          signal: SecurityTelemetrySignal.RoleChanged,
          severity: OcsfSeverity.Medium,
          classUid: USER_ACCESS_MANAGEMENT_CLASS_UID,
          activityName: "Assign Privileges",
        };
      }

      if (action === AuditLogAction.Delete) {
        return {
          signal: SecurityTelemetrySignal.RoleChanged,
          severity: OcsfSeverity.Low,
          classUid: USER_ACCESS_MANAGEMENT_CLASS_UID,
          activityName: "Revoke Privileges",
        };
      }

      return null;
    case AuditResourceType.Team:
      if (
        action === AuditLogAction.Create ||
        action === AuditLogAction.Update ||
        action === AuditLogAction.Delete
      ) {
        return {
          signal: SecurityTelemetrySignal.TeamChanged,
          severity: OcsfSeverity.Low,
          classUid: GROUP_MANAGEMENT_CLASS_UID,
          activityName: action,
        };
      }

      return null;
    case AuditResourceType.McpClientAuthorization:
      return action === AuditLogAction.Create
        ? {
            signal: SecurityTelemetrySignal.McpClientAuthorized,
            severity: OcsfSeverity.Low,
            classUid: USER_ACCESS_MANAGEMENT_CLASS_UID,
            activityName: "Assign Privileges",
          }
        : null;
    case AuditResourceType.PacketCapture:
      return action === AuditLogAction.Download
        ? {
            signal: SecurityTelemetrySignal.PacketCaptureDownloaded,
            severity: OcsfSeverity.Low,
            classUid: API_ACTIVITY_CLASS_UID,
            activityName: "Read",
          }
        : null;
    case AuditResourceType.ProtectedEntity:
      return action === AuditLogAction.Update ||
        action === AuditLogAction.Delete
        ? {
            signal: SecurityTelemetrySignal.SecurityControlChanged,
            severity: OcsfSeverity.Medium,
            classUid: ENTITY_MANAGEMENT_CLASS_UID,
            activityName: action,
          }
        : null;
    case AuditResourceType.AuditLogExport:
      return action === AuditLogAction.Create ||
        action === AuditLogAction.Update ||
        action === AuditLogAction.Delete
        ? {
            signal: SecurityTelemetrySignal.SecurityControlChanged,
            severity: OcsfSeverity.Medium,
            classUid: ENTITY_MANAGEMENT_CLASS_UID,
            activityName: action,
          }
        : null;
    case AuditResourceType.SecurityPlaybook:
      return action === AuditLogAction.Delete
        ? {
            signal: SecurityTelemetrySignal.SecurityControlChanged,
            severity: OcsfSeverity.Medium,
            classUid: ENTITY_MANAGEMENT_CLASS_UID,
            activityName: action,
          }
        : null;
    default:
      return null;
  }
}

function quoted(name: string): string {
  const value: string = (name || "").trim();

  return value ? ` "${cutTelemetryText(value, 120)}"` : "";
}

// Who made a change, as a sentence names them.
export function describeAuditActor(
  actor: Pick<
    AuditScanRecord,
    "userEmail" | "userName" | "apiKeyName" | "workflowName" | "mcpClientName"
  >,
): string {
  if ((actor.userEmail || "").trim()) {
    return actor.userEmail.trim();
  }

  if ((actor.userName || "").trim()) {
    return actor.userName.trim();
  }

  if ((actor.apiKeyName || "").trim()) {
    return `The API key${quoted(actor.apiKeyName)}`;
  }

  if ((actor.workflowName || "").trim()) {
    return `The workflow${quoted(actor.workflowName)}`;
  }

  if ((actor.mcpClientName || "").trim()) {
    return `The MCP client${quoted(actor.mcpClientName)}`;
  }

  return "Someone";
}

function verbOf(action: string): string {
  switch (action) {
    case AuditLogAction.Create:
      return "created";
    case AuditLogAction.Delete:
      return "deleted";
    case AuditLogAction.Download:
      return "downloaded";
    default:
      return "changed";
  }
}

// One audit record, said as a person would say it.
export function describeAuditChange(record: AuditScanRecord): string {
  const actor: string = describeAuditActor(record);
  const name: string = quoted(record.resourceName);
  const verb: string = verbOf(record.action);

  switch (record.resourceType) {
    case AuditResourceType.ApiKey:
      return `${actor} ${verb} the API key${name}`;
    case AuditResourceType.CustomRole:
      return `${actor} ${verb} the custom role${name}`;
    case AuditResourceType.ApiKeyCustomRole:
      return record.action === AuditLogAction.Delete
        ? `${actor} took a custom role away from an API key${name}`
        : `${actor} gave an API key a custom role${name}`;
    case AuditResourceType.TeamCustomRole:
      return record.action === AuditLogAction.Delete
        ? `${actor} took a custom role away from a team${name}`
        : `${actor} gave a team a custom role${name}`;
    case AuditResourceType.Team:
      return `${actor} ${verb} the team${name}`;
    case AuditResourceType.McpClientAuthorization:
      return `${actor} authorized the MCP client${quoted(
        record.mcpClientName || record.resourceName,
      )}`;
    case AuditResourceType.PacketCapture:
      return `${actor} downloaded the packet capture${name}`;
    case AuditResourceType.ProtectedEntity:
      return `${actor} ${verb} the protected entity${name}`;
    case AuditResourceType.AuditLogExport:
      return `${actor} ${verb} the audit log export${name}`;
    case AuditResourceType.SecurityPlaybook:
      return `${actor} ${verb} the security playbook${name}`;
    default:
      return `${actor} ${verb} ${record.resourceType}${name}`;
  }
}

function principalOf(
  actor: Pick<AuditScanRecord, "userEmail" | "userName" | "apiKeyName">,
): string {
  return (
    (actor.userEmail || "").trim() ||
    (actor.userName || "").trim() ||
    (actor.apiKeyName || "").trim()
  );
}

function actorAttributes(
  actor: Pick<
    AuditScanRecord,
    | "userType"
    | "userId"
    | "userEmail"
    | "apiKeyName"
    | "mcpClientName"
    | "workflowName"
  >,
): JSONObject {
  const attributes: JSONObject = {};

  const values: Array<[string, string]> = [
    [AUDIT_ATTRIBUTES.actorType, actor.userType],
    [AUDIT_ATTRIBUTES.userId, actor.userId],
    [AUDIT_ATTRIBUTES.userEmail, actor.userEmail],
    [AUDIT_ATTRIBUTES.apiKeyName, actor.apiKeyName],
    [AUDIT_ATTRIBUTES.mcpClientName, actor.mcpClientName],
    [AUDIT_ATTRIBUTES.workflowName, actor.workflowName],
  ];

  for (const [key, value] of values) {
    if ((value || "").trim()) {
      attributes[key] = value.trim();
    }
  }

  return attributes;
}

export function buildAuditRecordEvent(
  record: AuditScanRecord,
): NormalizedSecurityEvent | null {
  const reading: AuditSignalReading | null = classifyAuditRecord(record);

  if (!reading || !record.id) {
    return null;
  }

  const attributes: JSONObject = {
    ...actorAttributes(record),
    [AUDIT_ATTRIBUTES.recordId]: record.id,
    [AUDIT_ATTRIBUTES.resourceType]: record.resourceType,
    [AUDIT_ATTRIBUTES.action]: record.action,
  };

  if (record.resourceId) {
    attributes[AUDIT_ATTRIBUTES.resourceId] = record.resourceId;
  }

  if (record.resourceName) {
    attributes[AUDIT_ATTRIBUTES.resourceName] = record.resourceName;
  }

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.AuditLog,
    signal: reading.signal,
    time: record.createdAt,
    eventUid: `audit:${record.id}:${reading.signal}`,
    classUid: reading.classUid,
    activityName: reading.activityName,
    statusName: "Success",
    severity: reading.severity,
    message: describeAuditChange(record),
    principalUser: principalOf(record),
    targetResource: [
      record.resourceType,
      (record.resourceName || record.resourceId || "").trim(),
    ]
      .filter(Boolean)
      .join(": "),
    attributes,
  });
}

function minutesBetween(first: Date, last: Date): number {
  const minutes: number = Math.ceil((last.getTime() - first.getTime()) / 60000);

  return Number.isFinite(minutes) && minutes > 0 ? minutes : 1;
}

export function buildMassDeleteEvent(
  row: MassDeleteRow,
  windowStart: Date,
): NormalizedSecurityEvent | null {
  if (row.deletes < MASS_DELETE_MIN_DELETES) {
    return null;
  }

  const actor: string = describeAuditActor({
    userEmail: row.userEmail,
    userName: row.userName,
    apiKeyName: row.apiKeyName,
    workflowName: "",
    mcpClientName: "",
  });
  const minutes: number = minutesBetween(row.firstAt, row.lastAt);
  const types: Array<string> = [...row.sampleResourceTypes]
    .filter(Boolean)
    .sort()
    .slice(0, 5);

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.AuditLog,
    signal: SecurityTelemetrySignal.MassDelete,
    time: row.firstAt,
    eventUid: `audit:${SecurityTelemetrySignal.MassDelete}:${
      row.userId || row.apiKeyId || actor
    }:${windowStart.toISOString()}`,
    classUid: API_ACTIVITY_CLASS_UID,
    activityName: "Delete",
    statusName: "Success",
    severity: OcsfSeverity.High,
    message: `${actor} deleted ${row.deletes} records in ${minutes} ${
      minutes === 1 ? "minute" : "minutes"
    }${types.length > 0 ? ` (${types.join(", ")})` : ""}`,
    principalUser: principalOf(row),
    attributes: {
      ...actorAttributes({
        userType: row.userType,
        userId: row.userId,
        userEmail: row.userEmail,
        apiKeyName: row.apiKeyName,
        mcpClientName: "",
        workflowName: "",
      }),
      [AUDIT_ATTRIBUTES.deletes]: String(row.deletes),
      [AUDIT_ATTRIBUTES.sampleResourceTypes]: types.join(","),
    },
  });
}
