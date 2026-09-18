import StatusPageGroupTreeUtil, {
  StatusPageGroupTreeIndex,
  StatusPageGroupTreeNode,
} from "../../../Utils/StatusPage/GroupTree";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - status page groups nest, and every read path on the
 * status page walks that tree:
 *
 *   - children / roots / descendants / ancestors are derived from a single
 *     nullable parent pointer,
 *   - siblings come back in `order`,
 *   - and no shape of bad data (self parent, missing parent, a cycle written
 *     straight to the database) may drop a group from the tree or hang the
 *     walk. A dropped group is a resource silently missing from a customer's
 *     status page, so every helper is exercised against those shapes too.
 */

const CORPORATE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const REGION_ONE: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const REGION_TWO: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MARKET: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const UNIT: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const MISSING: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

function makeGroup(data: {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
  order?: number | undefined;
}): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id.toString();
  group.name = data.name;

  if (data.parentId) {
    group.parentStatusPageGroupId = data.parentId;
  }

  if (data.order !== undefined) {
    group.order = data.order;
  }

  return group;
}

/*
 * Corporate
 *   Region 1000
 *     Market 1001
 *       Unit 0152
 *   Region 2000
 */
function makeHierarchy(): Array<StatusPageGroup> {
  return [
    makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
    makeGroup({
      id: REGION_ONE,
      name: "Region 1000",
      parentId: CORPORATE,
      order: 2,
    }),
    makeGroup({
      id: MARKET,
      name: "Market 1001",
      parentId: REGION_ONE,
      order: 3,
    }),
    makeGroup({ id: UNIT, name: "Unit 0152", parentId: MARKET, order: 4 }),
    makeGroup({
      id: REGION_TWO,
      name: "Region 2000",
      parentId: CORPORATE,
      order: 5,
    }),
  ];
}

function namesOf(groups: Array<StatusPageGroup>): Array<string> {
  return groups.map((group: StatusPageGroup) => {
    return group.name || "";
  });
}

/*
 * Counts how many times the walk under test asks a group who its parent is.
 * That read is the primitive every tree helper is built on, so counting it is
 * a deterministic stand-in for "did this scan the whole list per node?" - a
 * wall clock assertion would just be a flake on a loaded CI box.
 */
function watchParentReads(groups: Array<StatusPageGroup>): () => number {
  let reads: number = 0;

  const watch: (group: StatusPageGroup) => void = (
    group: StatusPageGroup,
  ): void => {
    const actualParentId: ObjectID | undefined = group.parentStatusPageGroupId;

    Object.defineProperty(group, "parentStatusPageGroupId", {
      configurable: true,
      get: (): ObjectID | undefined => {
        reads++;
        return actualParentId;
      },
    });
  };

  groups.forEach(watch);

  return (): number => {
    return reads;
  };
}

describe("StatusPageGroupTreeUtil", () => {
  describe("getParentId", () => {
    test("returns null for a top level group", () => {
      const group: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "Corporate",
      });

      expect(StatusPageGroupTreeUtil.getParentId(group)).toBeNull();
    });

    test("returns the parent id when nested", () => {
      const group: StatusPageGroup = makeGroup({
        id: REGION_ONE,
        name: "Region 1000",
        parentId: CORPORATE,
      });

      expect(StatusPageGroupTreeUtil.getParentId(group)).toBe(
        CORPORATE.toString(),
      );
    });

    test("treats a group that points at itself as a top level group", () => {
      const group: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "Corporate",
        parentId: CORPORATE,
      });

      expect(StatusPageGroupTreeUtil.getParentId(group)).toBeNull();
    });
  });

  describe("getChildGroups", () => {
    test("returns only direct children, not grandchildren", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const children: Array<StatusPageGroup> =
        StatusPageGroupTreeUtil.getChildGroups({
          statusPageGroupId: CORPORATE.toString(),
          statusPageGroups: groups,
        });

      expect(namesOf(children)).toEqual(["Region 1000", "Region 2000"]);
    });

    test("returns children of a leaf as an empty array", () => {
      expect(
        StatusPageGroupTreeUtil.getChildGroups({
          statusPageGroupId: UNIT.toString(),
          statusPageGroups: makeHierarchy(),
        }),
      ).toHaveLength(0);
    });

    test("null asks for the groups with no parent", () => {
      const roots: Array<StatusPageGroup> =
        StatusPageGroupTreeUtil.getChildGroups({
          statusPageGroupId: null,
          statusPageGroups: makeHierarchy(),
        });

      expect(namesOf(roots)).toEqual(["Corporate"]);
    });

    test("siblings come back in `order`, not in insertion order", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        makeGroup({
          id: REGION_TWO,
          name: "Region 2000",
          parentId: CORPORATE,
          order: 9,
        }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: CORPORATE,
          order: 2,
        }),
      ];

      expect(
        namesOf(
          StatusPageGroupTreeUtil.getChildGroups({
            statusPageGroupId: CORPORATE.toString(),
            statusPageGroups: groups,
          }),
        ),
      ).toEqual(["Region 1000", "Region 2000"]);
    });

    test("groups without an order keep their incoming position, after ordered ones", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        makeGroup({ id: REGION_TWO, name: "Unordered", parentId: CORPORATE }),
        makeGroup({
          id: REGION_ONE,
          name: "Ordered",
          parentId: CORPORATE,
          order: 4,
        }),
      ];

      expect(
        namesOf(
          StatusPageGroupTreeUtil.getChildGroups({
            statusPageGroupId: CORPORATE.toString(),
            statusPageGroups: groups,
          }),
        ),
      ).toEqual(["Ordered", "Unordered"]);
    });
  });

  describe("getRootGroups", () => {
    test("returns only the top of the hierarchy", () => {
      expect(
        namesOf(
          StatusPageGroupTreeUtil.getRootGroups({
            statusPageGroups: makeHierarchy(),
          }),
        ),
      ).toEqual(["Corporate"]);
    });

    test("a flat list of groups is all roots", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "A", order: 1 }),
        makeGroup({ id: REGION_ONE, name: "B", order: 2 }),
      ];

      expect(
        StatusPageGroupTreeUtil.getRootGroups({ statusPageGroups: groups }),
      ).toHaveLength(2);
    });

    /*
     * A group whose parent was not fetched (or no longer exists) must still be
     * rendered somewhere, so it is promoted rather than hidden.
     */
    test("a group whose parent is not in the list is promoted to a root", () => {
      const orphan: StatusPageGroup = makeGroup({
        id: REGION_ONE,
        name: "Orphan",
        parentId: MISSING,
        order: 2,
      });

      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        orphan,
      ];

      expect(
        namesOf(
          StatusPageGroupTreeUtil.getRootGroups({ statusPageGroups: groups }),
        ),
      ).toEqual(["Corporate", "Orphan"]);
    });

    test("an empty list has no roots", () => {
      expect(
        StatusPageGroupTreeUtil.getRootGroups({ statusPageGroups: [] }),
      ).toHaveLength(0);
    });
  });

  describe("getDescendantGroups", () => {
    test("returns the whole subtree, excluding the group itself", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const descendants: Array<StatusPageGroup> =
        StatusPageGroupTreeUtil.getDescendantGroups({
          statusPageGroup: groups[0]!,
          statusPageGroups: groups,
        });

      expect(namesOf(descendants).sort()).toEqual([
        "Market 1001",
        "Region 1000",
        "Region 2000",
        "Unit 0152",
      ]);
    });

    test("returns nothing for a leaf", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupTreeUtil.getDescendantGroups({
          statusPageGroup: groups[3]!,
          statusPageGroups: groups,
        }),
      ).toHaveLength(0);
    });

    test("does not loop forever on a cycle written straight to the database", () => {
      // A -> B -> A
      const a: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "A",
        parentId: REGION_ONE,
        order: 1,
      });
      const b: StatusPageGroup = makeGroup({
        id: REGION_ONE,
        name: "B",
        parentId: CORPORATE,
        order: 2,
      });

      const descendants: Array<StatusPageGroup> =
        StatusPageGroupTreeUtil.getDescendantGroups({
          statusPageGroup: a,
          statusPageGroups: [a, b],
        });

      expect(namesOf(descendants)).toEqual(["B"]);
    });
  });

  describe("getGroupAndDescendants", () => {
    test("includes the group itself first", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const subtree: Array<StatusPageGroup> =
        StatusPageGroupTreeUtil.getGroupAndDescendants({
          statusPageGroup: groups[1]!,
          statusPageGroups: groups,
        });

      expect(namesOf(subtree)).toEqual([
        "Region 1000",
        "Market 1001",
        "Unit 0152",
      ]);
    });

    test("a group with no hierarchy supplied covers only itself", () => {
      const group: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "Corporate",
      });

      expect(
        StatusPageGroupTreeUtil.getGroupAndDescendants({
          statusPageGroup: group,
          statusPageGroups: [group],
        }),
      ).toHaveLength(1);
    });
  });

  describe("getAncestorGroups", () => {
    test("returns the chain to the root, closest parent first", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        namesOf(
          StatusPageGroupTreeUtil.getAncestorGroups({
            statusPageGroup: groups[3]!,
            statusPageGroups: groups,
          }),
        ),
      ).toEqual(["Market 1001", "Region 1000", "Corporate"]);
    });

    test("a root has no ancestors", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupTreeUtil.getAncestorGroups({
          statusPageGroup: groups[0]!,
          statusPageGroups: groups,
        }),
      ).toHaveLength(0);
    });

    test("stops at a missing parent instead of throwing", () => {
      const orphan: StatusPageGroup = makeGroup({
        id: REGION_ONE,
        name: "Orphan",
        parentId: MISSING,
      });

      expect(
        StatusPageGroupTreeUtil.getAncestorGroups({
          statusPageGroup: orphan,
          statusPageGroups: [orphan],
        }),
      ).toHaveLength(0);
    });

    test("stops at a cycle instead of looping forever", () => {
      const a: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "A",
        parentId: REGION_ONE,
      });
      const b: StatusPageGroup = makeGroup({
        id: REGION_ONE,
        name: "B",
        parentId: CORPORATE,
      });

      expect(
        namesOf(
          StatusPageGroupTreeUtil.getAncestorGroups({
            statusPageGroup: a,
            statusPageGroups: [a, b],
          }),
        ),
      ).toEqual(["B"]);
    });
  });

  describe("getDepth", () => {
    test("counts levels from the top", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupTreeUtil.getDepth({
          statusPageGroup: groups[0]!,
          statusPageGroups: groups,
        }),
      ).toBe(0);

      expect(
        StatusPageGroupTreeUtil.getDepth({
          statusPageGroup: groups[3]!,
          statusPageGroups: groups,
        }),
      ).toBe(3);
    });
  });

  describe("isDescendantOf", () => {
    test("is true for a grandchild", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupTreeUtil.isDescendantOf({
          statusPageGroup: groups[3]!,
          possibleAncestorId: CORPORATE.toString(),
          statusPageGroups: groups,
        }),
      ).toBe(true);
    });

    test("is false across branches", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupTreeUtil.isDescendantOf({
          statusPageGroup: groups[4]!,
          possibleAncestorId: REGION_ONE.toString(),
          statusPageGroups: groups,
        }),
      ).toBe(false);
    });

    test("a group is not a descendant of itself", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupTreeUtil.isDescendantOf({
          statusPageGroup: groups[0]!,
          possibleAncestorId: CORPORATE.toString(),
          statusPageGroups: groups,
        }),
      ).toBe(false);
    });
  });

  describe("buildTree", () => {
    test("nests each level under its parent and records depth", () => {
      const tree: Array<StatusPageGroupTreeNode> =
        StatusPageGroupTreeUtil.buildTree({
          statusPageGroups: makeHierarchy(),
        });

      expect(tree).toHaveLength(1);

      const corporate: StatusPageGroupTreeNode = tree[0]!;
      expect(corporate.group.name).toBe("Corporate");
      expect(corporate.depth).toBe(0);
      expect(
        corporate.children.map((node: StatusPageGroupTreeNode) => {
          return node.group.name;
        }),
      ).toEqual(["Region 1000", "Region 2000"]);

      const regionOne: StatusPageGroupTreeNode = corporate.children[0]!;
      expect(regionOne.depth).toBe(1);
      expect(regionOne.children[0]!.group.name).toBe("Market 1001");
      expect(regionOne.children[0]!.depth).toBe(2);
      expect(regionOne.children[0]!.children[0]!.group.name).toBe("Unit 0152");
      expect(regionOne.children[0]!.children[0]!.depth).toBe(3);
    });

    test("every group appears exactly once", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const seen: Array<string> = [];

      const visit: (nodes: Array<StatusPageGroupTreeNode>) => void = (
        nodes: Array<StatusPageGroupTreeNode>,
      ): void => {
        for (const node of nodes) {
          seen.push(node.group.name || "");
          visit(node.children);
        }
      };

      visit(StatusPageGroupTreeUtil.buildTree({ statusPageGroups: groups }));

      expect(seen).toHaveLength(groups.length);
      expect(new Set(seen).size).toBe(groups.length);
    });

    /*
     * Groups caught in a cycle are reachable from no root. They must still be
     * shown - dropping them would silently hide monitors from the page.
     */
    test("promotes groups stuck in a cycle to the top level rather than dropping them", () => {
      const a: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "A",
        parentId: REGION_ONE,
        order: 1,
      });
      const b: StatusPageGroup = makeGroup({
        id: REGION_ONE,
        name: "B",
        parentId: CORPORATE,
        order: 2,
      });

      const tree: Array<StatusPageGroupTreeNode> =
        StatusPageGroupTreeUtil.buildTree({ statusPageGroups: [a, b] });

      const seen: Array<string> = [];

      const visit: (nodes: Array<StatusPageGroupTreeNode>) => void = (
        nodes: Array<StatusPageGroupTreeNode>,
      ): void => {
        for (const node of nodes) {
          seen.push(node.group.name || "");
          visit(node.children);
        }
      };

      visit(tree);

      expect(seen.sort()).toEqual(["A", "B"]);
    });

    test("an orphan renders at the top level", () => {
      const orphan: StatusPageGroup = makeGroup({
        id: REGION_ONE,
        name: "Orphan",
        parentId: MISSING,
        order: 2,
      });
      const root: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "Corporate",
        order: 1,
      });

      const tree: Array<StatusPageGroupTreeNode> =
        StatusPageGroupTreeUtil.buildTree({
          statusPageGroups: [root, orphan],
        });

      expect(
        tree.map((node: StatusPageGroupTreeNode) => {
          return node.group.name;
        }),
      ).toEqual(["Corporate", "Orphan"]);
    });

    test("an empty list builds an empty tree", () => {
      expect(
        StatusPageGroupTreeUtil.buildTree({ statusPageGroups: [] }),
      ).toHaveLength(0);
    });
  });

  /*
   * The index is an optimisation, and the only thing that makes an
   * optimisation safe is that it cannot change an answer. Every helper is
   * therefore asserted to give byte-identical results with and without one,
   * across the same bad-data shapes the rest of this file covers.
   */
  describe("buildIndex", () => {
    test("buckets children under their parent, in order", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const index: StatusPageGroupTreeIndex =
        StatusPageGroupTreeUtil.buildIndex({ statusPageGroups: groups });

      expect(
        namesOf(index.childrenByParentId.get(CORPORATE.toString()) || []),
      ).toEqual(["Region 1000", "Region 2000"]);
      expect(namesOf(index.childrenByParentId.get(null) || [])).toEqual([
        "Corporate",
      ]);
      expect(index.byId.size).toBe(groups.length);
      expect(index.byId.get(UNIT.toString())?.name).toBe("Unit 0152");
    });

    /*
     * `null` rather than "" is the key for parentless groups on purpose: a
     * group with no id of its own reads as "" everywhere in this class, and a
     * string sentinel would make it adopt every root on the page.
     */
    test("a group with no id does not adopt the parentless groups", () => {
      const idless: StatusPageGroup = new StatusPageGroup();
      idless.name = "No id";

      const groups: Array<StatusPageGroup> = [...makeHierarchy(), idless];

      expect(
        StatusPageGroupTreeUtil.getChildGroups({
          statusPageGroupId: "",
          statusPageGroups: groups,
        }),
      ).toHaveLength(0);
    });

    test("mutating the array getChildGroups returns leaves the index intact", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();
      const index: StatusPageGroupTreeIndex =
        StatusPageGroupTreeUtil.buildIndex({ statusPageGroups: groups });

      const children: Array<StatusPageGroup> =
        StatusPageGroupTreeUtil.getChildGroups({
          statusPageGroupId: CORPORATE.toString(),
          statusPageGroups: groups,
          index: index,
        });

      children.pop();

      expect(
        namesOf(
          StatusPageGroupTreeUtil.getChildGroups({
            statusPageGroupId: CORPORATE.toString(),
            statusPageGroups: groups,
            index: index,
          }),
        ),
      ).toEqual(["Region 1000", "Region 2000"]);
    });

    describe("answers are identical with and without a supplied index", () => {
      function cycle(): Array<StatusPageGroup> {
        return [
          makeGroup({
            id: CORPORATE,
            name: "A",
            parentId: REGION_ONE,
            order: 1,
          }),
          makeGroup({
            id: REGION_ONE,
            name: "B",
            parentId: CORPORATE,
            order: 2,
          }),
        ];
      }

      function orphanAndSelfParent(): Array<StatusPageGroup> {
        return [
          makeGroup({ id: CORPORATE, name: "Self", parentId: CORPORATE }),
          makeGroup({ id: REGION_ONE, name: "Orphan", parentId: MISSING }),
          makeGroup({ id: MARKET, name: "Unordered" }),
        ];
      }

      const SHAPES: Array<{
        name: string;
        groups: () => Array<StatusPageGroup>;
      }> = [
        { name: "a normal hierarchy", groups: makeHierarchy },
        { name: "a cycle", groups: cycle },
        { name: "orphans and self parents", groups: orphanAndSelfParent },
        {
          name: "an empty list",
          groups: (): Array<StatusPageGroup> => {
            return [];
          },
        },
      ];

      test.each(SHAPES)(
        "$name",
        ({ groups }: { groups: () => Array<StatusPageGroup> }) => {
          const list: Array<StatusPageGroup> = groups();
          const index: StatusPageGroupTreeIndex =
            StatusPageGroupTreeUtil.buildIndex({ statusPageGroups: list });

          expect(
            namesOf(
              StatusPageGroupTreeUtil.getRootGroups({
                statusPageGroups: list,
                index: index,
              }),
            ),
          ).toEqual(
            namesOf(
              StatusPageGroupTreeUtil.getRootGroups({ statusPageGroups: list }),
            ),
          );

          const flatten: (
            nodes: Array<StatusPageGroupTreeNode>,
          ) => Array<string> = (
            nodes: Array<StatusPageGroupTreeNode>,
          ): Array<string> => {
            return nodes.flatMap((node: StatusPageGroupTreeNode) => {
              return [
                `${node.group.name}@${node.depth}`,
                ...flatten(node.children),
              ];
            });
          };

          expect(
            flatten(
              StatusPageGroupTreeUtil.buildTree({
                statusPageGroups: list,
                index: index,
              }),
            ),
          ).toEqual(
            flatten(
              StatusPageGroupTreeUtil.buildTree({ statusPageGroups: list }),
            ),
          );

          for (const group of list) {
            expect(
              namesOf(
                StatusPageGroupTreeUtil.getGroupAndDescendants({
                  statusPageGroup: group,
                  statusPageGroups: list,
                  index: index,
                }),
              ),
            ).toEqual(
              namesOf(
                StatusPageGroupTreeUtil.getGroupAndDescendants({
                  statusPageGroup: group,
                  statusPageGroups: list,
                }),
              ),
            );

            expect(
              namesOf(
                StatusPageGroupTreeUtil.getAncestorGroups({
                  statusPageGroup: group,
                  statusPageGroups: list,
                  index: index,
                }),
              ),
            ).toEqual(
              namesOf(
                StatusPageGroupTreeUtil.getAncestorGroups({
                  statusPageGroup: group,
                  statusPageGroups: list,
                }),
              ),
            );

            expect(
              StatusPageGroupTreeUtil.getDepth({
                statusPageGroup: group,
                statusPageGroups: list,
                index: index,
              }),
            ).toBe(
              StatusPageGroupTreeUtil.getDepth({
                statusPageGroup: group,
                statusPageGroups: list,
              }),
            );
          }
        },
      );
    });
  });

  /*
   * The bug this file's fix belongs to was filed against a status page with
   * 1506 groups. Nothing below asserts a wall clock time - a test that fails
   * on a loaded CI box is worse than no test - but the shape of the work is
   * pinned: every group has to come back, at the right depth, and the walk has
   * to stay near linear rather than degrading into a scan of the whole list
   * per node.
   */
  describe("at the size the bug was reported at", () => {
    const CORPORATE_UNITS: number = 6;
    const REGIONS_PER_UNIT: number = 5;
    const MARKETS_PER_REGION: number = 5;
    const SITES_PER_MARKET: number = 10;

    function makeLargeHierarchy(): Array<StatusPageGroup> {
      const groups: Array<StatusPageGroup> = [];
      let order: number = 0;

      const idFor: (label: string) => ObjectID = (label: string): ObjectID => {
        return new ObjectID(label);
      };

      for (let unit: number = 0; unit < CORPORATE_UNITS; unit++) {
        const unitId: ObjectID = idFor(`unit-${unit}`);
        groups.push(
          makeGroup({ id: unitId, name: `Unit ${unit}`, order: order++ }),
        );

        for (let region: number = 0; region < REGIONS_PER_UNIT; region++) {
          const regionId: ObjectID = idFor(`unit-${unit}-region-${region}`);
          groups.push(
            makeGroup({
              id: regionId,
              name: `Region ${unit}-${region}`,
              parentId: unitId,
              order: order++,
            }),
          );

          for (let market: number = 0; market < MARKETS_PER_REGION; market++) {
            const marketId: ObjectID = idFor(
              `unit-${unit}-region-${region}-market-${market}`,
            );
            groups.push(
              makeGroup({
                id: marketId,
                name: `Market ${unit}-${region}-${market}`,
                parentId: regionId,
                order: order++,
              }),
            );

            for (let site: number = 0; site < SITES_PER_MARKET; site++) {
              groups.push(
                makeGroup({
                  id: idFor(
                    `unit-${unit}-region-${region}-market-${market}-site-${site}`,
                  ),
                  name: `Site ${unit}-${region}-${market}-${site}`,
                  parentId: marketId,
                  order: order++,
                }),
              );
            }
          }
        }
      }

      return groups;
    }

    const EXPECTED_TOTAL: number =
      CORPORATE_UNITS *
      (1 +
        REGIONS_PER_UNIT * (1 + MARKETS_PER_REGION * (1 + SITES_PER_MARKET)));

    test("the fixture really is the reported size", () => {
      expect(makeLargeHierarchy()).toHaveLength(EXPECTED_TOTAL);
      expect(EXPECTED_TOTAL).toBeGreaterThan(1500);
    });

    test("every one of the groups reaches the tree, at the right depth", () => {
      const groups: Array<StatusPageGroup> = makeLargeHierarchy();

      const depthByName: Map<string, number> = new Map<string, number>();

      const visit: (nodes: Array<StatusPageGroupTreeNode>) => void = (
        nodes: Array<StatusPageGroupTreeNode>,
      ): void => {
        for (const node of nodes) {
          depthByName.set(node.group.name || "", node.depth);
          visit(node.children);
        }
      };

      visit(StatusPageGroupTreeUtil.buildTree({ statusPageGroups: groups }));

      expect(depthByName.size).toBe(groups.length);

      for (const group of groups) {
        const name: string = group.name || "";
        const expectedDepth: number = name.startsWith("Unit ")
          ? 0
          : name.startsWith("Region ")
            ? 1
            : name.startsWith("Market ")
              ? 2
              : 3;

        expect(depthByName.get(name)).toBe(expectedDepth);
      }
    });

    test("a subtree rollup covers exactly its own branch", () => {
      const groups: Array<StatusPageGroup> = makeLargeHierarchy();
      const index: StatusPageGroupTreeIndex =
        StatusPageGroupTreeUtil.buildIndex({ statusPageGroups: groups });

      const oneUnit: StatusPageGroup = groups.find((group: StatusPageGroup) => {
        return group.name === "Unit 3";
      })!;

      const subtree: Array<StatusPageGroup> =
        StatusPageGroupTreeUtil.getGroupAndDescendants({
          statusPageGroup: oneUnit,
          statusPageGroups: groups,
          index: index,
        });

      expect(subtree).toHaveLength(
        1 +
          REGIONS_PER_UNIT * (1 + MARKETS_PER_REGION * (1 + SITES_PER_MARKET)),
      );

      for (const group of subtree) {
        expect(group.name).toMatch(/(Unit 3|[A-Za-z]+ 3-)/);
      }
    });

    /*
     * The regression guard for the walk itself. Before the index, answering
     * "who are this group's children?" filtered the whole list, so one full
     * pass over the tree touched every group once per node - at this size,
     * millions of comparisons. Counting parent reads rather than milliseconds
     * keeps this deterministic: a scan-per-node implementation lands at
     * groups x nodes, which is three orders of magnitude above the bound here.
     */
    test("building the tree does not re-scan the group list per node", () => {
      const groups: Array<StatusPageGroup> = makeLargeHierarchy();
      const countParentReads: () => number = watchParentReads(groups);

      StatusPageGroupTreeUtil.buildTree({ statusPageGroups: groups });

      // One bucketing pass plus the root scan, not one scan per node.
      expect(countParentReads()).toBeLessThan(groups.length * 4);
    });

    test("a rollup per group stays near linear when the index is shared", () => {
      const groups: Array<StatusPageGroup> = makeLargeHierarchy();
      const index: StatusPageGroupTreeIndex =
        StatusPageGroupTreeUtil.buildIndex({ statusPageGroups: groups });

      const countParentReads: () => number = watchParentReads(groups);

      for (const group of groups) {
        StatusPageGroupTreeUtil.getGroupAndDescendants({
          statusPageGroup: group,
          statusPageGroups: groups,
          index: index,
        });
      }

      /*
       * A shared index means a subtree walk reads no parent pointers at all.
       * Without one this loop is groups x groups reads - over two million.
       */
      expect(countParentReads()).toBe(0);
    });

    /*
     * Nesting is capped on write, but rows written straight to the database
     * are not, and a chain that deep must not blow the recursion in buildTree.
     */
    test("a long chain of nested groups still builds", () => {
      const groups: Array<StatusPageGroup> = [];
      let previousId: ObjectID | undefined = undefined;

      for (let i: number = 0; i < 1000; i++) {
        const id: ObjectID = new ObjectID(`chain-${i}`);
        groups.push(
          makeGroup({
            id: id,
            name: `Level ${i}`,
            parentId: previousId,
            order: i,
          }),
        );
        previousId = id;
      }

      const tree: Array<StatusPageGroupTreeNode> =
        StatusPageGroupTreeUtil.buildTree({ statusPageGroups: groups });

      expect(tree).toHaveLength(1);

      let node: StatusPageGroupTreeNode = tree[0]!;
      let depth: number = 0;

      while (node.children.length > 0) {
        node = node.children[0]!;
        depth++;
      }

      expect(depth).toBe(999);
      expect(node.group.name).toBe("Level 999");
    });
  });
});
