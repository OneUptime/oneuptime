import { describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import Link from "../../../Types/Link";
import Navigation from "../../../UI/Utils/Navigation";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getInventoryBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/InventoryBreadcrumbs";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

/*
 * The Topology Map is an entry of the Inventory menu and drawn beside it,
 * but it had no trail: the header jumped from "Project > Inventory > All
 * Items" to nothing on the next entry down (EveryPageHasATrail listed its
 * route table as the one without a trail, "a follow-up"). Its address is a
 * section of its own (/topology/overview), so a trail read from the address
 * would have linked "Inventory" nowhere useful: its links are its own.
 */

const TOPOLOGY_PATH: string = `/dashboard/${PROJECT_ID}/topology/overview`;

function trailAt(path: string): Array<Link> | undefined {
  goTo(path);
  return getInventoryBreadcrumbs(
    Navigation.getRoutePath(RouteUtil.getRoutes()),
  );
}

describe("the Topology Map's trail", () => {
  test("reads Project > Inventory > Topology Map, named as the Inventory menu names it", () => {
    expect(
      trailAt(TOPOLOGY_PATH)?.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Inventory", "Topology Map"]);
  });

  test("Project leads to the project, Inventory to the Inventory's overview, and the map is the page", () => {
    const links: Array<Link> = trailAt(TOPOLOGY_PATH)!;

    expect(
      links.map((link: Link): string => {
        return link.to.toString();
      }),
    ).toEqual([
      `/dashboard/${PROJECT_ID}`,
      RouteMap[PageMap.INVENTORY]!.toString().replace(":projectId", PROJECT_ID),
      TOPOLOGY_PATH,
    ]);
    // Not the map's own section, which is not the Inventory.
    expect(links[1]!.to.toString()).not.toContain("/topology");
  });

  test("the Inventory's own pages keep their trails", () => {
    expect(
      trailAt(
        RouteMap[PageMap.INVENTORY_ITEMS]!.toString().replace(
          ":projectId",
          PROJECT_ID,
        ),
      )?.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Inventory", "All Items"]);
  });
});
