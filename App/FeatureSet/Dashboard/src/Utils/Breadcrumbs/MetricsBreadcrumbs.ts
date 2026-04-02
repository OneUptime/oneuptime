import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getMetricsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS, ["Project", "Metrics"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_LIST, [
      "Project",
      "Metrics",
      "All Metrics",
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
  };
  return breadcrumpLinksMap[path];
}
