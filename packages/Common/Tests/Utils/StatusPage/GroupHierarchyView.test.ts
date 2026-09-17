import StatusPageGroupHierarchyViewUtil, {
  STATUS_PAGE_GROUP_PATH_SEPARATOR,
  StatusPageGroupHierarchyRow,
  StatusPageGroupHierarchySummary,
} from "../../../Utils/StatusPage/GroupHierarchyView";
import StatusPageGroupTreeUtil from "../../../Utils/StatusPage/GroupTree";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - the admin view of the status page group hierarchy.
 *
 * The page this backs replaced a flat table, so everything a table gave away
 * for free has to be earned here instead: which rows are on screen once
 * subtrees are collapsed, how deep each row sits, which guide rails are drawn
 * beside it, which way it may be moved, and what a search leaves visible.
 *
 * Two things run through all of it. First, the same bad data the tree utils
 * defend against - a group that points at itself, at a parent that was never
 * fetched, or around a cycle - must not drop a row or hang a walk here either;
 * a group missing from this page is a group an operator cannot fix. Second,
 * anything that will be written to the API (a reorder, the parent picker) has
 * to agree with what StatusPageGroupService will accept, because the only thing
 * worse than not offering a choice is offering one that always fails.
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
const MARKET_ONE: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MARKET_TWO: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const UNIT: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const STANDALONE: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const MISSING: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

function makeGroup(data: {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
  order?: number | undefined;
  description?: string | undefined;
  viewMode?: StatusPageGroupViewMode | undefined;
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

  if (data.description !== undefined) {
    group.description = data.description;
  }

  if (data.viewMode !== undefined) {
    group.viewMode = data.viewMode;
  }

  return group;
}

/*
 * Corporate
 *   Region 1000
 *     Market 1001
 *       Unit 0152
 *     Market 1002
 *   Region 2000
 * Standalone
 *
 * Chosen so every rail case appears at least once: a middle child with
 * children, a last child, and a level that is three deep under a parent that
 * still has siblings of its own.
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
      id: MARKET_ONE,
      name: "Market 1001",
      parentId: REGION_ONE,
      order: 3,
    }),
    makeGroup({
      id: UNIT,
      name: "Unit 0152",
      parentId: MARKET_ONE,
      order: 4,
    }),
    makeGroup({
      id: MARKET_TWO,
      name: "Market 1002",
      parentId: REGION_ONE,
      order: 5,
    }),
    makeGroup({
      id: REGION_TWO,
      name: "Region 2000",
      parentId: CORPORATE,
      order: 6,
    }),
    makeGroup({ id: STANDALONE, name: "Standalone", order: 7 }),
  ];
}

function allIds(statusPageGroups: Array<StatusPageGroup>): Set<string> {
  return new Set<string>(
    statusPageGroups.map((group: StatusPageGroup) => {
      return group._id?.toString() || "";
    }),
  );
}

function rowNames(rows: Array<StatusPageGroupHierarchyRow>): Array<string> {
  return rows.map((row: StatusPageGroupHierarchyRow) => {
    return row.name;
  });
}

function rowById(
  rows: Array<StatusPageGroupHierarchyRow>,
  id: ObjectID,
): StatusPageGroupHierarchyRow {
  const row: StatusPageGroupHierarchyRow | undefined = rows.find(
    (candidate: StatusPageGroupHierarchyRow) => {
      return candidate.id === id.toString();
    },
  );

  if (!row) {
    throw new Error(`No row for ${id.toString()}`);
  }

  return row;
}

describe("StatusPageGroupHierarchyViewUtil", () => {
  describe("getRows - what is on screen", () => {
    test("a status page with no groups produces no rows", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getRows({ statusPageGroups: [] }),
      ).toEqual([]);
    });

    /*
     * Collapsed has to mean absent: the component renders one flat list, so a
     * subtree that is still in the array is a subtree that is still on screen.
     */
    test("nothing is expanded by default, so only the top level is drawn", () => {
      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: makeHierarchy(),
        });

      expect(rowNames(rows)).toEqual(["Corporate", "Standalone"]);
    });

    test("expanding a group reveals only its direct children", () => {
      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: makeHierarchy(),
          expandedGroupIds: new Set<string>([CORPORATE.toString()]),
        });

      expect(rowNames(rows)).toEqual([
        "Corporate",
        "Region 1000",
        "Region 2000",
        "Standalone",
      ]);
    });

    test("the whole hierarchy comes back in render order when everything is open", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      expect(rowNames(rows)).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
        "Unit 0152",
        "Market 1002",
        "Region 2000",
        "Standalone",
      ]);
    });

    test("siblings come back in order, not in the order they were fetched", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({ id: STANDALONE, name: "Standalone", order: 9 }),
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        makeGroup({ id: REGION_TWO, name: "Region 2000", order: 5 }),
      ];

      expect(
        rowNames(
          StatusPageGroupHierarchyViewUtil.getRows({
            statusPageGroups: statusPageGroups,
          }),
        ),
      ).toEqual(["Corporate", "Region 2000", "Standalone"]);
    });

    test("each row carries its depth and its ancestors", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      const unit: StatusPageGroupHierarchyRow = rowById(rows, UNIT);

      expect(unit.depth).toBe(3);
      expect(unit.ancestorNames).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
      ]);
      expect(rowById(rows, CORPORATE).depth).toBe(0);
      expect(rowById(rows, CORPORATE).ancestorNames).toEqual([]);
    });

    /*
     * The badge counts the hierarchy, not the screen: an operator collapsing a
     * branch has not changed how many groups are inside it.
     */
    test("sub group and descendant counts describe the real subtree", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
        });

      const corporate: StatusPageGroupHierarchyRow = rowById(rows, CORPORATE);

      expect(corporate.hasSubGroups).toBe(true);
      expect(corporate.subGroupCount).toBe(2);
      expect(corporate.descendantCount).toBe(5);

      const standalone: StatusPageGroupHierarchyRow = rowById(rows, STANDALONE);

      expect(standalone.hasSubGroups).toBe(false);
      expect(standalone.subGroupCount).toBe(0);
      expect(standalone.descendantCount).toBe(0);
    });

    test("a group is only reported as expanded when it has children to show", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      expect(rowById(rows, CORPORATE).isExpanded).toBe(true);
      expect(rowById(rows, STANDALONE).isExpanded).toBe(false);
      expect(rowById(rows, STANDALONE).hasVisibleSubGroups).toBe(false);
    });

    test("a group with no name still produces a row", () => {
      const nameless: StatusPageGroup = new StatusPageGroup();
      nameless._id = CORPORATE.toString();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: [nameless],
        });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toBe("");
      expect(rows[0]!.id).toBe(CORPORATE.toString());
    });
  });

  describe("getRows - the guide rails", () => {
    /*
     * The rails are the whole reason a tree reads as a tree. Each indent column
     * left of a row's own connector belongs to one ancestor level, and carries a
     * line only while that level still has a row below this one.
     */
    test("a top level row has no indent columns at all", () => {
      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: makeHierarchy(),
        });

      expect(rowById(rows, CORPORATE).ancestorRails).toEqual([]);
      expect(rowById(rows, CORPORATE).depth).toBe(0);
    });

    test("a first level row has only its own connector", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      expect(rowById(rows, REGION_ONE).ancestorRails).toEqual([]);
    });

    test("a rail is drawn for every ancestor level that still has rows below", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      /*
       * Unit 0152 sits under Market 1001 (which is followed by Market 1002)
       * under Region 1000 (which is followed by Region 2000), so both of its
       * ancestor columns carry a line.
       */
      expect(rowById(rows, UNIT).ancestorRails).toEqual([true, true]);
    });

    test("a rail stops once its level's last row has been drawn", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        makeGroup({
          id: REGION_TWO,
          name: "Region 2000",
          parentId: CORPORATE,
          order: 2,
        }),
        makeGroup({
          id: MARKET_ONE,
          name: "Market 1001",
          parentId: REGION_TWO,
          order: 3,
        }),
      ];

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      // Region 2000 is Corporate's only child, so its column is blank.
      expect(rowById(rows, MARKET_ONE).ancestorRails).toEqual([false]);
    });

    test("the last child of a level ends its connector in an elbow", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      expect(rowById(rows, REGION_ONE).isLastVisibleSibling).toBe(false);
      expect(rowById(rows, REGION_TWO).isLastVisibleSibling).toBe(true);
      expect(rowById(rows, STANDALONE).isLastVisibleSibling).toBe(true);
      expect(rowById(rows, CORPORATE).isLastVisibleSibling).toBe(false);
    });

    /*
     * "Last" has to mean last among the rows that are drawn. During a search
     * the row that used to be in the middle of a level can become the only one
     * left in it, and an elbow that says otherwise draws a rail into thin air.
     */
    test("a filtered level ends its elbow on the last row that survives the filter", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
          searchText: "Region 1000",
        });

      expect(rowById(rows, REGION_ONE).isLastVisibleSibling).toBe(true);
    });

    test("sibling positions describe the rows on screen", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      expect(rowById(rows, REGION_ONE).visibleSiblingIndex).toBe(0);
      expect(rowById(rows, REGION_ONE).visibleSiblingCount).toBe(2);
      expect(rowById(rows, REGION_TWO).visibleSiblingIndex).toBe(1);
      expect(rowById(rows, STANDALONE).visibleSiblingIndex).toBe(1);
      expect(rowById(rows, STANDALONE).visibleSiblingCount).toBe(2);
    });

    /*
     * Nesting is capped on write at 10 levels, but rows written straight to the
     * database are not, and a row that has indented itself off the right of the
     * card tells the operator nothing at all.
     */
    test("indent columns stop growing past the cap, keeping the nearest rails", () => {
      const statusPageGroups: Array<StatusPageGroup> = [];
      const ids: Array<ObjectID> = [];

      for (let level: number = 0; level < 16; level++) {
        const id: ObjectID = new ObjectID(
          `aaaaaaaa-0000-4000-8000-${level.toString().padStart(12, "0")}`,
        );
        ids.push(id);

        statusPageGroups.push(
          makeGroup({
            id: id,
            name: `Level ${level}`,
            order: level + 1,
            ...(level === 0 ? {} : { parentId: ids[level - 1]! }),
          }),
        );
      }

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      const deepest: StatusPageGroupHierarchyRow = rows[rows.length - 1]!;

      expect(deepest.depth).toBe(15);
      expect(deepest.ancestorRails).toHaveLength(
        StatusPageGroupHierarchyViewUtil.MaxIndentColumns - 1,
      );

      const atCap: StatusPageGroupHierarchyRow = rows[
        StatusPageGroupHierarchyViewUtil.MaxIndentColumns
      ] as StatusPageGroupHierarchyRow;

      expect(atCap.ancestorRails).toHaveLength(
        StatusPageGroupHierarchyViewUtil.MaxIndentColumns - 1,
      );
    });

    test("getIndentColumnCount refuses to be broken by a nonsense depth", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getIndentColumnCount({ depth: 0 }),
      ).toBe(0);
      expect(
        StatusPageGroupHierarchyViewUtil.getIndentColumnCount({ depth: -3 }),
      ).toBe(0);
      expect(
        StatusPageGroupHierarchyViewUtil.getIndentColumnCount({ depth: NaN }),
      ).toBe(0);
      expect(
        StatusPageGroupHierarchyViewUtil.getIndentColumnCount({
          depth: Number.POSITIVE_INFINITY,
        }),
      ).toBe(0);
      expect(
        StatusPageGroupHierarchyViewUtil.getIndentColumnCount({ depth: 2.7 }),
      ).toBe(2);
      expect(
        StatusPageGroupHierarchyViewUtil.getIndentColumnCount({ depth: 99 }),
      ).toBe(StatusPageGroupHierarchyViewUtil.MaxIndentColumns);
    });
  });

  describe("search", () => {
    test("matches on the group name, ignoring case", () => {
      const matched: Set<string> =
        StatusPageGroupHierarchyViewUtil.getMatchingGroupIds({
          statusPageGroups: makeHierarchy(),
          searchText: "unit 0152",
        });

      expect(Array.from(matched)).toEqual([UNIT.toString()]);
    });

    test("matches on the description too", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({
          id: CORPORATE,
          name: "Corporate",
          description: "Everything the payments team owns",
        }),
        makeGroup({ id: STANDALONE, name: "Standalone" }),
      ];

      expect(
        Array.from(
          StatusPageGroupHierarchyViewUtil.getMatchingGroupIds({
            statusPageGroups: statusPageGroups,
            searchText: "payments",
          }),
        ),
      ).toEqual([CORPORATE.toString()]);
    });

    test("an empty or blank search matches nothing in particular", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getMatchingGroupIds({
          statusPageGroups: makeHierarchy(),
          searchText: "   ",
        }).size,
      ).toBe(0);

      expect(
        StatusPageGroupHierarchyViewUtil.getMatchingGroupIds({
          statusPageGroups: makeHierarchy(),
        }).size,
      ).toBe(0);
    });

    test("a blank search leaves the tree exactly as it was", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        rowNames(
          StatusPageGroupHierarchyViewUtil.getRows({
            statusPageGroups: statusPageGroups,
            expandedGroupIds: allIds(statusPageGroups),
            searchText: "  ",
          }),
        ),
      ).toEqual(
        rowNames(
          StatusPageGroupHierarchyViewUtil.getRows({
            statusPageGroups: statusPageGroups,
            expandedGroupIds: allIds(statusPageGroups),
          }),
        ),
      );
    });

    /*
     * A match behind a collapsed parent is a match the operator cannot see,
     * which reads exactly like a search that found nothing.
     */
    test("a match is revealed even when its ancestors were collapsed", () => {
      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: makeHierarchy(),
          expandedGroupIds: new Set<string>(),
          searchText: "Unit 0152",
        });

      expect(rowNames(rows)).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
        "Unit 0152",
      ]);
    });

    test("ancestors are context, and are marked as such", () => {
      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: makeHierarchy(),
          searchText: "Unit 0152",
        });

      expect(rowById(rows, UNIT).isSearchMatch).toBe(true);
      expect(rowById(rows, CORPORATE).isSearchMatch).toBe(false);
      expect(rowById(rows, MARKET_ONE).isSearchMatch).toBe(false);
    });

    test("every row is a match when nothing is being searched for", () => {
      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: makeHierarchy(),
        });

      for (const row of rows) {
        expect(row.isSearchMatch).toBe(true);
      }
    });

    /*
     * Searching for a branch and being shown an empty branch would be answering
     * a different question from the one that was asked.
     */
    test("a matched group keeps its own subtree available", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
          searchText: "Region 1000",
        });

      expect(rowNames(rows)).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
        "Unit 0152",
        "Market 1002",
      ]);
    });

    test("branches with nothing matching in them are gone entirely", () => {
      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: makeHierarchy(),
          searchText: "Standalone",
        });

      expect(rowNames(rows)).toEqual(["Standalone"]);
    });

    test("a search that matches nothing produces no rows at all", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: makeHierarchy(),
          searchText: "nothing here by that name",
        }),
      ).toEqual([]);
    });

    test("getSearchVisibleGroupIds covers the match, its ancestors and its subtree", () => {
      const visible: Set<string> =
        StatusPageGroupHierarchyViewUtil.getSearchVisibleGroupIds({
          statusPageGroups: makeHierarchy(),
          searchText: "Region 1000",
        });

      expect(visible.has(REGION_ONE.toString())).toBe(true);
      expect(visible.has(CORPORATE.toString())).toBe(true);
      expect(visible.has(MARKET_ONE.toString())).toBe(true);
      expect(visible.has(UNIT.toString())).toBe(true);
      expect(visible.has(REGION_TWO.toString())).toBe(false);
      expect(visible.has(STANDALONE.toString())).toBe(false);
    });

    test("matchesSearch treats no search text as matching everything", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.matchesSearch({
          statusPageGroup: makeGroup({ id: CORPORATE, name: "Corporate" }),
        }),
      ).toBe(true);
    });
  });

  describe("reordering", () => {
    test("a row knows the siblings it can swap with", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      const marketOne: StatusPageGroupHierarchyRow = rowById(rows, MARKET_ONE);

      expect(marketOne.canMoveUp).toBe(false);
      expect(marketOne.canMoveDown).toBe(true);
      expect(marketOne.nextSiblingId).toBe(MARKET_TWO.toString());

      const marketTwo: StatusPageGroupHierarchyRow = rowById(rows, MARKET_TWO);

      expect(marketTwo.canMoveUp).toBe(true);
      expect(marketTwo.previousSiblingId).toBe(MARKET_ONE.toString());
      expect(marketTwo.canMoveDown).toBe(false);
    });

    test("an only child can be moved neither way", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: CORPORATE,
          order: 2,
        }),
      ];

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      expect(rowById(rows, REGION_ONE).canMoveUp).toBe(false);
      expect(rowById(rows, REGION_ONE).canMoveDown).toBe(false);
    });

    /*
     * A move is a change to the hierarchy, so it has to mean the same thing
     * whatever the operator has typed into the search box. Reading neighbours
     * off the filtered view would let "move up" swap two rows that are not
     * actually adjacent.
     */
    test("neighbours are the real siblings, not the ones a search left visible", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
          searchText: "Market 1002",
        });

      const marketTwo: StatusPageGroupHierarchyRow = rowById(rows, MARKET_TWO);

      expect(marketTwo.previousSiblingId).toBe(MARKET_ONE.toString());
      expect(marketTwo.canMoveUp).toBe(true);
    });

    test("moving up targets the order of the sibling above", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
          statusPageGroups: makeHierarchy(),
          statusPageGroupId: MARKET_TWO.toString(),
          direction: "up",
        }),
      ).toBe(3);
    });

    test("moving down targets the order of the sibling below", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
          statusPageGroups: makeHierarchy(),
          statusPageGroupId: REGION_ONE.toString(),
          direction: "down",
        }),
      ).toBe(6);
    });

    test("a group with no neighbour that way has nothing to write", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
          statusPageGroups: makeHierarchy(),
          statusPageGroupId: MARKET_ONE.toString(),
          direction: "up",
        }),
      ).toBeNull();

      expect(
        StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
          statusPageGroups: makeHierarchy(),
          statusPageGroupId: STANDALONE.toString(),
          direction: "down",
        }),
      ).toBeNull();
    });

    test("a group that is not in the list at all has nothing to write", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
          statusPageGroups: makeHierarchy(),
          statusPageGroupId: MISSING.toString(),
          direction: "up",
        }),
      ).toBeNull();
    });

    /*
     * `order` is nullable in the database. Writing `undefined` as a target order
     * would blank the column rather than move the row.
     */
    test("a neighbour with no order of its own is not a move target", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate" }),
        makeGroup({ id: STANDALONE, name: "Standalone", order: 2 }),
      ];

      expect(
        StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
          statusPageGroups: statusPageGroups,
          statusPageGroupId: STANDALONE.toString(),
          direction: "up",
        }),
      ).toBeNull();
    });

    test("top level neighbours are read from the top level, not from a parent bucket", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const siblings: Array<StatusPageGroup> =
        StatusPageGroupHierarchyViewUtil.getSiblingGroups({
          statusPageGroup: statusPageGroups[0]!,
          statusPageGroups: statusPageGroups,
        });

      expect(
        siblings.map((group: StatusPageGroup) => {
          return group.name;
        }),
      ).toEqual(["Corporate", "Standalone"]);
    });
  });

  describe("expansion helpers", () => {
    test("every group with sub groups is expandable", () => {
      const expandable: Set<string> =
        StatusPageGroupHierarchyViewUtil.getExpandableGroupIds({
          statusPageGroups: makeHierarchy(),
        });

      expect(expandable.has(CORPORATE.toString())).toBe(true);
      expect(expandable.has(REGION_ONE.toString())).toBe(true);
      expect(expandable.has(MARKET_ONE.toString())).toBe(true);
      expect(expandable.has(MARKET_TWO.toString())).toBe(false);
      expect(expandable.has(STANDALONE.toString())).toBe(false);
      expect(expandable.size).toBe(3);
    });

    test("expanding everything really does draw every group", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds:
            StatusPageGroupHierarchyViewUtil.getExpandableGroupIds({
              statusPageGroups: statusPageGroups,
            }),
        });

      expect(rows).toHaveLength(statusPageGroups.length);
    });

    /*
     * A hierarchy that arrives fully expanded is unreadable at any real size,
     * and one that arrives fully collapsed hides the fact that it nests at all -
     * which is the single thing this page exists to show.
     */
    test("the default opens one level of children and no more", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const expanded: Set<string> =
        StatusPageGroupHierarchyViewUtil.getDefaultExpandedGroupIds({
          statusPageGroups: statusPageGroups,
          maxAutoExpandDepth: 1,
        });

      expect(expanded.has(CORPORATE.toString())).toBe(true);
      expect(expanded.has(REGION_ONE.toString())).toBe(true);
      expect(expanded.has(MARKET_ONE.toString())).toBe(false);

      expect(
        rowNames(
          StatusPageGroupHierarchyViewUtil.getRows({
            statusPageGroups: statusPageGroups,
            expandedGroupIds: expanded,
          }),
        ),
      ).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
        "Market 1002",
        "Region 2000",
        "Standalone",
      ]);
    });

    test("a depth of zero opens only the top level", () => {
      const expanded: Set<string> =
        StatusPageGroupHierarchyViewUtil.getDefaultExpandedGroupIds({
          statusPageGroups: makeHierarchy(),
          maxAutoExpandDepth: 0,
        });

      expect(Array.from(expanded)).toEqual([CORPORATE.toString()]);
    });

    test("leaves are never in the expanded set - there is nothing to open", () => {
      const expanded: Set<string> =
        StatusPageGroupHierarchyViewUtil.getDefaultExpandedGroupIds({
          statusPageGroups: makeHierarchy(),
          maxAutoExpandDepth: 9,
        });

      expect(expanded.has(STANDALONE.toString())).toBe(false);
      expect(expanded.has(UNIT.toString())).toBe(false);
    });
  });

  describe("getSummary", () => {
    test("counts the whole hierarchy and how deep it goes", () => {
      const summary: StatusPageGroupHierarchySummary =
        StatusPageGroupHierarchyViewUtil.getSummary({
          statusPageGroups: makeHierarchy(),
        });

      expect(summary).toEqual({
        totalCount: 7,
        topLevelCount: 2,
        nestedCount: 5,
        levelCount: 4,
      });
    });

    test("a flat list is one level deep, not zero", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getSummary({
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
            makeGroup({ id: STANDALONE, name: "Standalone", order: 2 }),
          ],
        }),
      ).toEqual({
        totalCount: 2,
        topLevelCount: 2,
        nestedCount: 0,
        levelCount: 1,
      });
    });

    test("an empty status page has no levels", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getSummary({ statusPageGroups: [] }),
      ).toEqual({
        totalCount: 0,
        topLevelCount: 0,
        nestedCount: 0,
        levelCount: 0,
      });
    });
  });

  describe("getGroupPathLabel", () => {
    test("reads top down and ends on the group itself", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupHierarchyViewUtil.getGroupPathLabel({
          statusPageGroup: statusPageGroups[3]!,
          statusPageGroups: statusPageGroups,
        }),
      ).toBe(
        ["Corporate", "Region 1000", "Market 1001", "Unit 0152"].join(
          STATUS_PAGE_GROUP_PATH_SEPARATOR,
        ),
      );
    });

    test("a top level group is just its own name", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupHierarchyViewUtil.getGroupPathLabel({
          statusPageGroup: statusPageGroups[0]!,
          statusPageGroups: statusPageGroups,
        }),
      ).toBe("Corporate");
    });

    /*
     * The rest of the admin - Resources, Monitor Rules, the CSV import - all
     * spell a path the same way, and an operator reads them side by side.
     */
    test("uses the separator the rest of the admin uses", () => {
      expect(STATUS_PAGE_GROUP_PATH_SEPARATOR).toBe(" › ");
    });
  });

  describe("getSubtreeHeight", () => {
    test("a leaf has no height", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupHierarchyViewUtil.getSubtreeHeight({
          statusPageGroup: statusPageGroups[6]!,
          statusPageGroups: statusPageGroups,
        }),
      ).toBe(0);
    });

    test("counts the levels below the group, not its own depth", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupHierarchyViewUtil.getSubtreeHeight({
          statusPageGroup: statusPageGroups[0]!,
          statusPageGroups: statusPageGroups,
        }),
      ).toBe(3);

      expect(
        StatusPageGroupHierarchyViewUtil.getSubtreeHeight({
          statusPageGroup: statusPageGroups[1]!,
          statusPageGroups: statusPageGroups,
        }),
      ).toBe(2);
    });
  });

  describe("getParentGroupCandidates", () => {
    test("creating a group may pick any group as its parent", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const candidates: Array<StatusPageGroup> =
        StatusPageGroupHierarchyViewUtil.getParentGroupCandidates({
          statusPageGroups: statusPageGroups,
        });

      expect(
        candidates.map((group: StatusPageGroup) => {
          return group.name;
        }),
      ).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
        "Unit 0152",
        "Market 1002",
        "Region 2000",
        "Standalone",
      ]);
    });

    /* "A group cannot be its own parent group." - StatusPageGroupService. */
    test("a group is never offered itself", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const candidateIds: Array<string | undefined> =
        StatusPageGroupHierarchyViewUtil.getParentGroupCandidates({
          statusPageGroups: statusPageGroups,
          statusPageGroupId: REGION_ONE.toString(),
        }).map((group: StatusPageGroup) => {
          return group._id?.toString();
        });

      expect(candidateIds).not.toContain(REGION_ONE.toString());
    });

    /*
     * "This group cannot be nested under one of its own sub groups." A cycle
     * would make every rolled up number on the status page meaningless, so the
     * picker does not offer the move in the first place.
     */
    test("a group is never offered one of its own sub groups", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();

      const candidateIds: Array<string | undefined> =
        StatusPageGroupHierarchyViewUtil.getParentGroupCandidates({
          statusPageGroups: statusPageGroups,
          statusPageGroupId: REGION_ONE.toString(),
        }).map((group: StatusPageGroup) => {
          return group._id?.toString();
        });

      expect(candidateIds).not.toContain(MARKET_ONE.toString());
      expect(candidateIds).not.toContain(MARKET_TWO.toString());
      expect(candidateIds).not.toContain(UNIT.toString());
      expect(candidateIds).toContain(CORPORATE.toString());
      expect(candidateIds).toContain(REGION_TWO.toString());
      expect(candidateIds).toContain(STANDALONE.toString());
    });

    /*
     * The service refuses a move when the parent's depth plus the moved
     * subtree's own height reaches MaxNestingDepth. The picker applies exactly
     * the same arithmetic so it cannot offer a parent the API will reject.
     */
    test("a parent too deep to hold the group is not offered", () => {
      const statusPageGroups: Array<StatusPageGroup> = [];
      const ids: Array<ObjectID> = [];

      for (
        let level: number = 0;
        level < StatusPageGroupTreeUtil.MaxNestingDepth;
        level++
      ) {
        const id: ObjectID = new ObjectID(
          `bbbbbbbb-0000-4000-8000-${level.toString().padStart(12, "0")}`,
        );
        ids.push(id);

        statusPageGroups.push(
          makeGroup({
            id: id,
            name: `Level ${level}`,
            order: level + 1,
            ...(level === 0 ? {} : { parentId: ids[level - 1]! }),
          }),
        );
      }

      const loose: ObjectID = new ObjectID(
        "cccccccc-0000-4000-8000-000000000000",
      );
      statusPageGroups.push(
        makeGroup({ id: loose, name: "Loose", order: 100 }),
      );

      const candidateNames: Array<string | undefined> =
        StatusPageGroupHierarchyViewUtil.getParentGroupCandidates({
          statusPageGroups: statusPageGroups,
          statusPageGroupId: loose.toString(),
        }).map((group: StatusPageGroup) => {
          return group.name;
        });

      /* The deepest legal parent leaves room for exactly one more level. */
      expect(candidateNames).toContain(
        `Level ${StatusPageGroupTreeUtil.MaxNestingDepth - 2}`,
      );
      expect(candidateNames).not.toContain(
        `Level ${StatusPageGroupTreeUtil.MaxNestingDepth - 1}`,
      );
    });

    test("a group carrying a tall subtree loses parents a leaf could still use", () => {
      const statusPageGroups: Array<StatusPageGroup> = [];
      const ids: Array<ObjectID> = [];

      for (let level: number = 0; level < 8; level++) {
        const id: ObjectID = new ObjectID(
          `dddddddd-0000-4000-8000-${level.toString().padStart(12, "0")}`,
        );
        ids.push(id);

        statusPageGroups.push(
          makeGroup({
            id: id,
            name: `Level ${level}`,
            order: level + 1,
            ...(level === 0 ? {} : { parentId: ids[level - 1]! }),
          }),
        );
      }

      const branchRoot: ObjectID = new ObjectID(
        "eeeeeeee-0000-4000-8000-000000000000",
      );
      const branchChild: ObjectID = new ObjectID(
        "eeeeeeee-0000-4000-8000-000000000001",
      );
      const branchGrandChild: ObjectID = new ObjectID(
        "eeeeeeee-0000-4000-8000-000000000002",
      );

      statusPageGroups.push(
        makeGroup({ id: branchRoot, name: "Branch", order: 50 }),
        makeGroup({
          id: branchChild,
          name: "Branch Child",
          parentId: branchRoot,
          order: 51,
        }),
        makeGroup({
          id: branchGrandChild,
          name: "Branch Grandchild",
          parentId: branchChild,
          order: 52,
        }),
      );

      const leafCandidates: Array<string | undefined> =
        StatusPageGroupHierarchyViewUtil.getParentGroupCandidates({
          statusPageGroups: statusPageGroups,
          statusPageGroupId: branchGrandChild.toString(),
        }).map((group: StatusPageGroup) => {
          return group.name;
        });

      const branchCandidates: Array<string | undefined> =
        StatusPageGroupHierarchyViewUtil.getParentGroupCandidates({
          statusPageGroups: statusPageGroups,
          statusPageGroupId: branchRoot.toString(),
        }).map((group: StatusPageGroup) => {
          return group.name;
        });

      expect(leafCandidates).toContain("Level 7");
      expect(branchCandidates).not.toContain("Level 7");
      expect(branchCandidates).toContain("Level 5");
    });

    test("a group id that is not on this status page excludes nothing", () => {
      expect(
        StatusPageGroupHierarchyViewUtil.getParentGroupCandidates({
          statusPageGroups: makeHierarchy(),
          statusPageGroupId: MISSING.toString(),
        }),
      ).toHaveLength(7);
    });
  });

  /*
   * The parent pointer is a plain nullable column. Rows written straight to the
   * database, or a group whose parent the page did not fetch, can point at a
   * missing parent, at themselves, or around a cycle - and a group that
   * disappears from this page is a group nobody can repair.
   */
  describe("data the database allows and the page has to survive", () => {
    test("a group that points at itself renders at the top level", () => {
      const selfParented: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "Corporate",
        parentId: CORPORATE,
        order: 1,
      });

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: [selfParented],
        });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.depth).toBe(0);
    });

    test("a group whose parent was never fetched still renders", () => {
      const orphan: StatusPageGroup = makeGroup({
        id: REGION_ONE,
        name: "Region 1000",
        parentId: MISSING,
        order: 2,
      });

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
            orphan,
          ],
        });

      expect(rowNames(rows)).toEqual(["Corporate", "Region 1000"]);
      expect(rowById(rows, REGION_ONE).depth).toBe(0);
    });

    test("an orphan can still be reordered against the top level", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: MISSING,
          order: 2,
        }),
      ];

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
        });

      expect(rowById(rows, REGION_ONE).canMoveUp).toBe(true);
      expect(
        StatusPageGroupHierarchyViewUtil.getReorderTargetOrder({
          statusPageGroups: statusPageGroups,
          statusPageGroupId: REGION_ONE.toString(),
          direction: "up",
        }),
      ).toBe(1);
    });

    test("a cycle neither hangs the walk nor loses a group", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({
          id: CORPORATE,
          name: "Corporate",
          parentId: REGION_ONE,
          order: 1,
        }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: CORPORATE,
          order: 2,
        }),
      ];

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      expect(rows).toHaveLength(2);
      expect(rowNames(rows).sort()).toEqual(["Corporate", "Region 1000"]);
    });

    test("a cycle does not hang the summary either", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({
          id: CORPORATE,
          name: "Corporate",
          parentId: REGION_ONE,
          order: 1,
        }),
        makeGroup({
          id: REGION_ONE,
          name: "Region 1000",
          parentId: CORPORATE,
          order: 2,
        }),
      ];

      expect(
        StatusPageGroupHierarchyViewUtil.getSummary({
          statusPageGroups: statusPageGroups,
        }).totalCount,
      ).toBe(2);
    });

    test("groups without an order keep the position they arrived in", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({ id: STANDALONE, name: "Standalone" }),
        makeGroup({ id: CORPORATE, name: "Corporate" }),
      ];

      expect(
        rowNames(
          StatusPageGroupHierarchyViewUtil.getRows({
            statusPageGroups: statusPageGroups,
          }),
        ),
      ).toEqual(["Standalone", "Corporate"]);
    });

    test("every group appears exactly once, whatever shape the data is in", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
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
        makeGroup({
          id: MARKET_ONE,
          name: "Market 1001",
          parentId: MARKET_TWO,
          order: 4,
        }),
        makeGroup({
          id: MARKET_TWO,
          name: "Market 1002",
          parentId: MARKET_ONE,
          order: 5,
        }),
        makeGroup({
          id: UNIT,
          name: "Unit 0152",
          parentId: UNIT,
          order: 6,
        }),
      ];

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: statusPageGroups,
          expandedGroupIds: allIds(statusPageGroups),
        });

      expect(rows).toHaveLength(statusPageGroups.length);
      expect(new Set<string>(rowNames(rows)).size).toBe(
        statusPageGroups.length,
      );
    });
  });

  describe("what the row hands the renderer", () => {
    test("the group itself comes along, so the row can draw its settings", () => {
      const grid: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "Corporate",
        order: 1,
        viewMode: StatusPageGroupViewMode.Grid,
        description: "The whole corporate unit",
      });

      const rows: Array<StatusPageGroupHierarchyRow> =
        StatusPageGroupHierarchyViewUtil.getRows({
          statusPageGroups: [grid],
        });

      expect(rows[0]!.statusPageGroup).toBe(grid);
      expect(rows[0]!.statusPageGroup.viewMode).toBe(
        StatusPageGroupViewMode.Grid,
      );
      expect(rows[0]!.statusPageGroup.description).toBe(
        "The whole corporate unit",
      );
    });

    /*
     * Callers hold the expanded set in React state and hand the same Set in on
     * every render; a util that wrote into it would be mutating state.
     */
    test("the expanded set handed in is never written to", () => {
      const statusPageGroups: Array<StatusPageGroup> = makeHierarchy();
      const expanded: Set<string> = new Set<string>([CORPORATE.toString()]);

      StatusPageGroupHierarchyViewUtil.getRows({
        statusPageGroups: statusPageGroups,
        expandedGroupIds: expanded,
      });

      expect(Array.from(expanded)).toEqual([CORPORATE.toString()]);
    });

    test("the group list handed in is never reordered in place", () => {
      const statusPageGroups: Array<StatusPageGroup> = [
        makeGroup({ id: STANDALONE, name: "Standalone", order: 9 }),
        makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
      ];

      StatusPageGroupHierarchyViewUtil.getRows({
        statusPageGroups: statusPageGroups,
      });

      expect(statusPageGroups[0]!.name).toBe("Standalone");
    });
  });
});
