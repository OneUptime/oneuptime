import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Every routed CLOUD_* page needs a trail here: a page without one renders
 * with no breadcrumbs at all, silently. App/Tests/Dashboard/
 * CloudResourcePages.test.ts enumerates the routed keys and fails by name
 * when one is missing.
 */
export function getCloudBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCES, [
      "Project",
      "Cloud",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_ARCHIVED, [
      "Project",
      "Cloud",
      "Archived",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_SETTINGS_LABEL_RULES, [
      "Project",
      "Cloud",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_SETTINGS_OWNER_RULES, [
      "Project",
      "Cloud",
      "Owner Rules",
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
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCE_VIEW_INSTANCES, [
      "Project",
      "Cloud",
      "View Resource",
      "Instances",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCE_VIEW_FEED, [
      "Project",
      "Cloud",
      "View Resource",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CLOUD_RESOURCE_VIEW_OWNERS, [
      "Project",
      "Cloud",
      "View Resource",
      "Owners",
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
