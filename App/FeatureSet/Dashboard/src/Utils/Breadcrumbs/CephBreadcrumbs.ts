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
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_OSD_DETAIL, [
      "Project",
      "Ceph",
      "View Cluster",
      "OSDs",
      "OSD Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_POOLS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Pools",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL, [
      "Project",
      "Ceph",
      "View Cluster",
      "Pools",
      "Pool Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_DAEMONS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Daemons",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_INSIGHTS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_CLUSTER_LOG, [
      "Project",
      "Ceph",
      "View Cluster",
      "Cluster Log",
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
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_INCIDENTS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_ALERTS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.CEPH_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "Ceph", "View Cluster", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_OWNERS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_CLUSTER_VIEW_AUDIT_LOGS, [
      "Project",
      "Ceph",
      "View Cluster",
      "Audit Logs",
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

    // Ceph Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_SETTINGS_OWNER_RULES, [
      "Project",
      "Ceph",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CEPH_SETTINGS_LABEL_RULES, [
      "Project",
      "Ceph",
      "Settings",
      "Label Rules",
    ]),
  };
  return breadcrumpLinksMap[path];
}
