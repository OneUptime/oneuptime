import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Every routed DATA_OBSERVABILITY_* page has a trail here, named as the side
 * menus name the pages: Project > Data Observability > Tables > View Table >
 * Columns. A table's pages sit under Tables and the table - "View Table",
 * which the table's layout names for the table once it is read - and a
 * database's under Databases and "View Database", named the same way. The
 * product's own address opens its Overview, and is named so.
 */
export function getDataObservabilityBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY, [
      "Project",
      "Data Observability",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_OVERVIEW, [
      "Project",
      "Data Observability",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_TABLES, [
      "Project",
      "Data Observability",
      "Tables",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_TABLES_DROPPED, [
      "Project",
      "Data Observability",
      "Tables",
      "Dropped Tables",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_TABLES_UNUSED, [
      "Project",
      "Data Observability",
      "Tables",
      "Unused Tables",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_TABLE_VIEW, [
      "Project",
      "Data Observability",
      "Tables",
      "View Table",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_COLUMNS,
      ["Project", "Data Observability", "Tables", "View Table", "Columns"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_METRICS,
      ["Project", "Data Observability", "Tables", "View Table", "Metrics"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_TIMELINE,
      ["Project", "Data Observability", "Tables", "View Table", "Timeline"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SERVICES,
      ["Project", "Data Observability", "Tables", "View Table", "Services"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS,
      ["Project", "Data Observability", "Tables", "View Table", "Checks"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_LINEAGE,
      ["Project", "Data Observability", "Tables", "View Table", "Lineage"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_OWNERS,
      ["Project", "Data Observability", "Tables", "View Table", "Owners"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SETTINGS,
      ["Project", "Data Observability", "Tables", "View Table", "Settings"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_TABLE_VIEW_DELETE,
      ["Project", "Data Observability", "Tables", "View Table", "Delete"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_STORES, [
      "Project",
      "Data Observability",
      "Databases",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_STORE_VIEW, [
      "Project",
      "Data Observability",
      "Databases",
      "View Database",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_STORE_VIEW_TABLES,
      ["Project", "Data Observability", "Databases", "View Database", "Tables"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS,
      [
        "Project",
        "Data Observability",
        "Databases",
        "View Database",
        "Recommendations",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_PIPELINES, [
      "Project",
      "Data Observability",
      "Pipelines",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_DATA_PRODUCTS, [
      "Project",
      "Data Observability",
      "Data Products",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_RECONCILIATIONS,
      ["Project", "Data Observability", "Reconciliations"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULES, [
      "Project",
      "Data Observability",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULE_VIEW, [
      "Project",
      "Data Observability",
      "Owner Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_SETTINGS_LABEL_RULES, [
      "Project",
      "Data Observability",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_SETTINGS_LABEL_RULE_VIEW, [
      "Project",
      "Data Observability",
      "Label Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_SETTINGS, [
      "Project",
      "Data Observability",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_BI_DASHBOARDS, [
      "Project",
      "Data Observability",
      "BI Dashboards",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_SPEND, [
      "Project",
      "Data Observability",
      "Warehouse Spend",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW,
      ["Project", "Data Observability", "Data Products", "Data Product"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_SETTINGS,
      [
        "Project",
        "Data Observability",
        "Data Products",
        "Data Product",
        "Settings",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_DELETE,
      [
        "Project",
        "Data Observability",
        "Data Products",
        "Data Product",
        "Delete",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW, [
      "Project",
      "Data Observability",
      "Pipelines",
      "Pipeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW_RECOMMENDATIONS,
      [
        "Project",
        "Data Observability",
        "Pipelines",
        "Pipeline",
        "Recommendations",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_CHECKS, [
      "Project",
      "Data Observability",
      "Checks",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_SCHEMA_CHANGES, [
      "Project",
      "Data Observability",
      "Schema Changes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DATA_OBSERVABILITY_DOCUMENTATION, [
      "Project",
      "Data Observability",
      "Documentation",
    ]),
  };
  return breadcrumpLinksMap[path];
}
