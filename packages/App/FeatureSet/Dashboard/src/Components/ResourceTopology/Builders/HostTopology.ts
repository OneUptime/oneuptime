import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import { isEntityActive } from "../../Topology/TopologyActivity";
import {
  InfrastructureData,
  ServiceMapData,
  TopologyEntity,
  TopologyRelationship,
} from "../../Topology/TopologyData";
import {
  SERVICE_MAP_TOLERATED_ERROR_RATE,
  TrafficHealth,
  formatCallRate,
  formatErrorRate,
  healthForErrorRate,
} from "../../Topology/TopologyMeta";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyIssue,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  ResourceTopologyText,
  buildResourceTopologyGraph,
} from "../ResourceTopologyModel";
import { entityKind } from "../ResourceTopologyKinds";
import {
  OpenIssueRecord,
  attachOpenIssues,
  readSeriesLabel,
  sameName,
} from "../ResourceTopologyIssues";
import { isRecent } from "../ResourceTopologyFormat";

/*
 * A host's topology: what runs on it, and what that talks to.
 *
 * A host has no inventory of parts of its own the way a vCenter or a
 * cluster has; what is on it is what reports from it. So this reads the
 * master Topology's own data, over the same past day: the containers and
 * other resources the infrastructure map nests under the host, the services
 * placed on any of them, and — from the service map — every call those
 * services make or receive. The host's box holds what runs on it; "Talks
 * to" holds the services, databases and endpoints its services call, and
 * "Called by" the services that call them, each named with where it runs.
 * A line joins a service to each one it calls.
 *
 * A service's health is its calls': an error rate above 5% is critical,
 * above the 1% the service map tolerates needs attention — the service map's
 * own rule, so a service reads the same on both maps.
 */

export const HOST_ROOT_ID: string = "host";
export const HOST_CALLS_SECTION_ID: string = "section:calls";
export const HOST_CALLERS_SECTION_ID: string = "section:callers";

/* The host agent reports every minute; this long without it is "Not reporting". */
export const HOST_STALE_MS: number = 15 * 60 * 1000;

/* The window the service map's traffic figures cover (see TopologyPage). */
export const HOST_METRICS_WINDOW_SECONDS: number = 15 * 60;

export interface HostTopologyHost {
  id: string;
  name: string;
  lastSeenAt?: Date | null | undefined;
}

export interface HostTopologyInput {
  host: HostTopologyHost;
  /* The host's key in the entity inventory (keyForHost). */
  hostEntityKey: string;
  infrastructure: InfrastructureData | null;
  serviceMap: ServiceMapData | null;
  /* Service entity key -> the Service row's id, for links to its page. */
  serviceIds?: Map<string, string> | undefined;
  /* Open incidents and alerts of the host, and of the services on it. */
  issues?: Array<OpenIssueRecord> | undefined;
  serviceIssues?: Map<string, Array<ResourceTopologyIssue>> | undefined;
  now: Date;
}

const CONTAINMENT: ReadonlySet<string> = new Set<string>([
  EntityRelationshipType.RunsOn,
  EntityRelationshipType.PartOf,
  EntityRelationshipType.MemberOf,
  EntityRelationshipType.HostedOn,
]);

function text(
  value: string,
  values?: Record<string, string> | undefined,
): ResourceTopologyText {
  return values ? { text: value, values: values } : { text: value };
}

function healthOfTraffic(traffic: TrafficHealth): ResourceTopologyHealth {
  switch (traffic) {
    case "critical":
      return "critical";
    case "degraded":
      return "warning";
    case "healthy":
      return "healthy";
    default:
      return "healthy";
  }
}

interface Traffic {
  calls: number;
  errors: number;
}

function addTraffic(
  map: Map<string, Traffic>,
  key: string,
  edge: TopologyRelationship,
): void {
  const current: Traffic = map.get(key) || { calls: 0, errors: 0 };
  current.calls += edge.callCount || 0;
  current.errors += edge.errorCount || 0;
  map.set(key, current);
}

function trafficFacts(traffic: Traffic | undefined): Array<ResourceTopologyFact> {
  if (!traffic || traffic.calls <= 0) {
    return [];
  }

  return [
    {
      label: translationKey("Requests"),
      value: formatCallRate(traffic.calls, HOST_METRICS_WINDOW_SECONDS),
    },
    {
      label: translationKey("Errors"),
      value: formatErrorRate(traffic.calls, traffic.errors),
    },
  ];
}

export function buildHostTopology(
  input: HostTopologyInput,
): ResourceTopologyGraph {
  const nodes: Array<ResourceTopologyNodeInput> = [];
  const reporting: boolean = isRecent(
    input.host.lastSeenAt,
    input.now,
    HOST_STALE_MS,
  );

  nodes.push({
    id: HOST_ROOT_ID,
    parentId: null,
    kind: entityKind(EntityType.Host),
    name: input.host.name || "Host",
    health: reporting ? "healthy" : input.host.lastSeenAt ? "warning" : "unknown",
    status: reporting
      ? text(translationKey("Reporting"))
      : input.host.lastSeenAt
        ? text(translationKey("Not reporting"))
        : text(translationKey("No data yet")),
    reasons:
      !reporting && input.host.lastSeenAt
        ? [
            text(
              translationKey(
                "Nothing has arrived from this host's agent for more than 15 minutes.",
              ),
            ),
          ]
        : [],
    link: { page: PageMap.HOST_VIEW, modelId: input.host.id },
  });

  const infrastructure: InfrastructureData | null = input.infrastructure;
  const entityByKey: Map<string, TopologyEntity> = new Map<
    string,
    TopologyEntity
  >();

  for (const entity of [
    ...(infrastructure?.entities || []),
    ...(input.serviceMap?.entities || []),
  ]) {
    if (entity.entityKey && !entityByKey.has(entity.entityKey)) {
      entityByKey.set(entity.entityKey, entity);
    }
  }

  const rangeStart: Date =
    infrastructure?.rangeStart ||
    input.serviceMap?.rangeStart ||
    new Date(input.now.getTime() - 24 * 60 * 60 * 1000);

  // What is inside the host: containment edges point from child to parent.
  const childrenOf: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const placementsOf: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  for (const edge of infrastructure?.relationships || []) {
    if (!edge.fromEntityKey || !edge.toEntityKey) {
      continue;
    }

    const from: TopologyEntity | undefined = entityByKey.get(edge.fromEntityKey);

    if (from?.entityType === EntityType.Service) {
      if (edge.relationshipType === EntityRelationshipType.RunsOn ||
        edge.relationshipType === EntityRelationshipType.HostedOn) {
        placementsOf.set(edge.toEntityKey, [
          ...(placementsOf.get(edge.toEntityKey) || []),
          edge.fromEntityKey,
        ]);
      }
      continue;
    }

    if (CONTAINMENT.has(edge.relationshipType || "")) {
      childrenOf.set(edge.toEntityKey, [
        ...(childrenOf.get(edge.toEntityKey) || []),
        edge.fromEntityKey,
      ]);
    }
  }

  const insideHost: Map<string, string> = new Map<string, string>();
  const nodeIdFor: (entityKey: string) => string = (
    entityKey: string,
  ): string => {
    return entityKey === input.hostEntityKey
      ? HOST_ROOT_ID
      : `entity:${entityKey}`;
  };

  insideHost.set(input.hostEntityKey, HOST_ROOT_ID);
  const queue: Array<string> = [input.hostEntityKey];

  for (let index: number = 0; index < queue.length; index++) {
    const parentKey: string = queue[index]!;

    for (const childKey of childrenOf.get(parentKey) || []) {
      const child: TopologyEntity | undefined = entityByKey.get(childKey);

      if (!child || insideHost.has(childKey)) {
        continue;
      }

      if (!isEntityActive(child, rangeStart)) {
        continue;
      }

      insideHost.set(childKey, nodeIdFor(childKey));
      queue.push(childKey);
      nodes.push({
        id: nodeIdFor(childKey),
        parentId: nodeIdFor(parentKey),
        kind: entityKind(child.entityType || ""),
        name: child.displayName || childKey,
        health: "healthy",
        status: text(translationKey("Reporting")),
      });
    }
  }

  // Services, on the most specific part of the host they run on.
  const serviceHome: Map<string, string> = new Map<string, string>();
  const depthOf: Map<string, number> = new Map<string, number>();

  queue.forEach((key: string, index: number) => {
    depthOf.set(key, index);
  });

  for (const [resourceKey, serviceKeys] of placementsOf) {
    if (!insideHost.has(resourceKey)) {
      continue;
    }

    for (const serviceKey of serviceKeys) {
      const current: string | undefined = serviceHome.get(serviceKey);

      if (
        !current ||
        (depthOf.get(resourceKey) || 0) > (depthOf.get(current) || 0)
      ) {
        serviceHome.set(serviceKey, resourceKey);
      }
    }
  }

  // Calls each service on the host makes and receives.
  const received: Map<string, Traffic> = new Map<string, Traffic>();
  const outsideCalls: Map<string, Traffic> = new Map<string, Traffic>();
  const callers: Set<string> = new Set<string>();
  const callees: Set<string> = new Set<string>();
  const relations: Array<ResourceTopologyRelation> = [];
  const dependencies: Array<TopologyRelationship> = (
    input.serviceMap?.relationships || []
  ).filter((edge: TopologyRelationship): boolean => {
    return (
      edge.relationshipType === EntityRelationshipType.DependsOn &&
      Boolean(edge.fromEntityKey && edge.toEntityKey) &&
      edge.fromEntityKey !== edge.toEntityKey
    );
  });

  for (const edge of dependencies) {
    const from: string = edge.fromEntityKey!;
    const to: string = edge.toEntityKey!;
    const fromHere: boolean = serviceHome.has(from);
    const toHere: boolean = serviceHome.has(to);

    if (!fromHere && !toHere) {
      continue;
    }

    addTraffic(received, to, edge);

    if (fromHere && !toHere) {
      callees.add(to);
      addTraffic(outsideCalls, to, edge);
    }

    if (toHere && !fromHere) {
      callers.add(from);
    }
  }

  // Where a service outside the host runs, to name it under its card.
  const runsOnName: Map<string, string> = new Map<string, string>();

  for (const [resourceKey, serviceKeys] of placementsOf) {
    const name: string | undefined = entityByKey.get(resourceKey)?.displayName;

    for (const serviceKey of serviceKeys) {
      if (name && !runsOnName.has(serviceKey)) {
        runsOnName.set(serviceKey, name);
      }
    }
  }

  const where: (serviceKey: string) => string | undefined = (
    serviceKey: string,
  ): string | undefined => {
    return runsOnName.get(serviceKey);
  };

  const serviceNode: (
    serviceKey: string,
    parentId: string,
    id: string,
    traffic: Traffic | undefined,
    context?: string | undefined,
  ) => ResourceTopologyNodeInput = (
    serviceKey: string,
    parentId: string,
    id: string,
    traffic: Traffic | undefined,
    context?: string | undefined,
  ): ResourceTopologyNodeInput => {
    const entity: TopologyEntity | undefined = entityByKey.get(serviceKey);
    const health: TrafficHealth = traffic
      ? healthForErrorRate(
          traffic.calls,
          traffic.errors,
          SERVICE_MAP_TOLERATED_ERROR_RATE,
        )
      : "unknown";
    const serviceId: string | undefined = input.serviceIds?.get(serviceKey);
    const type: string = entity?.entityType || EntityType.Service;

    return {
      id: id,
      parentId: parentId,
      kind: entityKind(type),
      name: entity?.displayName || serviceKey,
      health: healthOfTraffic(health),
      status:
        health === "critical"
          ? text(translationKey("High error rate"))
          : health === "degraded"
            ? text(translationKey("Some errors"))
            : traffic && traffic.calls > 0
              ? text(translationKey("Healthy"))
              : text(translationKey("No calls observed")),
      reasons:
        health === "critical" || health === "degraded"
          ? [
              text(translationKey("{{rate}} of its calls failed."), {
                rate: formatErrorRate(traffic?.calls, traffic?.errors),
              }),
            ]
          : [],
      facts: trafficFacts(traffic),
      context: context,
      link:
        serviceId && type === EntityType.Service
          ? { page: PageMap.SERVICE_VIEW, modelId: serviceId }
          : null,
    };
  };

  for (const [serviceKey, resourceKey] of serviceHome) {
    nodes.push(
      serviceNode(
        serviceKey,
        insideHost.get(resourceKey) || HOST_ROOT_ID,
        `service:${serviceKey}`,
        received.get(serviceKey),
      ),
    );
  }

  if (callees.size > 0) {
    nodes.push({
      id: HOST_CALLS_SECTION_ID,
      parentId: HOST_ROOT_ID,
      kind: "section",
      isSection: true,
      name: translationKey("Talks to"),
      health: "healthy",
    });

    for (const key of callees) {
      const node: ResourceTopologyNodeInput = serviceNode(
        key,
        HOST_CALLS_SECTION_ID,
        `calls:${key}`,
        outsideCalls.get(key),
        where(key),
      );
      nodes.push(node);
    }
  }

  if (callers.size > 0) {
    nodes.push({
      id: HOST_CALLERS_SECTION_ID,
      parentId: HOST_ROOT_ID,
      kind: "section",
      isSection: true,
      name: translationKey("Called by"),
      health: "healthy",
    });

    for (const key of callers) {
      if (callees.has(key)) {
        continue;
      }

      nodes.push(
        serviceNode(
          key,
          HOST_CALLERS_SECTION_ID,
          `callers:${key}`,
          received.get(key),
          where(key),
        ),
      );
    }
  }

  const drawnId: (serviceKey: string) => string | null = (
    serviceKey: string,
  ): string | null => {
    if (serviceHome.has(serviceKey)) {
      return `service:${serviceKey}`;
    }

    if (callees.has(serviceKey)) {
      return `calls:${serviceKey}`;
    }

    if (callers.has(serviceKey)) {
      return `callers:${serviceKey}`;
    }

    return null;
  };

  for (const edge of dependencies) {
    const from: string | null = drawnId(edge.fromEntityKey!);
    const to: string | null = drawnId(edge.toEntityKey!);

    if (
      from &&
      to &&
      (serviceHome.has(edge.fromEntityKey!) ||
        serviceHome.has(edge.toEntityKey!))
    ) {
      relations.push({
        from: from,
        to: to,
        label: translationKey("Calls"),
        inverseLabel: translationKey("Called by"),
      });
    }
  }

  /*
   * The host's own open incidents and alerts sit on the part their labels
   * name (a service, a container) or on the host; the services' own come
   * keyed by service.
   */
  const issues: Map<string, Array<ResourceTopologyIssue>> = attachOpenIssues({
    records: input.issues || [],
    rootId: HOST_ROOT_ID,
    locate: (record: OpenIssueRecord): string | null => {
      const service: string | null =
        readSeriesLabel(record.seriesLabels, "service.name") ||
        readSeriesLabel(record.seriesLabels, "oneuptime.service.name");

      if (service) {
        for (const serviceKey of serviceHome.keys()) {
          if (sameName(entityByKey.get(serviceKey)?.displayName, service)) {
            return `service:${serviceKey}`;
          }
        }
      }

      const container: string | null = readSeriesLabel(
        record.seriesLabels,
        "container.name",
      );

      if (container) {
        for (const [key, id] of insideHost) {
          if (sameName(entityByKey.get(key)?.displayName, container)) {
            return id;
          }
        }
      }

      return null;
    },
  });

  for (const [serviceKey, list] of input.serviceIssues || []) {
    const id: string | null = drawnId(serviceKey);

    if (!id) {
      continue;
    }

    const known: Set<string> = new Set<string>(
      Array.from(issues.values())
        .flat()
        .map((issue: ResourceTopologyIssue): string => {
          return `${issue.type}:${issue.id}`;
        }),
    );

    issues.set(id, [
      ...(issues.get(id) || []),
      ...list.filter((issue: ResourceTopologyIssue): boolean => {
        return !known.has(`${issue.type}:${issue.id}`);
      }),
    ]);
  }

  return buildResourceTopologyGraph({
    rootId: HOST_ROOT_ID,
    nodes: nodes,
    relations: relations,
    issues: issues,
  });
}
