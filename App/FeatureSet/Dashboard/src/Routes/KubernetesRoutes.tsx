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
import KubernetesClusterViewPods from "../Pages/Kubernetes/View/Pods";
import KubernetesClusterViewPodDetail from "../Pages/Kubernetes/View/PodDetail";
import KubernetesClusterViewNodes from "../Pages/Kubernetes/View/Nodes";
import KubernetesClusterViewNodeDetail from "../Pages/Kubernetes/View/NodeDetail";
import KubernetesClusterViewEvents from "../Pages/Kubernetes/View/Events";
import KubernetesClusterViewControlPlane from "../Pages/Kubernetes/View/ControlPlane";
import KubernetesClusterViewDelete from "../Pages/Kubernetes/View/Delete";
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
