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
import {
  getAgentFileDownloadCommand,
  getInstallScriptDownloadCommand,
  getInstallScriptRunCommand,
  getTroubleshootScriptDownloadCommand,
} from "../../../Components/SetupGuide/AgentInstallCommands";
import { InstallScriptName } from "Common/Types/InstallScripts/InstallScripts";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The in-app guide for connecting an OpenStack cloud with the OneUptime OpenStack
 * agent (agents/OpenStackAgent): a stock OpenTelemetry collector that scrapes
 * openstack-exporter, one OpenStack service at a time.
 *
 * What makes this guide different from the Proxmox and VMware ones is the
 * credential. OpenStack has no global read-only role, so "create a read-only user"
 * does not exist here: the guide says so, and asks how much the agent should see
 * (#5721's three levels). Each level's words say what it sees and what it does not.
 */

export type OpenStackConnectMethod = "install-script" | "docker-compose";

export const OPENSTACK_CONNECT_METHODS: Array<
  SetupGuideOption<OpenStackConnectMethod>
> = [
  {
    key: "install-script",
    label: "Install script",
    description:
      "One command downloads the agent and its exporter, asks for your credential and starts them.",
    badge: "Recommended",
  },
  {
    key: "docker-compose",
    label: "Docker Compose",
    description:
      "Download two files, write a clouds.yaml and a .env file and start the agent yourself.",
  },
];

export const DEFAULT_OPENSTACK_CONNECT_METHOD: OpenStackConnectMethod =
  "install-script";

export function resolveOpenStackConnectMethod(
  method: string | null | undefined,
): OpenStackConnectMethod {
  return (
    resolveSetupGuideOption(OPENSTACK_CONNECT_METHODS, method) ||
    DEFAULT_OPENSTACK_CONNECT_METHOD
  );
}

/*
 * Where every OneUptime serves the agent's install script and files, for its own
 * release (Common/Types/InstallScripts): /install/openstack-agent on the reader's
 * OneUptime. And where install.sh puts them.
 */
export const OPENSTACK_AGENT_INSTALL_NAME: InstallScriptName =
  InstallScriptName.OpenStackAgent;
export const OPENSTACK_AGENT_INSTALL_DIR: string =
  "/opt/oneuptime-openstack-agent";

// The containers docker-compose.yml runs (their container_name).
export const OPENSTACK_AGENT_CONTAINER: string = "oneuptime-openstack-agent";
export const OPENSTACK_EXPORTER_CONTAINER: string =
  "oneuptime-openstack-exporter";

// The name the guide suggests when it is not installing for a known cloud.
export const OPENSTACK_EXAMPLE_CLOUD_NAME: string = "my-openstack-cloud";

// The clouds.yaml entry the guide's examples read: entries are named for regions.
export const OPENSTACK_EXAMPLE_REGION: string = "RegionOne";

// The files that make up each way of giving the agent access.
export const OPENSTACK_ACCESS_RULES_FILE: string =
  "application-credential-access-rules.json";
export const OPENSTACK_POLICY_FILES: ReadonlyArray<string> = [
  "nova.yaml",
  "neutron.yaml",
  "cinder.yaml",
  "placement.yaml",
  "keystone.yaml",
];

// The role agents/OpenStackAgent/access/policy/ gives its reads to.
export const OPENSTACK_MONITORING_ROLE: string = "oneuptime_monitoring";

// What the guide calls the account's project and account, and the credential.
export const OPENSTACK_MONITORING_PROJECT: string = "oneuptime-monitoring";
export const OPENSTACK_CREDENTIAL_NAME: string = "oneuptime-agent";

// What the install script's step says under its command.
export const OPENSTACK_INSTALL_READ_FIRST_NOTE: string = translationKey(
  "To read the script before it runs, run only the part before the &&: it downloads the script as install.sh.",
);

/*
 * The lines of agents/OpenStackAgent/otel-collector-config.yaml that give a cloud
 * its identity. OpenStackProductWiring.test.ts fails when the shipped file stops
 * saying them, because a guide that names the wrong attribute registers nothing.
 */
export const OPENSTACK_AGENT_IDENTITY_CONFIG: string = `processors:
  resource:
    attributes:
      - key: openstack.cloud.name
        value: \${env:OPENSTACK_CLOUD_NAME}
        action: upsert
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      - key: service.name
        action: delete
      - key: service.instance.id
        action: delete`;

export interface OpenStackSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  // False while no key is picked and `apiKey` is the placeholder.
  hasApiKey: boolean;
  method: OpenStackConnectMethod;
  /*
   * The cloud the guide installs for (a cloud's own Documentation tab, or the
   * Add dialog's name). Omitted on the product pages, where the guide suggests
   * a name instead.
   */
  cloudName?: string | undefined;
  // When the guide is read: its example credential expires a year after.
  now?: Date | undefined;
}

interface GuideContext {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  method: OpenStackConnectMethod;
  cloudName: string;
  isCloudNameKnown: boolean;
  now: Date;
}

function isPrefilled(context: { apiKey: string; hasApiKey: boolean }): boolean {
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
 * /opt/oneuptime-openstack-agent by default, a Compose install lives wherever the
 * reader put it.
 */
function inAgentFolder(
  method: OpenStackConnectMethod,
  commands: Array<string>,
): string {
  if (method === "install-script") {
    return [`cd ${OPENSTACK_AGENT_INSTALL_DIR}`, ...commands].join("\n");
  }
  return commands.join("\n");
}

function agentFolder(method: OpenStackConnectMethod): string {
  return method === "install-script"
    ? `\`${OPENSTACK_AGENT_INSTALL_DIR}\``
    : "the folder with `docker-compose.yml`";
}

/*
 * install.sh asks only for what its environment does not already hold, so the
 * command can carry the reader's URL, key and cloud name. Only a real key goes
 * there: the script writes whatever it is given into .env, and a placeholder would
 * become the key the agent sends. The OpenStack credential never does: the script
 * reads it without echoing it, and it ends up in clouds.yaml alone.
 */
export function getOpenStackInstallScriptCommand(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  cloudName?: string | undefined;
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

  if (data.cloudName) {
    environment.push(`OPENSTACK_CLOUD_NAME=${shellQuote(data.cloudName)}`);
  }

  const download: string = getInstallScriptDownloadCommand(
    data.oneuptimeUrl,
    OPENSTACK_AGENT_INSTALL_NAME,
  );
  const run: string = getInstallScriptRunCommand(
    environment,
    "bash install.sh",
  );

  // A line ending in && carries on to the next, so this stays one command.
  return environment.length < 2
    ? `${download} && ${run}`
    : `${download} &&\n  ${run}`;
}

/*
 * The commands that upgrade the agent. The images are pinned in docker-compose.yml
 * and its config is a file beside it, so pulling alone never moves the agent
 * forward. An install-script install runs the script again: it reuses every value
 * in .env and clouds.yaml (nothing is asked again) and keeps a file the reader
 * edited as <file>.bak.<timestamp>. The dialog beside an outdated agent version
 * (Components/AgentVersion) shows these too.
 */
export function getOpenStackAgentUpgradeCommand(oneuptimeUrl: string): string {
  return getOpenStackInstallScriptCommand({
    oneuptimeUrl: oneuptimeUrl,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
  });
}

/*
 * An install without Docker, which a re-run stays: the same script as root, which
 * installs the releases and files this OneUptime pins and restarts the services.
 */
export function getOpenStackAgentNativeUpgradeCommand(
  oneuptimeUrl: string,
): string {
  return `${getInstallScriptDownloadCommand(
    oneuptimeUrl,
    OPENSTACK_AGENT_INSTALL_NAME,
  )} && sudo bash install.sh`;
}

export function getOpenStackAgentDownloadCommand(oneuptimeUrl: string): string {
  return [
    getAgentFileDownloadCommand(
      oneuptimeUrl,
      OPENSTACK_AGENT_INSTALL_NAME,
      "docker-compose.yml",
    ),
    getAgentFileDownloadCommand(
      oneuptimeUrl,
      OPENSTACK_AGENT_INSTALL_NAME,
      "otel-collector-config.yaml",
    ),
  ].join("\n");
}

export const OPENSTACK_AGENT_RECREATE_COMMAND: string =
  "docker compose pull\ndocker compose up -d --force-recreate";

/* What the reader needs before step one. */

function getPrerequisites(method: OpenStackConnectMethod): Array<string> {
  const docker: string =
    method === "install-script"
      ? "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)"
      : "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent";

  return [
    docker,
    "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it",
    "That machine can reach Keystone and every service's API",
    "The `openstack` command line, as someone who can create the credential below",
  ];
}

/* The credential: the three levels of #5721, and what each one costs. */

const ONE_YEAR_IN_MS: number = 365 * 24 * 60 * 60 * 1000;

/*
 * A date a year from when the guide is read, written here rather than left to the
 * shell: GNU and BSD date disagree on how to say it, and a credential may be made
 * from a laptop.
 */
function credentialExpiry(now: Date): string {
  const expires: string = new Date(now.getTime() + ONE_YEAR_IN_MS)
    .toISOString()
    .substring(0, 19);
  return `--expiration ${expires}`;
}

function accessFileCommand(oneuptimeUrl: string, file: string): string {
  return getAgentFileDownloadCommand(
    oneuptimeUrl,
    OPENSTACK_AGENT_INSTALL_NAME,
    `access/${file}`,
  );
}

function getFullViewMarkdown(context: GuideContext): string {
  return `**Recommended.** The agent sees everything: services, hypervisors, storage pools, and every project's instances, volumes, networks and routers.

This is an application credential on an account with \`admin\` on a project of its own, limited by access rules to the exact \`GET\` calls the agent makes, so it cannot write. As an admin, make the project and the account:

${codeBlock(
  "bash",
  `openstack project create --domain default ${OPENSTACK_MONITORING_PROJECT}
openstack user create --domain default --password-prompt ${OPENSTACK_MONITORING_PROJECT}
openstack role add --project ${OPENSTACK_MONITORING_PROJECT} --user ${OPENSTACK_MONITORING_PROJECT} admin`,
)}

Then, logged in as that account on that project, make the credential:

${codeBlock(
  "bash",
  `${accessFileCommand(context.oneuptimeUrl, OPENSTACK_ACCESS_RULES_FILE)}
openstack application credential create ${OPENSTACK_CREDENTIAL_NAME} \\
  --role admin \\
  --access-rules "$(cat ${OPENSTACK_ACCESS_RULES_FILE})" \\
  ${credentialExpiry(context.now)}`,
)}

- Copy the \`id\` and the \`secret\` it prints: the secret is shown only once.
- Never add \`--unrestricted\`, which would let it make more credentials.
- Access rules work only where each service sets \`service_type\` in its \`[keystone_authtoken]\` section and has been restarted since. Without that, the services refuse the credential with a \`401\`.
- If you won't change that, leave out \`--access-rules\`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.
- It stops working when it expires. To replace it, make the second credential before you delete the first.`;
}

function getInfrastructureOnlyMarkdown(context: GuideContext): string {
  return `No admin. The agent sees control-plane health and capacity: hypervisors, services, agents, address pools, storage pools, Placement and the project list. Instances, volumes and routers appear only for the projects the role is assigned on, and OneUptime can't see the others.

This is a role of its own, \`${OPENSTACK_MONITORING_ROLE}\`, with the policy overrides the agent ships. As an admin, make the role, a project and an account:

${codeBlock(
  "bash",
  `openstack role create ${OPENSTACK_MONITORING_ROLE}
openstack project create --domain default ${OPENSTACK_MONITORING_PROJECT}
openstack user create --domain default --password-prompt ${OPENSTACK_MONITORING_PROJECT}
openstack role add --project ${OPENSTACK_MONITORING_PROJECT} --user ${OPENSTACK_MONITORING_PROJECT} ${OPENSTACK_MONITORING_ROLE}
openstack role add --project ${OPENSTACK_MONITORING_PROJECT} --user ${OPENSTACK_MONITORING_PROJECT} reader`,
)}

Download the overrides, and merge each, on every controller, into the file named by \`[oslo_policy] policy_file\` in that service's config. That is \`/etc/nova/policy.yaml\` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:

${codeBlock(
  "bash",
  OPENSTACK_POLICY_FILES.map((file: string): string => {
    return accessFileCommand(context.oneuptimeUrl, `policy/${file}`);
  }).join("\n"),
)}

Then, logged in as that account on that project, make the credential and copy the \`id\` and the \`secret\` it prints:

${codeBlock(
  "bash",
  `openstack application credential create ${OPENSTACK_CREDENTIAL_NAME} \\
  ${credentialExpiry(context.now)}`,
)}

To see a project's instances, volumes and routers, assign the account a role on it.`;
}

function getProjectViewMarkdown(context: GuideContext): string {
  return `For a team watching its own part of a cloud someone else runs. The agent sees one project's instances, volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.

This is the plain \`reader\` role. Give an account the role on the project:

${codeBlock(
  "bash",
  "openstack role add --project <project> --user <account> reader",
)}

Then, logged in as that account on that project, make the credential and copy the \`id\` and the \`secret\` it prints:

${codeBlock(
  "bash",
  `openstack application credential create ${OPENSTACK_CREDENTIAL_NAME} \\
  --role reader \\
  ${credentialExpiry(context.now)}`,
)}

Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.`;
}

function getCredentialStep(context: GuideContext): SetupGuideStep {
  return {
    title: "Create the agent's credential",
    description:
      "OpenStack has no global read-only role, so there is no read-only account to create. Instead, choose how much the agent should see.",
    variants: [
      { label: "Full view", markdown: getFullViewMarkdown(context) },
      {
        label: "Infrastructure only",
        markdown: getInfrastructureOnlyMarkdown(context),
      },
      { label: "Project view", markdown: getProjectViewMarkdown(context) },
    ],
  };
}

/* Installing the agent. */

function getInstallScriptStep(context: GuideContext): SetupGuideStep {
  const prefilled: boolean = isPrefilled(context);
  const asked: Array<string> = [];

  if (!prefilled) {
    asked.push(
      "**OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.",
    );
  }
  if (!context.isCloudNameKnown) {
    asked.push(
      "**Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.",
    );
  }
  asked.push(
    "**Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.",
    `**Region names**, comma-separated (\`${OPENSTACK_EXAMPLE_REGION}\` if you have one).`,
    "**Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.",
    "**Private CA file**, only if the cloud's certificate comes from its own certificate authority.",
  );

  return {
    title: "Install the agent",
    description:
      "Download the install script and run it on the machine that will host the agent.",
    markdown: codeBlock(
      "bash",
      getOpenStackInstallScriptCommand({
        oneuptimeUrl: context.oneuptimeUrl,
        apiKey: context.apiKey,
        hasApiKey: context.hasApiKey,
        cloudName: context.isCloudNameKnown ? context.cloudName : undefined,
      }),
    ),
    note: OPENSTACK_INSTALL_READ_FIRST_NOTE,
    details: `The script asks for:

${asked
  .map((line: string): string => {
    return `- ${line}`;
  })
  .join("\n")}

It checks the credential with Keystone before it installs anything, installs to \`${OPENSTACK_AGENT_INSTALL_DIR}\`, writes a \`.env\` file and a \`clouds.yaml\` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.`,
  };
}

function getCloudNameNote(context: GuideContext): string {
  if (context.isCloudNameKnown) {
    return `This installs the agent for **\`${context.cloudName}\`**. Keep \`OPENSTACK_CLOUD_NAME\` exactly as it is, or the data registers as a new cloud.`;
  }
  return `Replace \`${context.cloudName}\` with a name for this cloud, such as \`prod-eu\`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.`;
}

function getCloudsFileExample(): string {
  return `clouds:
  ${OPENSTACK_EXAMPLE_REGION}:
    region_name: ${OPENSTACK_EXAMPLE_REGION}
    identity_api_version: 3
    auth_type: v3applicationcredential
    auth:
      auth_url: https://keystone.example.com:5000/v3
      application_credential_id: your-credential-id
      application_credential_secret: your-credential-secret`;
}

function getDockerComposeStep(context: GuideContext): SetupGuideStep {
  return {
    title: "Install the agent",
    description:
      "Download the agent's files, write its credential and settings, and start it with Docker Compose.",
    markdown: `Download \`docker-compose.yml\` and \`otel-collector-config.yaml\` from this OneUptime into a new folder:

${codeBlock(
  "bash",
  `mkdir oneuptime-openstack-agent && cd oneuptime-openstack-agent
${getOpenStackAgentDownloadCommand(context.oneuptimeUrl)}`,
)}

Create a \`clouds.yaml\` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:

${codeBlock("yaml", getCloudsFileExample())}

Create a \`.env\` file next to them too:

${codeBlock(
  "bash",
  `ONEUPTIME_URL=${context.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${context.apiKey}
OPENSTACK_CLOUD_NAME=${shellQuote(context.cloudName)}
OPENSTACK_EXPORTER_CLOUDS=[${OPENSTACK_EXAMPLE_REGION}]
COMPOSE_PROFILES=openstack-exporter`,
)}

- ${getCloudNameNote(context)}
- List every region in \`OPENSTACK_EXPORTER_CLOUDS\`, in square brackets, such as \`[RegionOne,RegionTwo]\`.
- \`COMPOSE_PROFILES=openstack-exporter\` starts the bundled exporter, which reads the cloud with \`clouds.yaml\`.

Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read \`clouds.yaml\`. Then start the agent:

${codeBlock(
  "bash",
  `chmod 600 .env
sudo chown 65532:65532 clouds.yaml
sudo chmod 600 clouds.yaml
docker compose up -d`,
)}${pickKeyNote(context)}`,
  };
}

function getVerifyStep(context: GuideContext): SetupGuideStep {
  return {
    title: "Verify the installation",
    description:
      "Check that the containers are running and the collector is ready.",
    markdown: `${codeBlock(
      "bash",
      inAgentFolder(context.method, [
        "docker compose ps",
        `docker compose logs -f ${OPENSTACK_AGENT_CONTAINER}`,
      ]),
    )}

\`docker compose ps\` lists the collector (\`${OPENSTACK_AGENT_CONTAINER}\`) and the bundled exporter (\`${OPENSTACK_EXPORTER_CONTAINER}\`). In the collector's logs, look for \`Everything is ready. Begin running and processing data.\` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.`,
  };
}

/* Everything else, folded away. */

function getAccessLevelsTopic(): SetupGuideTopic {
  return {
    title: "What each level of access sees",
    summary:
      "Full view, Infrastructure only and Project view, and what each one leaves out.",
    markdown: `OpenStack's \`reader\` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code. So what a credential can read depends on which level you choose:

| | Full view | Infrastructure only | Project view |
|---|---|---|---|
| **Credential** | Application credential on an admin account, limited by access rules | \`${OPENSTACK_MONITORING_ROLE}\` role with the policy overrides | Plain \`reader\` |
| **Services and Neutron agents** | Yes | Yes | No |
| **Hypervisors and Placement capacity** | Yes | Yes | No |
| **Storage pools and address pools** | Yes | Yes | No |
| **Project list** | Yes | Yes | Its own |
| **Instances, volumes and routers** | Every project | The projects the role is on | Its own project |

A list a credential can't read looks empty here: \`troubleshoot.sh\` says what this credential can read, and what each gap costs.`,
  };
}

function getEnvironmentVariablesTopic(context: GuideContext): SetupGuideTopic {
  const where: string =
    context.method === "install-script"
      ? `The install script writes these to \`${OPENSTACK_AGENT_INSTALL_DIR}/.env\`.`
      : "The agent reads these from the `.env` file next to `docker-compose.yml`.";

  // An answer to the script. An install by hand says it in clouds.yaml instead.
  const authUrl: string =
    context.method === "install-script"
      ? "\n| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |"
      : "";

  return {
    title: "Environment variables",
    summary: "Every setting the collector and the bundled exporter read.",
    markdown: `${where} After changing one, apply it with \`docker compose up -d\` in ${agentFolder(context.method)}.

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${context.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key: the one picked in step 1 |
| \`OPENSTACK_CLOUD_NAME\` | Yes | The cloud's name in OneUptime, stamped on every metric as the \`openstack.cloud.name\` resource attribute. Keep it stable: changing it registers a new cloud |
| \`OPENSTACK_EXPORTER_CLOUDS\` | Yes | The \`clouds.yaml\` entries to read, one per region and named for the region, in square brackets: \`[RegionOne,RegionTwo]\` |${authUrl}
| \`OPENSTACK_EXPORTER_ADDRESS\` | No | \`host:port\` of your own exporter, with no scheme. Leave it out for the bundled one |
| \`OPENSTACK_EXPORTER_USER\` | No | The \`uid:gid\` the exporter's container runs as, which must own \`clouds.yaml\` (default: \`65532:65532\`) |
| \`OPENSTACK_CA_FILE\` | No | A PEM file with the certificate authority of a cloud that has its own |
| \`COMPOSE_PROFILES\` | Bundled exporter | \`openstack-exporter\` starts the bundled exporter |

\`clouds.yaml\` alone holds the credential.`,
  };
}

function getRegionsTopic(context: GuideContext): SetupGuideTopic {
  const how: string =
    context.method === "install-script"
      ? "Give the install script every region's name. It writes one `clouds.yaml` entry for each."
      : "Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`.";

  return {
    title: "Several regions",
    summary:
      "One agent reads every region of a cloud, one clouds.yaml entry each.",
    markdown: `A cloud is one Keystone, however many regions it has, and one agent reads them all. ${how} Each entry must be named for its region: the collector stamps that name on the exporter's series as \`openstack.region.name\`, because the series do not say which region they are from. Every list in OneUptime then filters by region.

Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.`,
  };
}

function getOwnExporterTopic(context: GuideContext): SetupGuideTopic {
  const how: string =
    context.method === "install-script"
      ? "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for."
      : "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.";

  return {
    title: "Use an exporter you already run",
    summary:
      "Skip the bundled exporter and point the agent at one you already run, such as Kolla-Ansible's.",
    markdown: `${how}

Your exporter must run with \`--multi-cloud\`, and its \`clouds.yaml\` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: \`localhost\` inside the container is the container itself.`,
  };
}

function getCertificateTopic(context: GuideContext): SetupGuideTopic {
  const how: string =
    context.method === "install-script"
      ? "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`."
      : "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.";

  return {
    title: "A cloud with its own certificate authority",
    summary: "Have the bundled exporter trust a private CA.",
    markdown: how,
  };
}

function getWithoutDockerTopic(context: GuideContext): SetupGuideTopic {
  return {
    title: "Run without Docker",
    summary: "The same collector and exporter releases, as systemd services.",
    markdown: `On Linux (x86_64 or arm64) with systemd 235 or later, the install script can run the same collector and exporter releases as systemd services instead:

${codeBlock(
  "bash",
  `${getInstallScriptDownloadCommand(context.oneuptimeUrl, OPENSTACK_AGENT_INSTALL_NAME)} && sudo bash install.sh --without-docker`,
)}

Moving off a Docker install? Run \`docker compose down\` first, or every metric arrives twice. Running the script again stays whichever it was, so \`sudo bash install.sh\` is the upgrade.`,
  };
}

function getCollectedDataTopic(): SetupGuideTopic {
  return {
    title: "What the agent collects, and what it costs your cloud",
    summary:
      "One read per OpenStack service, every few minutes, with the slow and risky reads off.",
    markdown: `Monitoring must never be what takes a cloud down, so the agent is gentle by default:

| Reads | Every | Gives |
|-------|-------|-------|
| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |
| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |
| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |
| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |
| **Identity (Keystone)** | 5 minutes | Projects and domains |
| **Images (Glance)** | 5 minutes | Images |

- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.
- A read never outlasts its interval, so a slow one never stacks on the next.
- The exporter's slow metrics (quotas and limits per project, usage per server) are off.
- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.`,
  };
}

function getCollectorConfigTopic(context: GuideContext): SetupGuideTopic {
  return {
    title: "How a cloud gets its identity",
    summary:
      "The lines of otel-collector-config.yaml that name the cloud, and why they matter.",
    markdown: `The \`resource\` processor in \`otel-collector-config.yaml\` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:

${codeBlock("yaml", OPENSTACK_AGENT_IDENTITY_CONFIG)}

The whole file is on this OneUptime:

${codeBlock(
  "bash",
  getAgentFileDownloadCommand(
    context.oneuptimeUrl,
    OPENSTACK_AGENT_INSTALL_NAME,
    "otel-collector-config.yaml",
  ),
)}`,
  };
}

function getLabelsTopic(context: GuideContext): SetupGuideTopic {
  return {
    title: "Tag the cloud with project labels",
    summary:
      "Attach labels such as team or environment to the cloud from the collector config.",
    markdown: `Any resource attribute prefixed with \`oneuptime.label.\` becomes a project label on the cloud: \`oneuptime.label.<dimension>=<value>\` is the label \`<dimension>:<value>\`. Add them to the \`resource\` processor in \`otel-collector-config.yaml\`, next to \`openstack.cloud.name\`:

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
    `docker compose restart ${OPENSTACK_AGENT_CONTAINER}`,
  ]),
)}

The cloud shows up tagged \`team:platform\` and \`env:production\`. Labels are matched case-insensitively, so an existing \`Production\` label is reused; labels added in the OneUptime UI are never removed by the agent.`,
  };
}

function getUpgradeTopic(context: GuideContext): SetupGuideTopic {
  const upgrade: string =
    context.method === "install-script"
      ? `**Upgrade.** The images are pinned in \`docker-compose.yml\` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing \`.env\` and \`clouds.yaml\` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as \`<file>.bak.<timestamp>\`), pulls the images and recreates the agent with them:

${codeBlock("bash", getOpenStackAgentUpgradeCommand(context.oneuptimeUrl))}`
      : `Run these in the agent's folder, the one with \`docker-compose.yml\`.

**Upgrade.** The images are pinned in \`docker-compose.yml\` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your \`.env\` and \`clouds.yaml\` stay, and a change you made to either file has to be made again:

${codeBlock("bash", getOpenStackAgentDownloadCommand(context.oneuptimeUrl))}

Then pull the images and recreate the agent, so the collector reads its new config:

${codeBlock("bash", OPENSTACK_AGENT_RECREATE_COMMAND)}`;

  return {
    title: "Upgrade or uninstall the agent",
    summary:
      "Download the latest files and recreate the agent, or stop and remove it.",
    markdown: `${upgrade}

The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.

**Uninstall** the agent:

${codeBlock("bash", inAgentFolder(context.method, ["docker compose down"]))}

Then delete ${agentFolder(context.method)}, which holds the credential, and the application credential itself: \`openstack application credential delete ${OPENSTACK_CREDENTIAL_NAME}\`.`,
  };
}

function getAdvancedTopics(context: GuideContext): Array<SetupGuideTopic> {
  return [
    getAccessLevelsTopic(),
    getCollectedDataTopic(),
    getRegionsTopic(context),
    getEnvironmentVariablesTopic(context),
    getOwnExporterTopic(context),
    getCertificateTopic(context),
    getWithoutDockerTopic(context),
    getCollectorConfigTopic(context),
    getLabelsTopic(context),
    getUpgradeTopic(context),
  ];
}

function getTroubleshootingTopics(
  context: GuideContext,
): Array<SetupGuideTopic> {
  const runScript: string =
    context.method === "install-script"
      ? "sudo bash troubleshoot.sh"
      : 'sudo bash troubleshoot.sh -d "$PWD"    # in the folder with docker-compose.yml';

  const inFolder: string =
    context.method === "install-script"
      ? ` (in \`${OPENSTACK_AGENT_INSTALL_DIR}\`)`
      : " (in the agent's folder)";

  const knownName: string = context.isCloudNameKnown
    ? ` This cloud is **\`${context.cloudName}\`**.`
    : "";

  return [
    {
      title: "Run the diagnostic script first",
      markdown: `\`troubleshoot.sh\` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.

${codeBlock(
  "bash",
  `${getTroubleshootScriptDownloadCommand(context.oneuptimeUrl, OPENSTACK_AGENT_INSTALL_NAME)}
${runScript}`,
)}

It needs \`sudo\` to read \`clouds.yaml\`, or it skips the credential checks. It ends with a verdict naming the most likely cause.`,
    },
    {
      title: 'Cloud shows as "Disconnected"',
      markdown: `1. Check that the agent is running${inFolder}: \`docker compose ps\`
2. Check the agent logs for errors: \`docker compose logs ${OPENSTACK_AGENT_CONTAINER} | grep -i error\`
3. Verify your OneUptime URL and ingestion key are correct.
4. Ensure the agent machine can reach the OneUptime instance over the network.`,
    },
    {
      title: "Hypervisors or services are empty",
      markdown: `A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron, Cinder and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in \`access/policy\` merged into each service's \`policy.yaml\`. \`troubleshoot.sh\` says which reads were refused.`,
    },
    {
      title: "Instances or volumes show only one project",
      markdown:
        "Neutron and Cinder answer a plain `reader` with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, instances, volumes and routers appear for the projects the role is assigned on.",
    },
    {
      title: "One service's pages are empty and the rest are fine",
      markdown: `The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it${inFolder}: \`docker compose logs ${OPENSTACK_EXPORTER_CONTAINER}\`. The **Services** page shows that API as \`down\`.`,
    },
    {
      title: "Every read answers 401 with an access-rule credential",
      markdown: `The services are refusing a credential limited by access rules. Each service needs \`service_type\` set for keystonemiddleware, and a restart:

${codeBlock(
  "ini",
  `# nova.conf, for example. neutron.conf: network. glance-api.conf: image.
# cinder.conf: block-storage, or volumev3 on an older catalog.
# placement.conf: placement.
[keystone_authtoken]
service_type = compute`,
)}

If you won't change that, create the credential without \`--access-rules\`, knowing it can write.`,
    },
    {
      title: "The exporter cannot read clouds.yaml",
      markdown:
        "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.",
    },
    {
      title: "Cloud appears under the wrong name",
      markdown: `The cloud's identity comes from \`OPENSTACK_CLOUD_NAME\`, stamped on every metric as \`openstack.cloud.name\`.${knownName} Fix it in \`.env\` and apply it with \`docker compose up -d\` in ${agentFolder(context.method)}. A new name registers a new cloud.`,
    },
  ];
}

/**
 * The OpenStack guide for one way of installing the agent, filled in with the
 * reader's OneUptime URL, ingestion key and cloud name.
 */
export function getOpenStackSetupGuide(
  options: OpenStackSetupGuideOptions,
): SetupGuideContent {
  const knownCloudName: string = (options.cloudName || "").trim();

  const context: GuideContext = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    hasApiKey: options.hasApiKey,
    method: options.method,
    cloudName: knownCloudName || OPENSTACK_EXAMPLE_CLOUD_NAME,
    isCloudNameKnown: Boolean(knownCloudName),
    now: options.now || new Date(),
  };

  return {
    wrapLongLines: true,
    prerequisites: getPrerequisites(context.method),
    steps: [
      getCredentialStep(context),
      context.method === "install-script"
        ? getInstallScriptStep(context)
        : getDockerComposeStep(context),
      getVerifyStep(context),
    ],
    advanced: getAdvancedTopics(context),
    troubleshooting: getTroubleshootingTopics(context),
  };
}
