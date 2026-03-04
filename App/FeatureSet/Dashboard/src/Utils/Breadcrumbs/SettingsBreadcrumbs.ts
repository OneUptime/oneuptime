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
    ...BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_SLACK_INTEGRATION, [
      "Project",
      "Settings",
      "Slack Integration",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
      ["Project", "Settings", "Microsoft Teams Integration"],
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
      "AI Credits",
    ]),
  };
  return breadcrumpLinksMap[path];
}
