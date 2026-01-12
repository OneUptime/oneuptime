import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getAlertsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS, ["Project", "Alerts"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.UNRESOLVED_ALERTS, [
      "Project",
      "Alerts",
      "Active Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK, [
      "Project",
      "Alerts",
      "Slack Connection",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ["Project", "Alerts", "Microsoft Teams Connection"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW, [
      "Project",
      "Alerts",
      "View Alert",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_STATE_TIMELINE, [
      "Project",
      "Alerts",
      "View Alert",
      "State Timeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_OWNERS, [
      "Project",
      "Alerts",
      "View Alert",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS,
      ["Project", "Alerts", "View Alert", "On Call Executions"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_INTERNAL_NOTE, [
      "Project",
      "Alerts",
      "View Alert",
      "Private Notes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Alerts",
      "View Alert",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_DELETE, [
      "Project",
      "Alerts",
      "View Alert",
      "Delete Alert",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_ROOT_CAUSE, [
      "Project",
      "Alerts",
      "View Alert",
      "Root Cause",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_REMEDIATION, [
      "Project",
      "Alerts",
      "View Alert",
      "Remediation",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_DESCRIPTION, [
      "Project",
      "Alerts",
      "Description",
    ]),

    // Alert Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_STATE, [
      "Project",
      "Alerts",
      "Settings",
      "Alert State",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_SEVERITY, [
      "Project",
      "Alerts",
      "Settings",
      "Alert Severity",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES, [
      "Project",
      "Alerts",
      "Settings",
      "Note Templates",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES_VIEW,
      ["Project", "Alerts", "Settings", "Note Templates", "View Template"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS, [
      "Project",
      "Alerts",
      "Settings",
      "Custom Fields",
    ]),
  };
  return breadcrumpLinksMap[path];
}
