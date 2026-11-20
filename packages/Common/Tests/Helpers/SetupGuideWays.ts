import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
} from "../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  DOCKER_INSTALL_METHODS,
  getDockerSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import {
  PODMAN_INSTALL_METHODS,
  getPodmanSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import {
  DOCKER_SWARM_INSTALL_METHODS,
  getDockerSwarmSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import {
  CEPH_INSTALL_METHODS,
  getCephSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  IOT_INGESTION_METHODS,
  getIoTSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationMarkdown";
import {
  KUBERNETES_PLATFORMS,
  getKubernetesSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  STORAGE_ARRAY_PLATFORMS,
  getStorageArraySetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import {
  OPENSTACK_CONNECT_METHODS,
  getOpenStackSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/DocumentationMarkdown";
import {
  PROXMOX_CONNECT_METHODS,
  getProxmoxSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  OPENSTACK_DEPLOYMENT_TOOLS,
  OpenStackDeploymentTool,
} from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackDeploymentGuides";
import {
  VMWARE_INSTALL_METHODS,
  getVMwareSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import {
  DATABASE_AGENT_SYSTEM_OPTIONS,
  DatabaseDocumentationTarget,
  getDatabaseAgentEngine,
  getDatabaseAgentSetupGuide,
  getDatabaseHealthMonitorCreateUrl,
  getDatabaseOwnCollectorSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import { DatabaseAgentEngine } from "../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseAgentConfigs";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
} from "../../Types/DatabaseServer/DatabaseSystem";
import {
  HOST_INSTALL_METHODS,
  getHostSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import {
  MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS,
  getMessageQueueSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown";
import {
  RUM_CLIENTS,
  getRumSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";

/*
 * EVERY WAY THROUGH A PRODUCT'S SETUP GUIDE (#8341).
 *
 * A setup guide is built for its reader: the option they pick, whether they
 * have picked a key yet, and the resource a Documentation tab installs for.
 * Each changes what the guide says - a platform's own steps, "Pick an
 * ingestion key in step 1", "Replace `my-docker-host` with a name" or
 * "This installs the agent for `web-1`". These are the guides a reader can
 * meet, so a test of a guide's words in every language reads every one.
 */

export interface SetupGuideWay {
  // The option, the key and the resource, for a failure's message.
  label: string;
  content: SetupGuideContent;
}

// What the guide is built with: before a key is picked, and after.
export interface SetupGuideReader {
  // How a failure's message names the reader.
  label: string;
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
}

export const SETUP_GUIDE_READERS: ReadonlyArray<SetupGuideReader> = [
  {
    label: "before a key",
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
  },
  {
    label: "with a key",
    oneuptimeUrl: "https://oneuptime.example.com",
    apiKey: "0f8fad5b-d9cb-469f-a165-70867728950e",
    hasApiKey: true,
  },
];

/*
 * A OneUptime served over plain HTTP on a port of its own, as a self-hosted
 * one can be: a guide that writes the host, port or scheme of the reader's
 * URL into its words (Proxmox's metric server) reads it for this reader too.
 */
export const SETUP_GUIDE_SELF_HOSTED_READER: SetupGuideReader = {
  label: "self-hosted on its own port",
  oneuptimeUrl: "http://oneuptime.internal:8080",
  apiKey: "0f8fad5b-d9cb-469f-a165-70867728950e",
  hasApiKey: true,
};

/*
 * Every way through a guide: each of its options, for each reader (before
 * and after a key is picked, unless the guide names its own), for a new
 * resource and for each of `names` (a resource's own Documentation tab).
 */
export function getSetupGuideWays<TKey extends string>(data: {
  options: ReadonlyArray<SetupGuideOption<TKey>>;
  names: ReadonlyArray<string>;
  readers?: ReadonlyArray<SetupGuideReader> | undefined;
  build: (
    reader: SetupGuideReader,
    option: TKey,
    name: string | undefined,
  ) => SetupGuideContent;
}): Array<SetupGuideWay> {
  const ways: Array<SetupGuideWay> = [];

  for (const option of data.options) {
    for (const reader of data.readers || SETUP_GUIDE_READERS) {
      for (const name of [undefined, ...data.names]) {
        ways.push({
          label: [
            option.key,
            reader.label,
            name ? `for ${name}` : "for a new one",
          ].join(", "),
          content: data.build(reader, option.key, name),
        });
      }
    }
  }

  return ways;
}

/*
 * The RUM guide (#6434): a browser or a mobile app, for a new application
 * and on an application's own Documentation tab - one whose name a mobile
 * app's OTEL_RESOURCE_ATTRIBUTES writes as it is, and one it percent-encodes
 * (a space), which adds a sentence to the step's note.
 */
export function getRumSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: RUM_CLIENTS,
    names: ["storefront-web", "Storefront Mobile"],
    build: (
      reader: SetupGuideReader,
      option: (typeof RUM_CLIENTS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getRumSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        client: option,
        appName: name,
      });
    },
  });
}

export function getDockerSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: DOCKER_INSTALL_METHODS,
    names: ["web-1", "Prod Docker 01"],
    build: (
      reader: SetupGuideReader,
      option: (typeof DOCKER_INSTALL_METHODS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getDockerSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        method: option,
        hostName: name,
      });
    },
  });
}

export function getPodmanSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: PODMAN_INSTALL_METHODS,
    names: ["web-1", "Prod Podman 01"],
    build: (
      reader: SetupGuideReader,
      option: (typeof PODMAN_INSTALL_METHODS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getPodmanSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        method: option,
        hostName: name,
      });
    },
  });
}

export function getDockerSwarmSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: DOCKER_SWARM_INSTALL_METHODS,
    names: ["swarm-1", "Prod Swarm 01"],
    build: (
      reader: SetupGuideReader,
      option: (typeof DOCKER_SWARM_INSTALL_METHODS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getDockerSwarmSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        method: option,
        clusterName: name,
      });
    },
  });
}

/*
 * Ceph's guide also tells a reader with a key from one without: the install
 * script's command carries only a real key (CephDocumentationCard).
 */
export function getCephSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: CEPH_INSTALL_METHODS,
    names: ["ceph-1", "Prod Ceph 01"],
    build: (
      reader: SetupGuideReader,
      option: (typeof CEPH_INSTALL_METHODS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getCephSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        hasApiKey: reader.hasApiKey,
        method: option,
        clusterName: name,
      });
    },
  });
}

/*
 * IoT's guide sends readings to a fleet: one named in Add IoT Fleet or on a
 * fleet's own Documentation tab, or an example fleet on the product page.
 */
export function getIoTSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: IOT_INGESTION_METHODS,
    names: ["fleet-1", "Prod Fleet 01"],
    build: (
      reader: SetupGuideReader,
      option: (typeof IOT_INGESTION_METHODS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getIoTSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        method: option,
        fleetName: name,
      });
    },
  });
}

/*
 * Kubernetes's guide varies by platform (Helm, EKS, GKE, AKS, Autopilot,
 * Fargate, OpenShift) and by the cluster a Documentation tab installs for.
 */
export function getKubernetesSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: KUBERNETES_PLATFORMS,
    names: ["k8s-1", "Prod Cluster 01"],
    build: (
      reader: SetupGuideReader,
      option: (typeof KUBERNETES_PLATFORMS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getKubernetesSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        platform: option,
        clusterName: name,
      });
    },
  });
}

/*
 * The Storage Array guide varies by platform (FlashArray native, FlashArray
 * through Pure's exporter, FlashBlade), by whether a key is picked (the
 * install script's prompts) and by the array a Documentation tab installs
 * for.
 */
export function getStorageArraySetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: STORAGE_ARRAY_PLATFORMS,
    names: ["array-1", "Prod Array 01"],
    build: (
      reader: SetupGuideReader,
      option: (typeof STORAGE_ARRAY_PLATFORMS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getStorageArraySetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        hasApiKey: reader.hasApiKey,
        platform: option,
        arrayName: name,
      });
    },
  });
}

/*
 * The Proxmox guide varies by how the cluster connects (the install script,
 * Docker Compose, or Proxmox VE's own push), by whether a key is picked
 * (the install command, the notification commands) and by the cluster a
 * Documentation tab installs for. The native push writes the host, port and
 * scheme of the reader's OneUptime into its metric server's fields, so it is
 * read for a self-hosted OneUptime on a port of its own too.
 */
export function getProxmoxSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: PROXMOX_CONNECT_METHODS,
    names: ["pve-1", "Prod Cluster 01"],
    readers: [...SETUP_GUIDE_READERS, SETUP_GUIDE_SELF_HOSTED_READER],
    build: (
      reader: SetupGuideReader,
      option: (typeof PROXMOX_CONNECT_METHODS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getProxmoxSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        hasApiKey: reader.hasApiKey,
        method: option,
        clusterName: name,
      });
    },
  });
}

/*
 * OpenStack's guide asks two things: how the reader deploys OpenStack (the
 * card's options, each tool with its own steps and topics) and, where there
 * is an agent to install, how to install it. Every tool is read with every
 * install method, before and after a key is picked, for a new cloud and on
 * a cloud's own Documentation tab.
 */
export function getOpenStackSetupGuideWays(): Array<SetupGuideWay> {
  return OPENSTACK_DEPLOYMENT_TOOLS.flatMap(
    (tool: SetupGuideOption<OpenStackDeploymentTool>): Array<SetupGuideWay> => {
      return getSetupGuideWays({
        options: OPENSTACK_CONNECT_METHODS,
        names: ["cloud-1", "Prod Cloud 01"],
        build: (
          reader: SetupGuideReader,
          method: (typeof OPENSTACK_CONNECT_METHODS)[number]["key"],
          name: string | undefined,
        ): SetupGuideContent => {
          return getOpenStackSetupGuide({
            oneuptimeUrl: reader.oneuptimeUrl,
            apiKey: reader.apiKey,
            hasApiKey: reader.hasApiKey,
            method: method,
            cloudName: name,
            tool: tool.key,
          });
        },
      }).map((way: SetupGuideWay): SetupGuideWay => {
        return { ...way, label: `${tool.key}, ${way.label}` };
      });
    },
  );
}

/*
 * The VMware guide varies by install method (the install script, Docker
 * Compose by hand, a Linux service without Docker), by whether a key is
 * picked (the install script's prompts) and by the vCenter a Documentation
 * tab installs for.
 */
export function getVMwareSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: VMWARE_INSTALL_METHODS,
    names: ["vcenter-1", "Prod vCenter 01"],
    build: (
      reader: SetupGuideReader,
      option: (typeof VMWARE_INSTALL_METHODS)[number]["key"],
      name: string | undefined,
    ): SetupGuideContent => {
      return getVMwareSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        hasApiKey: reader.hasApiKey,
        method: option,
        vcenterName: name,
      });
    },
  });
}

/*
 * The rows a database's own Documentation tab installs for: one with a
 * name, an address and a port; one discovered in Kubernetes, known by a
 * cluster-local endpoint in its namespace; and one with no address yet.
 */
export function getDatabaseSetupGuideRows(
  system: string,
  port: number | null,
): Array<{ label: string; database: DatabaseDocumentationTarget }> {
  const id: string = "4f7f2c9e-0000-4000-8000-000000000001";

  return [
    {
      label: "a row with an address",
      database: {
        id: id,
        name: "orders-db",
        dbSystem: system,
        serverAddress: "db.prod.internal",
        serverPort: port || undefined,
      },
    },
    {
      label: "a row in Kubernetes",
      database: {
        id: id,
        dbSystem: system,
        endpoints: ["db.data.svc.cluster.local:1234@prod"],
        kubernetesNamespace: "data",
        isKubernetes: true,
      },
    },
    { label: "a row with no address", database: { id: id, dbSystem: system } },
  ];
}

// Engines a database can report that the catalog has never heard of.
export const DATABASE_ENGINES_NOT_IN_THE_CATALOG: ReadonlyArray<string> = [
  "acmedb",
  "Acme Ledger 2",
];

const DATABASE_HEALTH_MONITOR_URL: string = getDatabaseHealthMonitorCreateUrl(
  "/dashboard/1/monitors/create",
);
const DATABASE_RECOMMENDATIONS_URL: string =
  "/dashboard/1/database-servers/2/recommendations";

function databaseAgentEngine(system: string): DatabaseAgentEngine {
  const engine: DatabaseAgentEngine | null = getDatabaseAgentEngine(system);

  if (!engine) {
    throw new Error(`The agent has no engine for ${system}.`);
  }

  return engine;
}

/*
 * Every way through the Database guide (DatabaseDocumentationCard), before
 * and after a key is picked:
 *
 *   - the product page, and Add Database before its row exists: the
 *     engine the reader picks, the agent's guide for it;
 *   - a database's own Documentation tab, for each engine the agent
 *     monitors: the agent's guide for that row (its identity and its
 *     server id, the Kubernetes Deployment for a row found there);
 *   - a database's own tab for each engine of the catalog the agent ships
 *     no config for: the guide for the reader's own collector - its
 *     receiver, its Prometheus endpoint, its cloud's monitoring API or, for
 *     an engine inside the application, the application's traces.
 */
export function getDatabaseSetupGuideWays(): Array<SetupGuideWay> {
  const ways: Array<SetupGuideWay> = getSetupGuideWays({
    options: DATABASE_AGENT_SYSTEM_OPTIONS,
    names: [],
    build: (reader: SetupGuideReader, system: string): SetupGuideContent => {
      return getDatabaseAgentSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        hasApiKey: reader.hasApiKey,
        engine: databaseAgentEngine(system),
        system: system,
        databaseHealthMonitorUrl: DATABASE_HEALTH_MONITOR_URL,
      });
    },
  });

  /*
   * Every engine of the catalog, and two it does not know, named as the
   * data reported them: whatever an engine is called, its guide reads in
   * the reader's words (#8780).
   */
  const engines: Array<{ system: string; port: number | null }> = [
    ...(DATABASE_SYSTEMS as ReadonlyArray<DatabaseSystemDescriptor>).map(
      (
        descriptor: DatabaseSystemDescriptor,
      ): {
        system: string;
        port: number | null;
      } => {
        return { system: descriptor.system, port: descriptor.defaultPort };
      },
    ),
    ...DATABASE_ENGINES_NOT_IN_THE_CATALOG.map(
      (system: string): { system: string; port: number | null } => {
        return { system: system, port: null };
      },
    ),
  ];

  for (const engine of engines) {
    const hasAgent: boolean = getDatabaseAgentEngine(engine.system) !== null;

    for (const reader of SETUP_GUIDE_READERS) {
      for (const row of getDatabaseSetupGuideRows(engine.system, engine.port)) {
        ways.push({
          label: [
            engine.system,
            hasAgent ? "the agent" : "your own collector",
            reader.hasApiKey ? "with a key" : "before a key",
            row.label,
          ].join(", "),
          content: hasAgent
            ? getDatabaseAgentSetupGuide({
                oneuptimeUrl: reader.oneuptimeUrl,
                apiKey: reader.apiKey,
                hasApiKey: reader.hasApiKey,
                engine: databaseAgentEngine(engine.system),
                system: engine.system,
                database: row.database,
                databaseHealthMonitorUrl: DATABASE_HEALTH_MONITOR_URL,
                recommendationsUrl: DATABASE_RECOMMENDATIONS_URL,
              })
            : getDatabaseOwnCollectorSetupGuide({
                oneuptimeUrl: reader.oneuptimeUrl,
                apiKey: reader.apiKey,
                hasApiKey: reader.hasApiKey,
                database: row.database,
                databaseHealthMonitorUrl: DATABASE_HEALTH_MONITOR_URL,
                recommendationsUrl: DATABASE_RECOMMENDATIONS_URL,
              }),
        });
      }
    }
  }

  return ways;
}

/*
 * The Host guide varies by install method (Docker, a Debian or RHEL
 * package, the Linux tarball, macOS, Windows), and Kubernetes nodes take
 * the Kubernetes agent's steps instead. A host has no Documentation tab of
 * its own, so there is no name to install for.
 */
export function getHostSetupGuideWays(): Array<SetupGuideWay> {
  return getSetupGuideWays({
    options: HOST_INSTALL_METHODS,
    names: [],
    build: (
      reader: SetupGuideReader,
      option: (typeof HOST_INSTALL_METHODS)[number]["key"],
    ): SetupGuideContent => {
      return getHostSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        method: option,
      });
    },
  });
}

/*
 * A queue's own Documentation tab, as a row can hand it: its destination,
 * with or without the broker address its telemetry reported, and the Azure
 * namespace Service Bus and Event Hubs queues are scoped by.
 */
const MESSAGE_QUEUE_TAB_DESTINATION: string = "orders";
const MESSAGE_QUEUE_TAB_BROKER_ADDRESSES: ReadonlyArray<string | undefined> = [
  undefined,
  "broker-1.example.com:9092",
];
const MESSAGE_QUEUE_TAB_AZURE_NAMESPACE: string = "orders-ns";
const MESSAGE_QUEUE_NAMESPACED_SYSTEMS: ReadonlyArray<string> = [
  "servicebus",
  "eventhubs",
];
// A system the catalog does not know: the generic guide, under its own name.
const MESSAGE_QUEUE_UNKNOWN_SYSTEM: string = "acme-bus";

/*
 * The Queues guide varies by messaging system: how its spans name it, what
 * traces its clients, the collector (or scraper) that reads its broker, and
 * what a queue's page charts. The product page picks a system; a queue's
 * own Documentation tab is built for its row's system, with the queue's
 * identity and broker, and for a system the catalog does not know too.
 */
export function getMessageQueueSetupGuideWays(): Array<SetupGuideWay> {
  const ways: Array<SetupGuideWay> = getSetupGuideWays({
    options: MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS,
    names: [],
    build: (reader: SetupGuideReader, option: string): SetupGuideContent => {
      return getMessageQueueSetupGuide({
        oneuptimeUrl: reader.oneuptimeUrl,
        apiKey: reader.apiKey,
        system: option,
      });
    },
  });

  const systems: Array<string> = [
    ...MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS.map(
      (option: SetupGuideOption): string => {
        return option.key;
      },
    ),
    MESSAGE_QUEUE_UNKNOWN_SYSTEM,
  ];

  for (const system of systems) {
    for (const reader of SETUP_GUIDE_READERS) {
      for (const brokerAddress of MESSAGE_QUEUE_TAB_BROKER_ADDRESSES) {
        ways.push({
          label: [
            system,
            reader.label,
            `for the queue ${MESSAGE_QUEUE_TAB_DESTINATION}`,
            brokerAddress ? `on ${brokerAddress}` : "no broker address",
          ].join(", "),
          content: getMessageQueueSetupGuide({
            oneuptimeUrl: reader.oneuptimeUrl,
            apiKey: reader.apiKey,
            system: system,
            queue: {
              system: system,
              destination: MESSAGE_QUEUE_TAB_DESTINATION,
              brokerScope: MESSAGE_QUEUE_NAMESPACED_SYSTEMS.includes(system)
                ? MESSAGE_QUEUE_TAB_AZURE_NAMESPACE
                : "",
              brokerAddress: brokerAddress,
            },
          }),
        });
      }
    }
  }

  return ways;
}
