import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CephResource from "Common/Models/DatabaseModels/CephResource";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import {
  keyForCephCluster,
  keyForDockerSwarmCluster,
  keyForProxmoxCluster,
  keyForStorageArray,
} from "Common/Utils/Telemetry/EntityKey";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { buildCephTopology } from "../Builders/CephTopology";
import {
  DockerSwarmTopology,
  SWARM_NODES_ARRANGEMENT,
  SWARM_SERVICES_ARRANGEMENT,
  buildDockerSwarmTopology,
} from "../Builders/DockerSwarmTopology";
import { buildProxmoxTopology } from "../Builders/ProxmoxTopology";
import { buildStorageArrayTopology } from "../Builders/StorageArrayTopology";
import { ResourceTopologyTruncation } from "../ResourceTopologyModel";
import {
  OpenIssuesResult,
  loadOpenIssues,
} from "../ResourceTopologyIssuesLoader";
import { masterTopologyRouteFor } from "../ResourceTopologyLinks";
import { ResourceTopologyData } from "../ResourceTopologyPage";

/*
 * The topologies read from one inventory table each: a Docker Swarm
 * cluster's, a Proxmox cluster's, a Ceph cluster's and a storage array's.
 * Each reads its resource, every inventory row (the columns its map needs)
 * and its open incidents and alerts.
 */

interface Loaded<TResource extends BaseModel, TRow extends BaseModel> {
  resource: TResource | null;
  rows: ListResult<TRow>;
  issues: OpenIssuesResult | null;
  projectId: ObjectID | null;
  truncations: Array<ResourceTopologyTruncation>;
}

async function loadInventory<
  TResource extends BaseModel,
  TRow extends BaseModel,
>(data: {
  id: ObjectID;
  resourceType: { new (): TResource };
  resourceSelect: Record<string, boolean>;
  rowType: { new (): TRow };
  rowQuery: Record<string, unknown>;
  rowSelect: Record<string, boolean>;
  relation: string;
  kind: string;
}): Promise<Loaded<TResource, TRow>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [resource, rows, issues]: [
    TResource | null,
    ListResult<TRow>,
    OpenIssuesResult | null,
  ] = await Promise.all([
    ModelAPI.getItem<TResource>({
      modelType: data.resourceType,
      id: data.id,
      select: data.resourceSelect,
    }),
    ModelAPI.getList<TRow>({
      modelType: data.rowType,
      query: data.rowQuery as Query<TRow>,
      select: data.rowSelect,
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    projectId
      ? loadOpenIssues({
          projectId: projectId,
          resourceRelation: data.relation,
          resourceId: data.id,
        })
      : Promise.resolve(null),
  ]);

  return {
    resource: resource,
    rows: rows,
    issues: issues,
    projectId: projectId,
    truncations:
      rows.count > rows.data.length
        ? [{ kind: data.kind, shown: rows.data.length, total: rows.count }]
        : [],
  };
}

export async function loadDockerSwarmTopology(
  clusterId: ObjectID,
): Promise<ResourceTopologyData> {
  const loaded: Loaded<DockerSwarmCluster, DockerSwarmResource> =
    await loadInventory({
      id: clusterId,
      resourceType: DockerSwarmCluster,
      resourceSelect: { name: true, lastSeenAt: true },
      rowType: DockerSwarmResource,
      rowQuery: { dockerSwarmClusterId: clusterId },
      rowSelect: {
        _id: true,
        kind: true,
        externalId: true,
        name: true,
        state: true,
        role: true,
        serviceMode: true,
        desiredReplicas: true,
        runningReplicas: true,
        image: true,
        stackName: true,
        serviceName: true,
        nodeHostname: true,
        driver: true,
        isReady: true,
        attributes: true,
        lastSeenAt: true,
      },
      relation: "dockerSwarmClusters",
      kind: "swarm.cluster",
    });
  const name: string = loaded.resource?.name || "";
  const topology: DockerSwarmTopology = buildDockerSwarmTopology({
    cluster: {
      id: clusterId.toString(),
      name: name,
      lastSeenAt: loaded.resource?.lastSeenAt || null,
    },
    rows: loaded.rows.data,
    issues: loaded.issues?.records || [],
    now: new Date(),
    truncations: loaded.truncations,
  });

  return {
    arrangements: [
      {
        id: SWARM_SERVICES_ARRANGEMENT,
        label: translationKey("Services"),
        graph: topology.services,
      },
      {
        id: SWARM_NODES_ARRANGEMENT,
        label: translationKey("Nodes"),
        graph: topology.nodes,
      },
    ],
    issuesArePartial: Boolean(loaded.issues?.isPartial),
    masterTopologyRoute:
      loaded.projectId && name
        ? masterTopologyRouteFor(
            keyForDockerSwarmCluster(loaded.projectId.toString(), name),
          )
        : null,
  };
}

export async function loadProxmoxTopology(
  clusterId: ObjectID,
): Promise<ResourceTopologyData> {
  const loaded: Loaded<ProxmoxCluster, ProxmoxResource> = await loadInventory({
    id: clusterId,
    resourceType: ProxmoxCluster,
    resourceSelect: { name: true, lastSeenAt: true },
    rowType: ProxmoxResource,
    rowQuery: { proxmoxClusterId: clusterId },
    rowSelect: {
      _id: true,
      kind: true,
      externalId: true,
      name: true,
      vmid: true,
      guestType: true,
      parentNodeName: true,
      isUp: true,
      haState: true,
      onboot: true,
      isBackedUp: true,
      latestCpuPercent: true,
      latestMemoryPercent: true,
      latestDiskBytes: true,
      maxDiskBytes: true,
      metricsUpdatedAt: true,
      lastSeenAt: true,
    },
    relation: "proxmoxClusters",
    kind: "proxmox.cluster",
  });
  const name: string = loaded.resource?.name || "";

  return {
    arrangements: [
      {
        id: "nodes",
        label: translationKey("Nodes"),
        graph: buildProxmoxTopology({
          cluster: {
            id: clusterId.toString(),
            name: name,
            lastSeenAt: loaded.resource?.lastSeenAt || null,
          },
          rows: loaded.rows.data,
          issues: loaded.issues?.records || [],
          now: new Date(),
          truncations: loaded.truncations,
        }),
      },
    ],
    issuesArePartial: Boolean(loaded.issues?.isPartial),
    masterTopologyRoute:
      loaded.projectId && name
        ? masterTopologyRouteFor(
            keyForProxmoxCluster(loaded.projectId.toString(), name),
          )
        : null,
  };
}

export async function loadCephTopology(
  clusterId: ObjectID,
): Promise<ResourceTopologyData> {
  const loaded: Loaded<CephCluster, CephResource> = await loadInventory({
    id: clusterId,
    resourceType: CephCluster,
    resourceSelect: { name: true, lastSeenAt: true, healthStatus: true },
    rowType: CephResource,
    rowQuery: { cephClusterId: clusterId },
    rowSelect: {
      _id: true,
      kind: true,
      externalId: true,
      name: true,
      hostname: true,
      daemonVersion: true,
      deviceClass: true,
      isUp: true,
      isIn: true,
      inQuorum: true,
      statBytes: true,
      statBytesUsed: true,
      storedBytes: true,
      maxAvailBytes: true,
      metricsUpdatedAt: true,
      lastSeenAt: true,
    },
    relation: "cephClusters",
    kind: "ceph.cluster",
  });
  const name: string = loaded.resource?.name || "";

  return {
    arrangements: [
      {
        id: "hosts",
        label: translationKey("Hosts"),
        graph: buildCephTopology({
          cluster: {
            id: clusterId.toString(),
            name: name,
            lastSeenAt: loaded.resource?.lastSeenAt || null,
            healthStatus: loaded.resource?.healthStatus ?? null,
          },
          rows: loaded.rows.data,
          issues: loaded.issues?.records || [],
          now: new Date(),
          truncations: loaded.truncations,
        }),
      },
    ],
    issuesArePartial: Boolean(loaded.issues?.isPartial),
    masterTopologyRoute:
      loaded.projectId && name
        ? masterTopologyRouteFor(
            keyForCephCluster(loaded.projectId.toString(), name),
          )
        : null,
  };
}

export async function loadStorageArrayTopology(
  arrayId: ObjectID,
): Promise<ResourceTopologyData> {
  const loaded: Loaded<StorageArray, StorageArrayResource> =
    await loadInventory({
      id: arrayId,
      resourceType: StorageArray,
      resourceSelect: { name: true, lastSeenAt: true, openAlertCount: true },
      rowType: StorageArrayResource,
      rowQuery: { storageArrayId: arrayId },
      rowSelect: {
        _id: true,
        kind: true,
        externalId: true,
        name: true,
        status: true,
        statusDetail: true,
        componentType: true,
        model: true,
        groupName: true,
        capacityBytes: true,
        usedBytes: true,
        lastSeenAt: true,
      },
      relation: "storageArrays",
      kind: "storage.array",
    });
  const name: string = loaded.resource?.name || "";

  return {
    arrangements: [
      {
        id: "array",
        label: translationKey("Storage Array"),
        graph: buildStorageArrayTopology({
          array: {
            id: arrayId.toString(),
            name: name,
            lastSeenAt: loaded.resource?.lastSeenAt || null,
            openAlertCount: loaded.resource?.openAlertCount ?? null,
          },
          rows: loaded.rows.data,
          issues: loaded.issues?.records || [],
          now: new Date(),
          truncations: loaded.truncations,
        }),
      },
    ],
    issuesArePartial: Boolean(loaded.issues?.isPartial),
    masterTopologyRoute:
      loaded.projectId && name
        ? masterTopologyRouteFor(
            keyForStorageArray(loaded.projectId.toString(), name),
          )
        : null,
  };
}
