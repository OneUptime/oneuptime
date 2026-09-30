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
 * The Docker agent install guide. The agent is one container
 * (agents/DockerAgent): a tuned OpenTelemetry Collector that reads the
 * Docker socket and the containers' json-file logs. It is started with
 * `docker run` or with Docker Compose, so the guide asks which and shows only
 * that way's commands. DockerSetupGuide.test.ts checks the image, container
 * name, mounts and variables here against agents/DockerAgent.
 */

export const DOCKER_AGENT_IMAGE: string = "oneuptime/docker-agent:release";
export const DOCKER_AGENT_CONTAINER_NAME: string = "oneuptime-docker-agent";

// The OneUptime AI agent, which can run beside the collector.
export const DOCKER_AI_AGENT_IMAGE: string =
  "oneuptime/resource-ai-agent:release";
export const DOCKER_AI_AGENT_CONTAINER_NAME: string =
  "oneuptime-docker-ai-agent";

// The name the guide suggests when it is not installing for a known host.
export const DOCKER_EXAMPLE_HOST_NAME: string = "my-docker-host";

/*
 * The name an agent started without DOCKER_HOST_NAME reports: the image's
 * ENV default (agents/DockerAgent/Dockerfile.tpl).
 */
export const DOCKER_DEFAULT_HOST_NAME: string = "docker-host";

// The Docker Engine API version the agent speaks unless told otherwise.
export const DOCKER_DEFAULT_API_VERSION: string = "1.44";

export type DockerInstallMethod = "docker-cli" | "docker-compose";

export const DOCKER_INSTALL_METHODS: Array<
  SetupGuideOption<DockerInstallMethod>
> = [
  {
    key: "docker-cli",
    label: "Docker CLI",
    description: "One docker run command starts the agent.",
  },
  {
    key: "docker-compose",
    label: "Docker Compose",
    description: "A docker-compose.yml you keep with the rest of your stack.",
  },
];

export const DEFAULT_DOCKER_INSTALL_METHOD: DockerInstallMethod = "docker-cli";

export function resolveDockerInstallMethod(
  method: string | null | undefined,
): DockerInstallMethod {
  return (
    resolveSetupGuideOption(DOCKER_INSTALL_METHODS, method) ||
    DEFAULT_DOCKER_INSTALL_METHOD
  );
}

export interface DockerSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  method: DockerInstallMethod;
  /*
   * The host the guide installs for (a host's own Documentation tab): its
   * identifier, which is the DOCKER_HOST_NAME its agent reports. Omitted on
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
  return { name: DOCKER_EXAMPLE_HOST_NAME, isKnown: false };
}

interface GuideData {
  oneuptimeUrl: string;
  apiKey: string;
  method: DockerInstallMethod;
  hostName: HostName;
}

function isCli(data: GuideData): boolean {
  return data.method === "docker-cli";
}

export function getDockerRunCommand(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hostName: string;
}): string {
  return [
    "docker run -d",
    `  --name ${DOCKER_AGENT_CONTAINER_NAME}`,
    "  --user 0:0",
    "  --restart unless-stopped",
    "  -v /var/run/docker.sock:/var/run/docker.sock:ro",
    "  -v /var/lib/docker/containers:/var/lib/docker/containers:ro",
    `  -e ONEUPTIME_URL="${data.oneuptimeUrl}"`,
    `  -e ONEUPTIME_SERVICE_TOKEN="${data.apiKey}"`,
    `  -e DOCKER_HOST_NAME="${data.hostName}"`,
    `  ${DOCKER_AGENT_IMAGE}`,
  ].join(" \\\n");
}

export function getDockerComposeFile(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hostName: string;
}): string {
  return `services:
  ${DOCKER_AGENT_CONTAINER_NAME}:
    image: ${DOCKER_AGENT_IMAGE}
    container_name: ${DOCKER_AGENT_CONTAINER_NAME}
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=${data.oneuptimeUrl}
      - ONEUPTIME_SERVICE_TOKEN=${data.apiKey}
      - DOCKER_HOST_NAME=${data.hostName}
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"`;
}

function getAiAgentRunCommand(data: GuideData): string {
  return [
    "docker run -d",
    `  --name ${DOCKER_AI_AGENT_CONTAINER_NAME}`,
    "  --user 0:0",
    "  --restart unless-stopped",
    "  --read-only --tmpfs /tmp",
    "  -v /var/run/docker.sock:/var/run/docker.sock:ro",
    `  -e ONEUPTIME_URL="${data.oneuptimeUrl}"`,
    `  -e ONEUPTIME_SERVICE_TOKEN="${data.apiKey}"`,
    "  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker",
    `  -e DOCKER_HOST_NAME="${data.hostName.name}"`,
    `  ${DOCKER_AI_AGENT_IMAGE}`,
  ].join(" \\\n");
}

// The AI agent's service, to add under `services:` next to the collector.
function getAiAgentComposeService(data: GuideData): string {
  return `  ${DOCKER_AI_AGENT_CONTAINER_NAME}:
    image: ${DOCKER_AI_AGENT_IMAGE}
    container_name: ${DOCKER_AI_AGENT_CONTAINER_NAME}
    user: "0:0"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - ONEUPTIME_URL=${data.oneuptimeUrl}
      - ONEUPTIME_SERVICE_TOKEN=${data.apiKey}
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker
      - DOCKER_HOST_NAME=${data.hostName.name}`;
}

function getHostNameNote(hostName: HostName): string {
  if (hostName.isKnown) {
    return `This installs the agent for **\`${hostName.name}\`** — keep \`DOCKER_HOST_NAME\` exactly as it is, or the data registers as a new host.`;
  }
  return `Replace \`${hostName.name}\` with a name for this host, such as \`prod-docker-01\`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.`;
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
  "Collect logs from every container (json-file log driver)";

function getPrerequisites(data: GuideData): Array<string> {
  const lines: Array<string> = [
    "Docker Engine 20.10+",
    "Access to `/var/run/docker.sock` on the host",
  ];

  if (!isCli(data)) {
    lines.push("Docker Compose v2 (the `docker compose` command)");
  }

  lines.push(
    "Containers whose logs you want must use the `json-file` log driver — Docker's default",
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
        description: "Run this on the Docker host you want to monitor.",
        markdown: [
          codeBlock("bash", getDockerRunCommand(values)),
          ...notes,
        ].join("\n\n"),
      },
    ];
  }

  return [
    {
      title: "Create docker-compose.yml",
      description:
        "Save this as docker-compose.yml in a folder on the Docker host you want to monitor.",
      markdown: [
        codeBlock("yaml", getDockerComposeFile(values)),
        ...notes,
      ].join("\n\n"),
    },
    {
      title: "Start the agent",
      description: "Run this in the folder that holds docker-compose.yml.",
      markdown: codeBlock("bash", "docker compose up -d"),
    },
  ];
}

function getVerifyStep(): SetupGuideStep {
  return {
    title: "Verify the agent is running",
    description: "Check that the container is up and the collector started.",
    markdown: `${codeBlock(
      "bash",
      `docker ps --filter name=${DOCKER_AGENT_CONTAINER_NAME}\ndocker logs -f ${DOCKER_AGENT_CONTAINER_NAME}`,
    )}

Look for this line in the logs:

${codeBlock("output", "Everything is ready. Begin running and processing data.")}

Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so.`,
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
| \`DOCKER_HOST_NAME\` | No | Friendly name for this host. Defaults to \`${DOCKER_DEFAULT_HOST_NAME}\` |
| \`DOCKER_API_VERSION\` | No | Docker Engine API version the agent speaks. Defaults to \`${DOCKER_DEFAULT_API_VERSION}\`; set it to your daemon's maximum on older hosts, or to an empty value to negotiate it (see Troubleshooting) |

${
  cli
    ? `Pass each one to \`docker run\` as \`-e NAME=value\`. To change one later, remove the agent with \`docker rm -f ${DOCKER_AGENT_CONTAINER_NAME}\` and run the command again with the new value.`
    : "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values."
}`,
    },
    {
      title: LOG_DRIVER_TOPIC_TITLE,
      summary:
        "The agent reads the files Docker's default json-file log driver writes. How to check and switch a container's driver.",
      markdown: `The agent tails \`/var/lib/docker/containers/*/*-json.log\`, so it only sees logs from containers that use Docker's **\`json-file\`** log driver. That is Docker's default, but some hosts switch to \`local\` (binary files the agent cannot parse) or to a remote driver (\`journald\`, \`syslog\`, \`fluentd\`, \`gelf\`, …), which leave no files to read.

Check a container's log driver, and the daemon's default:

${codeBlock(
  "bash",
  `docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
docker info --format '{{.LoggingDriver}}'`,
)}

Switch a Compose service to \`json-file\`, with rotation:

${codeBlock(
  "yaml",
  `services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"`,
)}

Or change the daemon's default for every container created afterwards, in \`/etc/docker/daemon.json\`:

${codeBlock(
  "json",
  `{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}`,
)}

Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.`,
    },
    {
      title: "Add the OneUptime AI agent",
      summary:
        "A second container that lets OneUptime AI run read-only docker commands on this host while it investigates.",
      markdown: cli
        ? `The OneUptime AI agent runs the \`docker\` commands OneUptime AI asks for while it investigates an incident or alert on this host. The command in step 2 starts the collector only — start the AI agent beside it with the same URL, key and host name:

${codeBlock("bash", getAiAgentRunCommand(data))}

${getAiAgentNotes(data)}`
        : `The OneUptime AI agent runs the \`docker\` commands OneUptime AI asks for while it investigates an incident or alert on this host. The file in step 2 starts the collector only — add this service under \`services:\` in the same docker-compose.yml, with the same URL, key and host name:

${codeBlock("yaml", getAiAgentComposeService(data))}

Then run \`docker compose up -d\`.

${getAiAgentNotes(data)}`,
    },
    {
      title: "Pin the image version",
      summary:
        "Run a pinned version or the enterprise image, or pull from the GitHub Container Registry.",
      markdown: `| Tag | Description |
|-----|-------------|
| \`oneuptime/docker-agent:release\` | Latest stable release (community) |
| \`oneuptime/docker-agent:enterprise-release\` | Latest stable release (enterprise) |
| \`oneuptime/docker-agent:<version>\` | A pinned version, e.g. \`10.0.31\` |
| \`ghcr.io/oneuptime/docker-agent:release\` | The same image, mirrored on GHCR |

${
  cli
    ? `Use one in place of \`${DOCKER_AGENT_IMAGE}\` at the end of the \`docker run\` command.`
    : `Use one in place of \`${DOCKER_AGENT_IMAGE}\` on the agent's \`image:\` line.`
}`,
    },
    {
      title: "Upgrade or uninstall the agent",
      summary: "Move to the latest image, or remove the agent from the host.",
      markdown: cli
        ? `**Upgrade** — pull the latest image and remove the running agent:

${codeBlock(
  "bash",
  `docker pull ${DOCKER_AGENT_IMAGE}
docker rm -f ${DOCKER_AGENT_CONTAINER_NAME}`,
)}

Then run the \`docker run\` command from step 2 again. Added the OneUptime AI agent? Upgrade it the same way: \`docker pull ${DOCKER_AI_AGENT_IMAGE}\`, remove it and start it again.

**Uninstall:**

${codeBlock("bash", `docker rm -f ${DOCKER_AGENT_CONTAINER_NAME}`)}

If you added the OneUptime AI agent, remove it too: \`docker rm -f ${DOCKER_AI_AGENT_CONTAINER_NAME}\`.`
        : `**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:

${codeBlock("bash", "docker compose pull\ndocker compose up -d")}

**Uninstall** — stop and remove everything the file started:

${codeBlock("bash", "docker compose down")}`,
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
| **Container Logs** | stdout/stderr logs from all containers |

Each log line gets a severity from the level it names (\`[ERROR]\`, \`level=warn\`, \`{"level":"info"}\`); a line without one falls back to its stream — stderr is \`ERROR\`, stdout is \`INFO\`.`,
    },
  ];
}

function getAiAgentNotes(data: GuideData): string {
  const allowWrites: string = isCli(data)
    ? "Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command"
    : "Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list";

  return `- **Read-only by default.** It runs commands such as \`docker ps\`, \`docker logs --tail 200 NAME\`, \`docker inspect\` and \`docker stats --no-stream\` — never \`exec\`, \`run\`, \`rm\` or \`prune\`. Environment values in \`docker inspect\` output are masked before anything leaves the host.
- **Fixes are opt-in.** ${allowWrites} to let it restart, start, stop, pause, kill or change the limits of a named container, then choose on the host's **AI → AI agent** page whether each fix needs approval. \`ONEUPTIME_AI_WRITE_TARGETS\` (comma-separated globs such as \`web-*,api-*\`) limits which containers; \`ONEUPTIME_AI_PROTECTED_TARGETS\` adds containers it must never change. It never changes itself or the collector.
- It runs as root because the Docker socket is root-owned. The socket's \`:ro\` mount does not make the Docker API read-only — the agent's command policy is the limit.
- Its logs: \`docker logs -f ${DOCKER_AI_AGENT_CONTAINER_NAME}\`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).`;
}

function getTroubleshootingTopics(data: GuideData): Array<SetupGuideTopic> {
  const cli: boolean = isCli(data);
  const name: string = DOCKER_AGENT_CONTAINER_NAME;

  /*
   * The collector logs to stderr, which `docker logs` passes through as
   * stderr, so a plain `docker logs ... | grep` finds nothing.
   */
  const grepErrors: string = `docker logs ${name} 2>&1 | grep -i error`;

  return [
    {
      title: "Docker socket permission denied",
      markdown: cli
        ? `The agent must run as root to read \`/var/run/docker.sock\`. Make sure the \`--user 0:0\` flag is in your \`docker run\` command.`
        : `The agent must run as root to read \`/var/run/docker.sock\`. Make sure the agent's service has \`user: "0:0"\` in docker-compose.yml.`,
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

The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. Find the daemon's maximum:

${codeBlock("bash", "docker version --format '{{ .Server.APIVersion }}'")}

${
  cli
    ? `Then remove the agent (\`docker rm -f ${name}\`) and run the command from step 2 again with that version added, e.g. \`-e DOCKER_API_VERSION=1.41\`.`
    : "Then add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`."
} Newer daemons still serve older API versions, so the setting keeps working after you upgrade Docker.

Rather not look the number up? Set \`DOCKER_API_VERSION\` to an empty value (${
        cli ? "`-e DOCKER_API_VERSION=`" : "`- DOCKER_API_VERSION=`"
      }) and the agent negotiates the version with the daemon.`,
    },
    {
      title: 'Host shows as "Disconnected"',
      markdown: `1. Check that the agent is running: \`docker ps --filter name=${name}\`
2. Check the agent's logs for errors: \`${grepErrors}\`
3. Verify the OneUptime URL and ingestion key ${cli ? "in the `docker run` command" : "in docker-compose.yml"} are correct.
4. Make sure the host can reach your OneUptime instance over the network.`,
    },
    {
      title: "No metrics appearing",
      markdown: `Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:

${codeBlock(
  "bash",
  `docker run --rm --volumes-from ${name} alpine:3.19 ls -la /var/run/docker.sock`,
)}

Then look for export errors in the agent's logs — \`${grepErrors}\` — and make sure the ingestion key is valid and has not expired.`,
    },
    {
      title: "No container logs",
      markdown: `Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the \`json-file\` log driver.

${codeBlock(
  "bash",
  `# 1. The log files the agent is watching
docker logs ${name} 2>&1 | grep -E "Started watching file|no files match"

# 2. The log driver a container uses
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'

# 3. The log files the agent expects to find
docker run --rm --volumes-from ${name} alpine:3.19 \\
  sh -c 'ls /var/lib/docker/containers/*/*-json.log 2>&1 | head'`,
)}

If step 1 shows \`no files match the configured criteria\`, or step 3 lists no files for your containers, they are not using \`json-file\`. Switch them (see **${LOG_DRIVER_TOPIC_TITLE}** under Advanced), then recreate each one — a container keeps the log driver it was created with:

${codeBlock(
  "bash",
  `# A Docker Compose service
docker compose up -d --force-recreate <service>

# A plain docker container
docker rm -f <container>
docker run ... <image>`,
)}`,
    },
    {
      title: "Logs are ingested but missing from the host's page",
      markdown: `A host's page shows the data whose host name is that host's identifier, which the agent takes from \`DOCKER_HOST_NAME\`. Change \`DOCKER_HOST_NAME\` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:

${codeBlock(
  "bash",
  `docker inspect ${name} --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DOCKER_HOST_NAME`,
)}`,
    },
    {
      title: `Host shows up as "${DOCKER_DEFAULT_HOST_NAME}" or a container ID`,
      markdown: `The host's name comes from \`DOCKER_HOST_NAME\`. An agent started without it reports \`${DOCKER_DEFAULT_HOST_NAME}\`, so every host set up that way looks like the same host. Set \`DOCKER_HOST_NAME\` to a name of its own on each host and ${
        cli
          ? `recreate the agent — \`docker rm -f ${name}\`, then run the command from step 2 with the new name.`
          : "run `docker compose up -d` to recreate the agent with it."
      }`,
    },
  ];
}

/**
 * The Docker agent install guide for one way of running it, filled in with
 * the reader's OneUptime URL and ingestion key.
 */
export function getDockerSetupGuide(
  options: DockerSetupGuideOptions,
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
        title: "Docker agent documentation",
        url: "/docs/telemetry/docker-host",
      },
      {
        title: "Docker monitors",
        url: "/docs/monitor/docker-monitor",
      },
    ],
  };
}
