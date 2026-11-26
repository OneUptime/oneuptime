import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getAIInsightsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  /*
   * The product's name, as the products menu and the page's title say it:
   * the trail said "Insights" under a page titled AI Insights (#7474).
   */
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_INSIGHTS, [
      "Project",
      "AI Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_INSIGHT_VIEW, [
      "Project",
      "AI Insights",
      "View Insight",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_INSIGHTS_SETTINGS, [
      "Project",
      "AI Insights",
      "Settings",
    ]),
  };
  return breadcrumpLinksMap[path];
}
