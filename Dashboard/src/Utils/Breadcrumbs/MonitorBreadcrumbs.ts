import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getMonitorBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITORS, ["Project", "Monitors"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITORS_INOPERATIONAL, [
      "Project",
      "Monitors",
      "Inoperational",
    ]),
    //slack connection
    ...BuildBreadcrumbLinksByTitles(
      PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK,
      ["Project", "Monitors", "Slack"],
    ),
    // ms teams connection
    ...BuildBreadcrumbLinksByTitles(
      PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ["Project", "Monitors", "Microsoft Teams"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITORS_DISABLED, [
      "Project",
      "Monitors",
      "Disabled",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_CREATE, [
      "Project",
      "Monitors",
      "Create New Monitor",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW, [
      "Project",
      "Monitors",
      "View Monitor",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_OWNERS, [
      "Project",
      "Monitors",
      "View Monitor",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_CRITERIA, [
      "Project",
      "Monitors",
      "View Monitor",
      "Criteria",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_METRICS, [
      "Project",
      "Monitors",
      "View Monitor",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_INTERVAL, [
      "Project",
      "Monitors",
      "View Monitor",
      "Interval",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_STATUS_TIMELINE, [
      "Project",
      "Monitors",
      "View Monitor",
      "Status Timeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_INCIDENTS, [
      "Project",
      "Monitors",
      "View Monitor",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_PROBES, [
      "Project",
      "Monitors",
      "View Monitor",
      "Probes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_LOGS, [
      "Project",
      "Monitors",
      "View Monitor",
      "Monitoring Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Monitors",
      "View Monitor",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_SETTINGS, [
      "Project",
      "Monitors",
      "View Monitor",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_DELETE, [
      "Project",
      "Monitors",
      "View Monitor",
      "Delete Monitor",
    ]),

    // Monitor Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITORS_SETTINGS, [
      "Project",
      "Monitors",
      "Settings",
      "Monitor Status",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS, [
      "Project",
      "Monitors",
      "Settings",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MONITORS_SETTINGS_SECRETS, [
      "Project",
      "Monitors",
      "Settings",
      "Secrets",
    ]),
  };
  return breadcrumpLinksMap[path];
}
