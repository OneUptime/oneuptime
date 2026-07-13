import PageMap from "../../../Utils/PageMap";
import { BuildBreadcrumbLinksByTitles } from "../../../Utils/Breadcrumbs/Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getNetworkDeviceBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICES, [
      "Project",
      "Network Devices",
      "Devices",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW, [
      "Project",
      "Network Devices",
      "View Device",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_SETTINGS, [
      "Project",
      "Network Devices",
      "View Device",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_DELETE, [
      "Project",
      "Network Devices",
      "View Device",
      "Delete Device",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_ARCHIVED, [
      "Project",
      "Network Devices",
      "Archived",
    ]),
  };
  return breadcrumpLinksMap[path];
}
