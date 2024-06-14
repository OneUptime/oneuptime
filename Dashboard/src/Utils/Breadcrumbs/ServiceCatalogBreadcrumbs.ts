import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getServiceCatalogBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW, [
      "Project",
      "Service Catalog",
      "View Service",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_OWNERS, [
      "Project",
      "Service Catalog",
      "View Service",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_DELETE, [
      "Project",
      "Service Catalog",
      "View Service",
      "Delete Service",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_SETTINGS, [
      "Project",
      "Service Catalog",
      "View Service",
      "Settings",
    ]),
  };
  return breadcrumpLinksMap[path];
}
