import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { keyForVMwareVCenter } from "Common/Utils/Telemetry/EntityKey";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { buildVMwareTopology } from "../Builders/VMwareTopology";
import {
  OpenIssuesResult,
  areOpenIssuesUnreadable,
  loadOpenIssues,
} from "../ResourceTopologyIssuesLoader";
import { masterTopologyRouteFor } from "../ResourceTopologyLinks";
import { ResourceTopologyData } from "../ResourceTopologyPage";

/*
 * A vCenter's topology, read the way its own pages read it: the vCenter, its
 * VMwareResource inventory (every kind at once, the columns the map needs),
 * and its open incidents and alerts.
 */

export const VMWARE_TOPOLOGY_SELECT: Record<string, boolean> = {
  kind: true,
  externalId: true,
  name: true,
  datacenterName: true,
  clusterName: true,
  hostName: true,
  resourcePoolName: true,
  resourcePoolPath: true,
  virtualAppName: true,
  vmInstanceUuid: true,
  isTemplate: true,
  isPoweredOn: true,
  latestCpuPercent: true,
  latestMemoryPercent: true,
  latestDiskPercent: true,
  latestDiskBytes: true,
  maxDiskBytes: true,
  cpuReadinessPercent: true,
  memoryBalloonedBytes: true,
  memorySwappedBytes: true,
  hostCount: true,
  effectiveHostCount: true,
  poweredOnHostCount: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
};

export async function loadVMwareTopology(
  vcenterId: ObjectID,
): Promise<ResourceTopologyData> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [vcenter, rows, issues]: [
    VMwareVCenter | null,
    ListResult<VMwareResource>,
    OpenIssuesResult | null,
  ] = await Promise.all([
    ModelAPI.getItem<VMwareVCenter>({
      modelType: VMwareVCenter,
      id: vcenterId,
      select: {
        name: true,
        lastSeenAt: true,
        collectionStatus: true,
      },
    }),
    ModelAPI.getList<VMwareResource>({
      modelType: VMwareResource,
      query: { vmwareVCenterId: vcenterId },
      select: VMWARE_TOPOLOGY_SELECT,
      sort: { externalId: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    projectId
      ? loadOpenIssues({
          projectId: projectId,
          resourceRelation: "vmwareVCenters",
          resourceId: vcenterId,
        })
      : Promise.resolve(null),
  ]);

  const name: string = vcenter?.name || "";

  return {
    arrangements: [
      {
        id: "hosts",
        label: "Hosts and clusters",
        graph: buildVMwareTopology({
          vcenter: {
            id: vcenterId.toString(),
            name: name,
            lastSeenAt: vcenter?.lastSeenAt || null,
            collectionStatus: vcenter?.collectionStatus || null,
          },
          rows: rows.data,
          issues: issues?.records || [],
          now: new Date(),
          totalRows: rows.count,
        }),
      },
    ],
    issuesArePartial: Boolean(issues?.isPartial),
    issuesAreUnreadable: areOpenIssuesUnreadable(issues),
    masterTopologyRoute:
      projectId && name
        ? masterTopologyRouteFor(
            keyForVMwareVCenter(projectId.toString(), name),
          )
        : null,
  };
}
