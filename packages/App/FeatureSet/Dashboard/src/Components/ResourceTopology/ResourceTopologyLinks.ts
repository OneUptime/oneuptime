import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import EntityType from "Common/Types/Telemetry/EntityType";
import { INVENTORY_ENTITY_IDENTITY_ATTRIBUTE } from "Common/Utils/Telemetry/EntityKey";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * The two ways between a resource's own topology and the master Topology.
 *
 * The master Topology (Topology > Infrastructure) is the estate: every
 * resource that reports, what runs where across all of them, and the calls
 * between the services on them, over a time range. A resource's topology is
 * one resource in depth, read live from its own inventory: a vCenter's
 * datacenters and resource pools, a cluster's workloads and volumes. They
 * are linked rather than merged — the master map stays a readable estate,
 * and every resource on it opens into its own topology, and back.
 */

export interface ResourceTopologyProduct {
  entityType: EntityType;
  /* The resource's own Topology page. */
  page: PageMap;
  /* What the link says: "Open vCenter topology". */
  linkText: string;
  /* The model whose row the page is about, and the column the entity's identity names. */
  modelType: { new (): BaseModel };
  identityAttribute: string;
  identityColumn: string;
}

export const RESOURCE_TOPOLOGY_PRODUCTS: ReadonlyArray<ResourceTopologyProduct> =
  [
    {
      entityType: EntityType.VMwareVCenter,
      page: PageMap.VMWARE_VCENTER_VIEW_TOPOLOGY,
      linkText: translationKey("Open vCenter topology"),
      modelType: VMwareVCenter,
      identityAttribute: "vmware.vcenter.name",
      identityColumn: "name",
    },
    {
      entityType: EntityType.KubernetesCluster,
      page: PageMap.KUBERNETES_CLUSTER_VIEW_TOPOLOGY,
      linkText: translationKey("Open cluster topology"),
      modelType: KubernetesCluster,
      identityAttribute: "k8s.cluster.name",
      identityColumn: "clusterIdentifier",
    },
    {
      entityType: EntityType.Host,
      page: PageMap.HOST_VIEW_TOPOLOGY,
      linkText: translationKey("Open host topology"),
      modelType: Host,
      identityAttribute: "host.name",
      identityColumn: "hostIdentifier",
    },
    {
      entityType: EntityType.DockerSwarmCluster,
      page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_TOPOLOGY,
      linkText: translationKey("Open cluster topology"),
      modelType: DockerSwarmCluster,
      identityAttribute: "docker.swarm.cluster.name",
      identityColumn: "name",
    },
    {
      entityType: EntityType.ProxmoxCluster,
      page: PageMap.PROXMOX_CLUSTER_VIEW_TOPOLOGY,
      linkText: translationKey("Open cluster topology"),
      modelType: ProxmoxCluster,
      identityAttribute: "proxmox.cluster.name",
      identityColumn: "name",
    },
    {
      entityType: EntityType.CephCluster,
      page: PageMap.CEPH_CLUSTER_VIEW_TOPOLOGY,
      linkText: translationKey("Open cluster topology"),
      modelType: CephCluster,
      identityAttribute: "ceph.cluster.name",
      identityColumn: "name",
    },
    {
      entityType: EntityType.StorageArray,
      page: PageMap.STORAGE_ARRAY_VIEW_TOPOLOGY,
      linkText: translationKey("Open storage array topology"),
      modelType: StorageArray,
      identityAttribute: "storage.array.name",
      identityColumn: "name",
    },
  ];

/*
 * Docker and Podman hosts are mirrored from their own rows, so the entity's
 * identity is the row's id itself.
 */
export const RESOURCE_TOPOLOGY_MIRRORED_PRODUCTS: ReadonlyArray<{
  entityType: EntityType;
  page: PageMap;
  linkText: string;
}> = [
  {
    entityType: EntityType.DockerHost,
    page: PageMap.DOCKER_HOST_VIEW_TOPOLOGY,
    linkText: translationKey("Open host topology"),
  },
  {
    entityType: EntityType.PodmanHost,
    page: PageMap.PODMAN_HOST_VIEW_TOPOLOGY,
    linkText: translationKey("Open host topology"),
  },
];

export function hasResourceTopology(entityType: string | undefined): boolean {
  if (!entityType) {
    return false;
  }

  return (
    RESOURCE_TOPOLOGY_PRODUCTS.some(
      (product: ResourceTopologyProduct): boolean => {
        return product.entityType === entityType;
      },
    ) ||
    RESOURCE_TOPOLOGY_MIRRORED_PRODUCTS.some(
      (product: { entityType: EntityType }): boolean => {
        return product.entityType === entityType;
      },
    )
  );
}

/* The master Topology, opened on one resource as a map. */
export function masterTopologyRouteFor(entityKey: string): Route {
  return RouteUtil.addQuery(
    RouteUtil.populateRouteParams(RouteMap[PageMap.TOPOLOGY] as Route),
    {
      tab: "Infrastructure",
      infraFocus: entityKey,
      infraView: "map",
    },
  );
}

export function resourceTopologyRoute(page: PageMap, modelId: string): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: modelId,
  });
}

export interface ResourceTopologyLink {
  route: Route;
  /* English: "Open vCenter topology". */
  text: string;
}

export interface ResourceTopologyEntity {
  entityType?: string | undefined;
  displayName?: string | undefined;
  identifyingAttributes?: JSONObject | null | undefined;
  resourceId?: string | null | undefined;
}

/*
 * The topology of the resource a master Topology entity stands for, when it
 * has one: the resource's row is found by the identity the entity was
 * hashed from (a vCenter by its name, a cluster by its identifier), or —
 * for a mirrored Docker or Podman host — taken from the entity itself.
 * Best effort: no row, or no permission to read it, is no link.
 */
export async function resolveResourceTopologyLink(
  entity: ResourceTopologyEntity,
): Promise<ResourceTopologyLink | null> {
  const mirrored: { page: PageMap; linkText: string } | undefined =
    RESOURCE_TOPOLOGY_MIRRORED_PRODUCTS.find(
      (product: { entityType: EntityType }): boolean => {
        return product.entityType === entity.entityType;
      },
    );

  if (mirrored) {
    const id: unknown =
      entity.resourceId ||
      entity.identifyingAttributes?.[INVENTORY_ENTITY_IDENTITY_ATTRIBUTE];

    if (typeof id !== "string" || !id) {
      return null;
    }

    return {
      route: resourceTopologyRoute(mirrored.page, id),
      text: mirrored.linkText,
    };
  }

  const product: ResourceTopologyProduct | undefined =
    RESOURCE_TOPOLOGY_PRODUCTS.find(
      (candidate: ResourceTopologyProduct): boolean => {
        return candidate.entityType === entity.entityType;
      },
    );

  if (!product) {
    return null;
  }

  const identity: unknown =
    entity.identifyingAttributes?.[product.identityAttribute] ||
    entity.displayName;

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (typeof identity !== "string" || !identity.trim() || !projectId) {
    return null;
  }

  try {
    const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
      modelType: product.modelType,
      query: {
        projectId: projectId,
        [product.identityColumn]: identity.trim(),
      } as Query<BaseModel>,
      select: { _id: true },
      sort: {},
      skip: 0,
      limit: 1,
    });

    const id: string | undefined = result.data[0]?._id?.toString();

    if (!id) {
      return null;
    }

    return {
      route: resourceTopologyRoute(product.page, id),
      text: product.linkText,
    };
  } catch {
    return null;
  }
}
