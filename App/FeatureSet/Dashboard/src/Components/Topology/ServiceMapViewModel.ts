import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import computeLayeredLayout, {
  LayoutPoint,
} from "../../Utils/LayeredGraphLayout";
import { ServiceOperationalStatus } from "./OperationalOverlay";
import { isEntityActive } from "./TopologyActivity";
import {
  SERVICE_MAP_TOLERATED_ERROR_RATE,
  TrafficHealth,
  healthForErrorRate,
  metaForEntityType,
} from "./TopologyMeta";

/*
 * The Service Map's view model: what the map is about, computed once from the
 * topology snapshot and never from what is currently filtered, so searching
 * or focusing can never change a node's health.
 *
 * Nodes are the project's services plus everything they were seen calling —
 * databases, remote APIs, brokers and manually registered external services.
 * A service map without its datastores hides exactly the dependency most
 * incidents are about.
 */

export type ServiceMapNodeKind = "service" | "database" | "remote" | "external";

/*
 * What a node is doing, in words a person can act on. A service nothing
 * calls is not "unknown" — a frontend or a scheduled job is supposed to have
 * no callers — so a node that only makes calls is an entry point.
 */
export type ServiceMapStatus =
  | "healthy"
  | "degraded"
  | "critical"
  | "entry"
  | "isolated";

export const SERVICE_STATUS_LABELS: Record<ServiceMapStatus, string> = {
  healthy: "Healthy",
  degraded: "Some errors",
  critical: "High error rate",
  entry: "Entry point",
  isolated: "No calls observed",
};

export interface TrafficTotals {
  calls: number;
  errors: number;
  /** Call-weighted average, or null when no call reported a duration. */
  avgDurationMs: number | null;
}

export interface ServiceMapEntry {
  entity: InventoryItem;
  key: string;
  label: string;
  kind: ServiceMapNodeKind;
  /** "Service", "Database", "Remote Service", ... */
  typeLabel: string;
  /** Language, database engine or protocol when known: "Node.js", "PostgreSQL". */
  detailLabel: string | null;
  inbound: TrafficTotals;
  outbound: TrafficTotals;
  callers: number;
  dependencies: number;
  /** Health of the calls this node answered. */
  health: TrafficHealth;
  status: ServiceMapStatus;
  incidentCount: number;
  incidentColor: string | null;
  alertCount: number;
  alertColor: string | null;
  needsAttention: boolean;
  /** Keys of the active infrastructure this service runs on. */
  runsOn: Array<string>;
}

export interface ServiceMapEdge {
  id: string;
  from: string;
  to: string;
  relationship: InventoryItemRelationship;
  calls: number;
  errors: number;
  avgDurationMs: number | null;
  health: TrafficHealth;
}

export interface ServiceMapModel {
  entries: Array<ServiceMapEntry>;
  entryByKey: Map<string, ServiceMapEntry>;
  edges: Array<ServiceMapEdge>;
  /** The `depends-on` rows the edges were built from. */
  relationships: Array<InventoryItemRelationship>;
  /** Services left out because they did not report in the selected range. */
  inactiveServiceCount: number;
}

export interface ServiceMapVisibility {
  matchedKeys: Set<string>;
  visibleKeys: Set<string>;
  contextKeys: Set<string>;
  effectiveFocusKey: string | null;
}

export interface BuildServiceMapOptions {
  statuses?: Map<string, ServiceOperationalStatus> | undefined;
  /** Start of the selected time range; omit to treat everything as active. */
  rangeStart?: Date | undefined;
  includeInactive?: boolean | undefined;
}

const DEPENDENCY_KIND_BY_TYPE: Partial<Record<string, ServiceMapNodeKind>> = {
  [EntityType.Service]: "service",
  [EntityType.Database]: "database",
  [EntityType.ExternalDatabase]: "database",
  [EntityType.RemoteService]: "remote",
  [EntityType.ServerlessFunction]: "remote",
  [EntityType.ExternalService]: "external",
};

const RUNS_ON_RELATIONSHIPS: Set<string> = new Set<string>([
  EntityRelationshipType.RunsOn,
  EntityRelationshipType.HostedOn,
]);

/* Friendly names for the values semconv puts in these attributes. */
const DETAIL_LABELS: Record<string, string> = {
  nodejs: "Node.js",
  webjs: "Browser",
  python: "Python",
  java: "Java",
  go: "Go",
  dotnet: ".NET",
  ruby: "Ruby",
  php: "PHP",
  rust: "Rust",
  cpp: "C++",
  erlang: "Erlang",
  swift: "Swift",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mssql: "SQL Server",
  "microsoft.sql_server": "SQL Server",
  oracle: "Oracle",
  redis: "Redis",
  valkey: "Valkey",
  memcached: "Memcached",
  mongodb: "MongoDB",
  clickhouse: "ClickHouse",
  elasticsearch: "Elasticsearch",
  opensearch: "OpenSearch",
  cassandra: "Cassandra",
  dynamodb: "DynamoDB",
  "aws.dynamodb": "DynamoDB",
  sqlite: "SQLite",
  kafka: "Kafka",
  rabbitmq: "RabbitMQ",
  activemq: "ActiveMQ",
  "aws.sqs": "Amazon SQS",
  aws_sqs: "Amazon SQS",
  gcp_pubsub: "Pub/Sub",
  http: "HTTP",
  grpc: "gRPC",
};

function readAttribute(entity: InventoryItem, key: string): string | null {
  const bags: Array<unknown> = [
    entity.descriptiveAttributes,
    entity.identifyingAttributes,
  ];
  for (const bag of bags) {
    const value: unknown = (bag as Record<string, unknown> | undefined)?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function detailLabelForEntity(entity: InventoryItem): string | null {
  const raw: string | null =
    readAttribute(entity, "telemetry.sdk.language") ||
    readAttribute(entity, "db.system.name") ||
    readAttribute(entity, "network.protocol.name") ||
    readAttribute(entity, "messaging.system");
  if (!raw) {
    return null;
  }
  return DETAIL_LABELS[raw.toLowerCase()] || raw;
}

export function kindForEntityType(
  entityType: string | undefined,
): ServiceMapNodeKind {
  return DEPENDENCY_KIND_BY_TYPE[entityType || ""] || "remote";
}

function emptyTotals(): TrafficTotals {
  return { calls: 0, errors: 0, avgDurationMs: null };
}

function addTraffic(
  totals: TrafficTotals,
  relationship: InventoryItemRelationship,
): void {
  const calls: number = Math.max(0, relationship.callCount || 0);
  if (calls <= 0) {
    return;
  }
  const duration: number | undefined = relationship.avgDurationMs;
  if (typeof duration === "number" && duration >= 0) {
    const weighted: number =
      (totals.avgDurationMs || 0) * totals.calls + duration * calls;
    totals.avgDurationMs = weighted / (totals.calls + calls);
  }
  totals.calls += calls;
  totals.errors += Math.max(0, relationship.errorCount || 0);
}

function statusFor(entry: ServiceMapEntry): ServiceMapStatus {
  if (entry.inbound.calls > 0) {
    return entry.health === "critical"
      ? "critical"
      : entry.health === "degraded"
        ? "degraded"
        : "healthy";
  }
  if (entry.dependencies > 0) {
    return "entry";
  }
  if (entry.callers > 0) {
    // Called, but no call reported a count (e.g. a metric-less edge).
    return "healthy";
  }
  return "isolated";
}

/** Build traffic totals before filtering so searching never changes health. */
export function buildServiceMapModel(
  entities: Array<InventoryItem>,
  relationships: Array<InventoryItemRelationship>,
  options: BuildServiceMapOptions = {},
): ServiceMapModel {
  const statuses: Map<string, ServiceOperationalStatus> =
    options.statuses || new Map<string, ServiceOperationalStatus>();
  const isActive: (entity: InventoryItem) => boolean = (
    entity: InventoryItem,
  ): boolean => {
    return (
      options.includeInactive === true ||
      !options.rangeStart ||
      isEntityActive(entity, options.rangeStart)
    );
  };

  const entityByKey: Map<string, InventoryItem> = new Map<
    string,
    InventoryItem
  >();
  for (const entity of entities) {
    if (entity.entityKey) {
      entityByKey.set(entity.entityKey, entity);
    }
  }

  const entryByKey: Map<string, ServiceMapEntry> = new Map<
    string,
    ServiceMapEntry
  >();
  let inactiveServiceCount: number = 0;

  const ensureEntry: (entity: InventoryItem) => ServiceMapEntry = (
    entity: InventoryItem,
  ): ServiceMapEntry => {
    const key: string = entity.entityKey!;
    const existing: ServiceMapEntry | undefined = entryByKey.get(key);
    if (existing) {
      return existing;
    }
    const kind: ServiceMapNodeKind = kindForEntityType(entity.entityType);
    const label: string =
      entity.displayName ||
      (kind === "service" ? "Unnamed service" : "Unnamed dependency");
    const status: ServiceOperationalStatus | undefined =
      kind === "service" ? statuses.get(label.toLowerCase()) : undefined;
    const entry: ServiceMapEntry = {
      entity,
      key,
      label,
      kind,
      typeLabel: metaForEntityType(entity.entityType).label,
      detailLabel: detailLabelForEntity(entity),
      inbound: emptyTotals(),
      outbound: emptyTotals(),
      callers: 0,
      dependencies: 0,
      health: "unknown",
      status: "isolated",
      incidentCount: status?.activeIncidentCount || 0,
      incidentColor: status?.worstIncidentSeverityColor || null,
      alertCount: status?.activeAlertCount || 0,
      alertColor: status?.worstAlertSeverityColor || null,
      needsAttention: false,
      runsOn: [],
    };
    entryByKey.set(key, entry);
    return entry;
  };

  for (const entity of entities) {
    if (entity.entityType !== EntityType.Service || !entity.entityKey) {
      continue;
    }
    if (!isActive(entity)) {
      inactiveServiceCount++;
      continue;
    }
    ensureEntry(entity);
  }

  const edges: Array<ServiceMapEdge> = [];
  const validRelationships: Array<InventoryItemRelationship> = [];
  const seenEdges: Set<string> = new Set<string>();

  for (const relationship of relationships) {
    if (relationship.relationshipType !== EntityRelationshipType.DependsOn) {
      continue;
    }
    const fromKey: string = relationship.fromEntityKey || "";
    const toKey: string = relationship.toEntityKey || "";
    const id: string = `${fromKey}->${toKey}`;
    if (!fromKey || !toKey || fromKey === toKey || seenEdges.has(id)) {
      continue;
    }
    const from: ServiceMapEntry | undefined = entryByKey.get(fromKey);
    const toEntity: InventoryItem | undefined = entityByKey.get(toKey);
    /*
     * Callers are always services on this map. A callee can be a service
     * or anything a service calls — but a callee that is itself a service
     * must be an active one, or the edge would resurrect it.
     */
    if (!from || !toEntity) {
      continue;
    }
    if (toEntity.entityType === EntityType.Service && !entryByKey.has(toKey)) {
      continue;
    }
    const to: ServiceMapEntry = ensureEntry(toEntity);
    seenEdges.add(id);
    validRelationships.push(relationship);

    from.dependencies++;
    to.callers++;
    addTraffic(from.outbound, relationship);
    addTraffic(to.inbound, relationship);

    edges.push({
      id,
      from: fromKey,
      to: toKey,
      relationship,
      calls: Math.max(0, relationship.callCount || 0),
      errors: Math.max(0, relationship.errorCount || 0),
      avgDurationMs:
        typeof relationship.avgDurationMs === "number"
          ? relationship.avgDurationMs
          : null,
      health: healthForErrorRate(
        relationship.callCount,
        relationship.errorCount,
        SERVICE_MAP_TOLERATED_ERROR_RATE,
      ),
    });
  }

  for (const relationship of relationships) {
    if (!RUNS_ON_RELATIONSHIPS.has(relationship.relationshipType || "")) {
      continue;
    }
    const service: ServiceMapEntry | undefined = entryByKey.get(
      relationship.fromEntityKey || "",
    );
    const target: InventoryItem | undefined = entityByKey.get(
      relationship.toEntityKey || "",
    );
    if (
      !service ||
      service.kind !== "service" ||
      !target ||
      !isActive(target) ||
      service.runsOn.includes(target.entityKey!)
    ) {
      continue;
    }
    service.runsOn.push(target.entityKey!);
  }

  for (const entry of entryByKey.values()) {
    entry.health = healthForErrorRate(
      entry.inbound.calls,
      entry.inbound.errors,
      SERVICE_MAP_TOLERATED_ERROR_RATE,
    );
    entry.status = statusFor(entry);
    entry.needsAttention =
      entry.incidentCount > 0 ||
      entry.alertCount > 0 ||
      entry.status === "degraded" ||
      entry.status === "critical";
  }

  const kindOrder: Record<ServiceMapNodeKind, number> = {
    service: 0,
    database: 1,
    remote: 2,
    external: 3,
  };
  const entries: Array<ServiceMapEntry> = Array.from(entryByKey.values()).sort(
    (a: ServiceMapEntry, b: ServiceMapEntry): number => {
      return (
        Number(b.needsAttention) - Number(a.needsAttention) ||
        Number(b.incidentCount > 0) - Number(a.incidentCount > 0) ||
        Number(b.status === "critical") - Number(a.status === "critical") ||
        Number(b.alertCount > 0) - Number(a.alertCount > 0) ||
        Number(b.status === "degraded") - Number(a.status === "degraded") ||
        kindOrder[a.kind] - kindOrder[b.kind] ||
        a.label.localeCompare(b.label) ||
        a.key.localeCompare(b.key)
      );
    },
  );

  return {
    entries,
    entryByKey,
    edges,
    relationships: validRelationships,
    inactiveServiceCount,
  };
}

/** Search keeps only matching nodes and their immediate dependency context. */
export function resolveServiceMapVisibility(options: {
  model: ServiceMapModel;
  search: string;
  focusKey: string | null;
  attentionOnly: boolean;
}): ServiceMapVisibility {
  const { model } = options;
  const effectiveFocusKey: string | null =
    options.focusKey && model.entryByKey.has(options.focusKey)
      ? options.focusKey
      : null;
  const neighbors: Map<string, Set<string>> = new Map<string, Set<string>>();
  for (const edge of model.edges) {
    for (const [a, b] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as Array<[string, string]>) {
      const set: Set<string> = neighbors.get(a) || new Set<string>();
      set.add(b);
      neighbors.set(a, set);
    }
  }
  const scope: Set<string> = effectiveFocusKey
    ? new Set<string>([
        effectiveFocusKey,
        ...(neighbors.get(effectiveFocusKey) || []),
      ])
    : new Set<string>(model.entryByKey.keys());
  const terms: Array<string> = options.search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const matchedKeys: Set<string> = new Set<string>();
  for (const entry of model.entries) {
    const searchable: string =
      `${entry.label} ${entry.typeLabel} ${entry.detailLabel || ""} ${entry.key}`.toLowerCase();
    if (
      scope.has(entry.key) &&
      (!options.attentionOnly || entry.needsAttention) &&
      terms.every((term: string): boolean => {
        return searchable.includes(term);
      })
    ) {
      matchedKeys.add(entry.key);
    }
  }
  const contextKeys: Set<string> = new Set<string>();
  const filtering: boolean = terms.length > 0 || options.attentionOnly;
  if (filtering || effectiveFocusKey) {
    for (const key of matchedKeys) {
      for (const neighbor of neighbors.get(key) || []) {
        if (scope.has(neighbor) && !matchedKeys.has(neighbor)) {
          contextKeys.add(neighbor);
        }
      }
    }
  }
  return {
    matchedKeys,
    contextKeys,
    visibleKeys: new Set<string>([...matchedKeys, ...contextKeys]),
    effectiveFocusKey,
  };
}

export interface ServiceMapLayout {
  positions: Map<string, LayoutPoint>;
  /** Visible nodes with no visible connection — listed, not drawn. */
  unconnectedKeys: Array<string>;
}

/**
 * Left-to-right dependency layout: callers on the left, what they call to
 * their right, so a request reads the way it travels. Nodes without a
 * visible connection are returned separately — a grid of disconnected cards
 * on a canvas reads as a broken map, not as information.
 */
export function layoutServiceMap(options: {
  visibleKeys: Set<string>;
  edges: Array<ServiceMapEdge>;
  columnGap: number;
  rowGap: number;
}): ServiceMapLayout {
  const visibleEdges: Array<ServiceMapEdge> = options.edges.filter(
    (edge: ServiceMapEdge): boolean => {
      return (
        options.visibleKeys.has(edge.from) && options.visibleKeys.has(edge.to)
      );
    },
  );
  const connected: Set<string> = new Set<string>();
  for (const edge of visibleEdges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const layered: Map<string, LayoutPoint> = computeLayeredLayout(
    Array.from(connected),
    visibleEdges.map((edge: ServiceMapEdge) => {
      return { from: edge.from, to: edge.to };
    }),
    { xGap: options.rowGap, yGap: options.columnGap },
  );
  const positions: Map<string, LayoutPoint> = new Map<string, LayoutPoint>();
  for (const [key, point] of layered) {
    positions.set(key, { x: point.y, y: point.x });
  }
  return {
    positions,
    unconnectedKeys: Array.from(options.visibleKeys)
      .filter((key: string): boolean => {
        return !connected.has(key);
      })
      .sort(),
  };
}

/** "12 pods · 3 hosts" for the infrastructure a service runs on. */
export function summarizeRunsOn(
  keys: Array<string>,
  entityByKey: Map<string, InventoryItem>,
): string | null {
  if (keys.length === 0) {
    return null;
  }
  const counts: Map<string, number> = new Map<string, number>();
  for (const key of keys) {
    const type: string = entityByKey.get(key)?.entityType || "unknown";
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([type, count]: [string, number]): string => {
      return `${count} ${nounForType(type, count)}`;
    })
    .join(" · ");
}

const SHORT_NOUNS: Record<string, [string, string]> = {
  [EntityType.KubernetesPod]: ["pod", "pods"],
  [EntityType.KubernetesDeployment]: ["deployment", "deployments"],
  [EntityType.KubernetesNamespace]: ["namespace", "namespaces"],
  [EntityType.KubernetesCluster]: ["cluster", "clusters"],
  [EntityType.NetworkDevice]: ["device", "devices"],
  [EntityType.DockerSwarmTask]: ["task", "tasks"],
  [EntityType.DockerSwarmService]: ["swarm service", "swarm services"],
  [EntityType.DockerSwarmNode]: ["swarm node", "swarm nodes"],
  [EntityType.ProxmoxNode]: ["Proxmox node", "Proxmox nodes"],
  [EntityType.VMwareHost]: ["ESXi host", "ESXi hosts"],
  [EntityType.VMwareDatastore]: ["datastore", "datastores"],
  [EntityType.CloudResource]: ["cloud resource", "cloud resources"],
  [EntityType.IoTDevice]: ["IoT device", "IoT devices"],
  [EntityType.Host]: ["host", "hosts"],
  [EntityType.Container]: ["container", "containers"],
  [EntityType.KubernetesNode]: ["node", "nodes"],
  [EntityType.DockerHost]: ["Docker host", "Docker hosts"],
  [EntityType.PodmanHost]: ["Podman host", "Podman hosts"],
  [EntityType.ProxmoxGuest]: ["guest", "guests"],
  [EntityType.VMwareVirtualMachine]: ["VM", "VMs"],
};

export function nounForType(type: string, count: number): string {
  const nouns: [string, string] | undefined = SHORT_NOUNS[type];
  if (nouns) {
    return count === 1 ? nouns[0] : nouns[1];
  }
  const label: string = metaForEntityType(type).label.toLowerCase();
  return count === 1 ? label : `${label}s`;
}
