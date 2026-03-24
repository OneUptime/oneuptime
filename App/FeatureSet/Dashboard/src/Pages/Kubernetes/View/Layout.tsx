import { getKubernetesBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu, { ResourceCounts } from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../Utils/KubernetesResourceUtils";
import {
  fetchK8sObjectsBatch,
  KubernetesObjectType,
} from "../Utils/KubernetesObjectFetcher";

const KubernetesClusterViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const [resourceCounts, setResourceCounts] = useState<
    ResourceCounts | undefined
  >(undefined);

  useEffect(() => {
    const fetchCounts: () => Promise<void> = async (): Promise<void> => {
      try {
        const cluster: KubernetesCluster | null = await ModelAPI.getItem({
          modelType: KubernetesCluster,
          id: modelId,
          select: { clusterIdentifier: true },
        });

        if (!cluster?.clusterIdentifier) {
          return;
        }

        const ci: string = cluster.clusterIdentifier;

        // Fetch counts for key resources in parallel
        const [
          nodes,
          pods,
          namespaces,
          deployments,
          statefulSets,
          daemonSets,
          jobs,
          cronJobs,
          containers,
        ]: Array<Array<KubernetesResource>> = await Promise.all([
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: ci,
            metricName: "k8s.node.cpu.utilization",
            resourceNameAttribute: "resource.k8s.node.name",
            namespaceAttribute: "resource.k8s.node.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: ci,
            metricName: "k8s.pod.cpu.utilization",
            resourceNameAttribute: "resource.k8s.pod.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: ci,
            metricName: "k8s.pod.cpu.utilization",
            resourceNameAttribute: "resource.k8s.namespace.name",
            namespaceAttribute: "resource.k8s.namespace.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: ci,
            metricName: "k8s.deployment.desired",
            resourceNameAttribute: "resource.k8s.deployment.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: ci,
            metricName: "k8s.statefulset.desired_pods",
            resourceNameAttribute: "resource.k8s.statefulset.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: ci,
            metricName: "k8s.daemonset.desired_scheduled_nodes",
            resourceNameAttribute: "resource.k8s.daemonset.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: ci,
            metricName: "k8s.job.active_pods",
            resourceNameAttribute: "resource.k8s.job.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: ci,
            metricName: "k8s.cronjob.active_jobs",
            resourceNameAttribute: "resource.k8s.cronjob.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: ci,
            metricName: "container.cpu.utilization",
            resourceNameAttribute: "resource.k8s.container.name",
          }),
        ]);

        // Fetch PV/PVC/HPA/VPA counts from k8sobjects logs (they don't have k8s_cluster metrics)
        const [pvcs, pvs, hpas, vpas]: Array<Map<string, KubernetesObjectType>> =
          await Promise.all([
            fetchK8sObjectsBatch({
              clusterIdentifier: ci,
              resourceType: "persistentvolumeclaims",
            }),
            fetchK8sObjectsBatch({
              clusterIdentifier: ci,
              resourceType: "persistentvolumes",
            }),
            fetchK8sObjectsBatch({
              clusterIdentifier: ci,
              resourceType: "horizontalpodautoscalers",
            }),
            fetchK8sObjectsBatch({
              clusterIdentifier: ci,
              resourceType: "verticalpodautoscalers",
            }),
          ]);

        setResourceCounts({
          nodes: nodes?.length ?? 0,
          pods: pods?.length ?? 0,
          namespaces: namespaces?.length ?? 0,
          deployments: deployments?.length ?? 0,
          statefulSets: statefulSets?.length ?? 0,
          daemonSets: daemonSets?.length ?? 0,
          jobs: jobs?.length ?? 0,
          cronJobs: cronJobs?.length ?? 0,
          containers: containers?.length ?? 0,
          pvcs: pvcs?.size ?? 0,
          pvs: pvs?.size ?? 0,
          hpas: hpas?.size ?? 0,
          vpas: vpas?.size ?? 0,
        });
      } catch {
        // Counts are supplementary, don't fail the layout
      }
    };

    fetchCounts().catch(() => {});
  }, []);

  return (
    <ModelPage
      title="Kubernetes Cluster"
      modelType={KubernetesCluster}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getKubernetesBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} resourceCounts={resourceCounts} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default KubernetesClusterViewLayout;
