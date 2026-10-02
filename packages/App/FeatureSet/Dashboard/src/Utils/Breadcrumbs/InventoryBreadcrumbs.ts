import PageMap from "../PageMap";
import RouteMap, { RouteUtil } from "../RouteMap";
import { BuildBreadcrumbLinks, BuildBreadcrumbLinksByTitles } from "./Helper";
import { buildInventoryItemBreadcrumbLinks } from "./InventoryBreadcrumbLinks";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";
import Navigation from "Common/UI/Utils/Navigation";
import {
  DeveloperDocsChildPage,
  getDeveloperDocsChildPages,
} from "../../Components/DeveloperDocs/DeveloperDocsPages";

function buildInventoryDetailBreadcrumbs(
  pageKey: string,
  currentTitle?: string,
): Dictionary<Array<Link>> {
  const currentRoute: Route = Navigation.getCurrentPath();

  return BuildBreadcrumbLinks(
    pageKey,
    buildInventoryItemBreadcrumbLinks({
      projectRoute: Navigation.getBreadcrumbRoute(1),
      inventoryRoute: RouteUtil.populateRouteParams(
        RouteMap[PageMap.INVENTORY] as Route,
      ),
      // A child URL is /inventory/item/:id/<page>; keep through the id.
      itemRoute: currentTitle ? Navigation.getBreadcrumbRoute(4) : currentRoute,
      currentRoute,
      currentTitle,
    }),
  );
}

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
    ...buildInventoryDetailBreadcrumbs(PageMap.INVENTORY_VIEW),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_RELATIONSHIPS,
      "Connections",
    ),
    ...buildInventoryDetailBreadcrumbs(PageMap.INVENTORY_VIEW_LOGS, "Logs"),
    ...buildInventoryDetailBreadcrumbs(PageMap.INVENTORY_VIEW_TRACES, "Traces"),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_METRICS,
      "Metrics",
    ),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_PROFILES,
      "Performance Profiles",
    ),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_EXCEPTIONS,
      "Exceptions",
    ),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_TELEMETRY,
      "Logs",
    ),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_SETTINGS,
      "Settings",
    ),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_DELETE,
      "Delete Item",
    ),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_INCIDENTS,
      "Incidents",
    ),
    ...buildInventoryDetailBreadcrumbs(PageMap.INVENTORY_VIEW_ALERTS, "Alerts"),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_SCHEDULED_MAINTENANCE,
      "Scheduled Maintenance",
    ),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_CUSTOM_FIELDS,
      "Custom Fields",
    ),
    ...buildInventoryDetailBreadcrumbs(
      PageMap.INVENTORY_VIEW_AUDIT_LOGS,
      "Audit Logs",
    ),
    // An item's Developer pages (Terraform, API, AI Assistants).
    ...getDeveloperDocsChildPages(PageMap.INVENTORY_VIEW).reduce(
      (
        links: Dictionary<Array<Link>>,
        child: DeveloperDocsChildPage,
      ): Dictionary<Array<Link>> => {
        return {
          ...links,
          ...buildInventoryDetailBreadcrumbs(child.key, child.page.title),
        };
      },
      {},
    ),
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
