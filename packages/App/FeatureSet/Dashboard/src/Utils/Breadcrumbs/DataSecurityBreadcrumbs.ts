import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Every routed DATA_SECURITY_* page has a trail here, named as the side
 * menus name the pages (Utils/DataSecurityNavigation.ts, the store's and
 * the issue's own menus): Project > Data Security > Settings > Data Types.
 * A page without one would render with no breadcrumbs at all.
 *
 * A store's pages sit under Data Stores and the store - "View Data Store",
 * which the store's layout names for the store once it is read
 * (nameRecordInTrail) - then the page; an issue's under Issues and the
 * issue the same way. The product's own address opens its Overview, and is
 * named so.
 */
export function getDataSecurityBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY, [
      "Project",
      "Data Security",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_OVERVIEW, [
      "Project",
      "Data Security",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORES, [
      "Project",
      "Data Security",
      "Data Stores",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORES_ARCHIVED, [
      "Project",
      "Data Security",
      "Data Stores",
      "Archived Stores",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW_INSIDE, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
      "What's Inside",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW_ACCESS, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
      "Who Can Reach It",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW_ISSUES, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
      "Issues",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW_FLOWS, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
      "Data Flows",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW_SCANS, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
      "Scans",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW_TIMELINE, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
      "Timeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW_OWNERS, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW_SETTINGS, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_STORE_VIEW_DELETE, [
      "Project",
      "Data Security",
      "Data Stores",
      "View Data Store",
      "Delete Data Store",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_ISSUES, [
      "Project",
      "Data Security",
      "Issues",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_ISSUE_VIEW, [
      "Project",
      "Data Security",
      "Issues",
      "View Issue",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_ISSUE_VIEW_TIMELINE, [
      "Project",
      "Data Security",
      "Issues",
      "View Issue",
      "Timeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_ISSUE_VIEW_DELETE, [
      "Project",
      "Data Security",
      "Issues",
      "View Issue",
      "Delete Issue",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_SENSITIVE_DATA, [
      "Project",
      "Data Security",
      "Sensitive Data",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_TELEMETRY, [
      "Project",
      "Data Security",
      "In Your Telemetry",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_FLOWS, [
      "Project",
      "Data Security",
      "Data Flows",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_ACCESS, [
      "Project",
      "Data Security",
      "Access",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_COMPLIANCE, [
      "Project",
      "Data Security",
      "Compliance",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_SCANS, [
      "Project",
      "Data Security",
      "Scanning",
      "Scans",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_SETTINGS_DATA_TYPES, [
      "Project",
      "Data Security",
      "Settings",
      "Data Types",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_SETTINGS_CHECKS, [
      "Project",
      "Data Security",
      "Settings",
      "Checks",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_SETTINGS_RESIDENCY, [
      "Project",
      "Data Security",
      "Settings",
      "Residency Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_SETTINGS_SCANNING, [
      "Project",
      "Data Security",
      "Settings",
      "Scanning",
    ]),
    /*
     * The rules live under settings/ in the address, so their trail goes
     * through Settings, whose crumb opens the first settings page.
     */
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_SECURITY_SETTINGS_OWNER_RULES,
      ["Project", "Data Security", "Settings", "Owner Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_SECURITY_SETTINGS_LABEL_RULES,
      ["Project", "Data Security", "Settings", "Label Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_SECURITY_DOCUMENTATION, [
      "Project",
      "Data Security",
      "Documentation",
    ]),
  };
  return breadcrumpLinksMap[path];
}
