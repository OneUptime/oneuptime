import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getKubernetesBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTERS, [
      "Project",
      "Kubernetes",
      "Clusters",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW, [
      "Project",
      "Kubernetes",
      "View Cluster",
    ]),

    // Namespaces
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES,
      ["Project", "Kubernetes", "View Cluster", "Namespaces"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL,
      [
        "Project",
        "Kubernetes",
        "View Cluster",
        "Namespaces",
        "Namespace Detail",
      ],
    ),

    // Pods
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW_PODS, [
      "Project",
      "Kubernetes",
      "View Cluster",
      "Pods",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
      ["Project", "Kubernetes", "View Cluster", "Pods", "Pod Detail"],
    ),

    // Deployments
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS,
      ["Project", "Kubernetes", "View Cluster", "Deployments"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
      [
        "Project",
        "Kubernetes",
        "View Cluster",
        "Deployments",
        "Deployment Detail",
      ],
    ),

    // StatefulSets
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS,
      ["Project", "Kubernetes", "View Cluster", "StatefulSets"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
      [
        "Project",
        "Kubernetes",
        "View Cluster",
        "StatefulSets",
        "StatefulSet Detail",
      ],
    ),

    // DaemonSets
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS,
      ["Project", "Kubernetes", "View Cluster", "DaemonSets"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL,
      [
        "Project",
        "Kubernetes",
        "View Cluster",
        "DaemonSets",
        "DaemonSet Detail",
      ],
    ),

    // Jobs
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW_JOBS, [
      "Project",
      "Kubernetes",
      "View Cluster",
      "Jobs",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL,
      ["Project", "Kubernetes", "View Cluster", "Jobs", "Job Detail"],
    ),

    // CronJobs
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS, [
      "Project",
      "Kubernetes",
      "View Cluster",
      "CronJobs",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL,
      ["Project", "Kubernetes", "View Cluster", "CronJobs", "CronJob Detail"],
    ),

    // Nodes
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW_NODES, [
      "Project",
      "Kubernetes",
      "View Cluster",
      "Nodes",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
      ["Project", "Kubernetes", "View Cluster", "Nodes", "Node Detail"],
    ),

    // Containers
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINERS,
      ["Project", "Kubernetes", "View Cluster", "Containers"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINER_DETAIL,
      [
        "Project",
        "Kubernetes",
        "View Cluster",
        "Containers",
        "Container Detail",
      ],
    ),

    // Scaling
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW_HPAS, [
      "Project",
      "Kubernetes",
      "View Cluster",
      "HPAs",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_HPA_DETAIL,
      ["Project", "Kubernetes", "View Cluster", "HPAs", "HPA Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW_VPAS, [
      "Project",
      "Kubernetes",
      "View Cluster",
      "VPAs",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_VPA_DETAIL,
      ["Project", "Kubernetes", "View Cluster", "VPAs", "VPA Detail"],
    ),

    // Observability
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS, [
      "Project",
      "Kubernetes",
      "View Cluster",
      "Events",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_CONTROL_PLANE,
      ["Project", "Kubernetes", "View Cluster", "Control Plane"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_SERVICE_MESH,
      ["Project", "Kubernetes", "View Cluster", "Service Mesh"],
    ),

    // Advanced
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW_DELETE, [
      "Project",
      "Kubernetes",
      "View Cluster",
      "Delete Cluster",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_CLUSTER_VIEW_SETTINGS, [
      "Project",
      "Kubernetes",
      "View Cluster",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.KUBERNETES_CLUSTER_VIEW_DOCUMENTATION,
      ["Project", "Kubernetes", "View Cluster", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_DOCUMENTATION, [
      "Project",
      "Kubernetes",
      "Documentation",
    ]),
  };
  return breadcrumpLinksMap[path];
}
