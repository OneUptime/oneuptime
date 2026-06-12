import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getCephBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTERS, [
      "Project",
      "Ceph",
      "Clusters",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW, [
      "Project",
      "Ceph",
      "View Cluster",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_OSDS, [
      "Project",
      "Ceph",
      "View Cluster",
      "OSDs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_POOLS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Pools",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_METRICS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_LOGS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_SETTINGS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_DELETE, [
      "Project",
      "Ceph",
      "View Cluster",
      "Delete Cluster",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_DOCUMENTATION, [
      "Project",
      "Ceph",
      "View Cluster",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_DOCUMENTATION, [
      "Project",
      "Ceph",
      "Documentation",
    ]),
  };
  return breadcrumpLinksMap[path];
}
