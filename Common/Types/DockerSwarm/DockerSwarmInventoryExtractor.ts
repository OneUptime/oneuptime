import { JSONObject } from "../JSON";
import { ParsedDockerSwarmResource } from "../../Server/Services/DockerSwarmResourceService";

/*
 * ------------------------------------------------------------------
 *                  DockerSwarmInventoryExtractor
 * ------------------------------------------------------------------
 *
 * Parses a single inventory log record emitted by the OneUptime Docker
 * Swarm Agent's snapshot script. The script runs on a manager node and
 * polls the Swarm API every 5 minutes (`docker node ls`,
 * `docker service ls`, `docker service ps`, `docker stack ls`,
 * `docker network ls`, `docker secret ls`, `docker config ls`,
 * `docker volume ls` — all `--format json`) and emits one JSON object
 * per line into a log file the OTel filelog receiver forwards as OTLP.
 *
 * The wire format is a JSON envelope:
 *
 *   { "kind": "Node" | "Service" | "Task" | "Stack" | "Network"
 *             | "Secret" | "Config" | "Volume",
 *     "data": { ...native `docker ... ls --format json` payload... } }
 *
 * The kind discriminator is also set as the `oneuptime.dockerswarm.kind`
 * log record attribute by the agent's filelog operator chain.
 *
 * Each kind has a dedicated parser that pulls the fields promoted to
 * first-class columns on DockerSwarmResource; everything else goes in
 * the `attributes` JSON column. The raw blob is not persisted here — it
 * lives on the original log record in ClickHouse.
 *
 * ------------------------------------------------------------------
 */

export const INVENTORY_KIND_ATTRIBUTE: string = "oneuptime.dockerswarm.kind";

export const INVENTORIED_DOCKER_SWARM_KINDS: ReadonlyArray<string> = [
  "Node",
  "Service",
  "Task",
  "Stack",
  "Network",
  "Secret",
  "Config",
  "Volume",
];

const CANONICAL_MAP: Record<string, string> = {
  node: "Node",
  nodes: "Node",
  service: "Service",
  services: "Service",
  task: "Task",
  tasks: "Task",
  stack: "Stack",
  stacks: "Stack",
  network: "Network",
  networks: "Network",
  secret: "Secret",
  secrets: "Secret",
  config: "Config",
  configs: "Config",
  volume: "Volume",
  volumes: "Volume",
};

export function canonicalDockerSwarmKind(raw: string): string | null {
  const trimmed: string = (raw || "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return CANONICAL_MAP[trimmed] || null;
}

export function isInventoriedDockerSwarmKind(kind: string): boolean {
  return canonicalDockerSwarmKind(kind) !== null;
}

function parseLogBody(logBody: string): JSONObject | null {
  try {
    const parsed: unknown = JSON.parse(logBody);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JSONObject;
    }
    return null;
  } catch {
    return null;
  }
}

function readString(obj: JSONObject, key: string): string | null {
  const v: unknown = obj[key];
  if (typeof v === "string" && v.trim().length > 0) {
    return v.trim();
  }
  if (typeof v === "number") {
    return String(v);
  }
  return null;
}

function readJSONObject(obj: JSONObject, key: string): JSONObject | null {
  const v: unknown = obj[key];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as JSONObject;
  }
  return null;
}

// Parse a Docker "X/Y" replica string into [running, desired].
function parseReplicas(raw: string | null): {
  running: number | null;
  desired: number | null;
} {
  if (!raw) {
    return { running: null, desired: null };
  }
  // Replicated: "3/5". Global: "5/5" too. Strip any trailing text.
  const m: RegExpMatchArray | null = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) {
    return { running: null, desired: null };
  }
  return {
    running: parseInt(m[1]!, 10),
    desired: parseInt(m[2]!, 10),
  };
}

function emptyResource(
  kind: string,
  externalId: string,
  lastSeenAt: Date,
): ParsedDockerSwarmResource {
  return {
    kind,
    externalId,
    name: null,
    state: null,
    role: null,
    serviceMode: null,
    desiredReplicas: null,
    runningReplicas: null,
    image: null,
    stackName: null,
    serviceName: null,
    nodeHostname: null,
    driver: null,
    isReady: null,
    attributes: null,
    lastSeenAt,
  };
}

/*
 * `docker node ls --format json`:
 *   { ID, Hostname, Status, Availability, ManagerStatus, EngineVersion,
 *     TLSStatus, Self }
 */
function parseNode(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerSwarmResource | null {
  const id: string | null = readString(data, "ID") || readString(data, "Id");
  if (!id) {
    return null;
  }
  const r: ParsedDockerSwarmResource = emptyResource(
    "Node",
    `node/${id}`,
    lastSeenAt,
  );
  r.name = readString(data, "Hostname");
  r.state = readString(data, "Status"); // Ready | Down | Unknown
  r.isReady = r.state ? r.state.toLowerCase() === "ready" : null;
  const managerStatus: string | null = readString(data, "ManagerStatus");
  r.role = managerStatus ? "manager" : "worker";
  r.attributes = {
    availability: readString(data, "Availability"),
    managerStatus: managerStatus,
    engineVersion: readString(data, "EngineVersion"),
    tlsStatus: readString(data, "TLSStatus"),
    isLeader: managerStatus ? managerStatus.toLowerCase() === "leader" : false,
  };
  return r;
}

/*
 * `docker service ls --format json`:
 *   { ID, Name, Mode, Replicas, Image, Ports }
 */
function parseService(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerSwarmResource | null {
  const id: string | null = readString(data, "ID") || readString(data, "Id");
  if (!id) {
    return null;
  }
  const r: ParsedDockerSwarmResource = emptyResource(
    "Service",
    `service/${id}`,
    lastSeenAt,
  );
  r.name = readString(data, "Name");
  r.serviceMode = readString(data, "Mode"); // replicated | global
  r.image = readString(data, "Image");
  const replicas: { running: number | null; desired: number | null } =
    parseReplicas(readString(data, "Replicas"));
  r.runningReplicas = replicas.running;
  r.desiredReplicas = replicas.desired;
  r.state =
    replicas.running !== null && replicas.desired !== null
      ? `${replicas.running}/${replicas.desired}`
      : null;
  r.isReady =
    replicas.running !== null && replicas.desired !== null
      ? replicas.running >= replicas.desired && replicas.desired > 0
      : null;
  // Stack namespace: services deployed via a stack are named "<stack>_<svc>".
  if (r.name && r.name.includes("_")) {
    r.stackName = r.name.split("_")[0] || null;
  }
  r.attributes = {
    ports: readString(data, "Ports"),
  };
  return r;
}

/*
 * `docker service ps <svc> --format json` / `docker node ps`:
 *   { ID, Name, Image, Node, DesiredState, CurrentState, Error, Ports }
 */
function parseTask(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerSwarmResource | null {
  const id: string | null = readString(data, "ID") || readString(data, "Id");
  if (!id) {
    return null;
  }
  const r: ParsedDockerSwarmResource = emptyResource(
    "Task",
    `task/${id}`,
    lastSeenAt,
  );
  r.name = readString(data, "Name"); // <service>.<slot> or <service>.<nodeId>
  r.image = readString(data, "Image");
  r.nodeHostname = readString(data, "Node");
  // CurrentState is e.g. "Running 2 hours ago" / "Shutdown 3 minutes ago".
  const currentState: string | null = readString(data, "CurrentState");
  r.state = currentState ? currentState.split(/\s+/)[0]!.toLowerCase() : null;
  r.isReady = r.state ? r.state === "running" : null;
  if (r.name && r.name.includes(".")) {
    r.serviceName = r.name.split(".")[0] || null;
  }
  if (r.serviceName && r.serviceName.includes("_")) {
    r.stackName = r.serviceName.split("_")[0] || null;
  }
  r.attributes = {
    desiredState: readString(data, "DesiredState"),
    currentState: currentState,
    error: readString(data, "Error"),
  };
  return r;
}

/*
 * `docker stack ls --format json`:
 *   { Name, Services, Orchestrator }
 */
function parseStack(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerSwarmResource | null {
  const name: string | null = readString(data, "Name");
  if (!name) {
    return null;
  }
  const r: ParsedDockerSwarmResource = emptyResource(
    "Stack",
    `stack/${name}`,
    lastSeenAt,
  );
  r.name = name;
  r.stackName = name;
  const servicesRaw: string | null = readString(data, "Services");
  const serviceCount: number | null = servicesRaw
    ? parseInt(servicesRaw, 10)
    : null;
  r.state = serviceCount !== null ? `${serviceCount} services` : null;
  r.attributes = {
    serviceCount:
      serviceCount !== null && !isNaN(serviceCount) ? serviceCount : null,
    orchestrator: readString(data, "Orchestrator"),
  };
  return r;
}

/*
 * `docker network ls --format json`:
 *   { ID, Name, Driver, Scope }
 */
function parseNetwork(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerSwarmResource | null {
  const id: string | null = readString(data, "ID") || readString(data, "Id");
  const name: string | null = readString(data, "Name");
  if (!id && !name) {
    return null;
  }
  const r: ParsedDockerSwarmResource = emptyResource(
    "Network",
    `network/${id || name}`,
    lastSeenAt,
  );
  r.name = name;
  r.driver = readString(data, "Driver");
  const scope: string | null = readString(data, "Scope");
  r.state = scope;
  r.attributes = {
    scope: scope,
    internal: readString(data, "Internal"),
    ipv6: readString(data, "IPv6"),
  };
  return r;
}

/*
 * `docker secret ls` / `docker config ls --format json`:
 *   { ID, Name, CreatedAt, UpdatedAt }
 */
function parseSecretOrConfig(
  kind: string,
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerSwarmResource | null {
  const id: string | null = readString(data, "ID") || readString(data, "Id");
  const name: string | null = readString(data, "Name");
  if (!id && !name) {
    return null;
  }
  const r: ParsedDockerSwarmResource = emptyResource(
    kind,
    `${kind.toLowerCase()}/${id || name}`,
    lastSeenAt,
  );
  r.name = name;
  r.attributes = {
    createdAt: readString(data, "CreatedAt"),
    updatedAt: readString(data, "UpdatedAt"),
  };
  return r;
}

/*
 * `docker volume ls --format json`:
 *   { Name, Driver, Scope, Mountpoint } — per node, so the agent stamps
 *   the node hostname onto the envelope.
 */
function parseVolume(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerSwarmResource | null {
  const name: string | null = readString(data, "Name");
  if (!name) {
    return null;
  }
  const nodeHostname: string | null =
    readString(data, "Node") || readString(data, "NodeHostname");
  // Volumes are per-node; suffix the node so two nodes' volumes don't collide.
  const externalId: string = nodeHostname
    ? `volume/${name}@${nodeHostname}`
    : `volume/${name}`;
  const r: ParsedDockerSwarmResource = emptyResource(
    "Volume",
    externalId,
    lastSeenAt,
  );
  r.name = name;
  r.driver = readString(data, "Driver");
  r.nodeHostname = nodeHostname;
  r.state = readString(data, "Scope");
  r.attributes = {
    scope: readString(data, "Scope"),
    mountpoint: readString(data, "Mountpoint"),
  };
  return r;
}

export interface ExtractedDockerSwarmInventoryRecord {
  resource: ParsedDockerSwarmResource;
}

/**
 * Parse a single inventory log line. Returns null when the body is
 * malformed or the kind is not modeled — callers swallow nulls silently
 * rather than fail the whole batch.
 */
export function extractDockerSwarmInventoryResource(data: {
  kind: string;
  logBody: string;
  lastSeenAt: Date;
}): ExtractedDockerSwarmInventoryRecord | null {
  const canonical: string | null = canonicalDockerSwarmKind(data.kind);
  if (!canonical) {
    return null;
  }

  const body: JSONObject | null = parseLogBody(data.logBody);
  if (!body) {
    return null;
  }

  const inner: JSONObject =
    (readJSONObject(body, "data") as JSONObject) || body;

  let parsed: ParsedDockerSwarmResource | null = null;
  switch (canonical) {
    case "Node":
      parsed = parseNode(inner, data.lastSeenAt);
      break;
    case "Service":
      parsed = parseService(inner, data.lastSeenAt);
      break;
    case "Task":
      parsed = parseTask(inner, data.lastSeenAt);
      break;
    case "Stack":
      parsed = parseStack(inner, data.lastSeenAt);
      break;
    case "Network":
      parsed = parseNetwork(inner, data.lastSeenAt);
      break;
    case "Secret":
      parsed = parseSecretOrConfig("Secret", inner, data.lastSeenAt);
      break;
    case "Config":
      parsed = parseSecretOrConfig("Config", inner, data.lastSeenAt);
      break;
    case "Volume":
      parsed = parseVolume(inner, data.lastSeenAt);
      break;
    default:
      parsed = null;
  }

  if (!parsed) {
    return null;
  }

  return { resource: parsed };
}
