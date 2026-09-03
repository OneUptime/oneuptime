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
