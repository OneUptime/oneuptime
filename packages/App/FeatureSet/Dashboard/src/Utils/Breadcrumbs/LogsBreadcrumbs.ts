import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getLogsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS, ["Project", "Logs"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS_INSIGHTS, [
      "Project",
      "Logs",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS_DOCUMENTATION, [
      "Project",
      "Logs",
      "Setup Guide",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS_SETTINGS_PIPELINES, [
      "Project",
      "Logs",
      "Settings",
      "Pipelines",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS_SETTINGS_PIPELINE_VIEW, [
      "Project",
      "Logs",
      "Settings",
      "Pipelines",
      "View",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS_SETTINGS_DROP_FILTERS, [
      "Project",
      "Logs",
      "Settings",
      "Drop Filters",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS_SETTINGS_DROP_FILTER_VIEW, [
      "Project",
      "Logs",
      "Settings",
      "Drop Filters",
      "View",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS_SETTINGS_SCRUB_RULES, [
      "Project",
      "Logs",
      "Settings",
      "Scrub Rules",
    ]),
  };
  return breadcrumpLinksMap[path];
}
