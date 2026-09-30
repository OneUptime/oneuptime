import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
} from "../../Pages/Kubernetes/Utils/DocumentationMarkdown";

/*
 * The steps the "how do I connect this?" card (ResourceConnectionGuideCard)
 * shows on each resource's overview while it is not connected.
 *
 * Deliberately short: three steps to get a resource connected, three to
 * check on one that stopped reporting. The full, prefilled instructions -
 * the ingestion key picker, every install method, every option - stay on
 * the resource's Documentation tab, which the card links to. Commands and
 * setting names here are the ones those guides use.
 *
 * Ingest adopts a resource someone created by hand only when the name the
 * agent reports matches it (case-insensitively): clusterName for Kubernetes,
 * DOCKER_HOST_NAME for a Docker host, iot.fleet.name for a fleet, and so on.
 * Any other name registers a second resource and leaves this one
 * disconnected, so the setup steps spell out the exact value to use, taken
 * from the resource being viewed.
 */

export interface ResourceConnectionGuideStep {
  title: string;
  description: string;
  // One command or setting, shown in monospace with a copy button.
  code?: string | undefined;
}

export interface ResourceConnectionGuide {
  // What the resource is called in running text: "cluster", "Docker host" ...
  resourceNoun: string;
  // What sends its data: "OneUptime Kubernetes Agent" ...
  agentName: string;
  // Shown while nothing has ever arrived.
  setupSteps: Array<ResourceConnectionGuideStep>;
  // Shown once data has arrived before and then stopped.
  troubleshootingSteps: Array<ResourceConnectionGuideStep>;
}

// ---- value quoting ---------------------------------------------------------

/*
 * Characters that never need quoting in a shell word, a .env value or an
 * OTEL_RESOURCE_ATTRIBUTES value.
 */
const PLAIN_VALUE: RegExp = /^[A-Za-z0-9._\-/:@]+$/;

/*
 * A value inside a double-quoted shell word (`--set clusterName="..."`,
 * `-e DOCKER_HOST_NAME="..."`), with the characters the shell would still
 * interpret there escaped.
 */
export const quoteForShell: (value: string) => string = (
  value: string,
): string => {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
};

/*
 * A .env line for the Docker Compose based agents. A plain value is written
 * as it is, as the setup guides show it. Anything else is single-quoted,
 * which Compose takes literally (no $ interpolation) - the same rule the
 * VMware guide gives for passwords.
 */
export const formatEnvFileLine: (name: string, value: string) => string = (
  name: string,
  value: string,
): string => {
  if (PLAIN_VALUE.test(value)) {
    return `${name}=${value}`;
  }

  if (!value.includes("'")) {
    return `${name}='${value}'`;
  }

  return `${name}="${value.replace(/(["\\])/g, "\\$1")}"`;
};

/*
 * A value inside OTEL_RESOURCE_ATTRIBUTES, where "," and "=" separate the
 * pairs: the spec has values percent-encoded, and the SDKs decode them.
 */
export const encodeResourceAttributeValue: (value: string) => string = (
  value: string,
): string => {
  return Array.from(value)
    .map((character: string): string => {
      return PLAIN_VALUE.test(character)
        ? character
        : encodeURIComponent(character);
    })
    .join("");
};

// ---- shared steps ----------------------------------------------------------

const PICK_INGESTION_KEY_STEP: ResourceConnectionGuideStep = {
  title: "Pick an ingestion key",
  description:
    "Open the setup guide and choose an ingestion key, or create one there. The commands on that page are filled in with the key and your OneUptime URL.",
};

const waitForDataStep: (
  resourceNoun: string,
  check?: { description: string; code: string } | undefined,
) => ResourceConnectionGuideStep = (
  resourceNoun: string,
  check?: { description: string; code: string } | undefined,
): ResourceConnectionGuideStep => {
  return {
    title: "Wait for the first data",
    description: `Refresh this page after a few minutes — the ${resourceNoun} switches to Connected once its first data arrives.${
      check ? ` ${check.description}` : ""
    }`,
    code: check?.code,
  };
};

const KEY_OR_NETWORK_ERRORS: string =
  "A 401 means the ingestion key was deleted or changed; a connection error means it cannot reach OneUptime.";

// ---- Kubernetes ------------------------------------------------------------

export const getKubernetesClusterConnectionGuide: (
  clusterIdentifier: string,
) => ResourceConnectionGuide = (
  clusterIdentifier: string,
): ResourceConnectionGuide => {
  const podsCommand: string = `kubectl get pods -n ${KUBERNETES_AGENT_HELM_NAMESPACE}`;

  return {
    resourceNoun: "cluster",
    agentName: "OneUptime Kubernetes Agent",
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Install the agent with Helm",
        description:
          "Run the helm install command from the setup guide against this cluster. Keep clusterName exactly as below so the data lands on this cluster:",
        code: `--set clusterName=${quoteForShell(clusterIdentifier)}`,
      },
      waitForDataStep("cluster", {
        description: "If it does not, check that the agent pods are Running:",
        code: podsCommand,
      }),
    ],
    troubleshootingSteps: [
      {
        title: "Check the agent is running",
        description:
          "Every agent pod should be Running. Start with any pod that is Pending, crash-looping or missing.",
        code: podsCommand,
      },
      {
        title: "Read the agent's logs",
        description: `Look for export errors. ${KEY_OR_NETWORK_ERRORS}`,
        code: `kubectl logs -n ${KUBERNETES_AGENT_HELM_NAMESPACE} deploy/${KUBERNETES_AGENT_HELM_RELEASE} --tail=50`,
      },
      {
        title: "Reinstall if needed",
        description: `If the agent was uninstalled, or its key or cluster name changed, run the install from the setup guide again with clusterName "${clusterIdentifier}".`,
      },
    ],
  };
};

// ---- Docker and Podman hosts ----------------------------------------------

interface ContainerHostAgent {
  runtimeName: string; // "Docker"
  cli: string; // "docker"
  containerName: string; // "oneuptime-docker-agent"
  hostNameVariable: string; // "DOCKER_HOST_NAME"
}

const getContainerHostConnectionGuide: (
  agent: ContainerHostAgent,
  hostIdentifier: string,
) => ResourceConnectionGuide = (
  agent: ContainerHostAgent,
  hostIdentifier: string,
): ResourceConnectionGuide => {
  const resourceNoun: string = `${agent.runtimeName} host`;
  const psCommand: string = `${agent.cli} ps --filter name=${agent.containerName}`;

  return {
    resourceNoun: resourceNoun,
    agentName: `OneUptime ${agent.runtimeName} Agent`,
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: `Run the agent on this host`,
        description: `Run the ${agent.cli} run command from the setup guide on this host. Set ${agent.hostNameVariable} as below so the data lands on this ${resourceNoun}:`,
        code: `-e ${agent.hostNameVariable}=${quoteForShell(hostIdentifier)}`,
      },
      waitForDataStep(resourceNoun, {
        description: "If it does not, check the agent container is up:",
        code: psCommand,
      }),
    ],
    troubleshootingSteps: [
      {
        title: "Check the agent is running",
        description: `The ${agent.containerName} container should be listed and Up. If it is missing or restarting, start it again from the setup guide.`,
        code: psCommand,
      },
      {
        title: "Read the agent's logs",
        description: `Look for export errors. ${KEY_OR_NETWORK_ERRORS}`,
        code: `${agent.cli} logs ${agent.containerName} --tail 50`,
      },
      {
        title: "Check the host name",
        description: `The agent must still run with ${agent.hostNameVariable}="${hostIdentifier}". A different name sends the data to a different ${resourceNoun}.`,
      },
    ],
  };
};

export const getDockerHostConnectionGuide: (
  hostIdentifier: string,
) => ResourceConnectionGuide = (
  hostIdentifier: string,
): ResourceConnectionGuide => {
  return getContainerHostConnectionGuide(
    {
      runtimeName: "Docker",
      cli: "docker",
      containerName: "oneuptime-docker-agent",
      hostNameVariable: "DOCKER_HOST_NAME",
    },
    hostIdentifier,
  );
};

export const getPodmanHostConnectionGuide: (
  hostIdentifier: string,
) => ResourceConnectionGuide = (
  hostIdentifier: string,
): ResourceConnectionGuide => {
  return getContainerHostConnectionGuide(
    {
      runtimeName: "Podman",
      cli: "podman",
      containerName: "oneuptime-podman-agent",
      hostNameVariable: "PODMAN_HOST_NAME",
    },
    hostIdentifier,
  );
};

// ---- Compose-based agents: Docker Swarm, Proxmox, Ceph, VMware ------------

interface ComposeAgent {
  resourceNoun: string; // "cluster"
  agentName: string; // "OneUptime Proxmox Agent"
  containerName: string; // "oneuptime-proxmox-agent"
  nameVariable: string; // "PROXMOX_CLUSTER_NAME"
  // Where the install script is asked to run, e.g. "on a manager node".
  installWhere: string;
  // The agent's diagnostic script, when its guide documents one.
  troubleshootScriptUrl?: string | undefined;
}

const getComposeAgentConnectionGuide: (
  agent: ComposeAgent,
  name: string,
) => ResourceConnectionGuide = (
  agent: ComposeAgent,
  name: string,
): ResourceConnectionGuide => {
  const psCommand: string = `docker ps --filter name=${agent.containerName}`;

  return {
    resourceNoun: agent.resourceNoun,
    agentName: agent.agentName,
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Install the agent",
        description: `Run the install script from the setup guide ${agent.installWhere}. When it asks for the ${agent.resourceNoun} name, enter "${name}" — or, with Docker Compose, put this in the .env file:`,
        code: formatEnvFileLine(agent.nameVariable, name),
      },
      waitForDataStep(agent.resourceNoun, {
        description: "If it does not, check the agent container is up:",
        code: psCommand,
      }),
    ],
    troubleshootingSteps: [
      {
        title: "Check the agent is running",
        description: `The ${agent.containerName} container should be listed and Up. If it is missing or restarting, start it again with docker compose up -d.`,
        code: psCommand,
      },
      agent.troubleshootScriptUrl
        ? {
            title: "Run the diagnostic script",
            description: `It checks the whole chain — the agent, what it scrapes, the ${agent.resourceNoun} name and the ingestion key — and says what is wrong.`,
            code: `curl -sSL ${agent.troubleshootScriptUrl} -o troubleshoot.sh && bash troubleshoot.sh`,
          }
        : {
            title: "Read the agent's logs",
            description: `Look for export errors. ${KEY_OR_NETWORK_ERRORS}`,
            code: `docker logs ${agent.containerName} --tail 50`,
          },
      {
        title: `Check the ${agent.resourceNoun} name`,
        description: `${agent.nameVariable} in the agent's .env must still be "${name}". A different name sends the data to a different ${agent.resourceNoun}.`,
      },
    ],
  };
};

const troubleshootScript: (agentDirectory: string) => string = (
  agentDirectory: string,
): string => {
  return `https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/${agentDirectory}/troubleshoot.sh`;
};

export const getDockerSwarmClusterConnectionGuide: (
  clusterName: string,
) => ResourceConnectionGuide = (
  clusterName: string,
): ResourceConnectionGuide => {
  return getComposeAgentConnectionGuide(
    {
      resourceNoun: "cluster",
      agentName: "OneUptime Docker Swarm Agent",
      containerName: "oneuptime-docker-swarm-agent",
      nameVariable: "DOCKER_SWARM_CLUSTER_NAME",
      installWhere: "on a manager node of the swarm",
      troubleshootScriptUrl: troubleshootScript("DockerSwarmAgent"),
    },
    clusterName,
  );
};

export const getProxmoxClusterConnectionGuide: (
  clusterName: string,
) => ResourceConnectionGuide = (
  clusterName: string,
): ResourceConnectionGuide => {
  return getComposeAgentConnectionGuide(
    {
      resourceNoun: "cluster",
      agentName: "OneUptime Proxmox Agent",
      containerName: "oneuptime-proxmox-agent",
      nameVariable: "PROXMOX_CLUSTER_NAME",
      installWhere: "on a machine that can reach the Proxmox API",
      troubleshootScriptUrl: troubleshootScript("ProxmoxAgent"),
    },
    clusterName,
  );
};

export const getCephClusterConnectionGuide: (
  clusterName: string,
) => ResourceConnectionGuide = (
  clusterName: string,
): ResourceConnectionGuide => {
  return getComposeAgentConnectionGuide(
    {
      resourceNoun: "cluster",
      agentName: "OneUptime Ceph Agent",
      containerName: "oneuptime-ceph-agent",
      nameVariable: "CEPH_CLUSTER_NAME",
      installWhere: "on a machine that can reach the Ceph manager",
      troubleshootScriptUrl: troubleshootScript("CephAgent"),
    },
    clusterName,
  );
};

export const getVMwareVCenterConnectionGuide: (
  vcenterName: string,
) => ResourceConnectionGuide = (
  vcenterName: string,
): ResourceConnectionGuide => {
  return getComposeAgentConnectionGuide(
    {
      resourceNoun: "vCenter",
      agentName: "OneUptime VMware Agent",
      containerName: "oneuptime-vmware-agent",
      nameVariable: "VMWARE_VCENTER_NAME",
      installWhere: "on a machine that can reach vCenter",
      troubleshootScriptUrl: troubleshootScript("VMwareAgent"),
    },
    vcenterName,
  );
};

// ---- Hosts (OpenTelemetry Collector) ---------------------------------------

export const getHostConnectionGuide: (
  hostIdentifier: string,
) => ResourceConnectionGuide = (
  hostIdentifier: string,
): ResourceConnectionGuide => {
  return {
    resourceNoun: "host",
    agentName: "OpenTelemetry Collector",
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Install the collector on this machine",
        description:
          "Pick your platform in the setup guide — Docker, Linux, macOS, Windows or Kubernetes — save the collector config it gives you and start the collector.",
      },
      {
        title: "Check the machine's hostname",
        description: `OneUptime matches the data by host.name, which the collector reads from the machine's hostname. It has to be "${hostIdentifier}" (any letter case) for the data to land here. The host then switches to Connected within a few minutes.`,
        code: "hostname",
      },
    ],
    troubleshootingSteps: [
      {
        title: "Check the collector is running",
        description:
          "On Linux the collector runs as the otelcol-contrib service. With Docker, check the otel-collector container instead; for macOS and Windows, see the setup guide.",
        code: "sudo systemctl status otelcol-contrib",
      },
      {
        title: "Read the collector's logs",
        description: `Look for export errors. ${KEY_OR_NETWORK_ERRORS}`,
        code: "sudo journalctl -u otelcol-contrib -n 50",
      },
      {
        title: "Check the machine's hostname",
        description: `It must still be "${hostIdentifier}". A renamed machine reports as a new host.`,
        code: "hostname",
      },
    ],
  };
};

// ---- IoT fleets -------------------------------------------------------------

export const getIoTFleetConnectionGuide: (
  fleetName: string,
) => ResourceConnectionGuide = (fleetName: string): ResourceConnectionGuide => {
  const encoded: string = encodeResourceAttributeValue(fleetName);

  return {
    resourceNoun: "fleet",
    agentName: "OpenTelemetry exporter on your devices or gateway",
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Tag your devices with this fleet",
        description:
          "Send OTLP from the OpenTelemetry SDK, a gateway collector or MQTT, as the setup guide shows. Every device's resource attributes must name this fleet:",
        code: `OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=${encoded},service.name=iot/${encoded}`,
      },
      waitForDataStep("fleet"),
    ],
    troubleshootingSteps: [
      {
        title: "Check the exporter's logs",
        description:
          "Look in the SDK, gateway collector or MQTT client logs for export or connection errors.",
      },
      {
        title: "Check the ingestion key",
        description:
          "An HTTP 401 or 403 means the key is invalid, revoked or missing. Pick a working key in the setup guide and update the x-oneuptime-token header.",
      },
      {
        title: "Check the fleet name",
        description: `iot.fleet.name must still be "${fleetName}", set as a resource attribute. A different name sends the data to a different fleet.`,
        code: `iot.fleet.name=${encoded}`,
      },
    ],
  };
};

// ---- Cloud environments ------------------------------------------------------

export interface CloudEnvironmentScope {
  cloudPlatform?: string | undefined;
  cloudAccountId?: string | undefined;
  cloudRegion?: string | undefined;
}

export const getCloudResourceConnectionGuide: (
  scope: CloudEnvironmentScope,
) => ResourceConnectionGuide = (
  scope: CloudEnvironmentScope,
): ResourceConnectionGuide => {
  const attributes: string = [
    ["cloud.platform", scope.cloudPlatform],
    ["cloud.account.id", scope.cloudAccountId],
    ["cloud.region", scope.cloudRegion],
  ]
    .filter((pair: Array<string | undefined>): boolean => {
      return Boolean((pair[1] || "").trim());
    })
    .map((pair: Array<string | undefined>): string => {
      return `${pair[0]}=${encodeResourceAttributeValue((pair[1] || "").trim())}`;
    })
    .join(",");

  return {
    resourceNoun: "environment",
    agentName: "OpenTelemetry SDK or collector",
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Point OpenTelemetry at OneUptime",
        description:
          "Follow the setup guide for your platform: export OTLP to OneUptime with the cloud resource detector turned on. Its cloud attributes must match this environment:",
        code: attributes || undefined,
      },
      waitForDataStep("environment"),
    ],
    troubleshootingSteps: [
      {
        title: "Check the workloads are running",
        description:
          "Only running workloads send data. Make sure the services in this environment are up and still have the OpenTelemetry settings from the setup guide.",
      },
      {
        title: "Check the ingestion key",
        description:
          "The setup guide has a one-line check. A 401 means the key is unknown, revoked or mistyped; run it from inside the workload to prove it can reach OneUptime.",
      },
      {
        title: "Check the cloud attributes",
        description:
          "The data must still carry this environment's cloud attributes. A different platform, account or region lands in a different environment.",
        code: attributes || undefined,
      },
    ],
  };
};

// ---- RUM applications -------------------------------------------------------

export const getRumApplicationConnectionGuide: (
  appIdentifier: string,
) => ResourceConnectionGuide = (
  appIdentifier: string,
): ResourceConnectionGuide => {
  return {
    resourceNoun: "application",
    agentName: "OpenTelemetry browser or mobile SDK",
    setupSteps: [
      {
        title: "Create a Browser ingestion key",
        description:
          "Everything in a web page is public, so use a Browser key limited to your site's origins. The setup guide shows how, and fills the key into its snippets.",
      },
      {
        title: "Add the OpenTelemetry SDK",
        description:
          "Add the browser (or mobile) SDK from the setup guide to your app, with the browser resource detector on. Set service.name so the data lands on this application:",
        code: `service.name=${encodeResourceAttributeValue(appIdentifier)}`,
      },
      waitForDataStep("application"),
    ],
    troubleshootingSteps: [
      {
        title: "Check the app is still instrumented",
        description:
          "Data only arrives while people use the app, from a build that still includes the OpenTelemetry SDK. Check a recent deploy did not drop it.",
      },
      {
        title: "Check for export errors",
        description:
          "Open the app with the browser's developer tools and look for failed requests to /otlp. A 401 or 403 means the key is revoked, expired or not allowed from this origin.",
      },
      {
        title: "Check the service name",
        description: `service.name must still be "${appIdentifier}", with the browser.* or device.* attributes set. Otherwise the data lands somewhere else.`,
        code: `service.name=${encodeResourceAttributeValue(appIdentifier)}`,
      },
    ],
  };
};

// ---- Serverless functions ---------------------------------------------------

export const getServerlessFunctionConnectionGuide: (
  functionIdentifier: string,
) => ResourceConnectionGuide = (
  functionIdentifier: string,
): ResourceConnectionGuide => {
  const attributes: string = `OTEL_RESOURCE_ATTRIBUTES=${quoteForShell(
    `faas.name=${encodeResourceAttributeValue(functionIdentifier)}`,
  )}`;

  return {
    resourceNoun: "function",
    agentName: "OpenTelemetry SDK",
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Instrument the function",
        description:
          "Add the OpenTelemetry SDK for its runtime and set the environment variables from the setup guide. faas.name must match this function:",
        code: attributes,
      },
      {
        title: "Deploy and invoke it",
        description:
          "Data is sent when the function runs. Invoke it once, then refresh this page after a few minutes — it switches to Connected once the first data arrives.",
      },
    ],
    troubleshootingSteps: [
      {
        title: "Check it is being invoked",
        description:
          "A function only sends data while it runs. If nothing has called it lately, this is expected.",
      },
      {
        title: "Check the function's logs",
        description: `Look for OpenTelemetry export errors. ${KEY_OR_NETWORK_ERRORS}`,
      },
      {
        title: "Check faas.name",
        description: `It must still be "${functionIdentifier}". A different name sends the data to a different function.`,
        code: attributes,
      },
    ],
  };
};
