import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getMonitorGroupBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW, [
      "Project",
      "Monitor Groups",
      "View Monitor Group",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_OWNERS, [
      "Project",
      "Monitor Groups",
      "View Monitor Group",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_MONITORS, [
      "Project",
      "Monitor Groups",
      "View Monitor Group",
      "Monitors",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_INCIDENTS, [
      "Project",
      "Monitor Groups",
      "View Monitor Group",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_DELETE, [
      "Project",
      "Monitor Groups",
      "View Monitor Group",
      "Delete Monitor Group",
    ]),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_ALERTS, [
      "Project",
      "Monitor Groups",
      "View Monitor Group",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_AUDIT_LOGS, [
      "Project",
      "Monitor Groups",
      "View Monitor Group",
      "Audit Logs",
    ]),
  };
  return breadcrumpLinksMap[path];
}
