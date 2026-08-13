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
  };
  return breadcrumpLinksMap[path];
}
