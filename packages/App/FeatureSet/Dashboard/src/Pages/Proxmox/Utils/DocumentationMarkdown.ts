import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideKeyStep,
  SetupGuideLink,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
  shellQuote,
} from "../../../Components/SetupGuide/SetupGuide";

/*
 * The in-app guide for connecting a Proxmox VE cluster. Two ways in:
 *
 *   - the OneUptime Proxmox agent (agents/ProxmoxAgent): a stock
 *     OpenTelemetry collector that scrapes prometheus-pve-exporter, plus the
 *     OneUptime AI agent — installed with the install script or by hand with
 *     Docker Compose;
 *   - Proxmox VE 9's own OpenTelemetry metric server, which pushes each
 *     node's metrics with nothing to install, but without HA state, backup
 *     coverage or replication.
 *
 * The guide asks which one and shows only that path.
 */

export type ProxmoxConnectMethod =
  | "install-script"
  | "docker-compose"
  | "native-push";

export const PROXMOX_CONNECT_METHODS: Array<
  SetupGuideOption<ProxmoxConnectMethod>
> = [
  {
    key: "install-script",
    label: "Install script",
    description:
      "One command downloads the agent and its exporter, asks for your API details and starts them.",
    badge: "Recommended",
  },
  {
    key: "docker-compose",
    label: "Docker Compose",
    description:
      "Download two files, write a .env file and start the agent yourself.",
  },
  {
    key: "native-push",
    label: "Native push (Proxmox VE 9+)",
    description:
      "Nothing to install: Proxmox VE sends metrics itself, without HA, backup or replication data.",
  },
];

export const DEFAULT_PROXMOX_CONNECT_METHOD: ProxmoxConnectMethod =
  "install-script";

export function resolveProxmoxConnectMethod(
  method: string | null | undefined,
): ProxmoxConnectMethod {
  return (
    resolveSetupGuideOption(PROXMOX_CONNECT_METHODS, method) ||
    DEFAULT_PROXMOX_CONNECT_METHOD
  );
}

export type ProxmoxAgentInstallMethod = Exclude<
  ProxmoxConnectMethod,
  "native-push"
>;

// Where the agent's files are published, and where install.sh puts them.
export const PROXMOX_AGENT_RAW_URL: string =
  "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/ProxmoxAgent";
export const PROXMOX_AGENT_SOURCE_URL: string =
  "https://github.com/OneUptime/oneuptime/tree/master/agents/ProxmoxAgent";
export const PROXMOX_AGENT_INSTALL_DIR: string = "/opt/oneuptime-proxmox-agent";

/*
 * The collector image agents/ProxmoxAgent/docker-compose.yml pins, which
 * its config reports as the agent's version. The journald wrapper image
 * below is built on it too.
 */
export const PROXMOX_AGENT_COLLECTOR_IMAGE: string =
  "otel/opentelemetry-collector-contrib:0.161.0";

// The containers docker-compose.yml runs (their container_name).
export const PROXMOX_AGENT_CONTAINER: string = "oneuptime-proxmox-agent";
export const PROXMOX_EXPORTER_CONTAINER: string = "oneuptime-pve-exporter";
export const PROXMOX_AI_AGENT_CONTAINER: string = "oneuptime-proxmox-ai-agent";

// The name the guide suggests when it is not installing for a known cluster.
export const PROXMOX_EXAMPLE_CLUSTER_NAME: string = "my-proxmox-cluster";

// The token the "Create a read-only API token" step creates.
export const PROXMOX_TOKEN_USER: string = "monitoring@pam";
export const PROXMOX_TOKEN_ID: string = `${PROXMOX_TOKEN_USER}!oneuptime`;

// Where Proxmox VE's own OpenTelemetry metric server sends metrics.
export const PROXMOX_NATIVE_PUSH_PATH: string = "/otlp/v1/metrics";
export const PROXMOX_PUSH_HOST_PLACEHOLDER: string = "<YOUR_ONEUPTIME_HOST>";

/*
 * agents/ProxmoxAgent/otel-collector-config.yaml, verbatim — the guide shows
 * the reader the exact file the agent runs. ProxmoxSetupGuide.test.ts fails
 * when the shipped file changes and this copy does not.
 */
export const PROXMOX_AGENT_COLLECTOR_CONFIG: string = `receivers:
  # Scrape prometheus-pve-exporter, which translates the Proxmox VE API
  # into Prometheus metrics (pve_* series for nodes, guests, storage and
  # HA state). The exporter can run as the bundled compose service (see
  # docker-compose.yml, profile "pve-exporter") or anywhere else — point
  # PVE_EXPORTER_URL (host:port, no scheme) at it.
  prometheus:
    config:
      scrape_configs:
        - job_name: oneuptime-proxmox
          # The exporter serves metrics on /pve and proxies each scrape
          # to the Proxmox VE API host given in the \`target\` parameter.
          metrics_path: /pve
          params:
            # Proxmox VE API host (any cluster node) the exporter queries.
            target: ["\${env:PVE_HOST}"]
            # Enable both the cluster collectors (guest up/cpu/memory,
            # HA state, backup-job coverage — pve_up, pve_guest_info,
            # pve_ha_state, pve_not_backed_up_total) and the node
            # collectors (node cpu/memory/disk, replication —
            # pve_node_info, pve_cpu_usage_ratio on node ids,
            # pve_replication_* series).
            cluster: ["1"]
            node: ["1"]
          # pve-exporter answers each scrape with a live Proxmox VE API
          # round-trip; 30s keeps the load on pveproxy negligible.
          scrape_interval: 30s
          static_configs:
            - targets: ["\${env:PVE_EXPORTER_URL}"]

  # Optional: ship Proxmox VE service logs from the systemd journal — this
  # is what powers the Logs tab of the Proxmox dashboard. Off by default
  # because it only works when the agent runs ON a PVE node (the journal
  # is per-host) with the journal mounted into the container — uncomment
  # the matching volumes in docker-compose.yml:
  #   - /var/log/journal:/var/log/journal:ro
  #   - /etc/machine-id:/etc/machine-id:ro
  # IMPORTANT: the stock otel/opentelemetry-collector-contrib image is
  # built FROM scratch — it has no \`journalctl\` binary (which this
  # receiver shells out to) and runs as a non-root user that cannot read
  # the journal. Swap \`image:\` in docker-compose.yml for the one-line
  # custom image in README.md ("Shipping Proxmox service logs"), or run
  # the collector directly on the node. If you would rather not change
  # the image, the README documents a filelog-on-/var/log/syslog
  # fallback instead. Then uncomment this receiver and the \`logs\`
  # pipeline at the bottom of this file. The resource processor below
  # stamps \`proxmox.cluster.name\` so the logs land on this cluster.
  # journald:
  #   directory: /var/log/journal
  #   # Tail from the end so an agent restart does not re-ship history.
  #   start_at: end
  #   # The PVE control-plane services: API proxy, API daemon, firewall,
  #   # HA manager + agent, job scheduler, metrics daemon, QEMU events.
  #   units:
  #     - pveproxy
  #     - pvedaemon
  #     - pve-firewall
  #     - pve-ha-crm
  #     - pve-ha-lrm
  #     - pvescheduler
  #     - pvestatd
  #     - qmeventd
  #   priority: info

processors:
  # Split the pve-exporter identity label into equality-filterable parts.
  # pve-exporter encodes resource identity in a single datapoint label
  # \`id\` with values like \`node/pve1\`, \`qemu/100\`, \`lxc/101\` or
  # \`storage/pve1/local\`. OneUptime monitor criteria and attribute
  # filters match on equality (not prefix), so derive three attributes:
  #   pve.scope — node | guest | storage | cluster
  #               (\`qemu\` and \`lxc\` both map to \`guest\`)
  #   pve.type  — node | qemu | lxc | storage
  #               (left unset on \`cluster/*\` series)
  #   pve.id    — everything after the first slash of \`id\`
  #               (\`pve1\`, \`100\`, \`pve1/local\`)
  # The original \`id\` label is kept untouched — group-by pages and
  # breakdowns still use it. Do not remove this processor: the built-in
  # Proxmox alert templates filter on these attributes.
  transform/pve-identity:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          - set(attributes["pve.scope"], "node") where attributes["id"] != nil and IsMatch(attributes["id"], "^node/")
          - set(attributes["pve.type"], "node") where attributes["id"] != nil and IsMatch(attributes["id"], "^node/")
          - set(attributes["pve.scope"], "guest") where attributes["id"] != nil and IsMatch(attributes["id"], "^qemu/")
          - set(attributes["pve.type"], "qemu") where attributes["id"] != nil and IsMatch(attributes["id"], "^qemu/")
          - set(attributes["pve.scope"], "guest") where attributes["id"] != nil and IsMatch(attributes["id"], "^lxc/")
          - set(attributes["pve.type"], "lxc") where attributes["id"] != nil and IsMatch(attributes["id"], "^lxc/")
          - set(attributes["pve.scope"], "storage") where attributes["id"] != nil and IsMatch(attributes["id"], "^storage/")
          - set(attributes["pve.type"], "storage") where attributes["id"] != nil and IsMatch(attributes["id"], "^storage/")
          - set(attributes["pve.scope"], "cluster") where attributes["id"] != nil and IsMatch(attributes["id"], "^cluster/")
          - set(attributes["pve.id"], attributes["id"]) where attributes["id"] != nil and IsMatch(attributes["id"], "/")
          - replace_pattern(attributes["pve.id"], "^[^/]+/", "") where attributes["pve.id"] != nil
  # Stamp every metric with the cluster identity. OneUptime auto-registers
  # the Proxmox cluster from \`proxmox.cluster.name\`, and every Proxmox
  # page and monitor scopes on it — this attribute is what makes the data
  # appear under the Proxmox section of the dashboard. Keep it stable:
  # changing it later registers a brand-new cluster.
  resource:
    attributes:
      - key: proxmox.cluster.name
        value: "\${env:PROXMOX_CLUSTER_NAME}"
        action: upsert
      # Shown as the agent version on the cluster's page, with a sign when
      # a newer one is out. Keep it in step with the collector image
      # docker-compose.yml pins.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # The prometheus receiver synthesizes service.name (= the scrape job
      # name, "oneuptime-proxmox") and service.instance.id on every batch
      # per the Prometheus->OTLP compatibility spec. Drop them: OneUptime
      # routes batches by service.name first, so leaving them in would
      # register a phantom "oneuptime-proxmox" Service instead of routing
      # this data to the Proxmox cluster discovered from
      # \`proxmox.cluster.name\` (which would also break per-cluster
      # retention settings). Do not remove these two deletes.
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
      processors: [memory_limiter, transform/pve-identity, resource, batch]
      exporters: [otlphttp]
    # Uncomment together with the journald receiver above to ship PVE
    # service logs (powers the Logs tab). transform/pve-identity is
    # metrics-only — keep it out of this pipeline.
    # logs:
    #   receivers: [journald]
    #   processors: [memory_limiter, resource, batch]
    #   exporters: [otlphttp]
`;

export interface ProxmoxSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  // False while no key is picked and `apiKey` is the placeholder.
  hasApiKey: boolean;
  method: ProxmoxConnectMethod;
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
  clusterName: string;
  isClusterNameKnown: boolean;
}

interface AgentGuideContext extends GuideContext {
  method: ProxmoxAgentInstallMethod;
}

// The Server / Port / Protocol / Path fields of the native metric server.
export interface ProxmoxPushTarget {
  server: string;
  port: string;
  protocol: string;
  path: string;
}

/**
 * The metric server fields that point Proxmox VE at this OneUptime: the
 * reader's host, its port (443 or 80 unless the URL names one), its scheme
 * and the OTLP metrics path under any path prefix the URL has.
 */
export function getProxmoxPushTarget(oneuptimeUrl: string): ProxmoxPushTarget {
  const match: RegExpMatchArray | null = oneuptimeUrl
    .trim()
    .match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?(\/[^?#]*)?$/i);

  if (!match) {
    return {
      server: PROXMOX_PUSH_HOST_PLACEHOLDER,
      port: "443",
      protocol: "https",
      path: PROXMOX_NATIVE_PUSH_PATH,
    };
  }

  const protocol: string = match[1]!.toLowerCase();
  const basePath: string = (match[4] || "").replace(/\/+$/, "");

  return {
    server: match[2]!,
    port: match[3] || (protocol === "https" ? "443" : "80"),
    protocol: protocol,
    path: `${basePath}${PROXMOX_NATIVE_PUSH_PATH}`,
  };
}

/*
 * install.sh prompts only for the values its environment does not already
 * hold, so the command can carry the reader's URL and key. Only a real key
 * goes there: the script writes whatever it is given into .env, and a
 * placeholder would become the key the agent sends.
 */
export function getProxmoxInstallScriptCommand(data: {
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
    `curl -sSL ${PROXMOX_AGENT_RAW_URL}/install.sh -o install.sh`,
    [...environment, "bash install.sh"].join(" "),
  ].join("\n");
}

function isPrefilled(context: GuideContext): boolean {
  return (
    context.hasApiKey && context.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER
  );
}

function pickKeyNote(context: GuideContext): string {
  if (context.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    return "";
  }
  return `\n\nPick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`;
}

/*
 * Commands that run in the agent's folder: install.sh installs into
 * /opt/oneuptime-proxmox-agent by default, a Compose install lives wherever
 * the reader put it.
 */
function inAgentFolder(
  method: ProxmoxAgentInstallMethod,
  commands: Array<string>,
): string {
  if (method === "install-script") {
    return [`cd ${PROXMOX_AGENT_INSTALL_DIR}`, ...commands].join("\n");
  }
  return commands.join("\n");
}

/*
 * The commands that upgrade the agent. The collector image is pinned in
 * docker-compose.yml and its config is a file beside it, so an upgrade
 * downloads both again and recreates the containers: Compose recreates a
 * container for a new image or environment, never for a new config file,
 * and the collector reads its config only when it starts. The .env stays.
 * The guide's "Upgrade or uninstall the agent" topic and the dialog beside
 * an outdated agent version (Components/AgentVersion) both show these.
 */
export function getProxmoxAgentDownloadCommand(
  method: ProxmoxAgentInstallMethod,
): string {
  return inAgentFolder(method, [
    `curl -fsSLO ${PROXMOX_AGENT_RAW_URL}/docker-compose.yml`,
    `curl -fsSLO ${PROXMOX_AGENT_RAW_URL}/otel-collector-config.yaml`,
  ]);
}

export function getProxmoxAgentRecreateCommand(
  method: ProxmoxAgentInstallMethod,
): string {
  return inAgentFolder(method, [
    "docker compose pull",
    "docker compose up -d --force-recreate",
  ]);
}

function agentFolder(method: ProxmoxAgentInstallMethod): string {
  return method === "install-script"
    ? `\`${PROXMOX_AGENT_INSTALL_DIR}\``
    : "the folder with `docker-compose.yml`";
}

/* The agent, installed with the install script or Docker Compose. */

function getAgentPrerequisites(): Array<string> {
  return [
    "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the Proxmox VE API on port 8006",
    "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token",
    "Ideally a machine outside the cluster — an agent that scrapes a single node goes dark exactly when that node dies",
  ];
}

function getTokenStep(): SetupGuideStep {
  return {
    title: "Create a read-only API token",
    description:
      "The agent reads the cluster through the Proxmox VE API with a token that has the PVEAuditor (read-only) role.",
    variants: [
      {
        label: "Shell",
        markdown: `As root on any PVE node:

${codeBlock(
  "bash",
  `pveum user add ${PROXMOX_TOKEN_USER}
pveum acl modify / --roles PVEAuditor --users ${PROXMOX_TOKEN_USER}
pveum user token add ${PROXMOX_TOKEN_USER} oneuptime --privsep 1
pveum acl modify / --roles PVEAuditor --tokens '${PROXMOX_TOKEN_ID}'`,
)}

- The first line only fails, harmlessly, if \`${PROXMOX_TOKEN_USER}\` already exists. API tokens carry their own secret, so the user needs no password or system account.
- \`pveum user token add\` prints the token secret — copy it now, it is shown only once. The token id is \`${PROXMOX_TOKEN_ID}\`.
- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path \`/\`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with \`Permission check failed (/, Sys.Audit)\`.`,
      },
      {
        label: "Proxmox web UI",
        markdown: `1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.
2. Pick (or create) a user, give the token an ID like \`oneuptime\`, make sure **Privilege Separation** is checked, and click **Add**.
3. Copy the token id (\`user@realm!tokenname\`) and the secret — the secret is shown only once.
4. Under *Datacenter → Permissions*, click **Add** twice to give path \`/\` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.

A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path \`/\`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with \`Permission check failed (/, Sys.Audit)\`.`,
      },
    ],
  };
}

function getClusterNameNote(context: GuideContext): string {
  if (context.isClusterNameKnown) {
    return `This installs the agent for **\`${context.clusterName}\`** — keep \`PROXMOX_CLUSTER_NAME\` exactly as it is, or the data registers as a new cluster.`;
  }
  return `Replace \`${context.clusterName}\` with a name for this cluster, such as \`pve-prod\`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.`;
}

function getInstallScriptStep(context: AgentGuideContext): SetupGuideStep {
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
      getProxmoxInstallScriptCommand({
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
- **Proxmox VE API host** — any node, e.g. \`192.168.1.10\`, or better a virtual IP that fails over between nodes.
- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.
- **API token** — the token id and secret from the previous step.
- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.

It installs to \`${PROXMOX_AGENT_INSTALL_DIR}\` and starts everything with Docker Compose.`,
  };
}

function getDockerComposeStep(context: AgentGuideContext): SetupGuideStep {
  const notes: Array<string> = [
    getClusterNameNote(context),
    "Set `PVE_HOST` to any node of the cluster — or better, a virtual IP that fails over between nodes.",
    "Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.",
  ];

  return {
    title: "Install the agent",
    description:
      "Download the agent's files, write its settings to a .env file and start it with Docker Compose.",
    markdown: `Download \`docker-compose.yml\` and \`otel-collector-config.yaml\` from the [ProxmoxAgent directory](${PROXMOX_AGENT_SOURCE_URL}) into a new folder:

${codeBlock(
  "bash",
  `mkdir oneuptime-proxmox-agent && cd oneuptime-proxmox-agent
${getProxmoxAgentDownloadCommand("docker-compose")}`,
)}

Create a \`.env\` file next to them — it holds the token secret, so keep it private with \`chmod 600 .env\`:

${codeBlock(
  "bash",
  `ONEUPTIME_URL=${context.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${context.apiKey}
PROXMOX_CLUSTER_NAME=${shellQuote(context.clusterName)}
PVE_HOST=192.168.1.10
PVE_API_TOKEN_ID=${PROXMOX_TOKEN_ID}
PVE_API_TOKEN_SECRET=your-token-secret
COMPOSE_PROFILES=pve-exporter`,
)}

${notes
  .map((note: string): string => {
    return `- ${note}`;
  })
  .join("\n")}

Start the agent:

${codeBlock("bash", "docker compose up -d")}${pickKeyNote(context)}`,
  };
}

function getAgentVerifyStep(context: AgentGuideContext): SetupGuideStep {
  return {
    title: "Verify the installation",
    description:
      "Check that the containers are running and the collector is ready.",
    markdown: `${codeBlock(
      "bash",
      inAgentFolder(context.method, [
        "docker compose ps",
        `docker compose logs -f ${PROXMOX_AGENT_CONTAINER}`,
      ]),
    )}

\`docker compose ps\` lists the collector (\`${PROXMOX_AGENT_CONTAINER}\`), the bundled exporter (\`${PROXMOX_EXPORTER_CONTAINER}\`, unless you use your own) and the OneUptime AI agent (\`${PROXMOX_AI_AGENT_CONTAINER}\`). In the collector's logs, look for \`Everything is ready. Begin running and processing data.\` The cluster then appears automatically in the **Proxmox** section.

**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only \`pvesh\` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.`,
  };
}

function getEnvironmentVariablesTopic(
  context: AgentGuideContext,
): SetupGuideTopic {
  const where: string =
    context.method === "install-script"
      ? `The install script writes these to \`${PROXMOX_AGENT_INSTALL_DIR}/.env\`.`
      : "The agent reads these from the `.env` file next to `docker-compose.yml`.";

  return {
    title: "Environment variables",
    summary:
      "Every setting the collector and the bundled exporter read from the .env file.",
    markdown: `${where} After changing one, apply it with \`docker compose up -d\` in ${agentFolder(context.method)}.

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${context.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key — the one picked in step 1 |
| \`PROXMOX_CLUSTER_NAME\` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the \`proxmox.cluster.name\` resource attribute. Keep it stable — changing it registers a new cluster (default: \`proxmox-cluster\`) |
| \`PVE_HOST\` | Yes | Proxmox VE API host (any node of the cluster) the exporter and the AI agent query, e.g. \`192.168.1.10\` |
| \`PVE_EXPORTER_URL\` | No | Address (\`host:port\`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (\`pve-exporter:9221\`) |
| \`PVE_API_TOKEN_ID\` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. \`${PROXMOX_TOKEN_ID}\` (PVEAuditor, read-only) |
| \`PVE_API_TOKEN_SECRET\` | Bundled exporter and AI agent | Proxmox API token secret |
| \`PVE_VERIFY_SSL\` | No | Verify the Proxmox API TLS certificate (default: \`false\` — PVE ships self-signed certificates) |
| \`COMPOSE_PROFILES\` | No | Set to \`pve-exporter\` to start the bundled exporter container |

The OneUptime AI agent's own settings are under **OneUptime AI agent**.`,
  };
}

function getOwnExporterTopic(context: AgentGuideContext): SetupGuideTopic {
  const how: string =
    context.method === "install-script"
      ? "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme)."
      : "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):";

  return {
    title: "Use your own prometheus-pve-exporter",
    summary:
      "Skip the bundled exporter and point the agent at one you already run.",
    markdown: `${how}${
      context.method === "install-script"
        ? ""
        : `

${codeBlock("bash", "PVE_EXPORTER_URL=your-exporter-host:9221")}`
    }

Use an address the agent's container can reach — the host's LAN IP or DNS name: \`localhost\` inside the container is the container itself. Keep \`PVE_API_TOKEN_ID\` and \`PVE_API_TOKEN_SECRET\` in \`.env\` if you use the OneUptime AI agent, which reads the API with that token.`,
  };
}

function getCollectedDataTopic(): SetupGuideTopic {
  return {
    title: "What the agent collects",
    summary:
      "Nodes, guests, storage, HA state, backup coverage and replication, with equality-filterable identity attributes.",
    markdown: `The agent scrapes the exporter every 30 seconds with both the cluster and node collectors enabled. Every series carries an \`id\` label identifying the resource — \`node/<name>\`, \`qemu/<vmid>\`, \`lxc/<vmid>\`, or \`storage/<node>/<storage>\`:

| Category | Metrics |
|----------|---------|
| **Availability** | \`pve_up\`, \`pve_uptime_seconds\` |
| **Node** | \`pve_node_info\`, \`pve_cpu_usage_ratio\`, \`pve_cpu_usage_limit\`, \`pve_memory_usage_bytes\`, \`pve_memory_size_bytes\` |
| **Guest (VM / LXC)** | \`pve_guest_info\`, plus CPU / memory / network series on \`qemu/*\` and \`lxc/*\` ids |
| **Storage** | \`pve_disk_usage_bytes\`, \`pve_disk_size_bytes\`, \`pve_storage_info\` |
| **HA** | \`pve_ha_state\` |
| **Backup coverage** | \`pve_not_backed_up_total\`, \`pve_not_backed_up_info\` — guests no backup job selects (whether backups ran or succeeded is not exposed) |
| **Replication** | \`pve_replication_*\` series per storage replication job — their \`id\` label is the job id (e.g. \`100-0\`), not a resource |

The collector also splits the \`id\` label into three equality-filterable datapoint attributes (the \`transform/pve-identity\` processor) — monitor criteria and dashboard filters match on these:

| Attribute | Values | Example for \`qemu/100\` |
|-----------|--------|------------------------|
| \`pve.scope\` | \`node\`, \`guest\`, \`storage\`, \`cluster\` (\`qemu\` and \`lxc\` both map to \`guest\`) | \`guest\` |
| \`pve.type\` | \`node\`, \`qemu\`, \`lxc\`, \`storage\` | \`qemu\` |
| \`pve.id\` | Everything after the first \`/\` of \`id\` (\`pve1\`, \`100\`, \`pve1/local\`) | \`100\` |

The original \`id\` label is kept untouched.`,
  };
}

function getCollectorConfigTopic(): SetupGuideTopic {
  return {
    title: "The collector configuration",
    summary:
      "The full otel-collector-config.yaml the agent runs, and the processor the alert templates depend on.",
    markdown: `This is the full \`otel-collector-config.yaml\` the agent runs; the \`.env\` file supplies the \`\${env:...}\` values. The \`transform/pve-identity\` processor derives the \`pve.scope\` / \`pve.type\` / \`pve.id\` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:

${codeBlock("yaml", PROXMOX_AGENT_COLLECTOR_CONFIG)}`,
  };
}

function getServiceLogsTopic(context: AgentGuideContext): SetupGuideTopic {
  return {
    title: "Ship Proxmox service logs",
    summary:
      "Send the PVE services' journal to the cluster's Logs tab. Needs the agent on a PVE node.",
    markdown: `By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out \`journald\` receiver for \`pveproxy\`, \`pvedaemon\`, \`pve-firewall\`, \`pve-ha-crm\`, \`pve-ha-lrm\`, \`pvescheduler\`, \`pvestatd\` and \`qmeventd\`.

1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.
2. Uncomment the \`journald\` receiver and the \`logs\` pipeline in \`otel-collector-config.yaml\`, and the two journal volumes in \`docker-compose.yml\`.
3. **Swap the collector image.** The stock image has no \`journalctl\` and runs as a user that cannot read the journal. Build this wrapper and point \`image:\` in \`docker-compose.yml\` at it:

${codeBlock(
  "dockerfile",
  `FROM ${PROXMOX_AGENT_COLLECTOR_IMAGE} AS otelcol
FROM debian:stable-slim
RUN apt-get update \\
    && apt-get install -y --no-install-recommends systemd \\
    && rm -rf /var/lib/apt/lists/*
COPY --from=otelcol /otelcol-contrib /otelcol-contrib
ENTRYPOINT ["/otelcol-contrib"]
CMD ["--config", "/etc/otelcol-contrib/config.yaml"]`,
)}

4. Apply it:

${codeBlock("bash", inAgentFolder(context.method, ["docker compose up -d"]))}

Rather keep the stock image? The documentation has a \`filelog\` fallback that tails \`/var/log/syslog\`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).`,
  };
}

function getLabelsTopic(context: AgentGuideContext): SetupGuideTopic {
  return {
    title: "Tag the cluster with project labels",
    summary:
      "Attach labels such as team or environment to the cluster from the collector config.",
    markdown: `Any resource attribute prefixed with \`oneuptime.label.\` becomes a project label on the cluster: \`oneuptime.label.<dimension>=<value>\` is the label \`<dimension>:<value>\`. Add them to the \`resource\` processor in \`otel-collector-config.yaml\`, next to \`proxmox.cluster.name\`:

${codeBlock(
  "yaml",
  `processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: platform
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert`,
)}

Then restart the collector so it reads the new config:

${codeBlock(
  "bash",
  inAgentFolder(context.method, [
    `docker compose restart ${PROXMOX_AGENT_CONTAINER}`,
  ]),
)}

The cluster shows up tagged \`team:platform\` and \`env:production\`. Labels are matched case-insensitively, so an existing \`Production\` label is reused; labels added in the OneUptime UI are never removed by the agent.`,
  };
}

function getAiAgentTopic(): SetupGuideTopic {
  return {
    title: "OneUptime AI agent",
    summary:
      "The container that lets OneUptime AI read the cluster through the Proxmox VE API while it investigates an incident.",
    markdown: `\`docker-compose.yml\` also runs **\`${PROXMOX_AI_AGENT_CONTAINER}\`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only \`pvesh\` commands through it — \`pvesh get /cluster/status\`, a guest's current status, a node's failed tasks. There is no \`pvesh\` binary in it: each command becomes one call to the Proxmox VE API at \`PVE_HOST\`. It registers as the cluster named \`PROXMOX_CLUSTER_NAME\` and appears on the cluster's **AI → AI agent** page.

- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (\`PVE_API_TOKEN_ID\` / \`PVE_API_TOKEN_SECRET\`), which can read and nothing else. If you run your own exporter and have no token in \`.env\`, add one.
- It is **read-only** unless you set \`ONEUPTIME_AI_ALLOW_WRITES=true\`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as \`ONEUPTIME_AI_PVE_API_TOKEN_ID\` / \`ONEUPTIME_AI_PVE_API_TOKEN_SECRET\`; the agent's README has the \`pveum\` commands. If the agent runs in a guest of this cluster, put that guest's VMID in \`ONEUPTIME_AI_PROTECTED_TARGETS\`.
- Check it: \`docker exec ${PROXMOX_AI_AGENT_CONTAINER} wget -qO- http://127.0.0.1:3877/status\`
- Not using OneUptime AI? Delete the \`${PROXMOX_AI_AGENT_CONTAINER}\` service from \`docker-compose.yml\`.

What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).`,
  };
}

function getUpgradeTopic(context: AgentGuideContext): SetupGuideTopic {
  const where: string =
    context.method === "install-script"
      ? ""
      : "Run these in the agent's folder, the one with `docker-compose.yml`.\n\n";

  return {
    title: "Upgrade or uninstall the agent",
    summary:
      "Download the latest files and recreate the agent, or stop and remove it.",
    markdown: `${where}**Upgrade** — the collector image is pinned in \`docker-compose.yml\` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your \`.env\` stays, and a change you made to either file has to be made again:

${codeBlock("bash", getProxmoxAgentDownloadCommand(context.method))}

Then pull the images and recreate the agent, so the collector reads its new config:

${codeBlock("bash", getProxmoxAgentRecreateCommand(context.method))}

The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.

**Uninstall** the agent:

${codeBlock("bash", inAgentFolder(context.method, ["docker compose down"]))}

Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.`,
  };
}

function getAgentAdvancedTopics(
  context: AgentGuideContext,
): Array<SetupGuideTopic> {
  return [
    getEnvironmentVariablesTopic(context),
    getOwnExporterTopic(context),
    getCollectedDataTopic(),
    getCollectorConfigTopic(),
    getServiceLogsTopic(context),
    getLabelsTopic(context),
    getAiAgentTopic(),
    getUpgradeTopic(context),
  ];
}

function getAgentTroubleshootingTopics(
  context: AgentGuideContext,
): Array<SetupGuideTopic> {
  const runScript: string =
    context.method === "install-script"
      ? "bash troubleshoot.sh"
      : 'bash troubleshoot.sh -d "$PWD"    # in the folder with docker-compose.yml';

  const inFolder: string =
    context.method === "install-script"
      ? ` (in \`${PROXMOX_AGENT_INSTALL_DIR}\`)`
      : " (in the agent's folder)";

  const knownName: string = context.isClusterNameKnown
    ? ` This cluster is **\`${context.clusterName}\`**.`
    : "";

  return [
    {
      title: "Run the diagnostic script first",
      markdown: `\`troubleshoot.sh\` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with \`401\` or \`422\`, which the collector logs as a single \`Exporting failed\` line per batch that is easy to miss, so the script asks \`GET /otlp/v1/validate\` for a direct 200/401 verdict.

${codeBlock(
  "bash",
  `curl -sSL ${PROXMOX_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh
${runScript}`,
)}

It ends with a verdict naming the most likely cause.`,
    },
    {
      title: 'Cluster shows as "Disconnected"',
      markdown: `1. Check that the agent is running${inFolder}: \`docker compose ps\`
2. Check the agent logs for errors: \`docker compose logs ${PROXMOX_AGENT_CONTAINER} | grep -i error\`
3. Verify your OneUptime URL and ingestion key are correct.
4. Ensure the agent machine can reach the OneUptime instance over the network.`,
    },
    {
      title: "No metrics appearing",
      markdown: `1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see \`pve_*\` metric lines (for your own exporter, curl its \`host:9221\` directly):

${codeBlock(
  "bash",
  `docker run --rm --network container:${PROXMOX_EXPORTER_CONTAINER} curlimages/curl -s "http://localhost:9221/pve?target=<PVE_HOST>&cluster=1&node=1" | head`,
)}

2. Verify the API token has the **PVEAuditor** role on path \`/\`, on the token and on its user.
3. Check the collector logs for scrape or export errors${inFolder}: \`docker compose logs ${PROXMOX_AGENT_CONTAINER}\``,
    },
    {
      title: "The exporter returns 401 or 595 errors",
      markdown: `The API token is wrong or lacks permissions. Re-check the token id format (\`user@realm!tokenname\`), the secret, and that the **PVEAuditor** role is granted on path \`/\` to the token and to its user. The exporter's own logs show the API's answer: \`docker logs ${PROXMOX_EXPORTER_CONTAINER}\``,
    },
    {
      title: "Only node metrics, no guest metrics",
      markdown:
        'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.',
    },
    {
      title: "Cluster appears under the wrong name",
      markdown: `The cluster's identity comes from \`PROXMOX_CLUSTER_NAME\`, stamped on every metric as \`proxmox.cluster.name\`.${knownName} Fix it in \`.env\` and apply it with \`docker compose up -d\` in ${agentFolder(context.method)} — note that a new name registers a new cluster.`,
    },
  ];
}

function getAgentGuide(context: AgentGuideContext): SetupGuideContent {
  return {
    prerequisites: getAgentPrerequisites(),
    steps: [
      getTokenStep(),
      context.method === "install-script"
        ? getInstallScriptStep(context)
        : getDockerComposeStep(context),
      getAgentVerifyStep(context),
    ],
    advanced: getAgentAdvancedTopics(context),
    troubleshooting: getAgentTroubleshootingTopics(context),
    links: getLinks(),
  };
}

/* Native push: Proxmox VE 9's own OpenTelemetry metric server. */

function getNativePushIntro(): string {
  return "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.";
}

function getNativePushPrerequisites(target: ProxmoxPushTarget): Array<string> {
  return [
    "Proxmox VE **9.0 or later**",
    "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*",
    `Every node can reach \`${target.server}\` on port ${target.port}`,
  ];
}

function getMetricServerStep(
  context: GuideContext,
  target: ProxmoxPushTarget,
): SetupGuideStep {
  return {
    title: "Add OneUptime as a metric server",
    description:
      "In the Proxmox web UI go to Datacenter → Metric Server, click Add → OpenTelemetry and fill in these fields.",
    markdown: `| Field | Value |
|-------|-------|
| **Server** | \`${target.server}\` |
| **Port** | \`${target.port}\` |
| **Protocol** | \`${target.protocol}\` |
| **Path** | \`${target.path}\` |
| **Headers** | The JSON below |

${codeBlock("json", `{"x-oneuptime-token": ${JSON.stringify(context.apiKey)}}`)}

Add it once for the datacenter — every node of the cluster then pushes its own metrics.${pickKeyNote(context)}`,
  };
}

function getNativePushVerifyStep(): SetupGuideStep {
  return {
    title: "Check that the cluster appears",
    description:
      "Nothing else to configure: OneUptime recognizes the native push.",
    markdown:
      "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.",
  };
}

function getNativePushAdvancedTopics(
  context: GuideContext,
): Array<SetupGuideTopic> {
  const knownName: string = context.isClusterNameKnown
    ? `

This cluster is **\`${context.clusterName}\`** in OneUptime. If that is not the Proxmox cluster's own name, set \`proxmox.cluster.name\` to \`${context.clusterName}\` under the metric server's *Resource Attributes*, or the push registers a new cluster.`
    : "";

  return [
    {
      title: "When a node stops reporting",
      summary:
        "A silent node shows Offline after about 2 minutes, and Node Offline fires after about 5.",
      markdown: `Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:

- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.
- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.
- Its next report brings it back.

Offline means "stopped reporting": a hung \`pvestatd\`, a stopped \`pmxcfs\` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked \`oneuptime.proxmox.inferred=not-reporting\` in Metrics Explorer.`,
    },
    {
      title: "Which name the cluster registers under",
      summary:
        "Its Proxmox cluster name, or a standalone node's own name, unless proxmox.cluster.name is set.",
      markdown: `The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A \`proxmox.cluster.name\` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.${knownName}`,
    },
    {
      title: "What the native push sends",
      summary:
        "The same series the agent sends, the original Proxmox VE series, and what only the agent collects.",
      markdown: `OneUptime translates the push into the \`pve_*\` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original \`proxmox_*\` series stay available in Metrics Explorer for anything else Proxmox VE reports.

Some alert templates need data only the agent collects:

| Needs the agent | Why |
|-----------------|-----|
| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |
| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |
| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |`,
    },
  ];
}

function getNativePushTroubleshootingTopics(
  target: ProxmoxPushTarget,
): Array<SetupGuideTopic> {
  return [
    {
      title: 'No cluster appears, or it shows as "Disconnected"',
      markdown: `Every node has stopped reporting, or never started.

1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server \`${target.server}\`, port \`${target.port}\`, protocol \`${target.protocol}\`, path \`${target.path}\`, and the \`x-oneuptime-token\` header with a key from step 1.
2. Check that the nodes can reach \`${target.server}\` over the network.`,
    },
    {
      title: 'A node shows as "Offline"',
      markdown:
        "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.",
    },
    {
      title: "Guest Down, HA or backup alerts never fire",
      markdown:
        "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.",
    },
  ];
}

function getNativePushGuide(context: GuideContext): SetupGuideContent {
  const target: ProxmoxPushTarget = getProxmoxPushTarget(context.oneuptimeUrl);

  const keyStep: SetupGuideKeyStep = {
    description:
      "Proxmox VE sends its metrics with this key, in the x-oneuptime-token header. Pick an existing key or create a new one — the settings below update to use it.",
    endpointLabel: "OTLP metrics endpoint",
    endpointValue: `${context.oneuptimeUrl}${PROXMOX_NATIVE_PUSH_PATH}`,
  };

  return {
    keyStep: keyStep,
    intro: getNativePushIntro(),
    prerequisites: getNativePushPrerequisites(target),
    steps: [getMetricServerStep(context, target), getNativePushVerifyStep()],
    advanced: getNativePushAdvancedTopics(context),
    troubleshooting: getNativePushTroubleshootingTopics(target),
    links: getLinks(),
  };
}

function getLinks(): Array<SetupGuideLink> {
  return [
    {
      title: "Proxmox documentation",
      url: "/docs/telemetry/proxmox",
    },
    {
      title: "Proxmox monitors and alerts",
      url: "/docs/monitor/proxmox-monitor",
    },
  ];
}

/**
 * The Proxmox guide for one way of connecting a cluster, filled in with
 * the reader's OneUptime URL and ingestion key.
 */
export function getProxmoxSetupGuide(
  options: ProxmoxSetupGuideOptions,
): SetupGuideContent {
  const knownClusterName: string = (options.clusterName || "").trim();

  const context: GuideContext = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    hasApiKey: options.hasApiKey,
    clusterName: knownClusterName || PROXMOX_EXAMPLE_CLUSTER_NAME,
    isClusterNameKnown: Boolean(knownClusterName),
  };

  if (options.method === "native-push") {
    return getNativePushGuide(context);
  }

  return getAgentGuide({ ...context, method: options.method });
}
