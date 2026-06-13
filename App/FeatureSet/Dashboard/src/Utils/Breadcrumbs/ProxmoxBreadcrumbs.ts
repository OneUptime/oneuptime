import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getProxmoxBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTERS, [
      "Project",
      "Proxmox",
      "Clusters",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW, [
      "Project",
      "Proxmox",
      "View Cluster",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_NODES, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Nodes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_NODE_DETAIL, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Nodes",
      "Node Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_GUESTS, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Guests",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Guests",
      "Guest Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_STORAGE, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Storage",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.PROXMOX_CLUSTER_VIEW_STORAGE_DETAIL,
      ["Project", "Proxmox", "View Cluster", "Storage", "Storage Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_INSIGHTS, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_METRICS, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_LOGS, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_INCIDENTS, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_ALERTS, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.PROXMOX_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "Proxmox", "View Cluster", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_OWNERS, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_AUDIT_LOGS, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_SETTINGS, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_CLUSTER_VIEW_DELETE, [
      "Project",
      "Proxmox",
      "View Cluster",
      "Delete Cluster",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.PROXMOX_CLUSTER_VIEW_DOCUMENTATION,
      ["Project", "Proxmox", "View Cluster", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_DOCUMENTATION, [
      "Project",
      "Proxmox",
      "Documentation",
    ]),

    // Proxmox Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_SETTINGS_OWNER_RULES, [
      "Project",
      "Proxmox",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROXMOX_SETTINGS_LABEL_RULES, [
      "Project",
      "Proxmox",
      "Settings",
      "Label Rules",
    ]),
  };
  return breadcrumpLinksMap[path];
}
