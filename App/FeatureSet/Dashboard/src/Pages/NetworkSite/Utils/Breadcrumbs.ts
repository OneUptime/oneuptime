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
      "Network Sites",
      "Sites",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_VIEW, [
      "Project",
      "Network Sites",
      "View Site",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_MAP, [
      "Project",
      "Network Sites",
      "Network Map",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_ASSIGNMENT_RULES, [
      "Project",
      "Network Sites",
      "Assignment Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_LINKS, [
      "Project",
      "Network Sites",
      "Links",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_IMPORT, [
      "Project",
      "Network Sites",
      "Import",
    ]),
  };
  return breadcrumpLinksMap[path];
}
