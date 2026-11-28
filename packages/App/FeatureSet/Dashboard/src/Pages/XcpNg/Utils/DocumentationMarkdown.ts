import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideLink,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
  shellQuote,
} from "../../../Components/SetupGuide/SetupGuide";
import {
  INSTALL_SCRIPT_READ_FIRST_NOTE,
  getAgentFileDownloadCommand,
  getInstallScriptDownloadCommand,
  getInstallScriptRunCommand,
  getTroubleshootScriptDownloadCommand,
} from "../../../Components/SetupGuide/AgentInstallCommands";
import { InstallScriptName } from "Common/Types/InstallScripts/InstallScripts";

/*
 * The in-app guide for connecting XCP-ng pools: the OneUptime XCP-ng Agent
 * (agents/XcpNgAgent), a stock OpenTelemetry collector that reads Xen
 * Orchestra's OpenMetrics plugin, installed with the install script or by
 * hand with Docker Compose.
 *
 * One agent reads one Xen Orchestra and every pool it manages: each pool
 * registers itself in OneUptime with its first data, under its XAPI UUID
 * and the name Xen Orchestra gives it. So the guide asks for no pool name:
 * it asks for Xen Orchestra's address, the plugin's secret, and how the
 * agent may trust Xen Orchestra's certificate - never by skipping the
 * check.
 *
 * The guide asks which way to install and shows only that path.
 */

export type XcpNgConnectMethod = "install-script" | "docker-compose";

export const XCP_NG_CONNECT_METHODS: Array<
  SetupGuideOption<XcpNgConnectMethod>
> = [
  {
    key: "install-script",
    label: "Install script",
    description:
      "One command downloads the agent, checks Xen Orchestra's certificate and the plugin's secret, and starts it.",
    badge: "Recommended",
  },
  {
    key: "docker-compose",
    label: "Docker Compose",
    description:
      "Download two files, write a .env file and Xen Orchestra's certificate, and start the agent yourself.",
  },
];

export const DEFAULT_XCP_NG_CONNECT_METHOD: XcpNgConnectMethod =
  "install-script";

export function resolveXcpNgConnectMethod(
  method: string | null | undefined,
): XcpNgConnectMethod {
  return (
    resolveSetupGuideOption(XCP_NG_CONNECT_METHODS, method) ||
    DEFAULT_XCP_NG_CONNECT_METHOD
  );
}

/*
 * Where every OneUptime serves the agent's install script and files, for
 * its own release (Common/Types/InstallScripts): /install/xcp-ng-agent on
 * the reader's OneUptime. And where install.sh puts them.
 */
export const XCP_NG_AGENT_INSTALL_NAME: InstallScriptName =
  InstallScriptName.XcpNgAgent;
export const XCP_NG_AGENT_INSTALL_DIR: string = "/opt/oneuptime-xcp-ng-agent";

// The collector's container (agents/XcpNgAgent/docker-compose.yml).
export const XCP_NG_AGENT_CONTAINER: string = "oneuptime-xcp-ng-agent";

/*
 * The Xen Orchestra version the agent needs: its OpenMetrics plugin keeps
 * its secret across a restart (since 6.8), has the scrape memory-leak fixes
 * (6.9) and serves every series the pages read (host and VM status,
 * storage repositories, virtual disks).
 */
export const XCP_NG_MINIMUM_XEN_ORCHESTRA_VERSION: string = "6.9";

// Where Xen Orchestra keeps the plugin and its secret.
export const XCP_NG_PLUGIN_SETTINGS: string =
  "Settings → Plugins → openmetrics";

// The address the guide shows until the reader has their own.
export const XCP_NG_EXAMPLE_XO_URL: string = "https://xo.example.com";
export const XCP_NG_EXAMPLE_XO_ADDRESS: string = "xo.example.com";

// Where the plugin answers, on Xen Orchestra's own port and certificate.
export const XCP_NG_OPENMETRICS_PATH: string = "/openmetrics/metrics";

// The file the agent checks Xen Orchestra's certificate against.
export const XCP_NG_AGENT_CA_FILE: string = "xo-ca.pem";

export interface XcpNgSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  // False while no key is picked and `apiKey` is the placeholder.
  hasApiKey: boolean;
  method: XcpNgConnectMethod;
  /*
   * The Xen Orchestra the pool is read from (a pool's own Documentation
   * tab: XcpNgPool.xenOrchestraName), so a reinstall keeps its name.
   * Omitted on the product pages.
   */
  xenOrchestraName?: string | undefined;
}

interface GuideContext {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  method: XcpNgConnectMethod;
  // The Xen Orchestra name the guide knows, or "".
  xenOrchestraName: string;
}

function isPrefilled(context: { apiKey: string; hasApiKey: boolean }): boolean {
  return (
    context.hasApiKey && context.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER
  );
}

/*
 * install.sh asks only for the values its environment does not already
 * hold, so the command can carry the reader's URL and key. Only a real key
 * goes there: the script writes whatever it is given into .env, and a
 * placeholder would become the key the agent sends. The script itself comes
 * from the same OneUptime, which serves the agent of its own release. On a
 * pool's own Documentation tab, the command also carries the name of the
 * Xen Orchestra the pool is read from.
 */
export function getXcpNgInstallScriptCommand(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  xenOrchestraName?: string | undefined;
}): string {
  const environment: Array<string> = [];

  if (isPrefilled(data)) {
    if (data.oneuptimeUrl !== SETUP_GUIDE_URL_PLACEHOLDER) {
      environment.push(`ONEUPTIME_URL=${shellQuote(data.oneuptimeUrl)}`);
    }
    environment.push(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${shellQuote(data.apiKey)}`,
    );
  }

  const xenOrchestraName: string = (data.xenOrchestraName || "").trim();
  if (xenOrchestraName) {
    environment.push(`XO_NAME=${shellQuote(xenOrchestraName)}`);
  }

  return [
    getInstallScriptDownloadCommand(
      data.oneuptimeUrl,
      XCP_NG_AGENT_INSTALL_NAME,
    ),
    getInstallScriptRunCommand(environment, "bash install.sh"),
  ].join("\n");
}

/*
 * The commands that upgrade the agent. The collector image is pinned in
 * docker-compose.yml and its config is a file beside it, so pulling alone
 * never moves the agent forward. An install-script install runs the script
 * again: it reuses every value in .env (nothing is asked again), checks
 * Xen Orchestra's certificate the same way, downloads the latest
 * docker-compose.yml and otel-collector-config.yaml (keeping a file the
 * reader edited as <file>.bak.<timestamp>), pulls the image and recreates
 * the container. A Docker Compose install downloads the two files itself,
 * then pulls and recreates: Compose recreates a container for a new image
 * or environment, never for a new config file, and the collector reads its
 * config only when it starts. The guide's "Upgrade or uninstall the agent"
 * topic and the dialog beside an outdated agent version
 * (Components/AgentVersion) both show these.
 */
export function getXcpNgAgentUpgradeCommand(oneuptimeUrl: string): string {
  return getXcpNgInstallScriptCommand({
    oneuptimeUrl: oneuptimeUrl,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
  });
}

export function getXcpNgAgentDownloadCommand(oneuptimeUrl: string): string {
  return [
    getAgentFileDownloadCommand(
      oneuptimeUrl,
      XCP_NG_AGENT_INSTALL_NAME,
      "docker-compose.yml",
    ),
    getAgentFileDownloadCommand(
      oneuptimeUrl,
      XCP_NG_AGENT_INSTALL_NAME,
      "otel-collector-config.yaml",
    ),
  ].join("\n");
}

export const XCP_NG_AGENT_RECREATE_COMMAND: string =
  "docker compose pull\ndocker compose up -d --force-recreate";

/*
 * Commands that run in the agent's folder: install.sh installs into
 * /opt/oneuptime-xcp-ng-agent by default, a Compose install lives wherever
 * the reader put it.
 */
function inAgentFolder(
  method: XcpNgConnectMethod,
  commands: Array<string>,
): string {
  if (method === "install-script") {
    return [`cd ${XCP_NG_AGENT_INSTALL_DIR}`, ...commands].join("\n");
  }
  return commands.join("\n");
}

function agentFolder(method: XcpNgConnectMethod): string {
  return method === "install-script"
    ? `\`${XCP_NG_AGENT_INSTALL_DIR}\``
    : "the folder with `docker-compose.yml`";
}

function pickKeyNote(context: GuideContext): string {
  if (context.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    return "";
  }
  return `\n\nPick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`;
}

function getPrerequisites(): Array<string> {
  return [
    `Xen Orchestra ${XCP_NG_MINIMUM_XEN_ORCHESTRA_VERSION} or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it`,
    "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS",
    "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced",
  ];
}

function getPluginStep(): SetupGuideStep {
  return {
    title: "Turn on Xen Orchestra's OpenMetrics plugin",
    description:
      "The agent reads every pool through the plugin, with the plugin's secret.",
    markdown: `1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.
2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.
3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.

The plugin answers on Xen Orchestra's own address and certificate, at \`${XCP_NG_OPENMETRICS_PATH}\`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.`,
  };
}

function getInstallScriptStep(context: GuideContext): SetupGuideStep {
  const prefilled: boolean = isPrefilled(context);

  const xenOrchestraNamePrompt: string = context.xenOrchestraName
    ? `**What to call this Xen Orchestra** — the command already names it **\`${context.xenOrchestraName}\`**, as this pool's Settings show it.`
    : "**What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.";

  return {
    title: "Install the agent",
    description:
      "Download the install script and run it on the machine that will host the agent.",
    // The command, then right under it that the script can be read first.
    markdown: codeBlock(
      "bash",
      getXcpNgInstallScriptCommand({
        oneuptimeUrl: context.oneuptimeUrl,
        apiKey: context.apiKey,
        hasApiKey: context.hasApiKey,
        xenOrchestraName: context.xenOrchestraName,
      }),
    ),
    note: INSTALL_SCRIPT_READ_FIRST_NOTE,
    details: `${
      prefilled
        ? "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:"
        : "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:"
    }

- **Xen Orchestra's address** — as you open it in a browser, e.g. \`${XCP_NG_EXAMPLE_XO_URL}\` or \`https://10.0.0.5:8443\`.
- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.
- ${xenOrchestraNamePrompt}

The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.

It installs to \`${XCP_NG_AGENT_INSTALL_DIR}\`, writes a \`0600\` \`.env\` file and starts the agent with Docker Compose. Running the script again reuses everything in that \`.env\` instead of asking again, so it is also how you upgrade.`,
  };
}

function getDockerComposeStep(context: GuideContext): SetupGuideStep {
  const xenOrchestraName: string = context.xenOrchestraName || "Xen Orchestra";

  return {
    title: "Install the agent",
    description:
      "Download the agent's files, write its settings to a .env file, give it Xen Orchestra's certificate and start it with Docker Compose.",
    markdown: `Download \`docker-compose.yml\` and \`otel-collector-config.yaml\` from this OneUptime into a new folder:

${codeBlock(
  "bash",
  `mkdir oneuptime-xcp-ng-agent && cd oneuptime-xcp-ng-agent
${getXcpNgAgentDownloadCommand(context.oneuptimeUrl)}`,
)}

Create a \`.env\` file next to them — it holds the plugin's secret, so keep it private with \`chmod 600 .env\`:

${codeBlock(
  "bash",
  `ONEUPTIME_URL=${context.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${context.apiKey}
XO_SCHEME=https
XO_ADDRESS=${XCP_NG_EXAMPLE_XO_ADDRESS}
XO_OPENMETRICS_SECRET='your-plugin-secret'
XO_NAME=${shellQuote(xenOrchestraName)}`,
)}

- Set \`XO_ADDRESS\` to Xen Orchestra's \`host\` or \`host:port\`, without \`https://\`.
- Put the plugin's secret between single quotes. If it holds a \`$\`, write each one as \`$$\`: the collector reads the value once more.
- \`XO_NAME\` is what each pool's Settings call this Xen Orchestra.

Then give the agent Xen Orchestra's certificate, as \`${XCP_NG_AGENT_CA_FILE}\` next to \`docker-compose.yml\` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:

${codeBlock(
  "bash",
  `openssl s_client -connect ${XCP_NG_EXAMPLE_XO_ADDRESS}:443 -servername ${XCP_NG_EXAMPLE_XO_ADDRESS} </dev/null 2>/dev/null \\
  | openssl x509 -out ${XCP_NG_AGENT_CA_FILE}
openssl x509 -in ${XCP_NG_AGENT_CA_FILE} -noout -fingerprint -sha256`,
)}

When a CA of your own issued it, copy that CA's certificate to \`${XCP_NG_AGENT_CA_FILE}\` instead; when a public CA did, copy this machine's CA bundle (\`cp /etc/ssl/certs/ca-certificates.crt ${XCP_NG_AGENT_CA_FILE}\`).

Start the agent:

${codeBlock("bash", "docker compose up -d")}${pickKeyNote(context)}`,
  };
}

function getVerifyStep(context: GuideContext): SetupGuideStep {
  return {
    title: "Verify the installation",
    description: "Check that the agent is running and the collector is ready.",
    markdown: `${codeBlock(
      "bash",
      inAgentFolder(context.method, [
        "docker compose ps",
        `docker compose logs -f ${XCP_NG_AGENT_CONTAINER}`,
      ]),
    )}

\`docker compose ps\` lists \`${XCP_NG_AGENT_CONTAINER}\`. In its logs, look for \`Everything is ready. Begin running and processing data.\` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.`,
  };
}

function getEnvironmentVariablesTopic(context: GuideContext): SetupGuideTopic {
  const where: string =
    context.method === "install-script"
      ? `The install script writes these to \`${XCP_NG_AGENT_INSTALL_DIR}/.env\`.`
      : "The agent reads these from the `.env` file next to `docker-compose.yml`.";

  return {
    title: "Environment variables",
    summary: "Every setting the agent reads from the .env file.",
    markdown: `${where} After changing one, apply it with \`docker compose up -d\` in ${agentFolder(context.method)}.

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${context.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key — the one picked in step 1 |
| \`XO_ADDRESS\` | Yes | Xen Orchestra's \`host\` or \`host:port\`, without a scheme |
| \`XO_SCHEME\` | No | \`https\` (default). \`http\` only in a lab: the secret then crosses the network in clear |
| \`XO_OPENMETRICS_SECRET\` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every \`$\` in it is written as \`$$\` |
| \`XO_NAME\` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |
| \`XO_TLS_SERVER_NAME\` | No | The name Xen Orchestra's certificate is checked against, when \`XO_ADDRESS\` is an address the certificate does not list |
| \`XO_URL\` | Install script | Xen Orchestra's address as typed; the script derives \`XO_SCHEME\` and \`XO_ADDRESS\` from it |
| \`XO_TLS_FINGERPRINT\` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |
| \`XO_CA_FILE\` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to \`${XCP_NG_AGENT_CA_FILE}\` |
| \`ONEUPTIME_AI_XO_READ_TOKEN\` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |
| \`ONEUPTIME_AI_XO_WRITE_TOKEN\` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |
| \`XCP_NG_POOL_ID\` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |
| \`ONEUPTIME_AI_AGENT_RESOURCE_NAME\` | No | Overrides \`XCP_NG_POOL_ID\` as the pool the AI agent registers as |
| \`ONEUPTIME_AI_INVESTIGATION\` | No | \`true\` or \`false\`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |
| \`ONEUPTIME_AI_FIXES\` | No | \`off\`, \`ask-for-approval\`, \`automatic\` or \`bypass-approval\`: how OneUptime AI may apply a fix |
| \`ONEUPTIME_AI_ALLOW_WRITES\` | No | \`true\` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |
| \`ONEUPTIME_AI_WRITE_TARGETS\` | No | The \`vm/<uuid>\`, \`host/<uuid>\`, \`pbd/<uuid>\` or \`schedule/<uuid>\` a fix may touch, comma-separated (default: all) |
| \`ONEUPTIME_AI_PROTECTED_TARGETS\` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |
| \`LOG_LEVEL\` | No | The AI agent's log level: \`debug\`, \`info\` (default), \`warn\` or \`error\` |
| \`COMPOSE_PROFILES\` | No | \`xcp-ng-ai-agent\` starts the AI agent; the install script writes it when the read token is set |

The agent checks Xen Orchestra's certificate against \`${XCP_NG_AGENT_CA_FILE}\`, next to \`docker-compose.yml\`.`,
  };
}

function getCertificateTopic(context: GuideContext): SetupGuideTopic {
  const renew: string =
    context.method === "install-script"
      ? "When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`."
      : `When the certificate in \`${XCP_NG_AGENT_CA_FILE}\` is renewed, read it again as in step 3, then run \`docker compose up -d --force-recreate\`.`;

  return {
    title: "Xen Orchestra's certificate",
    summary:
      "How the agent trusts Xen Orchestra without ever skipping the check.",
    markdown: `The agent checks Xen Orchestra's certificate on every read, against \`${XCP_NG_AGENT_CA_FILE}\` and nothing else. That file holds one of three things:

- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (\`XO_TLS_FINGERPRINT\`): the agent trusts that certificate and no other.
- **The CA that issued it** (\`XO_CA_FILE\`), for a certificate from a CA of your own.
- **This machine's CA bundle**, for a certificate this machine already trusts.

Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with \`x509: certificate is not valid for any names\`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.

When the certificate names Xen Orchestra by another name than the address in \`XO_ADDRESS\`, set \`XO_TLS_SERVER_NAME\` to that name. ${renew}`,
  };
}

function getCollectedDataTopic(): SetupGuideTopic {
  return {
    title: "What the agent collects",
    summary:
      "Every series of the OpenMetrics plugin for each pool, and the health series OneUptime adds.",
    markdown: `Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the \`xcp_*\` series, and moves each series' pool to the batch it sends, as \`xcp_ng.pool.id\` (the pool's UUID, which never changes) and \`xcp_ng.pool.name\`:

| Category | Series |
|----------|--------|
| **Pool** | \`xcp_pool_connected\` — present while Xen Orchestra is connected to the pool |
| **Hosts** | \`xcp_host_status\` (power state and whether it is enabled), \`xcp_host_uptime_seconds\`, \`xcp_host_cpu_average\`, \`xcp_host_load_average\`, \`xcp_host_memory_*\`, \`xcp_host_running_vcpus\`, \`xcp_host_network_*\` per interface, \`xcp_host_disk_*\` per storage repository |
| **VMs** | \`xcp_vm_status\`, \`xcp_vm_uptime_seconds\`, \`xcp_vm_cpu_usage\`, \`xcp_vm_runstate_*\` (CPU contention), \`xcp_vm_memory_*\`, \`xcp_vm_network_*\` per interface, \`xcp_vm_disk_*\` per disk, \`xcp_vm_power_consumption_watts\` |
| **Storage** | \`xcp_sr_physical_size_bytes\`, \`xcp_sr_physical_usage_bytes\`, \`xcp_sr_virtual_size_bytes\`, \`xcp_vdi_virtual_size_bytes\`, \`xcp_vdi_physical_usage_bytes\` |
| **XOSTOR** | \`xcp_xostor_*\`, on pools that run XOSTOR |

Control domains report as VMs with \`is_control_domain="true"\`; the pages hide them unless you ask for them.

Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: \`xcp_host_network_receive_bytes_total\`, \`xcp_host_network_transmit_bytes_total\`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.

OneUptime adds four 0/1 series for each pool, which the alert templates read: \`xcp_ng.host.running\`, \`xcp_ng.host.enabled\`, \`xcp_ng.vm.running\` and \`xcp_ng.vm.stopped_after_running\` (a VM halted or paused that ran in the last day). It also stamps every point with \`xcp_ng.scope\` (\`pool\`, \`host\`, \`vm\`, \`sr\`, \`vdi\` or \`xostor\`) and \`xcp_ng.id\` (that object's UUID), which monitors and dashboards filter on.

Not kept: Xen Orchestra's own process series (\`xo_*\`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.`,
  };
}

function getSeveralXenOrchestrasTopic(): SetupGuideTopic {
  return {
    title: "Reading several Xen Orchestras",
    summary:
      "One agent per Xen Orchestra; each pool belongs to the one that reads it.",
    markdown: `One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with its own \`container_name\` in its \`docker-compose.yml\`:

${codeBlock("bash", `INSTALL_DIR=/opt/oneuptime-xcp-ng-agent-lab bash install.sh`)}

Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.`,
  };
}

function getLabelsTopic(context: GuideContext): SetupGuideTopic {
  return {
    title: "Tag the pools with project labels",
    summary:
      "Attach labels such as team or environment to every pool this agent reads.",
    markdown: `Any resource attribute prefixed with \`oneuptime.label.\` becomes a project label on each pool the agent reads: \`oneuptime.label.<dimension>=<value>\` is the label \`<dimension>:<value>\`. Add them to the \`resource\` processor in \`otel-collector-config.yaml\`, next to \`oneuptime.agent.version\`:

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
    `docker compose restart ${XCP_NG_AGENT_CONTAINER}`,
  ]),
)}

The pools show up tagged \`team:platform\` and \`env:production\`. Labels are matched case-insensitively, so an existing \`Production\` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited \`otel-collector-config.yaml\` and keeps yours next to it as \`otel-collector-config.yaml.bak.<timestamp>\`.`,
  };
}

function getUpgradeTopic(context: GuideContext): SetupGuideTopic {
  const upgrade: string =
    context.method === "install-script"
      ? `**Upgrade** — the collector image is pinned in \`docker-compose.yml\` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing \`.env\` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest \`docker-compose.yml\` and \`otel-collector-config.yaml\` — a file you edited is kept next to the new one as \`<file>.bak.<timestamp>\` — pulls the image and recreates the agent with it:

${codeBlock("bash", getXcpNgAgentUpgradeCommand(context.oneuptimeUrl))}`
      : `Run these in the agent's folder, the one with \`docker-compose.yml\`.

**Upgrade** — the collector image is pinned in \`docker-compose.yml\` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your \`.env\` and \`${XCP_NG_AGENT_CA_FILE}\` stay, and a change you made to either file has to be made again:

${codeBlock("bash", getXcpNgAgentDownloadCommand(context.oneuptimeUrl))}

Then pull the image and recreate the agent, so the collector reads its new config:

${codeBlock("bash", XCP_NG_AGENT_RECREATE_COMMAND)}`;

  return {
    title: "Upgrade or uninstall the agent",
    summary:
      "Download the latest files and recreate the agent, or stop and remove it.",
    markdown: `${upgrade}

The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.

**Uninstall** the agent:

${codeBlock("bash", inAgentFolder(context.method, ["docker compose down"]))}

Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.`,
  };
}

function getAdvancedTopics(context: GuideContext): Array<SetupGuideTopic> {
  return [
    getEnvironmentVariablesTopic(context),
    getCertificateTopic(context),
    getCollectedDataTopic(),
    getSeveralXenOrchestrasTopic(),
    getLabelsTopic(context),
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

  const inFolder: string =
    context.method === "install-script"
      ? ` (in \`${XCP_NG_AGENT_INSTALL_DIR}\`)`
      : " (in the agent's folder)";

  return [
    {
      title: "Run the diagnostic script first",
      markdown: `\`troubleshoot.sh\` checks the whole chain — the container, Xen Orchestra's certificate against \`${XCP_NG_AGENT_CA_FILE}\`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with \`401\` or \`422\`, which the collector logs as a single \`Exporting failed\` line per batch that is easy to miss.

${codeBlock(
  "bash",
  `${getTroubleshootScriptDownloadCommand(context.oneuptimeUrl, XCP_NG_AGENT_INSTALL_NAME)}
${runScript}`,
)}

It ends with a verdict naming the most likely cause. It never prints the secret.`,
    },
    {
      title: 'A pool shows as "Disconnected"',
      markdown: `OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.

1. If every pool of this Xen Orchestra is Disconnected, check the agent${inFolder}: \`docker compose ps\` and \`docker compose logs ${XCP_NG_AGENT_CONTAINER} | grep -i error\`.
2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.`,
    },
    {
      title: "Xen Orchestra refuses the secret (401)",
      markdown: `The collector logs \`server returned HTTP status 401 Unauthorized\`. Copy the secret again from *Settings → Plugins → openmetrics*, set \`XO_OPENMETRICS_SECRET\` to it in \`.env\` — between single quotes, every \`$\` written as \`$$\` — and apply it with \`docker compose up -d\` in ${agentFolder(context.method)}. Before 6.8, Xen Orchestra made a new secret each time it restarted.`,
    },
    {
      title: "The plugin does not answer (404, 500, 502 or 503)",
      markdown: `Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is ${XCP_NG_MINIMUM_XEN_ORCHESTRA_VERSION} or later. \`/openmetrics/health\` answers \`{"status":"ok"}\` without a secret while the plugin runs.`,
    },
    {
      title: "Certificate errors",
      markdown: `- \`x509: certificate is not valid for any names\` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.
- \`x509: certificate is valid for <names>, not <address>\` — connect to one of those names, or set \`XO_TLS_SERVER_NAME\` to one.
- \`x509: certificate signed by unknown authority\` — \`${XCP_NG_AGENT_CA_FILE}\` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.`,
    },
    {
      title: "A pool is missing",
      markdown:
        "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.",
    },
  ];
}

function getLinks(): Array<SetupGuideLink> {
  return [
    {
      title: "XCP-ng documentation",
      url: "/docs/telemetry/xcp-ng",
    },
    {
      title: "XCP-ng monitors and alerts",
      url: "/docs/monitor/xcp-ng-monitor",
    },
  ];
}

/**
 * The XCP-ng guide for one way of installing the agent, filled in with the
 * reader's OneUptime URL and ingestion key.
 */
export function getXcpNgSetupGuide(
  options: XcpNgSetupGuideOptions,
): SetupGuideContent {
  const context: GuideContext = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    hasApiKey: options.hasApiKey,
    method: options.method,
    xenOrchestraName: (options.xenOrchestraName || "").trim(),
  };

  return {
    prerequisites: getPrerequisites(),
    steps: [
      getPluginStep(),
      context.method === "install-script"
        ? getInstallScriptStep(context)
        : getDockerComposeStep(context),
      getVerifyStep(context),
    ],
    advanced: getAdvancedTopics(context),
    troubleshooting: getTroubleshootingTopics(context),
    links: getLinks(),
  };
}
