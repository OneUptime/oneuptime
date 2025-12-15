import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getSettingsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS, [
      "Project",
      "Project Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_LABELS, [
      "Project",
      "Settings",
      "Labels",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_MONITORS_STATUS, [
      "Project",
      "Settings",
      "Monitor Status",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS, [
      "Project",
      "Settings",
      "Monitor Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_MONITOR_SECRETS, [
      "Project",
      "Settings",
      "Monitor Secrets",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS,
      ["Project", "Settings", "Status Page Custom Fields"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS,
      ["Project", "Settings", "On-Call Puty Custom Fields"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_INCIDENTS_STATE, [
      "Project",
      "Settings",
      "Incident State",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_SLACK_INTEGRATION, [
      "Project",
      "Settings",
      "Slack Integration",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
      ["Project", "Settings", "Microsoft Teams Integration"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_INCIDENTS_SEVERITY, [
      "Project",
      "Settings",
      "Incident Severity",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_INCIDENT_TEMPLATES, [
      "Project",
      "Settings",
      "Incident Templates",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_SCHEDULED_MAINTENANCE_TEMPLATES,
      ["Project", "Settings", "Scheduled Maintenance Templates"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_SCHEDULED_MAINTENANCE_TEMPLATES_VIEW,
      [
        "Project",
        "Settings",
        "Scheduled Maintenance Templates",
        "View Template",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_INCIDENT_TEMPLATES_VIEW, [
      "Project",
      "Settings",
      "Incident Templates",
      "View Template",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES, [
      "Project",
      "Settings",
      "Incident Note Templates",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES_VIEW,
      ["Project", "Settings", "Incident Note Templates", "View Template"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_INCIDENT_POSTMORTEM_TEMPLATES,
      ["Project", "Settings", "Incident Postmortem Templates"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_INCIDENT_POSTMORTEM_TEMPLATES_VIEW,
      ["Project", "Settings", "Incident Postmortem Templates", "View Template"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS, [
      "Project",
      "Settings",
      "Incident Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE,
      ["Project", "Settings", "Scheduled Maintenance State"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES,
      ["Project", "Settings", "Scheduled Maintenance Note Templates"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES_VIEW,
      [
        "Project",
        "Settings",
        "Scheduled Maintenance Note Templates",
        "View Template",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS,
      ["Project", "Settings", "Scheduled Maintenance Custom Fields"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_TEAMS, [
      "Project",
      "Settings",
      "Teams",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_TEAM_VIEW, [
      "Project",
      "Settings",
      "Teams",
      "View Team",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_USERS, [
      "Project",
      "Settings",
      "Users",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_USER_VIEW, [
      "Project",
      "Settings",
      "Users",
      "View User",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_NOTIFICATION_SETTINGS, [
      "Project",
      "Settings",
      "Notification Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_NOTIFICATION_LOGS, [
      "Project",
      "Settings",
      "Notification Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_PROBES, [
      "Project",
      "Settings",
      "Probes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_PROBE_VIEW, [
      "Project",
      "Settings",
      "Probes",
      "View Probe",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_DOMAINS, [
      "Project",
      "Settings",
      "Domains",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_APIKEYS, [
      "Project",
      "Settings",
      "API Keys",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_APIKEY_VIEW, [
      "Project",
      "Settings",
      "API Keys",
      "View API Key",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_FEATURE_FLAGS, [
      "Project",
      "Settings",
      "Feature Flags",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_BILLING, [
      "Project",
      "Settings",
      "Billing",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_USAGE_HISTORY, [
      "Project",
      "Settings",
      "Usage History",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_BILLING_INVOICES, [
      "Project",
      "Settings",
      "Invoices",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_SSO, [
      "Project",
      "Settings",
      "SSO",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_DANGERZONE, [
      "Project",
      "Settings",
      "Danger Zone",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_LLM_PROVIDERS, [
      "Project",
      "Settings",
      "LLM Providers",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_LLM_PROVIDER_VIEW, [
      "Project",
      "Settings",
      "LLM Providers",
      "View Provider",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_AI_BILLING, [
      "Project",
      "Settings",
      "AI Billing",
    ]),
  };
  return breadcrumpLinksMap[path];
}
