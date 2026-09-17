import PageMap from "../../../Utils/PageMap";
import { BuildBreadcrumbLinksByTitles } from "../../../Utils/Breadcrumbs/Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getSloBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SLOS, ["Project", "SLOs"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLOS_ARCHIVED, [
      "Project",
      "SLOs",
      "Archived",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW, [
      "Project",
      "SLOs",
      "View SLO",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_MONITORS, [
      "Project",
      "SLOs",
      "View SLO",
      "Monitors",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_MONITOR_RULES, [
      "Project",
      "SLOs",
      "View SLO",
      "Monitor Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_MONITOR_RULE_VIEW, [
      "Project",
      "SLOs",
      "View SLO",
      "Monitor Rules",
      "View Monitor Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_BURN_RATE_RULES, [
      "Project",
      "SLOs",
      "View SLO",
      "Burn Rate Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_METRICS, [
      "Project",
      "SLOs",
      "View SLO",
      "Metrics",
    ]),
    // Off the side menu, but still reachable from bookmarks.
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_CHARTS, [
      "Project",
      "SLOs",
      "View SLO",
      "Charts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_ALERTS, [
      "Project",
      "SLOs",
      "View SLO",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_INCIDENTS, [
      "Project",
      "SLOs",
      "View SLO",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_FEED, [
      "Project",
      "SLOs",
      "View SLO",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_OWNERS, [
      "Project",
      "SLOs",
      "View SLO",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_SETTINGS, [
      "Project",
      "SLOs",
      "View SLO",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_AUDIT_LOGS, [
      "Project",
      "SLOs",
      "View SLO",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_DELETE, [
      "Project",
      "SLOs",
      "View SLO",
      "Delete SLO",
    ]),
  };
  return breadcrumpLinksMap[path];
}
