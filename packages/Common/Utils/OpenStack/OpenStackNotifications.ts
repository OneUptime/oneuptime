import { getOpenStackShortHostName } from "../../Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";

/*
 * WHAT AN OPENSTACK NOTIFICATION SAYS HAPPENED.
 *
 * OpenStack says what changed through its notifications, which go to a message bus
 * nobody reads, and attaching a consumer to a production RabbitMQ is a risk operators
 * rightly refuse. So nothing here touches the bus. oslo.messaging's `log` driver writes
 * each notification as JSON, with passwords masked, to the logger
 * `oslo.messaging.notification.<event_type>`, and the log pipeline carries it. This
 * reads one: Nova's versioned notifications (`nova_object.data`) and its older unversioned
 * ones, Neutron's `<resource>.<operation>.<phase>`, Cinder's and Glance's. A probe's
 * instance actions arrive in the same shape (OpenStackInstanceActions in the probe), so
 * a cloud that cannot change its config gets the same events.
 *
 * Pure, with no server in it, so the ingest, the pages and the tests all read it. What
 * it reads is text a service wrote, sometimes with a tenant's words in it: every value
 * is bounded, nothing here is ever a Markdown or HTML string, and nothing is a regular
 * expression.
 *
 * These attribute keys are stored in customers' logs and monitors: never rename one.
 */

export const OPENSTACK_NOTIFICATION_LOGGER_PREFIX: string =
  "oslo.messaging.notification.";

/*
 * What the message ID of a probe's instance action starts with, which is the one way to tell
 * one from what Nova itself sent: OpenStackEventRecorder leaves them out for a cloud whose
 * own notifications are arriving.
 */
export const OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX: string =
  "os-instance-actions/";

export enum OpenStackEventAttribute {
  Type = "openstack.event.type",
  Priority = "openstack.event.priority",
  Outcome = "openstack.event.outcome",
  Importance = "openstack.event.importance",
  Publisher = "openstack.event.publisher",
  MessageId = "openstack.event.message_id",
  Reason = "openstack.event.reason",
  Exception = "openstack.event.exception",
  PartKind = "openstack.event.part_kind",
  PartId = "openstack.event.part_id",
  PartName = "openstack.event.part_name",
  // The word a monitor groups a scheduling failure by: see OpenStackLogAlertTemplates.
  Failure = "openstack.event.failure",
}

/*
 * Where a record stands among what is worth keeping.
 *
 *   Routine  Said over and over about nothing changing: metrics.update, *.exists. Dropped
 *            by default, by a drop filter a project can turn off (OpenStackLogDefaults).
 *   Trail    A step on the way to something: *.start, a port updated while an instance
 *            boots. Kept as a log, to follow a request by, and drawn nowhere else.
 *   Change   Something happened: on the part's feed, its charts, and for OneUptime AI.
 */
export enum OpenStackEventImportance {
  Routine = "routine",
  Trail = "trail",
  Change = "change",
}

export enum OpenStackEventOutcome {
  Started = "started",
  Succeeded = "succeeded",
  Failed = "failed",
  // No start or end to it, such as a service being disabled.
  Changed = "changed",
}

// What kind of failure it is, for the two alerts on what fails.
export enum OpenStackEventFailure {
  Scheduling = "scheduling",
  Action = "action",
}

export const OPENSTACK_MAX_EVENT_REASON_LENGTH: number = 500;

const MAX_EVENT_VALUE_LENGTH: number = 255;

export interface OpenStackEventPart {
  kind: OpenStackResourceKind;
  // The part's own id: a UUID for most kinds, a flavor's flavorid, a service's binary.
  id: string;
  name: string;
  // Only a Service's: what its row is found by, with its region if the record says.
  binary: string;
}

export interface OpenStackEvent {
  type: string;
  priority: string;
  publisher: string;
  publisherService: string;
  publisherHost: string;
  messageId: string;
  // When it happened, in the notification's own words: never the time it arrived.
  time: Date | null;
  outcome: OpenStackEventOutcome;
  importance: OpenStackEventImportance;
  failure: OpenStackEventFailure | null;
  part: OpenStackEventPart | null;
  // A sentence for the feed and the chart's marker, in English: the stored title.
  title: string;
  reason: string;
  exception: string;
  // Whose it is.
  projectId: string;
  userId: string;
  requestId: string;
  instanceId: string;
  // The machine it happened on: a hypervisor's full name when Nova says it.
  host: string;
  hypervisor: string;
  // A state this moved the part into, for how long it has been there.
  movesState: boolean;
  // Nova's and Cinder's own word for the state it is in now.
  status: string;
}

function cut(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(
  source: Record<string, unknown> | null,
  ...keys: Array<string>
): string {
  if (!source) {
    return "";
  }

  for (const key of keys) {
    const value: unknown = source[key];

    if (typeof value === "string" && value.trim()) {
      return cut(value.trim(), MAX_EVENT_VALUE_LENGTH);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

// Nova's versioned payloads hold their fields one level down, each in nova_object.data.
function dataOf(value: unknown): Record<string, unknown> | null {
  const object: Record<string, unknown> | null = asObject(value);

  if (!object) {
    return null;
  }

  return asObject(object["nova_object.data"]) || object;
}

function endsWith(text: string, ending: string): boolean {
  return text.length >= ending.length && text.endsWith(ending);
}

/*
 * The time a notification says it happened: oslo.messaging writes UTC with no zone,
 * "2026-10-30 10:00:00.123456". Anything else a Date reads is read as a Date does.
 */
export function readOpenStackNotificationTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim() || value.length > 64) {
    return null;
  }

  const text: string = value.trim();
  const hasZone: boolean =
    endsWith(text, "Z") ||
    text.indexOf("+", 10) !== -1 ||
    text.indexOf("-", 11) !== -1;
  const iso: string = text.charAt(10) === " " ? text.replace(" ", "T") : text;
  const date: Date = new Date(hasZone ? iso : `${iso}Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

const ROUTINE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "metrics.update",
  "compute.metrics.update",
]);

// The only events a run of notifications says about nothing having happened.
function isRoutineEvent(type: string): boolean {
  return (
    ROUTINE_EVENT_TYPES.has(type) ||
    endsWith(type, ".exists") ||
    endsWith(type, ".usage")
  );
}

/*
 * Steps of something bigger: the ports an instance's boot updates, the scheduler
 * choosing a host, the state changes on the way to a state. Worth following a request
 * through, and not worth a marker each.
 */
const TRAIL_EVENT_PREFIXES: ReadonlyArray<string> = [
  "port.",
  "instance.update",
  "compute.instance.update",
  "scheduler.",
  "compute_task.",
  "image.send",
  "image.prepare",
  "identity.",
  "audit.",
];

function isTrailEvent(type: string): boolean {
  return (
    endsWith(type, ".start") ||
    TRAIL_EVENT_PREFIXES.some((prefix: string): boolean => {
      return type.startsWith(prefix);
    })
  );
}

function readOutcome(type: string, priority: string): OpenStackEventOutcome {
  const lowerPriority: string = priority.toLowerCase();

  if (
    endsWith(type, ".error") ||
    type === "compute.exception" ||
    lowerPriority === "error" ||
    lowerPriority === "critical" ||
    lowerPriority === "fatal"
  ) {
    return OpenStackEventOutcome.Failed;
  }

  if (endsWith(type, ".start")) {
    return OpenStackEventOutcome.Started;
  }

  if (endsWith(type, ".end")) {
    return OpenStackEventOutcome.Succeeded;
  }

  return OpenStackEventOutcome.Changed;
}

/*
 * Which of the two alerts a failure belongs to. Nova's documentation calls the scheduler's
 * failure scheduler.select_destinations.error. What it sends when no host can be found
 * is compute_task.<method>.error, with NoValidHost as its reason, so both count.
 */
function readFailure(data: {
  type: string;
  outcome: OpenStackEventOutcome;
  exception: string;
  reason: string;
}): OpenStackEventFailure | null {
  if (data.outcome !== OpenStackEventOutcome.Failed) {
    return null;
  }

  if (
    data.type.startsWith("scheduler.") ||
    data.exception.indexOf("NoValidHost") !== -1 ||
    data.reason.indexOf("No valid host") !== -1
  ) {
    return OpenStackEventFailure.Scheduling;
  }

  return OpenStackEventFailure.Action;
}

/*
 * What a failure says about why, wherever its service keeps that: an instance's fault, a
 * compute task's reason, compute.exception's own fields, Cinder's and the older notifications'.
 */
function readReason(data: Record<string, unknown> | null): {
  reason: string;
  exception: string;
} {
  if (!data) {
    return { reason: "", exception: "" };
  }

  const nested: Record<string, unknown> | null =
    dataOf(data["fault"]) || dataOf(data["reason"]);
  const holder: Record<string, unknown> = nested || data;
  const exception: string = readText(holder, "exception");
  const message: string =
    readFullText(holder, "exception_message") ||
    readFullText(holder, "message") ||
    (typeof data["reason"] === "string"
      ? readFullText(data, "reason")
      : "") ||
    (typeof data["fault"] === "string" ? readFullText(data, "fault") : "");

  return {
    reason: cut(message, OPENSTACK_MAX_EVENT_REASON_LENGTH),
    exception,
  };
}

function readFullText(
  source: Record<string, unknown> | null,
  key: string,
): string {
  const value: unknown = source ? source[key] : undefined;

  return typeof value === "string" ? value.trim() : "";
}

// Neutron's resources that are parts of a cloud, and the word it names each by.
const NEUTRON_PARTS: ReadonlyMap<string, OpenStackResourceKind> = new Map<
  string,
  OpenStackResourceKind
>([
  ["network", OpenStackResourceKind.Network],
  ["subnet", OpenStackResourceKind.Subnet],
  ["router", OpenStackResourceKind.Router],
  ["floatingip", OpenStackResourceKind.FloatingIp],
]);

const NEUTRON_RESOURCES: ReadonlySet<string> = new Set([
  "network",
  "subnet",
  "subnetpool",
  "port",
  "router",
  "floatingip",
  "security_group",
  "security_group_rule",
  "segment",
  "trunk",
]);

// The first word of an event type: nova's instance., compute.instance. and the rest.
function readFamily(type: string): string {
  const unversioned: string = "compute.instance.";

  if (type.startsWith(unversioned)) {
    return "instance";
  }

  const dot: number = type.indexOf(".");

  return dot === -1 ? type : type.slice(0, dot);
}

function readPart(data: {
  family: string;
  payload: Record<string, unknown>;
  fields: Record<string, unknown> | null;
  instanceFromLine: string;
}): OpenStackEventPart | null {
  const { family, payload, fields } = data;

  switch (family) {
    case "instance": {
      const id: string =
        readText(fields, "uuid", "instance_id", "instance_uuid") ||
        data.instanceFromLine;

      return id
        ? {
            kind: OpenStackResourceKind.Instance,
            id,
            name: readText(fields, "display_name", "hostname"),
            binary: "",
          }
        : null;
    }
    case "compute":
    case "compute_task":
    case "scheduler": {
      const id: string =
        readText(fields, "instance_uuid", "uuid") || data.instanceFromLine;

      return id
        ? {
            kind: OpenStackResourceKind.Instance,
            id,
            name: "",
            binary: "",
          }
        : null;
    }
    case "service": {
      const binary: string = readText(fields, "binary");
      const host: string = readText(fields, "host");

      return binary && host
        ? {
            kind: OpenStackResourceKind.Service,
            id: `${host}/${binary}`,
            name: binary,
            binary,
          }
        : null;
    }
    case "flavor": {
      const id: string = readText(fields, "flavorid", "id");

      return id
        ? {
            kind: OpenStackResourceKind.Flavor,
            id,
            name: readText(fields, "name"),
            binary: "",
          }
        : null;
    }
    case "volume": {
      const id: string = readText(fields, "volume_id", "id");

      return id
        ? {
            kind: OpenStackResourceKind.Volume,
            id,
            name: readText(fields, "display_name", "name"),
            binary: "",
          }
        : null;
    }
    case "snapshot": {
      const id: string = readText(fields, "snapshot_id", "id");

      return id
        ? {
            kind: OpenStackResourceKind.Snapshot,
            id,
            name: readText(fields, "display_name", "name"),
            binary: "",
          }
        : null;
    }
    case "backup": {
      const id: string = readText(fields, "backup_id", "id");

      return id
        ? {
            kind: OpenStackResourceKind.Backup,
            id,
            name: readText(fields, "display_name", "name"),
            binary: "",
          }
        : null;
    }
    case "image": {
      const id: string = readText(fields, "id");

      return id
        ? {
            kind: OpenStackResourceKind.Image,
            id,
            name: readText(fields, "name"),
            binary: "",
          }
        : null;
    }
    default: {
      const kind: OpenStackResourceKind | undefined = NEUTRON_PARTS.get(family);

      if (!kind) {
        return null;
      }

      const resource: Record<string, unknown> | null = asObject(
        payload[family],
      );
      const id: string =
        readText(resource, "id") || readText(payload, `${family}_id`, "id");

      return id
        ? {
            kind,
            id,
            name: readText(resource, "name"),
            binary: "",
          }
        : null;
    }
  }
}

// What each step of an event is called on a feed.
const ACTION_WORDS: ReadonlyMap<string, string> = new Map<string, string>([
  ["create", "created"],
  ["delete", "deleted"],
  ["update", "updated"],
  ["power_on", "started"],
  ["power_off", "stopped"],
  ["shutdown", "shut down"],
  ["reboot", "rebooted"],
  ["rebuild", "rebuilt"],
  ["resize", "resized"],
  ["migrate", "migrated"],
  ["live_migration", "live migrated"],
  ["resize_finish", "resize finished"],
  ["resize_prep", "resize prepared"],
  ["resize_confirm", "resize confirmed"],
  ["resize_revert", "resize reverted"],
  ["live_migration_pre", "live migration prepared"],
  ["live_migration_rollback", "live migration rolled back"],
  ["live_migration_abort", "live migration aborted"],
  ["live_migration_post", "live migrated"],
  ["live_migration_post_dest", "live migration finished on its destination"],
  ["live_migration_force_complete", "live migration forced to complete"],
  ["evacuate", "evacuated"],
  ["pause", "paused"],
  ["unpause", "unpaused"],
  ["suspend", "suspended"],
  ["resume", "resumed"],
  ["shelve", "shelved"],
  ["shelve_offload", "shelved and offloaded"],
  ["unshelve", "unshelved"],
  ["rescue", "rescued"],
  ["unrescue", "unrescued"],
  ["soft_delete", "soft deleted"],
  ["restore", "restored"],
  ["lock", "locked"],
  ["unlock", "unlocked"],
  ["snapshot", "snapshotted"],
  ["volume_attach", "volume attached"],
  ["volume_detach", "volume detached"],
  ["volume_swap", "volume swapped"],
  ["interface_attach", "interface attached"],
  ["interface_detach", "interface detached"],
  ["trigger_crash_dump", "crash dump triggered"],
  ["attach", "attached"],
  ["detach", "detached"],
  ["extend", "extended"],
  ["retype", "retyped"],
  ["activate", "activated"],
  ["deactivate", "deactivated"],
  ["reactivate", "reactivated"],
  ["upload", "uploaded"],
  ["add_host", "host added"],
  ["remove_host", "host removed"],
  ["update_metadata", "metadata updated"],
  ["update_prop", "properties updated"],
]);

const KIND_NOUNS: Readonly<Partial<Record<OpenStackResourceKind, string>>> = {
  [OpenStackResourceKind.Instance]: "Instance",
  [OpenStackResourceKind.Service]: "Service",
  [OpenStackResourceKind.Flavor]: "Flavor",
  [OpenStackResourceKind.Volume]: "Volume",
  [OpenStackResourceKind.Snapshot]: "Snapshot",
  [OpenStackResourceKind.Backup]: "Backup",
  [OpenStackResourceKind.Image]: "Image",
  [OpenStackResourceKind.Network]: "Network",
  [OpenStackResourceKind.Subnet]: "Subnet",
  [OpenStackResourceKind.Router]: "Router",
  [OpenStackResourceKind.FloatingIp]: "Floating IP",
};

// The step's own word: instance.volume_attach.end is volume_attach.
function readAction(type: string): string {
  const parts: Array<string> = type.split(".");

  if (parts.length > 0) {
    const last: string = parts[parts.length - 1]!;

    if (last === "start" || last === "end" || last === "error") {
      parts.pop();
    }
  }

  return parts.length > 0 ? parts[parts.length - 1]! : type;
}

function buildTitle(data: {
  type: string;
  part: OpenStackEventPart | null;
  outcome: OpenStackEventOutcome;
  reason: string;
  fields: Record<string, unknown> | null;
  host: string;
}): string {
  const { type, part, outcome, reason } = data;
  const action: string = readAction(type);

  // A service being disabled is what its update says, and what a person wants to read.
  if (type.startsWith("service.") && part && data.fields) {
    const name: string = `${part.binary} on ${data.host}`;

    if (data.fields["forced_down"] === true) {
      return `Service ${name}: forced down`;
    }

    if (data.fields["disabled"] === true) {
      const why: string = readText(data.fields, "disabled_reason");

      return why
        ? `Service ${name}: disabled: ${why}`
        : `Service ${name}: disabled`;
    }

    if (data.fields["disabled"] === false && action === "update") {
      return `Service ${name}: enabled`;
    }
  }

  // An aggregate has no row of its own, and its name is still what a person calls it.
  const isAggregate: boolean = !part && type.startsWith("aggregate.");
  const noun: string = part
    ? KIND_NOUNS[part.kind] || "Part"
    : isAggregate
      ? "Aggregate"
      : "OpenStack";
  const name: string = part
    ? part.name || part.id
    : isAggregate
      ? readText(data.fields, "name")
      : "";
  const subject: string = name ? `${noun} ${name}` : noun;

  if (outcome === OpenStackEventOutcome.Failed) {
    if (type === "compute.exception") {
      return reason
        ? `${subject}: compute failed: ${reason}`
        : `${subject}: compute failed`;
    }

    return reason
      ? `${subject}: ${action} failed: ${reason}`
      : `${subject}: ${action} failed`;
  }

  const word: string | undefined = ACTION_WORDS.get(action);

  if (word) {
    return `${subject}: ${word}`;
  }

  return `${subject}: ${type}`;
}

// An instance's and a volume's states are worth saying how long it has been in.
const INSTANCE_STATE_ACTIONS: ReadonlySet<string> = new Set([
  "create",
  "power_on",
  "power_off",
  "shutdown",
  "reboot",
  "rebuild",
  "resize",
  "migrate",
  "live_migration",
  "resize_finish",
  "resize_confirm",
  "resize_revert",
  "live_migration_post",
  "live_migration_rollback",
  "evacuate",
  "pause",
  "unpause",
  "suspend",
  "resume",
  "shelve",
  "shelve_offload",
  "unshelve",
  "rescue",
  "unrescue",
  "soft_delete",
  "restore",
]);

const VOLUME_STATE_ACTIONS: ReadonlySet<string> = new Set([
  "create",
  "attach",
  "detach",
  "extend",
  "retype",
]);

const IMAGE_STATE_ACTIONS: ReadonlySet<string> = new Set([
  "activate",
  "deactivate",
  "reactivate",
]);

function readMovesState(data: {
  type: string;
  part: OpenStackEventPart | null;
  outcome: OpenStackEventOutcome;
  fields: Record<string, unknown> | null;
}): boolean {
  const { part, outcome, fields } = data;

  if (
    !part ||
    outcome === OpenStackEventOutcome.Started ||
    data.type.indexOf(".delete") !== -1
  ) {
    return false;
  }

  const action: string = readAction(data.type);

  switch (part.kind) {
    case OpenStackResourceKind.Instance: {
      if (action === "update") {
        const change: Record<string, unknown> | null = dataOf(
          fields ? fields["state_update"] : undefined,
        );

        return Boolean(
          change &&
          (change["old_state"] !== change["state"] ||
            change["old_task_state"] !== change["new_task_state"]),
        );
      }

      return (
        outcome === OpenStackEventOutcome.Failed ||
        INSTANCE_STATE_ACTIONS.has(action)
      );
    }
    case OpenStackResourceKind.Volume:
      return (
        outcome === OpenStackEventOutcome.Failed ||
        VOLUME_STATE_ACTIONS.has(action)
      );
    case OpenStackResourceKind.Image:
      return IMAGE_STATE_ACTIONS.has(action);
    case OpenStackResourceKind.Service:
      return Boolean(
        fields &&
        (typeof fields["disabled"] === "boolean" ||
          typeof fields["forced_down"] === "boolean"),
      );
    default:
      return false;
  }
}

// A service.host publisher: nova-compute:compute-01, or image.localhost and volume.host.
function readPublisher(publisher: string): {
  service: string;
  host: string;
} {
  const colon: number = publisher.indexOf(":");

  if (colon > 0) {
    return {
      service: publisher.slice(0, colon),
      host: publisher.slice(colon + 1),
    };
  }

  const dot: number = publisher.indexOf(".");

  if (dot > 0) {
    return {
      service: publisher.slice(0, dot),
      host: publisher.slice(dot + 1),
    };
  }

  return { service: publisher, host: "" };
}

/*
 * One notification, whole, as the log driver wrote it. Null when it is not one: every
 * notification names its type and carries a payload.
 */
export function readOpenStackNotification(data: {
  message: unknown;
  // What the log line itself said, for what a notification leaves out.
  instanceId?: string | undefined;
  requestId?: string | undefined;
  userId?: string | undefined;
  projectId?: string | undefined;
  lineTime?: Date | null | undefined;
}): OpenStackEvent | null {
  const message: Record<string, unknown> | null = asObject(data.message);

  if (!message || typeof message["event_type"] !== "string") {
    return null;
  }

  const type: string = readText(message, "event_type");

  if (!type) {
    return null;
  }

  const payload: Record<string, unknown> | null = asObject(message["payload"]);

  if (!payload) {
    return null;
  }

  const fields: Record<string, unknown> | null = dataOf(payload);
  const priority: string = readText(message, "priority");
  const publisher: string = readText(message, "publisher_id");
  const fromPublisher: { service: string; host: string } =
    readPublisher(publisher);
  const family: string = readFamily(type);
  const instanceFromLine: string = data.instanceId || "";
  const part: OpenStackEventPart | null = NEUTRON_RESOURCES.has(family)
    ? readPart({ family, payload, fields: payload, instanceFromLine })
    : readPart({ family, payload, fields, instanceFromLine });
  const outcome: OpenStackEventOutcome = readOutcome(type, priority);
  const why: { reason: string; exception: string } =
    outcome === OpenStackEventOutcome.Failed || type === "compute.exception"
      ? readReason(fields)
      : { reason: "", exception: "" };
  const hypervisor: string = readText(fields, "node");
  const host: string =
    readText(fields, "host") || fromPublisher.host || hypervisor;

  let importance: OpenStackEventImportance = OpenStackEventImportance.Change;

  if (isRoutineEvent(type)) {
    importance = OpenStackEventImportance.Routine;
  } else if (
    outcome !== OpenStackEventOutcome.Failed &&
    isTrailEvent(type)
  ) {
    importance = OpenStackEventImportance.Trail;
  }

  const movesState: boolean = readMovesState({ type, part, outcome, fields });

  return {
    type,
    priority,
    publisher,
    publisherService: fromPublisher.service,
    publisherHost: fromPublisher.host,
    messageId: readText(message, "message_id"),
    time:
      readOpenStackNotificationTime(message["timestamp"]) ||
      data.lineTime ||
      null,
    outcome,
    importance,
    failure: readFailure({
      type,
      outcome,
      exception: why.exception,
      reason: why.reason,
    }),
    part,
    title: buildTitle({
      type,
      part,
      outcome,
      reason: why.reason,
      fields,
      host: getOpenStackShortHostName(host),
    }),
    reason: why.reason,
    exception: why.exception,
    projectId:
      readText(fields, "action_initiator_project", "tenant_id", "project_id") ||
      data.projectId ||
      "",
    userId:
      readText(fields, "action_initiator_user", "user_id") || data.userId || "",
    requestId: readText(fields, "request_id") || data.requestId || "",
    instanceId:
      part && part.kind === OpenStackResourceKind.Instance
        ? part.id
        : readText(fields, "instance_uuid", "instance_id") || instanceFromLine,
    host,
    hypervisor,
    movesState,
    status: readText(fields, "state", "status"),
  };
}

/*
 * What a part's change events are read by: the attribute its id is kept under, on the
 * events of every kind but a machine's, which are read by the host they were on.
 */
export const OPENSTACK_EVENT_HOST_ATTRIBUTE: string = "openstack.host";
export const OPENSTACK_EVENT_SERVICE_ATTRIBUTE: string = "openstack.service";
