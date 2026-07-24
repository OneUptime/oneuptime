import PageMap from "../../../Utils/PageMap";
import { BuildBreadcrumbLinksByTitles } from "../../../Utils/Breadcrumbs/Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getNetworkDeviceBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_OVERVIEW, [
      "Project",
      "Network",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICES, [
      "Project",
      "Network",
      "Devices",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW, [
      "Project",
      "Network",
      "View Device",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_INTERFACES, [
      "Project",
      "Network",
      "View Device",
      "Interfaces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_METRICS, [
      "Project",
      "Network",
      "View Device",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_TRAFFIC, [
      "Project",
      "Network",
      "View Device",
      "Traffic",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_MONITORS, [
      "Project",
      "Network",
      "View Device",
      "Monitors",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_OWNERS, [
      "Project",
      "Network",
      "View Device",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_SETTINGS, [
      "Project",
      "Network",
      "View Device",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_DELETE, [
      "Project",
      "Network",
      "View Device",
      "Delete Device",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_ARCHIVED, [
      "Project",
      "Network",
      "Archived Devices",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_DISCOVERY, [
      "Project",
      "Network",
      "Discovery",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_ENDPOINTS, [
      "Project",
      "Network",
      "Endpoints",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_TOPOLOGY, [
      "Project",
      "Network",
      "Topology",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_LATENCY_MATRIX, [
      "Project",
      "Network",
      "Latency Matrix",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULES,
      ["Project", "Network", "Owner Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.NETWORK_DEVICE_SETTINGS_LABEL_RULES,
      ["Project", "Network", "Label Rules"],
    ),
  };
  return breadcrumpLinksMap[path];
}
