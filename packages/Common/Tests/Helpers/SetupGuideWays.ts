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
  OPENSTACK_DEPLOYMENT_TOOLS,
  OpenStackDeploymentTool,
} from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackDeploymentGuides";
import {
  VMWARE_INSTALL_METHODS,
  getVMwareSetupGuide,
} from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";

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
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
}

export const SETUP_GUIDE_READERS: ReadonlyArray<SetupGuideReader> = [
  {
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
  },
  {
    oneuptimeUrl: "https://oneuptime.example.com",
    apiKey: "0f8fad5b-d9cb-469f-a165-70867728950e",
    hasApiKey: true,
  },
];

/*
 * Every way through a guide: each of its options, before and after a key
 * is picked, for a new resource and for each of `names` (a resource's own
 * Documentation tab).
 */
export function getSetupGuideWays<TKey extends string>(data: {
  options: ReadonlyArray<SetupGuideOption<TKey>>;
  names: ReadonlyArray<string>;
  build: (
    reader: SetupGuideReader,
    option: TKey,
    name: string | undefined,
  ) => SetupGuideContent;
}): Array<SetupGuideWay> {
  const ways: Array<SetupGuideWay> = [];

  for (const option of data.options) {
    for (const reader of SETUP_GUIDE_READERS) {
      for (const name of [undefined, ...data.names]) {
        ways.push({
          label: [
            option.key,
            reader.hasApiKey ? "with a key" : "before a key",
            name ? `for ${name}` : "for a new one",
          ].join(", "),
          content: data.build(reader, option.key, name),
        });
      }
    }
  }

  return ways;
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
