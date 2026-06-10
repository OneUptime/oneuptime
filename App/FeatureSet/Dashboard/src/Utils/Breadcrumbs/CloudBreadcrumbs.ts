import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getCloudBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCES, [
      "Project",
      "Cloud",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCE_VIEW, [
      "Project",
      "Cloud",
      "View Resource",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCE_VIEW_METRICS, [
      "Project",
      "Cloud",
      "View Resource",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCE_VIEW_LOGS, [
      "Project",
      "Cloud",
      "View Resource",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCE_VIEW_TRACES, [
      "Project",
      "Cloud",
      "View Resource",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION, [
      "Project",
      "Cloud",
      "View Resource",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCE_VIEW_DELETE, [
      "Project",
      "Cloud",
      "View Resource",
      "Delete Resource",
    ]),
  };
  return breadcrumpLinksMap[path];
}
