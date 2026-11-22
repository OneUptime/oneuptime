import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  ONEUPTIME_PRINCIPAL,
  getWorkflowPrincipal,
} from "../../../Types/SecurityEvent/OneUptimeActorPrincipal";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import UserType from "../../../Types/UserType";
import {
  WorkflowRunAs,
  describeWorkflowRunAs,
  describeWorkflowRunAsGiver,
  readWorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
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
 * WHO ACTED (#10430). An entry names its actor by kind (userType) and by
 * the ids of that kind: a person (userId, and their email and name), a
 * project API key (apiKeyId), a step of one of the project's workflows
 * (workflowId, and what it ran as, #9766), or OneUptime itself ("System",
 * when the project stores system events). Every actor is one of its own:
 * deletes are summed per kind and id, never across them, and each event
 * names its actor - a person by their email, a key by its name, "The
 * workflow "Nightly Cleanup"" with what it ran as and whose permissions
 * those were, "OneUptime" - with a principal a rule can group on
 * (Types/SecurityEvent/OneUptimeActorPrincipal: "workflow:<id>",
 * "oneuptime"). An entry that names no actor at all says "Someone" rather
 * than guess.
 *
 * WHO READS THE RECORD'S NAME (#10663). An event is written once, for
 * every reader of security events - Project Owner and Admin, the Security
 * tiers and Read Security Event - and the records it is about are read by
 * others: an API key's name by Project Owner, Project Admin and Read API
 * Key, not by Security Viewer. So an event names its record only when every
 * permission that reads security events also reads the record's table
 * (isAuditRecordNameReadByEveryEventReader, with the readers the scan
 * finds in the models: Server/Utils/SecurityEvent/TelemetryScan/
 * AuditRecordNameReaders). Otherwise it keeps the record's type, its id
 * and who changed it, and says the change without the name - "alice@
 * example.com created an API key" - in its message, its target and its
 * attributes alike.
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

/*
 * The actor type of OneUptime's own entries: a change made with root
 * privileges and no actor (ee/Server/AuditLog/AuditLogRecorder.resolveActor)
 * - a job, a SCIM sync, what a delete takes with it.
 */
export const AUDIT_SYSTEM_ACTOR_TYPE: string = "System";

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
  workflowId: string;
  workflowName: string;
  workflowRunAs: string;
  workflowRunAsRole: string;
  workflowRunAsGivenBy: string;
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
  workflowId: "audit.workflow_id",
  workflowName: "audit.workflow_name",
  workflowRunAs: "audit.workflow_run_as",
  workflowRunAsRole: "audit.workflow_run_as_role",
  workflowRunAsGivenBy: "audit.workflow_run_as_given_by",
  deletes: "audit.deletes",
  sampleResourceTypes: "audit.sample_resource_types",
};

/*
 * Who made a change, as an entry records it: its kind (userType) and the
 * ids and names of that kind. A workflow's entry also says what it ran as
 * (#9766): Default, ProjectOwner or CustomRole, the role's name, and the
 * person or API key whose permissions those were.
 */
export interface AuditActor {
  userId: string;
  userName: string;
  userEmail: string;
  userType: string;
  apiKeyId: string;
  apiKeyName: string;
  mcpClientName: string;
  workflowId: string;
  workflowName: string;
  workflowRunAs: string;
  workflowRunAsCustomRoleName: string;
  workflowRunAsGiverName: string;
  // Set when an API key, not a person, gave the workflow its permissions.
  workflowRunAsGiverApiKeyId: string;
}

// One audit record as the scan reads it.
export interface AuditScanRecord extends AuditActor {
  id: string;
  createdAt: Date;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  action: string;
}

/*
 * One actor's deletes in a window, as the database summed them: one row per
 * kind and id (userType, userId, apiKeyId, workflowId), with its names as
 * the latest of its entries in the window say them.
 */
export interface MassDeleteRow extends AuditActor {
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
 * Who reads what an audit record's event says of its record (#10663): the
 * permissions that read security events (SecurityEvent's read list), and
 * those that read the records of a type's table - none for a type no model
 * has. The scan finds both in the models (AuditRecordNameReaders).
 */
export interface AuditRecordNameReaders {
  eventReaders: ReadonlyArray<Permission>;
  getRecordReaders: (resourceType: string) => ReadonlyArray<Permission>;
}

/*
 * Whether an event may name its record: every permission that reads
 * security events reads the record's table, so nobody reads the name in
 * the event who could not read it on the record. Without the readers, or
 * for a type nobody reads on a record, it may not.
 */
export function isAuditRecordNameReadByEveryEventReader(data: {
  resourceType: string;
  readers?: AuditRecordNameReaders | undefined;
}): boolean {
  if (!data.readers || data.readers.eventReaders.length === 0) {
    return false;
  }

  const recordReaders: ReadonlyArray<Permission> =
    data.readers.getRecordReaders(data.resourceType);

  return data.readers.eventReaders.every((permission: Permission): boolean => {
    return recordReaders.includes(permission);
  });
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

function textOf(value: string | null | undefined): string {
  return (value || "").trim();
}

// Whether a workflow's step made the change: by its kind, or the workflow it names.
export function isWorkflowAuditActor(actor: Partial<AuditActor>): boolean {
  return (
    textOf(actor.userType) === UserType.Workflow ||
    textOf(actor.workflowId) !== "" ||
    textOf(actor.workflowName) !== ""
  );
}

/*
 * Whether OneUptime itself made the change - a "System" entry naming no
 * person, key or workflow - rather than someone it acted for. An entry of
 * any other kind, or one that names a person, is theirs.
 */
export function isOneUptimeAuditActor(actor: Partial<AuditActor>): boolean {
  return (
    textOf(actor.userType) === AUDIT_SYSTEM_ACTOR_TYPE &&
    !textOf(actor.userId) &&
    !textOf(actor.userEmail) &&
    !textOf(actor.userName) &&
    !textOf(actor.apiKeyId) &&
    !textOf(actor.apiKeyName) &&
    !isWorkflowAuditActor(actor)
  );
}

/*
 * What a workflow ran as and with whose permissions, as a clause set off
 * after its name: ", running as Project Owner with the permissions Jane Doe
 * gave it,". Nothing for the default permissions, or for a Run As this
 * version cannot read - it says nothing rather than guess.
 */
function describeWorkflowRanAs(actor: Partial<AuditActor>): string {
  const runAs: WorkflowRunAs | null = readWorkflowRunAs(
    textOf(actor.workflowRunAs),
  );

  if (!runAs || runAs === WorkflowRunAs.Default) {
    return "";
  }

  const roleName: string = textOf(actor.workflowRunAsCustomRoleName);
  const ranAs: string = describeWorkflowRunAs({
    runAs,
    customRoleName: roleName ? cutTelemetryText(roleName, 120) : undefined,
  });
  const giver: string = textOf(actor.workflowRunAsGiverName);

  if (!giver) {
    return `, running as ${ranAs},`;
  }

  return `, running as ${ranAs} with the permissions ${describeWorkflowRunAsGiver(
    {
      name: cutTelemetryText(giver, 120),
      isApiKey: textOf(actor.workflowRunAsGiverApiKeyId) !== "",
    },
  )} gave it,`;
}

/*
 * Who made a change, as the subject of a sentence names them: a person by
 * their email or name, "The API key "terraform"", "The workflow "Nightly
 * Cleanup"" - with what it ran as, when that was more than the default
 * permissions - "The MCP client "Cursor"", "OneUptime" for OneUptime's own
 * change, and "Someone" when the entry names no actor: never a guess.
 */
export function describeAuditActor(actor: Partial<AuditActor>): string {
  if (textOf(actor.userEmail)) {
    return textOf(actor.userEmail);
  }

  if (textOf(actor.userName)) {
    return textOf(actor.userName);
  }

  if (textOf(actor.apiKeyName)) {
    return `The API key${quoted(textOf(actor.apiKeyName))}`;
  }

  if (isWorkflowAuditActor(actor)) {
    const name: string = textOf(actor.workflowName);

    return `${name ? `The workflow${quoted(name)}` : "A workflow"}${describeWorkflowRanAs(actor)}`;
  }

  if (textOf(actor.mcpClientName)) {
    return `The MCP client${quoted(textOf(actor.mcpClientName))}`;
  }

  if (textOf(actor.userType) === UserType.API) {
    return "An API key";
  }

  if (isOneUptimeAuditActor(actor)) {
    return "OneUptime";
  }

  return "Someone";
}

/*
 * Who made a change, as an event's principal user: the person's email or
 * name, the API key's name, "workflow:" and the workflow's id, or
 * "oneuptime" (OneUptimeActorPrincipal) - one for each actor, so a rule
 * that groups by principal never sums two of them. "" when the entry names
 * no actor, or a workflow but not which.
 */
export function getAuditActorPrincipal(actor: Partial<AuditActor>): string {
  const workflow: string = getWorkflowPrincipal(actor.workflowId);

  if (workflow) {
    return workflow;
  }

  if (isWorkflowAuditActor(actor)) {
    return "";
  }

  const named: string =
    textOf(actor.userEmail) ||
    textOf(actor.userName) ||
    textOf(actor.apiKeyName);

  if (named) {
    return named;
  }

  return isOneUptimeAuditActor(actor) ? ONEUPTIME_PRINCIPAL : "";
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

/*
 * A record of a type, as a sentence names it: "the API key "terraform""
 * when the record's name is given, "an API key" when it is not - a name
 * withheld from the event's readers (#10663) or a record with none.
 */
function namedRecord(data: { name: string; the: string; a: string }): string {
  const name: string = quoted(data.name);

  return name ? `${data.the}${name}` : data.a;
}

/*
 * One audit record, said as a person would say it. The record's name is
 * said as the record gives it: the event blanks a name its readers may not
 * read before it is said (buildAuditRecordEvent), and the sentence reads
 * as naturally without it.
 */
export function describeAuditChange(record: AuditScanRecord): string {
  const actor: string = describeAuditActor(record);
  const name: string = record.resourceName;
  const verb: string = verbOf(record.action);

  switch (record.resourceType) {
    case AuditResourceType.ApiKey:
      return `${actor} ${verb} ${namedRecord({
        name,
        the: "the API key",
        a: "an API key",
      })}`;
    case AuditResourceType.CustomRole:
      return `${actor} ${verb} ${namedRecord({
        name,
        the: "the custom role",
        a: "a custom role",
      })}`;
    case AuditResourceType.ApiKeyCustomRole:
      return record.action === AuditLogAction.Delete
        ? `${actor} took a custom role away from an API key${quoted(name)}`
        : `${actor} gave an API key a custom role${quoted(name)}`;
    case AuditResourceType.TeamCustomRole:
      return record.action === AuditLogAction.Delete
        ? `${actor} took a custom role away from a team${quoted(name)}`
        : `${actor} gave a team a custom role${quoted(name)}`;
    case AuditResourceType.Team:
      return `${actor} ${verb} ${namedRecord({
        name,
        the: "the team",
        a: "a team",
      })}`;
    case AuditResourceType.McpClientAuthorization:
      // The client the change was made through is the actor's, and kept.
      return `${actor} authorized ${namedRecord({
        name: record.mcpClientName || name,
        the: "the MCP client",
        a: "an MCP client",
      })}`;
    case AuditResourceType.PacketCapture:
      return `${actor} downloaded ${namedRecord({
        name,
        the: "the packet capture",
        a: "a packet capture",
      })}`;
    case AuditResourceType.ProtectedEntity:
      return `${actor} ${verb} ${namedRecord({
        name,
        the: "the protected entity",
        a: "a protected entity",
      })}`;
    case AuditResourceType.AuditLogExport:
      return `${actor} ${verb} ${namedRecord({
        name,
        the: "the audit log export",
        a: "an audit log export",
      })}`;
    case AuditResourceType.SecurityPlaybook:
      return `${actor} ${verb} ${namedRecord({
        name,
        the: "the security playbook",
        a: "a security playbook",
      })}`;
    default:
      return `${actor} ${verb} ${record.resourceType}${quoted(name)}`;
  }
}

/*
 * The actor as attributes a search and a rule read: its kind and ids, and
 * for a workflow what it ran as and whose permissions those were.
 */
function actorAttributes(actor: Partial<AuditActor>): JSONObject {
  const attributes: JSONObject = {};
  const isWorkflow: boolean = isWorkflowAuditActor(actor);

  const values: Array<[string, string | undefined]> = [
    [AUDIT_ATTRIBUTES.actorType, actor.userType],
    [AUDIT_ATTRIBUTES.userId, actor.userId],
    [AUDIT_ATTRIBUTES.userEmail, actor.userEmail],
    [AUDIT_ATTRIBUTES.apiKeyName, actor.apiKeyName],
    [AUDIT_ATTRIBUTES.mcpClientName, actor.mcpClientName],
    [AUDIT_ATTRIBUTES.workflowId, actor.workflowId],
    [AUDIT_ATTRIBUTES.workflowName, actor.workflowName],
    [AUDIT_ATTRIBUTES.workflowRunAs, isWorkflow ? actor.workflowRunAs : ""],
    [
      AUDIT_ATTRIBUTES.workflowRunAsRole,
      isWorkflow ? actor.workflowRunAsCustomRoleName : "",
    ],
    [
      AUDIT_ATTRIBUTES.workflowRunAsGivenBy,
      isWorkflow ? actor.workflowRunAsGiverName : "",
    ],
  ];

  for (const [key, value] of values) {
    if (textOf(value)) {
      attributes[key] = textOf(value);
    }
  }

  return attributes;
}

/*
 * What an event says its record is: its type, and its name where the event
 * may name it (an API key's "API Key: terraform") or else its id ("API Key:
 * 0192..."), so the target always says which record it was.
 */
export function describeAuditTarget(
  record: Pick<AuditScanRecord, "resourceType" | "resourceId" | "resourceName">,
): string {
  return [
    record.resourceType,
    (record.resourceName || record.resourceId || "").trim(),
  ]
    .filter(Boolean)
    .join(": ");
}

/*
 * One audit record's event, or null when it is no security signal. It
 * names its record only where `readers` say every reader of security
 * events reads it (isAuditRecordNameReadByEveryEventReader): otherwise -
 * and with no readers given - the name is in none of its message, its
 * target and its attributes, and the type, the id and the actor still are.
 */
export function buildAuditRecordEvent(
  record: AuditScanRecord,
  readers?: AuditRecordNameReaders | undefined,
): NormalizedSecurityEvent | null {
  const reading: AuditSignalReading | null = classifyAuditRecord(record);

  if (!reading || !record.id) {
    return null;
  }

  // The record as its event's readers may read it.
  const said: AuditScanRecord = isAuditRecordNameReadByEveryEventReader({
    resourceType: record.resourceType,
    readers,
  })
    ? record
    : { ...record, resourceName: "" };

  const attributes: JSONObject = {
    ...actorAttributes(said),
    [AUDIT_ATTRIBUTES.recordId]: said.id,
    [AUDIT_ATTRIBUTES.resourceType]: said.resourceType,
    [AUDIT_ATTRIBUTES.action]: said.action,
  };

  if (said.resourceId) {
    attributes[AUDIT_ATTRIBUTES.resourceId] = said.resourceId;
  }

  if (said.resourceName) {
    attributes[AUDIT_ATTRIBUTES.resourceName] = said.resourceName;
  }

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.AuditLog,
    signal: reading.signal,
    time: said.createdAt,
    eventUid: `audit:${said.id}:${reading.signal}`,
    classUid: reading.classUid,
    activityName: reading.activityName,
    statusName: "Success",
    severity: reading.severity,
    message: describeAuditChange(said),
    principalUser: getAuditActorPrincipal(said),
    targetResource: describeAuditTarget(said),
    attributes,
  });
}

function minutesBetween(first: Date, last: Date): number {
  const minutes: number = Math.ceil((last.getTime() - first.getTime()) / 60000);

  return Number.isFinite(minutes) && minutes > 0 ? minutes : 1;
}

/*
 * The actor's part of a mass delete's id: a person's or a key's id, as it
 * always was, a workflow's principal or OneUptime's - the same actor in the
 * same window is one event, however often the window is read.
 */
function getMassDeleteActorKey(row: MassDeleteRow, actor: string): string {
  return (
    getWorkflowPrincipal(row.workflowId) ||
    (isOneUptimeAuditActor(row) ? ONEUPTIME_PRINCIPAL : "") ||
    textOf(row.userId) ||
    textOf(row.apiKeyId) ||
    actor
  );
}

/*
 * One actor's deletes in a window, once they reach the threshold: High, and
 * named - "The workflow "Nightly Cleanup" deleted 40 records in 3 minutes".
 * OneUptime's own bookkeeping is Informational under a signal of its own
 * (oneuptime-mass-delete), kept for the record and read by no rule that
 * watches people's deletes; its message says what such work is, since the
 * audit log does not say which it was.
 */
export function buildMassDeleteEvent(
  row: MassDeleteRow,
  windowStart: Date,
): NormalizedSecurityEvent | null {
  if (row.deletes < MASS_DELETE_MIN_DELETES) {
    return null;
  }

  const isOneUptime: boolean = isOneUptimeAuditActor(row);
  const signal: SecurityTelemetrySignal = isOneUptime
    ? SecurityTelemetrySignal.OneUptimeMassDelete
    : SecurityTelemetrySignal.MassDelete;
  const actor: string = describeAuditActor(row);
  const minutes: number = minutesBetween(row.firstAt, row.lastAt);
  const types: Array<string> = [...row.sampleResourceTypes]
    .filter(Boolean)
    .sort()
    .slice(0, 5);
  const deleted: string = `${actor} deleted ${row.deletes} records in ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }${types.length > 0 ? ` (${types.join(", ")})` : ""}`;

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.AuditLog,
    signal,
    time: row.firstAt,
    eventUid: `audit:${signal}:${getMassDeleteActorKey(
      row,
      actor,
    )}:${windowStart.toISOString()}`,
    classUid: API_ACTIVITY_CLASS_UID,
    activityName: "Delete",
    statusName: "Success",
    severity: isOneUptime ? OcsfSeverity.Informational : OcsfSeverity.High,
    message: isOneUptime
      ? `${deleted}: its own work, such as a scheduled cleanup, a SCIM sync or what another delete took with it`
      : deleted,
    principalUser: getAuditActorPrincipal(row),
    attributes: {
      ...actorAttributes(row),
      [AUDIT_ATTRIBUTES.deletes]: String(row.deletes),
      [AUDIT_ATTRIBUTES.sampleResourceTypes]: types.join(","),
    },
  });
}
