import path from "path";
import { SetupGuideOption } from "../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { SetupGuideTranslations } from "../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideTranslation";
import { DOCKER_INSTALL_METHODS } from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import { DOCKER_DOCUMENTATION_TRANSLATIONS } from "../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationTranslations";
import { PODMAN_INSTALL_METHODS } from "../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import { PODMAN_DOCUMENTATION_TRANSLATIONS } from "../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationTranslations";
import { DOCKER_SWARM_INSTALL_METHODS } from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import { DOCKER_SWARM_DOCUMENTATION_TRANSLATIONS } from "../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationTranslations";
import { CEPH_INSTALL_METHODS } from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import { CEPH_DOCUMENTATION_TRANSLATIONS } from "../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationTranslations";
import { IOT_INGESTION_METHODS } from "../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationMarkdown";
import { IOT_DOCUMENTATION_TRANSLATIONS } from "../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationTranslations";
import { KUBERNETES_PLATFORMS } from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { KUBERNETES_DOCUMENTATION_TRANSLATIONS } from "../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationTranslations";
import { STORAGE_ARRAY_PLATFORMS } from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import { STORAGE_ARRAY_DOCUMENTATION_TRANSLATIONS } from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationTranslations";
import { OPENSTACK_CONNECT_METHODS } from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/DocumentationMarkdown";
import { OPENSTACK_DEPLOYMENT_TOOLS } from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackDeploymentGuides";
import { OPENSTACK_DOCUMENTATION_TRANSLATIONS } from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/DocumentationTranslations";
import {
  SetupGuideWay,
  getStorageArraySetupGuideWays,
  getKubernetesSetupGuideWays,
  getIoTSetupGuideWays,
  getOpenStackSetupGuideWays,
  getCephSetupGuideWays,
  getDockerSwarmSetupGuideWays,
  getDockerSetupGuideWays,
  getPodmanSetupGuideWays,
} from "./SetupGuideWays";

/*
 * THE PRODUCTS WHOSE HELP > DOCUMENTATION PAGE IS A SETUP GUIDE IN EVERY
 * LANGUAGE (#8341).
 *
 * Each has its English guide (DocumentationMarkdown.ts, built for the
 * reader), each language's words for the guide's markdown
 * (DocumentationTranslations/<code>.ts), the card that hands them to
 * SetupGuideCard, and the Dashboard words the guide names in bold: a tab,
 * a page, a topic of its own. A test reads a product from here, so a
 * product is checked in every language the day it is added.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../App/FeatureSet/Dashboard/src",
);

export interface SetupGuideDocumentationProduct {
  name: string;
  translations: SetupGuideTranslations;
  // Pages/<name>/DocumentationTranslations: one module per language.
  translationsDirectory: string;
  // Pages/<name>/Utils/DocumentationTranslations.ts: the loaders.
  loadersFile: string;
  // The card that draws the guide, and hands it the translations.
  cardFile: string;
  // The constant the card hands SetupGuideCard.
  translationsConstant: string;
  // Every way through the guide (SetupGuideWays).
  ways: () => Array<SetupGuideWay>;
  options: ReadonlyArray<SetupGuideOption>;
  /*
   * What the guide names in bold that the Dashboard draws: each is named,
   * in bold, as the reader's locale words it. A path ("AI → AI agent") is
   * checked step by step.
   */
  dashboardWords: ReadonlyArray<string>;
}

function product(data: {
  name: string;
  translations: SetupGuideTranslations;
  translationsConstant: string;
  ways: () => Array<SetupGuideWay>;
  options: ReadonlyArray<SetupGuideOption>;
  dashboardWords: ReadonlyArray<string>;
}): SetupGuideDocumentationProduct {
  return {
    ...data,
    translationsDirectory: path.join(
      DASHBOARD_SOURCE,
      `Pages/${data.name}/DocumentationTranslations`,
    ),
    loadersFile: path.join(
      DASHBOARD_SOURCE,
      `Pages/${data.name}/Utils/DocumentationTranslations.ts`,
    ),
    cardFile: path.join(
      DASHBOARD_SOURCE,
      `Components/${data.name}/DocumentationCard.tsx`,
    ),
  };
}

// The words a container host's guide names: its section, its pages, its topics.
const CONTAINER_HOST_WORDS: ReadonlyArray<string> = [
  "Overview",
  "Logs",
  "AI",
  "AI agent",
  "What AI may do",
  "The OneUptime AI agent",
];

export const SETUP_GUIDE_DOCUMENTATION_PRODUCTS: ReadonlyArray<SetupGuideDocumentationProduct> =
  [
    product({
      name: "Docker",
      translations: DOCKER_DOCUMENTATION_TRANSLATIONS,
      translationsConstant: "DOCKER_DOCUMENTATION_TRANSLATIONS",
      ways: getDockerSetupGuideWays,
      options: DOCKER_INSTALL_METHODS,
      dashboardWords: [
        "Docker",
        ...CONTAINER_HOST_WORDS,
        "Collect logs from every container (json-file log driver)",
      ],
    }),
    product({
      name: "Podman",
      translations: PODMAN_DOCUMENTATION_TRANSLATIONS,
      translationsConstant: "PODMAN_DOCUMENTATION_TRANSLATIONS",
      ways: getPodmanSetupGuideWays,
      options: PODMAN_INSTALL_METHODS,
      dashboardWords: [
        "Podman",
        ...CONTAINER_HOST_WORDS,
        "Collect logs from every container (k8s-file log driver)",
      ],
    }),
    product({
      name: "DockerSwarm",
      translations: DOCKER_SWARM_DOCUMENTATION_TRANSLATIONS,
      translationsConstant: "DOCKER_SWARM_DOCUMENTATION_TRANSLATIONS",
      ways: getDockerSwarmSetupGuideWays,
      options: DOCKER_SWARM_INSTALL_METHODS,
      dashboardWords: [
        "Docker Swarm",
        "AI",
        "AI agent",
        "The OneUptime AI agent",
        "Node Name",
      ],
    }),
    product({
      name: "Ceph",
      translations: CEPH_DOCUMENTATION_TRANSLATIONS,
      translationsConstant: "CEPH_DOCUMENTATION_TRANSLATIONS",
      ways: getCephSetupGuideWays,
      options: CEPH_INSTALL_METHODS,
      dashboardWords: [
        "Ceph",
        "Cluster Log",
        "Cluster Health",
        "OSD",
        "Pool",
        "Placement Groups",
        "Agent Version",
        "OneUptime AI agent",
        "AI",
        "AI agent",
      ],
    }),
    product({
      name: "IoT",
      translations: IOT_DOCUMENTATION_TRANSLATIONS,
      translationsConstant: "IOT_DOCUMENTATION_TRANSLATIONS",
      ways: getIoTSetupGuideWays,
      options: IOT_INGESTION_METHODS,
      dashboardWords: [
        "IoT",
        "Devices",
        "Metrics",
        "Fleet",
        "Device",
        "Device Registry",
        "Metric conventions",
        "MQTT topics and payloads",
      ],
    }),
    product({
      name: "Kubernetes",
      translations: KUBERNETES_DOCUMENTATION_TRANSLATIONS,
      translationsConstant: "KUBERNETES_DOCUMENTATION_TRANSLATIONS",
      ways: getKubernetesSetupGuideWays,
      options: KUBERNETES_PLATFORMS,
      dashboardWords: [
        "Kubernetes",
        "AI",
        "Agent",
        "Application traces",
        "Network flows",
        "Upgrade or uninstall the agent",
        "GKE Autopilot",
        "EKS Fargate",
        "OpenShift",
        "Red Hat OpenShift",
      ],
    }),
    product({
      name: "StorageArray",
      translations: STORAGE_ARRAY_DOCUMENTATION_TRANSLATIONS,
      translationsConstant: "STORAGE_ARRAY_DOCUMENTATION_TRANSLATIONS",
      ways: getStorageArraySetupGuideWays,
      options: STORAGE_ARRAY_PLATFORMS,
      dashboardWords: [
        "Storage Arrays",
        "Logs",
        "Agent Version",
        "FlashArray, older Purity",
        "Volumes",
        "Hosts",
        "Directories",
      ],
    }),
    product({
      name: "OpenStack",
      translations: OPENSTACK_DOCUMENTATION_TRANSLATIONS,
      translationsConstant: "OPENSTACK_DOCUMENTATION_TRANSLATIONS",
      ways: getOpenStackSetupGuideWays,
      // The card asks how OpenStack is deployed, then how to install the agent.
      options: [...OPENSTACK_DEPLOYMENT_TOOLS, ...OPENSTACK_CONNECT_METHODS],
      dashboardWords: [
        "OpenStack",
        "All Clouds",
        "Connect Cloud",
        "Control Plane",
        "Overview",
        "Linked Resources",
        "Incidents",
        "Heartbeat URL",
        "Logs",
        "Security Events",
        "Connections",
        "Find security events in your logs",
        "Services",
        "Hypervisors",
        "Domains",
        "Images",
        "Volumes",
        "Settings",
        "Real usage per instance",
        "Agent Version",
        "Full view",
        "Infrastructure only",
        "Project view",
        "Kubernetes",
        "Documentation",
        "Not sure, or something else",
        "Red Hat OpenShift",
        "What the agent collects, and what it costs your cloud",
      ],
    }),
  ];
