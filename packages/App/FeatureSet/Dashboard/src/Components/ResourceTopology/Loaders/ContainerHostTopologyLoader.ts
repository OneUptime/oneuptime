import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerResource from "Common/Models/DatabaseModels/DockerResource";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import PodmanResource from "Common/Models/DatabaseModels/PodmanResource";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import EntityType from "Common/Types/Telemetry/EntityType";
import { keyForInventoryEntity } from "Common/Utils/Telemetry/EntityKey";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  ContainerHostResourceRow,
  buildContainerHostTopology,
} from "../Builders/ContainerHostTopology";
import { ResourceTopologyTruncation } from "../ResourceTopologyModel";
import {
  OpenIssuesResult,
  loadOpenIssues,
} from "../ResourceTopologyIssuesLoader";
import { masterTopologyRouteFor } from "../ResourceTopologyLinks";
import { ResourceTopologyData } from "../ResourceTopologyPage";

/*
 * A Docker or Podman host's topology: the host, its inventory (containers,
 * images, networks, volumes — the rows its pages and dashboards list), and
 * its open incidents and alerts with the containers they are linked to.
 */

const RESOURCE_SELECT: Record<string, boolean> = {
  _id: true,
  kind: true,
  name: true,
  containerId: true,
  imageName: true,
  state: true,
  labels: true,
  latestCpuPercent: true,
  latestMemoryBytes: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
};

function truncationsOf(
  result: ListResult<DockerResource> | ListResult<PodmanResource>,
): Array<ResourceTopologyTruncation> {
  return result.count > result.data.length
    ? [
        {
          kind: "container.container",
          shown: result.data.length,
          total: result.count,
        },
      ]
    : [];
}

export async function loadDockerHostTopology(
  hostId: ObjectID,
): Promise<ResourceTopologyData> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [host, rows, issues]: [
    DockerHost | null,
    ListResult<DockerResource>,
    OpenIssuesResult | null,
  ] = await Promise.all([
    ModelAPI.getItem<DockerHost>({
      modelType: DockerHost,
      id: hostId,
      select: { name: true, lastSeenAt: true },
    }),
    ModelAPI.getList<DockerResource>({
      modelType: DockerResource,
      query: { dockerHostId: hostId },
      select: RESOURCE_SELECT,
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    projectId
      ? loadOpenIssues({
          projectId: projectId,
          resourceRelation: "dockerHosts",
          resourceId: hostId,
          relations: [{ name: "dockerResources", select: { _id: true } }],
        })
      : Promise.resolve(null),
  ]);

  return {
    arrangements: [
      {
        id: "host",
        label: "Host",
        graph: buildContainerHostTopology({
          product: "docker",
          host: {
            id: hostId.toString(),
            name: host?.name || "",
            lastSeenAt: host?.lastSeenAt || null,
          },
          rows: rows.data as Array<ContainerHostResourceRow>,
          issues: issues?.records || [],
          now: new Date(),
          truncations: truncationsOf(rows),
        }),
      },
    ],
    issuesArePartial: Boolean(issues?.isPartial),
    masterTopologyRoute: projectId
      ? masterTopologyRouteFor(
          keyForInventoryEntity(
            projectId.toString(),
            EntityType.DockerHost,
            hostId.toString(),
          ),
        )
      : null,
  };
}

export async function loadPodmanHostTopology(
  hostId: ObjectID,
): Promise<ResourceTopologyData> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [host, rows, issues]: [
    PodmanHost | null,
    ListResult<PodmanResource>,
    OpenIssuesResult | null,
  ] = await Promise.all([
    ModelAPI.getItem<PodmanHost>({
      modelType: PodmanHost,
      id: hostId,
      select: { name: true, lastSeenAt: true },
    }),
    ModelAPI.getList<PodmanResource>({
      modelType: PodmanResource,
      query: { podmanHostId: hostId },
      select: RESOURCE_SELECT,
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    projectId
      ? loadOpenIssues({
          projectId: projectId,
          resourceRelation: "podmanHosts",
          resourceId: hostId,
          relations: [{ name: "podmanResources", select: { _id: true } }],
        })
      : Promise.resolve(null),
  ]);

  return {
    arrangements: [
      {
        id: "host",
        label: "Host",
        graph: buildContainerHostTopology({
          product: "podman",
          host: {
            id: hostId.toString(),
            name: host?.name || "",
            lastSeenAt: host?.lastSeenAt || null,
          },
          rows: rows.data as Array<ContainerHostResourceRow>,
          issues: issues?.records || [],
          now: new Date(),
          truncations: truncationsOf(rows),
        }),
      },
    ],
    issuesArePartial: Boolean(issues?.isPartial),
    masterTopologyRoute: projectId
      ? masterTopologyRouteFor(
          keyForInventoryEntity(
            projectId.toString(),
            EntityType.PodmanHost,
            hostId.toString(),
          ),
        )
      : null,
  };
}
