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

    /*
     * AI and Rules are their own side-menu sections, not lines under Settings,
     * so the trail has to name the section the page actually lives in —
     * otherwise the header says "Settings" while the menu highlights "Rules".
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_AI, [
      "Project",
      "Alerts",
      "AI",
      "Investigation",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES,
      ["Project", "Alerts", "AI", "Remediation"],
    ),

    // Alert Rules
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_GROUPING_RULES, [
      "Project",
      "Alerts",
      "Rules",
      "Grouping Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_ON_CALL_RULES, [
      "Project",
      "Alerts",
      "Rules",
      "On-Call Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_OWNER_RULES, [
      "Project",
      "Alerts",
      "Rules",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_RUNBOOK_RULES, [
      "Project",
      "Alerts",
      "Rules",
      "Runbook Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_PRIVACY_RULES, [
      "Project",
      "Alerts",
      "Rules",
      "Privacy Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_LABEL_RULES, [
      "Project",
      "Alerts",
      "Rules",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS_SETTINGS_REMINDER_RULES, [
      "Project",
      "Alerts",
      "Rules",
      "Reminder Rules",
    ]),

    // Episodes
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODES, [
      "Project",
      "Alerts",
      "Episodes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.UNRESOLVED_ALERT_EPISODES, [
      "Project",
      "Alerts",
      "Active Episodes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODE_VIEW, [
      "Project",
      "Alerts",
      "Episodes",
      "View Episode",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODE_VIEW_DESCRIPTION, [
      "Project",
      "Alerts",
      "Episodes",
      "View Episode",
      "Description",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE, [
      "Project",
      "Alerts",
      "Episodes",
      "View Episode",
      "Root Cause",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODE_VIEW_OWNERS, [
      "Project",
      "Alerts",
      "Episodes",
      "View Episode",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE, [
      "Project",
      "Alerts",
      "Episodes",
      "View Episode",
      "State Timeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODE_VIEW_ALERTS, [
      "Project",
      "Alerts",
      "Episodes",
      "View Episode",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE, [
      "Project",
      "Alerts",
      "Episodes",
      "View Episode",
      "Private Notes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODE_VIEW_DELETE, [
      "Project",
      "Alerts",
      "Episodes",
      "View Episode",
      "Delete Episode",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_EPISODE_DOCS, [
      "Project",
      "Alerts",
      "Episodes",
      "Documentation",
    ]),
  };
  return breadcrumpLinksMap[path];
}
