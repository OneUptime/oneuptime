import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideLink,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  shellQuote,
} from "../../../Components/SetupGuide/SetupGuide";

/*
 * The in-app install guide for a Dell PowerScale cluster (#11003). The
 * Storage Array Agent polls each of the cluster's nodes over SNMP (Dell's
 * ISILON-MIB) with the collector's own SNMP receiver: no API token, no
 * exporter. The steps here are PowerScale's own - SNMP on the cluster,
 * every node's address, the community or SNMPv3 user - and the topics every
 * platform shares (the install script's opening lines, the verify step,
 * labels, systemd, upgrading, a disconnected array, its name) come from the
 * shared guide (DocumentationMarkdown.ts), so they read, and are
 * translated, the same in every guide. #11123 gives each platform a guide
 * of its own this way.
 */

// The agent config the guide installs: the collector polls every node.
export const POWERSCALE_COLLECTOR_CONFIG: string =
  "otel-collector-config.powerscale.yaml";

// Three nodes, as a cluster's smallest supported size.
export const POWERSCALE_EXAMPLE_NODES: ReadonlyArray<string> = [
  "10.20.0.11",
  "10.20.0.12",
  "10.20.0.13",
];

// Stands in for the cluster's read-only community, which OneUptime never sees.
export const POWERSCALE_COMMUNITY_PLACEHOLDER: string = "<read-only-community>";

// What the shared guide hands this one: its words, its commands, its topics.
export interface PowerScaleSetupGuideInput {
  oneuptimeUrl: string;
  apiKey: string;
  // The install script already carries the URL and the key.
  isPrefilled: boolean;
  arrayName: string;
  isArrayNameKnown: boolean;
  installDirectory: string;
  agentContainer: string;
  installCommand: string;
  downloadCommand: string;
  troubleshootCommand: string;
  // The shared lines of the install script's tab, in the shared words.
  installScriptNote: string;
  installScriptIntro: string;
  installScriptAsks: Array<string>;
  knownNameNote: string;
  composeDownloadIntro: string;
  composeEnvIntro: string;
  composeStartIntro: string;
  composeKeyNote: string;
  arrayNameNote: string;
  verifyStep: SetupGuideStep;
  environmentIntro: string;
  sharedAdvanced: Array<SetupGuideTopic>;
  upgradeTopic: SetupGuideTopic;
  sharedTroubleshooting: Array<SetupGuideTopic>;
  diagnosticVerdict: string;
  links: Array<SetupGuideLink>;
}

/*
 * The polls install.sh writes for these nodes: snmp/cluster and snmp/quotas
 * read the cluster through the first node, then snmp/node-<n> reads node
 * <n>, as install.sh's setup_powerscale writes them.
 */
export function getPowerScaleNodeLines(
  nodes: ReadonlyArray<string>,
): Array<string> {
  const receivers: Array<string> = ["snmp/cluster", "snmp/quotas"];
  const lines: Array<string> = [];
  nodes.forEach((node: string, index: number): void => {
    receivers.push(`snmp/node-${index + 1}`);
    lines.push(`POWERSCALE_NODE_${index + 1}=${shellQuote(node)}`);
  });
  return [
    `POWERSCALE_NODES=${shellQuote(nodes.join(","))}`,
    `POWERSCALE_SNMP_RECEIVERS=${shellQuote(`[${receivers.join(", ")}]`)}`,
    ...lines,
  ];
}

// The .env a Docker Compose install writes for a three-node cluster.
export function getPowerScaleEnvFile(data: {
  oneuptimeUrl: string;
  apiKey: string;
  arrayName: string;
}): string {
  return [
    `ONEUPTIME_URL=${data.oneuptimeUrl}`,
    `ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}`,
    `STORAGE_ARRAY_NAME=${shellQuote(data.arrayName)}`,
    "STORAGE_SYSTEM=dell.powerscale",
    `STORAGE_ARRAY_COLLECTOR_CONFIG=${POWERSCALE_COLLECTOR_CONFIG}`,
    "COMPOSE_PROFILES=",
    `POWERSCALE_ENDPOINT=${shellQuote(POWERSCALE_EXAMPLE_NODES[0]!)}`,
    "POWERSCALE_SNMP_VERSION=v2c",
    `POWERSCALE_SNMP_COMMUNITY=${shellQuote(POWERSCALE_COMMUNITY_PLACEHOLDER)}`,
    ...getPowerScaleNodeLines(POWERSCALE_EXAMPLE_NODES),
  ].join("\n");
}

function list(items: Array<string>): string {
  return items
    .map((item: string): string => {
      return `- ${item}`;
    })
    .join("\n");
}

function getSnmpStep(): SetupGuideStep {
  return {
    title: "Turn on SNMP on the cluster",
    description:
      "The agent only ever reads, over SNMP: give it a read-only community, or an SNMPv3 user.",
    markdown: `SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default \`I$ilonpublic\`:

${codeBlock(
  "bash",
  [
    "isi snmp settings modify --service yes",
    `isi snmp settings modify --snmp-v1-v2c-access yes -c '${POWERSCALE_COMMUNITY_PLACEHOLDER}'`,
  ].join("\n"),
)}

Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, \`general\` until you rename it: give it passwords of at least eight characters, without spaces:

${codeBlock(
  "bash",
  [
    "isi snmp settings modify --service yes",
    "isi snmp settings modify --snmp-v3-access yes -u '<read-only-user>' --snmp-v3-password '<authentication-password>' --snmp-v3-priv-password '<privacy-password>'",
  ].join("\n"),
)}

\`isi snmp settings view\` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with \`isi network interfaces list\`.`,
  };
}

function getInstallScriptVariant(input: PowerScaleSetupGuideInput): string {
  const asks: Array<string> = [
    ...input.installScriptAsks,
    "**every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports",
    "the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo",
  ];

  return `${codeBlock("bash", input.installCommand)}

${input.installScriptNote}

${input.installScriptIntro}

${list(asks)}${input.isArrayNameKnown ? `\n\n${input.knownNameNote}` : ""}

A user whose protocols are not SHA and AES needs \`POWERSCALE_SNMP_AUTH_PROTOCOL\` and \`POWERSCALE_SNMP_PRIVACY_PROTOCOL\` in front of \`bash install.sh\`, and a user without privacy \`POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv\`.

It installs to \`${input.installDirectory}\`, writes a \`.env\` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to \`POWERSCALE_NODES\` in that file and run \`bash install.sh\` again.`;
}

function getDockerComposeVariant(input: PowerScaleSetupGuideInput): string {
  const notes: Array<string> = [
    input.isArrayNameKnown
      ? input.arrayNameNote
      : `Replace \`${input.arrayName}\` with a name for this cluster, such as \`ps-prod\`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.`,
    "List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.",
    "For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.",
  ];

  return `${input.composeDownloadIntro}

${codeBlock(
  "bash",
  [
    "mkdir oneuptime-storage-array-agent && cd oneuptime-storage-array-agent",
    input.downloadCommand,
  ].join("\n"),
)}

${input.composeEnvIntro}

${codeBlock(
  "bash",
  getPowerScaleEnvFile({
    oneuptimeUrl: input.oneuptimeUrl,
    apiKey: input.apiKey,
    arrayName: input.arrayName,
  }),
)}

${list(notes)}

${input.composeStartIntro}

${codeBlock("bash", "docker compose up -d")}${
    input.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER
      ? `\n\n${input.composeKeyNote}`
      : ""
  }`;
}

function getEnvironmentVariablesTopic(
  input: PowerScaleSetupGuideInput,
): SetupGuideTopic {
  return {
    title: "Environment variables",
    summary: "Every setting the collector reads from its .env file.",
    markdown: `${input.environmentIntro}

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${input.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key — the one picked in step 1 |
| \`STORAGE_ARRAY_NAME\` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as \`storage.array.name\`. Keep it stable — changing it registers a new storage array |
| \`STORAGE_SYSTEM\` | Yes | \`dell.powerscale\` |
| \`STORAGE_ARRAY_COLLECTOR_CONFIG\` | Yes | \`${POWERSCALE_COLLECTOR_CONFIG}\` |
| \`POWERSCALE_NODES\` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |
| \`POWERSCALE_ENDPOINT\` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in \`POWERSCALE_NODES\` |
| \`POWERSCALE_SNMP_RECEIVERS\` | Yes | The polls the collector runs: \`snmp/cluster\`, \`snmp/quotas\`, then \`snmp/node-<n>\` for each node |
| \`POWERSCALE_NODE_<n>\` | Yes | Node \`<n>\`'s address, from 1 to 252 |
| \`POWERSCALE_SNMP_VERSION\` | No | \`v2c\` (default) or \`v3\` |
| \`POWERSCALE_SNMP_COMMUNITY\` | SNMP v2c | The cluster's read-only community |
| \`POWERSCALE_SNMP_USER\` | SNMPv3 | The cluster's SNMPv3 read-only user |
| \`POWERSCALE_SNMP_SECURITY_LEVEL\` | No | \`auth_priv\` (default), \`auth_no_priv\` or \`no_auth_no_priv\` |
| \`POWERSCALE_SNMP_AUTH_PROTOCOL\` | No | \`SHA\` (default), \`MD5\`, \`SHA224\`, \`SHA256\`, \`SHA384\` or \`SHA512\` |
| \`POWERSCALE_SNMP_AUTH_PASSWORD\` | SNMPv3 | The SNMPv3 user's authentication password |
| \`POWERSCALE_SNMP_PRIVACY_PROTOCOL\` | No | \`AES\` (default), \`DES\`, \`AES192\`, \`AES256\`, \`AES192C\` or \`AES256C\` |
| \`POWERSCALE_SNMP_PRIVACY_PASSWORD\` | SNMPv3 | The SNMPv3 user's privacy password |`,
  };
}

function getPollsTopic(input: PowerScaleSetupGuideInput): SetupGuideTopic {
  return {
    title: "How the agent polls the cluster",
    summary:
      "The cluster once through its first node, then every node on its own.",
    markdown: `${list([
      "**One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.",
      "**The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).",
      "**Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).",
      "**Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.",
    ])}

The full config, one SNMP receiver per node slot, is \`${POWERSCALE_COLLECTOR_CONFIG}\` in the agent's folder:

${codeBlock("bash", `less ${input.installDirectory}/${POWERSCALE_COLLECTOR_CONFIG}`)}`,
  };
}

function getTroubleshootingTopics(
  input: PowerScaleSetupGuideInput,
): Array<SetupGuideTopic> {
  return [
    {
      title: "Run the diagnostic script first",
      markdown: `\`troubleshoot.sh\` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in \`.env\`, each node with \`snmpget\` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.

${codeBlock("bash", input.troubleshootCommand)}

${input.diagnosticVerdict}`,
    },
    {
      title: "A node does not answer SNMP",
      markdown: `\`Error scraping metrics\` with \`request timeout\` in \`docker logs ${input.agentContainer}\` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in \`POWERSCALE_NODES\`: add it and run \`bash install.sh\` again.`,
    },
    ...input.sharedTroubleshooting,
  ];
}

/**
 * The Storage Array Agent install guide for a PowerScale cluster, filled in
 * with the reader's OneUptime URL and ingestion key.
 */
export function getPowerScaleSetupGuide(
  input: PowerScaleSetupGuideInput,
): SetupGuideContent {
  return {
    prerequisites: [
      "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)",
      "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user",
    ],
    steps: [
      getSnmpStep(),
      {
        title: "Install the agent",
        description:
          "Run it on any machine that reaches every node of the cluster. One agent monitors one cluster.",
        variants: [
          {
            label: "Install script",
            markdown: getInstallScriptVariant(input),
          },
          {
            label: "Docker Compose",
            markdown: getDockerComposeVariant(input),
          },
        ],
      },
      input.verifyStep,
    ],
    advanced: [
      getEnvironmentVariablesTopic(input),
      getPollsTopic(input),
      ...input.sharedAdvanced,
      input.upgradeTopic,
    ],
    troubleshooting: getTroubleshootingTopics(input),
    links: input.links,
  };
}
