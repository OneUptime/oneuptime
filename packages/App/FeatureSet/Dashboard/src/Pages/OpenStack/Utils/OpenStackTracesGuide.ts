import { InstallScriptName } from "Common/Types/InstallScripts/InstallScripts";
import {
  getAgentFileDownloadCommand,
  getInstallScriptRunCommand,
} from "../../../Components/SetupGuide/AgentInstallCommands";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  shellQuote,
} from "../../../Components/SetupGuide/SetupGuide";
import {
  DEFAULT_OPENSTACK_DEPLOYMENT_TOOL,
  OpenStackDeploymentTool,
} from "./OpenStackDeploymentGuides";

/*
 * TURNING OSPROFILER ON, FOR THE TOOL THAT DEPLOYED THE CLOUD.
 *
 * What it takes is the same everywhere and hard in a different way on each tool: every
 * service needs two OpenTelemetry libraries that no tool's images hold, and a [profiler]
 * section, and a collector its 127.0.0.1 can reach. Every path and variable here was read
 * from the tool's own source, and the comment above each guide says where.
 *
 * What was really run is DevStack (Tests/Ops/openstack-e2e/traces-record.sh). None of the
 * tools' guides has been followed on a deployment of that tool, and each says so on screen:
 * the rule from OpenStackDeploymentGuides is to say what each was checked against, and never
 * more.
 *
 * Pure and React-free, so a test can read every word.
 */

export const OPENSTACK_TRACES_INSTALL_FILE: string = "install-traces.sh";

export const OPENSTACK_TRACES_CONNECTION_STRING: string =
  "otlp://127.0.0.1:4318";

const LIBRARIES: string = "opentelemetry-sdk opentelemetry-exporter-otlp";

const NOT_RUN: string =
  "It has not been followed on a real deployment of this tool: what has been run is the same config on DevStack.";

export interface OpenStackTracesGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  cloudName: string;
  tool?: OpenStackDeploymentTool | undefined;
}

function profilerSection(connectionString: string): string {
  return `[profiler]
enabled = True
hmac_keys = <your key>
connection_string = ${connectionString}
trace_sqlalchemy = False`;
}

// The first thing any tool's guide says to do: one key, the same on every service.
const KEY_LINE: string =
  "Make one key with `openssl rand -hex 32`, and give every service that same key. Anyone holding it can make any request traced, so keep it as you keep a password. Leave `hmac_keys` unset and OSProfiler uses the literal value `SECRET_KEY`.";

interface ToolGuide {
  howFarTested: string;
  // How a service gets the two libraries, on this tool.
  libraries: string;
  // How a service gets [profiler], on this tool.
  config: string;
  // Whether this machine's collector can sit where the services' 127.0.0.1 reaches it.
  collectorNote?: string | undefined;
  installMethod?: string | undefined;
  /*
   * A tool on which we found no way to do it: said first, and the steps below are what
   * would be needed and not a promise.
   */
  blocker?: string | undefined;
}

/*
 * Kolla-Ansible and Kolla. Read from openstack/kolla-ansible at master:
 *   ansible/group_vars/all/common.yml       enable_osprofiler, osprofiler_backend
 *   ansible/roles/nova/templates/nova.conf.j2  [profiler] with trace_sqlalchemy = true
 *   ansible/roles/nova/tasks/config.yml     global.conf merged over the template
 *   doc/source/admin/advanced-configuration.rst  /etc/kolla/config/global.conf
 * and from openstack/kolla: no image names opentelemetry, and doc/source/admin/image-building.rst
 * gives each image a <image_name>_footer block.
 */
function kollaAnsible(): ToolGuide {
  return {
    howFarTested: `Its paths were read from Kolla-Ansible's and Kolla's own source. ${NOT_RUN}`,
    libraries: `Kolla's images hold OSProfiler and not these libraries, so build them in, with a [template override](https://docs.openstack.org/kolla/latest/admin/image-building.html) that installs them in the images your services run from:

${codeBlock(
  "jinja",
  `{% extends parent_template %}
{% block openstack_base_footer %}
RUN /var/lib/kolla/venv/bin/pip install ${LIBRARIES}
{% endblock %}`,
)}

${codeBlock(
  "bash",
  "kolla-build --template-override template-overrides.j2 nova neutron cinder glance keystone placement",
)}`,
    config: `Write this to \`/etc/kolla/config/global.conf\`, which Kolla-Ansible merges into every service's config, and apply it. Leave \`enable_osprofiler\` off: its templates turn on \`trace_sqlalchemy\`, which is the expensive part, and point at a store of their own.

${codeBlock("ini", profilerSection(OPENSTACK_TRACES_CONNECTION_STRING))}

${codeBlock("bash", "kolla-ansible reconfigure -i <inventory>")}`,
    collectorNote:
      "Kolla-Ansible runs its services on the host's network, so their `127.0.0.1` is the machine's, and the collector's default address reaches them.",
  };
}

/*
 * OpenStack-Ansible. Read from openstack/openstack-ansible-os_{nova,neutron,cinder,glance,
 * keystone,placement} at master, defaults/main.yml: *_conf_overrides on each, and
 * *_user_pip_packages on nova, cinder, glance and keystone, not on neutron or placement. An
 * LXC container's 127.0.0.1 is its own, which is why the collector needs another address.
 */
function openStackAnsible(): ToolGuide {
  return {
    howFarTested: `Its variables were read from OpenStack-Ansible's own roles. ${NOT_RUN}`,
    libraries: `Add them to each service's virtual environment, in \`user_variables.yml\`. The Neutron and Placement roles have no such variable, so add them there by hand, into \`/openstack/venvs/neutron-*\` and \`/openstack/venvs/placement-*\`.

${codeBlock(
  "yaml",
  `nova_user_pip_packages: [opentelemetry-sdk, opentelemetry-exporter-otlp]
cinder_user_pip_packages: [opentelemetry-sdk, opentelemetry-exporter-otlp]
glance_user_pip_packages: [opentelemetry-sdk, opentelemetry-exporter-otlp]
keystone_user_pip_packages: [opentelemetry-sdk, opentelemetry-exporter-otlp]`,
)}`,
    config: `Set it through each service's overrides, in \`user_variables.yml\`, and run each service's playbook. In LXC containers, \`connection_string\` names the host's address on \`br-mgmt\` instead of \`127.0.0.1\`, because a container's \`127.0.0.1\` is its own.

${codeBlock(
  "yaml",
  `profiler_overrides: &profiler_overrides
  profiler:
    enabled: True
    hmac_keys: <your key>
    connection_string: ${OPENSTACK_TRACES_CONNECTION_STRING}
    trace_sqlalchemy: False

nova_nova_conf_overrides: *profiler_overrides
neutron_neutron_conf_overrides: *profiler_overrides
cinder_cinder_conf_overrides: *profiler_overrides
glance_glance_api_conf_overrides: *profiler_overrides
keystone_keystone_conf_overrides: *profiler_overrides
placement_placement_conf_overrides: *profiler_overrides`,
)}`,
    collectorNote:
      "With services in LXC containers, listen on the host's `br-mgmt` address so they can reach it: `OPENSTACK_TRACES_LISTEN_ADDRESS=<address>:4318`. Spans cross that bridge in plain HTTP, because that is all the driver can post, so keep the address to that bridge.",
    installMethod: "native",
  };
}

/*
 * OpenStack-Helm and Atmosphere. Read from openstack/openstack-helm and vexxhost/atmosphere:
 * a chart writes conf.<service> as its config file, and neither openstack/loci nor their
 * images name opentelemetry. A pod's 127.0.0.1 is its own.
 */
function kubernetesCharts(toolName: string): ToolGuide {
  return {
    howFarTested: `Its keys were read from ${toolName}'s own charts. ${NOT_RUN}`,
    libraries: `The charts' images hold OSProfiler and not these libraries, so build your own on top of them, and point each chart's \`images.tags\` at it:

${codeBlock(
  "dockerfile",
  `FROM <the image your chart runs>
RUN /var/lib/openstack/bin/pip install ${LIBRARIES}`,
)}`,
    config: `Set it in each chart's values, under \`conf.<service>\`. A pod's \`127.0.0.1\` is its own, so \`connection_string\` names a collector in the cluster instead: run \`otel-collector-traces.yaml\` as a Deployment behind a Service, with \`OPENSTACK_TRACES_LISTEN_ADDRESS=0.0.0.0:4318\`.

${codeBlock(
  "yaml",
  `conf:
  nova:
    profiler:
      enabled: true
      hmac_keys: <your key>
      connection_string: otlp://<collector service>.<namespace>.svc.cluster.local:4318
      trace_sqlalchemy: false`,
)}`,
    collectorNote:
      "Spans cross the pod network in plain HTTP, because that is all the driver can post. Keep the Service's address inside the cluster, and a network policy on it if you use them.",
    installMethod: "cluster",
  };
}

/*
 * Sunbeam. Neither canonical/snap-openstack nor canonical/sunbeam-charms names osprofiler or
 * [profiler], and its charms write their services' config from templates of their own.
 */
function sunbeam(): ToolGuide {
  return {
    howFarTested: `Sunbeam's own source was searched, and it was not found. ${NOT_RUN}`,
    blocker:
      "We found no way to do this on Sunbeam today. Its charms write each service's config from their own templates, with no place for a `[profiler]` section, and their images do not hold the libraries. This is what it would take if yours can be changed.",
    libraries: `Each service's image would need \`${LIBRARIES}\`.`,
    config: `Each service's config would need this, with a collector its \`127.0.0.1\` can reach:

${codeBlock("ini", profilerSection(OPENSTACK_TRACES_CONNECTION_STRING))}`,
  };
}

/*
 * Red Hat OpenStack Services on OpenShift. Read from openstack-k8s-operators: each service's
 * customServiceConfig takes oslo config as text, and s2i-openstack-containers locks OSProfiler
 * into its images, where the two libraries are only in upper-constraints.
 */
function rhoso(): ToolGuide {
  return {
    howFarTested: `Its fields were read from the openstack-k8s-operators' own source. ${NOT_RUN}`,
    libraries: `The images hold OSProfiler and not these libraries, so each service would run an image of your own on top of Red Hat's, with \`${LIBRARIES}\` added. Ask Red Hat what that does to your support first.`,
    config: `Set it through each service's \`customServiceConfig\`. A pod's \`127.0.0.1\` is its own, so \`connection_string\` names a collector in the cluster: run \`otel-collector-traces.yaml\` as a Deployment behind a Service, with \`OPENSTACK_TRACES_LISTEN_ADDRESS=0.0.0.0:4318\`.

${codeBlock(
  "ini",
  profilerSection(
    "otlp://<collector service>.<namespace>.svc.cluster.local:4318",
  ),
)}`,
    collectorNote:
      "Spans cross the pod network in plain HTTP, because that is all the driver can post. Keep the Service's address inside the cluster.",
    installMethod: "cluster",
  };
}

// MOSK's source is closed, so this says no more than any Kubernetes deployment shares.
function mosk(): ToolGuide {
  return {
    howFarTested: `MOSK's source is not public, so nothing here was read from it. ${NOT_RUN}`,
    libraries: `Each service's image needs \`${LIBRARIES}\` added. Ask Mirantis how, and what that does to your support.`,
    config: `Each service's config needs this. A pod's \`127.0.0.1\` is its own, so \`connection_string\` names a collector in the cluster: run \`otel-collector-traces.yaml\` as a Deployment behind a Service, with \`OPENSTACK_TRACES_LISTEN_ADDRESS=0.0.0.0:4318\`.

${codeBlock(
  "ini",
  profilerSection(
    "otlp://<collector service>.<namespace>.svc.cluster.local:4318",
  ),
)}`,
    installMethod: "cluster",
  };
}

// What DevStack ran, on any cloud whose services read a config file and live in a virtualenv.
function general(): ToolGuide {
  return {
    howFarTested:
      "These exact steps were run on DevStack, on OpenStack 2025.2 and 2026.2, with a boot signed and the driver's real output recorded. Nothing else has been.",
    libraries: `Install them where each service runs, with your release's constraints if you keep them:

${codeBlock("bash", `pip install ${LIBRARIES}`)}`,
    config: `Add this to each service's config: \`nova.conf\`, \`neutron.conf\`, \`cinder.conf\`, \`glance-api.conf\`, \`keystone.conf\` and \`placement.conf\`. Then restart them.

${codeBlock("ini", profilerSection(OPENSTACK_TRACES_CONNECTION_STRING))}`,
  };
}

function getToolGuide(tool: OpenStackDeploymentTool): ToolGuide {
  switch (tool) {
    case "kolla-ansible":
      return kollaAnsible();
    case "openstack-ansible":
      return openStackAnsible();
    case "openstack-helm":
      return kubernetesCharts("OpenStack-Helm");
    case "atmosphere":
      return kubernetesCharts("Atmosphere");
    case "sunbeam":
      return sunbeam();
    case "rhoso":
      return rhoso();
    case "mosk":
      return mosk();
    default:
      return general();
  }
}

function installCollectorStep(
  options: OpenStackTracesGuideOptions,
  guide: ToolGuide,
): SetupGuideStep {
  const prefilled: boolean =
    options.hasApiKey && options.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER;
  const environment: Array<string> = [
    `ONEUPTIME_URL=${shellQuote(options.oneuptimeUrl)}`,
    ...(prefilled
      ? [`ONEUPTIME_TELEMETRY_INGESTION_KEY=${shellQuote(options.apiKey)}`]
      : []),
    `OPENSTACK_CLOUD_NAME=${shellQuote(options.cloudName)}`,
  ];
  const run: string = getInstallScriptRunCommand(
    environment,
    `sudo -E bash ${OPENSTACK_TRACES_INSTALL_FILE}${guide.installMethod === "native" ? " native" : ""}`,
  );

  if (guide.installMethod === "cluster") {
    return {
      title: "Run a collector in the cluster",
      description:
        "It takes what the driver posts in plain HTTP, removes what a call was handed, says which cloud this is, and forwards the rest over TLS.",
      markdown: `Download its config, and run it as a Deployment behind a Service with the image \`docker-compose.traces.yml\` pins:

${codeBlock(
  "bash",
  getAgentFileDownloadCommand(
    options.oneuptimeUrl,
    InstallScriptName.OpenStackAgent,
    "otel-collector-traces.yaml",
  ),
)}

Give it \`ONEUPTIME_URL\`, \`ONEUPTIME_TELEMETRY_INGESTION_KEY\`, \`OPENSTACK_CLOUD_NAME=${options.cloudName}\`, \`OPENSTACK_REGION_NAME\`, \`OPENSTACK_NODE_NAME\` and \`OPENSTACK_TRACES_LISTEN_ADDRESS=0.0.0.0:4318\`.`,
      note: guide.collectorNote,
    };
  }

  return {
    title: "Run the collector on each machine",
    description:
      "On every controller and compute node whose services you want traced. It takes what the driver posts in plain HTTP on this machine alone, removes what a call was handed, says which cloud this is, and forwards the rest over TLS.",
    markdown: codeBlock(
      "bash",
      `${getAgentFileDownloadCommand(
        options.oneuptimeUrl,
        InstallScriptName.OpenStackAgent,
        OPENSTACK_TRACES_INSTALL_FILE,
      )}
${run}`,
    ),
    note: guide.collectorNote,
    details:
      "It uses Docker Compose where the machine has it, and otherwise a systemd service. It never touches OpenStack's own config, and nothing arrives until the next two steps are done.",
  };
}

function costsTopic(): SetupGuideTopic {
  return {
    title: "What it costs",
    summary: "Nothing until a request is signed. OpenStack gives no figure.",
    markdown: `With OSProfiler on and nothing signed, a request costs one failed check of a header. Only a signed request makes spans, so tracing is off for everyone else, and it stays off until you ask for it.

OpenStack gives no overhead figure for a signed one, so none is promised here. A signed request does more work in every service it crosses, sends every span over HTTP from each of them, and carries your key across the message bus in its context. Sign what you are looking into, not traffic.

Turn on \`trace_sqlalchemy\` only to look at a database question: it adds a span for every statement.`,
  };
}

function detailsTopics(): Array<SetupGuideTopic> {
  return [
    costsTopic(),
    {
      title: "What a span can hold",
      summary: "What a call was handed is taken out, twice.",
      markdown: `OSProfiler's driver copies what a traced call was handed into its span, written out as Python would print it: an instance's admin password and user data, and a volume's connection info. The collector removes \`args\`, \`kwargs\`, \`result\` and \`db.params\` before they leave the machine, and OneUptime removes them on arrival for a span that came some other way. Nothing turns that off.

Your key is in neither. It does travel between a service's own parts, in the context of each message on your message bus, for as long as a signed request lasts.`,
    },
    {
      title: "trace_requests and trace_sqlalchemy",
      summary: "Two settings that add spans, both off here.",
      markdown: `- \`trace_requests = True\` adds a span for each HTTP call a service makes, with how it was answered. It is the only way to see a call's own status code.
- \`trace_sqlalchemy = True\` adds a span for each SQL statement. OneUptime keeps the statement, whose values are placeholders, and removes the values.`,
    },
  ];
}

function troubleshootingTopics(): Array<SetupGuideTopic> {
  return [
    {
      title: "The client prints no Trace ID",
      summary: "It has no OSProfiler, and ignores your key without it.",
      markdown: `\`openstack\` only offers \`--os-profile\`, and only reads \`OS_PROFILE\`, when OSProfiler is installed where it runs. Run \`pip install osprofiler\` in the same environment as the client.`,
    },
    {
      title: "It prints a Trace ID, and no trace arrives",
      summary: "It prints one whatever happens to the request.",
      markdown: `The client prints a Trace ID whether or not the services accepted your key, and a wrong key is not an error: the request just goes untraced. Check these in order:

1. The key you signed with is in \`hmac_keys\` on the service you called.
2. \`[profiler] enabled = True\`, and the service was restarted since.
3. The service's log has no \`Could not initialize driver for connection string\`. With \`To use OSProfiler with OTLP exporters\` next to it, the libraries are missing in that service's environment.
4. The collector is running, and \`curl -i -X POST http://127.0.0.1:4318/v1/traces\` gets an answer from where the service runs.
5. Its log has no export errors: \`docker logs oneuptime-openstack-traces\`, or \`journalctl -u oneuptime-openstack-traces\` without Docker.`,
    },
    {
      title: "One service is missing from a trace",
      summary: "Each service has to be set up, and a request has to reach it.",
      markdown: `Each service sends its own spans, so one that is not set up leaves a hole in the trace rather than breaking it. A request also only reaches some services: listing instances never touches \`nova-compute\`, and a boot does. Check that service's log as above, once a request that uses it has been traced.`,
    },
  ];
}

export function getOpenStackTracesGuide(
  options: OpenStackTracesGuideOptions,
): SetupGuideContent {
  const tool: OpenStackDeploymentTool =
    options.tool || DEFAULT_OPENSTACK_DEPLOYMENT_TOOL;
  const guide: ToolGuide = getToolGuide(tool);

  const steps: Array<SetupGuideStep> = [
    installCollectorStep(options, guide),
    {
      title: "Give each service the libraries",
      description:
        "OSProfiler's OTLP driver needs two libraries in every service it runs in. Without them a service says so in its log and carries on, untraced.",
      markdown: guide.libraries,
    },
    {
      title: "Turn OSProfiler on",
      description: KEY_LINE,
      markdown: guide.config,
    },
    {
      title: "Sign a request",
      description:
        "Trace a request, on this page, has the commands for this cloud. A trace appears here once one arrives, and this page says which services have sent one.",
    },
  ];

  return {
    wrapLongLines: true,
    intro: `${guide.blocker ? `**${guide.blocker}**\n\n` : ""}**How far this guide has been tested:** ${guide.howFarTested}`,
    steps: steps,
    advanced: detailsTopics(),
    troubleshooting: troubleshootingTopics(),
    links: [
      {
        title: "OpenStack Agent docs",
        url: "/docs/telemetry/openstack#trace-requests-through-the-control-plane",
      },
    ],
  };
}
