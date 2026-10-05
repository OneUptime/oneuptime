import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideKeyStep,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
} from "../../../Components/SetupGuide/SetupGuide";

/*
 * The Docker Swarm agent install guide. The agent (agents/DockerSwarmAgent)
 * is three containers in one docker-compose.yml — the stock collector with
 * a tuned config, an inventory poller and the OneUptime AI agent — run on a
 * swarm manager. install.sh downloads the files and starts them; the guide
 * offers that, or doing the same by hand with Docker Compose.
 * DockerSwarmSetupGuide.test.ts checks the file names, URLs, container
 * names and variables here against agents/DockerSwarmAgent.
 */

// Where install.sh downloads the agent's files from.
export const DOCKER_SWARM_AGENT_RAW_BASE_URL: string =
  "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DockerSwarmAgent";

export const DOCKER_SWARM_AGENT_DIRECTORY_URL: string =
  "https://github.com/OneUptime/oneuptime/tree/master/agents/DockerSwarmAgent";

// The files the agent is made of, as install.sh downloads them.
export const DOCKER_SWARM_AGENT_FILES: Array<string> = [
  "docker-compose.yml",
  "otel-collector-config.yaml",
  "inventory-snapshot.sh",
];

// Where install.sh puts them.
export const DOCKER_SWARM_AGENT_INSTALL_DIR: string =
  "/opt/oneuptime-docker-swarm-agent";

export const DOCKER_SWARM_COLLECTOR_CONTAINER_NAME: string =
  "oneuptime-docker-swarm-agent";
export const DOCKER_SWARM_INVENTORY_CONTAINER_NAME: string =
  "oneuptime-docker-swarm-inventory";
export const DOCKER_SWARM_AI_AGENT_CONTAINER_NAME: string =
  "oneuptime-docker-swarm-ai-agent";

/*
 * The name the guide suggests when it is not installing for a known
 * cluster — the same one install.sh offers at its prompt.
 */
export const DOCKER_SWARM_EXAMPLE_CLUSTER_NAME: string = "my-swarm";

// What the compose file falls back to when .env sets no cluster name.
export const DOCKER_SWARM_DEFAULT_CLUSTER_NAME: string = "docker-swarm";

export const DOCKER_SWARM_DEFAULT_API_VERSION: string = "1.44";
export const DOCKER_SWARM_DEFAULT_INVENTORY_INTERVAL_SECONDS: string = "300";

export function getDockerSwarmAgentFileUrl(fileName: string): string {
  return `${DOCKER_SWARM_AGENT_RAW_BASE_URL}/${fileName}`;
}

export type DockerSwarmInstallMethod = "install-script" | "docker-compose";

export const DOCKER_SWARM_INSTALL_METHODS: Array<
  SetupGuideOption<DockerSwarmInstallMethod>
> = [
  {
    key: "install-script",
    label: "Install script",
    description:
      "Downloads the agent, asks for your URL, key and cluster name, and starts it.",
  },
  {
    key: "docker-compose",
    label: "Docker Compose",
    description:
      "Download the agent's files and start them with your own .env.",
  },
];

export const DEFAULT_DOCKER_SWARM_INSTALL_METHOD: DockerSwarmInstallMethod =
  "install-script";

export function resolveDockerSwarmInstallMethod(
  method: string | null | undefined,
): DockerSwarmInstallMethod {
  return (
    resolveSetupGuideOption(DOCKER_SWARM_INSTALL_METHODS, method) ||
    DEFAULT_DOCKER_SWARM_INSTALL_METHOD
  );
}

export interface DockerSwarmSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  method: DockerSwarmInstallMethod;
  /*
   * The cluster the guide installs for (a cluster's own Documentation tab):
   * its name, which is the DOCKER_SWARM_CLUSTER_NAME its agent reports.
   * Omitted on the product pages, where the guide suggests a name instead.
   */
  clusterName?: string | undefined;
}

interface ClusterName {
  name: string;
  isKnown: boolean;
}

/*
 * The name goes into .env as it is, the way install.sh writes it; a line
 * break or a backtick would break the file or the markdown around it.
 */
const UNSAFE_CLUSTER_NAME_CHARACTERS: RegExp = /[\r\n`]/;

function resolveClusterName(clusterName: string | undefined): ClusterName {
  const known: string = (clusterName || "").trim();
  if (known && !UNSAFE_CLUSTER_NAME_CHARACTERS.test(known)) {
    return { name: known, isKnown: true };
  }
  return { name: DOCKER_SWARM_EXAMPLE_CLUSTER_NAME, isKnown: false };
}

interface GuideData {
  oneuptimeUrl: string;
  apiKey: string;
  method: DockerSwarmInstallMethod;
  clusterName: ClusterName;
}

function isScript(data: GuideData): boolean {
  return data.method === "install-script";
}

/*
 * The commands that install and upgrade the agent. The guide's steps, its
 * "Upgrade or uninstall the agent" topic and the upgrade dialog beside an
 * outdated agent version (Components/AgentVersion) all show these, so they
 * never drift. Running the install script again is the upgrade: it fetches
 * the latest files and restarts the agent.
 */
export function getDockerSwarmAgentInstallScriptCommand(): string {
  return `curl -sSL ${getDockerSwarmAgentFileUrl("install.sh")} -o install.sh
sh install.sh`;
}

// The agent's files, downloaded into the current folder.
export function getDockerSwarmAgentDownloadCommand(): string {
  return [
    ...DOCKER_SWARM_AGENT_FILES.map((fileName: string): string => {
      return `curl -fsSL ${getDockerSwarmAgentFileUrl(fileName)} -o ${fileName}`;
    }),
    "chmod +x inventory-snapshot.sh",
  ].join("\n");
}

/*
 * Pulls the images the downloaded docker-compose.yml names and recreates the
 * containers. The collector image is pinned there, so this alone does not
 * move the agent forward: download the files again first.
 */
export const DOCKER_SWARM_AGENT_COMPOSE_UPGRADE_COMMAND: string =
  "docker compose pull\ndocker compose up -d";

function getTroubleshootScriptCommand(data: GuideData): string {
  const download: string = `curl -sSL ${getDockerSwarmAgentFileUrl("troubleshoot.sh")} -o troubleshoot.sh`;
  if (isScript(data)) {
    return `${download}\nbash troubleshoot.sh`;
  }
  // The script looks in the install script's directory unless told otherwise.
  return `# In the agent's folder\n${download}\nbash troubleshoot.sh -d "$PWD"`;
}

export function getDockerSwarmEnvFile(data: {
  oneuptimeUrl: string;
  apiKey: string;
  clusterName: string;
}): string {
  return `ONEUPTIME_URL=${data.oneuptimeUrl}
ONEUPTIME_SERVICE_TOKEN=${data.apiKey}
DOCKER_SWARM_CLUSTER_NAME=${data.clusterName}`;
}

/*
 * The line that puts a command in the agent's folder: a `cd` where the
 * install script put it, a comment where the reader chose the folder.
 */
function inAgentFolder(data: GuideData, command: string): string {
  return isScript(data)
    ? `cd ${DOCKER_SWARM_AGENT_INSTALL_DIR}\n${command}`
    : `# In the agent's folder\n${command}`;
}

function getEnvFileName(data: GuideData): string {
  return isScript(data)
    ? `\`${DOCKER_SWARM_AGENT_INSTALL_DIR}/.env\``
    : "the `.env` next to docker-compose.yml";
}

// Where to run `docker compose` commands, in words.
function getAgentFolderName(data: GuideData): string {
  return isScript(data)
    ? `\`${DOCKER_SWARM_AGENT_INSTALL_DIR}\``
    : "the agent's folder";
}

function getPrerequisites(): Array<string> {
  return [
    "A Docker Swarm **manager** node to run it on — the inventory poller calls manager-only API endpoints (`/nodes`, `/services`, `/tasks`)",
    "Docker Engine 20.10+ with the Docker Compose v2 plugin",
  ];
}

function getKeyStep(data: GuideData): SetupGuideKeyStep {
  return {
    description: isScript(data)
      ? "The agent sends the cluster's data to OneUptime with this key. Pick an existing key or create a new one — the install script asks for it, and for the OneUptime URL shown here."
      : "The agent sends the cluster's data to OneUptime with this key. Pick an existing key or create a new one — the .env file below updates to use it.",
  };
}

function getInstallSteps(data: GuideData): Array<SetupGuideStep> {
  const clusterName: ClusterName = data.clusterName;

  if (isScript(data)) {
    const clusterNote: string = clusterName.isKnown
      ? `When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and **\`${clusterName.name}\`** as the cluster name — exactly, or the data registers as a new cluster.`
      : "When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and a name for the cluster, such as `prod-swarm`. The name is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.";

    return [
      {
        title: "Run the install script on a manager node",
        description:
          "It asks for your OneUptime URL, the ingestion key and a cluster name, then starts the agent.",
        markdown: `${codeBlock("bash", getDockerSwarmAgentInstallScriptCommand())}

${clusterNote}

The script puts the agent in \`${DOCKER_SWARM_AGENT_INSTALL_DIR}\` and starts it with Docker Compose.`,
      },
    ];
  }

  const notes: Array<string> = [
    clusterName.isKnown
      ? `This installs the agent for **\`${clusterName.name}\`** — keep \`DOCKER_SWARM_CLUSTER_NAME\` exactly as it is, or the data registers as a new cluster.`
      : `Replace \`${clusterName.name}\` with a name for this cluster, such as \`prod-swarm\`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.`,
  ];

  if (data.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    notes.push(
      `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
    );
  }

  return [
    {
      title: "Download the agent's files",
      description:
        "Run this in an empty folder on a manager node; it downloads the files the install script would.",
      markdown: `${codeBlock("bash", getDockerSwarmAgentDownloadCommand())}

They are the files in the [DockerSwarmAgent directory](${DOCKER_SWARM_AGENT_DIRECTORY_URL}).`,
    },
    {
      title: "Configure and start the agent",
      description:
        "Create a .env file next to the downloaded files, then start the agent.",
      markdown: `${codeBlock(
        "bash",
        getDockerSwarmEnvFile({
          oneuptimeUrl: data.oneuptimeUrl,
          apiKey: data.apiKey,
          clusterName: clusterName.name,
        }),
      )}

${notes.join("\n\n")}

Then start it:

${codeBlock("bash", "docker compose up -d")}`,
    },
  ];
}

function getVerifyStep(data: GuideData): SetupGuideStep {
  return {
    title: "Verify the installation",
    description: "Check that the agent's containers are running.",
    markdown: `${codeBlock(
      "bash",
      inAgentFolder(
        data,
        `docker compose ps
docker compose logs --tail 50 ${DOCKER_SWARM_COLLECTOR_CONTAINER_NAME} ${DOCKER_SWARM_INVENTORY_CONTAINER_NAME}`,
      ),
    )}

\`docker compose ps\` lists three containers: the collector (\`${DOCKER_SWARM_COLLECTOR_CONTAINER_NAME}\`), the inventory poller (\`${DOCKER_SWARM_INVENTORY_CONTAINER_NAME}\`) and the OneUptime AI agent (\`${DOCKER_SWARM_AI_AGENT_CONTAINER_NAME}\`). The cluster appears in the **Docker Swarm** section within a few minutes, and its Nodes, Services, Tasks, Stacks, Networks, Secrets, Configs and Volumes pages fill in after the first inventory snapshot (≤ 5 minutes).

**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only docker commands such as \`docker node ls\` and \`docker service ps\`, and changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced.`,
  };
}

function getAdvancedTopics(data: GuideData): Array<SetupGuideTopic> {
  const script: boolean = isScript(data);
  const envFile: string = getEnvFileName(data);

  return [
    {
      title: "Where to run the agent",
      summary:
        "On a manager node. Run the collector on every node for per-node container metrics.",
      markdown: `Run the agent on a **manager** node: the inventory poller and the OneUptime AI agent call manager-only API endpoints. The collector reports the containers of the node it runs on, so for per-node container metrics run the collector on every node, all with the same \`DOCKER_SWARM_CLUSTER_NAME\`; the inventory poller only needs to run on one manager.${
        script
          ? " Run the install script on a node that is not a manager, and it leaves the OneUptime AI agent out there."
          : ""
      }

Deploying the agent as a swarm stack rather than with Compose? Pin the inventory poller and the AI agent to managers — docker-compose.yml carries this block, commented out, on both services:

${codeBlock(
  "yaml",
  `    deploy:
      placement:
        constraints: [node.role == manager]`,
)}`,
    },
    {
      title: "Environment variables",
      summary: "The settings the collector and the inventory poller read.",
      markdown: `| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${data.oneuptimeUrl}\`) |
| \`ONEUPTIME_SERVICE_TOKEN\` | Yes | The telemetry ingestion key from step 1 |
| \`DOCKER_SWARM_CLUSTER_NAME\` | Yes | The cluster's name in OneUptime, and its join key: stamped on every signal as the \`docker.swarm.cluster.name\` resource attribute. Defaults to \`${DOCKER_SWARM_DEFAULT_CLUSTER_NAME}\` |
| \`DOCKER_INVENTORY_INTERVAL_SECONDS\` | No | How often the poller refreshes the inventory snapshot (default \`${DOCKER_SWARM_DEFAULT_INVENTORY_INTERVAL_SECONDS}\`) |
| \`DOCKER_API_VERSION\` | No | Docker Engine API version the collector and the inventory poller speak (default \`${DOCKER_SWARM_DEFAULT_API_VERSION}\`; see Troubleshooting) |

${
  script
    ? `The install script writes the first three to ${envFile}. Add or change any of them there, then run \`docker compose up -d\` in \`${DOCKER_SWARM_AGENT_INSTALL_DIR}\` to recreate the containers with the new values.`
    : `Set them in ${envFile}, then run \`docker compose up -d\` to recreate the containers with the new values.`
}`,
    },
    {
      title: "The OneUptime AI agent",
      summary:
        "Runs read-only docker commands for OneUptime AI on this cluster. On by default; fixes are opt-in.",
      markdown: `The agent's docker-compose.yml also runs the OneUptime AI agent, \`${DOCKER_SWARM_AI_AGENT_CONTAINER_NAME}\`. It runs the \`docker\` commands OneUptime AI asks for while it investigates an incident or alert on this cluster, and it appears on the cluster's **AI → AI agent** page. Like the inventory poller it must run on a manager node — on a worker it runs nothing.

- **Read-only by default.** It runs commands such as \`docker node ls\`, \`docker service ls\`, \`docker service ps NAME\` and \`docker service logs --tail 200 NAME\` — never \`service create\`/\`rm\`, \`stack deploy\`/\`rm\`, secrets, configs or \`exec\`. Environment values in \`docker service inspect\` output are masked before anything leaves the node.
- **Fixes are opt-in.** Set \`ONEUPTIME_AI_ALLOW_WRITES=true\` in ${envFile} and run \`docker compose up -d\` in ${getAgentFolderName(data)} to let it roll a named service (\`docker service update --force\`), roll it back or scale it. \`ONEUPTIME_AI_FIXES\` in the same file says whether each fix needs approval (\`ask-for-approval\`, \`automatic\` or \`bypass-approval\`), and the cluster's **AI → AI agent** page shows it. Draining a node always needs a person's approval. \`ONEUPTIME_AI_WRITE_TARGETS\` (comma-separated globs of service and node names) limits what fixes may touch; \`ONEUPTIME_AI_PROTECTED_TARGETS\` adds services it must never change. It never changes itself, the collector or the inventory poller.
- It runs as root because the Docker socket is root-owned. The socket's \`:ro\` mount does not make the Docker API read-only — the agent's command policy is the limit.
- ${
        script
          ? "To leave it out, run the install script with `--no-ai-agent`: `sh install.sh --no-ai-agent`."
          : `To leave it out, delete the \`${DOCKER_SWARM_AI_AGENT_CONTAINER_NAME}\` service from docker-compose.yml.`
      }
- Its logs: \`docker compose logs -f ${DOCKER_SWARM_AI_AGENT_CONTAINER_NAME}\`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters).`,
    },
    {
      title: "How the agent works",
      summary:
        "A collector, an inventory poller and the AI agent, in one compose file on a manager node.",
      markdown: `The agent is three containers, all defined in its docker-compose.yml:

1. **Collector** (\`${DOCKER_SWARM_COLLECTOR_CONTAINER_NAME}\`) — the stock \`otel/opentelemetry-collector-contrib\` image with a tuned config. It scrapes \`docker_stats\` for per-container CPU and memory, tails container logs, and tails the inventory snapshot file — stamping everything with \`docker.swarm.cluster.name\` before shipping it to OneUptime over OTLP.
2. **Inventory poller** (\`${DOCKER_SWARM_INVENTORY_CONTAINER_NAME}\`) — a small \`alpine\` + \`curl\` + \`jq\` sidecar that every 5 minutes walks the Swarm manager API (\`/nodes\`, \`/services\`, \`/tasks\`, \`/networks\`, \`/secrets\`, \`/configs\`, \`/volumes\`) and derives stacks from the \`com.docker.stack.namespace\` service label, writing one JSON line per object for the collector to forward.
3. **OneUptime AI agent** (\`${DOCKER_SWARM_AI_AGENT_CONTAINER_NAME}\`) — runs the commands OneUptime AI asks for; see **The OneUptime AI agent** above.`,
    },
    {
      title: "Upgrade or uninstall the agent",
      summary:
        "Fetch the latest agent files and images, or remove the agent from the node.",
      markdown: script
        ? `**Upgrade** — run the install script again. It downloads the latest docker-compose.yml, collector config and inventory poller into \`${DOCKER_SWARM_AGENT_INSTALL_DIR}\`, pulls the images and restarts the agent; answer its questions with the same URL, key and cluster name:

${codeBlock("bash", getDockerSwarmAgentInstallScriptCommand())}

It rewrites \`.env\` from your answers and keeps only the AI agent's target lists and what AI may do (\`ONEUPTIME_AI_INVESTIGATION\`, \`ONEUPTIME_AI_FIXES\`): add back any variable you set yourself, such as \`DOCKER_API_VERSION\`. Turned on AI fixes? Run it as \`ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh\` to keep them on. Left the AI agent out? Pass \`--no-ai-agent\` again.

**Uninstall:**

${codeBlock("bash", `cd ${DOCKER_SWARM_AGENT_INSTALL_DIR}\ndocker compose down`)}`
        : `**Upgrade** — the collector image is pinned in docker-compose.yml and its config is a file next to it, so pulling alone does not move the agent forward. Download the three files again (the commands in step 2 — then re-apply any change you made to docker-compose.yml), and in the agent's folder:

${codeBlock("bash", DOCKER_SWARM_AGENT_COMPOSE_UPGRADE_COMMAND)}

**Uninstall** — in the agent's folder:

${codeBlock("bash", "docker compose down")}`,
    },
    {
      title: "What the agent collects",
      summary:
        "Inventory of nodes, services, tasks and stacks, cluster counts, container metrics and logs.",
      markdown: `| Signal | Source | Powers |
|--------|--------|--------|
| Node / Service / Task / Stack / Network / Secret / Config / Volume inventory | inventory poller → Swarm manager API | the cluster's resource list + detail pages |
| Cluster counts (nodes ready, tasks running, services, stacks, …) | derived from the same snapshot | the overview cards + sidebar badges |
| Container CPU / memory / pids / uptime | \`docker_stats\` receiver | the Metrics tab |
| Container stdout/stderr logs | \`filelog\` receiver | the Logs tab |

The agent deliberately stamps **only** \`docker.swarm.cluster.name\` (not \`host.name\` or \`container.runtime\`), so OneUptime attributes the telemetry to this swarm cluster rather than registering each node as a standalone Host or Docker Host.`,
    },
  ];
}

function getTroubleshootingTopics(data: GuideData): Array<SetupGuideTopic> {
  const envFile: string = getEnvFileName(data);

  return [
    {
      title: "Cluster never appears",
      markdown: `Run the diagnostic script on the manager node. It checks the containers, that the inventory poller is on a manager, the snapshot file, the cluster name and the key — and asks OneUptime directly whether it accepts the ingestion key. A rejected key (\`401\` or \`422\`) otherwise shows only as an easy-to-miss \`Exporting failed\` line in the collector's logs.

${codeBlock("bash", getTroubleshootScriptCommand(data))}

Otherwise, check the collector's logs (\`docker compose logs ${DOCKER_SWARM_COLLECTOR_CONTAINER_NAME}\` in ${getAgentFolderName(data)}), that \`ONEUPTIME_SERVICE_TOKEN\` and \`ONEUPTIME_URL\` in ${envFile} are correct, and that the manager can reach your OneUptime instance.`,
    },
    {
      title: "No inventory appears",
      markdown: `Confirm the poller runs on a manager: \`docker node ls\` must succeed there. Then look for \`failed to emit ...\` lines in its logs:

${codeBlock(
  "bash",
  inAgentFolder(
    data,
    `docker compose logs ${DOCKER_SWARM_INVENTORY_CONTAINER_NAME}`,
  ),
)}`,
    },
    {
      title: 'Status flaps to "Disconnected"',
      markdown: `The cluster is marked disconnected after 15 minutes without telemetry. Make sure the collector container (\`${DOCKER_SWARM_COLLECTOR_CONTAINER_NAME}\`) stays running — \`docker compose ps\` in ${getAgentFolderName(data)} shows it.`,
    },
    {
      title: 'Collector exits with "client version is too new"',
      markdown: `The collector's logs show:

${codeBlock(
  "output",
  `Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41`,
)}

The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. Find the daemon's maximum:

${codeBlock("bash", "docker version --format '{{ .Server.APIVersion }}'")}

Then add \`DOCKER_API_VERSION=1.41\` (or the value you got) to ${envFile} and run \`docker compose up -d\` in ${getAgentFolderName(data)}, on every node the collector runs on. Newer daemons still serve older API versions, so the setting keeps working after you upgrade Docker.

Rather not look the number up? Put \`DOCKER_API_VERSION=\` (empty) in ${envFile} instead, and the collector negotiates the version with the daemon.`,
    },
    {
      title: "Cluster appears under the wrong name",
      markdown: `The cluster's name comes from \`DOCKER_SWARM_CLUSTER_NAME\`. Change it in ${envFile} and run \`docker compose up -d\` in ${getAgentFolderName(data)} — note that a new name registers a new cluster.`,
    },
  ];
}

/**
 * The Docker Swarm agent install guide for one way of installing it, filled
 * in with the reader's OneUptime URL and ingestion key.
 */
export function getDockerSwarmSetupGuide(
  options: DockerSwarmSetupGuideOptions,
): SetupGuideContent {
  const data: GuideData = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    method: options.method,
    clusterName: resolveClusterName(options.clusterName),
  };

  return {
    keyStep: getKeyStep(data),
    prerequisites: getPrerequisites(),
    steps: [...getInstallSteps(data), getVerifyStep(data)],
    advanced: getAdvancedTopics(data),
    troubleshooting: getTroubleshootingTopics(data),
    links: [
      {
        title: "Docker Swarm agent documentation",
        url: "/docs/telemetry/docker-swarm",
      },
      {
        title: "Docker Swarm monitors",
        url: "/docs/monitor/docker-swarm-monitor",
      },
    ],
  };
}
