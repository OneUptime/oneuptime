import { getKubernetesBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import { ResourceCounts } from "./SideMenu";
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
