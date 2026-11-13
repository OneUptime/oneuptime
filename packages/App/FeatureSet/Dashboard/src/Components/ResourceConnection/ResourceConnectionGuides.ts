import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
} from "../../Pages/Kubernetes/Utils/DocumentationMarkdown";
import { PROXMOX_FAILOVER_CONTAINER } from "../../Pages/Proxmox/Utils/DocumentationMarkdown";
import { getServerlessPlatformForCloudPlatform } from "../Serverless/ServerlessSetupGuide";
import {
  HostCollectorOsType,
  getHostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import {
  HostCollectorServiceCommands,
  getHostCollectorServiceCommands,
} from "Common/Utils/HostCollector/HostCollectorInstallCommand";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  InstallScriptName,
  TROUBLESHOOT_SCRIPT_FILE,
  getInstallFileUrl,
} from "Common/Types/InstallScripts/InstallScripts";
import { shellQuote } from "../SetupGuide/SetupGuide";

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
 *
 * Fixed titles and descriptions are English translation keys the card
 * translates where it draws them; a sentence with a value in it is filled
 * here, in the reader's language, from a whole-sentence template. What is
 * said about the resource itself ("Connect this cluster", "the cluster
 * switches to Connected") is a whole sentence for each kind of resource,
 * never one with the resource's noun put in (see the guide's setupCopy).
 */

export interface ResourceConnectionGuideStep {
  title: string;
  description: string;
  // One command or setting, shown in monospace with a copy button.
  code?: string | undefined;
}

// A title and the sentence under it: English translation keys.
export interface ResourceConnectionCopy {
  title: string;
  description: string;
}

export interface ResourceConnectionGuide {
  // What sends its data: "OneUptime Kubernetes Agent" ...
  agentName: string;
  /*
   * What the card says while nothing has ever arrived - "Connect this
   * cluster", and why it reads Disconnected - and once data has stopped -
   * "This cluster stopped sending data", and when OneUptime last heard
   * from it. {{agentName}} is agentName; {{lastHeard}} is when data last
   * arrived ("3 hours ago").
   *
   * Whole sentences, a set for each kind of resource, never one with the
   * resource's noun put in ("Connect this {{resourceNoun}}"). In most of
   * the Dashboard's languages "this" and "a different" take the noun's
   * gender and case - "dieser Cluster", "diese Cloud", "von diesem
   * Speicher-Array"; "ce cluster", "cette flotte", "cet hôte" - and
   * Swedish and Norwegian put the noun itself in its definite form ("det
   * här klustret"), so no one wording of "this {{resourceNoun}}" fits every
   * noun, and those languages had kept such sentences in English (issue
   * #6308). Each language words each kind's sentences for its own noun.
   */
  setupCopy: ResourceConnectionCopy;
  stoppedCopy: ResourceConnectionCopy;
  // Shown while nothing has ever arrived.
  setupSteps: Array<ResourceConnectionGuideStep>;
  // Shown once data has arrived before and then stopped.
  troubleshootingSteps: Array<ResourceConnectionGuideStep>;
  /*
   * For an agent that reads its resource from an API - a Proxmox cluster,
   * read from the Proxmox VE API (issue #7439). While the agent is running
   * (agentLastSeenAt is recent) but the resource is not read, the agent is
   * not the problem, so the card says so instead of "stopped sending data":
   * `stopped` once the resource was read before ({{lastRead}} is when it
   * last was), `notYet` while it never has been; both with `steps`, the
   * checks of the API. Whole sentences, English translation keys;
   * {{agentName}} is agentName. A guide without it reads such a resource as
   * Disconnected or never connected, as before.
   */
  unreadableCopy?:
    | {
        stopped: ResourceConnectionCopy;
        notYet: ResourceConnectionCopy;
        steps: Array<ResourceConnectionGuideStep>;
      }
    | undefined;
  /*
   * For a resource OneUptime installed the agent of (a host added with the
   * one command): there is nothing to set up before its first data, so the
   * card says what is happening instead of "Connect this" - the resource is
   * starting (no steps), or its data is late (setupSteps check on it).
   * English translation keys.
   */
  startingCopy?:
    | {
        title: string;
        description: string;
      }
    | undefined;
  /*
   * For a resource that sends data only while it is used - a RUM
   * application, whose data comes from its visitors' browsers and phones,
   * and a serverless function, which sends data only while it runs. A
   * stretch with nothing arriving is then the resource being idle, not
   * broken, and its pill says "No recent traffic" or "No recent
   * invocations" rather than "Disconnected" (issues #6191, #6269). The
   * card says so too: in grey, with when data last arrived, and with the
   * troubleshooting steps folded behind `checksLabel` for when it should
   * be busy. Before its first data the card asks for the setup with
   * `waitingDescription`, which does not call it "Disconnected" (its pill
   * says "Waiting for data"). English translation keys; {{lastHeard}} in
   * the description is when data last arrived ("3 hours ago"). Whole
   * sentences about the resource, with no noun put in: a language words
   * "this application" its own way. The card says these in place of
   * setupCopy's description and stoppedCopy, which such a guide gives the
   * same keys.
   */
  idleCopy?:
    | {
        title: string;
        description: string;
        checksLabel: string;
        waitingDescription: string;
      }
    | undefined;
  // What the card's link says: "Open the setup guide" when left out.
  linkText?: string | undefined;
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

/*
 * The last setup step. Its description is one key for each kind of
 * resource, with what to check if nothing comes, ending in a colon when the
 * step's command is that check: "Refresh this page after a few minutes —
 * the cluster switches to Connected once its first data arrives. If it does
 * not, check that the agent pods are Running:". One key, not two sentences
 * joined with a space, which Japanese and Chinese do not put between theirs.
 */
const waitForDataStep: (
  description: string,
  code?: string | undefined,
) => ResourceConnectionGuideStep = (
  description: string,
  code?: string | undefined,
): ResourceConnectionGuideStep => {
  return {
    title: "Wait for the first data",
    description: description,
    code: code,
  };
};

// Reading an agent's logs: what its export errors mean.
const EXPORT_ERRORS_DESCRIPTION: string = translationKey(
  "Look for export errors. A 401 means the ingestion key was deleted or changed; a connection error means it cannot reach OneUptime.",
);

// ---- what the card says about each kind of resource -------------------------

// The card's sentences about one kind of resource (the guide's setupCopy).
interface ResourceKindCopy {
  setupCopy: ResourceConnectionCopy;
  stoppedCopy: ResourceConnectionCopy;
}

// A Kubernetes, Docker Swarm, Proxmox or Ceph cluster.
const CLUSTER_COPY: ResourceKindCopy = {
  setupCopy: {
    title: translationKey("Connect this cluster"),
    description: translationKey(
      "No data has arrived from this cluster yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
    ),
  },
  stoppedCopy: {
    title: translationKey("This cluster stopped sending data"),
    description: translationKey(
      "OneUptime last heard from this cluster {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
    ),
  },
};

const DOCKER_HOST_COPY: ResourceKindCopy = {
  setupCopy: {
    title: translationKey("Connect this Docker host"),
    description: translationKey(
      "No data has arrived from this Docker host yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
    ),
  },
  stoppedCopy: {
    title: translationKey("This Docker host stopped sending data"),
    description: translationKey(
      "OneUptime last heard from this Docker host {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
    ),
  },
};

const PODMAN_HOST_COPY: ResourceKindCopy = {
  setupCopy: {
    title: translationKey("Connect this Podman host"),
    description: translationKey(
      "No data has arrived from this Podman host yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
    ),
  },
  stoppedCopy: {
    title: translationKey("This Podman host stopped sending data"),
    description: translationKey(
      "OneUptime last heard from this Podman host {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
    ),
  },
};

// An OpenStack cloud.
const CLOUD_COPY: ResourceKindCopy = {
  setupCopy: {
    title: translationKey("Connect this cloud"),
    description: translationKey(
      "No data has arrived from this cloud yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
    ),
  },
  stoppedCopy: {
    title: translationKey("This cloud stopped sending data"),
    description: translationKey(
      "OneUptime last heard from this cloud {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
    ),
  },
};

const STORAGE_ARRAY_COPY: ResourceKindCopy = {
  setupCopy: {
    title: translationKey("Connect this storage array"),
    description: translationKey(
      "No data has arrived from this storage array yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
    ),
  },
  stoppedCopy: {
    title: translationKey("This storage array stopped sending data"),
    description: translationKey(
      "OneUptime last heard from this storage array {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
    ),
  },
};

const VCENTER_COPY: ResourceKindCopy = {
  setupCopy: {
    title: translationKey("Connect this vCenter"),
    description: translationKey(
      "No data has arrived from this vCenter yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
    ),
  },
  stoppedCopy: {
    title: translationKey("This vCenter stopped sending data"),
    description: translationKey(
      "OneUptime last heard from this vCenter {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
    ),
  },
};

// A host with an OpenTelemetry Collector, or the collector OneUptime installed.
const HOST_COPY: ResourceKindCopy = {
  setupCopy: {
    title: translationKey("Connect this host"),
    description: translationKey(
      "No data has arrived from this host yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
    ),
  },
  stoppedCopy: {
    title: translationKey("This host stopped sending data"),
    description: translationKey(
      "OneUptime last heard from this host {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
    ),
  },
};

// An IoT fleet.
const FLEET_COPY: ResourceKindCopy = {
  setupCopy: {
    title: translationKey("Connect this fleet"),
    description: translationKey(
      "No data has arrived from this fleet yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
    ),
  },
  stoppedCopy: {
    title: translationKey("This fleet stopped sending data"),
    description: translationKey(
      "OneUptime last heard from this fleet {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
    ),
  },
};

// A cloud environment (an app platform's cluster, account and region).
const ENVIRONMENT_COPY: ResourceKindCopy = {
  setupCopy: {
    title: translationKey("Connect this environment"),
    description: translationKey(
      "No data has arrived from this environment yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
    ),
  },
  stoppedCopy: {
    title: translationKey("This environment stopped sending data"),
    description: translationKey(
      "OneUptime last heard from this environment {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
    ),
  },
};

// ---- Kubernetes ------------------------------------------------------------

export const getKubernetesClusterConnectionGuide: (
  clusterIdentifier: string,
) => ResourceConnectionGuide = (
  clusterIdentifier: string,
): ResourceConnectionGuide => {
  const podsCommand: string = `kubectl get pods -n ${KUBERNETES_AGENT_HELM_NAMESPACE}`;

  return {
    ...CLUSTER_COPY,
    agentName: "OneUptime Kubernetes Agent",
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Install the agent with Helm",
        description:
          "Run the helm install command from the setup guide against this cluster. Keep clusterName exactly as below so the data lands on this cluster:",
        code: `--set clusterName=${quoteForShell(clusterIdentifier)}`,
      },
      waitForDataStep(
        translationKey(
          "Refresh this page after a few minutes — the cluster switches to Connected once its first data arrives. If it does not, check that the agent pods are Running:",
        ),
        podsCommand,
      ),
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
        description: EXPORT_ERRORS_DESCRIPTION,
        code: `kubectl logs -n ${KUBERNETES_AGENT_HELM_NAMESPACE} deploy/${KUBERNETES_AGENT_HELM_RELEASE} --tail=50`,
      },
      {
        title: "Reinstall if needed",
        description: translateTemplate(
          'If the agent was uninstalled, or its key or cluster name changed, run the install from the setup guide again with clusterName "{{clusterName}}".',
          { clusterName: clusterIdentifier },
        ),
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
  // What the card says about this kind of host.
  copy: ResourceKindCopy;
  /*
   * The steps' sentences about this kind of host, whole: the install step
   * ("... so the data lands on this Docker host:", with {{cli}} and
   * {{variable}}), the wait step, and the host name check ({{variable}}
   * and {{hostName}}).
   */
  installDescription: string;
  waitDescription: string;
  hostNameDescription: string;
}

const getContainerHostConnectionGuide: (
  agent: ContainerHostAgent,
  hostIdentifier: string,
) => ResourceConnectionGuide = (
  agent: ContainerHostAgent,
  hostIdentifier: string,
): ResourceConnectionGuide => {
  const psCommand: string = `${agent.cli} ps --filter name=${agent.containerName}`;

  return {
    ...agent.copy,
    agentName: `OneUptime ${agent.runtimeName} Agent`,
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: `Run the agent on this host`,
        description: translateTemplate(agent.installDescription, {
          cli: agent.cli,
          variable: agent.hostNameVariable,
        }),
        code: `-e ${agent.hostNameVariable}=${quoteForShell(hostIdentifier)}`,
      },
      waitForDataStep(agent.waitDescription, psCommand),
    ],
    troubleshootingSteps: [
      {
        title: "Check the agent is running",
        description: translateTemplate(
          "The {{containerName}} container should be listed and Up. If it is missing or restarting, start it again from the setup guide.",
          { containerName: agent.containerName },
        ),
        code: psCommand,
      },
      {
        title: "Read the agent's logs",
        description: EXPORT_ERRORS_DESCRIPTION,
        code: `${agent.cli} logs ${agent.containerName} --tail 50`,
      },
      {
        title: "Check the host name",
        description: translateTemplate(agent.hostNameDescription, {
          variable: agent.hostNameVariable,
          hostName: hostIdentifier,
        }),
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
      copy: DOCKER_HOST_COPY,
      installDescription: translationKey(
        "Run the {{cli}} run command from the setup guide on this host. Set {{variable}} as below so the data lands on this Docker host:",
      ),
      waitDescription: translationKey(
        "Refresh this page after a few minutes — the Docker host switches to Connected once its first data arrives. If it does not, check the agent container is up:",
      ),
      hostNameDescription: translationKey(
        'The agent must still run with {{variable}}="{{hostName}}". A different name sends the data to a different Docker host.',
      ),
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
      copy: PODMAN_HOST_COPY,
      installDescription: translationKey(
        "Run the {{cli}} run command from the setup guide on this host. Set {{variable}} as below so the data lands on this Podman host:",
      ),
      waitDescription: translationKey(
        "Refresh this page after a few minutes — the Podman host switches to Connected once its first data arrives. If it does not, check the agent container is up:",
      ),
      hostNameDescription: translationKey(
        'The agent must still run with {{variable}}="{{hostName}}". A different name sends the data to a different Podman host.',
      ),
    },
    hostIdentifier,
  );
};

// ---- Compose-based agents: Swarm, Proxmox, Ceph, VMware, storage arrays ----

/*
 * What a Compose-based agent's card and steps say about the kind of
 * resource it reports - a cluster, a cloud, a storage array, a vCenter -
 * each a whole sentence (see the guide's setupCopy).
 */
interface ComposeResourceSentences {
  copy: ResourceKindCopy;
  // The wait step, ending with the check of the agent's container.
  waitDescription: string;
  // What the diagnostic script checks: "... the cluster name and the ingestion key ...".
  diagnosticDescription: string;
  // "Check the cluster name"
  nameTitle: string;
  // Its sentence, with the agent's {{variable}} and the resource's {{name}}.
  nameDescription: string;
}

const COMPOSE_CLUSTER_SENTENCES: ComposeResourceSentences = {
  copy: CLUSTER_COPY,
  waitDescription: translationKey(
    "Refresh this page after a few minutes — the cluster switches to Connected once its first data arrives. If it does not, check the agent container is up:",
  ),
  diagnosticDescription: translationKey(
    "It checks the whole chain — the agent, what it scrapes, the cluster name and the ingestion key — and says what is wrong.",
  ),
  nameTitle: translationKey("Check the cluster name"),
  nameDescription: translationKey(
    '{{variable}} in the agent\'s .env must still be "{{name}}". A different name sends the data to a different cluster.',
  ),
};

const OPENSTACK_CLOUD_SENTENCES: ComposeResourceSentences = {
  copy: CLOUD_COPY,
  waitDescription: translationKey(
    "Refresh this page after a few minutes — the cloud switches to Connected once its first data arrives. If it does not, check the agent container is up:",
  ),
  diagnosticDescription: translationKey(
    "It checks the whole chain — the agent, what it scrapes, the cloud name and the ingestion key — and says what is wrong.",
  ),
  nameTitle: translationKey("Check the cloud name"),
  nameDescription: translationKey(
    '{{variable}} in the agent\'s .env must still be "{{name}}". A different name sends the data to a different cloud.',
  ),
};

const STORAGE_ARRAY_SENTENCES: ComposeResourceSentences = {
  copy: STORAGE_ARRAY_COPY,
  waitDescription: translationKey(
    "Refresh this page after a few minutes — the storage array switches to Connected once its first data arrives. If it does not, check the agent container is up:",
  ),
  diagnosticDescription: translationKey(
    "It checks the whole chain — the agent, what it scrapes, the storage array name and the ingestion key — and says what is wrong.",
  ),
  nameTitle: translationKey("Check the storage array name"),
  nameDescription: translationKey(
    '{{variable}} in the agent\'s .env must still be "{{name}}". A different name sends the data to a different storage array.',
  ),
};

const VCENTER_SENTENCES: ComposeResourceSentences = {
  copy: VCENTER_COPY,
  waitDescription: translationKey(
    "Refresh this page after a few minutes — the vCenter switches to Connected once its first data arrives. If it does not, check the agent container is up:",
  ),
  diagnosticDescription: translationKey(
    "It checks the whole chain — the agent, what it scrapes, the vCenter name and the ingestion key — and says what is wrong.",
  ),
  nameTitle: translationKey("Check the vCenter name"),
  nameDescription: translationKey(
    '{{variable}} in the agent\'s .env must still be "{{name}}". A different name sends the data to a different vCenter.',
  ),
};

interface ComposeAgent {
  sentences: ComposeResourceSentences;
  agentName: string; // "OneUptime Proxmox Agent"
  containerName: string; // "oneuptime-proxmox-agent"
  nameVariable: string; // "PROXMOX_CLUSTER_NAME"
  /*
   * The install step as one sentence, which says where the install script is
   * asked to run ("on a manager node") and what it asks for, with the name
   * as {{name}}.
   */
  installDescription: string;
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
    ...agent.sentences.copy,
    agentName: agent.agentName,
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Install the agent",
        description: translateTemplate(agent.installDescription, {
          name: name,
        }),
        code: formatEnvFileLine(agent.nameVariable, name),
      },
      waitForDataStep(agent.sentences.waitDescription, psCommand),
    ],
    troubleshootingSteps: [
      {
        title: "Check the agent is running",
        description: translateTemplate(
          "The {{containerName}} container should be listed and Up. If it is missing or restarting, start it again with docker compose up -d.",
          { containerName: agent.containerName },
        ),
        code: psCommand,
      },
      agent.troubleshootScriptUrl
        ? {
            title: "Run the diagnostic script",
            description: agent.sentences.diagnosticDescription,
            // Quoted when it needs to be: a placeholder address is no redirection.
            code: `curl -fsSL ${shellQuote(agent.troubleshootScriptUrl)} -o troubleshoot.sh && bash troubleshoot.sh`,
          }
        : {
            title: "Read the agent's logs",
            description: EXPORT_ERRORS_DESCRIPTION,
            code: `docker logs ${agent.containerName} --tail 50`,
          },
      {
        title: agent.sentences.nameTitle,
        description: translateTemplate(agent.sentences.nameDescription, {
          variable: agent.nameVariable,
          name: name,
        }),
      },
    ],
  };
};

/*
 * The agent's diagnostic script on the reader's own OneUptime, which serves
 * the agents' files for its own release (Common/Types/InstallScripts).
 */
const troubleshootScript: (
  oneuptimeUrl: string,
  name: InstallScriptName,
) => string = (oneuptimeUrl: string, name: InstallScriptName): string => {
  return getInstallFileUrl(oneuptimeUrl, name, TROUBLESHOOT_SCRIPT_FILE);
};

export const getDockerSwarmClusterConnectionGuide: (
  clusterName: string,
  oneuptimeUrl: string,
) => ResourceConnectionGuide = (
  clusterName: string,
  oneuptimeUrl: string,
): ResourceConnectionGuide => {
  return getComposeAgentConnectionGuide(
    {
      sentences: COMPOSE_CLUSTER_SENTENCES,
      agentName: "OneUptime Docker Swarm Agent",
      containerName: "oneuptime-docker-swarm-agent",
      nameVariable: "DOCKER_SWARM_CLUSTER_NAME",
      installDescription: translationKey(
        'Run the install script from the setup guide on a manager node of the swarm. When it asks for the cluster name, enter "{{name}}" — or, with Docker Compose, put this in the .env file:',
      ),
      troubleshootScriptUrl: troubleshootScript(
        oneuptimeUrl,
        InstallScriptName.DockerSwarmAgent,
      ),
    },
    clusterName,
  );
};

/*
 * What the Proxmox cluster's card says while its agent runs but cannot read
 * the Proxmox VE API (ResourceConnectionGuide.unreadableCopy): the node it
 * reads went down on agent files from before 0.161.2, no node answers, or
 * the token was revoked. The agent's own scrape metrics keep arriving, so
 * "stopped sending data" would send people to a container that is fine.
 */
const PROXMOX_UNREADABLE_STOPPED_COPY: ResourceConnectionCopy = {
  title: translationKey("The agent can't read the Proxmox VE API"),
  description: translationKey(
    "The {{agentName}} is running, but it last read the cluster from the Proxmox VE API {{lastRead}}. The nodes, guests and storage here are as it read them then.",
  ),
};

const PROXMOX_UNREADABLE_NOT_YET_COPY: ResourceConnectionCopy = {
  title: translationKey("The agent has not read the cluster yet"),
  description: translationKey(
    "The {{agentName}} is running and reads the cluster from the Proxmox VE API every 30 seconds, but no read has arrived yet. If this does not change within a few minutes, check the API with the steps below.",
  ),
};

const getProxmoxUnreadableSteps: (
  oneuptimeUrl: string,
) => Array<ResourceConnectionGuideStep> = (
  oneuptimeUrl: string,
): Array<ResourceConnectionGuideStep> => {
  return [
    {
      title: "Run the diagnostic script",
      description:
        "It checks the API token and every node in PVE_HOST and PVE_NODES from the agent's machine, and says what is wrong.",
      code: `curl -fsSL ${shellQuote(troubleshootScript(oneuptimeUrl, InstallScriptName.ProxmoxAgent))} -o troubleshoot.sh && bash troubleshoot.sh`,
    },
    {
      title: "Check the API token",
      description:
        "PVE_API_TOKEN_ID and PVE_API_TOKEN_SECRET in the agent's .env must name a token that still exists, with the PVEAuditor role on / for the token and its user.",
    },
    {
      title: "Check that a node answers",
      description:
        "The agent reads the cluster from PVE_HOST, or from the next node in PVE_NODES whose API answers on port 8006. Its logs say which node it reads, and why it passed over the others:",
      // The container that says which node the agent reads the cluster from.
      code: `docker logs ${PROXMOX_FAILOVER_CONTAINER} --tail 20`,
    },
  ];
};

export const getProxmoxClusterConnectionGuide: (
  clusterName: string,
  oneuptimeUrl: string,
) => ResourceConnectionGuide = (
  clusterName: string,
  oneuptimeUrl: string,
): ResourceConnectionGuide => {
  return {
    ...getComposeAgentConnectionGuide(
      {
        sentences: COMPOSE_CLUSTER_SENTENCES,
        agentName: "OneUptime Proxmox Agent",
        containerName: "oneuptime-proxmox-agent",
        nameVariable: "PROXMOX_CLUSTER_NAME",
        installDescription: translationKey(
          'Run the install script from the setup guide on a machine that can reach the Proxmox API. When it asks for the cluster name, enter "{{name}}" — or, with Docker Compose, put this in the .env file:',
        ),
        troubleshootScriptUrl: troubleshootScript(
          oneuptimeUrl,
          InstallScriptName.ProxmoxAgent,
        ),
      },
      clusterName,
    ),
    unreadableCopy: {
      stopped: PROXMOX_UNREADABLE_STOPPED_COPY,
      notYet: PROXMOX_UNREADABLE_NOT_YET_COPY,
      steps: getProxmoxUnreadableSteps(oneuptimeUrl),
    },
  };
};

export const getOpenStackCloudConnectionGuide: (
  cloudName: string,
  oneuptimeUrl: string,
) => ResourceConnectionGuide = (
  cloudName: string,
  oneuptimeUrl: string,
): ResourceConnectionGuide => {
  return getComposeAgentConnectionGuide(
    {
      sentences: OPENSTACK_CLOUD_SENTENCES,
      agentName: "OneUptime OpenStack Agent",
      containerName: "oneuptime-openstack-agent",
      nameVariable: "OPENSTACK_CLOUD_NAME",
      installDescription: translationKey(
        'Run the install script from the setup guide on a machine that can reach the OpenStack APIs. When it asks for the cloud name, enter "{{name}}" — or, with Docker Compose, put this in the .env file:',
      ),
      troubleshootScriptUrl: troubleshootScript(
        oneuptimeUrl,
        InstallScriptName.OpenStackAgent,
      ),
    },
    cloudName,
  );
};

export const getCephClusterConnectionGuide: (
  clusterName: string,
  oneuptimeUrl: string,
) => ResourceConnectionGuide = (
  clusterName: string,
  oneuptimeUrl: string,
): ResourceConnectionGuide => {
  return getComposeAgentConnectionGuide(
    {
      sentences: COMPOSE_CLUSTER_SENTENCES,
      agentName: "OneUptime Ceph Agent",
      containerName: "oneuptime-ceph-agent",
      nameVariable: "CEPH_CLUSTER_NAME",
      installDescription: translationKey(
        'Run the install script from the setup guide on a machine that can reach the Ceph manager. When it asks for the cluster name, enter "{{name}}" — or, with Docker Compose, put this in the .env file:',
      ),
      troubleshootScriptUrl: troubleshootScript(
        oneuptimeUrl,
        InstallScriptName.CephAgent,
      ),
    },
    clusterName,
  );
};

export const getStorageArrayConnectionGuide: (
  arrayName: string,
  oneuptimeUrl: string,
) => ResourceConnectionGuide = (
  arrayName: string,
  oneuptimeUrl: string,
): ResourceConnectionGuide => {
  return getComposeAgentConnectionGuide(
    {
      sentences: STORAGE_ARRAY_SENTENCES,
      agentName: "OneUptime Storage Array Agent",
      containerName: "oneuptime-storage-array-agent",
      nameVariable: "STORAGE_ARRAY_NAME",
      installDescription: translationKey(
        'Run the install script from the setup guide on a machine that can reach the array\'s management address. When it asks for the storage array name, enter "{{name}}" — or, with Docker Compose, put this in the .env file:',
      ),
      troubleshootScriptUrl: troubleshootScript(
        oneuptimeUrl,
        InstallScriptName.StorageArrayAgent,
      ),
    },
    arrayName,
  );
};

export const getVMwareVCenterConnectionGuide: (
  vcenterName: string,
  oneuptimeUrl: string,
) => ResourceConnectionGuide = (
  vcenterName: string,
  oneuptimeUrl: string,
): ResourceConnectionGuide => {
  return getComposeAgentConnectionGuide(
    {
      sentences: VCENTER_SENTENCES,
      agentName: "OneUptime VMware Agent",
      containerName: "oneuptime-vmware-agent",
      nameVariable: "VMWARE_VCENTER_NAME",
      installDescription: translationKey(
        'Run the install script from the setup guide on a machine that can reach vCenter. When it asks for the vCenter name, enter "{{name}}" — or, with Docker Compose, put this in the .env file:',
      ),
      troubleshootScriptUrl: troubleshootScript(
        oneuptimeUrl,
        InstallScriptName.VMwareAgent,
      ),
    },
    vcenterName,
  );
};

// ---- Hosts (OpenTelemetry Collector) ---------------------------------------

/*
 * The host's collector, when OneUptime installed it (Add Host): it runs as
 * the service oneuptime-collector, and the host's Collector page says which
 * config it runs and whether that config started.
 */
export interface HostConnectionGuideCollector {
  isManaged: boolean;
  osType?: string | null | undefined;
  // When the collector last registered (installed, or installed again).
  registeredAt?: Date | string | null | undefined;
  // Now, for tests.
  now?: Date | undefined;
}

/*
 * How long a host OneUptime installed the collector on may take to send its
 * first metrics before its overview stops saying it is starting and shows
 * how to check on it. The collector reports within a minute.
 */
export const HOST_COLLECTOR_FIRST_DATA_GRACE_MS: number = 10 * 60 * 1000;

export function isHostCollectorStillStarting(data: {
  registeredAt?: Date | string | null | undefined;
  now?: Date | undefined;
}): boolean {
  if (!data.registeredAt) {
    return true;
  }

  const registeredAt: number = new Date(data.registeredAt).getTime();

  if (isNaN(registeredAt)) {
    return true;
  }

  return (
    (data.now || new Date()).getTime() - registeredAt <
    HOST_COLLECTOR_FIRST_DATA_GRACE_MS
  );
}

const getManagedHostConnectionGuide: (
  collector: HostConnectionGuideCollector,
) => ResourceConnectionGuide = (
  collector: HostConnectionGuideCollector,
): ResourceConnectionGuide => {
  const osType: string | null | undefined = collector.osType;
  const commands: HostCollectorServiceCommands =
    getHostCollectorServiceCommands(
      getHostCollectorOsType(osType) || HostCollectorOsType.Linux,
    );

  const checkServiceStep: ResourceConnectionGuideStep = {
    title: "Check the collector's service",
    description:
      "OneUptime installed the collector on this host as the service oneuptime-collector.",
    code: commands.status,
  };

  const readLogStep: ResourceConnectionGuideStep = {
    title: "Read the collector's log",
    description: EXPORT_ERRORS_DESCRIPTION,
    code: commands.logs,
  };

  /*
   * Just installed: the card only says the host is starting - checks on a
   * host that is fine would read as something being wrong. Once its first
   * data is late, the card says so and shows them.
   */
  const isStarting: boolean = isHostCollectorStillStarting(collector);

  return {
    ...HOST_COPY,
    agentName: translationKey("OneUptime collector"),
    startingCopy: isStarting
      ? {
          title: translationKey("This host is starting"),
          description: translationKey(
            "OneUptime installed the collector on this host and sent it its config. Its first metrics and logs arrive within a minute.",
          ),
        }
      : {
          title: translationKey("No data from this host yet"),
          description: translationKey(
            "OneUptime installed the collector on this host, but its first metrics and logs have not arrived. Check on it with the steps below.",
          ),
        },
    linkText: translationKey("Open the Collector page"),
    setupSteps: isStarting
      ? []
      : [
          {
            title: "Check the collector's config",
            description:
              "The Collector page says which config the host runs and whether it started there.",
          },
          checkServiceStep,
          readLogStep,
        ],
    troubleshootingSteps: [
      checkServiceStep,
      readLogStep,
      {
        title: "Check the collector's config",
        description:
          "The Collector page says whether the config OneUptime sent started, and why not.",
      },
    ],
  };
};

export const getHostConnectionGuide: (
  hostIdentifier: string,
  collector?: HostConnectionGuideCollector | undefined,
) => ResourceConnectionGuide = (
  hostIdentifier: string,
  collector?: HostConnectionGuideCollector | undefined,
): ResourceConnectionGuide => {
  if (collector?.isManaged) {
    return getManagedHostConnectionGuide(collector);
  }

  return {
    ...HOST_COPY,
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
        description: translateTemplate(
          'OneUptime matches the data by host.name, which the collector reads from the machine\'s hostname. It has to be "{{hostName}}" (any letter case) for the data to land here. The host then switches to Connected within a few minutes.',
          { hostName: hostIdentifier },
        ),
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
        description: EXPORT_ERRORS_DESCRIPTION,
        code: "sudo journalctl -u otelcol-contrib -n 50",
      },
      {
        title: "Check the machine's hostname",
        description: translateTemplate(
          'It must still be "{{hostName}}". A renamed machine reports as a new host.',
          { hostName: hostIdentifier },
        ),
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
    ...FLEET_COPY,
    agentName: translationKey(
      "OpenTelemetry exporter on your devices or gateway",
    ),
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Tag your devices with this fleet",
        description:
          "Send OTLP from the OpenTelemetry SDK, a gateway collector or MQTT, as the setup guide shows. Every device's resource attributes must name this fleet:",
        code: `OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=${encoded},service.name=iot/${encoded}`,
      },
      waitForDataStep(
        translationKey(
          "Refresh this page after a few minutes — the fleet switches to Connected once its first data arrives.",
        ),
      ),
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
        description: translateTemplate(
          'iot.fleet.name must still be "{{fleetName}}", set as a resource attribute. A different name sends the data to a different fleet.',
          { fleetName: fleetName },
        ),
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
    ...ENVIRONMENT_COPY,
    agentName: translationKey("OpenTelemetry SDK or collector"),
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Point OpenTelemetry at OneUptime",
        description:
          "Follow the setup guide for your platform: export OTLP to OneUptime with the cloud resource detector turned on. Its cloud attributes must match this environment:",
        code: attributes || undefined,
      },
      waitForDataStep(
        translationKey(
          "Refresh this page after a few minutes — the environment switches to Connected once its first data arrives.",
        ),
      ),
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

/*
 * A RUM application's data comes from the people using the app, so fifteen
 * minutes with nothing is usually nobody using it (RumApplicationStatus,
 * issue #6191): the card says that, calmly, and keeps the checks for when
 * people are using it one click away.
 */
export const RUM_APPLICATION_IDLE_COPY: NonNullable<
  ResourceConnectionGuide["idleCopy"]
> = {
  title: translationKey("No traffic in the last 15 minutes"),
  description: translationKey(
    "OneUptime last heard from this application {{lastHeard}}. It sends data only while people use it, so this is normal when nobody is, such as overnight.",
  ),
  checksLabel: translationKey("What to check if people are using it"),
  waitingDescription: translationKey(
    "No data has arrived from this application yet. Set up the OpenTelemetry browser or mobile SDK — it takes a few minutes.",
  ),
};

export const getRumApplicationConnectionGuide: (
  appIdentifier: string,
) => ResourceConnectionGuide = (
  appIdentifier: string,
): ResourceConnectionGuide => {
  return {
    setupCopy: {
      title: translationKey("Connect this application"),
      description: RUM_APPLICATION_IDLE_COPY.waitingDescription,
    },
    stoppedCopy: {
      title: RUM_APPLICATION_IDLE_COPY.title,
      description: RUM_APPLICATION_IDLE_COPY.description,
    },
    agentName: translationKey("OpenTelemetry browser or mobile SDK"),
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
      /*
       * Its data comes from a visit, so the step asks for one, and names
       * the status the application's pill will switch to.
       */
      {
        title: "Wait for the first data",
        description:
          "Open your app so it sends its first data, then refresh this page. The application switches to Receiving data.",
      },
    ],
    idleCopy: RUM_APPLICATION_IDLE_COPY,
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
        description: translateTemplate(
          'service.name must still be "{{serviceName}}", with the browser.* or device.* attributes set. Otherwise the data lands somewhere else.',
          { serviceName: appIdentifier },
        ),
        code: `service.name=${encodeResourceAttributeValue(appIdentifier)}`,
      },
    ],
  };
};

// ---- Serverless functions ---------------------------------------------------

/*
 * A function sends data only while it runs, so fifteen minutes with
 * nothing is usually nothing having invoked it (ServerlessFunctionStatus,
 * issue #6269): the card says that, calmly, and keeps the checks for a
 * function that should be running one click away.
 */
export const SERVERLESS_FUNCTION_IDLE_COPY: NonNullable<
  ResourceConnectionGuide["idleCopy"]
> = {
  title: translationKey("No invocations in the last 15 minutes"),
  description: translationKey(
    "OneUptime last heard from this function {{lastHeard}}. It sends data only while it runs, so this is normal when nothing invokes it, such as between scheduled runs.",
  ),
  checksLabel: translationKey("What to check if it should be running"),
  waitingDescription: translationKey(
    "No data has arrived from this function yet. Set up the OpenTelemetry SDK and invoke the function — it takes a few minutes.",
  ),
};

/*
 * `cloudPlatform` is the one the function reported. On Azure Functions the
 * function app's service.name names the function, so the setting is
 * OTEL_SERVICE_NAME, as the serverless guide's Azure Functions settings
 * give it: the guide leaves faas.name out there, because app settings reach
 * every function in the app and ingest writes the service.name onto the
 * telemetry as faas.name. Everywhere else it is faas.name.
 */
export const getServerlessFunctionConnectionGuide: (
  functionIdentifier: string,
  cloudPlatform?: string | null | undefined,
) => ResourceConnectionGuide = (
  functionIdentifier: string,
  cloudPlatform?: string | null | undefined,
): ResourceConnectionGuide => {
  const isNamedByServiceName: boolean =
    getServerlessPlatformForCloudPlatform(cloudPlatform) === "azure-functions";
  const nameAttribute: string = isNamedByServiceName
    ? "service.name"
    : "faas.name";
  // OTEL_SERVICE_NAME is a plain string: not percent-decoded, so not encoded.
  const attributes: string = isNamedByServiceName
    ? `OTEL_SERVICE_NAME=${quoteForShell(functionIdentifier)}`
    : `OTEL_RESOURCE_ATTRIBUTES=${quoteForShell(
        `faas.name=${encodeResourceAttributeValue(functionIdentifier)}`,
      )}`;

  return {
    setupCopy: {
      title: translationKey("Connect this function"),
      description: SERVERLESS_FUNCTION_IDLE_COPY.waitingDescription,
    },
    stoppedCopy: {
      title: SERVERLESS_FUNCTION_IDLE_COPY.title,
      description: SERVERLESS_FUNCTION_IDLE_COPY.description,
    },
    agentName: "OpenTelemetry SDK",
    setupSteps: [
      PICK_INGESTION_KEY_STEP,
      {
        title: "Instrument the function",
        description: isNamedByServiceName
          ? "Add the OpenTelemetry SDK for its runtime and set the application settings from the setup guide. The function app's service.name must match this function:"
          : "Add the OpenTelemetry SDK for its runtime and set the environment variables from the setup guide. faas.name must match this function:",
        code: attributes,
      },
      /*
       * Its data comes from an invocation, so the step asks for one, and
       * names the status the function's pill will switch to.
       */
      {
        title: "Deploy and invoke it",
        description:
          "Data is sent when the function runs. Invoke it once, then refresh this page after a few minutes. The function switches to Receiving data once its first data arrives.",
      },
    ],
    idleCopy: SERVERLESS_FUNCTION_IDLE_COPY,
    troubleshootingSteps: [
      {
        title: "Check it is being invoked",
        description:
          "A function only sends data while it runs. If nothing has called it lately, this is expected.",
      },
      {
        title: "Check the function's logs",
        description: translationKey(
          "Look for OpenTelemetry export errors. A 401 means the ingestion key was deleted or changed; a connection error means it cannot reach OneUptime.",
        ),
      },
      {
        title: translateTemplate("Check {{attribute}}", {
          attribute: nameAttribute,
        }),
        description: translateTemplate(
          'It must still be "{{functionName}}". A different name sends the data to a different function.',
          { functionName: functionIdentifier },
        ),
        code: attributes,
      },
    ],
  };
};
