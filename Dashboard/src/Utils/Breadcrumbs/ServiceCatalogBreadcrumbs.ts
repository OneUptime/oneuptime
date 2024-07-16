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
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_DEPENDENCIES, [
      "Project",
      "Service Catalog",
      "View Service",
      "Dependencies",
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
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_MONITORS, [
      "Project",
      "Service Catalog",
      "View Service",
      "Monitors",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_INCIDENTS, [
      "Project",
      "Service Catalog",
      "View Service",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVICE_CATALOG_VIEW_TELEMETRY_SERVICES,
      ["Project", "Service Catalog", "View Service", "Telemetry"],
    ),
  };
  return breadcrumpLinksMap[path];
}
