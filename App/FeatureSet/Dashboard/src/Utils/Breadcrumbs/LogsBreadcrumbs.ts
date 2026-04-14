import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getLogsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS, ["Project", "Logs"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS_INSIGHTS, [
      "Project",
      "Logs",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LOGS_DOCUMENTATION, [
      "Project",
      "Logs",
      "Setup Guide",
    ]),
  };
  return breadcrumpLinksMap[path];
}
