import AgentVersionUtil, {
  AgentVersionStatus,
} from "Common/Utils/AgentVersionUtil";
import VersionUtil from "Common/Utils/VersionUtil";

/*
 * Which agent reports the version a resource shows, and how OneUptime knows
 * the newest version of that agent.
 *
 * Every page that shows an agent version draws it with the AgentVersion
 * component and names its kind here (App/Tests/Dashboard/
 * AgentVersionDisplayGuard.test.ts holds every page to that). The kind
 * decides whether a sign can ever appear beside the version:
 *
 *   - OneUptimeRelease: the agent is built and released with OneUptime and
 *     reports the OneUptime version it was built from (APP_VERSION baked
 *     into its image, or the Kubernetes agent chart's appVersion, which the
 *     release sets to the same version). The newest is the version this
 *     OneUptime runs.
 *   - PinnedCollector: the agent is the upstream OpenTelemetry Collector
 *     plus OneUptime's config, and reports the version of its files: the
 *     collector release they pin, with the last number raised each time
 *     OneUptime changes the files and not the collector (0.161.1 is the
 *     second set of files on collector 0.161.0). The newest is the version
 *     this release's files report. A change to an agent's files is a new
 *     version of the agent, or an agent running the old files would never
 *     be called outdated: the Docker Swarm agent's CPU fix (#5076) changed
 *     only its config, and no Swarm showed a sign (its follow-up).
 *     AgentFilesVersion.test.ts holds every pinned-collector agent's files
 *     to the version they report.
 *   - None: OneUptime does not release it - the customer's own SDK in their
 *     app, function or devices. Its version is shown as it always was and is
 *     never called outdated.
 *
 * An agent installed before its files reported a version sends none, so its
 * version reads "Not reported" (or nothing) - unknown, never outdated -
 * until it is upgraded to files that report one.
 *
 * Pure on purpose (no React, no API), so the version rules are testable on
 * their own; the AgentVersion component reads the server's version and
 * passes it in.
 */

export enum AgentKind {
  // HelmChart/Public/kubernetes-agent: a cluster, and a Runner it installed.
  KubernetesAgent = "kubernetes-agent",
  // agents/DockerAgent: a Docker host.
  DockerAgent = "docker-agent",
  // agents/PodmanAgent: a Podman host.
  PodmanAgent = "podman-agent",
  // agents/DockerSwarmAgent: a Docker Swarm cluster.
  DockerSwarmAgent = "docker-swarm-agent",
  // agents/DatabaseAgent: a database server.
  DatabaseAgent = "database-agent",
  // packages/Runner, run as oneuptime/runner: a Runner.
  Runner = "runner",
  /*
   * The upstream OpenTelemetry Collector the host guide installs, with the
   * guide's config: a host.
   */
  HostCollector = "host-collector",
  // agents/ProxmoxAgent: a Proxmox cluster.
  ProxmoxAgent = "proxmox-agent",
  // agents/OpenStackAgent: an OpenStack cloud.
  OpenStackAgent = "openstack-agent",
  // agents/CephAgent: a Ceph cluster.
  CephAgent = "ceph-agent",
  // agents/VMwareAgent: a vCenter.
  VMwareAgent = "vmware-agent",
  // agents/StorageArrayAgent: a storage array.
  StorageArrayAgent = "storage-array-agent",
  // The OpenTelemetry SDK or gateway on the customer's devices: an IoT fleet.
  IoTExporter = "iot-exporter",
  // The OpenTelemetry SDK in the customer's function: a serverless function.
  ServerlessSdk = "serverless-sdk",
  // The OpenTelemetry browser or mobile SDK in the customer's app: RUM.
  RumSdk = "rum-sdk",
  /*
   * agents/ResourceAIAgent, run as oneuptime/resource-ai-agent beside a
   * resource's collector: the AI agent of a Docker or Podman host, a Swarm,
   * a Proxmox cluster, a vCenter, a Ceph cluster, a database server or a
   * host (its AI agent page).
   */
  ResourceAiAgent = "resource-ai-agent",
}

export enum AgentLatestVersionSource {
  OneUptimeRelease = "oneuptime-release",
  PinnedCollector = "pinned-collector",
  None = "none",
}

export interface AgentKindDefinition {
  /*
   * What the agent is called, in the upgrade dialog's title. A product
   * name, so it is never translated.
   */
  name: string;
  latestVersionSource: AgentLatestVersionSource;
  /*
   * PinnedCollector only: the version this release's files report - the
   * collector they pin, or a later patch of it after OneUptime changed the
   * files on the same collector.
   */
  pinnedVersion?: string | undefined;
  /*
   * PinnedCollector only: the collector release the files pin - the image
   * their compose file runs. The pinned version has its major and minor
   * number, and a patch number no lower.
   */
  collectorVersion?: string | undefined;
  /*
   * Versions this agent reports before it knows its own, which mean "not
   * reported" rather than "very old".
   */
  placeholderVersions?: Array<string> | undefined;
  /*
   * A Runner is not called an agent: the sign says "A newer Runner is
   * available" (App/Tests/Dashboard/RunnerVersionLabel.test.ts).
   */
  isRunner?: boolean | undefined;
}

/*
 * What a OneUptime agent reports when it was built without a release
 * version: the Kubernetes agent chart's appVersion in Chart.yaml (the
 * release replaces it), and the Runner's fallback for an unset APP_VERSION
 * (packages/Runner/Config.ts) - which is also the version RunnerService
 * stamps on a new Runner row before it ever reports.
 */
export const ONEUPTIME_AGENT_PLACEHOLDER_VERSION: string = "1.0.0";

/*
 * The collector the Docker Swarm agent runs: the image
 * agents/DockerSwarmAgent/docker-compose.yml pins.
 */
export const DOCKER_SWARM_AGENT_COLLECTOR_VERSION: string = "0.161.0";

/*
 * The version the Docker Swarm agent reports: the default of APP_VERSION in
 * agents/DockerSwarmAgent/docker-compose.yml. Not the collector's 0.161.0:
 * its files changed three times on the same collector - 0.161.1, #5076's
 * CPU processors (a Swarm still running the old files reported 0.161.0 with
 * no sign beside it); 0.161.2, each task's service and node on its metrics
 * and the Docker API version negotiated with the daemon; and 0.161.3, every
 * inventory snapshot read again (each used to start with the same bytes, so
 * the collector read a calm swarm's only once), each manager's
 * reachability, each service's rolling update and recent task failures, and
 * the swarm's state as metrics (Node Not Ready, Service Replicas Mismatch).
 * AgentKind.test.ts and AgentFilesVersion.test.ts fail when the agent's
 * files move on without this.
 */
export const DOCKER_SWARM_AGENT_VERSION: string = "0.161.3";

/*
 * The version the Database agent reports: the oneuptime.agent.version every
 * agents/DatabaseAgent/configs/*.yaml stamps - the collector release its
 * docker-compose.yml pins (DATABASE_AGENT_COLLECTOR_VERSION), its last
 * number raised when the files change on the same collector: 0.161.1, the
 * PostgreSQL config's own SQL checks (a restart, transaction ID wraparound,
 * long transactions, lock waits); 0.161.2, the MySQL config's own readings of
 * Galera. So an agent still running the old files reports its older number and
 * is told to upgrade. AgentKind.test.ts and AgentFilesVersion.test.ts fail when
 * the agent's files move on without this.
 */
export const DATABASE_AGENT_VERSION: string = "0.161.2";

// The collector the Database agent runs: the image its docker-compose.yml pins.
export const DATABASE_AGENT_COLLECTOR_VERSION: string = "0.161.0";

/*
 * The collector versions the Proxmox, Ceph, VMware and Storage Array agents
 * report: the oneuptime.agent.version each
 * agents/<Agent>/otel-collector-config.yaml stamps (each of the Storage
 * Array agent's three configs does), kept equal to the collector image its
 * docker-compose.yml pins (and to the Dashboard's embedded copy of that
 * config). AgentKind.test.ts fails when an agent's files move on without
 * its constant.
 */
export const PROXMOX_AGENT_VERSION: string = "0.161.2";

/*
 * The collector the Proxmox agent runs: the image its docker-compose.yml
 * pins. Not PROXMOX_AGENT_VERSION: its files changed on the same collector -
 * 0.161.1, every node's start-on-boot and replication read from the node
 * itself, not from PVE_HOST alone (#5428); 0.161.2, the cluster read from the
 * next node of PVE_NODES whose API answers when PVE_HOST's goes down
 * (#6844) - so an agent still running older files reports what it reported
 * and is told to upgrade.
 */
export const PROXMOX_AGENT_COLLECTOR_VERSION: string = "0.161.0";
/*
 * The version the OpenStack agent reports. Its files changed on the same collector -
 * 0.161.1, real per-instance usage read from libvirt or Ceilometer when asked; 0.161.2,
 * load balancers, bare metal, stacks, clusters, shares, DNS, object storage, databases
 * and Gnocchi read where a cloud runs them; 0.161.3, what says Open vSwitch and
 * ovn-controller are running, each RabbitMQ queue, and Geneve's interfaces and no others -
 * so an agent still running the old files reports what it reported and is told to upgrade.
 */
export const OPENSTACK_AGENT_VERSION: string = "0.161.4";
// The collector the OpenStack agent runs: the image its docker-compose.yml pins.
export const OPENSTACK_AGENT_COLLECTOR_VERSION: string = "0.161.0";
export const CEPH_AGENT_VERSION: string = "0.161.0";
export const VMWARE_AGENT_VERSION: string = "0.161.0";
export const STORAGE_ARRAY_AGENT_VERSION: string = "0.161.0";

/*
 * The otelcol-contrib release the host guide installs (every install method:
 * the Docker image tag, the package and archive VERSION, the Windows
 * $version) and the oneuptime.agent.version its config.yaml stamps. The
 * guide reads it from here, so the two cannot drift
 * (Pages/Host/Utils/DocumentationMarkdown.ts).
 */
export const HOST_COLLECTOR_VERSION: string = "0.161.0";

export const AGENT_KINDS: Record<AgentKind, AgentKindDefinition> = {
  [AgentKind.KubernetesAgent]: {
    name: "OneUptime Kubernetes Agent",
    latestVersionSource: AgentLatestVersionSource.OneUptimeRelease,
    placeholderVersions: [ONEUPTIME_AGENT_PLACEHOLDER_VERSION],
  },
  [AgentKind.DockerAgent]: {
    name: "OneUptime Docker Agent",
    latestVersionSource: AgentLatestVersionSource.OneUptimeRelease,
  },
  [AgentKind.PodmanAgent]: {
    name: "OneUptime Podman Agent",
    latestVersionSource: AgentLatestVersionSource.OneUptimeRelease,
  },
  [AgentKind.DockerSwarmAgent]: {
    name: "OneUptime Docker Swarm Agent",
    latestVersionSource: AgentLatestVersionSource.PinnedCollector,
    pinnedVersion: DOCKER_SWARM_AGENT_VERSION,
    collectorVersion: DOCKER_SWARM_AGENT_COLLECTOR_VERSION,
  },
  [AgentKind.DatabaseAgent]: {
    name: "OneUptime Database Agent",
    latestVersionSource: AgentLatestVersionSource.PinnedCollector,
    pinnedVersion: DATABASE_AGENT_VERSION,
    collectorVersion: DATABASE_AGENT_COLLECTOR_VERSION,
  },
  [AgentKind.Runner]: {
    name: "Runner",
    latestVersionSource: AgentLatestVersionSource.OneUptimeRelease,
    placeholderVersions: [ONEUPTIME_AGENT_PLACEHOLDER_VERSION],
    isRunner: true,
  },
  /*
   * The host guide installs the collector release it pins, with a config
   * that stamps the same version: a host set up from the guide reports it.
   * A collector someone configured themselves reports nothing, and stays
   * unknown.
   */
  [AgentKind.HostCollector]: {
    name: "OpenTelemetry Collector",
    latestVersionSource: AgentLatestVersionSource.PinnedCollector,
    pinnedVersion: HOST_COLLECTOR_VERSION,
    collectorVersion: HOST_COLLECTOR_VERSION,
  },
  /*
   * The Proxmox, Ceph, VMware and Storage Array agents run the collector
   * their compose file pins, and their config stamps that pin. A Proxmox
   * cluster that pushes its own metrics (Proxmox VE 9's metric server) runs
   * no agent and reports no version.
   */
  [AgentKind.ProxmoxAgent]: {
    name: "OneUptime Proxmox Agent",
    latestVersionSource: AgentLatestVersionSource.PinnedCollector,
    pinnedVersion: PROXMOX_AGENT_VERSION,
    collectorVersion: PROXMOX_AGENT_COLLECTOR_VERSION,
  },
  [AgentKind.OpenStackAgent]: {
    name: "OneUptime OpenStack Agent",
    latestVersionSource: AgentLatestVersionSource.PinnedCollector,
    pinnedVersion: OPENSTACK_AGENT_VERSION,
    collectorVersion: OPENSTACK_AGENT_COLLECTOR_VERSION,
  },
  [AgentKind.CephAgent]: {
    name: "OneUptime Ceph Agent",
    latestVersionSource: AgentLatestVersionSource.PinnedCollector,
    pinnedVersion: CEPH_AGENT_VERSION,
    collectorVersion: CEPH_AGENT_VERSION,
  },
  [AgentKind.VMwareAgent]: {
    name: "OneUptime VMware Agent",
    latestVersionSource: AgentLatestVersionSource.PinnedCollector,
    pinnedVersion: VMWARE_AGENT_VERSION,
    collectorVersion: VMWARE_AGENT_VERSION,
  },
  [AgentKind.StorageArrayAgent]: {
    name: "OneUptime Storage Array Agent",
    latestVersionSource: AgentLatestVersionSource.PinnedCollector,
    pinnedVersion: STORAGE_ARRAY_AGENT_VERSION,
    collectorVersion: STORAGE_ARRAY_AGENT_VERSION,
  },
  /*
   * IoT, serverless and RUM versions come from the customer's own
   * OpenTelemetry SDK (or their own gateway collector), which OneUptime
   * neither ships nor pins: never outdated.
   */
  [AgentKind.IoTExporter]: {
    name: "OpenTelemetry exporter",
    latestVersionSource: AgentLatestVersionSource.None,
  },
  [AgentKind.ServerlessSdk]: {
    name: "OpenTelemetry SDK",
    latestVersionSource: AgentLatestVersionSource.None,
  },
  // telemetry.sdk.version: the OpenTelemetry SDK's own release line.
  [AgentKind.RumSdk]: {
    name: "OpenTelemetry SDK",
    latestVersionSource: AgentLatestVersionSource.None,
  },
  /*
   * Built and released with OneUptime: it reports the APP_VERSION baked into
   * its image, and nothing when it has none.
   */
  [AgentKind.ResourceAiAgent]: {
    name: "OneUptime AI Agent",
    latestVersionSource: AgentLatestVersionSource.OneUptimeRelease,
  },
};

/*
 * The newest version of this kind of agent, in canonical form, or null when
 * it cannot be known: a kind OneUptime does not release, or a server that
 * does not know its own version (a dev build without APP_VERSION).
 */
export function getAgentLatestVersion(
  kind: AgentKind,
  serverVersion: unknown,
): string | null {
  const definition: AgentKindDefinition = AGENT_KINDS[kind];

  switch (definition.latestVersionSource) {
    case AgentLatestVersionSource.OneUptimeRelease:
      return VersionUtil.canonicalize(serverVersion);
    case AgentLatestVersionSource.PinnedCollector:
      return VersionUtil.canonicalize(definition.pinnedVersion);
    default:
      return null;
  }
}

export interface AgentVersionState {
  status: AgentVersionStatus;
  // The version to upgrade to; set only when the agent is outdated.
  latestVersion: string | null;
}

// Whether this agent's version is behind, and what the newest one is.
export function getAgentVersionState(data: {
  kind: AgentKind;
  agentVersion: unknown;
  serverVersion: unknown;
}): AgentVersionState {
  const definition: AgentKindDefinition = AGENT_KINDS[data.kind];
  const latestVersion: string | null = getAgentLatestVersion(
    data.kind,
    data.serverVersion,
  );

  const status: AgentVersionStatus = AgentVersionUtil.getStatus({
    agentVersion: data.agentVersion,
    latestVersion: latestVersion,
    placeholderVersions: definition.placeholderVersions,
  });

  return {
    status: status,
    latestVersion:
      status === AgentVersionStatus.Outdated ? latestVersion : null,
  };
}
