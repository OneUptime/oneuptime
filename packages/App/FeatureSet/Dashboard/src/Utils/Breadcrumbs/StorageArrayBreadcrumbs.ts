import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Every routed STORAGE_ARRAY* page has a trail here except the Archived
 * list, which (like every other product's) renders under the product
 * Layout without one. App/Tests/Dashboard/StorageArrayProductWiring.test.ts
 * enumerates the keys and fails by name when one is missing.
 */
export function getStorageArrayBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAYS, [
      "Project",
      "Storage Arrays",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_VOLUMES, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Volumes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Volumes",
      "Volume Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_HOSTS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Hosts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_HOST_DETAIL, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Hosts",
      "Host Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_REPLICATION, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Replication",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_HARDWARE, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Hardware",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_DIRECTORIES, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Directories",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEMS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "File Systems",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL,
      [
        "Project",
        "Storage Arrays",
        "View Storage Array",
        "File Systems",
        "File System Detail",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_BUCKETS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Buckets",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_BUCKET_DETAIL, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Buckets",
      "Bucket Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_INSIGHTS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Resource Usage",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STORAGE_ARRAY_VIEW_RECOMMENDATIONS,
      ["Project", "Storage Arrays", "View Storage Array", "Recommendations"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_METRICS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_LOGS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_INCIDENTS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_ALERTS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STORAGE_ARRAY_VIEW_SCHEDULED_MAINTENANCE,
      [
        "Project",
        "Storage Arrays",
        "View Storage Array",
        "Scheduled Maintenance",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_OWNERS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_FEED, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_AUDIT_LOGS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_SETTINGS, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_DELETE, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Delete Storage Array",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAY_VIEW_DOCUMENTATION, [
      "Project",
      "Storage Arrays",
      "View Storage Array",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STORAGE_ARRAYS_DOCUMENTATION, [
      "Project",
      "Storage Arrays",
      "Documentation",
    ]),

    // Storage Arrays Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULES,
      ["Project", "Storage Arrays", "Settings", "Owner Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULE_VIEW,
      ["Project", "Storage Arrays", "Settings", "Owner Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULES,
      ["Project", "Storage Arrays", "Settings", "Label Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULE_VIEW,
      ["Project", "Storage Arrays", "Settings", "Label Rules", "View Rule"],
    ),
  };
  return breadcrumpLinksMap[path];
}
