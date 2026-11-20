import { describe, expect, test } from "@jest/globals";
import {
  SiteTreeNode,
  SiteTreeRow,
  FilteredSiteTree,
  buildSiteTree,
  countTreeNodes,
  filterSiteTree,
  getSiteSearchWords,
  siteNameMatches,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteTreeUtil";

/*
 * The Sites page hierarchy view is built client-side from the flat site
 * rows. These pin the structural decisions: parents nest children, name
 * ordering is stable, subtree device counts roll up, and — critically —
 * bad data (missing parents, self-parents, parent cycles) surfaces sites
 * as roots instead of hiding them or hanging the page.
 */

function row(
  id: string,
  name: string,
  parentSiteId?: string | undefined,
): SiteTreeRow {
  return { _id: id, name: name, parentSiteId: parentSiteId };
}

function names(nodes: Array<SiteTreeNode>): Array<string> {
  return nodes.map((node: SiteTreeNode) => {
    return node.site.name || "";
  });
}

describe("buildSiteTree", () => {
  test("nests children under parents and sorts every level by name", () => {
    const roots: Array<SiteTreeNode> = buildSiteTree(
      [
        row("r2", "West Region"),
        row("r1", "East Region"),
        row("u2", "Unit B", "r1"),
        row("u1", "Unit A", "r1"),
      ],
      {},
    );

    expect(names(roots)).toEqual(["East Region", "West Region"]);
    expect(names(roots[0]!.children)).toEqual(["Unit A", "Unit B"]);
    expect(roots[0]!.children[0]!.depth).toBe(1);
    expect(roots[0]!.depth).toBe(0);
  });

  test("rolls device counts up the subtree", () => {
    const roots: Array<SiteTreeNode> = buildSiteTree(
      [row("r1", "Region"), row("m1", "Market", "r1"), row("u1", "Unit", "m1")],
      { u1: 3, m1: 1 },
    );

    const region: SiteTreeNode = roots[0]!;
    expect(region.deviceCount).toBe(0);
    expect(region.subtreeDeviceCount).toBe(4);
    expect(region.children[0]!.subtreeDeviceCount).toBe(4);
    expect(region.children[0]!.children[0]!.subtreeDeviceCount).toBe(3);
  });

  test("a missing parent promotes the subtree to a root instead of hiding it", () => {
    const roots: Array<SiteTreeNode> = buildSiteTree(
      [row("u1", "Orphan Unit", "deleted-parent-id")],
      {},
    );

    expect(names(roots)).toEqual(["Orphan Unit"]);
    expect(roots[0]!.depth).toBe(0);
  });

  test("a self-parented row becomes a root rather than trusted", () => {
    const roots: Array<SiteTreeNode> = buildSiteTree(
      [row("s1", "Self Parent", "s1")],
      {},
    );

    expect(names(roots)).toEqual(["Self Parent"]);
  });

  test("a parent cycle cannot hang the build and both members surface", () => {
    const roots: Array<SiteTreeNode> = buildSiteTree(
      [row("a", "Site A", "b"), row("b", "Site B", "a"), row("r", "Root")],
      {},
    );

    // All three sites are reachable from the returned roots.
    expect(countTreeNodes(roots)).toBe(3);
    expect(names(roots)).toContain("Root");
    // Promoted cycle members keep the root list name-ordered.
    expect(names(roots)).toEqual([...names(roots)].sort());
  });

  test("rows without an id are skipped, not crashed on", () => {
    const roots: Array<SiteTreeNode> = buildSiteTree(
      [{ name: "No ID" }, row("r", "Root")],
      {},
    );

    expect(countTreeNodes(roots)).toBe(1);
  });
});

describe("countTreeNodes", () => {
  test("counts every node at every depth", () => {
    const roots: Array<SiteTreeNode> = buildSiteTree(
      [
        row("r1", "Region"),
        row("m1", "Market", "r1"),
        row("u1", "Unit 1", "m1"),
        row("u2", "Unit 2", "m1"),
      ],
      {},
    );

    expect(countTreeNodes(roots)).toBe(4);
    expect(countTreeNodes([])).toBe(0);
  });
});

describe("filterSiteTree: what the hierarchy draws of hundreds of sites (#10188)", () => {
  // A region with two markets, a store in each, and 700 flat Meraki stores.
  function estate(): Array<SiteTreeNode> {
    const rows: Array<SiteTreeRow> = [
      row("north", "North"),
      row("leeds", "Leeds", "north"),
      row("york", "York", "north"),
      row("s-leeds", "Store 0660", "leeds"),
      row("s-york", "Store 0101", "york"),
    ];

    for (let index: number = 1; index <= 700; index++) {
      rows.push(row(`m-${index}`, `Meraki ${String(index).padStart(4, "0")}`));
    }

    return buildSiteTree(rows, { "s-leeds": 3, "m-7": 2 });
  }

  function idsOf(nodes: Array<SiteTreeNode>): Array<string> {
    return nodes.map((node: SiteTreeNode): string => {
      return node.site._id || "";
    });
  }

  test("nothing asked: every site kept, nothing opened", () => {
    const filtered: FilteredSiteTree = filterSiteTree(estate(), {
      search: "",
      hideEmpty: false,
    });

    expect(filtered.isSearching).toBe(false);
    expect(filtered.roots).toHaveLength(701);
    expect(filtered.matchCount).toBe(705);
    expect(filtered.openIds.size).toBe(0);
  });

  test("a search keeps what it finds and the sites above it, which it opens", () => {
    // "Meraki 0660" has the number, not the word "store".
    const filtered: FilteredSiteTree = filterSiteTree(estate(), {
      search: "store 0660",
      hideEmpty: false,
    });

    expect(filtered.isSearching).toBe(true);
    expect(filtered.matchCount).toBe(1);
    expect(idsOf(filtered.roots)).toEqual(["north"]);
    expect(idsOf(filtered.roots[0]!.children)).toEqual(["leeds"]);
    expect(idsOf(filtered.roots[0]!.children[0]!.children)).toEqual([
      "s-leeds",
    ]);
    expect(Array.from(filtered.openIds).sort()).toEqual(["leeds", "north"]);
  });

  test("a site found by its name keeps the sites below it, closed, to open", () => {
    const filtered: FilteredSiteTree = filterSiteTree(estate(), {
      search: "north",
      hideEmpty: false,
    });

    expect(filtered.matchCount).toBe(1);
    expect(idsOf(filtered.roots)).toEqual(["north"]);
    expect(idsOf(filtered.roots[0]!.children)).toEqual(["leeds", "york"]);
    // Nothing below it was found, so nothing is drawn open.
    expect(filtered.openIds.size).toBe(0);
  });

  test("every word must be in the name, in any order and case", () => {
    expect(getSiteSearchWords("  Store   0660 ")).toEqual(["store", "0660"]);
    expect(siteNameMatches("Store 0660", ["0660", "store"])).toBe(true);
    expect(siteNameMatches("Store 0660", ["store", "0101"])).toBe(false);
    expect(siteNameMatches(undefined, ["store"])).toBe(false);

    const filtered: FilteredSiteTree = filterSiteTree(estate(), {
      search: "MERAKI 007",
      hideEmpty: false,
    });

    // Meraki 0007, and 0070 to 0079.
    expect(filtered.matchCount).toBe(11);
    expect(filtered.roots).toHaveLength(11);
  });

  test("hiding the sites with no devices leaves out each subtree that holds none", () => {
    const filtered: FilteredSiteTree = filterSiteTree(estate(), {
      search: "",
      hideEmpty: true,
    });

    expect(idsOf(filtered.roots)).toEqual(["m-7", "north"]);
    // York's subtree holds no device: gone; Leeds holds its store's three.
    expect(idsOf(filtered.roots[1]!.children)).toEqual(["leeds"]);
    expect(filtered.roots[1]!.subtreeDeviceCount).toBe(3);
    expect(filtered.matchCount).toBe(4);
  });

  test("search and hiding together; nothing found leaves no roots", () => {
    expect(
      filterSiteTree(estate(), { search: "york", hideEmpty: true }).roots,
    ).toEqual([]);
    expect(
      filterSiteTree(estate(), { search: "nowhere", hideEmpty: false }),
    ).toMatchObject({ roots: [], matchCount: 0, isSearching: true });
  });

  test("the tree it is given is left as it was", () => {
    const roots: Array<SiteTreeNode> = estate();

    filterSiteTree(roots, { search: "store 0660", hideEmpty: true });

    expect(roots).toHaveLength(701);
    expect(idsOf(roots[701 - 1]!.children)).toEqual(["leeds", "york"]);
  });
});
