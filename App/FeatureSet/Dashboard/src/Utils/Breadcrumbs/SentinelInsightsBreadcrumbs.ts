import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getSentinelInsightsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SENTINEL_INSIGHTS, [
      "Project",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SENTINEL_INSIGHT_VIEW, [
      "Project",
      "Insights",
      "View Insight",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SENTINEL_INSIGHTS_SETTINGS, [
      "Project",
      "Insights",
      "Settings",
    ]),
  };
  return breadcrumpLinksMap[path];
}
