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
 *     plus OneUptime's config, and reports the collector version its files
 *     pin. The newest is the pin in this release's files.
 *   - None: OneUptime does not release it - the customer's own SDK or
 *     collector, or an agent whose config reports no version. Its version is
 *     shown as it always was and is never called outdated.
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
  // The upstream OpenTelemetry Collector the host guide installs: a host.
  HostCollector = "host-collector",
  // agents/ProxmoxAgent: a Proxmox cluster.
  ProxmoxAgent = "proxmox-agent",
  // agents/CephAgent: a Ceph cluster.
  CephAgent = "ceph-agent",
  // agents/VMwareAgent: a vCenter.
  VMwareAgent = "vmware-agent",
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
  // PinnedCollector only: the collector version this release's files pin.
  pinnedVersion?: string | undefined;
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
 * The collector version the Docker Swarm agent reports: the default of
 * APP_VERSION in agents/DockerSwarmAgent/docker-compose.yml, kept equal to
 * the collector image it pins there. AgentKind.test.ts fails when the
 * agent's file moves on without this.
 */
export const DOCKER_SWARM_AGENT_VERSION: string = "0.161.0";

/*
 * The collector version the Database agent reports: the
 * oneuptime.agent.version every agents/DatabaseAgent/configs/*.yaml stamps,
 * kept equal to the collector image docker-compose.yml pins.
 * AgentKind.test.ts fails when the agent's files move on without this.
 */
export const DATABASE_AGENT_VERSION: string = "0.161.0";

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
  },
  [AgentKind.DatabaseAgent]: {
    name: "OneUptime Database Agent",
    latestVersionSource: AgentLatestVersionSource.PinnedCollector,
    pinnedVersion: DATABASE_AGENT_VERSION,
  },
  [AgentKind.Runner]: {
    name: "Runner",
    latestVersionSource: AgentLatestVersionSource.OneUptimeRelease,
    placeholderVersions: [ONEUPTIME_AGENT_PLACEHOLDER_VERSION],
    isRunner: true,
  },
  /*
   * The host guide installs the upstream collector at the latest GitHub
   * release, and its config stamps no oneuptime.agent.version: a host shows
   * a version only when someone stamped one themselves.
   */
  [AgentKind.HostCollector]: {
    name: "OpenTelemetry Collector",
    latestVersionSource: AgentLatestVersionSource.None,
  },
  /*
   * The Proxmox, Ceph and VMware agents' configs stamp no
   * oneuptime.agent.version (and the Proxmox and Ceph ones run the
   * collector's :latest), so there is no version to compare.
   */
  [AgentKind.ProxmoxAgent]: {
    name: "OneUptime Proxmox Agent",
    latestVersionSource: AgentLatestVersionSource.None,
  },
  [AgentKind.CephAgent]: {
    name: "OneUptime Ceph Agent",
    latestVersionSource: AgentLatestVersionSource.None,
  },
  [AgentKind.VMwareAgent]: {
    name: "OneUptime VMware Agent",
    latestVersionSource: AgentLatestVersionSource.None,
  },
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
