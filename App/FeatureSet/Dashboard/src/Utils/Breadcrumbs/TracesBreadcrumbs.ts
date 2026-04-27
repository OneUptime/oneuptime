import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getTracesBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES, ["Project", "Traces"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_INSIGHTS, [
      "Project",
      "Traces",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACE_VIEW, [
      "Project",
      "Traces",
      "Trace Details",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_DOCUMENTATION, [
      "Project",
      "Traces",
      "Setup Guide",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_SETTINGS_PIPELINES, [
      "Project",
      "Traces",
      "Settings",
      "Pipelines",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_SETTINGS_PIPELINE_VIEW, [
      "Project",
      "Traces",
      "Settings",
      "Pipelines",
      "View",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_SETTINGS_DROP_FILTERS, [
      "Project",
      "Traces",
      "Settings",
      "Drop Filters",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_SETTINGS_DROP_FILTER_VIEW, [
      "Project",
      "Traces",
      "Settings",
      "Drop Filters",
      "View",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_SETTINGS_SCRUB_RULES, [
      "Project",
      "Traces",
      "Settings",
      "Scrub Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_SETTINGS_RECORDING_RULES, [
      "Project",
      "Traces",
      "Settings",
      "Recording Rules",
    ]),
  };
  return breadcrumpLinksMap[path];
}
