import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const INVENTORY_PAGES: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Inventory",
);

function readPage(...segments: Array<string>): string {
  return fs
    .readFileSync(path.join(INVENTORY_PAGES, ...segments), "utf8")
    .replace(/\s+/g, " ");
}

/*
 * The graph already existed in the Topology product; Inventory's defect was
 * discoverability. Pin every route into it so the map cannot become hidden
 * again while its graph implementation continues to work perfectly.
 */
describe("Inventory topology discovery", () => {
  test("the overview offers the complete topology next to its item list", () => {
    const overview: string = readPage("Overview.tsx");

    expect(overview).toContain('title: "Explore topology"');
    expect(overview).toContain("RouteMap[PageMap.TOPOLOGY]");
  });

  test("the product side menu exposes Topology Map as primary navigation", () => {
    const sideMenu: string = readPage("SideMenu.tsx");

    expect(sideMenu).toContain('title: "Topology Map"');
    expect(sideMenu).toContain("RouteMap[PageMap.TOPOLOGY]");
  });

  test("the documentation explains facets, detail actions and the full map", () => {
    const documentation: string = readPage("Documentation.tsx");

    expect(documentation).toContain(
      "Type, Source, Last Seen and custom-field facets",
    );
    expect(documentation).toContain("Editing, archiving and deletion");
    expect(documentation).toContain("Explore the full topology");
    expect(documentation).toContain("RouteMap[PageMap.TOPOLOGY]");
  });
});
