import StatusPageGroupTreeUtil, {
  STATUS_PAGE_GROUP_PATH_SEPARATOR,
  StatusPageGroupIndex,
  StatusPageGroupIndexNode,
  StatusPageGroupTreeNode,
} from "../../../Utils/StatusPage/GroupTree";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - StatusPageGroupIndex is the answer to "I need this for
 * every group, not for one of them".
 *
 * Two things have to hold, and the second is the whole reason the class
 * exists:
 *
 *   1. It agrees with the static helpers it replaces. A dashboard that labels
 *      a group differently from the status page that renders it is worse than
 *      one that is slow, so tree order, ancestors, depth and descendants are
 *      all pinned against StatusPageGroupTreeUtil - including on the bad data
 *      shapes (self parent, missing parent, cycles) that the statics are
 *      already careful about.
 *
 *   2. It does its walk once. The page this was written for renders a section
 *      per group and labels each one with its ancestor path; deriving that
 *      per group re-walks every group, which is quadratic and is what made a
 *      1500 group status page unusable. That is pinned by counting parent
 *      pointer reads, not by timing anything.
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

type NamesFunction = (groups: Array<StatusPageGroup>) => Array<string>;

const names: NamesFunction = (
  groups: Array<StatusPageGroup>,
): Array<string> => {
  return groups.map((group: StatusPageGroup) => {
    return group.name || "";
  });
};

type FlattenTreeFunction = (
  nodes: Array<StatusPageGroupTreeNode>,
) => Array<StatusPageGroup>;

const flattenTree: FlattenTreeFunction = (
  nodes: Array<StatusPageGroupTreeNode>,
): Array<StatusPageGroup> => {
  const flattened: Array<StatusPageGroup> = [];

  for (const node of nodes) {
    flattened.push(node.group);
    flattened.push(...flattenTree(node.children));
  }

  return flattened;
};

describe("StatusPageGroupIndex", () => {
  describe("tree order", () => {
    test("puts a parent directly above the groups nested under it", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(names(index.getGroupsInTreeOrder())).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
        "Unit 0152",
        "Region 2000",
      ]);
    });

    test("orders siblings by `order`, not by the order they were fetched in", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({
          id: REGION_TWO,
          name: "Region 2000",
          parentId: CORPORATE,
          order: 5,
        }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: CORPORATE,
          order: 2,
        }),
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(names(index.getGroupsInTreeOrder())).toEqual([
        "Corporate",
        "Region 1000",
        "Region 2000",
      ]);
    });

    test("records the depth each group renders at", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(
        index.getNodesInTreeOrder().map((node: StatusPageGroupIndexNode) => {
          return [node.group.name, node.depth];
        }),
      ).toEqual([
        ["Corporate", 0],
        ["Region 1000", 1],
        ["Market 1001", 2],
        ["Unit 0152", 3],
        ["Region 2000", 1],
      ]);
    });

    test("records ancestors outermost first, excluding the group itself", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      const unitNode: StatusPageGroupIndexNode | null = index.getNode(
        index.getGroupById(UNIT.toString())!,
      );

      expect(names(unitNode!.ancestors)).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
      ]);
    });

    test("matches the tree the status page renders, flattened", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(names(index.getGroupsInTreeOrder())).toEqual(
        names(
          flattenTree(
            StatusPageGroupTreeUtil.buildTree({ statusPageGroups: groups }),
          ),
        ),
      );
    });

    test("holds every group exactly once, whatever shape the data is in", () => {
      const groups: Array<StatusPageGroup> = [
        // points at itself
        makeGroup({ id: CORPORATE, name: "Corporate", parentId: CORPORATE }),
        // points at a group nobody fetched
        makeGroup({ id: REGION_ONE, name: "Region 1000", parentId: MISSING }),
        // a two group cycle no root points into
        makeGroup({ id: MARKET, name: "Market 1001", parentId: UNIT }),
        makeGroup({ id: UNIT, name: "Unit 0152", parentId: MARKET }),
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(names(index.getGroupsInTreeOrder()).sort()).toEqual([
        "Corporate",
        "Market 1001",
        "Region 1000",
        "Unit 0152",
      ]);
    });

    test("an empty status page has an empty tree, not a crash", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: [],
      });

      expect(index.getGroupsInTreeOrder()).toEqual([]);
      expect(index.getRootGroups()).toEqual([]);
      expect(index.getTree()).toEqual([]);
      expect(index.getGroupCount()).toBe(0);
    });
  });

  describe("path labels", () => {
    test("labels a nested group with the whole path down to it", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(
        index.getGroupPathLabel(index.getGroupById(UNIT.toString())!),
      ).toBe("Corporate › Region 1000 › Market 1001 › Unit 0152");
    });

    test("labels a top level group with just its own name", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(
        index.getGroupPathLabel(index.getGroupById(CORPORATE.toString())!),
      ).toBe("Corporate");
    });

    test("tells apart two groups that share a name at different levels", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Region 1000", order: 1 }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: CORPORATE,
          order: 2,
        }),
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(
        groups.map((group: StatusPageGroup) => {
          return index.getGroupPathLabel(group);
        }),
      ).toEqual(["Region 1000", "Region 1000 › Region 1000"]);
    });

    test("exposes the path as names so a caller can render it its own way", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(
        index.getGroupPathNames(index.getGroupById(MARKET.toString())!),
      ).toEqual(["Corporate", "Region 1000", "Market 1001"]);
    });

    test("accepts a different separator", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(
        index.getGroupPathLabel(index.getGroupById(MARKET.toString())!, " / "),
      ).toBe("Corporate / Region 1000 / Market 1001");
    });

    test("defaults to the separator the product uses everywhere else", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(
        index.getGroupPathLabel(index.getGroupById(MARKET.toString())!),
      ).toBe(
        ["Corporate", "Region 1000", "Market 1001"].join(
          STATUS_PAGE_GROUP_PATH_SEPARATOR,
        ),
      );
    });

    test("a group with no name still contributes a level to the path", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "", order: 1 }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: CORPORATE,
          order: 2,
        }),
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(index.getGroupPathLabel(groups[1]!)).toBe(" › Region 1000");
    });

    test("labels an orphan with just its own name - it renders at the top level", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: REGION_ONE, name: "Region 1000", parentId: MISSING }),
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(index.getGroupPathLabel(groups[0]!)).toBe("Region 1000");
    });
  });

  describe("agreement with the static helpers", () => {
    test("ancestors come back closest parent first, same as the static", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      for (const group of groups) {
        expect(names(index.getAncestorGroups(group))).toEqual(
          names(
            StatusPageGroupTreeUtil.getAncestorGroups({
              statusPageGroup: group,
              statusPageGroups: groups,
            }),
          ),
        );
      }

      expect(
        names(index.getAncestorGroups(index.getGroupById(UNIT.toString())!)),
      ).toEqual(["Market 1001", "Region 1000", "Corporate"]);
    });

    test("depth agrees with the static", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      for (const group of groups) {
        expect(index.getDepth(group)).toBe(
          StatusPageGroupTreeUtil.getDepth({
            statusPageGroup: group,
            statusPageGroups: groups,
          }),
        );
      }
    });

    test("descendants agree with the static", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      for (const group of groups) {
        expect(names(index.getDescendantGroups(group)).sort()).toEqual(
          names(
            StatusPageGroupTreeUtil.getDescendantGroups({
              statusPageGroup: group,
              statusPageGroups: groups,
            }),
          ).sort(),
        );
      }

      expect(
        names(
          index.getDescendantGroups(index.getGroupById(REGION_ONE.toString())!),
        ),
      ).toEqual(["Market 1001", "Unit 0152"]);
    });

    test("roots agree with the static, orphan promotion included", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: CORPORATE,
          order: 2,
        }),
        makeGroup({
          id: REGION_TWO,
          name: "Region 2000",
          parentId: MISSING,
          order: 3,
        }),
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(names(index.getRootGroups())).toEqual(
        names(
          StatusPageGroupTreeUtil.getRootGroups({ statusPageGroups: groups }),
        ),
      );
      expect(names(index.getRootGroups())).toEqual([
        "Corporate",
        "Region 2000",
      ]);
    });

    test("children agree with the static", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(names(index.getChildGroups(CORPORATE.toString()))).toEqual(
        names(
          StatusPageGroupTreeUtil.getChildGroups({
            statusPageGroupId: CORPORATE.toString(),
            statusPageGroups: groups,
          }),
        ),
      );
      expect(names(index.getChildGroups(CORPORATE.toString()))).toEqual([
        "Region 1000",
        "Region 2000",
      ]);
    });

    test("a leaf has no children rather than every root", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(index.getChildGroups(UNIT.toString())).toEqual([]);
    });

    test("asking for the children of nothing asks for the top level", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(names(index.getChildGroups(null))).toEqual(["Corporate"]);
    });
  });

  describe("lookups", () => {
    test("finds a group by id", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(index.getGroupById(MARKET.toString())?.name).toBe("Market 1001");
    });

    test("returns nothing for an id that is not on this status page", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: makeHierarchy(),
      });

      expect(index.getGroupById(MISSING.toString())).toBeNull();
      expect(index.getGroupById(null)).toBeNull();
      expect(index.getGroupById(undefined)).toBeNull();
      expect(index.getGroupById("")).toBeNull();
    });

    test("keeps the group list it was handed", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(index.getStatusPageGroups()).toBe(groups);
      expect(index.getGroupCount()).toBe(5);
    });
  });

  describe("groups the index was not built from", () => {
    test("walks the parent pointers it does know about", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      const newGroup: StatusPageGroup = makeGroup({
        id: MISSING,
        name: "Site 9000",
        parentId: MARKET,
      });

      expect(names(index.getAncestorGroups(newGroup))).toEqual([
        "Market 1001",
        "Region 1000",
        "Corporate",
      ]);
      expect(index.getDepth(newGroup)).toBe(3);
      expect(index.getGroupPathLabel(newGroup)).toBe(
        "Corporate › Region 1000 › Market 1001 › Site 9000",
      );
    });

    test("stops at a parent it has never heard of", () => {
      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: [makeGroup({ id: CORPORATE, name: "Corporate" })],
      });

      const newGroup: StatusPageGroup = makeGroup({
        id: MISSING,
        name: "Site 9000",
        parentId: REGION_ONE,
      });

      expect(index.getAncestorGroups(newGroup)).toEqual([]);
      expect(index.getGroupPathLabel(newGroup)).toBe("Site 9000");
    });
  });

  describe("bad data", () => {
    test("a group that points at itself is a root, not an infinite loop", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", parentId: CORPORATE }),
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(names(index.getRootGroups())).toEqual(["Corporate"]);
      expect(index.getAncestorGroups(groups[0]!)).toEqual([]);
      expect(index.getDepth(groups[0]!)).toBe(0);
      expect(index.getGroupPathLabel(groups[0]!)).toBe("Corporate");
    });

    test("a cycle nothing points into still renders, once, at the top level", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: MARKET, name: "Market 1001", parentId: UNIT }),
        makeGroup({ id: UNIT, name: "Unit 0152", parentId: MARKET }),
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      const rendered: Array<string> = names(index.getGroupsInTreeOrder());

      expect(rendered).toHaveLength(2);
      expect(rendered.sort()).toEqual(["Market 1001", "Unit 0152"]);
    });

    test("a three group cycle terminates", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", parentId: REGION_ONE }),
        makeGroup({ id: REGION_ONE, name: "Region 1000", parentId: MARKET }),
        makeGroup({ id: MARKET, name: "Market 1001", parentId: CORPORATE }),
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(index.getGroupsInTreeOrder()).toHaveLength(3);

      for (const group of groups) {
        expect(index.getDescendantGroups(group).length).toBeLessThanOrEqual(2);
      }
    });

    test("a group with no id at all does not swallow the top level", () => {
      const idLess: StatusPageGroup = new StatusPageGroup();
      idLess.name = "Unsaved";

      const groups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: CORPORATE,
          order: 2,
        }),
        idLess,
      ];

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(index.getDescendantGroups(idLess)).toEqual([]);
      expect(names(index.getGroupsInTreeOrder()).sort()).toEqual([
        "Corporate",
        "Region 1000",
        "Unsaved",
      ]);
    });
  });

  describe("cost", () => {
    /*
     * The regression this class was written for: labelling every group with
     * its ancestor path used to rederive the tree once per group. Counting
     * parent pointer reads pins that down without timing anything - a walk per
     * group would read them a multiple of `groupCount` times, not a constant
     * one.
     */
    test("reads each group's parent pointer a bounded number of times", () => {
      const groupCount: number = 1500;
      const groups: Array<StatusPageGroup> = [];

      for (let index: number = 0; index < groupCount; index++) {
        const group: StatusPageGroup = new StatusPageGroup();
        group._id = `group-${index}`;
        group.name = `Group ${index}`;
        group.order = index;

        // A chain 10 deep, then start a new one - the nesting limit in practice.
        if (index % 10 !== 0) {
          group.parentStatusPageGroupId = new ObjectID(`group-${index - 1}`);
        }

        groups.push(group);
      }

      const getParentId: typeof StatusPageGroupTreeUtil.getParentId =
        StatusPageGroupTreeUtil.getParentId;

      let parentPointerReads: number = 0;

      StatusPageGroupTreeUtil.getParentId = (
        statusPageGroup: StatusPageGroup,
      ): string | null => {
        parentPointerReads++;
        return getParentId.call(StatusPageGroupTreeUtil, statusPageGroup);
      };

      try {
        const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
          statusPageGroups: groups,
        });

        // Every group asks for its full path, the way the Resources tab does.
        for (const group of groups) {
          index.getGroupPathLabel(group);
        }

        expect(index.getGroupsInTreeOrder()).toHaveLength(groupCount);
        expect(parentPointerReads).toBeLessThanOrEqual(groupCount * 2);
      } finally {
        StatusPageGroupTreeUtil.getParentId = getParentId;
      }
    });

    test("a 1500 group status page still comes back in tree order", () => {
      const groups: Array<StatusPageGroup> = [];

      for (let index: number = 0; index < 1500; index++) {
        const group: StatusPageGroup = new StatusPageGroup();
        group._id = `group-${index}`;
        group.name = `Group ${index}`;
        group.order = index;

        if (index % 10 !== 0) {
          group.parentStatusPageGroupId = new ObjectID(`group-${index - 1}`);
        }

        groups.push(group);
      }

      const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: groups,
      });

      expect(names(index.getGroupsInTreeOrder())).toEqual(names(groups));
      expect(index.getDepth(groups[9]!)).toBe(9);
      expect(index.getGroupPathLabel(groups[2]!)).toBe(
        "Group 0 › Group 1 › Group 2",
      );
    });
  });
});
