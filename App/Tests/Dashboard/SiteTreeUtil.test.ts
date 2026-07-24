import { describe, expect, test } from "@jest/globals";
import {
  SiteTreeNode,
  SiteTreeRow,
  buildSiteTree,
  countTreeNodes,
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
