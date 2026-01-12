import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getServiceBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICES, ["Project", "Services"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_DEPENDENCY_GRAPH, [
      "Project",
      "Services",
      "Dependency Graph",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW, [
      "Project",
      "Services",
      "View Service",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_OWNERS, [
      "Project",
      "Services",
      "View Service",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_DEPENDENCIES, [
      "Project",
      "Services",
      "View Service",
      "Dependencies",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_DELETE, [
      "Project",
      "Services",
      "View Service",
      "Delete Service",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_SETTINGS, [
      "Project",
      "Services",
      "View Service",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_MONITORS, [
      "Project",
      "Services",
      "View Service",
      "Monitors",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_ALERTS, [
      "Project",
      "Services",
      "View Service",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_INCIDENTS, [
      "Project",
      "Services",
      "View Service",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_LOGS, [
      "Project",
      "Services",
      "View Service",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_TRACES, [
      "Project",
      "Services",
      "View Service",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_METRICS, [
      "Project",
      "Services",
      "View Service",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVICE_VIEW_CODE_REPOSITORIES, [
      "Project",
      "Services",
      "View Service",
      "Code Repositories",
    ]),
  };
  return breadcrumpLinksMap[path];
}
