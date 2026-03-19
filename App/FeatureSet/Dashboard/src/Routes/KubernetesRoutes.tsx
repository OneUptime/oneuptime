import ComponentProps from "../Pages/PageComponentProps";
import KubernetesLayout from "../Pages/Kubernetes/Layout";
import KubernetesClusterViewLayout from "../Pages/Kubernetes/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, KubernetesRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import KubernetesClusters from "../Pages/Kubernetes/Clusters";
import KubernetesClusterView from "../Pages/Kubernetes/View/Index";
import KubernetesClusterViewNamespaces from "../Pages/Kubernetes/View/Namespaces";
import KubernetesClusterViewNamespaceDetail from "../Pages/Kubernetes/View/NamespaceDetail";
import KubernetesClusterViewPods from "../Pages/Kubernetes/View/Pods";
import KubernetesClusterViewPodDetail from "../Pages/Kubernetes/View/PodDetail";
import KubernetesClusterViewDeployments from "../Pages/Kubernetes/View/Deployments";
import KubernetesClusterViewDeploymentDetail from "../Pages/Kubernetes/View/DeploymentDetail";
import KubernetesClusterViewStatefulSets from "../Pages/Kubernetes/View/StatefulSets";
import KubernetesClusterViewStatefulSetDetail from "../Pages/Kubernetes/View/StatefulSetDetail";
import KubernetesClusterViewDaemonSets from "../Pages/Kubernetes/View/DaemonSets";
import KubernetesClusterViewDaemonSetDetail from "../Pages/Kubernetes/View/DaemonSetDetail";
import KubernetesClusterViewJobs from "../Pages/Kubernetes/View/Jobs";
import KubernetesClusterViewJobDetail from "../Pages/Kubernetes/View/JobDetail";
import KubernetesClusterViewCronJobs from "../Pages/Kubernetes/View/CronJobs";
import KubernetesClusterViewCronJobDetail from "../Pages/Kubernetes/View/CronJobDetail";
import KubernetesClusterViewNodes from "../Pages/Kubernetes/View/Nodes";
import KubernetesClusterViewNodeDetail from "../Pages/Kubernetes/View/NodeDetail";
import KubernetesClusterViewContainers from "../Pages/Kubernetes/View/Containers";
import KubernetesClusterViewContainerDetail from "../Pages/Kubernetes/View/ContainerDetail";
import KubernetesClusterViewEvents from "../Pages/Kubernetes/View/Events";
import KubernetesClusterViewControlPlane from "../Pages/Kubernetes/View/ControlPlane";
import KubernetesClusterViewDelete from "../Pages/Kubernetes/View/Delete";
import KubernetesClusterViewSettings from "../Pages/Kubernetes/View/Settings";
import KubernetesClusterViewDocumentation from "../Pages/Kubernetes/View/Documentation";
import KubernetesDocumentation from "../Pages/Kubernetes/Documentation";

const KubernetesRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<KubernetesLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <KubernetesClusters
              {...props}
              pageRoute={RouteMap[PageMap.KUBERNETES_CLUSTERS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.KUBERNETES_DOCUMENTATION)}
          element={
            <KubernetesDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.KUBERNETES_DOCUMENTATION] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={KubernetesRoutePath[PageMap.KUBERNETES_CLUSTER_VIEW] || ""}
        element={<KubernetesClusterViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <KubernetesClusterView
              {...props}
              pageRoute={RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW] as Route}
            />
          }
        />

        {/* Namespaces */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES,
          )}
          element={
            <KubernetesClusterViewNamespaces
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL,
            2,
          )}
          element={
            <KubernetesClusterViewNamespaceDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* Pods */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_PODS,
          )}
          element={
            <KubernetesClusterViewPods
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_PODS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
            2,
          )}
          element={
            <KubernetesClusterViewPodDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL] as Route
              }
            />
          }
        />

        {/* Deployments */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS,
          )}
          element={
            <KubernetesClusterViewDeployments
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
            2,
          )}
          element={
            <KubernetesClusterViewDeploymentDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* StatefulSets */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS,
          )}
          element={
            <KubernetesClusterViewStatefulSets
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
            2,
          )}
          element={
            <KubernetesClusterViewStatefulSetDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* DaemonSets */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS,
          )}
          element={
            <KubernetesClusterViewDaemonSets
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL,
            2,
          )}
          element={
            <KubernetesClusterViewDaemonSetDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* Jobs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_JOBS,
          )}
          element={
            <KubernetesClusterViewJobs
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_JOBS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL,
            2,
          )}
          element={
            <KubernetesClusterViewJobDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL] as Route
              }
            />
          }
        />

        {/* CronJobs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS,
          )}
          element={
            <KubernetesClusterViewCronJobs
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL,
            2,
          )}
          element={
            <KubernetesClusterViewCronJobDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* Nodes */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_NODES,
          )}
          element={
            <KubernetesClusterViewNodes
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NODES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
            2,
          )}
          element={
            <KubernetesClusterViewNodeDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL] as Route
              }
            />
          }
        />

        {/* Containers */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINERS,
          )}
          element={
            <KubernetesClusterViewContainers
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINERS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINER_DETAIL,
            2,
          )}
          element={
            <KubernetesClusterViewContainerDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINER_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* Events */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS,
          )}
          element={
            <KubernetesClusterViewEvents
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS] as Route
              }
            />
          }
        />

        {/* Control Plane */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_CONTROL_PLANE,
          )}
          element={
            <KubernetesClusterViewControlPlane
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CONTROL_PLANE] as Route
              }
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_SETTINGS,
          )}
          element={
            <KubernetesClusterViewSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_DELETE,
          )}
          element={
            <KubernetesClusterViewDelete
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DELETE] as Route
              }
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.KUBERNETES_CLUSTER_VIEW_DOCUMENTATION,
          )}
          element={
            <KubernetesClusterViewDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default KubernetesRoutes;
