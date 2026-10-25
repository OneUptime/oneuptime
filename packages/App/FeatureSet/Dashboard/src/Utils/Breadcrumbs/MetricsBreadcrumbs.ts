import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getMetricsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS, ["Project", "Metrics"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_INSIGHTS, [
      "Project",
      "Metrics",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRIC_VIEW, [
      "Project",
      "Metrics",
      "Metric Explorer",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_DOCUMENTATION, [
      "Project",
      "Metrics",
      "Setup Guide",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_SETTINGS_PIPELINE_RULES, [
      "Project",
      "Metrics",
      "Settings",
      "Pipeline Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_SETTINGS_RECORDING_RULES, [
      "Project",
      "Metrics",
      "Settings",
      "Recording Rules",
    ]),
    // The AI section's pages name the tab and the menu section they live in.
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_AI_INSIGHTS, [
      "Project",
      "Metrics",
      "AI",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_AI_INSIGHT_VIEW, [
      "Project",
      "Metrics",
      "AI",
      "Insights",
      "Insight",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_AI_LOGS, [
      "Project",
      "Metrics",
      "AI",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_AI_SETTINGS, [
      "Project",
      "Metrics",
      "AI",
      "Settings",
    ]),
  };
  return breadcrumpLinksMap[path];
}
