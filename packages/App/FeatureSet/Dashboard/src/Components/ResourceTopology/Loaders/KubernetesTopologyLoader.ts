import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesContainer from "Common/Models/DatabaseModels/KubernetesContainer";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { keyForKubernetesCluster } from "Common/Utils/Telemetry/EntityKey";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  KUBERNETES_NODES_ARRANGEMENT,
  KUBERNETES_WORKLOADS_ARRANGEMENT,
  KubernetesTopology,
  buildKubernetesTopology,
} from "../Builders/KubernetesTopology";
import { ResourceTopologyTruncation } from "../ResourceTopologyModel";
import {
  OpenIssuesResult,
  loadOpenIssues,
} from "../ResourceTopologyIssuesLoader";
import { masterTopologyRouteFor } from "../ResourceTopologyLinks";
import { ResourceTopologyData } from "../ResourceTopologyPage";

/*
 * A Kubernetes cluster's topology, from the inventory its own pages list:
 * its pods (with the spec that says which node they run on and which
 * claims they mount), every other kind it inventories, the state of every
 * container, and its open incidents and alerts with the inventory rows they
 * are linked to.
 */

export const KUBERNETES_TOPOLOGY_OTHER_KINDS: Array<string> = [
  "Namespace",
  "Node",
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "PersistentVolumeClaim",
  "PersistentVolume",
];

export async function loadKubernetesTopology(
  clusterId: ObjectID,
): Promise<ResourceTopologyData> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [cluster, pods, others, containers, issues]: [
    KubernetesCluster | null,
    ListResult<KubernetesResource>,
    ListResult<KubernetesResource>,
    ListResult<KubernetesContainer>,
    OpenIssuesResult | null,
  ] = await Promise.all([
    ModelAPI.getItem<KubernetesCluster>({
      modelType: KubernetesCluster,
      id: clusterId,
      select: { name: true, clusterIdentifier: true, lastSeenAt: true },
    }),
    ModelAPI.getList<KubernetesResource>({
      modelType: KubernetesResource,
      query: { kubernetesClusterId: clusterId, kind: "Pod" },
      select: {
        _id: true,
        kind: true,
        namespaceKey: true,
        name: true,
        phase: true,
        ownerReferences: true,
        spec: true,
        controllerDeploymentName: true,
        controllerCronJobName: true,
        latestCpuPercent: true,
        latestMemoryBytes: true,
        metricsUpdatedAt: true,
        lastSeenAt: true,
      },
      sort: { namespaceKey: SortOrder.Ascending, name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    ModelAPI.getList<KubernetesResource>({
      modelType: KubernetesResource,
      query: {
        kubernetesClusterId: clusterId,
        kind: new Includes(KUBERNETES_TOPOLOGY_OTHER_KINDS),
      },
      select: {
        _id: true,
        kind: true,
        namespaceKey: true,
        name: true,
        isReady: true,
        hasMemoryPressure: true,
        hasDiskPressure: true,
        hasPidPressure: true,
        ownerReferences: true,
        spec: true,
        status: true,
        latestCpuPercent: true,
        latestMemoryBytes: true,
        metricsUpdatedAt: true,
        lastSeenAt: true,
      },
      sort: { namespaceKey: SortOrder.Ascending, name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    ModelAPI.getList<KubernetesContainer>({
      modelType: KubernetesContainer,
      query: { kubernetesClusterId: clusterId },
      select: {
        _id: true,
        podNamespaceKey: true,
        podName: true,
        name: true,
        state: true,
        reason: true,
        isReady: true,
        restartCount: true,
      },
      sort: { podName: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    projectId
      ? loadOpenIssues({
          projectId: projectId,
          resourceRelation: "kubernetesClusters",
          resourceId: clusterId,
          relations: [
            { name: "kubernetesResources", select: { _id: true } },
            { name: "kubernetesContainers", select: { _id: true } },
          ],
        })
      : Promise.resolve(null),
  ]);

  const truncations: Array<ResourceTopologyTruncation> = [];

  for (const [kind, result] of [
    ["k8s.pod", pods],
    ["k8s.cluster", others],
  ] as Array<[string, ListResult<KubernetesResource>]>) {
    if (result.count > result.data.length) {
      truncations.push({
        kind: kind,
        shown: result.data.length,
        total: result.count,
      });
    }
  }

  const topology: KubernetesTopology = buildKubernetesTopology({
    cluster: {
      id: clusterId.toString(),
      name: cluster?.name || cluster?.clusterIdentifier || "",
      lastSeenAt: cluster?.lastSeenAt || null,
    },
    rows: [...others.data, ...pods.data],
    containers: containers.data,
    issues: issues?.records || [],
    now: new Date(),
    truncations: truncations,
  });

  const identifier: string = cluster?.clusterIdentifier || "";

  return {
    arrangements: [
      {
        id: KUBERNETES_WORKLOADS_ARRANGEMENT,
        label: translationKey("Workloads"),
        graph: topology.workloads,
      },
      {
        id: KUBERNETES_NODES_ARRANGEMENT,
        label: translationKey("Nodes"),
        graph: topology.nodes,
      },
    ],
    issuesArePartial: Boolean(issues?.isPartial),
    masterTopologyRoute:
      projectId && identifier
        ? masterTopologyRouteFor(
            keyForKubernetesCluster(projectId.toString(), identifier),
          )
        : null,
  };
}
