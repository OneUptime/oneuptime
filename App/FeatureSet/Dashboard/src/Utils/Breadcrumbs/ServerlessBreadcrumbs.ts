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
    ...BuildBreadcrumbLinksByTitles(PageMap.SERVERLESS_FUNCTION_VIEW_DELETE, [
      "Project",
      "Serverless Functions",
      "View Function",
      "Delete Function",
    ]),
  };
  return breadcrumpLinksMap[path];
}
