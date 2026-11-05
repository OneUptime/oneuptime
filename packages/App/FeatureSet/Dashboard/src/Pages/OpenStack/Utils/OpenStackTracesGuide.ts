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

/*
 * Below 1.44 on purpose. That version's TracerProvider added a fork handler that never comes back
 * from a fork made with a preexec_fn, which is how oslo.concurrency runs every command
 * (open-telemetry/opentelemetry-python#5789). traces-record.sh recorded Neutron's API stuck in it
 * on 2026.2, whose pins name 1.44.0: Common/Tests/Fixtures/OpenStack/traces/hibiscus-ovn/fork-hang.txt.
 */
const LIBRARIES: string =
  "'opentelemetry-sdk<1.44' 'opentelemetry-exporter-otlp<1.44'";

/*
 * The one line that lets OSProfiler's driver start in Placement. traces-record.sh's
 * signed-boot-placement scene applies exactly this to a real Placement, and a span from it
 * arrives: OpenStackTracesGuide.test.ts holds the two together.
 */
export const OPENSTACK_PLACEMENT_PATCH: string = `sed -i '/profiler\\.set_defaults(config)/a\\        config.register_opts(profiler._OTLP_OPTS, group="profiler_otlp")'`;

function placementPatchCommand(python: string): string {
  return `${OPENSTACK_PLACEMENT_PATCH} "$(${python} -c 'import placement.wsgi as module; print(module.__file__)')"`;
}

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

// Said above every guide: it is what this is, whatever deployed the cloud.
const WHAT_THIS_IS: string =
  "**What this is.** OSProfiler traces a request only when it is signed with your key, so this is never an always-on feed: with nothing signed, nothing is sent. Its OTLP driver is marked experimental by OpenStack, can only post plain HTTP, and needs two OpenTelemetry libraries in every service, which is why a collector on each machine takes its spans and forwards them over TLS.";

const NEWEST_RELEASE_WARNING: string =
  "**Stay below version 1.44 of OpenTelemetry's SDK.** That version hangs a service when it starts a subprocess ([its bug](https://github.com/open-telemetry/opentelemetry-python/issues/5789)). On our 2026.2 test cloud, whose pins name 1.44.0, it left Neutron's API never answering, and cinder-volume stopped working. The commands here ask for less than 1.44. On 2026.2 that has not been run yet, so use a test cloud first.";

const WHAT_A_TRACE_SHOWS: string =
  "**What a trace shows.** One signed request is one trace, across `nova-api`, `nova-compute`, `neutron-server`, `keystone`, `glance-api`, `cinder-api` and `cinder-scheduler`. On a stock cloud Placement sends nothing, and on 2025.2 `nova-conductor`, `nova-scheduler` and `cinder-volume` do not either, for reasons under What a trace cannot show below.";

// The first thing any tool's guide says to do: one key, the same on every service.
const KEY_LINE: string =
  "Make one key with `openssl rand -hex 32`, and give every service that same key. Anyone holding it can make any request traced, so keep it as you keep a password. Leave `hmac_keys` unset and OSProfiler uses the literal value `SECRET_KEY`.";

interface ToolGuide {
  howFarTested: string;
  // How a service gets the two libraries, on this tool.
  libraries: string;
  // How a service gets [profiler], on this tool.
  config: string;
  // How Placement gets the one line and its own [profiler], on this tool.
  placement: string;
  // How Nova's conductor and scheduler get one worker each, on this tool.
  oneWorker: string;
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
 * gives each image a <image_name>_footer block: docker/placement/placement-api/Dockerfile.j2 has
 * placement_api_footer, and openstack-base puts its virtual environment first on the PATH.
 * ansible/roles/nova/defaults/main.yml and nova-cell/defaults/main.yml name the worker counts.
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

${codeBlock("bash", "kolla-ansible reconfigure -i <inventory>")}

\`global.conf\` reaches Placement too, which logs one error as it starts and carries on untraced until it has the line under Placement, below.`,
    placement: `Add the line to Placement's image in the same template override, and build \`placement-api\`:

${codeBlock(
  "jinja",
  `{% block placement_api_footer %}
RUN ${placementPatchCommand("python3")}
{% endblock %}`,
)}`,
    oneWorker: `Set these in \`/etc/kolla/config/globals.yml\` and reconfigure Nova:

${codeBlock(
  "yaml",
  `nova_superconductor_workers: 1
nova_cell_conductor_workers: 1
nova_scheduler_workers: 1`,
)}`,
    collectorNote:
      "Kolla-Ansible runs its services on the host's network, so their `127.0.0.1` is the machine's, and the collector's default address reaches them.",
  };
}

/*
 * OpenStack-Ansible. Read from openstack/openstack-ansible-os_{nova,neutron,cinder,glance,
 * keystone,placement} at master, defaults/main.yml: *_conf_overrides on each, and
 * *_user_pip_packages on nova, cinder, glance and keystone, not on neutron or placement, and
 * nova_conductor_workers and nova_scheduler_workers on nova. An LXC container's 127.0.0.1 is its
 * own, which is why the collector needs another address.
 */
function openStackAnsible(): ToolGuide {
  return {
    howFarTested: `Its variables were read from OpenStack-Ansible's own roles. ${NOT_RUN}`,
    libraries: `Add them to each service's virtual environment, in \`user_variables.yml\`. The Neutron and Placement roles have no such variable, so add them there by hand, into \`/openstack/venvs/neutron-*\` and \`/openstack/venvs/placement-*\`.

${codeBlock(
  "yaml",
  `nova_user_pip_packages: ["opentelemetry-sdk<1.44", "opentelemetry-exporter-otlp<1.44"]
cinder_user_pip_packages: ["opentelemetry-sdk<1.44", "opentelemetry-exporter-otlp<1.44"]
glance_user_pip_packages: ["opentelemetry-sdk<1.44", "opentelemetry-exporter-otlp<1.44"]
keystone_user_pip_packages: ["opentelemetry-sdk<1.44", "opentelemetry-exporter-otlp<1.44"]`,
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
keystone_keystone_conf_overrides: *profiler_overrides`,
)}`,
    placement: `In the Placement container, add the line to its virtual environment, and give the role the same overrides. Its playbook puts that virtual environment back when it changes, so the line needs adding again after an upgrade.

${codeBlock(
  "bash",
  placementPatchCommand("/openstack/venvs/placement-*/bin/python"),
)}

${codeBlock(
  "yaml",
  "placement_placement_conf_overrides: *profiler_overrides",
)}`,
    oneWorker: `Set these in \`user_variables.yml\` and run Nova's playbook:

${codeBlock(
  "yaml",
  `nova_conductor_workers: 1
nova_scheduler_workers: 1`,
)}`,
    collectorNote:
      "With services in LXC containers, listen on the host's `br-mgmt` address so they can reach it: `OPENSTACK_TRACES_LISTEN_ADDRESS=<address>:4318`. Spans cross that bridge in plain HTTP, because that is all the driver can post, so keep the address to that bridge.",
    installMethod: "native",
  };
}

/*
 * OpenStack-Helm and Atmosphere. Read from openstack/openstack-helm and vexxhost/atmosphere:
 * a chart writes conf.<service> as its config file, and neither openstack/loci nor their
 * images name opentelemetry. A pod's 127.0.0.1 is its own. nova/values.yaml has conductor and
 * scheduler at one worker each.
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
    placement: `Add the line to Placement's image, on top of the one with the libraries, and set the same section in its chart's values, under \`conf.placement\`:

${codeBlock(
  "dockerfile",
  `FROM <your image with the libraries>
RUN ${placementPatchCommand("/var/lib/openstack/bin/python")}`,
)}`,
    oneWorker: `Nova's chart sets \`conf.nova.conductor.workers\` and \`conf.nova.scheduler.workers\` to 1 by default and scales by pods, so as far as its values say, they should send spans already. If they do not, those two values are what to check.`,
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
    placement: `Placement's image would need the line, as well as the libraries. We found no way to change it on Sunbeam.

${codeBlock("bash", placementPatchCommand("python3"))}`,
    oneWorker:
      "Nova's config would need `workers = 1` under `[conductor]` and `[scheduler]`. We found no way to change it on Sunbeam.",
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
    placement: `Placement's image would need the line too, on top of your image with the libraries. Ask Red Hat first, as for the libraries.

${codeBlock("dockerfile", `RUN ${placementPatchCommand("python3")}`)}`,
    oneWorker:
      "Set `workers = 1` under `[conductor]` and `[scheduler]`, through Nova's `customServiceConfig`.",
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
    placement: `Placement's image needs the line too, on top of the libraries. Ask Mirantis how.

${codeBlock("bash", placementPatchCommand("python3"))}`,
    oneWorker:
      "Nova's config needs `workers = 1` under `[conductor]` and `[scheduler]`. Ask Mirantis how.",
    installMethod: "cluster",
  };
}

// What DevStack ran, on any cloud whose services read a config file and live in a virtualenv.
function general(): ToolGuide {
  return {
    howFarTested:
      "These steps were run on DevStack, on OpenStack 2025.2, with a boot signed and the driver's real output recorded, and on 2026.2, where Neutron had to be left out until this guide's lower version of OpenTelemetry's SDK is proven. Nothing else has been.",
    libraries: `Install them where each service runs, with your release's constraints if you keep them:

${codeBlock("bash", `pip install ${LIBRARIES}`)}`,
    config: `Add this to each service's config: \`nova.conf\`, \`neutron.conf\`, \`cinder.conf\`, \`glance-api.conf\` and \`keystone.conf\`. Then restart them. Leave Placement for now: as OpenStack ships it, it logs an error as it starts and sends nothing.

${codeBlock("ini", profilerSection(OPENSTACK_TRACES_CONNECTION_STRING))}`,
    placement: `Run this with the Python in Placement's environment, add the same section to \`placement.conf\`, and restart it:

${codeBlock("bash", placementPatchCommand("python3"))}`,
    oneWorker: `Add this to \`nova.conf\` where each of them reads it, and restart them:

${codeBlock(
  "ini",
  `[conductor]
workers = 1

[scheduler]
workers = 1`,
)}`,
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

OpenStack gives no overhead figure for a signed one, so none is promised here, and we have not measured one. A signed request does more work in every service it crosses, sends every span over HTTP from each of them, and carries your key across the message bus in its context. Sign what you are looking into, not traffic.

What has been counted is what a signed boot sends, on one machine's DevStack: about 100 spans and 50 KB, about 150 spans with \`trace_requests\`, and about 900 spans and 1 MB with \`trace_sqlalchemy\`, which is why that stays off until you have a database question.

With the collector stopped, a signed boot still worked, and its spans were lost: tracing did not get in the request's way.`,
  };
}

function cannotShowTopic(): SetupGuideTopic {
  return {
    title: "What a trace cannot show",
    summary: "Placement, Nova's conductor and scheduler, and cinder-volume.",
    markdown: `Each of these handles part of a signed request, and sends nothing on a stock cloud. A trace is still one trace, and its lines are still in the logs of that request, but a span they called arrives with a parent that never does, and the trace says so.

| Service | Why it sends nothing | What you can do |
| --- | --- | --- |
| Placement, every release | It keeps a config of its own, without \`[profiler_otlp]\`, so the driver stops as it starts: \`no such option profiler_otlp\` | One line, below. With \`trace_requests\` on, \`nova-compute\` shows its own calls to Placement without it |
| \`nova-conductor\`, \`nova-scheduler\`, on 2025.2 | They make the driver and then fork their workers on eventlet, and nothing a forked worker made arrived. On 2026.2 they run on threads and send spans | One worker each, below |
| \`cinder-volume\`, on 2025.2 | It always runs each backend in a forked worker | Nothing to set |
| Neutron's RPC server | It never says it started OSProfiler. Neutron's API does | Nothing to set |

On 2026.2 a trace can also hold more than its request. Nova's workers there keep a signed request's context on their threads, so a boot's trace held that instance's delete ten minutes later, and a failed boot's conductor spans arrived under the boot before it. Read a trace's times as well as its services.`,
  };
}

function placementTopic(guide: ToolGuide): SetupGuideTopic {
  return {
    title: "Placement",
    summary: "One line of its code, kept by you.",
    markdown: `Without this, a signed request still reaches Placement and works, and Placement's own part of it is not in the trace. With it, a boot crosses Placement, \`allocation_candidates\` and the instance's allocations included: this was run on 2025.2 and on 2026.2. Nothing about OpenStack needs it. It is a change to OpenStack's code on your machines, so it is yours to keep across upgrades, until a release does not need it.

${guide.placement}`,
  };
}

function oneWorkerTopic(guide: ToolGuide): SetupGuideTopic {
  return {
    title: "Nova's conductor and scheduler",
    summary: "One worker each, which costs what it costs.",
    markdown: `On 2026.2 these run on threads, and send spans as they are, so this is for 2025.2. With one worker each they run in the process that made the driver. That was run on 2025.2: with Placement's line too, a boot's trace had no span missing its parent, from \`nova-api\` through both of them to \`nova-compute\`, and a failed scheduling showed as a failed span, \`No valid host was found\`. One worker is also all the capacity each of those processes then has, so this is for a test cloud, or for a quiet hour of looking into something, and not for a busy cloud to run on.

${guide.oneWorker}`,
  };
}

function detailsTopics(guide: ToolGuide): Array<SetupGuideTopic> {
  return [
    cannotShowTopic(),
    placementTopic(guide),
    oneWorkerTopic(guide),
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
      markdown: `- \`trace_requests = True\` adds a span for each HTTP call a service makes, with how it was answered. It is the only way to see a call's own status code, and how \`nova-compute\` calls Placement without touching Placement.
- \`trace_sqlalchemy = True\` adds a span for each SQL statement. OneUptime keeps the statement, whose values are placeholders, and removes the values.`,
    },
  ];
}

function troubleshootingTopics(): Array<SetupGuideTopic> {
  return [
    {
      title: "Placement logs no such option profiler_otlp",
      summary: "That is Placement as OpenStack ships it, and it carries on.",
      markdown: `\`Could not initialize driver for connection string\`, with \`no such option profiler_otlp in group [DEFAULT]\`, means its \`[profiler]\` section is on and it does not have the line under Placement, above. Nothing else is wrong with it: it answers as before, and sends nothing. Add the line, or take the section out and the error goes.`,
    },
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
      summary: "Some send nothing as shipped, and a request only reaches some.",
      markdown: `Each service sends its own spans, so one that is not set up leaves a hole in the trace rather than breaking it. Placement is a hole on every stock cloud, and \`nova-conductor\`, \`nova-scheduler\` and \`cinder-volume\` on 2025.2: What a trace cannot show, above, says why. A request also only reaches some services: listing instances never touches \`nova-compute\`, and a boot does. For any other, check that service's log as above, once a request that uses it has been traced.`,
    },
    {
      title: "A span is missing its parent",
      summary: "It was called by something that sent nothing.",
      markdown: `That is expected on a stock 2025.2 cloud. \`nova-compute\`'s \`build_and_run_instance\` is called by \`nova-conductor\`, which sends nothing there, so it names a parent that never arrives, and everything \`nova-compute\` did for that boot is under it. Nothing is lost but the conductor's own part.`,
    },
    {
      title: "An API's spans are late",
      summary: "On 2025.2 they can wait for its next request.",
      markdown: `On 2025.2 an API's workers run on eventlet, and a batch of spans can wait until that worker's next request. On our test cloud, 15 seconds after a signed \`server list\`, \`nova-api\`'s 7 spans had not arrived, and the other 6 had. They came with the next request, so run another command if you want them sooner. On 2026.2 they all came within 15 seconds.`,
    },
    {
      title: "A service hangs, or will not answer, after a restart",
      summary: "Check which version of OpenTelemetry's SDK it has.",
      markdown: `\`pip list | grep opentelemetry-sdk\` where the service runs. Version 1.44 of it never comes back from a fork made with a \`preexec_fn\`, which is how oslo.concurrency runs every command ([its bug](https://github.com/open-telemetry/opentelemetry-python/issues/5789)), so a service hangs as soon as it runs one. Install below it, as this guide does, or take \`[profiler]\` off that service. \`py-spy dump --pid <worker>\` shows it stuck in \`TracerProvider._handle_fork\`.`,
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
      description:
        "One key, the same on every service, and one section in each service's config.",
      markdown: `${KEY_LINE}\n\n${guide.config}`,
    },
    {
      title: "Check each service started it",
      description:
        "A service only says this as it starts, once it has its libraries and its config.",
      markdown: `Each service's own log should hold this line, and no \`Could not initialize driver\`:

${codeBlock("text", `osprofiler is enabled with connection string: ${OPENSTACK_TRACES_CONNECTION_STRING}`)}`,
    },
    {
      title: "Sign a request",
      description:
        "Trace a request, on this page, has the commands for this cloud. A trace appears here once one arrives, and this page says which services have sent one.",
      markdown: `Give it a few seconds, because spans are sent in batches, and on 2025.2 an API's can wait for its next request. A signed \`server list\` crosses \`nova-api\`, \`keystone\`, \`neutron-server\` and \`glance-api\`, and a signed boot adds \`nova-compute\`, tied to the instance it made. If those are there, it works.`,
    },
  ];

  return {
    wrapLongLines: true,
    intro: `${guide.blocker ? `**${guide.blocker}**\n\n` : ""}${WHAT_THIS_IS}\n\n${NEWEST_RELEASE_WARNING}\n\n${WHAT_A_TRACE_SHOWS}\n\n**How far this guide has been tested:** ${guide.howFarTested}`,
    steps: steps,
    advanced: detailsTopics(guide),
    troubleshooting: troubleshootingTopics(),
    links: [
      {
        title: "OpenStack Agent docs",
        url: "/docs/telemetry/openstack#trace-requests-through-the-control-plane",
      },
    ],
  };
}
