import { describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import { buildInventoryItemBreadcrumbLinks } from "../../FeatureSet/Dashboard/src/Utils/Breadcrumbs/InventoryBreadcrumbLinks";

const PROJECT: Route = new Route("/dashboard/project-id");
const INVENTORY: Route = new Route("/dashboard/project-id/inventory/overview");
const ITEM: Route = new Route(
  "/dashboard/project-id/inventory/item/inventory-id",
);

describe("Inventory detail breadcrumb destinations", () => {
  test("the item overview links back to the real Inventory overview", () => {
    const links: Array<Link> = buildInventoryItemBreadcrumbLinks({
      projectRoute: PROJECT,
      inventoryRoute: INVENTORY,
      itemRoute: ITEM,
      currentRoute: ITEM,
    });

    expect(
      links.map((link: Link) => {
        return link.title;
      }),
    ).toEqual(["Project", "Inventory", "View Item"]);
    expect(
      links.map((link: Link) => {
        return link.to.toString();
      }),
    ).toEqual([PROJECT.toString(), INVENTORY.toString(), ITEM.toString()]);
  });

  test.each([
    "Connections",
    "Logs",
    "Traces",
    "Metrics",
    "Performance Profiles",
    "Exceptions",
    "Settings",
    "Delete Item",
  ])("%s links View Item to the concrete id route", (title: string) => {
    const current: Route = new Route(
      `/dashboard/project-id/inventory/item/inventory-id/${title
        .toLowerCase()
        .replace(/ /g, "-")}`,
    );
    const links: Array<Link> = buildInventoryItemBreadcrumbLinks({
      projectRoute: PROJECT,
      inventoryRoute: INVENTORY,
      itemRoute: ITEM,
      currentRoute: current,
      currentTitle: title,
    });

    expect(links[1]?.to.toString()).toBe(INVENTORY.toString());
    expect(links[2]?.to.toString()).toBe(ITEM.toString());
    expect(links[3]?.to.toString()).toBe(current.toString());
  });

  test("no breadcrumb ever targets the non-page ModelTable prefix", () => {
    const current: Route = new Route(
      "/dashboard/project-id/inventory/item/inventory-id/logs",
    );
    const links: Array<Link> = buildInventoryItemBreadcrumbLinks({
      projectRoute: PROJECT,
      inventoryRoute: INVENTORY,
      itemRoute: ITEM,
      currentRoute: current,
      currentTitle: "Logs",
    });

    expect(
      links.some((link: Link): boolean => {
        return link.to.toString() === "/dashboard/project-id/inventory/item";
      }),
    ).toBe(false);
  });
});
