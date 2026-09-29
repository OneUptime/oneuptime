/*
 * The infrastructure resources a resource AI agent can give OneUptime AI
 * access to, and what each one's agent runs.
 *
 * One resource AI agent (image RESOURCE_AI_AGENT_IMAGE_REPOSITORY) is
 * installed next to each resource's telemetry collector. It registers the
 * resource by the same identity the collector reports (identityEnvVars), and
 * runs only the programs listed for its type — every command an argv, never
 * a shell line, tiered by the resource command policy
 * (Utils/AiRemediation/Resource) on the server tool, at the enqueue
 * chokepoint and again on the agent before anything is spawned.
 *
 * Kubernetes clusters are NOT here: they keep their own Kubernetes AI agent
 * (Types/Kubernetes/KubernetesClusterAiAccess).
 *
 * This file imports NOTHING outside Types/ResourceAiAgent on purpose: the
 * resource AI agent (agents/ResourceAIAgent) carries a byte-identical copy of
 * this directory and must compile without the rest of Common.
 */

/*
 * Stored as a plain string (ResourceAiAgent.resourceType, RunnerJob and
 * AutoRemediationSuggestion rows, job payloads), so each value IS the wire
 * and database contract: never rename one.
 */
enum AiResourceType {
  DockerHost = "DockerHost",
  PodmanHost = "PodmanHost",
  DockerSwarmCluster = "DockerSwarmCluster",
  ProxmoxCluster = "ProxmoxCluster",
  VMwareVCenter = "VMwareVCenter",
  CephCluster = "CephCluster",
  DatabaseServer = "DatabaseServer",
  Host = "Host",
}

export default AiResourceType;

/*
 * Every type, in declaration order. This is also the priority order in
 * which a remediation round picks among several resources linked to one
 * incident or alert, so reordering it changes which resource AI fixes first.
 */
export const ALL_AI_RESOURCE_TYPES: ReadonlyArray<AiResourceType> = [
  AiResourceType.DockerHost,
  AiResourceType.PodmanHost,
  AiResourceType.DockerSwarmCluster,
  AiResourceType.ProxmoxCluster,
  AiResourceType.VMwareVCenter,
  AiResourceType.CephCluster,
  AiResourceType.DatabaseServer,
  AiResourceType.Host,
];

// Exactly an enum value, case included — what a stored row must hold.
export function isAiResourceType(value: unknown): value is AiResourceType {
  return (
    typeof value === "string" &&
    (ALL_AI_RESOURCE_TYPES as ReadonlyArray<string>).includes(value)
  );
}

export interface AiResourceTypeInfo {
  type: AiResourceType;
  // How the resource is named in sentences: "Docker host", "Ceph cluster".
  displayName: string;
  /*
   * How the resource's agent is named wherever a Runner name would
   * otherwise appear (RunnerJob targets, plan steps' runnerNameSnapshot,
   * refusal messages): "Docker AI agent".
   */
  agentDisplayName: string;
  /*
   * The value of RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV
   * (ONEUPTIME_AI_AGENT_RESOURCE_TYPE) that selects this type on the agent.
   */
  agentAlias: string;
  /*
   * The programs a command for this resource may start with (argv[0]). A
   * command naming anything else is Denied before any tool policy reads it.
   */
  programs: ReadonlyArray<string>;
  /*
   * The read-only commands "Test connection" runs through the agent. Each is
   * a Read-tier command of this type's tool policy.
   */
  testCommands: ReadonlyArray<string>;
  /*
   * The collector environment variables the agent reads its resource
   * identity from, so the agent registers exactly the row the collector's
   * telemetry created (RESOURCE_AI_AGENT_RESOURCE_NAME_ENV overrides them).
   */
  identityEnvVars: ReadonlyArray<string>;
  /*
   * The identities the collectors fall back to when the operator never set
   * one. Every host installed with the default reports into the SAME row,
   * so the agent warns (it never refuses) when its identity is one of these.
   */
  defaultIdentityPlaceholders: ReadonlyArray<string>;
}

// The CLIs a Host agent runs through nsenter on the host itself.
const HOST_PROGRAMS: ReadonlyArray<string> = [
  "systemctl",
  "journalctl",
  "df",
  "free",
  "uptime",
  "ps",
  "ss",
  "ip",
  "dmesg",
  "lsblk",
  "cat",
  "top",
  "uname",
  "hostnamectl",
  "kill",
];

export const AI_RESOURCE_TYPE_INFO: Readonly<
  Record<AiResourceType, AiResourceTypeInfo>
> = {
  [AiResourceType.DockerHost]: {
    type: AiResourceType.DockerHost,
    displayName: "Docker host",
    agentDisplayName: "Docker AI agent",
    agentAlias: "docker",
    programs: ["docker"],
    testCommands: ["docker version", "docker info"],
    identityEnvVars: ["DOCKER_HOST_NAME"],
    defaultIdentityPlaceholders: ["docker-host"],
  },
  /*
   * Podman serves the Docker-compatible API on its socket, so the agent
   * drives it with the same docker CLI and the same engine policy.
   */
  [AiResourceType.PodmanHost]: {
    type: AiResourceType.PodmanHost,
    displayName: "Podman host",
    agentDisplayName: "Podman AI agent",
    agentAlias: "podman",
    programs: ["docker"],
    testCommands: ["docker version", "docker info"],
    identityEnvVars: ["PODMAN_HOST_NAME"],
    defaultIdentityPlaceholders: ["podman-host"],
  },
  /*
   * The swarm agent must run on a manager node: `docker node ls` fails on a
   * worker, which is exactly what "Test connection" should reveal.
   */
  [AiResourceType.DockerSwarmCluster]: {
    type: AiResourceType.DockerSwarmCluster,
    displayName: "Docker Swarm cluster",
    agentDisplayName: "Docker Swarm AI agent",
    agentAlias: "docker-swarm",
    programs: ["docker"],
    testCommands: ["docker version", "docker node ls"],
    identityEnvVars: ["DOCKER_SWARM_CLUSTER_NAME"],
    // The compose default, and the name install.sh suggests.
    defaultIdentityPlaceholders: ["docker-swarm", "my-swarm"],
  },
  /*
   * There is no Proxmox CLI in the agent: "pvesh" is parsed by the policy
   * and executed as calls to the Proxmox VE HTTPS API with the agent's own
   * API token.
   */
  [AiResourceType.ProxmoxCluster]: {
    type: AiResourceType.ProxmoxCluster,
    displayName: "Proxmox cluster",
    agentDisplayName: "Proxmox AI agent",
    agentAlias: "proxmox",
    programs: ["pvesh"],
    testCommands: ["pvesh get /version", "pvesh get /cluster/status"],
    identityEnvVars: ["PROXMOX_CLUSTER_NAME"],
    defaultIdentityPlaceholders: ["proxmox-cluster"],
  },
  [AiResourceType.VMwareVCenter]: {
    type: AiResourceType.VMwareVCenter,
    displayName: "VMware vCenter",
    agentDisplayName: "VMware AI agent",
    agentAlias: "vmware",
    programs: ["govc"],
    testCommands: ["govc about"],
    identityEnvVars: ["VMWARE_VCENTER_NAME"],
    defaultIdentityPlaceholders: ["vmware-vcenter"],
  },
  [AiResourceType.CephCluster]: {
    type: AiResourceType.CephCluster,
    displayName: "Ceph cluster",
    agentDisplayName: "Ceph AI agent",
    agentAlias: "ceph",
    programs: ["ceph"],
    testCommands: ["ceph health", "ceph versions"],
    identityEnvVars: ["CEPH_CLUSTER_NAME"],
    defaultIdentityPlaceholders: ["ceph"],
  },
  /*
   * "db" is not a binary: it names a typed catalog of diagnostic queries the
   * agent runs through the database's own driver. Free SQL never runs.
   * Database servers register by id or endpoint, never by name (names are
   * not unique), so there is no placeholder to warn about.
   */
  [AiResourceType.DatabaseServer]: {
    type: AiResourceType.DatabaseServer,
    displayName: "Database server",
    agentDisplayName: "Database AI agent",
    agentAlias: "database",
    programs: ["db"],
    testCommands: ["db ping", "db version"],
    identityEnvVars: [
      "DATABASE_SERVER_ID",
      "DATABASE_SYSTEM",
      "DATABASE_SERVER_ADDRESS",
      "DATABASE_SERVER_PORT",
    ],
    defaultIdentityPlaceholders: [],
  },
  // HOST_NAME defaults to the host's own hostname, so there is no placeholder.
  [AiResourceType.Host]: {
    type: AiResourceType.Host,
    displayName: "Host",
    agentDisplayName: "Host AI agent",
    agentAlias: "host",
    programs: HOST_PROGRAMS,
    testCommands: ["uptime", "systemctl list-units --failed --no-pager"],
    identityEnvVars: ["HOST_NAME"],
    defaultIdentityPlaceholders: [],
  },
};

export function getAiResourceTypeInfo(
  type: AiResourceType,
): AiResourceTypeInfo {
  return AI_RESOURCE_TYPE_INFO[type];
}

/*
 * Words an operator may set ONEUPTIME_AI_AGENT_RESOURCE_TYPE to besides the
 * agentAlias itself. Compared after trimming, lowercasing and reading "_"
 * as "-".
 */
const EXTRA_AGENT_ALIASES: Readonly<Record<string, AiResourceType>> = {
  swarm: AiResourceType.DockerSwarmCluster,
  vcenter: AiResourceType.VMwareVCenter,
  db: AiResourceType.DatabaseServer,
};

/*
 * Read a resource type from configuration or a request: an enum value in
 * any case ("DockerHost", "dockerhost"), or an agent alias ("docker",
 * "podman", "docker-swarm"/"swarm", "proxmox", "vmware"/"vcenter", "ceph",
 * "database"/"db", "host"). Anything else is null — never a guess.
 */
export function parseAiResourceType(value: unknown): AiResourceType | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (!trimmed) {
    return null;
  }

  const folded: string = trimmed.toLowerCase();

  for (const type of ALL_AI_RESOURCE_TYPES) {
    if (type.toLowerCase() === folded) {
      return type;
    }
  }

  const alias: string = folded.replace(/_/g, "-");

  for (const type of ALL_AI_RESOURCE_TYPES) {
    if (AI_RESOURCE_TYPE_INFO[type].agentAlias === alias) {
      return type;
    }
  }

  if (Object.prototype.hasOwnProperty.call(EXTRA_AGENT_ALIASES, alias)) {
    return EXTRA_AGENT_ALIASES[alias] || null;
  }

  return null;
}

/*
 * Whether an agent's identity is one of its collector's defaults, compared
 * the way the resource rows are looked up (trimmed, case-insensitively). The
 * agent warns on true; it never refuses.
 */
export function isDefaultIdentityPlaceholder(
  type: AiResourceType,
  identifier: unknown,
): boolean {
  if (typeof identifier !== "string" || !isAiResourceType(type)) {
    return false;
  }

  const folded: string = identifier.trim().toLowerCase();

  return AI_RESOURCE_TYPE_INFO[type].defaultIdentityPlaceholders.some(
    (placeholder: string): boolean => {
      return placeholder.toLowerCase() === folded;
    },
  );
}
