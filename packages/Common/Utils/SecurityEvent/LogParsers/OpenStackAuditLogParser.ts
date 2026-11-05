import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  isOpenStackKeystoneId,
  isOpenStackUuid,
} from "../../OpenStack/OpenStackLogs";
import {
  OPENSTACK_NOTIFICATION_LOGGER_PREFIX,
  readOpenStackNotificationTime,
} from "../../OpenStack/OpenStackNotifications";
import {
  MAX_JSON_LINE_LENGTH,
  MAX_RECORD_ATTRIBUTE_VALUE_LENGTH,
  SecurityLogLine,
  buildLogSecurityEvent,
  cutText,
  readAttribute,
  readIpAddress,
  readPort,
  readRemoteIpAddress,
} from "./SecurityLogLine";

/*
 * WHO DID WHAT IN AN OPENSTACK CLOUD, FROM ITS AUDIT TRAIL.
 *
 * Security teams need to know who changed what: role grants, failed logins and admin
 * actions. OpenStack can write all of it through oslo.messaging's log driver, with no
 * consumer on the bus, into the logs the agent already ships. This reads:
 *
 *   - Keystone's CADF notifications: identity.authenticate, identity.role_assignment.*,
 *     identity.<resource>.<operation>;
 *   - keystonemiddleware's audit filter on the other APIs: audit.http.response, for what
 *     changed something or was refused, never every read;
 *   - Neutron's security_group_rule.create.end, for a rule open to the world, one or several
 *     in a notification;
 *   - Glance's image.* for an image that is public, which says it in its own fields.
 *
 * WHAT A RECORDING SAID, AND A DOCUMENT DID NOT:
 *
 *   - The audit filter's target names the service at best, and on a cloud whose endpoints
 *     have no port of their own it says "unknown" for its id, name and type. What an API call
 *     touched is in its path, so that is where this reads it (readOpenStackPartOfPath).
 *   - Its initiator says "unknown" too, for a request with no user.
 *   - A role grant's target is a UUID made up for the occasion, so its project or domain is
 *     what this calls its target.
 *   - Neither kind of application credential says which it is: restricted and unrestricted
 *     read the same, down to the last field.
 *
 * CREDENTIALS. A CADF event can hold what should never be stored: its initiator's
 * credential holds a part of the token, an invalid password's attachment holds part of its
 * hash, and an API request's body can hold anything. The event keeps an allowlist of the
 * fields below and nothing else, so what a new release adds to an event stays out until
 * someone reads it and adds it here. Nothing is ever flattened whole, as the Kubernetes
 * audit parser does with a record whose fields rules are written against.
 *
 * Names come from OpenStackAuditJoin, which reads the inventory by the IDs these events hold.
 * These attribute keys are read by the rule library and stored on events: never rename one.
 */

export const OPENSTACK_AUDIT_VENDOR: string = "OpenStack";

export enum OpenStackAuditAttribute {
  EventType = "openstack.audit.event_type",
  Action = "openstack.audit.action",
  Outcome = "openstack.audit.outcome",
  InitiatorId = "openstack.audit.initiator_id",
  InitiatorName = "openstack.audit.initiator_name",
  InitiatorProjectId = "openstack.audit.initiator_project_id",
  InitiatorAddress = "openstack.audit.initiator_address",
  TargetType = "openstack.audit.target_type",
  TargetId = "openstack.audit.target_id",
  TargetName = "openstack.audit.target_name",
  ProjectId = "openstack.audit.project_id",
  // From the inventory, by the project's ID: see OpenStackAuditJoin.
  ProjectName = "openstack.audit.project_name",
  UserId = "openstack.audit.user_id",
  // From what the cloud's own events have said of this ID: see OpenStackAuditJoin.
  UserName = "openstack.audit.user_name",
  GroupId = "openstack.audit.group_id",
  DomainId = "openstack.audit.domain_id",
  RoleId = "openstack.audit.role_id",
  ReasonCode = "openstack.audit.reason_code",
  Reason = "openstack.audit.reason",
  RequestPath = "openstack.audit.request_path",
  RequestId = "openstack.audit.request_id",
  Cloud = "openstack.audit.cloud",
  Signal = "openstack.audit.signal",
  OpenPort = "openstack.audit.open_port",
  /*
   * The part of the cloud an event touched: an OpenStackResourceKind, its id, and its name
   * from the inventory. Who Changed This reads a part's events by this id.
   */
  PartKind = "openstack.audit.part_kind",
  PartId = "openstack.audit.part_id",
  PartName = "openstack.audit.part_name",
}

// What a detection in the rule library reads an event by.
export enum OpenStackAuditSignal {
  SecurityGroupOpenSensitive = "security-group-open-sensitive",
  SecurityGroupOpen = "security-group-open",
  ImagePublic = "image-public",
}

const AUTHENTICATION_CLASS_UID: number = 3002;
const ACCOUNT_CHANGE_CLASS_UID: number = 3001;
const USER_ACCESS_CLASS_UID: number = 3005;
const API_ACTIVITY_CLASS_UID: number = 6003;

const CADF_EVENT_TYPE_URI: string = "/cloud/audit/";

// The most rules of one notification that become events.
const MAX_RULES_PER_NOTIFICATION: number = 200;

// What pyCADF says of whatever it could not find out: an id, a name, a type.
const CADF_UNKNOWN: string = "unknown";

/*
 * The ports that are an open door when the whole internet can reach them: remote shells and
 * desktops, and the databases, caches and control planes that were never meant to face it.
 */
export const OPENSTACK_SENSITIVE_PORTS: ReadonlyArray<number> = [
  22, 23, 135, 139, 445, 1433, 1521, 2375, 2376, 2379, 3306, 3389, 4369, 5432,
  5672, 5900, 5985, 5986, 6379, 6443, 9200, 11211, 15672, 27017,
];

// Identity's resources a change to is worth a security team's attention.
const HIGH_VALUE_IDENTITY_RESOURCES: ReadonlySet<string> = new Set([
  "application_credential",
  "credential",
  "trust",
  "role",
  "policy",
  "access_token",
  "request_token",
  "consumer",
]);

/*
 * What a word in an API's path says the UUID after it is: a word each service uses for its
 * own records, whatever prefix the cloud serves them under. A kind is what the inventory
 * calls it, for the parts it holds.
 */
export interface OpenStackPathPart {
  noun: string;
  kind?: OpenStackResourceKind | undefined;
}

const PARTS_BY_PATH_WORD: ReadonlyMap<string, OpenStackPathPart> = new Map<
  string,
  OpenStackPathPart
>([
  ["servers", { noun: "instance", kind: OpenStackResourceKind.Instance }],
  ["volumes", { noun: "volume", kind: OpenStackResourceKind.Volume }],
  ["snapshots", { noun: "snapshot", kind: OpenStackResourceKind.Snapshot }],
  ["backups", { noun: "backup", kind: OpenStackResourceKind.Backup }],
  ["images", { noun: "image", kind: OpenStackResourceKind.Image }],
  ["networks", { noun: "network", kind: OpenStackResourceKind.Network }],
  ["subnets", { noun: "subnet", kind: OpenStackResourceKind.Subnet }],
  ["routers", { noun: "router", kind: OpenStackResourceKind.Router }],
  [
    "floatingips",
    { noun: "floating IP", kind: OpenStackResourceKind.FloatingIp },
  ],
  ["ports", { noun: "port" }],
  ["security-groups", { noun: "security group" }],
  ["security-group-rules", { noun: "security group rule" }],
  ["attachments", { noun: "volume attachment" }],
  ["os-services", { noun: "compute service" }],
]);

// The words the inventory's parts go by, from their kinds: what OpenStackAuditJoin renames.
const NOUNS_BY_KIND: ReadonlyMap<string, string> = new Map<string, string>(
  Array.from(PARTS_BY_PATH_WORD.values())
    .filter((part: OpenStackPathPart): boolean => {
      return Boolean(part.kind);
    })
    .map((part: OpenStackPathPart): [string, string] => {
      return [part.kind as string, part.noun];
    }),
);

/*
 * What the services tell one another, on nobody's behalf: Neutron and Cinder telling Nova a
 * port or a volume is ready. A third of a recorded cloud's writes, and never anyone's doing.
 */
const INTERNAL_PATH_ENDINGS: ReadonlyArray<string> = [
  "/os-server-external-events",
];

// The protocols whose rule's two numbers are ports, by name and by number.
const PROTOCOLS_WITH_PORTS: ReadonlySet<string> = new Set([
  "tcp",
  "udp",
  "dccp",
  "sctp",
  "udplite",
  "6",
  "17",
  "33",
  "132",
  "136",
]);

/*
 * The words that decide which log lines are asked for: see SECURITY_LOG_PREFILTER, which
 * holds these to every line that makes an event. Written both ways, because oslo.messaging
 * writes `"key": "value"` and OneUptime stores what it keeps as `"key":"value"`.
 */
export const OPENSTACK_AUDIT_PREFILTER_REQUIRES: string = '"event_type"';
export const OPENSTACK_AUDIT_PREFILTER_WORDS: ReadonlyArray<string> = [
  '"event_type":"identity.',
  '"event_type": "identity.',
  '"event_type":"audit.http.response',
  '"event_type": "audit.http.response',
  '"event_type":"security_group_rule.create.end',
  '"event_type": "security_group_rule.create.end',
  '"visibility":"public"',
  '"visibility": "public"',
];

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readText(source: JSONObject | null, ...keys: Array<string>): string {
  if (!source) {
    return "";
  }

  for (const key of keys) {
    const value: unknown = source[key];

    if (typeof value === "string" && value.trim()) {
      return cutText(value.trim(), MAX_RECORD_ATTRIBUTE_VALUE_LENGTH);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

/*
 * The notification in a stored line: its prefix if it has one, then the JSON. A stored
 * line's fields have already had what must never be stored taken out at ingest
 * (OpenStackLogs), and this reads a named few of them either way.
 */
export function readOpenStackAuditNotification(
  body: string,
): JSONObject | null {
  if (
    !body ||
    body.length > MAX_JSON_LINE_LENGTH ||
    body.indexOf(OPENSTACK_AUDIT_PREFILTER_REQUIRES) === -1
  ) {
    return null;
  }

  const start: number = body.indexOf("{");
  const end: number = body.lastIndexOf("}");

  if (start === -1 || end <= start) {
    return null;
  }

  try {
    return asObject(JSON.parse(body.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function withoutQueryString(path: string): string {
  const mark: number = path.indexOf("?");

  return mark === -1 ? path : path.slice(0, mark);
}

function set(attributes: JSONObject, key: string, value: string): void {
  if (value) {
    attributes[key] = value;
  }
}

// A field, unless it is pyCADF saying it does not know.
function readKnown(source: JSONObject | null, ...keys: Array<string>): string {
  const value: string = readText(source, ...keys);

  return value.toLowerCase() === CADF_UNKNOWN ? "" : value;
}

/*
 * The part of the cloud a path names: the first UUID after a word that says what it is, so
 * /servers/<instance>/os-volume_attachments/<volume> is about its instance. A project's id in
 * a path has no dashes, and a name is no part: only a read looks one up by name.
 */
export function readOpenStackPartOfPath(
  path: string,
): (OpenStackPathPart & { id: string }) | null {
  const words: Array<string> = path.split("/");

  for (let index: number = 1; index < words.length; index++) {
    const part: OpenStackPathPart | undefined = PARTS_BY_PATH_WORD.get(
      words[index - 1] as string,
    );

    if (part && isOpenStackUuid(words[index] as string)) {
      return { ...part, id: words[index] as string };
    }
  }

  return null;
}

// How an event names a part, in its message and for a case: "instance web-1".
export function describeOpenStackPart(
  kind: OpenStackResourceKind | string,
  idOrName: string,
): string {
  return `${NOUNS_BY_KIND.get(kind) || kind} ${idOrName}`;
}

// How a case names a user it has only an ID for: a bare ID would read as a file's hash.
export function describeOpenStackUser(id: string): string {
  return `user ${id}`;
}

/*
 * What a case reads an event's entities from, beside its typed columns: the project and the
 * part it touched, whole, so a case names them. A user known only by ID is said to be one.
 */
function namesOf(
  event: NormalizedSecurityEvent,
  more: Array<string>,
): NormalizedSecurityEvent {
  const names: Array<string> = event.observables.map(
    (value: string): string => {
      return (value === event.principalUser || value === event.targetUser) &&
        isOpenStackKeystoneId(value)
        ? describeOpenStackUser(value)
        : value;
    },
  );

  for (const value of more) {
    if (value && !names.includes(value)) {
      names.push(value);
    }
  }

  event.observables = names;

  return event;
}

interface Initiator {
  id: string;
  name: string;
  projectId: string;
  address: string;
}

function readInitiator(payload: JSONObject): Initiator {
  const initiator: JSONObject | null = asObject(payload["initiator"]);
  const host: JSONObject | null = asObject(initiator?.["host"]);

  return {
    /*
     * identity.authenticate's `id` is a hash of the user, and its user_id the user. Any
     * other event's `id` is the user's own.
     */
    id: readKnown(initiator, "user_id", "id"),
    name: readKnown(initiator, "username", "name"),
    projectId: readKnown(initiator, "project_id"),
    address: readIpAddress(readText(host, "address")),
  };
}

function baseAttributes(data: {
  line: SecurityLogLine;
  eventType: string;
  initiator: Initiator;
  action: string;
  outcome: string;
  payload: JSONObject;
}): JSONObject {
  const attributes: JSONObject = {};
  const target: JSONObject | null = asObject(data.payload["target"]);
  const reason: JSONObject | null = asObject(data.payload["reason"]);

  set(attributes, OpenStackAuditAttribute.EventType, data.eventType);
  set(attributes, OpenStackAuditAttribute.Action, data.action);
  set(attributes, OpenStackAuditAttribute.Outcome, data.outcome);
  set(attributes, OpenStackAuditAttribute.InitiatorId, data.initiator.id);
  set(attributes, OpenStackAuditAttribute.InitiatorName, data.initiator.name);
  set(
    attributes,
    OpenStackAuditAttribute.InitiatorProjectId,
    data.initiator.projectId,
  );
  set(
    attributes,
    OpenStackAuditAttribute.InitiatorAddress,
    data.initiator.address,
  );
  set(
    attributes,
    OpenStackAuditAttribute.TargetType,
    readKnown(target, "typeURI"),
  );
  set(attributes, OpenStackAuditAttribute.TargetId, readKnown(target, "id"));
  set(
    attributes,
    OpenStackAuditAttribute.TargetName,
    readKnown(target, "name"),
  );
  set(
    attributes,
    OpenStackAuditAttribute.ReasonCode,
    readText(reason, "reasonCode"),
  );
  set(
    attributes,
    OpenStackAuditAttribute.Reason,
    readText(reason, "reasonType"),
  );
  set(
    attributes,
    OpenStackAuditAttribute.RequestId,
    readAttribute(data.line.attributes, ["openstack.request_id"]) ||
      readText(asObject(data.payload["initiator"]), "request_id"),
  );
  set(attributes, OpenStackAuditAttribute.Cloud, readCloud(data.line));

  return attributes;
}

function readCloud(line: SecurityLogLine): string {
  return readAttribute(line.attributes, [
    "resource.openstack.cloud.name",
    "openstack.cloud.name",
  ]);
}

function statusOf(outcome: string): string {
  return outcome.toLowerCase() === "success" ? "Success" : "Failure";
}

/*
 * The project an event is about, as what names it. A case reads its entities from the
 * event's typed columns, so this is how a case comes to name the project.
 */
export function describeOpenStackProject(project: string): string {
  return `project ${project}`;
}

function parseAuthentication(data: {
  line: SecurityLogLine;
  eventType: string;
  payload: JSONObject;
  uid: string;
  time: Date | undefined;
}): NormalizedSecurityEvent | null {
  const outcome: string = readText(data.payload, "outcome").toLowerCase();

  // Written again once it is decided.
  if (outcome === "pending" || !outcome) {
    return null;
  }

  const initiator: Initiator = readInitiator(data.payload);
  const who: string = initiator.name || initiator.id || "Someone";
  const isSuccess: boolean = outcome === "success";
  const attributes: JSONObject = baseAttributes({
    line: data.line,
    eventType: data.eventType,
    initiator,
    action: readText(data.payload, "action") || "authenticate",
    outcome,
    payload: data.payload,
  });

  return namesOf(
    buildLogSecurityEvent({
      line: data.line,
      format: SecurityLogFormat.OpenStackAudit,
      classUid: AUTHENTICATION_CLASS_UID,
      activityName: "Logon",
      statusName: statusOf(outcome),
      severity: isSuccess ? OcsfSeverity.Informational : OcsfSeverity.Low,
      message: isSuccess
        ? `${who} signed in to OpenStack`
        : `${who} failed to sign in to OpenStack`,
      time: data.time,
      principalUser: initiator.name || initiator.id,
      principalIp: readRemoteIpAddress(initiator.address),
      targetHost: readCloud(data.line),
      targetResource: "Keystone",
      attributes,
      eventUid: data.uid,
    }),
    [],
  );
}

function parseRoleAssignment(data: {
  line: SecurityLogLine;
  eventType: string;
  payload: JSONObject;
  uid: string;
  time: Date | undefined;
}): NormalizedSecurityEvent | null {
  const initiator: Initiator = readInitiator(data.payload);
  const who: string = initiator.name || initiator.id || "Someone";
  const outcome: string = readText(data.payload, "outcome").toLowerCase();
  const action: string = readText(data.payload, "action");
  const role: string = readText(data.payload, "role");
  const project: string = readText(data.payload, "project");
  const domain: string = readText(data.payload, "domain");
  const user: string = readText(data.payload, "user");
  const group: string = readText(data.payload, "group");
  const isGrant: boolean = data.eventType.endsWith(".created");
  const attributes: JSONObject = baseAttributes({
    line: data.line,
    eventType: data.eventType,
    initiator,
    action,
    outcome,
    payload: data.payload,
  });

  set(attributes, OpenStackAuditAttribute.RoleId, role);
  set(attributes, OpenStackAuditAttribute.ProjectId, project);
  set(attributes, OpenStackAuditAttribute.DomainId, domain);
  set(attributes, OpenStackAuditAttribute.UserId, user);
  set(attributes, OpenStackAuditAttribute.GroupId, group);

  // The event's own target is a UUID made up for the occasion.
  delete attributes[OpenStackAuditAttribute.TargetId];
  delete attributes[OpenStackAuditAttribute.TargetType];
  set(attributes, OpenStackAuditAttribute.TargetId, project || domain);
  set(
    attributes,
    OpenStackAuditAttribute.TargetType,
    project ? "project" : domain ? "domain" : "system",
  );

  if (project) {
    attributes[OpenStackAuditAttribute.PartKind] =
      OpenStackResourceKind.Project;
    attributes[OpenStackAuditAttribute.PartId] = project;
  }

  const where: string = project
    ? describeOpenStackProject(project)
    : domain
      ? `domain ${domain}`
      : "the system";
  const whom: string = user || (group ? `group ${group}` : "someone");
  const inherited: string =
    data.payload["inherited_to_projects"] === true
      ? ", and every project under it"
      : "";

  return namesOf(
    buildLogSecurityEvent({
      line: data.line,
      format: SecurityLogFormat.OpenStackAudit,
      classUid: USER_ACCESS_CLASS_UID,
      activityName: isGrant ? "Assign Privileges" : "Revoke Privileges",
      statusName: statusOf(outcome),
      severity: OcsfSeverity.Medium,
      message: isGrant
        ? `${who} granted role ${role} to ${whom} on ${where}${inherited}`
        : `${who} took role ${role} from ${whom} on ${where}${inherited}`,
      time: data.time,
      principalUser: initiator.name || initiator.id,
      principalIp: readRemoteIpAddress(initiator.address),
      targetUser: user,
      targetHost: readCloud(data.line),
      targetResource: where,
      attributes,
      eventUid: data.uid,
    }),
    [project ? describeOpenStackProject(project) : ""],
  );
}

function parseIdentityChange(data: {
  line: SecurityLogLine;
  eventType: string;
  payload: JSONObject;
  uid: string;
  time: Date | undefined;
}): NormalizedSecurityEvent | null {
  const words: Array<string> = data.eventType.split(".");
  const named: string = words[1] || "";
  // OS-TRUST:trust and OS-OAUTH1:consumer, as Keystone's extensions name their records.
  const resource: string = named.slice(named.indexOf(":") + 1);
  const operation: string = words[2] || "";

  if (!resource || !operation) {
    return null;
  }

  const initiator: Initiator = readInitiator(data.payload);
  const who: string = initiator.name || initiator.id || "Someone";
  const outcome: string = readText(data.payload, "outcome").toLowerCase();
  const id: string =
    readText(data.payload, "resource_info") ||
    readText(asObject(data.payload["target"]), "id");
  const attributes: JSONObject = baseAttributes({
    line: data.line,
    eventType: data.eventType,
    initiator,
    action: readText(data.payload, "action") || `${operation}.${resource}`,
    outcome: outcome || "success",
    payload: data.payload,
  });

  const noun: string = resource.split("_").join(" ");
  let targetResource: string = id ? `${noun} ${id}` : noun;
  let project: string = "";

  if (resource === "project" && id) {
    project = describeOpenStackProject(id);
    set(attributes, OpenStackAuditAttribute.ProjectId, id);
    attributes[OpenStackAuditAttribute.PartKind] =
      OpenStackResourceKind.Project;
    attributes[OpenStackAuditAttribute.PartId] = id;
    targetResource = project;
  }

  if (resource === "user" && id) {
    set(attributes, OpenStackAuditAttribute.UserId, id);
  }

  return namesOf(
    buildLogSecurityEvent({
      line: data.line,
      format: SecurityLogFormat.OpenStackAudit,
      classUid:
        resource === "user" ? ACCOUNT_CHANGE_CLASS_UID : API_ACTIVITY_CLASS_UID,
      activityName: operation,
      statusName: outcome ? statusOf(outcome) : "Success",
      severity: HIGH_VALUE_IDENTITY_RESOURCES.has(resource)
        ? OcsfSeverity.Medium
        : OcsfSeverity.Low,
      message: `${who} ${operation} ${noun}${id ? ` ${id}` : ""}`,
      time: data.time,
      principalUser: initiator.name || initiator.id,
      principalIp: readRemoteIpAddress(initiator.address),
      targetUser: resource === "user" ? id : "",
      targetHost: readCloud(data.line),
      targetResource,
      attributes,
      eventUid: data.uid,
    }),
    [project],
  );
}

/*
 * A call to an API, as the audit filter saw it. An audit log is mostly reads, and a read
 * is no event unless it was refused, which is what someone probing a cloud looks like.
 */
function parseApiCall(data: {
  line: SecurityLogLine;
  eventType: string;
  payload: JSONObject;
  uid: string;
  time: Date | undefined;
}): NormalizedSecurityEvent | null {
  const action: string = readText(data.payload, "action");
  const outcome: string = readText(data.payload, "outcome").toLowerCase();
  const reason: JSONObject | null = asObject(data.payload["reason"]);
  const code: string = readText(reason, "reasonCode");
  const isRefused: boolean = code === "401" || code === "403";
  const isRead: boolean = action === "read" || action.startsWith("read/");

  if ((isRead && !isRefused) || outcome === "pending" || !outcome) {
    return null;
  }

  const path: string = withoutQueryString(
    readText(data.payload, "requestPath"),
  );

  if (
    INTERNAL_PATH_ENDINGS.some((ending: string): boolean => {
      return path.endsWith(ending);
    })
  ) {
    return null;
  }

  const initiator: Initiator = readInitiator(data.payload);
  const who: string = initiator.name || initiator.id || "Someone";
  const part: (OpenStackPathPart & { id: string }) | null =
    readOpenStackPartOfPath(path);
  const attributes: JSONObject = baseAttributes({
    line: data.line,
    eventType: data.eventType,
    initiator,
    action,
    outcome,
    payload: data.payload,
  });

  set(attributes, OpenStackAuditAttribute.RequestPath, path);
  set(attributes, OpenStackAuditAttribute.ProjectId, initiator.projectId);

  if (part) {
    set(attributes, OpenStackAuditAttribute.PartKind, part.kind || "");
    attributes[OpenStackAuditAttribute.PartId] = part.id;
  }

  const what: string = part
    ? `${part.noun} ${part.id}`
    : readKnown(asObject(data.payload["target"]), "typeURI") || path;
  const project: string = initiator.projectId
    ? describeOpenStackProject(initiator.projectId)
    : "";

  return namesOf(
    buildLogSecurityEvent({
      line: data.line,
      format: SecurityLogFormat.OpenStackAudit,
      classUid: API_ACTIVITY_CLASS_UID,
      activityName: action,
      statusName: statusOf(outcome),
      severity: isRefused ? OcsfSeverity.Medium : OcsfSeverity.Informational,
      message: isRefused
        ? `${who} was refused ${action} on ${what} (${code})`
        : `${who} ${action} on ${what}`,
      time: data.time,
      principalUser: initiator.name || initiator.id,
      principalIp: readRemoteIpAddress(initiator.address),
      targetHost: readCloud(data.line),
      targetResource: project ? `${project} ${what}` : what,
      attributes,
      eventUid: data.uid,
    }),
    [project, part ? what : ""],
  );
}

// Whether a rule lets a port in: none named means every port.
export function isOpenStackPortInRule(data: {
  port: number;
  min: number | null;
  max: number | null;
}): boolean {
  if (data.min === null && data.max === null) {
    return true;
  }

  const min: number = data.min === null ? data.port : data.min;
  const max: number = data.max === null ? data.port : data.max;

  return data.port >= min && data.port <= max;
}

function readRuleNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const port: number = readPort(value);

    return port > 0 ? port : null;
  }

  return null;
}

/*
 * A rule that lets the world in: inbound, from everywhere, with no other group as its
 * source. Neutron writes "from everywhere" as 0.0.0.0/0, ::/0, or nothing at all.
 */
export function isOpenStackRuleOpenToWorld(rule: JSONObject): boolean {
  const direction: string = readText(rule, "direction").toLowerCase();
  const prefix: string = readText(rule, "remote_ip_prefix");
  const group: string = readText(rule, "remote_group_id");
  const addressGroup: string = readText(rule, "remote_address_group_id");

  return (
    direction === "ingress" &&
    !group &&
    !addressGroup &&
    (!prefix || prefix === "0.0.0.0/0" || prefix === "::/0")
  );
}

function parseSecurityGroupRule(data: {
  line: SecurityLogLine;
  eventType: string;
  rule: JSONObject;
  uid: string;
  time: Date | undefined;
  recordIndex: number | undefined;
}): NormalizedSecurityEvent | null {
  const { rule } = data;

  if (!isOpenStackRuleOpenToWorld(rule)) {
    return null;
  }

  const min: number | null = readRuleNumber(rule["port_range_min"]);
  const max: number | null = readRuleNumber(rule["port_range_max"]);
  const protocol: string = readText(rule, "protocol").toLowerCase();
  // ICMP's numbers in these two are its type and code, and hold no port.
  const hasPorts: boolean = !protocol || PROTOCOLS_WITH_PORTS.has(protocol);
  const openPort: number | undefined = hasPorts
    ? OPENSTACK_SENSITIVE_PORTS.find((port: number): boolean => {
        return isOpenStackPortInRule({ port, min, max });
      })
    : undefined;
  const groupId: string = readText(rule, "security_group_id");
  const project: string = readText(rule, "project_id", "tenant_id");
  const who: string =
    readAttribute(data.line.attributes, [
      "openstack.user_name",
      "openstack.user_id",
    ]) || "Someone";
  const prefix: string = readText(rule, "remote_ip_prefix") || "anywhere";
  const reach: string = !hasPorts
    ? `for ${protocol}`
    : min === null && max === null
      ? "on every port"
      : min === max || max === null || min === null
        ? `on port ${min ?? max}`
        : `on ports ${min} to ${max}`;
  const projectName: string = project ? describeOpenStackProject(project) : "";
  const attributes: JSONObject = {};

  set(attributes, OpenStackAuditAttribute.EventType, data.eventType);
  set(attributes, OpenStackAuditAttribute.Action, "create.security_group_rule");
  set(attributes, OpenStackAuditAttribute.Outcome, "success");
  set(attributes, OpenStackAuditAttribute.ProjectId, project);
  set(attributes, OpenStackAuditAttribute.TargetType, "security_group");
  set(attributes, OpenStackAuditAttribute.TargetId, groupId);
  set(attributes, OpenStackAuditAttribute.Cloud, readCloud(data.line));
  set(
    attributes,
    OpenStackAuditAttribute.InitiatorId,
    readAttribute(data.line.attributes, ["openstack.user_id"]),
  );
  set(
    attributes,
    OpenStackAuditAttribute.InitiatorName,
    readAttribute(data.line.attributes, ["openstack.user_name"]),
  );
  set(
    attributes,
    OpenStackAuditAttribute.RequestId,
    readAttribute(data.line.attributes, ["openstack.request_id"]),
  );
  attributes[OpenStackAuditAttribute.Signal] =
    openPort !== undefined
      ? OpenStackAuditSignal.SecurityGroupOpenSensitive
      : OpenStackAuditSignal.SecurityGroupOpen;

  if (openPort !== undefined) {
    attributes[OpenStackAuditAttribute.OpenPort] = String(openPort);
  }

  return namesOf(
    buildLogSecurityEvent({
      line: data.line,
      format: SecurityLogFormat.OpenStackAudit,
      classUid: API_ACTIVITY_CLASS_UID,
      activityName: "create",
      statusName: "Success",
      severity:
        openPort !== undefined ? OcsfSeverity.High : OcsfSeverity.Informational,
      message: `${who} opened security group ${groupId} to ${prefix} ${reach}${
        projectName ? ` in ${projectName}` : ""
      }`,
      time: data.time,
      principalUser: who === "Someone" ? "" : who,
      targetHost: readCloud(data.line),
      targetPort: openPort,
      targetResource: projectName
        ? `${projectName} security group ${groupId}`
        : `security group ${groupId}`,
      attributes,
      eventUid: data.uid
        ? data.recordIndex !== undefined
          ? `${data.uid}:${data.recordIndex}`
          : data.uid
        : "",
      recordIndex: data.recordIndex,
    }),
    [projectName],
  );
}

/*
 * A notification holds one rule, or every rule of a call that made several: Neutron's API
 * sends a list as a list, under the plural. Each is an event of its own, because each is a
 * door of its own.
 */
function parseSecurityGroupRules(data: {
  line: SecurityLogLine;
  eventType: string;
  payload: JSONObject;
  uid: string;
  time: Date | undefined;
}): Array<NormalizedSecurityEvent> {
  const one: JSONObject | null = asObject(data.payload["security_group_rule"]);
  const several: unknown = data.payload["security_group_rules"];
  const rules: Array<JSONObject> = one
    ? [one]
    : Array.isArray(several)
      ? several
          .slice(0, MAX_RULES_PER_NOTIFICATION)
          .map(asObject)
          .filter((rule: JSONObject | null): rule is JSONObject => {
            return rule !== null;
          })
      : [];
  const events: Array<NormalizedSecurityEvent> = [];

  rules.forEach((rule: JSONObject, index: number): void => {
    const event: NormalizedSecurityEvent | null = parseSecurityGroupRule({
      line: data.line,
      eventType: data.eventType,
      rule,
      uid: data.uid,
      time: data.time,
      recordIndex: one ? undefined : index,
    });

    if (event) {
      events.push(event);
    }
  });

  return events;
}

const IMAGE_EVENT_VERBS: ReadonlyMap<string, string> = new Map<string, string>([
  ["image.create", "created"],
  ["image.update", "changed"],
  ["image.activate", "activated"],
]);

function parseImage(data: {
  line: SecurityLogLine;
  eventType: string;
  payload: JSONObject;
  uid: string;
  time: Date | undefined;
}): NormalizedSecurityEvent | null {
  if (
    !IMAGE_EVENT_VERBS.has(data.eventType) ||
    readText(data.payload, "visibility").toLowerCase() !== "public"
  ) {
    return null;
  }

  const id: string = readText(data.payload, "id");
  const name: string = readText(data.payload, "name");
  const owner: string = readText(data.payload, "owner");
  const who: string =
    readAttribute(data.line.attributes, [
      "openstack.user_name",
      "openstack.user_id",
    ]) || "Someone";
  const attributes: JSONObject = {};

  set(attributes, OpenStackAuditAttribute.EventType, data.eventType);
  set(attributes, OpenStackAuditAttribute.Action, data.eventType);
  set(attributes, OpenStackAuditAttribute.Outcome, "success");
  set(attributes, OpenStackAuditAttribute.ProjectId, owner);
  set(attributes, OpenStackAuditAttribute.TargetType, "image");
  set(attributes, OpenStackAuditAttribute.TargetId, id);
  set(attributes, OpenStackAuditAttribute.TargetName, name);
  set(attributes, OpenStackAuditAttribute.Cloud, readCloud(data.line));
  set(
    attributes,
    OpenStackAuditAttribute.InitiatorId,
    readAttribute(data.line.attributes, ["openstack.user_id"]),
  );
  set(
    attributes,
    OpenStackAuditAttribute.InitiatorName,
    readAttribute(data.line.attributes, ["openstack.user_name"]),
  );
  set(
    attributes,
    OpenStackAuditAttribute.RequestId,
    readAttribute(data.line.attributes, ["openstack.request_id"]),
  );
  attributes[OpenStackAuditAttribute.PartKind] = OpenStackResourceKind.Image;
  set(attributes, OpenStackAuditAttribute.PartId, id);
  attributes[OpenStackAuditAttribute.Signal] = OpenStackAuditSignal.ImagePublic;

  const project: string = owner ? describeOpenStackProject(owner) : "";
  const image: string = describeOpenStackPart(
    OpenStackResourceKind.Image,
    name || id,
  );

  /*
   * Glance says what an image is now, and not what it was, so an edit to one that was public
   * already reads the same as one being made public. The rule library's detection tells the
   * two apart, by whether this image has been seen public before.
   */
  return namesOf(
    buildLogSecurityEvent({
      line: data.line,
      format: SecurityLogFormat.OpenStackAudit,
      classUid: API_ACTIVITY_CLASS_UID,
      activityName: data.eventType,
      statusName: "Success",
      severity: OcsfSeverity.Low,
      message: `${who} ${IMAGE_EVENT_VERBS.get(data.eventType)} public ${image}`,
      time: data.time,
      principalUser: who === "Someone" ? "" : who,
      targetHost: readCloud(data.line),
      targetResource: project ? `${project} ${image}` : image,
      attributes,
      eventUid: data.uid,
    }),
    [project, image],
  );
}

/*
 * Whether a line is the log driver's own. Anyone able to reach an API can have a service log a
 * name they chose, so a line that only holds something shaped like a notification, in a server's
 * name say, must not become an event saying someone signed in. The stamp says which logger wrote
 * a line of a cloud. Without one, the line says so itself before its JSON, or is nothing but
 * JSON, as a forwarder that ships the notification alone sends it.
 */
function isFromTheLogDriver(line: SecurityLogLine): boolean {
  const logger: string = readAttribute(line.attributes, ["openstack.logger"]);

  if (logger) {
    return logger.startsWith(OPENSTACK_NOTIFICATION_LOGGER_PREFIX);
  }

  const json: number = line.body.indexOf("{");
  const prefix: number = line.body.indexOf(
    OPENSTACK_NOTIFICATION_LOGGER_PREFIX,
  );

  return json === 0 || (prefix !== -1 && prefix < json);
}

export default class OpenStackAuditLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    if (!isFromTheLogDriver(line)) {
      return [];
    }

    const notification: JSONObject | null = readOpenStackAuditNotification(
      line.body,
    );
    const payload: JSONObject | null = asObject(notification?.["payload"]);
    const eventType: string = readText(notification, "event_type");

    if (!notification || !payload || !eventType) {
      return [];
    }

    const typeUri: string = readText(payload, "typeURI");
    const time: Date | undefined =
      readOpenStackNotificationTime(payload["eventTime"]) ||
      readOpenStackNotificationTime(notification["timestamp"]) ||
      undefined;
    const messageId: string = readText(notification, "message_id");
    const uid: string = messageId ? `openstack-audit:${messageId}` : "";
    const data: {
      line: SecurityLogLine;
      eventType: string;
      payload: JSONObject;
      uid: string;
      time: Date | undefined;
    } = { line, eventType, payload, uid, time };

    if (eventType === "security_group_rule.create.end") {
      return parseSecurityGroupRules(data);
    }

    let event: NormalizedSecurityEvent | null = null;

    if (typeUri.indexOf(CADF_EVENT_TYPE_URI) !== -1) {
      if (eventType === "identity.authenticate") {
        event = parseAuthentication(data);
      } else if (eventType.startsWith("identity.role_assignment.")) {
        event = parseRoleAssignment(data);
      } else if (eventType.startsWith("identity.")) {
        event = parseIdentityChange(data);
      } else if (eventType === "audit.http.response") {
        event = parseApiCall(data);
      }
    } else if (eventType.startsWith("image.")) {
      event = parseImage(data);
    }

    return event ? [event] : [];
  }
}
