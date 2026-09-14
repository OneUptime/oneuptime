import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getIncidentsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS, [
      "Project",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.UNRESOLVED_INCIDENTS, [
      "Project",
      "Incidents",
      "Active Incidents",
    ]),

    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
      ["Project", "Incidents", "Workspace Slack Connection"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ["Project", "Incidents", "Workspace Microsoft Teams Connection"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_CREATE, [
      "Project",
      "Incidents",
      "Declare New Incident",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW, [
      "Project",
      "Incidents",
      "View Incident",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_STATE_TIMELINE, [
      "Project",
      "Incidents",
      "View Incident",
      "State Timeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_REMEDIATION, [
      "Project",
      "Incidents",
      "View Incident",
      "Remediation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_POSTMORTEM, [
      "Project",
      "Incidents",
      "View Incident",
      "Postmortem",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_ROOT_CAUSE, [
      "Project",
      "Incidents",
      "View Incident",
      "Root Cause",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_DESCRIPTION, [
      "Project",
      "Incidents",
      "View Incident",
      "Description",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_OWNERS, [
      "Project",
      "Incidents",
      "View Incident",
      "Owners",
    ]),

    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS,
      ["Project", "Incidents", "View Incident", "On Call Executions"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_INTERNAL_NOTE, [
      "Project",
      "Incidents",
      "View Incident",
      "Private Notes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_PUBLIC_NOTE, [
      "Project",
      "Incidents",
      "View Incident",
      "Public Notes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Incidents",
      "View Incident",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_DELETE, [
      "Project",
      "Incidents",
      "View Incident",
      "Delete Incident",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_SETTINGS, [
      "Project",
      "Incidents",
      "View Incident",
      "Settings",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_ROLES, [
      "Project",
      "Incidents",
      "View Incident",
      "Roles",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS, [
      "Project",
      "Incidents",
      "View Incident",
      "Notification Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_AI_LOGS, [
      "Project",
      "Incidents",
      "View Incident",
      "AI Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_SLA, [
      "Project",
      "Incidents",
      "View Incident",
      "SLA",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_AUDIT_LOGS, [
      "Project",
      "Incidents",
      "View Incident",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_RUNBOOKS, [
      "Project",
      "Incidents",
      "View Incident",
      "Runbooks",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODES, [
      "Project",
      "Incidents",
      "Episodes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.UNRESOLVED_INCIDENT_EPISODES, [
      "Project",
      "Incidents",
      "Active Episodes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_CREATE, [
      "Project",
      "Incidents",
      "Episodes",
      "Create Episode",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_DELETE, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Delete Episode",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_DESCRIPTION, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Description",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_ROOT_CAUSE, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Root Cause",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_POSTMORTEM, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Postmortem",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_REMEDIATION, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Remediation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_OWNERS, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENT_EPISODE_VIEW_STATE_TIMELINE,
      ["Project", "Incidents", "Episodes", "View Episode", "State Timeline"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE,
      ["Project", "Incidents", "Episodes", "View Episode", "Private Notes"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_PUBLIC_NOTE, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Public Notes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_MEMBERS, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Members",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_SETTINGS, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_VIEW_AUDIT_LOGS, [
      "Project",
      "Incidents",
      "Episodes",
      "View Episode",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_EPISODE_DOCS, [
      "Project",
      "Incidents",
      "Episodes",
      "Documentation",
    ]),

    // Incident Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_ROLES, [
      "Project",
      "Incidents",
      "Settings",
      "Incident Roles",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_MORE, [
      "Project",
      "Incidents",
      "Settings",
      "More Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_STATE, [
      "Project",
      "Incidents",
      "Settings",
      "Incident State",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_SEVERITY, [
      "Project",
      "Incidents",
      "Settings",
      "Incident Severity",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_TEMPLATES, [
      "Project",
      "Incidents",
      "Settings",
      "Incident Templates",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW, [
      "Project",
      "Incidents",
      "Settings",
      "Incident Templates",
      "View Template",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES, [
      "Project",
      "Incidents",
      "Settings",
      "Note Templates",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES_VIEW,
      ["Project", "Incidents", "Settings", "Note Templates", "View Template"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES,
      ["Project", "Incidents", "Settings", "Postmortem Templates"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES_VIEW,
      [
        "Project",
        "Incidents",
        "Settings",
        "Postmortem Templates",
        "View Template",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS, [
      "Project",
      "Incidents",
      "Settings",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_MEASUREMENTS, [
      "Project",
      "Incidents",
      "Settings",
      "Measurements",
    ]),

    /*
     * AI and Rules are their own side-menu sections, not lines under Settings,
     * so the trail has to name the section the page actually lives in —
     * otherwise the header says "Settings" while the menu highlights "Rules".
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_AI, [
      "Project",
      "Incidents",
      "AI",
      "Investigation",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES,
      ["Project", "Incidents", "AI", "Remediation"],
    ),

    // Incident Rules
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_GROUPING_RULES, [
      "Project",
      "Incidents",
      "Rules",
      "Grouping Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES, [
      "Project",
      "Incidents",
      "Rules",
      "On-Call Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_OWNER_RULES, [
      "Project",
      "Incidents",
      "Rules",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_RUNBOOK_RULES, [
      "Project",
      "Incidents",
      "Rules",
      "Runbook Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_PRIVACY_RULES, [
      "Project",
      "Incidents",
      "Rules",
      "Privacy Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_LABEL_RULES, [
      "Project",
      "Incidents",
      "Rules",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_SLA_RULES, [
      "Project",
      "Incidents",
      "Rules",
      "SLA Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS_SETTINGS_REMINDER_RULES, [
      "Project",
      "Incidents",
      "Rules",
      "Reminder Rules",
    ]),
  };
  return breadcrumpLinksMap[path];
}
