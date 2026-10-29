import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getServerlessBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTIONS, [
      "Project",
      "Serverless Functions",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW, [
      "Project",
      "Serverless Functions",
      "View Function",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_SETTINGS, [
      "Project",
      "Serverless Functions",
      "View Function",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_METRICS, [
      "Project",
      "Serverless Functions",
      "View Function",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_LOGS, [
      "Project",
      "Serverless Functions",
      "View Function",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_TRACES, [
      "Project",
      "Serverless Functions",
      "View Function",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_FUNCTION_VIEW_DOCUMENTATION,
      ["Project", "Serverless Functions", "View Function", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_DELETE, [
      "Project",
      "Serverless Functions",
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
      ["Project", "Serverless Functions", "View Function", "Instances"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_SETTINGS_OWNER_RULES, [
      "Project",
      "Serverless Functions",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_SETTINGS_OWNER_RULE_VIEW,
      [
        "Project",
        "Serverless Functions",
        "Settings",
        "Owner Rules",
        "View Rule",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_SETTINGS_LABEL_RULES, [
      "Project",
      "Serverless Functions",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SERVERLESS_SETTINGS_LABEL_RULE_VIEW,
      [
        "Project",
        "Serverless Functions",
        "Settings",
        "Label Rules",
        "View Rule",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_ARCHIVED, [
      "Project",
      "Serverless Functions",
      "Archived",
    ]),
  };
  return breadcrumpLinksMap[path];
}
