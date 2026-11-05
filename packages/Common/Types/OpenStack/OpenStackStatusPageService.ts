import { OpenStackMaintenancePartKind } from "./OpenStackMaintenancePart";
import { OpenStackResourceKind } from "./OpenStackResourceKind";

/*
 * THE SERVICES A STATUS PAGE OF A CLOUD SHOWS, AND WHICH ONE A PART OF THE CLOUD IS IN.
 *
 * What someone using a cloud knows it by. A regional page has a row of each a region runs, backed by the
 * monitors that say whether it works, and a project's private page turns a row red when a failure reaches
 * that project. So one list says what the rows are, and one answer says which row a failed part belongs
 * to: nothing about either is decided anywhere else.
 *
 * Pure, so a page, a test and the server can all read it.
 */

export enum OpenStackStatusPageService {
  Compute = "Compute",
  Networking = "Networking",
  BlockStorage = "Block Storage",
  Images = "Images",
  Identity = "Identity",
  LoadBalancing = "Load Balancing",
}

export interface OpenStackStatusPageServiceEntry {
  service: OpenStackStatusPageService;
  // The API's name in the inventory. A region with no such row runs no such thing and shows no such row.
  apiName: string;
  // What says whether it works: OpenStackAlertTemplates. Never one a person's planned work trips.
  templateIds: ReadonlyArray<string>;
  // What a check from outside adds to its objective, when the cloud has that check on.
  checkTemplateIds: ReadonlyArray<string>;
}

export const OPENSTACK_STATUS_PAGE_SERVICES: ReadonlyArray<OpenStackStatusPageServiceEntry> =
  [
    {
      service: OpenStackStatusPageService.Compute,
      apiName: "compute",
      templateIds: [
        "openstack-compute-api-down",
        "openstack-compute-service-down",
      ],
      checkTemplateIds: ["openstack-instance-boot-failing"],
    },
    {
      service: OpenStackStatusPageService.Networking,
      apiName: "network",
      templateIds: [
        "openstack-network-api-down",
        "openstack-network-agent-down",
      ],
      checkTemplateIds: ["openstack-floating-ip-unreachable"],
    },
    {
      service: OpenStackStatusPageService.BlockStorage,
      apiName: "volume",
      templateIds: [
        "openstack-block-storage-api-down",
        "openstack-block-storage-service-down",
      ],
      checkTemplateIds: ["openstack-volume-attach-failing"],
    },
    {
      service: OpenStackStatusPageService.Images,
      apiName: "image",
      templateIds: ["openstack-image-api-down"],
      checkTemplateIds: [],
    },
    {
      service: OpenStackStatusPageService.Identity,
      apiName: "identity",
      templateIds: ["openstack-identity-api-down"],
      checkTemplateIds: ["openstack-token-issue-failing"],
    },
    /*
     * Octavia has no monitor to back a row with until #5741 adds its templates, so nothing shows this
     * yet, on any cloud. Naming them here is all that row needs.
     */
    {
      service: OpenStackStatusPageService.LoadBalancing,
      apiName: "load-balancer",
      templateIds: [],
      checkTemplateIds: [],
    },
  ];

// A worker's row is region/family/host/binary, and its family is the service it is a worker of.
function getFamilyOfServiceRow(externalId: string | null | undefined): string {
  return (externalId || "").split("/")[1] || "";
}

/*
 * Which row a failed part belongs to, or none: not everything a cloud runs has a row, and a part with
 * none still tells its project, it only has no row to turn red.
 */
export function getOpenStackStatusPageServiceOfPart(part: {
  kind: string | null | undefined;
  name?: string | null | undefined;
  externalId?: string | null | undefined;
}): OpenStackStatusPageService | null {
  switch (part.kind) {
    case OpenStackResourceKind.Hypervisor:
    case OpenStackResourceKind.Instance:
    case OpenStackResourceKind.Flavor:
    case OpenStackResourceKind.BareMetalNode:
    case OpenStackMaintenancePartKind.AvailabilityZone:
      return OpenStackStatusPageService.Compute;
    case OpenStackResourceKind.Router:
    case OpenStackResourceKind.FloatingIp:
    case OpenStackResourceKind.Network:
    case OpenStackResourceKind.Subnet:
      return OpenStackStatusPageService.Networking;
    case OpenStackResourceKind.Volume:
    case OpenStackResourceKind.StoragePool:
    case OpenStackResourceKind.Snapshot:
    case OpenStackResourceKind.Backup:
      return OpenStackStatusPageService.BlockStorage;
    case OpenStackResourceKind.Image:
      return OpenStackStatusPageService.Images;
    case OpenStackResourceKind.Service: {
      const family: string = getFamilyOfServiceRow(part.externalId);
      if (family === "compute") {
        return OpenStackStatusPageService.Compute;
      }
      if (family === "network") {
        return OpenStackStatusPageService.Networking;
      }
      return family === "volume"
        ? OpenStackStatusPageService.BlockStorage
        : null;
    }
    case OpenStackResourceKind.Api:
      if (part.name === "compute" || part.name === "placement") {
        return OpenStackStatusPageService.Compute;
      }
      return (
        OPENSTACK_STATUS_PAGE_SERVICES.find(
          (entry: OpenStackStatusPageServiceEntry): boolean => {
            return entry.apiName === part.name;
          },
        )?.service || null
      );
    default:
      return null;
  }
}

const API_WORDS: Readonly<Record<string, string>> = {
  compute: "The Compute API",
  placement: "The Placement API",
  network: "The Networking API",
  volume: "The Block Storage API",
  image: "The Image API",
  identity: "The Identity API",
  orchestration: "The Orchestration API",
  "container-infra": "The Kubernetes clusters API",
  baremetal: "The Bare Metal API",
  sharev2: "The Shared File Systems API",
  "load-balancer": "The Load Balancing API",
};

const KIND_WORDS: Readonly<Record<string, string>> = {
  [OpenStackResourceKind.Hypervisor]: "A compute host",
  [OpenStackMaintenancePartKind.AvailabilityZone]: "An availability zone",
  [OpenStackResourceKind.Instance]: "An instance",
  [OpenStackResourceKind.BareMetalNode]: "A bare metal node",
  [OpenStackResourceKind.Router]: "A router",
  [OpenStackResourceKind.FloatingIp]: "A floating IP",
  [OpenStackResourceKind.Network]: "A network",
  [OpenStackResourceKind.Volume]: "A volume",
  [OpenStackResourceKind.StoragePool]: "A storage pool",
  [OpenStackResourceKind.Stack]: "A stack",
  [OpenStackResourceKind.ContainerCluster]: "A Kubernetes cluster",
  [OpenStackResourceKind.Share]: "A share",
};

/*
 * How a part is called to someone who only uses the cloud. Never by its name: a host's name is
 * something OpenStack itself keeps from a project (only an admin sees hypervisor_hostname), and
 * nothing tells a tenant what the machine next to theirs is called.
 */
export function describeOpenStackPartToAProject(part: {
  kind: string | null | undefined;
  name?: string | null | undefined;
  externalId?: string | null | undefined;
}): string {
  if (part.kind === OpenStackResourceKind.Api) {
    return API_WORDS[part.name || ""] || "An API";
  }

  if (part.kind === OpenStackResourceKind.Service) {
    const family: string = getFamilyOfServiceRow(part.externalId);
    if (family === "compute") {
      return part.name === "nova-compute"
        ? "A compute host"
        : "A compute service";
    }
    if (family === "network") {
      return "A networking service";
    }
    return family === "volume" ? "A block storage service" : "A service";
  }

  return KIND_WORDS[part.kind || ""] || "A part of the cloud";
}
