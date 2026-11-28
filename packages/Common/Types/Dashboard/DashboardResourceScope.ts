import IsNull from "../BaseDatabase/IsNull";
import NotNull from "../BaseDatabase/NotNull";
import { NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS } from "../../Utils/Telemetry/HostResource";

/*
 * THE KIND OF RESOURCE A DASHBOARD VARIABLE PICKS AMONG (issue #11258).
 *
 * A template dashboard - Kubernetes, Hosts, Docker Swarm, Proxmox, VMware,
 * XCP-ng, OpenStack, Ceph, storage arrays - is about one kind of resource, and
 * picks one of them with its variable: the Cluster, the Host, the vCenter.
 * Before this, the variable was its only scope, and "All" removed it: until a
 * value was picked, every widget read the whole project. A Docker Swarm
 * dashboard in a project with no swarm drew the Docker Agent's containers and
 * every log there is; Kubernetes' Cluster Logs showed Docker's logs; the Hosts
 * tiles averaged in the Kubernetes nodes' `system.*` metrics.
 *
 * A variable that names its kind here reads it as "which of these": "All" is
 * all of them - every Kubernetes cluster, every host - and a pick narrows to
 * those it names, never past the kind. Every widget the variable applies to
 * reads only the kind's telemetry (DashboardVariableInterpolation), its
 * picker offers only the kind's names, and a project with none of them says
 * so instead of drawing other resources' data.
 *
 * The kind is told by its telemetry's resource attributes, stored on every
 * row under `resource.`: the identity each agent stamps on everything it
 * sends (`k8s.cluster.name`, `docker.swarm.cluster.name`, ...). A host's is
 * `host.name`, which much else carries too, so a host's telemetry is also
 * told by what it lacks: Kubernetes, a container engine, a container or an
 * application's SDK (Utils/Telemetry/HostResource, the same rule the ingest
 * registers a Host by, #11257).
 *
 * Named, not stored as filters, so a dashboard keeps reading its kind as the
 * rule is refined, with no migration of its config.
 */
export enum DashboardResourceScope {
  KubernetesCluster = "KubernetesCluster",
  Host = "Host",
  DockerSwarmCluster = "DockerSwarmCluster",
  ProxmoxCluster = "ProxmoxCluster",
  OpenStackCloud = "OpenStackCloud",
  VMwareVCenter = "VMwareVCenter",
  XcpNgPool = "XcpNgPool",
  CephCluster = "CephCluster",
  StorageArray = "StorageArray",
}

interface DashboardResourceScopeDefinition {
  /*
   * The resource attribute every telemetry row of the kind carries, as
   * stored (`resource.<key>`): the kind's own identity.
   */
  identityAttributeKey: string;
  /*
   * Resource attributes, as stored, whose value rules a row out of the kind
   * although it carries the identity.
   */
  excludedAttributeKeys: ReadonlyArray<string>;
}

function stored(resourceAttributeKey: string): string {
  return `resource.${resourceAttributeKey}`;
}

const DEFINITIONS: Record<
  DashboardResourceScope,
  DashboardResourceScopeDefinition
> = {
  // The Kubernetes agent stamps the cluster's name on everything it sends.
  [DashboardResourceScope.KubernetesCluster]: {
    identityAttributeKey: stored("k8s.cluster.name"),
    excludedAttributeKeys: [],
  },
  [DashboardResourceScope.Host]: {
    identityAttributeKey: stored("host.name"),
    excludedAttributeKeys: NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS.map(stored),
  },
  [DashboardResourceScope.DockerSwarmCluster]: {
    identityAttributeKey: stored("docker.swarm.cluster.name"),
    excludedAttributeKeys: [],
  },
  /*
   * The Proxmox agent stamps it, and PVE 9's own OTLP push has it filled in
   * at ingest from PVE's `proxmox.cluster` (ProxmoxNativePush).
   */
  [DashboardResourceScope.ProxmoxCluster]: {
    identityAttributeKey: stored("proxmox.cluster.name"),
    excludedAttributeKeys: [],
  },
  // The agent's, and what a probe collects (OpenStackProbeMetrics).
  [DashboardResourceScope.OpenStackCloud]: {
    identityAttributeKey: stored("openstack.cloud.name"),
    excludedAttributeKeys: [],
  },
  // The agent's, and what a probe collects (VMwareProbeMetrics).
  [DashboardResourceScope.VMwareVCenter]: {
    identityAttributeKey: stored("vmware.vcenter.name"),
    excludedAttributeKeys: [],
  },
  /*
   * A pool is its XAPI UUID: the agent drops whatever has none, and a pool
   * Xen Orchestra names nothing has no `xcp_ng.pool.name` at all.
   */
  [DashboardResourceScope.XcpNgPool]: {
    identityAttributeKey: stored("xcp_ng.pool.id"),
    excludedAttributeKeys: [],
  },
  [DashboardResourceScope.CephCluster]: {
    identityAttributeKey: stored("ceph.cluster.name"),
    excludedAttributeKeys: [],
  },
  [DashboardResourceScope.StorageArray]: {
    identityAttributeKey: stored("storage.array.name"),
    excludedAttributeKeys: [],
  },
};

export const DASHBOARD_RESOURCE_SCOPES: ReadonlyArray<DashboardResourceScope> =
  Object.values(DashboardResourceScope);

export function isDashboardResourceScope(
  value: unknown,
): value is DashboardResourceScope {
  return (
    typeof value === "string" &&
    (DASHBOARD_RESOURCE_SCOPES as ReadonlyArray<string>).includes(value)
  );
}

// The stored attribute the kind's resources are named by.
export function getDashboardResourceScopeIdentityKey(
  scope: DashboardResourceScope,
): string {
  return DEFINITIONS[scope].identityAttributeKey;
}

/*
 * The attribute filter that keeps a query to the kind's telemetry, in the
 * shape every widget's attribute filter takes: the identity "is not empty"
 * (NotNull) and each excluding attribute "is empty" (IsNull). The same on a
 * metric chart, a log stream, a trace chart and the variable's own picker,
 * on a signed-in board and a public one. Fresh operators each call, so a
 * caller may keep or change what it is given.
 */
export function getDashboardResourceScopeAttributes(
  scope: DashboardResourceScope,
): Record<string, IsNull | NotNull> {
  const definition: DashboardResourceScopeDefinition = DEFINITIONS[scope];
  const attributes: Record<string, IsNull | NotNull> = {
    [definition.identityAttributeKey]: new NotNull(),
  };

  for (const key of definition.excludedAttributeKeys) {
    attributes[key] = new IsNull();
  }

  return attributes;
}
