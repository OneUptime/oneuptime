import NetworkSiteType from "../../../Models/DatabaseModels/NetworkSiteType";
import ObjectID from "../../../Types/ObjectID";
import NetworkSiteTypeHierarchyUtil, {
  NetworkSiteTypeHierarchyNode,
} from "../../../Utils/NetworkSite/TypeHierarchyUtil";
import { describe, expect, it } from "@jest/globals";

function typeId(index: number): ObjectID {
  return new ObjectID(
    `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, "0")}`,
  );
}

function makeType(data: {
  index: number;
  name: string;
  order?: number | undefined;
  parentIndex?: number | undefined;
  isUnitLevel?: boolean | undefined;
}): NetworkSiteType {
  const networkSiteType: NetworkSiteType = new NetworkSiteType();
  networkSiteType.id = typeId(data.index);
  networkSiteType.name = data.name;

  if (data.order !== undefined) {
    networkSiteType.order = data.order;
  }

  if (data.isUnitLevel !== undefined) {
    networkSiteType.isUnitLevel = data.isUnitLevel;
  }

  if (data.parentIndex !== undefined) {
    networkSiteType.parentNetworkSiteTypeId = typeId(data.parentIndex);
  }

  return networkSiteType;
}

function flatten(
  tree: Array<NetworkSiteTypeHierarchyNode>,
): Array<NetworkSiteTypeHierarchyNode> {
  return tree.flatMap((node: NetworkSiteTypeHierarchyNode) => {
    return [node, ...flatten(node.children)];
  });
}

describe("NetworkSiteTypeHierarchyUtil", () => {
  it("builds a parent tree and orders siblings by order then name", () => {
    const account: NetworkSiteType = makeType({
      index: 1,
      name: "Account",
      order: 1,
    });
    const regionB: NetworkSiteType = makeType({
      index: 2,
      name: "Region B",
      order: 2,
      parentIndex: 1,
    });
    const regionA: NetworkSiteType = makeType({
      index: 3,
      name: "Region A",
      order: 2,
      parentIndex: 1,
    });
    const unordered: NetworkSiteType = makeType({
      index: 4,
      name: "Unordered",
      parentIndex: 1,
    });

    const tree: Array<NetworkSiteTypeHierarchyNode> =
      NetworkSiteTypeHierarchyUtil.buildTree({
        networkSiteTypes: [unordered, regionB, account, regionA],
      });

    expect(
      tree.map((node: NetworkSiteTypeHierarchyNode) => {
        return node.networkSiteType.name;
      }),
    ).toEqual(["Account"]);
    expect(
      tree[0]!.children.map((node: NetworkSiteTypeHierarchyNode) => {
        return node.networkSiteType.name;
      }),
    ).toEqual(["Region A", "Region B", "Unordered"]);
    expect(
      tree[0]!.children.every((node: NetworkSiteTypeHierarchyNode) => {
        return node.depth === 1;
      }),
    ).toBe(true);
  });

  it("reads a serialized relation when the scalar parent ID is absent", () => {
    const parent: NetworkSiteType = makeType({ index: 1, name: "Parent" });
    const child: NetworkSiteType = makeType({ index: 2, name: "Child" });
    child.parentNetworkSiteType = parent;

    expect(NetworkSiteTypeHierarchyUtil.getParentId(child)).toBe(
      parent.id!.toString(),
    );
  });

  it("returns ancestors closest-first and a root-first breadcrumb", () => {
    const account: NetworkSiteType = makeType({ index: 1, name: "Account" });
    const region: NetworkSiteType = makeType({
      index: 2,
      name: "Region",
      parentIndex: 1,
    });
    const unit: NetworkSiteType = makeType({
      index: 3,
      name: "Unit",
      parentIndex: 2,
    });
    const all: Array<NetworkSiteType> = [unit, account, region];

    expect(
      NetworkSiteTypeHierarchyUtil.getAncestorNetworkSiteTypes({
        networkSiteType: unit,
        networkSiteTypes: all,
      }).map((networkSiteType: NetworkSiteType) => {
        return networkSiteType.name;
      }),
    ).toEqual(["Region", "Account"]);
    expect(
      NetworkSiteTypeHierarchyUtil.getBreadcrumbLabel({
        networkSiteType: unit,
        networkSiteTypes: all,
      }),
    ).toBe("Account › Region › Unit");
  });

  it("excludes self, descendants, and unit-level types from parent candidates", () => {
    const root: NetworkSiteType = makeType({ index: 1, name: "Root" });
    const moving: NetworkSiteType = makeType({
      index: 2,
      name: "Moving",
      parentIndex: 1,
    });
    const descendant: NetworkSiteType = makeType({
      index: 3,
      name: "Descendant",
      parentIndex: 2,
    });
    const other: NetworkSiteType = makeType({ index: 4, name: "Other" });
    const unit: NetworkSiteType = makeType({
      index: 5,
      name: "Unit",
      isUnitLevel: true,
    });

    expect(
      NetworkSiteTypeHierarchyUtil.getValidParentCandidates({
        networkSiteType: moving,
        networkSiteTypes: [descendant, unit, moving, other, root],
      }).map((networkSiteType: NetworkSiteType) => {
        return networkSiteType.name;
      }),
    ).toEqual(["Other", "Root"]);
  });

  it("promotes orphans to roots so they remain visible", () => {
    const orphan: NetworkSiteType = makeType({
      index: 1,
      name: "Orphan",
      parentIndex: 99,
    });

    const tree: Array<NetworkSiteTypeHierarchyNode> =
      NetworkSiteTypeHierarchyUtil.buildTree({ networkSiteTypes: [orphan] });

    expect(tree).toHaveLength(1);
    expect(tree[0]!.networkSiteType).toBe(orphan);
    expect(tree[0]!.depth).toBe(0);
  });

  it("terminates cycles and includes every type exactly once", () => {
    const a: NetworkSiteType = makeType({
      index: 1,
      name: "A",
      parentIndex: 3,
    });
    const b: NetworkSiteType = makeType({
      index: 2,
      name: "B",
      parentIndex: 1,
    });
    const c: NetworkSiteType = makeType({
      index: 3,
      name: "C",
      parentIndex: 2,
    });

    const nodes: Array<NetworkSiteTypeHierarchyNode> = flatten(
      NetworkSiteTypeHierarchyUtil.buildTree({ networkSiteTypes: [a, b, c] }),
    );

    expect(nodes).toHaveLength(3);
    expect(
      new Set(
        nodes.map((node: NetworkSiteTypeHierarchyNode) => {
          return node.networkSiteType.id!.toString();
        }),
      ).size,
    ).toBe(3);
  });
});

/*
 * The site PLACEMENT rule, as opposed to the catalog's own shape rule. A site
 * may sit under any site whose type the hierarchy does not place below its
 * own; requiring an exact configured-parent match is what made real
 * hierarchies unbuildable in GitHub issue #3744.
 */
describe("NetworkSiteTypeHierarchyUtil site placement rule", () => {
  /*
   * Account › Region › Market › Unit (unit level), plus an unrelated root
   * "Other" — the catch-all the reporting project was trying to nest under.
   */
  function catalog(): Array<NetworkSiteType> {
    return [
      makeType({ index: 1, name: "Account", order: 1 }),
      makeType({ index: 2, name: "Region", order: 2, parentIndex: 1 }),
      makeType({ index: 3, name: "Market", order: 3, parentIndex: 2 }),
      makeType({
        index: 4,
        name: "Unit",
        order: 4,
        parentIndex: 3,
        isUnitLevel: true,
      }),
      makeType({ index: 5, name: "Other", order: 5 }),
    ];
  }

  function allowed(childIndex: number, parentIndex: number | null): boolean {
    return NetworkSiteTypeHierarchyUtil.isTypeAllowedAsSiteParentOfType({
      childNetworkSiteTypeId: typeId(childIndex).toString(),
      parentNetworkSiteTypeId:
        parentIndex === null ? null : typeId(parentIndex).toString(),
      networkSiteTypes: catalog(),
    });
  }

  it("allows the configured parent type", () => {
    expect(allowed(3, 2)).toBe(true);
  });

  it("allows an unrelated type on either side", () => {
    expect(allowed(3, 5)).toBe(true);
    expect(allowed(5, 3)).toBe(true);
  });

  it("allows a skipped level", () => {
    expect(allowed(4, 1)).toBe(true);
  });

  it("allows the same type on both sides", () => {
    expect(allowed(5, 5)).toBe(true);
    expect(allowed(2, 2)).toBe(true);
  });

  it("allows a parent with no type at all", () => {
    expect(allowed(3, null)).toBe(true);
  });

  it("allows a child with no type", () => {
    expect(
      NetworkSiteTypeHierarchyUtil.isTypeAllowedAsSiteParentOfType({
        childNetworkSiteTypeId: null,
        parentNetworkSiteTypeId: typeId(3).toString(),
        networkSiteTypes: catalog(),
      }),
    ).toBe(true);
  });

  it("refuses a parent whose type is a direct child of the child's type", () => {
    expect(allowed(2, 3)).toBe(false);
  });

  it("refuses a parent whose type is a deeper descendant", () => {
    expect(allowed(1, 3)).toBe(false);
  });

  it("refuses a unit-level parent whatever the child type", () => {
    expect(allowed(5, 4)).toBe(false);
    expect(allowed(1, 4)).toBe(false);
    expect(allowed(4, 4)).toBe(false);
  });

  it("is case-insensitive about ids", () => {
    expect(
      NetworkSiteTypeHierarchyUtil.isTypeAllowedAsSiteParentOfType({
        childNetworkSiteTypeId: typeId(2).toString().toUpperCase(),
        parentNetworkSiteTypeId: typeId(3).toString().toUpperCase(),
        networkSiteTypes: catalog(),
      }),
    ).toBe(false);
  });

  it("treats a type whose parent link names nothing as a root", () => {
    const orphan: NetworkSiteType = makeType({
      index: 9,
      name: "Orphan",
      parentIndex: 99,
    });

    expect(
      NetworkSiteTypeHierarchyUtil.isTypeAllowedAsSiteParentOfType({
        childNetworkSiteTypeId: typeId(1).toString(),
        parentNetworkSiteTypeId: typeId(9).toString(),
        networkSiteTypes: [...catalog(), orphan],
      }),
    ).toBe(true);
  });

  it("terminates on a cyclic catalog instead of looping forever", () => {
    const cyclic: Array<NetworkSiteType> = [
      makeType({ index: 1, name: "A", parentIndex: 2 }),
      makeType({ index: 2, name: "B", parentIndex: 1 }),
      makeType({ index: 3, name: "C" }),
    ];

    expect(
      NetworkSiteTypeHierarchyUtil.isTypeAllowedAsSiteParentOfType({
        childNetworkSiteTypeId: typeId(3).toString(),
        parentNetworkSiteTypeId: typeId(1).toString(),
        networkSiteTypes: cyclic,
      }),
    ).toBe(true);

    // The cycle still answers its own membership question correctly.
    expect(
      NetworkSiteTypeHierarchyUtil.isTypeAllowedAsSiteParentOfType({
        childNetworkSiteTypeId: typeId(2).toString(),
        parentNetworkSiteTypeId: typeId(1).toString(),
        networkSiteTypes: cyclic,
      }),
    ).toBe(false);
  });

  it("lists the types a site may be placed under", () => {
    expect(
      NetworkSiteTypeHierarchyUtil.getValidSiteParentTypes({
        networkSiteTypeId: typeId(2).toString(),
        networkSiteTypes: catalog(),
      }).map((networkSiteType: NetworkSiteType) => {
        return networkSiteType.name;
      }),
    ).toEqual(["Account", "Region", "Other"]);
  });

  it("lists the types a new child site may take, mirroring the parent list", () => {
    expect(
      NetworkSiteTypeHierarchyUtil.getValidSiteChildTypes({
        networkSiteTypeId: typeId(2).toString(),
        networkSiteTypes: catalog(),
      }).map((networkSiteType: NetworkSiteType) => {
        return networkSiteType.name;
      }),
    ).toEqual(["Region", "Market", "Unit", "Other"]);
  });

  it("offers no child type at all under a unit-level site", () => {
    expect(
      NetworkSiteTypeHierarchyUtil.getValidSiteChildTypes({
        networkSiteTypeId: typeId(4).toString(),
        networkSiteTypes: catalog(),
      }),
    ).toEqual([]);
  });

  it("offers every type under a site that has no type", () => {
    expect(
      NetworkSiteTypeHierarchyUtil.getValidSiteChildTypes({
        networkSiteTypeId: null,
        networkSiteTypes: catalog(),
      }),
    ).toHaveLength(5);
  });
});
