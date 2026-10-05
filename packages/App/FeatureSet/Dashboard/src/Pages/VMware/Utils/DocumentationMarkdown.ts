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
 * The in-app install guide for the OneUptime VMware agent
 * (agents/VMwareAgent): a stock OpenTelemetry collector whose native
 * `vcenter` receiver polls vCenter (or a standalone ESXi host) with a
 * read-only user, plus the OneUptime AI agent next to it. The guide asks how
 * to install it and shows only that path.
 *
 * The compose file and the collector config below are the REAL files
 * shipped in agents/VMwareAgent, copied verbatim; VMwareSetupGuide.test.ts
 * fails when either drifts. The `.env` block interpolates the reader's
 * OneUptime URL and the ingestion key they picked.
 */

export type VMwareInstallMethod = "install-script" | "docker-compose";

export const VMWARE_INSTALL_METHODS: Array<
  SetupGuideOption<VMwareInstallMethod>
> = [
  {
    key: "install-script",
    label: "Install script",
    description:
      "One command downloads the agent, asks for your vCenter details and starts it.",
    badge: "Recommended",
  },
  {
    key: "docker-compose",
    label: "Docker Compose",
    description:
      "Download two files, write a .env file and start the agent yourself.",
  },
];

export const DEFAULT_VMWARE_INSTALL_METHOD: VMwareInstallMethod =
  "install-script";

export function resolveVMwareInstallMethod(
  method: string | null | undefined,
): VMwareInstallMethod {
  return (
    resolveSetupGuideOption(VMWARE_INSTALL_METHODS, method) ||
    DEFAULT_VMWARE_INSTALL_METHOD
  );
}

// Where the agent's files are published, and where install.sh puts them.
export const VMWARE_AGENT_RAW_URL: string =
  "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent";
export const VMWARE_AGENT_SOURCE_URL: string =
  "https://github.com/OneUptime/oneuptime/tree/master/agents/VMwareAgent";
export const VMWARE_AGENT_INSTALL_DIR: string = "/opt/oneuptime-vmware-agent";

// The containers docker-compose.yml runs (their container_name).
export const VMWARE_AGENT_CONTAINER: string = "oneuptime-vmware-agent";
export const VMWARE_AI_AGENT_CONTAINER: string = "oneuptime-vmware-ai-agent";

// The name the guide suggests when it is not installing for a known vCenter.
export const VMWARE_EXAMPLE_VCENTER_NAME: string = "my-vcenter";

// agents/VMwareAgent/docker-compose.yml, verbatim.
export const VMWARE_AGENT_COMPOSE_FILE: string = `services:
  oneuptime-vmware-agent:
    # Upstream collector, pinned. There is no oneuptime/vmware-agent image —
    # the agent is entirely defined by otel-collector-config.yaml, which
    # install.sh downloads next to this file. The native \`vcenter\`
    # receiver talks to vCenter directly, so no exporter sidecar is
    # needed. This is the version Tests/Ops/validate-collector-configs.sh
    # validates the config against; bump the two together.
    image: otel/opentelemetry-collector-contrib:0.161.0
    container_name: oneuptime-vmware-agent
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro
    # Uncomment (together with the syslog receivers and the logs pipeline
    # in otel-collector-config.yaml) to accept syslog forwarded by ESXi
    # hosts — Syslog.global.logHost = udp://<this-machine>:5514 or
    # tcp://<this-machine>:5514. This powers the Logs tab of the vCenter
    # dashboard.
    # ports:
    #   - "5514:5514/tcp"
    #   - "5514:5514/udp"
    environment:
      - ONEUPTIME_URL=\${ONEUPTIME_URL}
      - ONEUPTIME_TELEMETRY_INGESTION_KEY=\${ONEUPTIME_TELEMETRY_INGESTION_KEY}
      # The name this vCenter registers under in OneUptime (stamped on
      # every metric as the vmware.vcenter.name resource attribute). Keep
      # it stable — changing it registers a brand-new vCenter.
      - VMWARE_VCENTER_NAME=\${VMWARE_VCENTER_NAME:-vmware-vcenter}
      # Scheme + host of vCenter Server (or a standalone ESXi host), no
      # /sdk suffix, e.g. https://vcsa.example.com
      - VCENTER_ENDPOINT=\${VCENTER_ENDPOINT}
      # A vSphere user holding the Read-Only role (see README.md).
      - VCENTER_USERNAME=\${VCENTER_USERNAME}
      - VCENTER_PASSWORD=\${VCENTER_PASSWORD}
      # vCenter ships a self-signed certificate by default. Verification
      # stays ON unless you opt out with "true".
      - VCENTER_INSECURE_SKIP_VERIFY=\${VCENTER_INSECURE_SKIP_VERIFY:-false}
      # Full-inventory poll interval. Raise to 5m/10m for very large
      # vCenters (thousands of VMs).
      - VCENTER_COLLECTION_INTERVAL=\${VCENTER_COLLECTION_INTERVAL:-2m}
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  # The VMware AI agent: runs the govc commands OneUptime AI asks for while it
  # investigates an incident or alert on this vCenter — read-only unless you
  # set ONEUPTIME_AI_ALLOW_WRITES=true — with this vCenter's own credentials
  # from the same .env (OneUptime never sends it any). It registers as the
  # vCenter named VMWARE_VCENTER_NAME, exactly like the collector above, and
  # shows up on that vCenter's AI -> AI agent page. See README.md
  # ("OneUptime AI agent"). Remove this service if you do not use OneUptime AI.
  oneuptime-vmware-ai-agent:
    image: oneuptime/resource-ai-agent:release
    container_name: oneuptime-vmware-ai-agent
    # It only talks HTTPS to vCenter and OneUptime: no root, no capabilities,
    # a read-only root filesystem, and its private per-command directories
    # on a tmpfs.
    user: "1000:1000"
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    # Uncomment (and set VCENTER_CA_FILE=/etc/oneuptime/vcenter-ca.pem) to
    # verify vCenter's certificate against its own CA (the VMCA root, from
    # https://<vcenter>/certs/download.zip) instead of skipping verification.
    # volumes:
    #   - ./vcenter-ca.pem:/etc/oneuptime/vcenter-ca.pem:ro
    environment:
      - ONEUPTIME_URL=\${ONEUPTIME_URL}
      - ONEUPTIME_TELEMETRY_INGESTION_KEY=\${ONEUPTIME_TELEMETRY_INGESTION_KEY}
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=vmware
      # Must match the collector's, so the agent serves the same vCenter.
      - VMWARE_VCENTER_NAME=\${VMWARE_VCENTER_NAME:-vmware-vcenter}
      - VCENTER_ENDPOINT=\${VCENTER_ENDPOINT}
      # Investigations log in as the collector's read-only user ...
      - VCENTER_USERNAME=\${VCENTER_USERNAME}
      - VCENTER_PASSWORD=\${VCENTER_PASSWORD}
      # ... or, when set, as this user — one whose role may power VMs on,
      # off and reset them (VirtualMachine.Interact.PowerOn / PowerOff /
      # Reset), which fixes need. See README.md.
      - ONEUPTIME_AI_VCENTER_USERNAME=\${ONEUPTIME_AI_VCENTER_USERNAME:-}
      - ONEUPTIME_AI_VCENTER_PASSWORD=\${ONEUPTIME_AI_VCENTER_PASSWORD:-}
      - VCENTER_INSECURE_SKIP_VERIFY=\${VCENTER_INSECURE_SKIP_VERIFY:-false}
      - VCENTER_CA_FILE=\${VCENTER_CA_FILE:-}
      # The datacenter commands use when they name none (vCenters with
      # several datacenters).
      - GOVC_DATACENTER=\${GOVC_DATACENTER:-}
      # Read-only unless exactly "true". Then fixes may touch only the VMs
      # and hosts ONEUPTIME_AI_WRITE_TARGETS matches (all when empty), and
      # never ONEUPTIME_AI_PROTECTED_TARGETS or the VM named after
      # VCENTER_ENDPOINT's host (the vCenter appliance, when it is named so).
      # With an IP address as the endpoint, or an appliance VM named
      # otherwise, put the appliance's VM name in ONEUPTIME_AI_PROTECTED_TARGETS.
      # What OneUptime AI may do here, set in .env: ONEUPTIME_AI_INVESTIGATION
      # (true or false) and ONEUPTIME_AI_FIXES (off, ask-for-approval,
      # automatic or bypass-approval; fixes also need
      # ONEUPTIME_AI_ALLOW_WRITES=true). Set either and the AI agent page in
      # OneUptime follows them, read-only; leave both empty for the agent's
      # defaults (investigation on, fixes Ask for approval when writes are
      # allowed, else off).
      - ONEUPTIME_AI_INVESTIGATION=\${ONEUPTIME_AI_INVESTIGATION:-}
      - ONEUPTIME_AI_FIXES=\${ONEUPTIME_AI_FIXES:-}
      - ONEUPTIME_AI_ALLOW_WRITES=\${ONEUPTIME_AI_ALLOW_WRITES:-false}
      - ONEUPTIME_AI_WRITE_TARGETS=\${ONEUPTIME_AI_WRITE_TARGETS:-}
      - ONEUPTIME_AI_PROTECTED_TARGETS=\${ONEUPTIME_AI_PROTECTED_TARGETS:-}
      # Overrides VMWARE_VCENTER_NAME as the name the AI agent registers under.
      - ONEUPTIME_AI_AGENT_RESOURCE_NAME=\${ONEUPTIME_AI_AGENT_RESOURCE_NAME:-}
      # The AI agent's log level: debug, info, warn or error.
      - LOG_LEVEL=\${LOG_LEVEL:-info}
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:3877/status/live"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
`;

// agents/VMwareAgent/otel-collector-config.yaml, verbatim.
export const VMWARE_AGENT_COLLECTOR_CONFIG: string = `receivers:
  # Poll vCenter Server (or a standalone ESXi host) through the vSphere
  # SDK with the collector's native \`vcenter\` receiver. No exporter
  # sidecar is needed: the receiver walks the inventory itself and emits
  # one OTLP resource per vSphere object (datacenter, cluster, ESXi host,
  # virtual machine, VM template, datastore, resource pool) with the
  # object's identity in RESOURCE attributes (vcenter.datacenter.name,
  # vcenter.cluster.name, vcenter.host.name, vcenter.vm.name / vcenter.vm.id,
  # vcenter.datastore.name, vcenter.resource_pool.inventory_path, ...).
  vcenter:
    # Scheme + host only, e.g. https://vcsa.example.com — the receiver
    # appends /sdk itself. Works against vCenter Server (normal case) and
    # against a standalone ESXi host that is not managed by a vCenter.
    endpoint: "\${env:VCENTER_ENDPOINT}"
    # A vSphere user holding the built-in Read-Only role, propagated from
    # the vCenter root object to every child (see README.md).
    username: "\${env:VCENTER_USERNAME}"
    password: "\${env:VCENTER_PASSWORD}"
    # How often the whole inventory is walked. 2m is a sensible default;
    # raise it (5m, 10m) for vCenters with thousands of VMs — every
    # collection is a full vSphere SDK round-trip.
    collection_interval: "\${env:VCENTER_COLLECTION_INTERVAL}"
    initial_delay: 1s
    # Maximum performance-counter entities per query. 256 matches the
    # vpxd.stats.maxQueryMetrics default on vCenter; lowering it only helps
    # when the vCenter administrator has tightened that setting.
    max_query_metrics: 256
    tls:
      # vCenter appliances ship a self-signed (VMCA) certificate by
      # default. Set VCENTER_INSECURE_SKIP_VERIFY=true to accept it, or
      # keep verification on and trust the VMCA root on this machine.
      # The placeholder is deliberately UNQUOTED: a quoted "\${env:...}"
      # is a string and fails this boolean field at startup.
      insecure_skip_verify: \${env:VCENTER_INSECURE_SKIP_VERIFY}
    metrics:
      # Off by default upstream. OneUptime uses it as the denominator for
      # host memory utilisation (usage / capacity) on the Hosts page, so
      # it is enabled here. Do not disable it.
      vcenter.host.memory.capacity:
        enabled: true
      # Other optional metrics the receiver can emit, all off by default.
      # Enable any of them the same way if you want them in OneUptime:
      #   vcenter.vm.cpu.time                        (CPU time by cpu_state: idle/ready/wait)
      #   vcenter.vm.memory.granted                  (memory granted to the VM, MiBy)
      #   vcenter.host.memory.active                 (actively used host memory)
      #   vcenter.host.memory.ballooned              (memory reclaimed by ballooning on the host)
      #   vcenter.host.memory.granted                (memory granted to VMs on the host)
      #   vcenter.vm.network.broadcast.packet.rate   (broadcast packets/s per vNIC)
      #   vcenter.vm.network.multicast.packet.rate   (multicast packets/s per vNIC)

  # Optional: receive syslog forwarded by ESXi hosts (and vCenter) — this
  # is what powers the Logs tab of the vCenter dashboard. Off by default
  # because it needs a listening port published on this machine. To
  # enable it:
  #   1. Uncomment the \`syslog\` receiver below, the \`logs\` pipeline at the
  #      bottom of this file, and the port mapping in docker-compose.yml.
  #   2. On every ESXi host set Syslog.global.logHost (Host → Configure →
  #      System → Advanced System Settings) to udp://<agent-host>:5514 or
  #      tcp://<agent-host>:5514, and open the outbound syslog firewall
  #      rule on the host (Configure → System → Firewall → syslog).
  # ESXi speaks classic BSD syslog (RFC 3164). The resource processor
  # below stamps vmware.vcenter.name on these logs too, so they land on
  # this vCenter. A syslog receiver honours only one of \`tcp:\` / \`udp:\`
  # (tcp wins, udp is silently ignored), so TCP and UDP are two named
  # receivers — uncomment both to accept either transport.
  # syslog/tcp:
  #   tcp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164
  # syslog/udp:
  #   udp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164

processors:
  # Stamp every metric with the vCenter identity. OneUptime auto-registers
  # the vCenter from \`vmware.vcenter.name\`, and every VMware page and
  # monitor scopes on it — this attribute is what makes the data appear
  # under the VMware section of the dashboard. Keep it stable: changing
  # it later registers a brand-new vCenter. (It is deliberately NOT
  # \`vcenter.cluster.name\`: the receiver already stamps that per vSphere
  # compute cluster, and an upsert would overwrite the real cluster names.)
  resource:
    attributes:
      - key: vmware.vcenter.name
        value: "\${env:VMWARE_VCENTER_NAME}"
        action: upsert
      # Defensive: the native vcenter receiver does not synthesize
      # service.name / service.instance.id, but OTEL_RESOURCE_ATTRIBUTES
      # or a customised pipeline could add them. OneUptime routes batches
      # by service.name first, so if one slipped through it would register
      # a phantom Service instead of routing this data to the vCenter
      # discovered from \`vmware.vcenter.name\` (and break per-vCenter
      # retention settings). Do not remove these two deletes.
      - key: service.name
        action: delete
      - key: service.instance.id
        action: delete
  batch:
    timeout: 10s
    # Large enough to hold one complete scrape of a big inventory. There
    # is deliberately NO send_batch_max_size: a scrape must never be split
    # across exports, because OneUptime reads a whole scrape per request
    # to (a) sum inventory counts (host / VM / datastore counts fan out
    # over status and power_state) and (b) infer VM power state from the
    # presence of vcenter.vm.cpu.* datapoints next to the VM's memory and
    # disk datapoints. Splitting would zero counts and flip VMs "off".
    send_batch_size: 8192
  memory_limiter:
    check_interval: 5s
    # The receiver materialises the whole inventory on every collection;
    # 512 MiB leaves ample headroom for vCenters with thousands of VMs.
    limit_mib: 512
    spike_limit_mib: 128

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [vcenter]
      processors: [memory_limiter, resource, batch]
      exporters: [otlphttp]
    # Uncomment together with the syslog receivers above to ship ESXi
    # syslog (powers the Logs tab of the vCenter dashboard):
    # logs:
    #   receivers: [syslog/tcp, syslog/udp]
    #   processors: [memory_limiter, resource, batch]
    #   exporters: [otlphttp]
`;

export interface VMwareSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  // False while no key is picked and `apiKey` is the placeholder.
  hasApiKey: boolean;
  method: VMwareInstallMethod;
  /*
   * The vCenter the guide installs for (a vCenter's own Documentation tab).
   * Omitted on the product pages, where the guide suggests a name instead.
   */
  vcenterName?: string | undefined;
}

interface GuideContext {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  method: VMwareInstallMethod;
  vcenterName: string;
  isVCenterNameKnown: boolean;
}

/*
 * install.sh prompts only for the values its environment does not already
 * hold, so the command can carry the reader's URL and key. Only a real key
 * goes there: the script writes whatever it is given into .env, and a
 * placeholder would become the key the agent sends.
 */
export function getVMwareInstallScriptCommand(data: {
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
    `curl -sSL ${VMWARE_AGENT_RAW_URL}/install.sh -o install.sh`,
    [...environment, "bash install.sh"].join(" "),
  ].join("\n");
}

/**
 * The `.env` file of a Docker Compose install. The password is
 * single-quoted: Docker Compose expands `$` and cuts at ` #` in unquoted
 * values, and vSphere passwords routinely contain both.
 */
export function getVMwareEnvFile(data: {
  oneuptimeUrl: string;
  apiKey: string;
  vcenterName: string;
}): string {
  return `ONEUPTIME_URL=${data.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}
VMWARE_VCENTER_NAME=${shellQuote(data.vcenterName)}
VCENTER_ENDPOINT=https://vcsa.example.com
VCENTER_USERNAME=oneuptime@vsphere.local
VCENTER_PASSWORD='a-strong-password'
VCENTER_INSECURE_SKIP_VERIFY=true
VCENTER_COLLECTION_INTERVAL=2m`;
}

function isPrefilled(context: GuideContext): boolean {
  return (
    context.hasApiKey && context.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER
  );
}

/*
 * Commands that run in the agent's folder: install.sh installs into
 * /opt/oneuptime-vmware-agent by default, a Compose install lives wherever
 * the reader put it.
 */
function inAgentFolder(
  method: VMwareInstallMethod,
  commands: Array<string>,
): string {
  if (method === "install-script") {
    return [`cd ${VMWARE_AGENT_INSTALL_DIR}`, ...commands].join("\n");
  }
  return commands.join("\n");
}

function agentFolder(method: VMwareInstallMethod): string {
  return method === "install-script"
    ? `\`${VMWARE_AGENT_INSTALL_DIR}\``
    : "the folder with `docker-compose.yml`";
}

function getPrerequisites(): Array<string> {
  return [
    "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach vCenter over HTTPS (TCP 443) — ideally not a VM on the cluster it watches",
    "vCenter Server or ESXi **7.0 or later** (the collector's `vcenter` receiver supports vSphere 7 and 8)",
    "One agent per vCenter Server, or per standalone ESXi host that no vCenter manages",
  ];
}

function getReadOnlyUserStep(): SetupGuideStep {
  return {
    title: "Create a read-only vSphere user",
    description:
      "The agent only reads inventory, performance counters and vSAN statistics, so give it its own account with the built-in Read-Only role — never an administrator.",
    variants: [
      {
        label: "vSphere Client",
        markdown: `1. Create the account: *Menu → Administration → Single Sign On → Users and Groups*, pick the \`vsphere.local\` domain (or your identity source), **Add** a user such as \`oneuptime\` and set a password. This yields the principal \`oneuptime@vsphere.local\`.
2. Grant the role: select the top-level **vCenter Server** object in the *Hosts and Clusters* inventory, open the **Permissions** tab, click **Add**, choose the user, set the role to **Read-Only**, and tick **Propagate to children**.

Propagation is the part people miss. The receiver walks datacenters → clusters → hosts → VMs → datastores → resource pools, and every object the user cannot see is silently absent from the metrics — a Read-Only role granted on the vCenter object *without* propagation yields an inventory with nothing in it.`,
      },
      {
        label: "govc",
        markdown: `From a machine with administrator credentials:

${codeBlock(
  "bash",
  `govc sso.user.create -p 'a-strong-password' -R ReadOnly oneuptime
govc permissions.set -principal oneuptime@vsphere.local -role ReadOnly -propagate=true /`,
)}

This creates \`oneuptime@vsphere.local\` with the Read-Only role on the vCenter root, propagated to every object below it.`,
      },
      {
        label: "Standalone ESXi",
        markdown: `For an ESXi host that no vCenter manages, create the user under *Host → Manage → Security & Users → Users* in the ESXi Host Client, and assign it the Read-Only role under *Host → Manage → Security & Users → Permissions*.

In the next step, use the host itself as the endpoint (\`https://esxi01.example.com\`) with this local user. Everything the host knows is collected — the host, its VMs, datastores and resource pools; a standalone host has no datacenter or cluster object, so those pages stay empty.`,
      },
    ],
  };
}

function getInstallScriptStep(context: GuideContext): SetupGuideStep {
  const prefilled: boolean = isPrefilled(context);

  const namePrompt: string = context.isVCenterNameKnown
    ? `**vCenter name** — enter **\`${context.vcenterName}\`** exactly; a different name registers a new vCenter.`
    : "**vCenter name** — how the vCenter appears in OneUptime. Give every vCenter its own and keep it stable: a new name registers a new vCenter.";

  return {
    title: "Install the agent",
    description:
      "Download the install script and run it on the machine that will host the agent.",
    markdown: `${codeBlock(
      "bash",
      getVMwareInstallScriptCommand({
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

- ${namePrompt}
- **vCenter endpoint** — scheme and host, without \`/sdk\`, e.g. \`https://vcsa.example.com\`.
- **The read-only user and its password** — the password is read without echo.
- **TLS verification** — whether to skip it, since vCenter ships a self-signed certificate by default; and the **collection interval** (\`2m\`).
- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.

It installs to \`${VMWARE_AGENT_INSTALL_DIR}\`, writes a \`0600\` \`.env\` file and starts the agent with Docker Compose. Values are quoted for Docker Compose as they are written, so a password containing \`$\`, \`#\`, spaces or quotes works exactly as typed, and re-running the script reuses everything in an existing \`.env\` instead of prompting again.`,
  };
}

function getDockerComposeStep(context: GuideContext): SetupGuideStep {
  const nameNote: string = context.isVCenterNameKnown
    ? `This installs the agent for **\`${context.vcenterName}\`** — keep \`VMWARE_VCENTER_NAME\` exactly as it is, or the data registers as a new vCenter.`
    : `Replace \`${context.vcenterName}\` with a name for this vCenter, such as \`vcenter-prod\`. It is how the vCenter appears in OneUptime, so keep it stable: a new name registers a new vCenter.`;

  const notes: Array<string> = [
    nameNote,
    "Set `VCENTER_ENDPOINT` to the scheme and host of your vCenter, or of a standalone ESXi host, **without** `/sdk`.",
    "Keep the password in single quotes: Docker Compose expands `$` and treats a space followed by `#` as a comment in unquoted values.",
    "`VCENTER_INSECURE_SKIP_VERIFY=true` accepts vCenter's default self-signed (VMCA) certificate.",
  ];

  return {
    title: "Install the agent",
    description:
      "Download the agent's files, write its settings to a .env file and start it with Docker Compose.",
    markdown: `Download \`docker-compose.yml\` and \`otel-collector-config.yaml\` from the [VMwareAgent directory](${VMWARE_AGENT_SOURCE_URL}) into a new folder:

${codeBlock(
  "bash",
  `mkdir oneuptime-vmware-agent && cd oneuptime-vmware-agent
curl -fsSLO ${VMWARE_AGENT_RAW_URL}/docker-compose.yml
curl -fsSLO ${VMWARE_AGENT_RAW_URL}/otel-collector-config.yaml`,
)}

Create a \`.env\` file next to them:

${codeBlock(
  "bash",
  getVMwareEnvFile({
    oneuptimeUrl: context.oneuptimeUrl,
    apiKey: context.apiKey,
    vcenterName: context.vcenterName,
  }),
)}

${notes
  .map((note: string): string => {
    return `- ${note}`;
  })
  .join("\n")}

It holds a password, so make it private, then start the agent:

${codeBlock("bash", "chmod 600 .env\ndocker compose up -d")}${
      context.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER
        ? `

Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`
        : ""
    }`,
  };
}

function getVerifyStep(context: GuideContext): SetupGuideStep {
  return {
    title: "Verify the installation",
    description:
      "Check that the collector is running, then give it one collection interval.",
    markdown: `${codeBlock(
      "bash",
      inAgentFolder(context.method, [
        "docker compose ps",
        `docker compose logs -f ${VMWARE_AGENT_CONTAINER}`,
      ]),
    )}

Look for \`Everything is ready. Begin running and processing data.\` in the logs — then give it one collection interval (2 minutes by default): nothing is sent until the first full inventory walk completes. The vCenter then appears automatically in the **VMware** section, with its datacenters, clusters, ESXi hosts, virtual machines, datastores and resource pools inventoried.

\`docker compose ps\` also lists **\`${VMWARE_AI_AGENT_CONTAINER}\`**, the OneUptime AI agent — see **OneUptime AI agent** under Advanced.

**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this vCenter with read-only \`govc\` commands, and changes nothing unless you allow fixes.`,
  };
}

function getEnvironmentVariablesTopic(context: GuideContext): SetupGuideTopic {
  const where: string =
    context.method === "install-script"
      ? `The install script writes these to \`${VMWARE_AGENT_INSTALL_DIR}/.env\`.`
      : "The agent reads these from the `.env` file next to `docker-compose.yml`.";

  const quoting: string =
    context.method === "install-script"
      ? "(the install script does this for you)"
      : "— see **vCenter rejects the login** under Troubleshooting";

  return {
    title: "Environment variables",
    summary: "Every setting the collector reads from its .env file.",
    markdown: `${where} After changing one, apply it with \`docker compose up -d\` in ${agentFolder(context.method)}.

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${context.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key — the one picked in step 1 |
| \`VMWARE_VCENTER_NAME\` | Yes | The name this vCenter registers under in OneUptime. Stamped on every metric as the \`vmware.vcenter.name\` resource attribute. Keep it stable — changing it registers a new vCenter (default: \`vmware-vcenter\`) |
| \`VCENTER_ENDPOINT\` | Yes | Scheme + host of vCenter Server or a standalone ESXi host, **without** \`/sdk\`, e.g. \`https://vcsa.example.com\` |
| \`VCENTER_USERNAME\` | Yes | vSphere user with the Read-Only role, e.g. \`oneuptime@vsphere.local\` (or \`DOMAIN\\user\` for an Active Directory identity source) |
| \`VCENTER_PASSWORD\` | Yes | That user's password. If it contains \`$\`, \`#\`, spaces or quotes, single-quote it in \`.env\` ${quoting} |
| \`VCENTER_INSECURE_SKIP_VERIFY\` | No | \`true\` to accept vCenter's default self-signed (VMCA) certificate; \`false\` keeps TLS verification on (default: \`false\`) |
| \`VCENTER_COLLECTION_INTERVAL\` | No | How often the whole inventory is polled. Raise to \`5m\` or \`10m\` for very large vCenters (default: \`2m\`) |

The OneUptime AI agent's own settings are under **OneUptime AI agent**.`,
  };
}

function getConfigurationFilesTopic(): SetupGuideTopic {
  return {
    title: "The agent's configuration files",
    summary:
      "The exact docker-compose.yml and otel-collector-config.yaml the agent runs.",
    markdown: `This is the \`docker-compose.yml\` the agent runs (the \`.env\` file supplies the values). The collector image is pinned; when a newer OneUptime release bumps the pin, download both files again before pulling:

${codeBlock("yaml", VMWARE_AGENT_COMPOSE_FILE)}

And the full \`otel-collector-config.yaml\`. The \`resource\` processor stamps the \`vmware.vcenter.name\` attribute that registers the vCenter in OneUptime and that every VMware page, monitor and alert template scopes on — keep it in place if you customize the config. The \`batch\` processor deliberately has no \`send_batch_max_size\`: OneUptime reads a whole collection per request to sum inventory counts and infer VM power state, so a collection must never be split across exports:

${codeBlock("yaml", VMWARE_AGENT_COLLECTOR_CONFIG)}`,
  };
}

function getCollectedDataTopic(): SetupGuideTopic {
  return {
    title: "What the agent collects",
    summary:
      "Datacenters, clusters, ESXi hosts, VMs, templates, datastores, resource pools and vSAN.",
    markdown: `Every \`VCENTER_COLLECTION_INTERVAL\` the receiver walks the full vSphere inventory and emits one OpenTelemetry resource per object. Identity lives in **resource attributes** — \`vcenter.datacenter.name\`, \`vcenter.cluster.name\`, \`vcenter.host.name\`, \`vcenter.vm.name\` / \`vcenter.vm.id\`, \`vcenter.datastore.name\`, \`vcenter.resource_pool.name\` / \`vcenter.resource_pool.inventory_path\` — and the agent adds \`vmware.vcenter.name\` on top so OneUptime can route everything to your vCenter.

| vSphere object | Identity (resource attributes) | Metrics |
|---|---|---|
| **Datacenter** | \`vcenter.datacenter.name\` | \`vcenter.datacenter.cluster.count{status}\`, \`.host.count{status,power_state}\`, \`.vm.count{status,power_state}\`, \`.datastore.count\`, \`.disk.space{disk_state}\`, \`.cpu.limit\`, \`.memory.limit\` |
| **Cluster** | + \`vcenter.cluster.name\` | \`vcenter.cluster.cpu.effective\`, \`.cpu.limit\`, \`.memory.effective\`, \`.memory.limit\`, \`.host.count{effective}\`, \`.vm.count{power_state}\`, \`.vm_template.count\`, \`vcenter.cluster.vsan.*\` |
| **ESXi host** | + \`vcenter.host.name\` (and \`vcenter.cluster.name\` when clustered) | \`vcenter.host.cpu.usage\` / \`.capacity\` / \`.utilization\` / \`.reserved\`, \`.memory.usage\` / \`.utilization\` / \`.capacity\`, \`.disk.latency.avg\` / \`.latency.max\` / \`.throughput\`, \`.network.usage\` / \`.throughput\` / \`.packet.rate\` / \`.packet.drop.rate\` / \`.packet.error.rate\`, \`vcenter.host.vsan.*\` |
| **Virtual machine** | + \`vcenter.host.name\`, \`vcenter.vm.name\`, \`vcenter.vm.id\` (instance UUID); \`vcenter.resource_pool.*\` or \`vcenter.virtual_app.*\` | \`vcenter.vm.disk.usage{disk_state}\`, \`.disk.utilization\`, \`.memory.usage\` / \`.utilization\` / \`.ballooned\` / \`.swapped\` / \`.swapped_ssd\`; **powered-on VMs only:** \`.cpu.usage\`, \`.cpu.readiness\`, \`.cpu.utilization\`, \`.disk.latency.*\` / \`.throughput\`, \`.network.*\`, \`vcenter.vm.vsan.*\` |
| **VM template** | \`vcenter.vm_template.name\`, \`vcenter.vm_template.id\` | \`vcenter.vm.disk.usage{disk_state}\` only |
| **Datastore** | + \`vcenter.datastore.name\` | \`vcenter.datastore.disk.usage{disk_state}\`, \`.disk.utilization\` |
| **Resource pool** | + \`vcenter.resource_pool.name\`, \`vcenter.resource_pool.inventory_path\` | \`vcenter.resource_pool.cpu.usage\` / \`.cpu.shares\`, \`.memory.usage{type}\` / \`.memory.shares\` / \`.memory.ballooned\` / \`.memory.swapped\` / \`.memory.granted{type}\` |

Datapoint attributes (\`{...}\` above) are what you filter and group by in monitor criteria: \`direction\` (\`read\`/\`write\`, \`transmitted\`/\`received\`), \`disk_state\` (\`available\`/\`used\`), \`status\` (\`red\`/\`yellow\`/\`green\`/\`gray\`), \`effective\` (\`true\`/\`false\`), \`power_state\` (\`on\`/\`off\`/\`standby\`/\`suspended\`/\`unknown\`), \`object\` (the NIC or disk instance), \`cpu_reservation_type\` (\`total\`/\`used\`) and \`type\`. In OneUptime, resource attributes are \`resource.\`-prefixed (\`resource.vcenter.host.name\`) and datapoint attributes are bare (\`disk_state\`). Units are the receiver's own: MHz for CPU usage and capacity, \`%\` for utilization and CPU readiness, MiB for host/VM/resource-pool memory, bytes for cluster and datacenter memory and all disk space, \`ms\` for disk latency and \`µs\` for vSAN latency.`,
  };
}

function getPowerStateTopic(): SetupGuideTopic {
  return {
    title: "How VM power state is worked out",
    summary:
      "Inferred from which metrics each VM reported, which is why the batch settings must stay as shipped.",
    markdown:
      "The receiver does not export a per-VM power-state metric. Instead it emits `vcenter.vm.cpu.*` **only for powered-on VMs**, so OneUptime infers the state from what arrived in each collection: a VM that reported CPU metrics is *powered on*; one that reported only memory and disk usage is *powered off* (or suspended — vSphere does not tell them apart here). This inference reads a whole collection at a time, which is why the shipped `batch` processor has a large `send_batch_size` and deliberately no `send_batch_max_size`: a collection split across two exports would zero inventory counts and flip VMs to off. Keep the batch settings as shipped.",
  };
}

function getSyslogTopic(context: GuideContext): SetupGuideTopic {
  return {
    title: "Ship ESXi syslog",
    summary:
      "Receive syslog from your ESXi hosts on port 5514 to fill the vCenter's Logs tab.",
    markdown: `By default the agent ships **metrics only** — the Logs tab of the vCenter dashboard stays empty until you enable a log receiver. The shipped config contains a commented-out \`syslog\` receiver pair (TCP and UDP on port 5514, RFC 3164 — ESXi's native format) wired to a commented \`logs\` pipeline that stamps \`vmware.vcenter.name\` so the logs land on this vCenter.

1. **Uncomment the two \`syslog/*\` receivers and the \`logs\` pipeline** in \`otel-collector-config.yaml\`.
2. **Uncomment the \`ports:\` block** in \`docker-compose.yml\`, then apply it — and open the port on the machine's firewall for the ESXi management network:

${codeBlock("bash", inAgentFolder(context.method, ["docker compose up -d"]))}

3. **Point every ESXi host at the agent.** Select the host, open *Configure → System → Advanced System Settings*, set \`Syslog.global.logHost\` to \`udp://<agent-host>:5514\` (or \`tcp://\`), then allow the outbound traffic under *Configure → System → Firewall → Edit → syslog*. Or per host with \`esxcli\`:

${codeBlock(
  "bash",
  `esxcli system syslog config set --loghost='udp://<agent-host>:5514'
esxcli system syslog reload
esxcli network firewall ruleset set --ruleset-id=syslog --enabled=true`,
)}`,
  };
}

function getLabelsTopic(context: GuideContext): SetupGuideTopic {
  return {
    title: "Tag the vCenter with project labels",
    summary:
      "Attach labels such as team or environment to the vCenter from the collector config.",
    markdown: `Any resource attribute prefixed with \`oneuptime.label.\` is promoted to a project label and attached to the vCenter. Add the attributes to the \`resource\` processor in \`otel-collector-config.yaml\`, next to \`vmware.vcenter.name\`:

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
    `docker compose restart ${VMWARE_AGENT_CONTAINER}`,
  ]),
)}

The vCenter shows up tagged \`team:platform\` and \`env:production\`. Labels added manually in the OneUptime UI are never removed by the agent.`,
  };
}

function getAiAgentTopic(context: GuideContext): SetupGuideTopic {
  const fixesHow: string =
    context.method === "install-script"
      ? "The install script asks about fixes on a fresh install and writes these settings for you."
      : "Set them in `.env` and run `docker compose up -d`.";

  return {
    title: "OneUptime AI agent",
    summary:
      "The container that lets OneUptime AI run read-only govc commands while it investigates an incident.",
    markdown: `\`docker-compose.yml\` also runs **\`${VMWARE_AI_AGENT_CONTAINER}\`**. While OneUptime AI investigates an incident or alert on this vCenter, it runs \`govc\` commands through it — a VM's power state, the host it runs on, recent events and tasks, performance counters. It logs in with the vCenter credentials from the same \`.env\` (OneUptime never sends it any), registers as the vCenter named \`VMWARE_VCENTER_NAME\`, and appears on the vCenter's **AI → AI agent** page.

- **The vSphere role is the hard limit.** With the collector's Read-Only user it can read and nothing else.
- It is **read-only** unless you set \`ONEUPTIME_AI_ALLOW_WRITES=true\`. Fixes — powering a VM back on, a guest reboot — also need a vSphere user of its own whose role allows them, set as \`ONEUPTIME_AI_VCENTER_USERNAME\` / \`ONEUPTIME_AI_VCENTER_PASSWORD\`; the agent's README has the \`govc\` commands for that role. ${fixesHow}
- It never changes the VM named after the host in \`VCENTER_ENDPOINT\` — normally the vCenter appliance. When the endpoint is an IP address, or the appliance's VM has another name, put that VM's name in \`ONEUPTIME_AI_PROTECTED_TARGETS\`, together with the VM the agent runs on.
- Check it: \`docker exec ${VMWARE_AI_AGENT_CONTAINER} wget -qO- http://127.0.0.1:3877/status\`
- Not using OneUptime AI? Delete the \`${VMWARE_AI_AGENT_CONTAINER}\` service from \`docker-compose.yml\`.

What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#vmware-vcenter).`,
  };
}

function getUpgradeTopic(context: GuideContext): SetupGuideTopic {
  const pinNote: string =
    context.method === "install-script"
      ? "The collector image is pinned in `docker-compose.yml`. When a newer OneUptime release bumps the pin, re-run the install script: it reuses every value in your existing `.env` (nothing is prompted for again), refreshes `docker-compose.yml` and `otel-collector-config.yaml`, and starts the agent again."
      : "The collector image is pinned in `docker-compose.yml`. When a newer OneUptime release bumps the pin, download `docker-compose.yml` and `otel-collector-config.yaml` again (the commands in step 3) before pulling.";

  const where: string =
    context.method === "install-script"
      ? ""
      : "Run these in the agent's folder, the one with `docker-compose.yml`.\n\n";

  return {
    title: "Upgrade or uninstall the agent",
    summary: "Pull the latest images, or stop and remove the agent.",
    markdown: `${where}**Upgrade:**

${codeBlock(
  "bash",
  inAgentFolder(context.method, [
    "docker compose pull",
    "docker compose up -d",
  ]),
)}

${pinNote}

**Uninstall:**

${codeBlock("bash", inAgentFolder(context.method, ["docker compose down"]))}

Then remove the \`oneuptime\` user's permission in vCenter (and the OneUptime AI fixes user's, if you created one) if you no longer need it.`,
  };
}

function getAdvancedTopics(context: GuideContext): Array<SetupGuideTopic> {
  return [
    getEnvironmentVariablesTopic(context),
    getConfigurationFilesTopic(),
    getCollectedDataTopic(),
    getPowerStateTopic(),
    getSyslogTopic(context),
    getLabelsTopic(context),
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

  const inFolder: string =
    context.method === "install-script"
      ? ` (in \`${VMWARE_AGENT_INSTALL_DIR}\`)`
      : " (in the agent's folder)";

  const quotingOrigin: string =
    context.method === "install-script"
      ? ", which is what the install script writes"
      : "";

  const knownName: string = context.isVCenterNameKnown
    ? ` This vCenter is **\`${context.vcenterName}\`**.`
    : "";

  return [
    {
      title: "Run the diagnostic script first",
      markdown: `\`troubleshoot.sh\` checks the whole chain — container runtime, vCenter reachability and credentials, vCenter-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with \`401\` or \`422\`, which the collector logs as a single \`Exporting failed\` line per batch that is easy to miss, so the script asks \`GET /otlp/v1/validate\` for a direct 200/401 verdict.

${codeBlock(
  "bash",
  `curl -sSL ${VMWARE_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh
${runScript}`,
)}

It ends with a verdict naming the most likely cause.`,
    },
    {
      title: 'vCenter shows as "Disconnected"',
      markdown: `1. Check that the agent is running${inFolder}: \`docker compose ps\`
2. Check the agent logs for errors: \`docker compose logs ${VMWARE_AGENT_CONTAINER} | grep -i error\`
3. Verify your OneUptime URL and ingestion key are correct.
4. Ensure the agent machine can reach the OneUptime instance over the network.`,
    },
    {
      title: "No vCenter appears, or no metrics",
      markdown: `1. Check the collector logs: a login error (\`incorrect user name or password\`, \`InvalidLogin\`) means bad credentials — or a password containing \`$\`, \`#\`, spaces or quotes that is not single-quoted in \`.env\` (Docker Compose expands \`$VAR\` and treats a space followed by \`#\` as a comment otherwise), \`x509: certificate signed by unknown authority\` means TLS verification is on against a self-signed certificate (set \`VCENTER_INSECURE_SKIP_VERIFY=true\`), \`connection refused\` / \`no such host\` means a wrong \`VCENTER_ENDPOINT\`.
2. Verify the endpoint is reachable from the agent's network (the collector image is distroless, so test from alongside it) — you should see an XML document advertising \`urn:vim25\`:

${codeBlock(
  "bash",
  `docker run --rm --network container:${VMWARE_AGENT_CONTAINER} curlimages/curl -sk https://<vcenter-host>/sdk/vimServiceVersions.xml`,
)}

3. Make sure \`VMWARE_VCENTER_NAME\` is set — discovery keys on the \`vmware.vcenter.name\` resource attribute.
4. Give it one collection interval: nothing is sent until the first full inventory walk completes.`,
    },
    {
      title: "vCenter rejects the login",
      markdown: `Use the full principal — \`oneuptime@vsphere.local\`, or \`DOMAIN\\user\` / \`user@domain.example\` for an Active Directory identity source — and check how the password is written in \`.env\`. Docker Compose expands \`$VAR\` references in unquoted and double-quoted values and treats a space followed by \`#\` as the start of a comment, so a password containing \`$\`, \`#\`, spaces or quotes must be **single-quoted** — \`VCENTER_PASSWORD='p@ss$word'\`${quotingOrigin}. A password that itself contains a single quote goes in double quotes, with every \`$\` written as \`$$\` and \`"\` / \`\\\` escaped with a backslash. A locked account (too many failed attempts) rejects a correct password too; check *Administration → Single Sign On → Users and Groups*.`,
    },
    {
      title: "x509 or other TLS errors",
      markdown:
        "vCenter appliances present a certificate issued by their own VMCA, which no Docker image trusts. Either set `VCENTER_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network) or replace vCenter's machine certificate with one issued by a CA the collector image trusts. Do **not** point the endpoint at an `http://` URL — vCenter only serves the SDK over HTTPS.",
    },
    {
      title: "Hosts appear but no VMs, datastores or clusters",
      markdown:
        "The Read-Only role was granted on the vCenter object without **Propagate to children**, or on a narrower object than the vCenter root. Objects the user cannot see are silently absent. Fix the permission on the top-level vCenter object with propagation enabled; the next collection fills in the inventory.",
    },
    {
      title: "Every VM shows as powered off",
      markdown:
        "VM power state is inferred from the `vcenter.vm.cpu.*` datapoints arriving in the same collection as the VM's memory and disk datapoints (see **How VM power state is worked out** under Advanced). If you customized the `batch` processor and added a `send_batch_max_size`, a large inventory is split across exports and the CPU datapoints land in a different request — restore the shipped batch settings.",
    },
    {
      title: "Collections are slow on a large inventory",
      markdown:
        "Each collection is a full walk of the inventory plus one performance query per object batch. For vCenters with thousands of VMs raise `VCENTER_COLLECTION_INTERVAL` to `5m` or `10m` (a collection that takes longer than the interval is skipped, not overlapped), match `max_query_metrics` to your vCenter's `vpxd.stats.maxQueryMetrics` if the log reports `The maximum number of performance metrics per query exceeded`, and raise `limit_mib` if the memory limiter reports dropped data.",
    },
    {
      title: "vCenter appears under the wrong name",
      markdown: `The vCenter identity comes from \`VMWARE_VCENTER_NAME\`, stamped on every metric as \`vmware.vcenter.name\`.${knownName} Fix it in \`.env\` and apply it with \`docker compose up -d\` in ${agentFolder(context.method)} — note that a new name registers a new vCenter.`,
    },
  ];
}

/**
 * The VMware agent install guide for one install method, filled in with
 * the reader's OneUptime URL and ingestion key.
 */
export function getVMwareSetupGuide(
  options: VMwareSetupGuideOptions,
): SetupGuideContent {
  const knownVCenterName: string = (options.vcenterName || "").trim();

  const context: GuideContext = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    hasApiKey: options.hasApiKey,
    method: options.method,
    vcenterName: knownVCenterName || VMWARE_EXAMPLE_VCENTER_NAME,
    isVCenterNameKnown: Boolean(knownVCenterName),
  };

  return {
    prerequisites: getPrerequisites(),
    steps: [
      getReadOnlyUserStep(),
      context.method === "install-script"
        ? getInstallScriptStep(context)
        : getDockerComposeStep(context),
      getVerifyStep(context),
    ],
    advanced: getAdvancedTopics(context),
    troubleshooting: getTroubleshootingTopics(context),
    links: [
      {
        title: "VMware agent documentation",
        url: "/docs/telemetry/vmware",
      },
      {
        title: "VMware monitors and alerts",
        url: "/docs/monitor/vmware-monitor",
      },
    ],
  };
}
