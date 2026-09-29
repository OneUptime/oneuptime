import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  AiResourceTypeInfo,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT,
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * How to install a resource's AI agent, and how to give it write access,
 * as the resource's AI agent page shows it: one more service in the
 * resource's collector docker-compose.yml — the same service the
 * collector's own compose file ships (agents/<Resource>Agent), named
 * oneuptime-<alias>-ai-agent and reading the collector's .env, so it has
 * ONEUPTIME_URL, the key and the resource's name already — the variables
 * it reads, and the write switch.
 *
 * Every name here comes from the shared contract (Common/Types/
 * ResourceAiAgent): the image, the resource-type and write variables, each
 * type's agent alias and identity variables — the suites pin the
 * instructions to them and to the collectors' compose files, so the page
 * can never tell an operator to set a variable the agent does not read.
 *
 * Import-clean on purpose (Common types only), so the suites read it
 * without a browser.
 */

// Released images are tagged like every other OneUptime agent's.
export const RESOURCE_AI_AGENT_IMAGE: string = `${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}:release`;

/*
 * The compose service (and, where the collector names its containers, the
 * container) the agent runs as: oneuptime-docker-ai-agent,
 * oneuptime-proxmox-ai-agent, … — the collectors' own convention.
 */
export function getResourceAiAgentServiceName(
  resourceType: AiResourceType,
): string {
  return `oneuptime-${AI_RESOURCE_TYPE_INFO[resourceType].agentAlias}-ai-agent`;
}

// One variable the agent reads, as the install instructions list it.
export interface ResourceAiAgentInstallVariable {
  name: string;
  // The value the snippet sets, or where it comes from.
  value: string;
  description: string;
}

export interface ResourceAiAgentInstall {
  // Where the snippet goes, in a sentence.
  whereText: string;
  // The docker-compose.yml snippet (YAML).
  composeSnippet: string;
  // The command that starts the agent once the snippet is in place.
  startCommand: string;
  // The variables the agent reads, the resource's own first.
  variables: Array<ResourceAiAgentInstallVariable>;
  // What the resource needs besides the snippet (a keyring, a token role).
  prerequisites: Array<string>;
}

// A connection variable the agent reads from the collector's .env.
interface ConnectionVariable {
  name: string;
  // How the snippet passes it: `${NAME}` or `${NAME:-default}`.
  composeValue: string;
  description: string;
}

interface InstallSpec {
  // The collector's install directory, where its docker-compose.yml is.
  directory: string;
  // The collector the agent is added beside, as the operator knows it.
  collectorName: string;
  // True when the collector's own docker-compose.yml ships the agent.
  collectorShipsAgent: boolean;
  // The CLI that runs its containers.
  runtime: "docker" | "podman";
  // False where one machine runs several copies (one per database).
  hasContainerName: boolean;
  // The key variable the collector's .env already holds, and how it is passed.
  keyVariable: string;
  keyComposeValue: string;
  user: string;
  // Service lines after `tmpfs` (volumes, privileges), pre-indented.
  extraServiceLines: Array<string>;
  // Variables besides the identity, the key and the switches.
  connectionVariables: Array<ConnectionVariable>;
  prerequisites: Array<string>;
  // What ONEUPTIME_AI_WRITE_TARGETS names for this type, and an example.
  writeTargetNoun: string | null;
  writeTargetsExample: string | null;
  // What write access lets the agent do, and what bounds it.
  writeDisclosure: string;
  // True: no collector compose to add to — the snippet is the whole file.
  isStandalone: boolean;
}

const INSTALL_SPECS: Readonly<Record<AiResourceType, InstallSpec>> = {
  [AiResourceType.DockerHost]: {
    directory: "/opt/oneuptime-docker-agent",
    collectorName: "Docker agent",
    collectorShipsAgent: true,
    runtime: "docker",
    hasContainerName: true,
    keyVariable: "ONEUPTIME_SERVICE_TOKEN",
    keyComposeValue: "${ONEUPTIME_SERVICE_TOKEN}",
    user: "0:0",
    extraServiceLines: [
      "    volumes:",
      "      - /var/run/docker.sock:/var/run/docker.sock:ro",
    ],
    connectionVariables: [],
    prerequisites: [
      "Installed the Docker agent with install.sh? Run it again: it now starts the AI agent too (container oneuptime-docker-ai-agent).",
    ],
    writeTargetNoun: "container names",
    writeTargetsExample: "web-*,api-*",
    writeDisclosure:
      "Write access lets the agent restart, start, stop, kill, pause and update (memory, CPU, restart policy) containers through the Docker socket — which is root on this host, so the command policy, the write switch and the write targets are the only limits. OneUptime still holds the line: it never runs exec, run, rm or prune, never changes the agent itself or the collector beside it, and with ONEUPTIME_AI_WRITE_TARGETS set only touches the containers it names.",
    isStandalone: false,
  },
  [AiResourceType.PodmanHost]: {
    directory: "/opt/oneuptime-podman-agent",
    collectorName: "Podman agent",
    collectorShipsAgent: true,
    runtime: "podman",
    hasContainerName: true,
    keyVariable: "ONEUPTIME_SERVICE_TOKEN",
    keyComposeValue: "${ONEUPTIME_SERVICE_TOKEN}",
    user: "0:0",
    extraServiceLines: [
      "    volumes:",
      "      - /run/podman/podman.sock:/run/podman/podman.sock:ro",
    ],
    connectionVariables: [],
    prerequisites: [
      "Installed the Podman agent with install.sh? Run it again: it now starts the AI agent too (container oneuptime-podman-ai-agent).",
      "The Podman API socket must be on: sudo systemctl enable --now podman.socket.",
    ],
    writeTargetNoun: "container names",
    writeTargetsExample: "web-*,api-*",
    writeDisclosure:
      "Write access lets the agent restart, start, stop, kill, pause and update (memory, CPU, restart policy) containers through the Podman socket — for rootful Podman that is root on this host, so the command policy, the write switch and the write targets are the only limits. OneUptime still holds the line: it never runs exec, run, rm or prune, never changes the agent itself or the collector beside it, and with ONEUPTIME_AI_WRITE_TARGETS set only touches the containers it names.",
    isStandalone: false,
  },
  [AiResourceType.DockerSwarmCluster]: {
    directory: "/opt/oneuptime-docker-swarm-agent",
    collectorName: "Docker Swarm agent",
    collectorShipsAgent: true,
    runtime: "docker",
    hasContainerName: true,
    keyVariable: "ONEUPTIME_SERVICE_TOKEN",
    keyComposeValue: "${ONEUPTIME_SERVICE_TOKEN}",
    user: "0:0",
    extraServiceLines: [
      "    volumes:",
      "      - /var/run/docker.sock:/var/run/docker.sock:ro",
    ],
    connectionVariables: [],
    prerequisites: [
      "Run it on a manager node: services, tasks and nodes can only be read (and fixed) there.",
    ],
    writeTargetNoun: "service and node names",
    writeTargetsExample: "web_*,api_*",
    writeDisclosure:
      "Write access lets the agent force-update (restart), roll back, scale and update services and change a node's availability through a manager's Docker socket — root on that node, so the command policy, the write switch and the write targets are the only limits. OneUptime still holds the line: it never creates or removes services or stacks, never touches secrets or configs, draining a node always waits for a person, and with ONEUPTIME_AI_WRITE_TARGETS set it only touches the services and nodes it names.",
    isStandalone: false,
  },
  [AiResourceType.ProxmoxCluster]: {
    directory: "/opt/oneuptime-proxmox-agent",
    collectorName: "Proxmox agent",
    collectorShipsAgent: true,
    runtime: "docker",
    hasContainerName: true,
    keyVariable: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
    keyComposeValue: "${ONEUPTIME_TELEMETRY_INGESTION_KEY}",
    user: "1000:1000",
    extraServiceLines: [],
    connectionVariables: [
      {
        name: "PVE_HOST",
        composeValue: "${PVE_HOST:-}",
        description:
          "Any node of the cluster; the agent calls https://PVE_HOST:8006/api2/json.",
      },
      {
        name: "PVE_VERIFY_SSL",
        composeValue: "${PVE_VERIFY_SSL:-false}",
        description:
          "true verifies the API's certificate (Proxmox VE ships a self-signed one).",
      },
      {
        name: "PVE_API_TOKEN_ID",
        composeValue: "${PVE_API_TOKEN_ID:-}",
        description:
          "The API token the agent uses (user@realm!tokenname). The collector's PVEAuditor token keeps it read-only.",
      },
      {
        name: "PVE_API_TOKEN_SECRET",
        composeValue: "${PVE_API_TOKEN_SECRET:-}",
        description: "That token's secret.",
      },
    ],
    prerequisites: [
      "The token's Proxmox permissions are the hard limit: the collector's PVEAuditor token lets AI read and nothing else. Fixes need a token whose role may power guests (for example PVEVMUser on /vms) — see the Proxmox agent's README.",
    ],
    writeTargetNoun: "guest ids (VMIDs)",
    writeTargetsExample: "100,101",
    writeDisclosure:
      "Write access lets the agent start, resume, reboot, shut down, stop, suspend and reset guests and restart node services through the Proxmox VE API — as far as its API token's role allows, which is the hard limit. OneUptime still holds the line: it never changes configuration, deletes anything, touches snapshots or /access, migrating a guest always waits for a person, and with ONEUPTIME_AI_WRITE_TARGETS set it only touches the guests it names.",
    isStandalone: false,
  },
  [AiResourceType.VMwareVCenter]: {
    directory: "/opt/oneuptime-vmware-agent",
    collectorName: "VMware agent",
    collectorShipsAgent: true,
    runtime: "docker",
    hasContainerName: true,
    keyVariable: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
    keyComposeValue: "${ONEUPTIME_TELEMETRY_INGESTION_KEY}",
    user: "1000:1000",
    extraServiceLines: [],
    connectionVariables: [
      {
        name: "VCENTER_ENDPOINT",
        composeValue: "${VCENTER_ENDPOINT}",
        description: "The vCenter address the agent's govc connects to.",
      },
      {
        name: "VCENTER_USERNAME",
        composeValue: "${VCENTER_USERNAME}",
        description:
          "The vSphere user the agent uses. The collector's Read-Only user keeps it read-only.",
      },
      {
        name: "VCENTER_PASSWORD",
        composeValue: "${VCENTER_PASSWORD}",
        description: "That user's password.",
      },
      {
        name: "VCENTER_INSECURE_SKIP_VERIFY",
        composeValue: "${VCENTER_INSECURE_SKIP_VERIFY:-false}",
        description: "true accepts vCenter's self-signed certificate.",
      },
    ],
    prerequisites: [
      "The vSphere role is the hard limit: the collector's Read-Only user lets AI read and nothing else. Fixes need a user whose role may power VMs on and off — see the VMware agent's README.",
    ],
    writeTargetNoun: "VM and host names or inventory paths",
    writeTargetsExample: "web-*,/dc1/vm/api-01",
    writeDisclosure:
      "Write access lets the agent power VMs on, off, reset, suspend and reboot them and take hosts out of maintenance mode — as far as its vSphere role allows, which is the hard limit. OneUptime still holds the line: it never destroys, creates, reconfigures or snapshots a VM, migrating a VM or entering maintenance mode always waits for a person, and with ONEUPTIME_AI_WRITE_TARGETS set it only touches the VMs and hosts it names.",
    isStandalone: false,
  },
  [AiResourceType.CephCluster]: {
    directory: "/opt/oneuptime-ceph-agent",
    collectorName: "Ceph agent",
    collectorShipsAgent: true,
    runtime: "docker",
    hasContainerName: true,
    keyVariable: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
    keyComposeValue: "${ONEUPTIME_TELEMETRY_INGESTION_KEY}",
    user: "1000:1000",
    extraServiceLines: [
      "    volumes:",
      "      # ceph.conf and the keyring of the agent's own client",
      "      - ./ceph:/etc/ceph:ro",
    ],
    connectionVariables: [
      {
        name: "CEPH_CLIENT_ID",
        composeValue: "${CEPH_CLIENT_ID:-oneuptime-ai}",
        description:
          'The Ceph client the agent connects as, without "client.". Its keyring is ./ceph/ceph.client.<CEPH_CLIENT_ID>.keyring.',
      },
    ],
    prerequisites: [
      'Give the agent its own client, never the admin keyring: ceph auth get-or-create client.oneuptime-ai mon "allow r" mgr "allow r" osd "allow r" -o ceph/ceph.client.oneuptime-ai.keyring — read-only caps keep it read-only whatever else is set. Put it and a minimal ceph.conf (ceph config generate-minimal-conf > ceph/ceph.conf) in ./ceph next to docker-compose.yml, owned by UID 1000 with mode 600.',
      "The container must reach the monitors (ports 3300 and 6789) and the mgr and OSD daemons (6800-7300).",
    ],
    writeTargetNoun: "OSDs, daemons and PGs",
    writeTargetsExample: "osd.*",
    writeDisclosure:
      "Write access lets the agent mark OSDs in, out and down, set and unset cluster flags, reweight OSDs, scrub and repair PGs, fail over the mgr and restart, stop and start daemons — as far as its keyring's caps allow, which are the hard limit. OneUptime still holds the line: it never purges or destroys an OSD, never deletes or reconfigures a pool, never touches auth or config-key, pausing client I/O always waits for a person, and with ONEUPTIME_AI_WRITE_TARGETS set it only touches the targets it names.",
    isStandalone: false,
  },
  [AiResourceType.DatabaseServer]: {
    directory: "/opt/oneuptime-database-agent",
    collectorName: "database agent",
    collectorShipsAgent: false,
    runtime: "docker",
    hasContainerName: false,
    keyVariable: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
    keyComposeValue: "${ONEUPTIME_TELEMETRY_INGESTION_KEY}",
    user: "1000:1000",
    extraServiceLines: [
      "    extra_hosts:",
      '      - "host.docker.internal:host-gateway"',
    ],
    connectionVariables: [
      {
        name: "DATABASE_SYSTEM",
        composeValue: "${DATABASE_SYSTEM}",
        description: "The database engine (postgresql, mysql, redis, …).",
      },
      {
        name: "DATABASE_ENDPOINT",
        composeValue: "${DATABASE_ENDPOINT}",
        description: "host:port the agent connects to.",
      },
      {
        name: "DATABASE_USERNAME",
        composeValue: "${DATABASE_USERNAME:-}",
        description:
          "The login the agent uses. The collector's monitoring login keeps it read-only.",
      },
      {
        name: "DATABASE_PASSWORD",
        composeValue: "${DATABASE_PASSWORD:-}",
        description: "That login's password.",
      },
    ],
    prerequisites: [
      "The login's grants are the hard limit: the collector's monitoring login lets AI read and nothing else. Cancelling a query or ending a session needs a login that may signal other sessions (for example pg_signal_backend on PostgreSQL, CONNECTION_ADMIN on MySQL).",
    ],
    writeTargetNoun: null,
    writeTargetsExample: null,
    writeDisclosure:
      "Write access lets the agent cancel a running query and end one session at a time — as far as its login's grants allow, which are the hard limit. OneUptime still holds the line: it never runs free SQL, never changes a setting, schema, data, user or replication, and never ends its own session.",
    isStandalone: false,
  },
  [AiResourceType.Host]: {
    directory: "/opt/oneuptime-host-ai-agent",
    collectorName: "Host AI agent",
    collectorShipsAgent: true,
    runtime: "docker",
    hasContainerName: true,
    keyVariable: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
    keyComposeValue: "${ONEUPTIME_TELEMETRY_INGESTION_KEY:-}",
    user: "0:0",
    extraServiceLines: [
      "    # The host's own tools run in its namespaces (nsenter).",
      "    privileged: true",
      "    pid: host",
      "    network_mode: host",
    ],
    connectionVariables: [],
    prerequisites: [
      "Or let the installer write both files and start it: curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/HostAIAgent/install.sh -o install.sh && sudo bash install.sh",
      "Put ONEUPTIME_URL and ONEUPTIME_TELEMETRY_INGESTION_KEY (your project's telemetry ingestion key) in a .env next to the file.",
      "It runs privileged, as root, in the host's pid namespace: the host's own systemctl, journalctl and ps run through nsenter. Rootless Docker cannot do that.",
    ],
    writeTargetNoun: "systemd unit names",
    writeTargetsExample: "nginx.service,app-*.service",
    writeDisclosure:
      "Write access lets the agent restart, start, reload, stop and reset systemd units, vacuum the journal and signal processes on this host — it runs privileged in the host's namespaces, so the command policy, the write switch and the write targets are the only limits. OneUptime still holds the line: it never enables, masks or edits a unit, never reboots or powers off, changes to protected units (sshd, systemd-*, dbus, networking, docker, …) and killing a process always wait for a person, and with ONEUPTIME_AI_WRITE_TARGETS set it only touches the units it names.",
    isStandalone: true,
  },
};

/*
 * One `KEY=value` entry of the snippet's environment list, quoted for YAML
 * when the value needs it, with docker compose's interpolation character
 * doubled so a literal value holding `$` is kept as it is.
 */
// An entry YAML reads as the same plain string, with no quoting needed.
const PLAIN_COMPOSE_ENTRY_REGEX: RegExp = /^[A-Za-z0-9_=.\-/:@,]+$/;

export function toComposeEnvironmentEntry(name: string, value: string): string {
  const literal: string = `${name}=${value.replace(/\$/g, "$$$$")}`;

  return PLAIN_COMPOSE_ENTRY_REGEX.test(literal)
    ? literal
    : JSON.stringify(literal);
}

/*
 * The identity entry of the agent's environment. With the resource's own
 * identity known it pins it, so the agent registers exactly this resource
 * whatever the .env says; without it it falls back to the collector's own
 * default (its docker-compose.yml's), which is what the collector reported
 * when nothing was set. A database server is pinned by its id, which
 * always wins over the endpoint variables.
 */
function getIdentityEntry(data: {
  resourceType: AiResourceType;
  resourceId: string;
  identity: string | null;
}): string {
  const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[data.resourceType];

  if (data.resourceType === AiResourceType.DatabaseServer) {
    return toComposeEnvironmentEntry("DATABASE_SERVER_ID", data.resourceId);
  }

  const variable: string = info.identityEnvVars[0] || "";

  if (data.identity) {
    return toComposeEnvironmentEntry(variable, data.identity);
  }

  const fallback: string = info.defaultIdentityPlaceholders[0] || "";

  return `${variable}=\${${variable}:-${fallback}}`;
}

// The docker-compose.yml snippet that adds (or, for a host, is) the agent.
export function getResourceAiAgentComposeSnippet(data: {
  resourceType: AiResourceType;
  resourceId: string;
  identity?: string | null | undefined;
}): string {
  const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[data.resourceType];
  const spec: InstallSpec = INSTALL_SPECS[data.resourceType];
  const service: string = getResourceAiAgentServiceName(data.resourceType);

  const lines: Array<string> = ["services:"];

  if (!spec.isStandalone) {
    lines.push(
      `  # ... the ${spec.collectorName}'s services stay as they are ...`,
    );
  }

  lines.push(`  ${service}:`, `    image: ${RESOURCE_AI_AGENT_IMAGE}`);

  if (spec.hasContainerName) {
    lines.push(`    container_name: ${service}`);
  }

  lines.push(
    `    user: "${spec.user}"`,
    "    read_only: true",
    "    tmpfs:",
    "      - /tmp",
    ...spec.extraServiceLines,
    "    environment:",
    "      - ONEUPTIME_URL=${ONEUPTIME_URL}",
    `      - ${spec.keyVariable}=${spec.keyComposeValue}`,
    `      - ${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV}=${info.agentAlias}`,
    `      - ${getIdentityEntry({
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      identity: data.identity || null,
    })}`,
    ...spec.connectionVariables.map((variable: ConnectionVariable): string => {
      return `      - ${variable.name}=${variable.composeValue}`;
    }),
    `      - ${RESOURCE_AI_ALLOW_WRITES_ENV}=\${${RESOURCE_AI_ALLOW_WRITES_ENV}:-false}`,
    `      - ${RESOURCE_AI_WRITE_TARGETS_ENV}=\${${RESOURCE_AI_WRITE_TARGETS_ENV}:-}`,
    "    restart: unless-stopped",
  );

  return lines.join("\n");
}

// `cd <directory>` then a compose command, in the collector's runtime.
function composeCommand(resourceType: AiResourceType, command: string): string {
  const spec: InstallSpec = INSTALL_SPECS[resourceType];

  return `cd ${spec.directory}
${spec.runtime} compose ${command}`;
}

/*
 * Where the agent's logs are: its container's, where the collector names
 * its containers, otherwise the compose service's from the directory of
 * its docker-compose.yml.
 */
export function getResourceAiAgentLogsCommand(
  resourceType: AiResourceType,
): string {
  const spec: InstallSpec = INSTALL_SPECS[resourceType];
  const service: string = getResourceAiAgentServiceName(resourceType);

  return spec.hasContainerName
    ? `${spec.runtime} logs --tail 100 ${service}`
    : composeCommand(resourceType, `logs --tail=100 ${service}`);
}

// The agent's own view of itself, from its health server.
export function getResourceAiAgentStatusCommand(
  resourceType: AiResourceType,
): string {
  const spec: InstallSpec = INSTALL_SPECS[resourceType];
  const service: string = getResourceAiAgentServiceName(resourceType);
  const url: string = `http://127.0.0.1:${RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT}/status`;

  return spec.hasContainerName
    ? `${spec.runtime} exec ${service} wget -qO- ${url}`
    : composeCommand(resourceType, `exec ${service} wget -qO- ${url}`);
}

export function getResourceAiAgentInstall(data: {
  resourceType: AiResourceType;
  resourceId: string;
  identity?: string | null | undefined;
}): ResourceAiAgentInstall {
  const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[data.resourceType];
  const spec: InstallSpec = INSTALL_SPECS[data.resourceType];
  const identity: string | null = data.identity || null;
  const service: string = getResourceAiAgentServiceName(data.resourceType);
  const noun: string =
    data.resourceType === AiResourceType.DatabaseServer ||
    data.resourceType === AiResourceType.Host
      ? info.displayName.toLowerCase()
      : info.displayName;

  const identityVariables: Array<ResourceAiAgentInstallVariable> =
    data.resourceType === AiResourceType.DatabaseServer
      ? [
          {
            name: "DATABASE_SERVER_ID",
            value: data.resourceId,
            description:
              "Pins the agent to this database server. It wins over DATABASE_SYSTEM, DATABASE_SERVER_ADDRESS and DATABASE_SERVER_PORT.",
          },
        ]
      : [
          {
            name: info.identityEnvVars[0] || "",
            value: identity || "from .env",
            description: identity
              ? `The name this ${noun} reports. The agent must register with exactly this name, or it serves a different ${noun}.`
              : `Must be the name the ${spec.collectorName} reports, so the agent serves this ${noun}.`,
          },
        ];

  let whereText: string;

  if (spec.isStandalone) {
    whereText = `Save this as docker-compose.yml in ${spec.directory} on the ${noun}, next to a .env file.`;
  } else if (spec.collectorShipsAgent) {
    whereText = `The ${spec.collectorName}'s docker-compose.yml ships this service; new installs run it already. For an older install, add it to the docker-compose.yml in ${spec.directory} — it reads the same .env.`;
  } else {
    whereText = `Add this service to the ${spec.collectorName}'s docker-compose.yml (in ${spec.directory} by default). It reads the same .env.`;
  }

  return {
    whereText,
    composeSnippet: getResourceAiAgentComposeSnippet(data),
    startCommand: composeCommand(data.resourceType, `up -d ${service}`),
    variables: [
      {
        name: RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
        value: info.agentAlias,
        description: "Which kind of resource this agent serves.",
      },
      ...identityVariables,
      {
        name: "ONEUPTIME_URL",
        value: "from .env",
        description: "Your OneUptime address.",
      },
      {
        name: spec.keyVariable,
        value: "from .env",
        description: spec.isStandalone
          ? "Your project's telemetry ingestion key."
          : `The key the ${spec.collectorName} already uses.`,
      },
      ...spec.connectionVariables.map(
        (variable: ConnectionVariable): ResourceAiAgentInstallVariable => {
          return {
            name: variable.name,
            value: "from .env",
            description: variable.description,
          };
        },
      ),
      {
        name: RESOURCE_AI_ALLOW_WRITES_ENV,
        value: "false",
        description:
          "true lets the agent apply fixes. Anything else — unset included — keeps it read-only, whatever this page says.",
      },
      {
        name: RESOURCE_AI_WRITE_TARGETS_ENV,
        value: "(empty)",
        description: spec.writeTargetNoun
          ? `Optional: comma-separated ${spec.writeTargetNoun} fixes may change (* matches any run of characters). Empty means any, except the agent itself and its collector.`
          : "Optional: comma-separated targets fixes may change. Empty means any, except the agent's own.",
      },
    ],
    prerequisites: [...spec.prerequisites],
  };
}

/*
 * The write switch, as .env lines: recommended with the targets fixes may
 * change (when the resource type names any), or for every target, and the
 * command that restarts the agent with them.
 */
export interface ResourceAiAgentWriteAccessCommands {
  // Null when the type has no meaningful targets to scope (database servers).
  scopedEnv: string | null;
  scopedNote: string | null;
  allTargetsEnv: string;
  restartCommand: string;
  // For a collector usually installed with install.sh (docker run), how to do the same there.
  installerNote: string | null;
}

export function getResourceAiAgentWriteAccessCommands(
  resourceType: AiResourceType,
): ResourceAiAgentWriteAccessCommands {
  const spec: InstallSpec = INSTALL_SPECS[resourceType];

  return {
    scopedEnv: spec.writeTargetsExample
      ? `${RESOURCE_AI_ALLOW_WRITES_ENV}=true
${RESOURCE_AI_WRITE_TARGETS_ENV}=${spec.writeTargetsExample}`
      : null,
    scopedNote:
      spec.writeTargetsExample && spec.writeTargetNoun
        ? `Replace ${spec.writeTargetsExample} with the ${spec.writeTargetNoun} AI may fix (comma-separated, * matches any run of characters). A fix anywhere else is refused by the agent itself.`
        : null,
    allTargetsEnv: `${RESOURCE_AI_ALLOW_WRITES_ENV}=true`,
    restartCommand: composeCommand(
      resourceType,
      `up -d ${getResourceAiAgentServiceName(resourceType)}`,
    ),
    installerNote:
      spec.runtime === "podman" || resourceType === AiResourceType.DockerHost
        ? `Installed the ${spec.collectorName} with install.sh instead? Run it again with ${RESOURCE_AI_ALLOW_WRITES_ENV}=true (and ${RESOURCE_AI_WRITE_TARGETS_ENV}) set in its environment.`
        : null,
  };
}

/*
 * What granting the agent write access amounts to, said wherever the page
 * offers it: what it may then change, what bounds it, and what OneUptime
 * never lets it do.
 */
export function getResourceAiAgentWriteDisclosure(
  resourceType: AiResourceType,
): string {
  return INSTALL_SPECS[resourceType].writeDisclosure;
}

// The collector's install directory, where the agent's compose file lives.
export function getResourceAiAgentDirectory(
  resourceType: AiResourceType,
): string {
  return INSTALL_SPECS[resourceType].directory;
}

// Whether the collector's own docker-compose.yml ships the agent's service.
export function doesCollectorShipResourceAiAgent(
  resourceType: AiResourceType,
): boolean {
  return INSTALL_SPECS[resourceType].collectorShipsAgent;
}
