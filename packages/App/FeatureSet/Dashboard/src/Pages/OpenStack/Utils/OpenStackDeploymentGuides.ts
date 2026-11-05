import {
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  codeBlock,
} from "../../../Components/SetupGuide/SetupGuide";
import { getAgentFileDownloadCommand } from "../../../Components/SetupGuide/AgentInstallCommands";
import { InstallScriptName } from "Common/Types/InstallScripts/InstallScripts";

/*
 * NOBODY RUNS "OPENSTACK". THEY RUN A TOOL THAT DEPLOYS IT.
 *
 * Each tool differs in where a policy file goes, where logs live and what monitoring is
 * already running, so a guide that fits them all would be wrong for most of its readers.
 * The setup guide asks one question, and each answer gives that tool's paths and commands.
 * "Not sure" gives the general steps.
 *
 * Every path, port and variable here was read from the tool's own source, and the comment
 * above each guide says where. The rule for what a guide may claim:
 *
 *   howFarTested is said on screen, in plain words, for every tool. The epic asks for
 *   each guide to be followed end to end on a real deployment. None of these has been: the
 *   rig runs DevStack, with these exporters and Alertmanager beside it at the versions
 *   Kolla-Ansible pins. Say what each was checked against, and never more.
 *
 * Pure and React-free, as DocumentationMarkdown.ts is, so a test can read every word.
 * OpenStackDeploymentGuides.test.ts holds each one to the agent's files.
 */

export type OpenStackDeploymentTool =
  | "kolla-ansible"
  | "openstack-ansible"
  | "openstack-helm"
  | "atmosphere"
  | "sunbeam"
  | "rhoso"
  | "mosk"
  | "not-sure";

/*
 * In the order people run them, as far as anyone can tell: the newest survey we could read
 * (2021) had Ansible-based tools at 47% and Kolla at 28%. A guide opens on "not sure",
 * whichever is first here: see DEFAULT_OPENSTACK_DEPLOYMENT_TOOL.
 */
export const OPENSTACK_DEPLOYMENT_TOOLS: Array<
  SetupGuideOption<OpenStackDeploymentTool>
> = [
  {
    key: "kolla-ansible",
    label: "Kolla-Ansible",
    description:
      "Containers on your hosts, with Prometheus and an exporter for everything under the cloud already running.",
  },
  {
    key: "openstack-ansible",
    label: "OpenStack-Ansible",
    description:
      "Services in LXC containers or on metal, with their logs in journald.",
  },
  {
    key: "openstack-helm",
    label: "OpenStack-Helm",
    description: "Helm charts on Kubernetes.",
  },
  {
    key: "atmosphere",
    label: "Atmosphere",
    description:
      "VEXXHOST's Helm deployment, with kube-prometheus-stack, Loki and Vector.",
  },
  {
    key: "sunbeam",
    label: "Canonical Sunbeam",
    description: "Canonical OpenStack, with the Canonical Observability Stack.",
  },
  {
    key: "rhoso",
    label: "Red Hat OpenStack on OpenShift",
    description:
      "Red Hat OpenStack Services on OpenShift, with its Telemetry Operator.",
  },
  {
    key: "mosk",
    label: "Mirantis MOSK",
    description: "Mirantis OpenStack for Kubernetes, with StackLight.",
  },
  {
    key: "not-sure",
    label: "Not sure, or something else",
    description: "The general steps, which work on any cloud.",
  },
];

export const DEFAULT_OPENSTACK_DEPLOYMENT_TOOL: OpenStackDeploymentTool =
  "not-sure";

export function resolveOpenStackDeploymentTool(
  tool: string | null | undefined,
): OpenStackDeploymentTool {
  const known: SetupGuideOption<OpenStackDeploymentTool> | undefined =
    OPENSTACK_DEPLOYMENT_TOOLS.find(
      (option: SetupGuideOption<OpenStackDeploymentTool>): boolean => {
        return option.key === tool;
      },
    );
  return known ? known.key : DEFAULT_OPENSTACK_DEPLOYMENT_TOOL;
}

/*
 * Whether the agent is how this tool's cloud gets read. On the ones that run the control
 * plane in Kubernetes a probe reads the APIs and the Kubernetes agent sees the pods, so
 * there is no third thing to deploy, and the guide does not ask how to install it.
 */
export function doesOpenStackToolUseAgent(
  tool: OpenStackDeploymentTool,
): boolean {
  return !["openstack-helm", "atmosphere", "rhoso", "mosk"].includes(tool);
}

/*
 * The ports Kolla-Ansible serves each exporter on (ansible/group_vars/all/prometheus.yml,
 * and rabbitmq_prometheus_port in rabbitmq.yml), by the job name its prometheus.yml.j2
 * writes, and the variable the agent reads them from. Its helper script reads the same
 * table: Tests/Ops/OpenStackAgentControlPlane.test.js holds the two together.
 */
export interface OpenStackKollaExporter {
  job: string;
  port: number;
  variable: string;
  what: string;
}

export const OPENSTACK_KOLLA_EXPORTERS: ReadonlyArray<OpenStackKollaExporter> =
  [
    {
      job: "rabbitmq",
      port: 15692,
      variable: "OPENSTACK_RABBITMQ_TARGETS",
      what: "RabbitMQ's Prometheus plugin",
    },
    {
      job: "mysqld",
      port: 9104,
      variable: "OPENSTACK_MARIADB_TARGETS",
      what: "mysqld_exporter",
    },
    {
      job: "memcached",
      port: 9150,
      variable: "OPENSTACK_MEMCACHED_TARGETS",
      what: "memcached_exporter",
    },
    {
      job: "haproxy",
      port: 9101,
      variable: "OPENSTACK_HAPROXY_TARGETS",
      what: "HAProxy's own exporter",
    },
    {
      job: "network_exporter",
      port: 1981,
      variable: "OPENSTACK_NETWORK_EXPORTER_TARGETS",
      what: "openstack-network-exporter, for OVN and Open vSwitch",
    },
    {
      job: "libvirt_exporter",
      port: 9177,
      variable: "OPENSTACK_LIBVIRT_HEALTH_TARGETS",
      what: "prometheus-libvirt-exporter",
    },
  ];

// Kolla-Ansible's openstack-exporter, behind its internal VIP.
export const OPENSTACK_KOLLA_EXPORTER_PORT: number = 9198;

export const OPENSTACK_CONTROL_PLANE_TARGETS_SCRIPT: string =
  "control-plane-targets.py";
export const OPENSTACK_LOGS_INSTALLER: string = "install-logs.sh";

/*
 * What the pages go without on exporter 1.7.0, read by running the scan over what that
 * exporter answered on five real clouds. OpenStackExporterStablePages.test.ts fails when
 * a recording says otherwise, so this is never written from memory. Why each one: 1.7.0
 * asks the catalog for `volumev3` where Cinder registers as `block-storage`, and asks
 * Nova for its hypervisors in a shape the newest microversion no longer has.
 */
export const OPENSTACK_EXPORTER_170_LOSSES: string = `| Goes without | Because | What it costs |
| --- | --- | --- |
| Everything of Cinder's | It asks the catalog for \`volumev3\`, and finds no such thing where Cinder registers as \`block-storage\` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, \`cinder-volume\` or \`cinder-scheduler\`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |
| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |
| Domains | It has no such series | **Domains** stays empty |
| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to \`active\` goes unnoticed |
| A network's MTU | It has no such label | That line on a network's page |`;

function downloadTargetsScript(oneuptimeUrl: string): string {
  return getAgentFileDownloadCommand(
    oneuptimeUrl,
    InstallScriptName.OpenStackAgent,
    OPENSTACK_CONTROL_PLANE_TARGETS_SCRIPT,
  );
}

function alertmanagerReceiver(oneuptimeUrl: string, indent: string): string {
  return [
    `${indent}- name: oneuptime`,
    `${indent}  webhook_configs:`,
    `${indent}    - url: "${oneuptimeUrl}/heartbeat/<secret key>"`,
    `${indent}      send_resolved: true`,
  ].join("\n");
}

/*
 * What Prometheus Alertmanager needs from OneUptime on every tool that has one. The
 * Linked Resources line is what puts the incidents on the cloud's page: an Incoming
 * Request monitor's own settings name no cloud.
 */
function alertmanagerMonitorSteps(cloudName: string): string {
  return `An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.

1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the \`<secret key>\` address below.
2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud \`${cloudName}\`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.`;
}

export interface OpenStackDeploymentGuide {
  // One or two sentences above the steps: what this tool already runs.
  alreadyRuns: string;
  // Said on screen. Nothing here may claim more than was checked.
  howFarTested: string;
  // Steps before the credential: what needs nothing installed.
  firstSteps: Array<SetupGuideStep>;
  // Said under the credential step, on tools where it differs from the general steps.
  credentialNotes: Array<string>;
  // A way of reading the APIs that needs no credential at all, beside the three levels.
  credentialVariants: Array<SetupGuideStepVariant>;
  // Steps after the agent is installed.
  lastSteps: Array<SetupGuideStep>;
  topics: Array<SetupGuideTopic>;
}

export interface OpenStackDeploymentGuideContext {
  oneuptimeUrl: string;
  apiKey: string;
  cloudName: string;
}

const TESTED_BY_RIG: string =
  "It has not been followed end to end on a real deployment of this tool.";

/*
 * WHO DID WHAT: Keystone's audit trail, and keystonemiddleware's audit filter on each API, each
 * written to the service's own log, with no consumer on the bus, and read from there as a
 * source of Security Events (OpenStackAuditLogParser).
 *
 * notification_opt_out is named because Keystone's documentation and its code disagree. What
 * the settings do was recorded on real DevStacks, on every release the rig runs. Where each
 * tool takes them was read from that tool's source, and the comment above each tool's guide
 * says where. None has been followed on a real deployment of its tool.
 */
const WHO_DID_WHAT_SUMMARY: string =
  "Keystone's audit trail and the audit filter on each API, into Security Events.";

const WHAT_THE_AUDIT_TRAIL_NEEDS: string =
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.";

const ADMIN_NEEDS_SIGN_INS: string =
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.";

const AUDIT_FILTER_CONF: string = `[audit_middleware_notifications]
driver = log`;

const KEYSTONE_AUDIT_CONF: string = `[DEFAULT]
notification_format = cadf
notification_opt_out = identity.authenticate.pending

[oslo_messaging_notifications]
driver = log`;

const KEYSTONE_AUDIT_VALUES: string = `conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log`;

/*
 * A chart's logging.conf has only the service's own logger at INFO and the root at WARNING, and
 * oslo.messaging's log driver writes under a logger of its own, so a chart's notifications go
 * nowhere without this.
 */
const NOTIFICATIONS_LOGGER_VALUES: string = `conf:
  logging:
    loggers:
      keys:
        - root
        - keystone
        - notifications
    logger_notifications:
      level: INFO
      handlers:
        - stdout
      qualname: oslo.messaging.notification
      propagate: 0`;

function getGeneralWhoDidWhatTopic(): SetupGuideTopic {
  return {
    title: "Who did what",
    summary: WHO_DID_WHAT_SUMMARY,
    markdown: `Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. ${WHAT_THE_AUDIT_TRAIL_NEEDS}

${codeBlock("ini", `# keystone.conf\n${KEYSTONE_AUDIT_CONF}`)}

${ADMIN_NEEDS_SIGN_INS}

The audit filter goes in each API's paste file, right after \`authtoken\` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in \`etc/pycadf\` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's \`extensions\` filter answers its routers and security groups, and the filter would never see them.

${codeBlock(
  "ini",
  `# api-paste.ini
[filter:audit]
paste.filter_factory = keystonemiddleware.audit:filter_factory
audit_map_file = /path/to/venv/etc/pycadf/nova_api_audit_map.conf`,
)}

${codeBlock("ini", `# nova.conf\n${AUDIT_FILTER_CONF}`)}

[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.`,
  };
}

function withoutTool(): OpenStackDeploymentGuide {
  return {
    alreadyRuns: "",
    howFarTested: "",
    firstSteps: [],
    credentialNotes: [],
    credentialVariants: [],
    lastSteps: [],
    topics: [getGeneralWhoDidWhatTopic()],
  };
}

/*
 * Kolla-Ansible. Read from openstack/kolla-ansible at master and stable/2026.1:
 *   ansible/group_vars/all/prometheus.yml             the exporters and their ports
 *   ansible/group_vars/all/common.yml                 node_custom_config, /etc/kolla/config
 *   ansible/roles/prometheus/tasks/config.yml         where each override is looked for
 *   ansible/roles/prometheus/templates/prometheus-openstack-exporter.json.j2
 *                                                     single-cloud mode, no --multi-cloud
 *   ansible/roles/{nova,neutron,cinder,glance,placement}/templates/*.conf.j2
 *                                                     service_type is already set
 *   ansible/inventory/multinode                       which hosts run the network exporter
 *   doc/source/reference/logging-and-monitoring/      Prometheus and Fluentd overrides
 *   ansible/roles/keystone/tasks/config.yml           keystone.conf and keystone-paste.ini overrides
 *   ansible/roles/{nova,neutron,cinder,glance}/tasks/config.yml
 *                                                     no paste file is copied for these
 *   ansible/roles/{nova,neutron,cinder,glance}/defaults/main.yml
 *                                                     their *_extra_volumes
 * and kolla/common/sources.yaml in openstack/kolla: exporter 1.7.0.
 */
function kollaAnsible(
  context: OpenStackDeploymentGuideContext,
): OpenStackDeploymentGuide {
  return {
    alreadyRuns:
      "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.",
    howFarTested: `Its paths and ports were read from Kolla-Ansible's own source. Its exporters, at the versions Kolla-Ansible pins, were recorded on a test cloud, failing and recovering, with Alertmanager posting to OneUptime. ${TESTED_BY_RIG}`,
    firstSteps: [
      {
        title: "Forward what is already firing",
        description:
          "Optional, and only if you wrote your own rules: Kolla-Ansible ships none, so nothing fires until /etc/kolla/config/prometheus/*.rules holds some.",
        markdown: `${alertmanagerMonitorSteps(context.cloudName)}

Then, on the host you deploy from, write \`/etc/kolla/config/prometheus/prometheus-alertmanager.yml\`, which Kolla-Ansible reads in place of its own, and apply it:

${codeBlock(
  "yaml",
  `global:
  resolve_timeout: 5m
route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 10s
  group_interval: 5m
  repeat_interval: 3h
receivers:
${alertmanagerReceiver(context.oneuptimeUrl, "  ")}
templates:
  - '/etc/prometheus/*.tmpl'`,
)}

${codeBlock("bash", "kolla-ansible reconfigure -i <inventory> --tags prometheus")}`,
      },
    ],
    credentialNotes: [
      "Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.",
      "**Full view** needs no change to any service: Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Cinder, Glance and Placement. Its Cinder says `volume`, which the access rules also carry.",
      "**Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.",
    ],
    credentialVariants: [
      {
        label: "Kolla's exporter",
        markdown: `No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on \`${OPENSTACK_KOLLA_EXPORTER_PORT}\`. Skip the install's credential questions by giving it the address:

${codeBlock(
  "bash",
  `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:${OPENSTACK_KOLLA_EXPORTER_PORT} \\
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \\
bash install.sh`,
)}

Kolla-Ansible pins exporter 1.7.0 and runs it without \`--multi-cloud\`, so it has no \`/probe\`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:

${OPENSTACK_EXPORTER_170_LOSSES}

If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.`,
      },
    ],
    lastSteps: [
      {
        title: "Watch what the cloud stands on",
        description:
          "RabbitMQ, MariaDB, Memcached, HAProxy, OVN and Open vSwitch, from the exporters Kolla-Ansible already runs.",
        markdown: `On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:

${codeBlock(
  "bash",
  `${downloadTargetsScript(context.oneuptimeUrl)}
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 ${OPENSTACK_CONTROL_PLANE_TARGETS_SCRIPT} --region RegionOne`,
)}

Add what it prints to the agent's \`.env\`, then run \`docker compose up -d\` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.

| Reads | Port | Setting |
|---|---|---|
${OPENSTACK_KOLLA_EXPORTERS.map((exporter: OpenStackKollaExporter): string => {
  return `| ${exporter.what} | \`${exporter.port}\` | \`${exporter.variable}\` |`;
}).join("\n")}

- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under \`[prometheus-openstack-network-exporter:children]\` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.
- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.`,
      },
    ],
    topics: [
      {
        title: "Service logs on Kolla-Ansible",
        summary:
          "Read from the kolla_logs volume on each node, or sent through Kolla's own Fluentd.",
        markdown: `The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:

${codeBlock(
  "bash",
  `${getAgentFileDownloadCommand(context.oneuptimeUrl, InstallScriptName.OpenStackAgent, OPENSTACK_LOGS_INSTALLER)}
sudo bash ${OPENSTACK_LOGS_INSTALLER} files`,
)}

Kolla's own Fluentd can forward too, with an output in \`/etc/kolla/config/fluentd/output/*.conf\` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.`,
      },
      {
        title: "Who did what on Kolla-Ansible",
        summary: WHO_DID_WHAT_SUMMARY,
        markdown: `${WHAT_THE_AUDIT_TRAIL_NEEDS} The agent's logs profile reads both from \`/var/log/kolla\`.

${codeBlock("ini", `# /etc/kolla/config/keystone.conf\n${KEYSTONE_AUDIT_CONF}`)}

${codeBlock("bash", "kolla-ansible reconfigure -i <inventory> -t keystone")}

${ADMIN_NEEDS_SIGN_INS}

For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:

${codeBlock("ini", `# /etc/kolla/config/global.conf\n${AUDIT_FILTER_CONF}`)}

${codeBlock(
  "bash",
  "kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance",
)}

It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with \`nova_api_extra_volumes\`, \`neutron_server_extra_volumes\`, \`cinder_api_extra_volumes\` and \`glance_api_extra_volumes\` in \`globals.yml\`. pyCADF's map files are in \`/var/lib/kolla/venv/etc/pycadf\` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.`,
      },
    ],
  };
}

/*
 * OpenStack-Ansible. Read from openstack/openstack-ansible and its role repositories:
 *   doc/source/admin/maintenance-tasks/logging.rst           logs in journald
 *   doc/source/reference/configuration/using-overrides.rst   /etc/openstack_deploy/user_*.yml
 *   doc/source/user/aio/quickstart.rst                       /root/openrc in the utility container
 *   openstack-ansible-os_nova templates/nova.conf.j2, and each service's: service_type is set
 *   openstack-ansible-os_* defaults/main.yml                 <service>_policy_overrides
 *   openstack-ansible-os_* tasks                             the <service>-policy-override tags
 *   doc/source/admin/maintenance-tasks/rabbitmq-maintain.rst the openstack.osa.* playbook names
 *   openstack-ansible-rabbitmq_server defaults/main.yml      rabbitmq_plugins, as its comment writes it
 *   openstack-ansible-haproxy_server defaults/main.yml       haproxy_stats_*, off and on localhost
 *   openstack-ansible-os_keystone defaults/main.yml          keystone_keystone_conf_overrides
 *   openstack-ansible-os_{nova,neutron,cinder,glance} defaults/main.yml
 *                                                            *_api_paste_ini_overrides
 */
function openStackAnsible(
  context: OpenStackDeploymentGuideContext,
): OpenStackDeploymentGuide {
  return {
    alreadyRuns:
      "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.",
    howFarTested: `Its paths and variables were read from OpenStack-Ansible's own source and docs. The agent itself was recorded on a test cloud, but not one this tool deployed. ${TESTED_BY_RIG}`,
    firstSteps: [],
    credentialNotes: [
      "Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`.",
      "**Full view** needs no change to any service: OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`. Its Cinder says `volumev3`, which the access rules also carry.",
      "**Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.",
    ],
    credentialVariants: [],
    lastSteps: [
      {
        title: "Watch what the cloud stands on",
        description:
          "OpenStack-Ansible runs no exporters for these, so only what you turn on is watched.",
        markdown: `- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on \`15692\` as \`OPENSTACK_RABBITMQ_TARGETS\` in the agent's \`.env\`:

${codeBlock(
  "yaml",
  `# /etc/openstack_deploy/user_variables.yml
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled`,
)}

${codeBlock("bash", "openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config")}

- **HAProxy:** its exporter is off, and its stats listener is on \`127.0.0.1\` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on \`1936\` as \`OPENSTACK_HAPROXY_TARGETS\`:

${codeBlock(
  "yaml",
  `# /etc/openstack_deploy/user_variables.yml
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false`,
)}

${codeBlock("bash", "openstack-ansible openstack.osa.haproxy")}

- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as \`OPENSTACK_MARIADB_TARGETS\` and \`OPENSTACK_MEMCACHED_TARGETS\`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.`,
      },
      {
        title: "Collect the services' logs",
        description:
          "From journald, on each host that runs a service: containers pass their journals through to the host.",
        markdown: `${codeBlock(
          "bash",
          `${getAgentFileDownloadCommand(context.oneuptimeUrl, InstallScriptName.OpenStackAgent, OPENSTACK_LOGS_INSTALLER)}
sudo bash ${OPENSTACK_LOGS_INSTALLER} journald`,
        )}

This runs the agent's logs profile as a systemd service, and reads \`/var/log/journal/\`, where OpenStack-Ansible's containers' journals arrive.`,
      },
    ],
    topics: [
      {
        title: "Who did what on OpenStack-Ansible",
        summary: WHO_DID_WHAT_SUMMARY,
        markdown: `${WHAT_THE_AUDIT_TRAIL_NEEDS} The agent's logs profile reads both from the journal.

${codeBlock(
  "yaml",
  `# /etc/openstack_deploy/user_variables.yml
keystone_keystone_conf_overrides:
  DEFAULT:
    notification_format: cadf
    notification_opt_out: identity.authenticate.pending
  oslo_messaging_notifications:
    driver: log`,
)}

${codeBlock("bash", "openstack-ansible openstack.osa.keystone")}

${ADMIN_NEEDS_SIGN_INS} A second value of \`notification_opt_out\` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.

For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with \`audit\` right after \`authtoken\` and the context filter that follows it in each pipeline. Nova's, and the same in \`neutron_neutron_conf_overrides\` and \`neutron_api_paste_ini_overrides\`, \`cinder_cinder_conf_overrides\` and \`cinder_api_paste_ini_overrides\`, and \`glance_glance_api_conf_overrides\` and \`glance_glance_api_paste_ini_overrides\`:

${codeBlock(
  "yaml",
  `# /etc/openstack_deploy/user_variables.yml
nova_nova_conf_overrides:
  audit_middleware_notifications:
    driver: log
nova_api_paste_ini_overrides:
  "filter:audit":
    paste.filter_factory: keystonemiddleware.audit:filter_factory
    audit_map_file: "/openstack/venvs/nova-{{ nova_venv_tag }}/etc/pycadf/nova_api_audit_map.conf"`,
)}

${codeBlock("bash", "openstack-ansible openstack.osa.nova")}`,
      },
    ],
  };
}

/*
 * OpenStack-Helm and Atmosphere run the control plane in Kubernetes, so the Kubernetes agent
 * is already the way to see its pods and logs, and a probe is the way to read its APIs
 * without a third thing to deploy.
 */
function kubernetesAgentStep(data: {
  title: string;
  description: string;
  cloudName: string;
  extraFlags?: string | undefined;
}): SetupGuideStep {
  return {
    title: data.title,
    description: data.description,
    markdown: `Follow **Kubernetes → Documentation** for this cluster${data.extraFlags ? `, with ${data.extraFlags}` : ""}. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.

To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:

${codeBlock(
  "yaml",
  `logs:
  openStack:
    cloudName: ${data.cloudName}
    namespaces:
      - openstack`,
)}`,
  };
}

function probeStep(): SetupGuideStep {
  return {
    title: "Read the APIs with a probe",
    description:
      "Nothing to install: a probe that can reach Keystone and each service over HTTPS reads the same series the agent would.",
    markdown:
      "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.",
  };
}

/*
 * OpenStack-Helm. Read from openstack/openstack-helm: prometheus-alertmanager/values.yaml
 * (conf.alertmanager), prometheus-openstack-exporter/values.yaml (exporter 1.7.0), and
 * {keystone,nova,neutron,cinder,glance}/values.yaml: conf.<service>, conf.logging, whose root
 * logger is at WARNING, and conf.paste, whose pipelines hold the audit filter on Nova, Neutron
 * and Cinder, and not on Glance.
 */
function openStackHelm(
  context: OpenStackDeploymentGuideContext,
): OpenStackDeploymentGuide {
  return {
    alreadyRuns:
      "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.",
    howFarTested: `Its chart values were read from OpenStack-Helm's own source. ${TESTED_BY_RIG} The probe and the Kubernetes agent were each tested on their own, not together on this tool.`,
    firstSteps: [
      {
        title: "Forward what is already firing",
        description: "Optional: if you run its prometheus-alertmanager chart.",
        markdown: `${alertmanagerMonitorSteps(context.cloudName)}

Then add the receiver under \`conf.alertmanager\` in the chart's values, and send your route to it:

${codeBlock(
  "yaml",
  `conf:
  alertmanager: |
    global:
      resolve_timeout: 5m
    route:
      receiver: oneuptime
      group_by: ["alertname", "instance"]
    receivers:
${alertmanagerReceiver(context.oneuptimeUrl, "      ")}`,
)}`,
      },
    ],
    credentialNotes: [],
    credentialVariants: [],
    lastSteps: [
      probeStep(),
      kubernetesAgentStep({
        title: "See the pods and their logs",
        description:
          "The Kubernetes agent, on the cluster the charts run on, for what a probe cannot see.",
        cloudName: context.cloudName,
      }),
    ],
    topics: [
      {
        title: "Who did what on OpenStack-Helm",
        summary: WHO_DID_WHAT_SUMMARY,
        markdown: `${WHAT_THE_AUDIT_TRAIL_NEEDS} The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.

${codeBlock("yaml", `# keystone's values.yaml\n${KEYSTONE_AUDIT_VALUES}`)}

${ADMIN_NEEDS_SIGN_INS}

A chart's \`logging.conf\` keeps the root logger at \`WARNING\`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so \`keys\` holds what the chart's has, plus this:

${codeBlock("yaml", `# keystone's values.yaml\n${NOTIFICATIONS_LOGGER_VALUES}`)}

For who did what through Nova, Neutron and Cinder, their charts' \`conf.paste\` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in \`conf.logging\`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its \`conf.paste\`.

${codeBlock(
  "yaml",
  `# nova's values.yaml
conf:
  nova:
    audit_middleware_notifications:
      driver: log`,
)}`,
      },
    ],
  };
}

/*
 * Atmosphere. Read from vexxhost/atmosphere: doc/source/admin/monitoring.rst
 * (kube_prometheus_stack_helm_values.alertmanager.config.receivers),
 * roles/kube_prometheus_stack, whose rules are the ones it ships, and
 * roles/{keystone,nova,neutron,cinder,glance}: *_helm_values over OpenStack-Helm's charts,
 * with log_config_append null, so no logger of its own is needed.
 */
function atmosphere(
  context: OpenStackDeploymentGuideContext,
): OpenStackDeploymentGuide {
  return {
    alreadyRuns:
      "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.",
    howFarTested: `Its configuration was read from Atmosphere's own docs and source. ${TESTED_BY_RIG} The probe and the Kubernetes agent were each tested on their own, not together on this tool.`,
    firstSteps: [
      {
        title: "Forward what is already firing",
        description:
          "Atmosphere ships alert rules that have paged real people, so this works from the first hour.",
        markdown: `${alertmanagerMonitorSteps(context.cloudName)}

Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:

${codeBlock(
  "yaml",
  `kube_prometheus_stack_helm_values:
  alertmanager:
    config:
      route:
        receiver: oneuptime
      receivers:
${alertmanagerReceiver(context.oneuptimeUrl, "        ")}`,
)}`,
      },
    ],
    credentialNotes: [],
    credentialVariants: [],
    lastSteps: [
      probeStep(),
      kubernetesAgentStep({
        title: "See the pods and their logs",
        description:
          "The Kubernetes agent, on the cluster Atmosphere runs on, for what a probe cannot see.",
        cloudName: context.cloudName,
      }),
    ],
    topics: [
      {
        title: "Who did what on Atmosphere",
        summary: WHO_DID_WHAT_SUMMARY,
        markdown: `${WHAT_THE_AUDIT_TRAIL_NEEDS} The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.

${codeBlock(
  "yaml",
  `# your inventory's variables
keystone_helm_values:
  ${KEYSTONE_AUDIT_VALUES.split("\n").join("\n  ")}`,
)}

${ADMIN_NEEDS_SIGN_INS}

For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in \`nova_helm_values\`, \`neutron_helm_values\` and \`cinder_helm_values\`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its \`conf.paste\`, in \`glance_helm_values\`.

${codeBlock(
  "yaml",
  `# your inventory's variables
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log`,
)}`,
      },
    ],
  };
}

/*
 * Canonical Sunbeam. Read from canonical.com/openstack/docs/latest/how-to/features/observability
 * (sunbeam enable observability), canonical/openstack-exporter-operator (src/charm.py and
 * charmcraft.yaml: /metrics on 9180, one cloud) and canonical/alertmanager-k8s-operator
 * (charmcraft.yaml: config_file). Sunbeam's own docs do not mention the exporter charm, and
 * a search of its source found no deployment of it, so the guide says "if you run it". Its
 * Keystone charm is canonical/sunbeam-charms charms/keystone-k8s: charmcraft.yaml has no such
 * setting, and src/templates/keystone.conf.j2 takes its notifications from a template of its own.
 */
function sunbeam(
  context: OpenStackDeploymentGuideContext,
): OpenStackDeploymentGuide {
  return {
    alreadyRuns:
      "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.",
    howFarTested: `Its commands were read from Canonical's docs and its charms' source. ${TESTED_BY_RIG} Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.`,
    firstSteps: [
      {
        title: "Forward what is already firing",
        description: "Optional: if you run the Canonical Observability Stack.",
        markdown: `${alertmanagerMonitorSteps(context.cloudName)}

Then give the stack's Alertmanager a configuration with the receiver in it:

${codeBlock(
  "yaml",
  `# alertmanager.yaml
route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
receivers:
${alertmanagerReceiver(context.oneuptimeUrl, "  ")}`,
)}

${codeBlock("bash", "juju config --model observability alertmanager config_file=@alertmanager.yaml")}`,
      },
    ],
    credentialNotes: [],
    credentialVariants: [
      {
        label: "The exporter charm",
        markdown: `If you run Canonical's \`openstack-exporter\` charm, the agent can read it with no credential of its own. It answers one cloud on \`/metrics\`, on port \`9180\` unless you changed its \`port\` setting. Find its address with \`juju status openstack-exporter\`:

${codeBlock(
  "bash",
  `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \\
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \\
bash install.sh`,
)}

Which series it says depends on the exporter release in its snap, which was not recorded here: \`bash troubleshoot.sh\` says whether it reads the cloud.`,
      },
    ],
    lastSteps: [],
    topics: [
      {
        title: "Service logs on Sunbeam",
        summary:
          "The stack's Loki holds them, and OneUptime does not read Loki yet.",
        markdown:
          "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.",
      },
      {
        title: "Who did what on Sunbeam",
        summary: "Not yet: its charms give no way to turn it on.",
        markdown:
          "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.",
      },
    ],
  };
}

/*
 * Red Hat OpenStack Services on OpenShift. Read from openstack-k8s-operators/telemetry-operator:
 * config/samples/telemetry_v1beta1_metricstorage.yaml (alertingEnabled) and
 * docs/sample-alerts/alertmanager-config-email.yaml (monitoring.rhobs/v1alpha1
 * AlertmanagerConfig, labelled service: metricStorage). webhookConfigs is what that CRD calls a
 * webhook receiver. The Kubernetes agent's preset is HelmChart/Public/kubernetes-agent's.
 * customServiceConfig and defaultConfigOverwrite are in openstack-k8s-operators/keystone-operator,
 * nova-operator and neutron-operator. cinder-operator's and glance-operator's APIs have the first
 * and not the second.
 */
function rhoso(
  context: OpenStackDeploymentGuideContext,
): OpenStackDeploymentGuide {
  return {
    alreadyRuns:
      "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.",
    howFarTested: `Its resources were read from the Telemetry Operator's own source. ${TESTED_BY_RIG} The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.`,
    firstSteps: [
      {
        title: "Forward what is already firing",
        description:
          "Optional: if MetricStorage has alertingEnabled and you wrote or applied rules.",
        markdown: `${alertmanagerMonitorSteps(context.cloudName)}

Then apply a receiver the monitoring stack picks up:

${codeBlock(
  "yaml",
  `apiVersion: monitoring.rhobs/v1alpha1
kind: AlertmanagerConfig
metadata:
  name: oneuptime
  labels:
    service: metricStorage
spec:
  route:
    receiver: oneuptime
    groupBy: ["alertname", "instance"]
  receivers:
    - name: oneuptime
      webhookConfigs:
        - url: "${context.oneuptimeUrl}/heartbeat/<secret key>"
          sendResolved: true`,
)}`,
      },
    ],
    credentialNotes: [],
    credentialVariants: [],
    lastSteps: [
      probeStep(),
      kubernetesAgentStep({
        title: "Watch the control plane on OpenShift",
        description:
          "The Kubernetes agent, with its OpenShift preset, on the cluster that runs the control plane.",
        cloudName: context.cloudName,
        extraFlags:
          "**Red Hat OpenShift** picked, which sets `preset=openshift`",
      }),
      {
        title: "Read the compute nodes through Ceilometer",
        description:
          "What each instance is really doing, from the exporter Ceilometer already runs on them, from 2025.1.",
        markdown:
          "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.",
      },
    ],
    topics: [
      {
        title: "Who did what on Red Hat OpenStack on OpenShift",
        summary: WHO_DID_WHAT_SUMMARY,
        markdown: `${WHAT_THE_AUDIT_TRAIL_NEEDS} The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.

${codeBlock(
  "yaml",
  `# your OpenStackControlPlane
spec:
  keystone:
    template:
      customServiceConfig: |
        ${KEYSTONE_AUDIT_CONF.split("\n").join("\n        ")}`,
)}

${ADMIN_NEEDS_SIGN_INS}

For who did what through Nova and Neutron, each takes the filter's setting in its \`customServiceConfig\`, and its paste file in \`defaultConfigOverwrite\`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.

${codeBlock(
  "yaml",
  `# your OpenStackControlPlane
spec:
  nova:
    template:
      apiServiceTemplate:
        customServiceConfig: |
          ${AUDIT_FILTER_CONF.split("\n").join("\n          ")}`,
)}`,
      },
    ],
  };
}

/*
 * Mirantis MOSK. Read from docs.mirantis.com/mosk/latest/ops/stacklight-operations/config
 * /sl-config-params.html: alertmanagerSimpleConfig.genericReceivers takes any Alertmanager
 * receiver. Its examples show OpsGenie and Microsoft Teams, not a webhook. features:logging:cadf
 * is docs.mirantis.com/mosk/26.1/security/cadf-audit.html, which does not list Keystone, and
 * spec:services is .../ref-arch/openstack/openstack-config/osdpl-cr-spec-services.html.
 */
function mosk(
  context: OpenStackDeploymentGuideContext,
): OpenStackDeploymentGuide {
  return {
    alreadyRuns:
      "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.",
    howFarTested: `Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. ${TESTED_BY_RIG}`,
    firstSteps: [
      {
        title: "Forward what is already firing",
        description:
          "StackLight ships alert rules, so this works from the first hour.",
        markdown: `${alertmanagerMonitorSteps(context.cloudName)}

Then add the receiver and its route to your StackLight values:

${codeBlock(
  "yaml",
  `alertmanagerSimpleConfig:
  genericReceivers:
    - name: oneuptime
      enabled: true
      webhook_configs:
        - url: "${context.oneuptimeUrl}/heartbeat/<secret key>"
          send_resolved: true
  genericRoutes:
    - receiver: oneuptime
      enabled: true
      matchers:
        - severity=~"warning|critical"
      continue: true`,
)}`,
      },
    ],
    credentialNotes: [],
    credentialVariants: [],
    lastSteps: [probeStep()],
    topics: [
      {
        title: "Who did what on Mirantis MOSK",
        summary: WHO_DID_WHAT_SUMMARY,
        markdown: `For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. ${WHAT_THE_AUDIT_TRAIL_NEEDS}

${codeBlock(
  "yaml",
  `# your OpenStackDeployment
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log`,
)}

That setting does not cover Keystone. Its own audit trail takes \`spec:services\`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:

${codeBlock(
  "yaml",
  `# your OpenStackDeployment
spec:
  services:
    identity:
      keystone:
        values:
          ${KEYSTONE_AUDIT_VALUES.split("\n").join("\n          ")}`,
)}

${ADMIN_NEEDS_SIGN_INS}`,
      },
    ],
  };
}

export function getOpenStackDeploymentGuide(data: {
  tool: OpenStackDeploymentTool;
  context: OpenStackDeploymentGuideContext;
}): OpenStackDeploymentGuide {
  switch (data.tool) {
    case "kolla-ansible":
      return kollaAnsible(data.context);
    case "openstack-ansible":
      return openStackAnsible(data.context);
    case "openstack-helm":
      return openStackHelm(data.context);
    case "atmosphere":
      return atmosphere(data.context);
    case "sunbeam":
      return sunbeam(data.context);
    case "rhoso":
      return rhoso(data.context);
    case "mosk":
      return mosk(data.context);
    default:
      return withoutTool();
  }
}
