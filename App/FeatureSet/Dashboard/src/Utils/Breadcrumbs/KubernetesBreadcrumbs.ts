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
