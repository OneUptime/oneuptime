import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
  shellQuote,
} from "../../../Components/SetupGuide/SetupGuide";

/*
 * The in-app install guide for the OneUptime Ceph agent (agents/CephAgent):
 * a stock OpenTelemetry collector that scrapes the mgr prometheus module on
 * every mgr daemon, plus the OneUptime AI agent next to it. The guide asks
 * how to install it and shows only that path; everything else is folded
 * under Advanced and Troubleshooting.
 */

export type CephInstallMethod = "install-script" | "docker-compose";

export const CEPH_INSTALL_METHODS: Array<SetupGuideOption<CephInstallMethod>> =
  [
    {
      key: "install-script",
      label: "Install script",
      description:
        "One command downloads the agent, asks for your cluster's details and starts it.",
      badge: "Recommended",
    },
    {
      key: "docker-compose",
      label: "Docker Compose",
      description:
        "Download two files, write a .env file and start the agent yourself.",
    },
  ];

export const DEFAULT_CEPH_INSTALL_METHOD: CephInstallMethod = "install-script";

export function resolveCephInstallMethod(
  method: string | null | undefined,
): CephInstallMethod {
  return (
    resolveSetupGuideOption(CEPH_INSTALL_METHODS, method) ||
    DEFAULT_CEPH_INSTALL_METHOD
  );
}

// Where the agent's files are published, and where install.sh puts them.
export const CEPH_AGENT_RAW_URL: string =
  "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent";
export const CEPH_AGENT_SOURCE_URL: string =
  "https://github.com/OneUptime/oneuptime/tree/master/agents/CephAgent";
export const CEPH_AGENT_INSTALL_DIR: string = "/opt/oneuptime-ceph-agent";

// The containers docker-compose.yml runs (their container_name).
export const CEPH_AGENT_CONTAINER: string = "oneuptime-ceph-agent";
export const CEPH_AI_AGENT_CONTAINER: string = "oneuptime-ceph-ai-agent";

// The name the guide suggests when it is not installing for a known cluster.
export const CEPH_EXAMPLE_CLUSTER_NAME: string = "my-ceph-cluster";
export const CEPH_EXAMPLE_MGR_ENDPOINTS: string =
  "[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]";

/*
 * agents/CephAgent/otel-collector-config.yaml, verbatim — the guide shows
 * the reader the exact file the agent runs. CephSetupGuide.test.ts fails
 * when the shipped file changes and this copy does not.
 */
export const CEPH_AGENT_COLLECTOR_CONFIG: string = `receivers:
  # Scrape the Ceph mgr prometheus module (\`ceph mgr module enable
  # prometheus\`, default port 9283) on EVERY mgr — active and standbys.
  # Only the active mgr returns metrics; standbys answer with an empty
  # response (or an HTTP error if mgr/prometheus/standby_behaviour is set
  # to "error"), so scraping all of them survives mgr failover with no
  # config change.
  prometheus:
    config:
      scrape_configs:
        - job_name: oneuptime-ceph
          # Keep the labels Ceph exports (ceph_daemon, pool_id, etc.).
          # Without honor_labels the instance label is rewritten per
          # scrape target and flips every time the active mgr changes,
          # breaking series continuity.
          honor_labels: true
          # The mgr prometheus module caches a scrape for
          # mgr/prometheus/scrape_interval (default 15s). Never scrape
          # more often than that cache interval — 30s is a comfortable
          # default for a production cluster.
          scrape_interval: 30s
          static_configs:
            # CEPH_MGR_ENDPOINTS is a comma-separated list of host:port
            # pairs wrapped in square brackets so the collector parses it
            # as a list, e.g.
            #   CEPH_MGR_ENDPOINTS=[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]
            - targets: \${env:CEPH_MGR_ENDPOINTS}

  # Optional: tail the Ceph cluster log and ship it to OneUptime — this is
  # what powers the Cluster Log page of the Ceph dashboard. Off by default
  # because it requires the agent to run on a host that has
  # /var/log/ceph/ceph.log (a mon host by default) AND the directory
  # mounted into the container — uncomment the matching volume in
  # docker-compose.yml:
  #   - /var/log/ceph:/var/log/ceph:ro
  # Then uncomment this receiver and the \`logs\` pipeline at the bottom of
  # this file. Lines ship verbatim; OneUptime parses the ceph.log format
  # (timestamp, daemon, INF/WRN/ERR level, message) at read time, and the
  # resource processor below stamps \`ceph.cluster.name\` so the log lands
  # on this cluster.
  # filelog:
  #   include:
  #     - /var/log/ceph/ceph.log
  #   # Tail from the end so an agent restart does not re-ship the file.
  #   start_at: end

processors:
  # Stamp every metric with the cluster identity. OneUptime auto-registers
  # the Ceph cluster from \`ceph.cluster.name\`, and every Ceph page and
  # monitor scopes on it — this attribute is what makes the data appear
  # under the Ceph section of the dashboard. Keep it stable: changing it
  # later registers a brand-new cluster.
  resource:
    attributes:
      - key: ceph.cluster.name
        value: "\${env:CEPH_CLUSTER_NAME}"
        action: upsert
      # Shown as the agent version on the cluster's page, with a sign when
      # a newer one is out. Keep it in step with the collector image
      # docker-compose.yml pins.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # Optionally also stamp the cluster fsid (\`ceph fsid\`). Uncomment
      # and set CEPH_CLUSTER_FSID in the .env file:
      # - key: ceph.cluster.fsid
      #   value: "\${env:CEPH_CLUSTER_FSID}"
      #   action: upsert
      # The prometheus receiver synthesizes service.name (= the scrape job
      # name, "oneuptime-ceph") and service.instance.id on every batch per
      # the Prometheus->OTLP compatibility spec. Drop them: OneUptime
      # routes batches by service.name first, so leaving them in would
      # register a phantom "oneuptime-ceph" Service instead of routing
      # this data to the Ceph cluster discovered from \`ceph.cluster.name\`
      # (which would also break per-cluster retention settings). Do not
      # remove these two deletes.
      - key: service.name
        action: delete
      - key: service.instance.id
        action: delete
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [memory_limiter, resource, batch]
      exporters: [otlphttp]
    # Uncomment together with the filelog receiver above to ship the Ceph
    # cluster log (powers the Cluster Log page):
    # logs:
    #   receivers: [filelog]
    #   processors: [memory_limiter, resource, batch]
    #   exporters: [otlphttp]
`;

export interface CephSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  // False while no key is picked and `apiKey` is the placeholder.
  hasApiKey: boolean;
  method: CephInstallMethod;
  /*
   * The cluster the guide installs for (a cluster's own Documentation tab).
   * Omitted on the product pages, where the guide suggests a name instead.
   */
  clusterName?: string | undefined;
}

interface GuideContext {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  method: CephInstallMethod;
  clusterName: string;
  isClusterNameKnown: boolean;
}

/*
 * install.sh prompts only for the values its environment does not already
 * hold, so the command can carry the reader's URL and key. Only a real key
 * goes there: the script writes whatever it is given into .env, and a
 * placeholder would become the key the agent sends.
 */
export function getCephInstallScriptCommand(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
}): string {
  const environment: Array<string> = [];

  if (data.hasApiKey && data.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    if (data.oneuptimeUrl !== SETUP_GUIDE_URL_PLACEHOLDER) {
      environment.push(`ONEUPTIME_URL=${shellQuote(data.oneuptimeUrl)}`);
    }
    environment.push(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${shellQuote(data.apiKey)}`,
    );
  }

  return [
    `curl -sSL ${CEPH_AGENT_RAW_URL}/install.sh -o install.sh`,
    [...environment, "bash install.sh"].join(" "),
  ].join("\n");
}

function isPrefilled(context: GuideContext): boolean {
  return (
    context.hasApiKey && context.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER
  );
}

/*
 * Commands that run in the agent's folder: install.sh installs into
 * /opt/oneuptime-ceph-agent by default, a Compose install lives wherever
 * the reader put it.
 */
function inAgentFolder(
  method: CephInstallMethod,
  commands: Array<string>,
): string {
  if (method === "install-script") {
    return [`cd ${CEPH_AGENT_INSTALL_DIR}`, ...commands].join("\n");
  }
  return commands.join("\n");
}

/*
 * The commands that upgrade the agent. The collector image is pinned in
 * docker-compose.yml and its config is a file beside it, so an upgrade
 * downloads both again and recreates the containers: Compose recreates a
 * container for a new image or environment, never for a new config file,
 * and the collector reads its config only when it starts. The .env and the
 * AI agent's ./ceph folder stay. The guide's "Upgrade or uninstall the
 * agent" topic and the dialog beside an outdated agent version
 * (Components/AgentVersion) both show these.
 */
export function getCephAgentDownloadCommand(method: CephInstallMethod): string {
  return inAgentFolder(method, [
    `curl -fsSLO ${CEPH_AGENT_RAW_URL}/docker-compose.yml`,
    `curl -fsSLO ${CEPH_AGENT_RAW_URL}/otel-collector-config.yaml`,
  ]);
}

export function getCephAgentRecreateCommand(method: CephInstallMethod): string {
  return inAgentFolder(method, [
    "docker compose pull",
    "docker compose up -d --force-recreate",
  ]);
}

function agentFolder(method: CephInstallMethod): string {
  return method === "install-script"
    ? `\`${CEPH_AGENT_INSTALL_DIR}\``
    : "the folder with `docker-compose.yml`";
}

function getPrerequisites(): Array<string> {
  return [
    "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283",
    "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights",
  ];
}

function getEnableModuleStep(): SetupGuideStep {
  return {
    title: "Enable the mgr prometheus module",
    description:
      "Every mgr daemon then serves metrics on port 9283. Run these on a Ceph admin node.",
    markdown: `${codeBlock("bash", "ceph mgr module enable prometheus")}

Then list your mgr daemons — the agent needs **all** of them, active and standbys:

${codeBlock(
  "bash",
  `ceph mgr stat                    # active mgr
ceph orch ps --daemon-type mgr   # all mgrs (cephadm clusters)`,
)}

Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.`,
  };
}

function getClusterNameNote(context: GuideContext): string {
  if (context.isClusterNameKnown) {
    return `This installs the agent for **\`${context.clusterName}\`** — keep \`CEPH_CLUSTER_NAME\` exactly as it is, or the data registers as a new cluster.`;
  }
  return `Replace \`${context.clusterName}\` with a name for this cluster, such as \`ceph-prod\`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.`;
}

function getInstallScriptStep(context: GuideContext): SetupGuideStep {
  const prefilled: boolean = isPrefilled(context);

  const clusterNamePrompt: string = context.isClusterNameKnown
    ? `**Cluster name** — enter **\`${context.clusterName}\`** exactly; a different name registers a new cluster.`
    : "**Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.";

  return {
    title: "Install the agent",
    description:
      "Download the install script and run it on the machine that will host the agent.",
    markdown: `${codeBlock(
      "bash",
      getCephInstallScriptCommand({
        oneuptimeUrl: context.oneuptimeUrl,
        apiKey: context.apiKey,
        hasApiKey: context.hasApiKey,
      }),
    )}

${
  prefilled
    ? "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:"
    : "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:"
}

- ${clusterNamePrompt}
- **Mgr endpoints** — every mgr from the previous step as comma-separated \`host:port\`, e.g. \`ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283\`. The script adds the square brackets.
- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where \`ceph\` works with admin rights, the script also offers to create the AI agent's own Ceph client.

It installs to \`${CEPH_AGENT_INSTALL_DIR}\` and starts the agent with Docker Compose.`,
  };
}

function getDockerComposeStep(context: GuideContext): SetupGuideStep {
  const notes: Array<string> = [
    getClusterNameNote(context),
    "List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.",
  ];

  return {
    title: "Install the agent",
    description:
      "Download the agent's files, write its settings to a .env file and start it with Docker Compose.",
    markdown: `Download \`docker-compose.yml\` and \`otel-collector-config.yaml\` from the [CephAgent directory](${CEPH_AGENT_SOURCE_URL}) into a new folder:

${codeBlock(
  "bash",
  `mkdir oneuptime-ceph-agent && cd oneuptime-ceph-agent
${getCephAgentDownloadCommand("docker-compose")}`,
)}

Create a \`.env\` file next to them:

${codeBlock(
  "bash",
  `ONEUPTIME_URL=${context.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${context.apiKey}
CEPH_CLUSTER_NAME=${shellQuote(context.clusterName)}
CEPH_MGR_ENDPOINTS=${CEPH_EXAMPLE_MGR_ENDPOINTS}`,
)}

${notes
  .map((note: string): string => {
    return `- ${note}`;
  })
  .join("\n")}

Start the agent:

${codeBlock("bash", "docker compose up -d")}${
      context.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER
        ? `

Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`
        : ""
    }`,
  };
}

function getVerifyStep(context: GuideContext): SetupGuideStep {
  const aiAgent: string =
    context.method === "install-script"
      ? `Docker Compose also runs **\`${CEPH_AI_AGENT_CONTAINER}\`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.`
      : `Docker Compose also starts **\`${CEPH_AI_AGENT_CONTAINER}\`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from \`docker-compose.yml\` if you do not use OneUptime AI.`;

  return {
    title: "Verify the installation",
    description: "Check that the collector is running and ready.",
    markdown: `${codeBlock(
      "bash",
      `docker ps --filter name=${CEPH_AGENT_CONTAINER}
docker logs -f ${CEPH_AGENT_CONTAINER}`,
    )}

Look for \`Everything is ready. Begin running and processing data.\` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.

${aiAgent}

**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only \`ceph\` commands, and changes nothing unless you allow fixes.`,
  };
}

function getEnvironmentVariablesTopic(context: GuideContext): SetupGuideTopic {
  const where: string =
    context.method === "install-script"
      ? `The install script writes these to \`${CEPH_AGENT_INSTALL_DIR}/.env\`.`
      : "The agent reads these from the `.env` file next to `docker-compose.yml`.";

  const bracketsNote: string =
    context.method === "install-script"
      ? ". The install script adds the brackets for you"
      : "";

  return {
    title: "Environment variables",
    summary: "Every setting the collector reads from its .env file.",
    markdown: `${where} After changing one, apply it with \`docker compose up -d\` in ${agentFolder(context.method)}.

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${context.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key — the one picked in step 1 |
| \`CEPH_CLUSTER_NAME\` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the \`ceph.cluster.name\` resource attribute. Keep it stable — changing it registers a new cluster (default: \`ceph\`) |
| \`CEPH_MGR_ENDPOINTS\` | Yes | Comma-separated \`host:port\` list of **all** mgr daemons, wrapped in square brackets, e.g. \`[ceph-mon-1:9283,ceph-mon-2:9283]\`${bracketsNote} |

The OneUptime AI agent's own settings are under **OneUptime AI agent**.`,
  };
}

function getCollectorConfigTopic(): SetupGuideTopic {
  return {
    title: "How the agent scrapes, and its collector config",
    summary:
      "Every mgr every 30 seconds with the labels Ceph exports, and the full otel-collector-config.yaml.",
    markdown: `- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.
- **Every 30 seconds.** The mgr prometheus module caches a scrape for \`mgr/prometheus/scrape_interval\` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.
- **\`honor_labels: true\`** keeps the labels Ceph exports (\`ceph_daemon\`, \`pool_id\`) as they are, so series stay continuous across mgr failovers.

This is the full \`otel-collector-config.yaml\` the agent runs; the \`.env\` file supplies the \`\${env:...}\` values:

${codeBlock("yaml", CEPH_AGENT_COLLECTOR_CONFIG)}`,
  };
}

function getClusterLogTopic(context: GuideContext): SetupGuideTopic {
  return {
    title: "Ship the Ceph cluster log",
    summary:
      "Tail /var/log/ceph/ceph.log on a mon host to fill the Cluster Log page.",
    markdown: `The agent can tail \`/var/log/ceph/ceph.log\` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.

1. In \`otel-collector-config.yaml\`, uncomment the \`filelog\` receiver and the \`logs\` pipeline.
2. In \`docker-compose.yml\`, uncomment the \`/var/log/ceph:/var/log/ceph:ro\` volume.
3. Apply both:

${codeBlock("bash", inAgentFolder(context.method, ["docker compose up -d"]))}

Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the \`resource\` processor stamps \`ceph.cluster.name\` so the log lands on this cluster.`,
  };
}

function getLabelsTopic(context: GuideContext): SetupGuideTopic {
  return {
    title: "Tag the cluster with project labels",
    summary:
      "Attach labels such as team or environment to the cluster from the collector config.",
    markdown: `Any resource attribute prefixed with \`oneuptime.label.\` becomes a project label on the cluster: \`oneuptime.label.<dimension>=<value>\` is the label \`<dimension>:<value>\`. Add them to the \`resource\` processor in \`otel-collector-config.yaml\`, next to \`ceph.cluster.name\`:

${codeBlock(
  "yaml",
  `processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: storage
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert`,
)}

Then restart the collector so it reads the new config:

${codeBlock(
  "bash",
  inAgentFolder(context.method, [
    `docker compose restart ${CEPH_AGENT_CONTAINER}`,
  ]),
)}

The cluster shows up tagged \`team:storage\` and \`env:production\`. Labels are matched case-insensitively, so an existing \`Production\` label is reused; labels added in the OneUptime UI are never removed by the agent.`,
  };
}

function getCollectedDataTopic(): SetupGuideTopic {
  return {
    title: "What the agent collects",
    summary: "Cluster health, OSDs, pools and placement groups.",
    markdown: `The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:

| Category | Data |
|----------|------|
| **Cluster Health** | \`ceph_health_status\` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |
| **OSD** | Up / in state for every OSD (per \`ceph_daemon\` label, e.g. \`osd.3\`) |
| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |
| **Placement Groups** | Active, degraded, and undersized PG counts |`,
  };
}

function getAiAgentTopic(context: GuideContext): SetupGuideTopic {
  const setupIntro: string =
    context.method === "install-script"
      ? "The install script offers to create them when `ceph` works with admin rights on the machine you run it on. Otherwise, on a Ceph admin node:"
      : "On a Ceph admin node, in the agent's folder:";

  return {
    title: "OneUptime AI agent",
    summary:
      "The container that lets OneUptime AI run read-only ceph commands while it investigates an incident.",
    markdown: `\`docker-compose.yml\` also runs **\`${CEPH_AI_AGENT_CONTAINER}\`**. While OneUptime AI investigates an incident or alert on this cluster, it runs \`ceph\` commands through it — \`ceph health detail\`, \`ceph osd tree\`, \`ceph pg dump_stuck\`, \`ceph crash ls\`. It registers as the cluster named \`CEPH_CLUSTER_NAME\` and appears on the cluster's **AI → AI agent** page.

It connects as its own Ceph client, \`client.oneuptime-ai\`, with the cluster's minimal \`ceph.conf\` and that client's keyring in a \`ceph/\` folder next to \`docker-compose.yml\`. ${setupIntro}

${codeBlock(
  "bash",
  inAgentFolder(context.method, [
    "mkdir -p ceph",
    "ceph config generate-minimal-conf > ceph/ceph.conf",
    "ceph auth get-or-create client.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r' -o ceph/ceph.client.oneuptime-ai.keyring",
    "sudo chown 1000:1000 ceph/ceph.client.oneuptime-ai.keyring",
    "sudo chmod 600 ceph/ceph.client.oneuptime-ai.keyring",
    "docker compose up -d",
  ]),
)}

If the agent runs on another machine, copy the two files into its \`ceph/\` folder the same way. **Never put the admin keyring there.**

- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing \`noout\` — also need \`ONEUPTIME_AI_ALLOW_WRITES=true\` in \`.env\` and the fixes caps from the agent's README.
- Check it: \`docker exec ${CEPH_AI_AGENT_CONTAINER} wget -qO- http://127.0.0.1:3877/status\`
- Not using OneUptime AI? Delete the \`${CEPH_AI_AGENT_CONTAINER}\` service from \`docker-compose.yml\`.

What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).`,
  };
}

function getUpgradeTopic(context: GuideContext): SetupGuideTopic {
  const where: string =
    context.method === "install-script"
      ? ""
      : "Run these in the agent's folder, the one with `docker-compose.yml`.\n\n";

  return {
    title: "Upgrade or uninstall the agent",
    summary:
      "Download the latest files and recreate the agent, or stop and remove it.",
    markdown: `${where}**Upgrade** — the collector image is pinned in \`docker-compose.yml\` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your \`.env\` stays, and a change you made to either file has to be made again:

${codeBlock("bash", getCephAgentDownloadCommand(context.method))}

Then pull the images and recreate the agent, so the collector reads its new config:

${codeBlock("bash", getCephAgentRecreateCommand(context.method))}

The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.

**Uninstall** the agent:

${codeBlock("bash", inAgentFolder(context.method, ["docker compose down"]))}

If you created the AI agent's Ceph client, remove it on an admin node: \`ceph auth del client.oneuptime-ai\`.`,
  };
}

function getAdvancedTopics(context: GuideContext): Array<SetupGuideTopic> {
  return [
    getEnvironmentVariablesTopic(context),
    getCollectorConfigTopic(),
    getClusterLogTopic(context),
    getLabelsTopic(context),
    getCollectedDataTopic(),
    getAiAgentTopic(context),
    getUpgradeTopic(context),
  ];
}

function getTroubleshootingTopics(
  context: GuideContext,
): Array<SetupGuideTopic> {
  const runScript: string =
    context.method === "install-script"
      ? "bash troubleshoot.sh"
      : 'bash troubleshoot.sh -d "$PWD"    # in the folder with docker-compose.yml';

  const knownName: string = context.isClusterNameKnown
    ? ` This cluster is **\`${context.clusterName}\`**.`
    : "";

  return [
    {
      title: "Run the diagnostic script first",
      markdown: `\`troubleshoot.sh\` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with \`401\` or \`422\`, which the collector logs as a single \`Exporting failed\` line per batch that is easy to miss, so the script asks \`GET /otlp/v1/validate\` for a direct 200/401 verdict.

${codeBlock(
  "bash",
  `curl -sSL ${CEPH_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh
${runScript}`,
)}

It ends with a verdict naming the most likely cause.`,
    },
    {
      title: "No cluster appears in OneUptime",
      markdown: `1. Check the collector logs: \`docker logs ${CEPH_AGENT_CONTAINER}\` — look for export errors (\`401\` means a bad ingestion key, connection refused means a wrong \`ONEUPTIME_URL\`).
2. Verify a mgr endpoint serves metrics: \`curl http://<active-mgr>:9283/metrics | head\` — you should see \`ceph_*\` metric lines. If not, enable the module: \`ceph mgr module enable prometheus\`.
3. Make sure \`CEPH_MGR_ENDPOINTS\` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.`,
    },
    {
      title: 'Cluster shows as "Disconnected"',
      markdown: `1. Check that the agent is running: \`docker ps --filter name=${CEPH_AGENT_CONTAINER}\`
2. Check the agent logs for errors: \`docker logs ${CEPH_AGENT_CONTAINER} 2>&1 | grep -i error\`
3. Verify your OneUptime URL and ingestion key are correct.
4. Ensure the agent machine can reach the OneUptime instance over the network.`,
    },
    {
      title: "Metrics stop after a mgr failover",
      markdown:
        "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.",
    },
    {
      title: "Scrape errors for standby mgrs in the collector logs",
      markdown:
        "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.",
    },
    {
      title: "Cluster appears under the wrong name",
      markdown: `The cluster's identity comes from \`CEPH_CLUSTER_NAME\`, stamped on every metric as \`ceph.cluster.name\`.${knownName} Fix it in \`.env\` and apply it with \`docker compose up -d\` in ${agentFolder(context.method)} — note that a new name registers a new cluster.`,
    },
  ];
}

/**
 * The Ceph agent install guide for one install method, filled in with the
 * reader's OneUptime URL and ingestion key.
 */
export function getCephSetupGuide(
  options: CephSetupGuideOptions,
): SetupGuideContent {
  const knownClusterName: string = (options.clusterName || "").trim();

  const context: GuideContext = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    hasApiKey: options.hasApiKey,
    method: options.method,
    clusterName: knownClusterName || CEPH_EXAMPLE_CLUSTER_NAME,
    isClusterNameKnown: Boolean(knownClusterName),
  };

  return {
    prerequisites: getPrerequisites(),
    steps: [
      getEnableModuleStep(),
      context.method === "install-script"
        ? getInstallScriptStep(context)
        : getDockerComposeStep(context),
      getVerifyStep(context),
    ],
    advanced: getAdvancedTopics(context),
    troubleshooting: getTroubleshootingTopics(context),
    links: [
      {
        title: "Ceph agent documentation",
        url: "/docs/telemetry/ceph",
      },
      {
        title: "Ceph monitors and alerts",
        url: "/docs/monitor/ceph-monitor",
      },
    ],
  };
}
