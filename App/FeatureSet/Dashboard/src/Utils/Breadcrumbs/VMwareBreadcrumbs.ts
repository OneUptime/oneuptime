import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getVMwareBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTERS, [
      "Project",
      "VMware",
      "vCenters",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW, [
      "Project",
      "VMware",
      "View vCenter",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_HOSTS, [
      "Project",
      "VMware",
      "View vCenter",
      "Hosts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL, [
      "Project",
      "VMware",
      "View vCenter",
      "Hosts",
      "Host Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES,
      ["Project", "VMware", "View vCenter", "Virtual Machines"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL,
      [
        "Project",
        "VMware",
        "View vCenter",
        "Virtual Machines",
        "Virtual Machine Detail",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_DATASTORES, [
      "Project",
      "VMware",
      "View vCenter",
      "Datastores",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.VMWARE_VCENTER_VIEW_DATASTORE_DETAIL,
      ["Project", "VMware", "View vCenter", "Datastores", "Datastore Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_CLUSTERS, [
      "Project",
      "VMware",
      "View vCenter",
      "Clusters",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL,
      ["Project", "VMware", "View vCenter", "Clusters", "Cluster Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.VMWARE_VCENTER_VIEW_RESOURCE_POOLS,
      ["Project", "VMware", "View vCenter", "Resource Pools"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_INSIGHTS, [
      "Project",
      "VMware",
      "View vCenter",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.VMWARE_VCENTER_VIEW_RECOMMENDATIONS,
      ["Project", "VMware", "View vCenter", "Recommendations"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_METRICS, [
      "Project",
      "VMware",
      "View vCenter",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_LOGS, [
      "Project",
      "VMware",
      "View vCenter",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_INCIDENTS, [
      "Project",
      "VMware",
      "View vCenter",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_ALERTS, [
      "Project",
      "VMware",
      "View vCenter",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.VMWARE_VCENTER_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "VMware", "View vCenter", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_OWNERS, [
      "Project",
      "VMware",
      "View vCenter",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_FEED, [
      "Project",
      "VMware",
      "View vCenter",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_AUDIT_LOGS, [
      "Project",
      "VMware",
      "View vCenter",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_SETTINGS, [
      "Project",
      "VMware",
      "View vCenter",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_DELETE, [
      "Project",
      "VMware",
      "View vCenter",
      "Delete vCenter",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_VCENTER_VIEW_DOCUMENTATION, [
      "Project",
      "VMware",
      "View vCenter",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_DOCUMENTATION, [
      "Project",
      "VMware",
      "Documentation",
    ]),

    // VMware Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_SETTINGS_OWNER_RULES, [
      "Project",
      "VMware",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.VMWARE_SETTINGS_LABEL_RULES, [
      "Project",
      "VMware",
      "Settings",
      "Label Rules",
    ]),
  };
  return breadcrumpLinksMap[path];
}
