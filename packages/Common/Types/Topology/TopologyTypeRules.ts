import EntityRelationshipType from "../Telemetry/EntityRelationshipType";
import EntityType from "../Telemetry/EntityType";

/*
 * The rules that shape the Topology maps, shared by the server (which reduces
 * the inventory graph in SQL) and the Dashboard (which builds the maps from
 * the reduced data). Keeping them in one place is what lets the server hand
 * the browser a few rows per resource instead of every relationship and still
 * produce exactly the tree the Dashboard would have built from all of them.
 */

/*
 * Types the Service Map owns. They describe software and its dependencies,
 * not where anything runs, so they never become Infrastructure rows.
 */
export const TOPOLOGY_APPLICATION_TYPES: ReadonlySet<string> = new Set<string>([
  EntityType.Service,
  EntityType.ServiceInstance,
  EntityType.TelemetrySdk,
  EntityType.Database,
  EntityType.RemoteService,
  EntityType.Process,
]);

/** Types that may nest inside a structural container. */
export const NESTABLE_CHILD_TYPES: Set<EntityType> = new Set<EntityType>([
  EntityType.Container,
  EntityType.Process,
  EntityType.KubernetesPod,
  EntityType.KubernetesNode,
  EntityType.KubernetesNamespace,
  EntityType.KubernetesDeployment,
  EntityType.ProxmoxNode,
  EntityType.ProxmoxGuest,
  EntityType.VMwareCluster,
  EntityType.VMwareHost,
  EntityType.VMwareVirtualMachine,
  EntityType.VMwareDatastore,
  EntityType.DockerSwarmNode,
  EntityType.DockerSwarmService,
  EntityType.DockerSwarmTask,
]);

/*
 * Valid structural containers, higher = more specific. Doubles as the
 * allow-list of parent types: a candidate whose parent type is absent here
 * (e.g. a Service) is rejected before priority is compared.
 */
export const CONTAINER_SPECIFICITY: Partial<Record<EntityType, number>> = {
  [EntityType.KubernetesCluster]: 0,
  [EntityType.ProxmoxCluster]: 0,
  /*
   * vSphere nests vCenter ⊃ cluster ⊃ ESXi host ⊃ VM; datastores sit
   * directly under the vCenter. The cluster is optional (standalone hosts
   * hang straight off the vCenter), so the host is more specific than the
   * cluster but both may parent directly to the vCenter.
   */
  [EntityType.VMwareVCenter]: 0,
  [EntityType.VMwareCluster]: 1,
  [EntityType.CephCluster]: 0,
  [EntityType.DockerSwarmCluster]: 0,
  [EntityType.Host]: 1,
  [EntityType.KubernetesNamespace]: 1,
  [EntityType.KubernetesNode]: 2,
  [EntityType.KubernetesDeployment]: 2,
  [EntityType.ProxmoxNode]: 2,
  [EntityType.VMwareHost]: 2,
  [EntityType.DockerSwarmNode]: 2,
  [EntityType.KubernetesPod]: 3,
  [EntityType.ProxmoxGuest]: 3,
  [EntityType.VMwareVirtualMachine]: 3,
  [EntityType.DockerSwarmTask]: 3,
  [EntityType.Container]: 4,
};

/* Which relationship expresses containment best: part-of > runs-on > member-of. */
export const NESTING_RELATIONSHIP_PRIORITY: Partial<
  Record<EntityRelationshipType, number>
> = {
  [EntityRelationshipType.PartOf]: 3,
  [EntityRelationshipType.RunsOn]: 2,
  [EntityRelationshipType.MemberOf]: 1,
};

/* Replicas worth collapsing: leaf resources that come in fleets. */
export const REPLICA_GROUPABLE_TYPES: ReadonlySet<string> = new Set<string>([
  EntityType.Host,
  EntityType.KubernetesPod,
  EntityType.Container,
  EntityType.DockerSwarmTask,
  EntityType.ProxmoxGuest,
  EntityType.VMwareVirtualMachine,
]);

/* service → where it runs (service→host is hosted-on, service→pod runs-on). */
export const PLACEMENT_RELATIONSHIP_TYPES: ReadonlySet<string> =
  new Set<string>([
    EntityRelationshipType.RunsOn,
    EntityRelationshipType.HostedOn,
  ]);

/*
 * The attributes the Service Map reads to label a node ("Node.js",
 * "PostgreSQL"), in the order it tries them. The server ships only these, so
 * the list lives here rather than beside the reader.
 */
export const SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "telemetry.sdk.language",
  "db.system.name",
  "network.protocol.name",
  "messaging.system",
];

export function isTopologyInfrastructureType(
  entityType: string | undefined | null,
): boolean {
  return (
    Boolean(entityType) &&
    entityType !== EntityType.Service &&
    !TOPOLOGY_APPLICATION_TYPES.has(entityType!)
  );
}

/*
 * Structural infrastructure types can take part in the tree: they nest, hold
 * other resources, or are grouped with their replicas. Everything else that is
 * infrastructure (network devices, IoT devices, cloud resources, manually
 * registered appliances, types this version does not know) is flat: it never
 * has a parent, never contains anything, and nothing groups it. Flat types are
 * also the ones whose volume is not bounded by the discovery budgets, so the
 * server summarizes a large flat type instead of shipping every row.
 */
export function isStructuralInfrastructureType(
  entityType: string | undefined | null,
): boolean {
  if (!isTopologyInfrastructureType(entityType)) {
    return false;
  }
  const type: EntityType = entityType as EntityType;
  return (
    NESTABLE_CHILD_TYPES.has(type) ||
    CONTAINER_SPECIFICITY[type] !== undefined ||
    REPLICA_GROUPABLE_TYPES.has(type)
  );
}

export function isFlatInfrastructureType(
  entityType: string | undefined | null,
): boolean {
  return (
    isTopologyInfrastructureType(entityType) &&
    !isStructuralInfrastructureType(entityType)
  );
}
