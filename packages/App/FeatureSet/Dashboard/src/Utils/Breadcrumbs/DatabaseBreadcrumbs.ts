import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Every routed DATABASE_* page needs a trail here, the Archived list
 * included: a page without one renders with no breadcrumbs at all, silently.
 * App/Tests/Dashboard/DatabaseProductWiring.test.ts enumerates the routed
 * keys and fails by name when one is missing.
 */
export function getDatabaseBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVERS, [
      "Project",
      "Databases",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_ARCHIVED, [
      "Project",
      "Databases",
      "Archived",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_DOCUMENTATION, [
      "Project",
      "Databases",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SETTINGS_LABEL_RULES, [
      "Project",
      "Databases",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SETTINGS_LABEL_RULE_VIEW, [
      "Project",
      "Databases",
      "Label Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SETTINGS_OWNER_RULES, [
      "Project",
      "Databases",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SETTINGS_OWNER_RULE_VIEW, [
      "Project",
      "Databases",
      "Owner Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW, [
      "Project",
      "Databases",
      "View Database",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_METRICS, [
      "Project",
      "Databases",
      "View Database",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_LOGS, [
      "Project",
      "Databases",
      "View Database",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_TRACES, [
      "Project",
      "Databases",
      "View Database",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_INCIDENTS, [
      "Project",
      "Databases",
      "View Database",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_ALERTS, [
      "Project",
      "Databases",
      "View Database",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "Databases", "View Database", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_FEED, [
      "Project",
      "Databases",
      "View Database",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_OWNERS, [
      "Project",
      "Databases",
      "View Database",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_ENDPOINTS, [
      "Project",
      "Databases",
      "View Database",
      "Endpoints",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_SETTINGS, [
      "Project",
      "Databases",
      "View Database",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATABASE_SERVER_VIEW_DOCUMENTATION,
      ["Project", "Databases", "View Database", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATABASE_SERVER_VIEW_DELETE, [
      "Project",
      "Databases",
      "View Database",
      "Delete Database",
    ]),
  };
  return breadcrumpLinksMap[path];
}
