import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getMetricsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS, ["Project", "Metrics"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRIC_VIEW, [
      "Project",
      "Metrics",
      "Metrics Explorer",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.METRICS_DOCUMENTATION, [
      "Project",
      "Metrics",
      "Documentation",
    ]),
  };
  return breadcrumpLinksMap[path];
}
