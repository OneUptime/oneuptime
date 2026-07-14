import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getAIInsightsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_INSIGHTS, [
      "Project",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_INSIGHT_VIEW, [
      "Project",
      "Insights",
      "View Insight",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_INSIGHTS_SETTINGS, [
      "Project",
      "Insights",
      "Settings",
    ]),
  };
  return breadcrumpLinksMap[path];
}
