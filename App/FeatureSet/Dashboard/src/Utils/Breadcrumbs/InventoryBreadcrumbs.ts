import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getInventoryBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY, [
      "Project",
      "Inventory",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_ITEMS, [
      "Project",
      "Inventory",
      "All Items",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_DOCUMENTATION, [
      "Project",
      "Inventory",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_VIEW, [
      "Project",
      "Inventory",
      "View Item",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_VIEW_RELATIONSHIPS, [
      "Project",
      "Inventory",
      "View Item",
      "Relationships",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_VIEW_TELEMETRY, [
      "Project",
      "Inventory",
      "View Item",
      "Telemetry",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_VIEW_SETTINGS, [
      "Project",
      "Inventory",
      "View Item",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_VIEW_DELETE, [
      "Project",
      "Inventory",
      "View Item",
      "Delete Item",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_VIEW_INCIDENTS, [
      "Project",
      "Inventory",
      "View Item",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_VIEW_ALERTS, [
      "Project",
      "Inventory",
      "View Item",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.INVENTORY_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "Inventory", "View Item", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Inventory",
      "View Item",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_VIEW_AUDIT_LOGS, [
      "Project",
      "Inventory",
      "View Item",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_ARCHIVED, [
      "Project",
      "Inventory",
      "Archived",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INVENTORY_SETTINGS_CUSTOM_FIELDS, [
      "Project",
      "Inventory",
      "Settings",
      "Custom Fields",
    ]),
  };
  return breadcrumpLinksMap[path];
}
