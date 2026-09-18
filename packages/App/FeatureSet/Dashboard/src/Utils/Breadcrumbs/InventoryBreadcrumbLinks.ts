import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";

export interface InventoryItemBreadcrumbLinkData {
  currentRoute: Route;
  currentTitle?: string | undefined;
  inventoryRoute: Route;
  itemRoute: Route;
  projectRoute: Route;
}

/*
 * Pure explicit detail breadcrumbs. Inventory needs this because
 * `/inventory/item` is a ModelTable append-id prefix, not a real page. The
 * generic depth resolver cannot distinguish that prefix from a mounted route.
 */
export function buildInventoryItemBreadcrumbLinks(
  data: InventoryItemBreadcrumbLinkData,
): Array<Link> {
  const links: Array<Link> = [
    { title: "Project", to: data.projectRoute },
    { title: "Inventory", to: data.inventoryRoute },
    { title: "View Item", to: data.itemRoute },
  ];

  if (data.currentTitle) {
    links.push({ title: data.currentTitle, to: data.currentRoute });
  }

  return links;
}
