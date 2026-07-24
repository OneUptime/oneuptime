import PageMap from "../../../Utils/PageMap";
import { BuildBreadcrumbLinksByTitles } from "../../../Utils/Breadcrumbs/Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getNetworkSiteBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITES, [
      "Project",
      "Network",
      "Sites",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_VIEW, [
      "Project",
      "Network",
      "View Site",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_VIEW_DEVICES, [
      "Project",
      "Network",
      "View Site",
      "Devices",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_VIEW_CHILD_SITES, [
      "Project",
      "Network",
      "View Site",
      "Child Sites",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_VIEW_ENDPOINTS, [
      "Project",
      "Network",
      "View Site",
      "Endpoints",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_VIEW_STATUS_TIMELINE, [
      "Project",
      "Network",
      "View Site",
      "Status Timeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_VIEW_SETTINGS, [
      "Project",
      "Network",
      "View Site",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_VIEW_DELETE, [
      "Project",
      "Network",
      "View Site",
      "Delete Site",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_MAP, [
      "Project",
      "Network",
      "Network Map",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_ASSIGNMENT_RULES, [
      "Project",
      "Network",
      "Site Assignment Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_LINKS, [
      "Project",
      "Network",
      "Site Links",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_IMPORT, [
      "Project",
      "Network",
      "Import Sites",
    ]),
  };
  return breadcrumpLinksMap[path];
}
