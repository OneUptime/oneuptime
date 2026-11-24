import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getServerlessBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  /*
   * The product's step says Serverless, as its products menu entry and its
   * page's title do: it said "Serverless Functions" (#7474).
   */
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTIONS, [
      "Project",
      "Serverless",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW, [
      "Project",
      "Serverless",
      "View Function",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_FUNCTION_VIEW_RECOMMENDATIONS,
      ["Project", "Serverless", "View Function", "Recommendations"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_SETTINGS, [
      "Project",
      "Serverless",
      "View Function",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_METRICS, [
      "Project",
      "Serverless",
      "View Function",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_LOGS, [
      "Project",
      "Serverless",
      "View Function",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_FUNCTION_VIEW_SECURITY_EVENTS,
      ["Project", "Serverless", "View Function", "Security Events"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_TRACES, [
      "Project",
      "Serverless",
      "View Function",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_FUNCTION_VIEW_DOCUMENTATION,
      ["Project", "Serverless", "View Function", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_FUNCTION_VIEW_AUDIT_LOGS,
      ["Project", "Serverless", "View Function", "Audit Logs"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_DELETE, [
      "Project",
      "Serverless",
      "View Function",
      "Delete Function",
    ]),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_FUNCTION_VIEW_INSTANCES,
      ["Project", "Serverless", "View Function", "Instances"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_SETTINGS_OWNER_RULES, [
      "Project",
      "Serverless",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_SETTINGS_OWNER_RULE_VIEW,
      ["Project", "Serverless", "Settings", "Owner Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_SETTINGS_LABEL_RULES, [
      "Project",
      "Serverless",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_SETTINGS_LABEL_RULE_VIEW,
      ["Project", "Serverless", "Settings", "Label Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_ARCHIVED, [
      "Project",
      "Serverless",
      "Archived",
    ]),
  };
  return breadcrumpLinksMap[path];
}
