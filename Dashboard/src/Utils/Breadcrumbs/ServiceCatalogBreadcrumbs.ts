import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getServiceCatalogBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG, [
      "Project",
      "Service Catalog",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_DEPENDENCY_GRAPH, [
      "Project",
      "Service Catalog",
      "Dependency Graph",
    ]),
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
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_ALERTS, [
      "Project",
      "Service Catalog",
      "View Service",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_INCIDENTS, [
      "Project",
      "Service Catalog",
      "View Service",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_LOGS, [
      "Project",
      "Service Catalog",
      "View Service",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_TRACES, [
      "Project",
      "Service Catalog",
      "View Service",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_CATALOG_VIEW_METRICS, [
      "Project",
      "Service Catalog",
      "View Service",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVICE_CATALOG_VIEW_TELEMETRY_SERVICES,
      ["Project", "Service Catalog", "View Service", "Telemetry"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVICE_CATALOG_VIEW_CODE_REPOSITORIES,
      ["Project", "Service Catalog", "View Service", "Code Repositories"],
    ),
  };
  return breadcrumpLinksMap[path];
}
