import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
  shellQuote,
} from "../../../Components/SetupGuide/SetupGuide";

/*
 * The Podman agent install guide. The agent is one container
 * (agents/PodmanAgent): a tuned OpenTelemetry Collector that reads Podman's
 * Docker-compatible API socket and the containers' k8s-file logs. It is
 * started with `podman run` or with `podman compose`, so the guide asks which
 * and shows only that way's commands. PodmanSetupGuide.test.ts checks the
 * image, container name, mounts and variables here against
 * agents/PodmanAgent.
 */

export const PODMAN_AGENT_IMAGE: string = "oneuptime/podman-agent:release";
export const PODMAN_AGENT_CONTAINER_NAME: string = "oneuptime-podman-agent";

// The OneUptime AI agent, which can run beside the collector.
export const PODMAN_AI_AGENT_IMAGE: string =
  "oneuptime/resource-ai-agent:release";
export const PODMAN_AI_AGENT_CONTAINER_NAME: string =
  "oneuptime-podman-ai-agent";

// The name the guide suggests when it is not installing for a known host.
export const PODMAN_EXAMPLE_HOST_NAME: string = "my-podman-host";

/*
 * The name an agent started without PODMAN_HOST_NAME reports: the image's
 * ENV default (agents/PodmanAgent/Dockerfile.tpl).
 */
export const PODMAN_DEFAULT_HOST_NAME: string = "podman-host";

// The Docker API version the agent speaks to the socket unless told otherwise.
export const PODMAN_DEFAULT_API_VERSION: string = "1.44";

// Rootful Podman's Docker-compatible API socket, which the collector reads.
export const PODMAN_SOCKET_PATH: string = "/run/podman/podman.sock";

/*
 * Podman's container storage. The collector tails the k8s-file driver's
 * logs under it (overlay-containers/<id>/userdata/ctr.log), so this is the
 * directory the agent mounts — the same one its compose file and installer
 * mount.
 */
export const PODMAN_STORAGE_PATH: string = "/var/lib/containers/storage";

export type PodmanInstallMethod = "podman-cli" | "podman-compose";

export const PODMAN_INSTALL_METHODS: Array<
  SetupGuideOption<PodmanInstallMethod>
> = [
  {
    key: "podman-cli",
    label: "Podman CLI",
    description: "One podman run command starts the agent.",
  },
  {
    key: "podman-compose",
    label: "Podman Compose",
    description: "A docker-compose.yml you run with podman compose.",
  },
];

export const DEFAULT_PODMAN_INSTALL_METHOD: PodmanInstallMethod = "podman-cli";

export function resolvePodmanInstallMethod(
  method: string | null | undefined,
): PodmanInstallMethod {
  return (
    resolveSetupGuideOption(PODMAN_INSTALL_METHODS, method) ||
    DEFAULT_PODMAN_INSTALL_METHOD
  );
}

export interface PodmanSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  method: PodmanInstallMethod;
  /*
   * The host the guide installs for (a host's own Documentation tab): its
   * identifier, which is the PODMAN_HOST_NAME its agent reports. Omitted on
   * the product pages, where the guide suggests a name instead.
   */
  hostName?: string | undefined;
}

interface HostName {
  name: string;
  isKnown: boolean;
}

function resolveHostName(hostName: string | undefined): HostName {
  const known: string = (hostName || "").trim();
  /*
   * The name is written into a shell command and a YAML list as it is,
   * which is only safe for a plain word. Host identifiers are in practice;
   * anything else gets the example name rather than a command that breaks.
   */
  if (known && shellQuote(known) === known) {
    return { name: known, isKnown: true };
  }
  return { name: PODMAN_EXAMPLE_HOST_NAME, isKnown: false };
}

interface GuideData {
  oneuptimeUrl: string;
  apiKey: string;
  method: PodmanInstallMethod;
  hostName: HostName;
}

function isCli(data: GuideData): boolean {
  return data.method === "podman-cli";
}

export function getPodmanRunCommand(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hostName: string;
}): string {
  return [
    "podman run -d",
    `  --name ${PODMAN_AGENT_CONTAINER_NAME}`,
    "  --user 0:0",
    "  --restart unless-stopped",
    `  -v ${PODMAN_SOCKET_PATH}:${PODMAN_SOCKET_PATH}:ro`,
    `  -v ${PODMAN_STORAGE_PATH}:${PODMAN_STORAGE_PATH}:ro`,
    `  -e ONEUPTIME_URL="${data.oneuptimeUrl}"`,
    `  -e ONEUPTIME_SERVICE_TOKEN="${data.apiKey}"`,
    `  -e PODMAN_HOST_NAME="${data.hostName}"`,
    `  ${PODMAN_AGENT_IMAGE}`,
  ].join(" \\\n");
}

export function getPodmanComposeFile(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hostName: string;
}): string {
  return `services:
  ${PODMAN_AGENT_CONTAINER_NAME}:
    image: ${PODMAN_AGENT_IMAGE}
    container_name: ${PODMAN_AGENT_CONTAINER_NAME}
    user: "0:0"
    restart: unless-stopped
    volumes:
      - ${PODMAN_SOCKET_PATH}:${PODMAN_SOCKET_PATH}:ro
      - ${PODMAN_STORAGE_PATH}:${PODMAN_STORAGE_PATH}:ro
    environment:
      - ONEUPTIME_URL=${data.oneuptimeUrl}
      - ONEUPTIME_SERVICE_TOKEN=${data.apiKey}
      - PODMAN_HOST_NAME=${data.hostName}
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"`;
}

function getAiAgentRunCommand(data: GuideData): string {
  return [
    "podman run -d",
    `  --name ${PODMAN_AI_AGENT_CONTAINER_NAME}`,
    "  --user 0:0",
    "  --restart unless-stopped",
    "  --read-only --tmpfs /tmp",
    `  -v ${PODMAN_SOCKET_PATH}:${PODMAN_SOCKET_PATH}:ro`,
    `  -e ONEUPTIME_URL="${data.oneuptimeUrl}"`,
    `  -e ONEUPTIME_SERVICE_TOKEN="${data.apiKey}"`,
    "  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman",
    `  -e PODMAN_HOST_NAME="${data.hostName.name}"`,
    `  ${PODMAN_AI_AGENT_IMAGE}`,
  ].join(" \\\n");
}

// The AI agent's service, to add under `services:` next to the collector.
function getAiAgentComposeService(data: GuideData): string {
  return `  ${PODMAN_AI_AGENT_CONTAINER_NAME}:
    image: ${PODMAN_AI_AGENT_IMAGE}
    container_name: ${PODMAN_AI_AGENT_CONTAINER_NAME}
    user: "0:0"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - ${PODMAN_SOCKET_PATH}:${PODMAN_SOCKET_PATH}:ro
    environment:
      - ONEUPTIME_URL=${data.oneuptimeUrl}
      - ONEUPTIME_SERVICE_TOKEN=${data.apiKey}
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman
      - PODMAN_HOST_NAME=${data.hostName.name}`;
}

function getHostNameNote(hostName: HostName): string {
  if (hostName.isKnown) {
    return `This installs the agent for **\`${hostName.name}\`** — keep \`PODMAN_HOST_NAME\` exactly as it is, or the data registers as a new host.`;
  }
  return `Replace \`${hostName.name}\` with a name for this host, such as \`prod-podman-01\`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.`;
}

function getKeyNotes(apiKey: string): Array<string> {
  if (apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    return [];
  }
  return [
    `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
  ];
}

const LOG_DRIVER_TOPIC_TITLE: string =
  "Collect logs from every container (k8s-file log driver)";

function getPrerequisites(data: GuideData): Array<string> {
  const lines: Array<string> = [
    "Podman 4.0+",
    `Podman's Docker-compatible API socket at \`${PODMAN_SOCKET_PATH}\` — turn it on with \`sudo systemctl enable --now podman.socket\``,
  ];

  if (!isCli(data)) {
    lines.push(
      "A compose provider for `podman compose`: `podman-compose` or Docker Compose",
    );
  }

  lines.push(
    "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read",
  );

  return lines;
}

function getInstallSteps(data: GuideData): Array<SetupGuideStep> {
  const notes: Array<string> = [
    getHostNameNote(data.hostName),
    ...getKeyNotes(data.apiKey),
  ];
  const values: { oneuptimeUrl: string; apiKey: string; hostName: string } = {
    oneuptimeUrl: data.oneuptimeUrl,
    apiKey: data.apiKey,
    hostName: data.hostName.name,
  };

  if (isCli(data)) {
    return [
      {
        title: "Run the agent",
        description: "Run this on the Podman host you want to monitor.",
        markdown: [
          codeBlock("bash", getPodmanRunCommand(values)),
          ...notes,
        ].join("\n\n"),
      },
    ];
  }

  return [
    {
      title: "Create docker-compose.yml",
      description:
        "Save this as docker-compose.yml in a folder on the Podman host you want to monitor.",
      markdown: [
        codeBlock("yaml", getPodmanComposeFile(values)),
        ...notes,
      ].join("\n\n"),
    },
    {
      title: "Start the agent",
      description: "Run this in the folder that holds docker-compose.yml.",
      markdown: codeBlock("bash", "podman compose up -d"),
    },
  ];
}

function getVerifyStep(): SetupGuideStep {
  return {
    title: "Verify the agent is running",
    description: "Check that the container is up and the collector started.",
    markdown: `${codeBlock(
      "bash",
      `podman ps --filter name=${PODMAN_AGENT_CONTAINER_NAME}\npodman logs -f ${PODMAN_AGENT_CONTAINER_NAME}`,
    )}

Look for this line in the logs:

${codeBlock("output", "Everything is ready. Begin running and processing data.")}

Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so.

**Metrics but no logs?** Rootful Podman writes container logs to \`journald\` by default, which the agent cannot read. Run your containers with \`--log-driver k8s-file\` — see **${LOG_DRIVER_TOPIC_TITLE}** under Advanced.`,
  };
}

function getAdvancedTopics(data: GuideData): Array<SetupGuideTopic> {
  const cli: boolean = isCli(data);

  return [
    {
      title: "Environment variables",
      summary: "Every setting the agent reads, and its default.",
      markdown: `| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${data.oneuptimeUrl}\`) |
| \`ONEUPTIME_SERVICE_TOKEN\` | Yes | The telemetry ingestion key from step 1 |
| \`PODMAN_HOST_NAME\` | No | Friendly name for this host. Defaults to \`${PODMAN_DEFAULT_HOST_NAME}\` |
| \`DOCKER_API_VERSION\` | No | Docker API version the agent speaks to the Podman socket. Defaults to \`${PODMAN_DEFAULT_API_VERSION}\`; set it to the socket's maximum on older hosts, or to an empty value to negotiate it (see Troubleshooting) |

${
  cli
    ? `Pass each one to \`podman run\` as \`-e NAME=value\`. To change one later, remove the agent with \`podman rm -f ${PODMAN_AGENT_CONTAINER_NAME}\` and run the command again with the new value.`
    : "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values."
}`,
    },
    {
      title: LOG_DRIVER_TOPIC_TITLE,
      summary:
        "Rootful Podman logs to journald by default, which the agent cannot read. How to check and switch a container's driver.",
      markdown: `The agent reads the files Podman's **\`k8s-file\`** log driver writes — \`${PODMAN_STORAGE_PATH}/overlay-containers/*/userdata/ctr.log\` — so it only sees logs from containers that use it (or \`json-file\`, which Podman treats as the same file-based driver). Rootful Podman's default is **\`journald\`**, which it cannot read, and neither can it read a remote driver such as \`syslog\`.

Check a container's log driver, and Podman's default:

${codeBlock(
  "bash",
  `podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
podman info --format '{{.Host.LogDriver}}'`,
)}

Run a single container with \`k8s-file\`:

${codeBlock("bash", "podman run --log-driver k8s-file --log-opt max-size=100m ... <image>")}

Switch a Compose service to \`k8s-file\`, with rotation:

${codeBlock(
  "yaml",
  `services:
  my-app:
    image: my-app:latest
    logging:
      driver: "k8s-file"
      options:
        max-size: "100m"`,
)}

Or change the default for every container created afterwards, in \`containers.conf\` (\`/etc/containers/containers.conf\` rootful, \`~/.config/containers/containers.conf\` rootless):

${codeBlock(
  "toml",
  `[containers]
log_driver = "k8s-file"
log_size_max = 104857600`,
)}

Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep \`journald\`? The agent still collects metrics through the socket; only container logs need the file-based driver.`,
    },
    {
      title: "Add the OneUptime AI agent",
      summary:
        "A second container that lets OneUptime AI run read-only docker commands on this host while it investigates.",
      markdown: cli
        ? `The OneUptime AI agent runs the \`docker\` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. The command in step 2 starts the collector only — start the AI agent beside it with the same URL, key and host name:

${codeBlock("bash", getAiAgentRunCommand(data))}

${getAiAgentNotes(data)}`
        : `The OneUptime AI agent runs the \`docker\` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. The file in step 2 starts the collector only — add this service under \`services:\` in the same docker-compose.yml, with the same URL, key and host name:

${codeBlock("yaml", getAiAgentComposeService(data))}

Then run \`podman compose up -d\`.

${getAiAgentNotes(data)}`,
    },
    {
      title: "Pin the image version",
      summary:
        "Run a pinned version or the enterprise image, or pull from the GitHub Container Registry.",
      markdown: `| Tag | Description |
|-----|-------------|
| \`oneuptime/podman-agent:release\` | Latest stable release (community) |
| \`oneuptime/podman-agent:enterprise-release\` | Latest stable release (enterprise) |
| \`oneuptime/podman-agent:<version>\` | A pinned version, e.g. \`10.0.31\` |
| \`ghcr.io/oneuptime/podman-agent:release\` | The same image, mirrored on GHCR |

${
  cli
    ? `Use one in place of \`${PODMAN_AGENT_IMAGE}\` at the end of the \`podman run\` command.`
    : `Use one in place of \`${PODMAN_AGENT_IMAGE}\` on the agent's \`image:\` line.`
}`,
    },
    {
      title: "Upgrade or uninstall the agent",
      summary: "Move to the latest image, or remove the agent from the host.",
      markdown: cli
        ? `**Upgrade** — pull the latest image and remove the running agent:

${codeBlock(
  "bash",
  `podman pull ${PODMAN_AGENT_IMAGE}
podman rm -f ${PODMAN_AGENT_CONTAINER_NAME}`,
)}

Then run the \`podman run\` command from step 2 again. Added the OneUptime AI agent? Upgrade it the same way: \`podman pull ${PODMAN_AI_AGENT_IMAGE}\`, remove it and start it again.

**Uninstall:**

${codeBlock("bash", `podman rm -f ${PODMAN_AGENT_CONTAINER_NAME}`)}

If you added the OneUptime AI agent, remove it too: \`podman rm -f ${PODMAN_AI_AGENT_CONTAINER_NAME}\`.`
        : `**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:

${codeBlock("bash", "podman compose pull\npodman compose up -d")}

**Uninstall** — stop and remove everything the file started:

${codeBlock("bash", "podman compose down")}`,
    },
    {
      title: "What the agent collects",
      summary:
        "CPU, memory, network and block I/O metrics per container, plus container logs.",
      markdown: `| Category | Data |
|----------|------|
| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |
| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |
| **Network Metrics** | Bytes and packets received/transmitted (per container) |
| **Block I/O Metrics** | Read/write bytes and operations (per container) |
| **Container Info** | Uptime, restart count, process count |
| **Container Logs** | stdout/stderr logs from all containers that use the \`k8s-file\` log driver |

The metrics come from the collector's \`docker_stats\` receiver, through Podman's Docker-compatible socket, so their names are the same as the Docker agent's. Each log line gets a severity from the level it names (\`[ERROR]\`, \`level=warn\`, \`{"level":"info"}\`); a line without one falls back to its stream — stderr is \`ERROR\`, stdout is \`INFO\`.`,
    },
  ];
}

function getAiAgentNotes(data: GuideData): string {
  const allowWrites: string = isCli(data)
    ? "Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command"
    : "Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list";

  return `- **Read-only by default.** It runs commands such as \`docker ps\`, \`docker logs --tail 200 NAME\`, \`docker inspect\` and \`docker stats --no-stream\` — never \`exec\`, \`run\`, \`rm\` or \`prune\`. Environment values in \`docker inspect\` output are masked before anything leaves the host.
- **Fixes are opt-in.** ${allowWrites} to let it restart, start, stop, pause, kill or change the limits of a named container, then choose on the host's **AI → AI agent** page whether each fix needs approval. \`ONEUPTIME_AI_WRITE_TARGETS\` (comma-separated globs such as \`web-*,api-*\`) limits which containers; \`ONEUPTIME_AI_PROTECTED_TARGETS\` adds containers it must never change. It never changes itself or the collector.
- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's \`:ro\` mount does not make the API read-only — the agent's command policy is the limit.
- Its logs: \`podman logs -f ${PODMAN_AI_AGENT_CONTAINER_NAME}\`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).`;
}

function getTroubleshootingTopics(data: GuideData): Array<SetupGuideTopic> {
  const cli: boolean = isCli(data);
  const name: string = PODMAN_AGENT_CONTAINER_NAME;

  /*
   * The collector logs to stderr, which `podman logs` passes through as
   * stderr, so a plain `podman logs ... | grep` finds nothing.
   */
  const grepErrors: string = `podman logs ${name} 2>&1 | grep -i error`;

  return [
    {
      title: "Podman socket permission denied",
      markdown: `The agent must run as root to read \`${PODMAN_SOCKET_PATH}\`. Make sure ${
        cli
          ? "the `--user 0:0` flag is in your `podman run` command"
          : 'the agent\'s service has `user: "0:0"` in docker-compose.yml'
      }, and that the socket is on:

${codeBlock("bash", "sudo systemctl enable --now podman.socket")}

That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is \`/run/user/<uid>/podman/podman.sock\` instead (turn it on with \`systemctl --user enable --now podman.socket\`) — see the Podman agent documentation.`,
    },
    {
      title: 'Agent restarts with "client version is too new"',
      markdown: `The agent's logs show:

${codeBlock(
  "output",
  `Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41`,
)}

The agent speaks a pinned Docker API version to the socket (\`${PODMAN_DEFAULT_API_VERSION}\` by default). A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. Find the version the socket reports:

${codeBlock(
  "bash",
  `curl -s -o /dev/null -D - --unix-socket ${PODMAN_SOCKET_PATH} http://localhost/_ping | grep -i '^api-version'`,
)}

${
  cli
    ? `Then remove the agent (\`podman rm -f ${name}\`) and run the command from step 2 again with that version added, e.g. \`-e DOCKER_API_VERSION=1.41\`.`
    : "Then add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`."
} Newer servers still serve older API versions, so the setting keeps working after an upgrade.

Rather not look the number up? Set \`DOCKER_API_VERSION\` to an empty value (${
        cli ? "`-e DOCKER_API_VERSION=`" : "`- DOCKER_API_VERSION=`"
      }) and the agent negotiates the version with the socket.`,
    },
    {
      title: 'Host shows as "Disconnected"',
      markdown: `1. Check that the agent is running: \`podman ps --filter name=${name}\`
2. Check the agent's logs for errors: \`${grepErrors}\`
3. Verify the OneUptime URL and ingestion key ${cli ? "in the `podman run` command" : "in docker-compose.yml"} are correct.
4. Make sure the host can reach your OneUptime instance over the network.`,
    },
    {
      title: "No metrics appearing",
      markdown: `Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:

${codeBlock(
  "bash",
  `podman run --rm --volumes-from ${name} alpine:3.19 ls -la ${PODMAN_SOCKET_PATH}`,
)}

Then look for export errors in the agent's logs — \`${grepErrors}\` — and make sure the ingestion key is valid and has not expired.`,
    },
    {
      title: "No container logs",
      markdown: `Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (\`k8s-file\` or \`json-file\`) — rootful Podman defaults to \`journald\`, which the agent cannot read.

${codeBlock(
  "bash",
  `# 1. The log files the agent is watching
podman logs ${name} 2>&1 | grep -E "Started watching file|no files match"

# 2. The log driver a container uses
podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'

# 3. The log files the agent expects to find
podman run --rm --volumes-from ${name} alpine:3.19 \\
  sh -c 'ls ${PODMAN_STORAGE_PATH}/overlay-containers/*/userdata/ctr.log 2>&1 | head'`,
)}

If step 1 shows \`no files match the configured criteria\`, or step 3 lists no files for your containers, they are not using \`k8s-file\`. Switch them (see **${LOG_DRIVER_TOPIC_TITLE}** under Advanced), then recreate each one — a container keeps the log driver it was created with:

${codeBlock(
  "bash",
  `# A Podman Compose service
podman compose up -d --force-recreate <service>

# A plain podman container
podman rm -f <container>
podman run --log-driver k8s-file ... <image>`,
)}`,
    },
    {
      title: "Logs are ingested but missing from the host's page",
      markdown: `A host's page shows the data whose host name is that host's identifier, which the agent takes from \`PODMAN_HOST_NAME\`. Change \`PODMAN_HOST_NAME\` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:

${codeBlock(
  "bash",
  `podman inspect ${name} --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PODMAN_HOST_NAME`,
)}`,
    },
    {
      title: `Host shows up as "${PODMAN_DEFAULT_HOST_NAME}" or a container ID`,
      markdown: `The host's name comes from \`PODMAN_HOST_NAME\`. An agent started without it reports \`${PODMAN_DEFAULT_HOST_NAME}\`, so every host set up that way looks like the same host. Set \`PODMAN_HOST_NAME\` to a name of its own on each host and ${
        cli
          ? `recreate the agent — \`podman rm -f ${name}\`, then run the command from step 2 with the new name.`
          : "run `podman compose up -d` to recreate the agent with it."
      }`,
    },
  ];
}

/**
 * The Podman agent install guide for one way of running it, filled in with
 * the reader's OneUptime URL and ingestion key.
 */
export function getPodmanSetupGuide(
  options: PodmanSetupGuideOptions,
): SetupGuideContent {
  const data: GuideData = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    method: options.method,
    hostName: resolveHostName(options.hostName),
  };

  return {
    prerequisites: getPrerequisites(data),
    steps: [...getInstallSteps(data), getVerifyStep()],
    advanced: getAdvancedTopics(data),
    troubleshooting: getTroubleshootingTopics(data),
    links: [
      {
        title: "Podman agent documentation",
        url: "/docs/telemetry/podman-host",
      },
      {
        title: "Podman monitors",
        url: "/docs/monitor/podman-monitor",
      },
    ],
  };
}
