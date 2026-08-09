import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import StatusPageResourceExplorerUtil, {
  StatusPageResourceCountIndex,
  StatusPageResourceGridModel,
  StatusPageResourceNavigatorResult,
  StatusPageResourceNavigatorRow,
  StatusPageResourceSelection,
  StatusPageResourceSelectionType,
} from "../../../Utils/StatusPage/ResourceExplorer";
import { describe, expect, test } from "@jest/globals";

/*
 * The model behind the Resources tab's explorer: what the navigator draws,
 * which counts a row is allowed to claim, where a selection starts, and how a
 * drag becomes the one write the server understands.
 *
 * None of this touches React or the API, which is the point - the numbers an
 * operator uses to decide which of fifteen hundred groups still needs monitors
 * are worth pinning down without a renderer in the way.
 */

type MakeGroupFunction = (data: {
  id: string;
  name: string;
  parentId?: string | undefined;
  order?: number | undefined;
  viewMode?: StatusPageGroupViewMode | undefined;
}) => StatusPageGroup;

const makeGroup: MakeGroupFunction = (data: {
  id: string;
  name: string;
  parentId?: string | undefined;
  order?: number | undefined;
  viewMode?: StatusPageGroupViewMode | undefined;
}): StatusPageGroup => {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id;
  group.name = data.name;
  group.order = data.order === undefined ? 1 : data.order;

  if (data.parentId) {
    group.parentStatusPageGroupId = new ObjectID(data.parentId);
  }

  if (data.viewMode) {
    group.viewMode = data.viewMode;
  }

  return group;
};

type MakeResourceFunction = (data: {
  id: string;
  groupId?: string | undefined;
  order?: number | undefined;
  displayName?: string | undefined;
  monitorName?: string | undefined;
  monitorGroupName?: string | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}) => StatusPageResource;

const makeResource: MakeResourceFunction = (data: {
  id: string;
  groupId?: string | undefined;
  order?: number | undefined;
  displayName?: string | undefined;
  monitorName?: string | undefined;
  monitorGroupName?: string | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = data.id;

  if (data.groupId) {
    resource.statusPageGroupId = new ObjectID(data.groupId);
  }

  if (data.order !== undefined) {
    resource.order = data.order;
  }

  if (data.displayName) {
    resource.displayName = data.displayName;
  }

  if (data.monitorName) {
    const monitor: Monitor = new Monitor();
    monitor._id = `monitor-${data.id}`;
    monitor.name = data.monitorName;
    resource.monitor = monitor;
  }

  if (data.monitorGroupName) {
    const monitorGroup: MonitorGroup = new MonitorGroup();
    monitorGroup._id = `monitor-group-${data.id}`;
    monitorGroup.name = data.monitorGroupName;
    resource.monitorGroup = monitorGroup;
  }

  if (data.rowAxisValue) {
    resource.rowAxisValue = data.rowAxisValue;
  }

  if (data.columnAxisValue) {
    resource.columnAxisValue = data.columnAxisValue;
  }

  return resource;
};

/* Corporate › Region › Market, plus a second top level group. */
const CORPORATE: string = "corporate";
const REGION: string = "region";
const MARKET: string = "market";
const PLATFORM: string = "platform";

type BuildHierarchyFunction = () => Array<StatusPageGroup>;

const buildHierarchy: BuildHierarchyFunction = (): Array<StatusPageGroup> => {
  return [
    makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
    makeGroup({
      id: REGION,
      name: "Region 1000",
      parentId: CORPORATE,
      order: 2,
    }),
    makeGroup({ id: MARKET, name: "Market 1001", parentId: REGION, order: 3 }),
    makeGroup({ id: PLATFORM, name: "Platform", order: 4 }),
  ];
};

type BuildCountIndexFunction = (
  resources: Array<StatusPageResource>,
  totalCount?: number | undefined,
) => StatusPageResourceCountIndex;

const buildCountIndex: BuildCountIndexFunction = (
  resources: Array<StatusPageResource>,
  totalCount?: number | undefined,
): StatusPageResourceCountIndex => {
  return StatusPageResourceExplorerUtil.buildResourceCountIndex({
    statusPageResources: resources,
    totalCount: totalCount,
  });
};

describe("StatusPageResourceExplorerUtil", () => {
  describe("the count index", () => {
    test("counts each group's own resources and the ungrouped ones apart", () => {
      const index: StatusPageResourceCountIndex = buildCountIndex([
        makeResource({ id: "a", groupId: CORPORATE }),
        makeResource({ id: "b", groupId: CORPORATE }),
        makeResource({ id: "c", groupId: REGION }),
        makeResource({ id: "d" }),
      ]);

      expect(index.ownCountByGroupId.get(CORPORATE)).toBe(2);
      expect(index.ownCountByGroupId.get(REGION)).toBe(1);
      expect(index.ungroupedCount).toBe(1);
      expect(index.totalCount).toBe(4);
      expect(index.isComplete).toBe(true);
    });

    test("a group with no resources of its own is absent rather than zero", () => {
      const index: StatusPageResourceCountIndex = buildCountIndex([
        makeResource({ id: "a", groupId: CORPORATE }),
      ]);

      expect(index.ownCountByGroupId.has(MARKET)).toBe(false);
      expect(
        StatusPageResourceExplorerUtil.getOwnResourceCount({
          statusPageGroup: makeGroup({ id: MARKET, name: "Market 1001" }),
          countIndex: index,
        }),
      ).toBe(0);
    });

    /*
     * The numbers are lower bounds when the list came back truncated, and a
     * lower bound presented as a count is worse than no count at all.
     */
    test("is incomplete when the resource list was cut off by the row limit", () => {
      const index: StatusPageResourceCountIndex = buildCountIndex(
        [makeResource({ id: "a", groupId: CORPORATE })],
        5000,
      );

      expect(index.isComplete).toBe(false);
      expect(index.totalCount).toBe(5000);
    });

    test("the empty index knows it does not know", () => {
      const index: StatusPageResourceCountIndex =
        StatusPageResourceExplorerUtil.getEmptyResourceCountIndex();

      expect(index.isComplete).toBe(false);
      expect(index.totalCount).toBe(0);
      expect(index.ungroupedCount).toBe(0);
      expect(index.ownCountByGroupId.size).toBe(0);
    });
  });

  describe("keeping the counts current without re-reading the status page", () => {
    test("replaces one group's count and moves the total by the difference", () => {
      const index: StatusPageResourceCountIndex = buildCountIndex([
        makeResource({ id: "a", groupId: CORPORATE }),
        makeResource({ id: "b", groupId: REGION }),
      ]);

      const next: StatusPageResourceCountIndex =
        StatusPageResourceExplorerUtil.withGroupResourceCount({
          countIndex: index,
          statusPageGroupId: CORPORATE,
          count: 4,
        });

      expect(next.ownCountByGroupId.get(CORPORATE)).toBe(4);
      expect(next.ownCountByGroupId.get(REGION)).toBe(1);
      expect(next.totalCount).toBe(5);
    });

    test("updates the ungrouped bucket when the group id is null", () => {
      const index: StatusPageResourceCountIndex = buildCountIndex([
        makeResource({ id: "a" }),
      ]);

      const next: StatusPageResourceCountIndex =
        StatusPageResourceExplorerUtil.withGroupResourceCount({
          countIndex: index,
          statusPageGroupId: null,
          count: 3,
        });

      expect(next.ungroupedCount).toBe(3);
      expect(next.totalCount).toBe(3);
    });

    /*
     * Every ordinary refetch reports the number the page already had. Returning
     * a new object for those would re-render the whole navigator on every
     * refresh of the selected group.
     */
    test("returns the identical index when the count has not changed", () => {
      const index: StatusPageResourceCountIndex = buildCountIndex([
        makeResource({ id: "a", groupId: CORPORATE }),
      ]);

      expect(
        StatusPageResourceExplorerUtil.withGroupResourceCount({
          countIndex: index,
          statusPageGroupId: CORPORATE,
          count: 1,
        }),
      ).toBe(index);
    });

    test("never drives the total below zero", () => {
      const index: StatusPageResourceCountIndex = buildCountIndex([
        makeResource({ id: "a", groupId: CORPORATE }),
      ]);

      const drifted: StatusPageResourceCountIndex = {
        ...index,
        totalCount: 0,
      };

      expect(
        StatusPageResourceExplorerUtil.withGroupResourceCount({
          countIndex: drifted,
          statusPageGroupId: CORPORATE,
          count: 0,
        }).totalCount,
      ).toBe(0);
    });

    test("carries the truncation flag across an update", () => {
      const index: StatusPageResourceCountIndex = buildCountIndex(
        [makeResource({ id: "a", groupId: CORPORATE })],
        5000,
      );

      expect(
        StatusPageResourceExplorerUtil.withGroupResourceCount({
          countIndex: index,
          statusPageGroupId: CORPORATE,
          count: 9,
        }).isComplete,
      ).toBe(false);
    });
  });

  describe("subtree counts", () => {
    test("rolls a group's descendants up into it", () => {
      const groups: Array<StatusPageGroup> = buildHierarchy();
      const index: StatusPageResourceCountIndex = buildCountIndex([
        makeResource({ id: "a", groupId: MARKET }),
        makeResource({ id: "b", groupId: MARKET }),
        makeResource({ id: "c", groupId: REGION }),
        makeResource({ id: "d", groupId: PLATFORM }),
      ]);

      const subtree: Map<string, number> =
        StatusPageResourceExplorerUtil.buildSubtreeResourceCountIndex({
          statusPageGroups: groups,
          countIndex: index,
        });

      expect(subtree.get(MARKET)).toBe(2);
      expect(subtree.get(REGION)).toBe(3);
      expect(subtree.get(CORPORATE)).toBe(3);
      expect(subtree.get(PLATFORM)).toBe(1);
    });
  });

  describe("the navigator rows", () => {
    test("draws the top level closed, and its children only once it is open", () => {
      const groups: Array<StatusPageGroup> = buildHierarchy();

      const closed: StatusPageResourceNavigatorResult =
        StatusPageResourceExplorerUtil.getNavigatorRows({
          statusPageGroups: groups,
          countIndex: buildCountIndex([]),
        });

      expect(
        closed.rows.map((row: StatusPageResourceNavigatorRow) => {
          return row.name;
        }),
      ).toEqual(["Corporate", "Platform"]);

      const open: StatusPageResourceNavigatorResult =
        StatusPageResourceExplorerUtil.getNavigatorRows({
          statusPageGroups: groups,
          countIndex: buildCountIndex([]),
          expandedGroupIds: new Set<string>([CORPORATE]),
        });

      expect(
        open.rows.map((row: StatusPageResourceNavigatorRow) => {
          return row.name;
        }),
      ).toEqual(["Corporate", "Region 1000", "Platform"]);
    });

    test("attaches both the group's own count and its subtree's", () => {
      const rows: Array<StatusPageResourceNavigatorRow> =
        StatusPageResourceExplorerUtil.getNavigatorRows({
          statusPageGroups: buildHierarchy(),
          countIndex: buildCountIndex([
            makeResource({ id: "a", groupId: MARKET }),
            makeResource({ id: "b", groupId: MARKET }),
          ]),
        }).rows;

      const corporate: StatusPageResourceNavigatorRow | undefined = rows.find(
        (row: StatusPageResourceNavigatorRow) => {
          return row.id === CORPORATE;
        },
      );

      expect(corporate?.ownResourceCount).toBe(0);
      expect(corporate?.subtreeResourceCount).toBe(2);
    });

    test("carries the view mode through, so a grid group can be drawn as one", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({
          id: "grid",
          name: "Grid Group",
          viewMode: StatusPageGroupViewMode.Grid,
        }),
      ];

      expect(
        StatusPageResourceExplorerUtil.getNavigatorRows({
          statusPageGroups: groups,
          countIndex: buildCountIndex([]),
        }).rows[0]?.viewMode,
      ).toBe(StatusPageGroupViewMode.Grid);
    });

    test("a search reveals its matches and marks the rows that are only context", () => {
      const result: StatusPageResourceNavigatorResult =
        StatusPageResourceExplorerUtil.getNavigatorRows({
          statusPageGroups: buildHierarchy(),
          countIndex: buildCountIndex([]),
          searchText: "Market",
        });

      const names: Array<string> = result.rows.map(
        (row: StatusPageResourceNavigatorRow) => {
          return row.name;
        },
      );

      expect(names).toContain("Market 1001");
      /* Its ancestors come along so the match has somewhere to sit. */
      expect(names).toContain("Corporate");

      expect(
        result.rows.find((row: StatusPageResourceNavigatorRow) => {
          return row.name === "Market 1001";
        })?.isSearchMatch,
      ).toBe(true);

      expect(
        result.rows.find((row: StatusPageResourceNavigatorRow) => {
          return row.name === "Corporate";
        })?.isSearchMatch,
      ).toBe(false);
    });

    /*
     * The shape the cap exists for: fifteen hundred groups all at the top
     * level, where "collapsed" hides nothing.
     */
    test("caps a flat hierarchy and reports how much it held back", () => {
      const groups: Array<StatusPageGroup> = [];

      for (let index: number = 0; index < 1500; index++) {
        groups.push(
          makeGroup({
            id: `group-${index}`,
            name: `Group ${index}`,
            order: index,
          }),
        );
      }

      const result: StatusPageResourceNavigatorResult =
        StatusPageResourceExplorerUtil.getNavigatorRows({
          statusPageGroups: groups,
          countIndex: buildCountIndex([]),
        });

      expect(result.rows.length).toBe(
        StatusPageResourceExplorerUtil.MaxNavigatorRows,
      );
      expect(result.totalRowCount).toBe(1500);
      expect(result.isTruncated).toBe(true);
    });

    test("draws everything when nothing is over the cap", () => {
      const result: StatusPageResourceNavigatorResult =
        StatusPageResourceExplorerUtil.getNavigatorRows({
          statusPageGroups: buildHierarchy(),
          countIndex: buildCountIndex([]),
        });

      expect(result.isTruncated).toBe(false);
    });
  });

  describe("revealing a selection", () => {
    test("returns every ancestor of the selected group", () => {
      const ids: Set<string> =
        StatusPageResourceExplorerUtil.getGroupIdsToReveal({
          statusPageGroups: buildHierarchy(),
          statusPageGroupId: MARKET,
        });

      expect(ids.has(REGION)).toBe(true);
      expect(ids.has(CORPORATE)).toBe(true);
      /* Opening the group itself is not what makes it visible. */
      expect(ids.has(MARKET)).toBe(false);
    });

    test("has nothing to reveal for the ungrouped bucket or an unknown group", () => {
      expect(
        StatusPageResourceExplorerUtil.getGroupIdsToReveal({
          statusPageGroups: buildHierarchy(),
          statusPageGroupId: null,
        }).size,
      ).toBe(0);

      expect(
        StatusPageResourceExplorerUtil.getGroupIdsToReveal({
          statusPageGroups: buildHierarchy(),
          statusPageGroupId: "not-a-group",
        }).size,
      ).toBe(0);
    });
  });

  describe("expand all", () => {
    test("lists every group in tree order", () => {
      expect(
        StatusPageResourceExplorerUtil.getAllGroupIds({
          statusPageGroups: buildHierarchy(),
        }),
      ).toEqual([CORPORATE, REGION, MARKET, PLATFORM]);
    });

    test("is withdrawn once opening everything would fill the navigator", () => {
      expect(
        StatusPageResourceExplorerUtil.canExpandAll({ groupCount: 10 }),
      ).toBe(true);
      expect(
        StatusPageResourceExplorerUtil.canExpandAll({ groupCount: 0 }),
      ).toBe(false);
      expect(
        StatusPageResourceExplorerUtil.canExpandAll({
          groupCount:
            StatusPageResourceExplorerUtil.MaxGroupsToExpandAtOnce + 1,
        }),
      ).toBe(false);
    });
  });

  describe("the breadcrumb", () => {
    test("reads downwards from the root and stops before the group itself", () => {
      const steps: Array<{ id: string; name: string }> =
        StatusPageResourceExplorerUtil.getBreadcrumbSteps({
          statusPageGroup: makeGroup({
            id: MARKET,
            name: "Market 1001",
            parentId: REGION,
          }),
          statusPageGroups: buildHierarchy(),
        });

      expect(
        steps.map((step: { id: string; name: string }) => {
          return step.name;
        }),
      ).toEqual(["Corporate", "Region 1000"]);
    });

    test("is empty for a top level group", () => {
      expect(
        StatusPageResourceExplorerUtil.getBreadcrumbSteps({
          statusPageGroup: makeGroup({ id: PLATFORM, name: "Platform" }),
          statusPageGroups: buildHierarchy(),
        }),
      ).toEqual([]);
    });
  });

  describe("where the pane opens", () => {
    test("on the ungrouped bucket when there are resources in it", () => {
      const selection: StatusPageResourceSelection =
        StatusPageResourceExplorerUtil.getInitialSelection({
          statusPageGroups: buildHierarchy(),
          countIndex: buildCountIndex([makeResource({ id: "a" })]),
        });

      expect(selection.type).toBe(StatusPageResourceSelectionType.Ungrouped);
      expect(selection.statusPageGroupId).toBeNull();
    });

    /*
     * Opening on an empty bucket beside a full navigator reads as a page that
     * failed to load.
     */
    test("on the first group when the ungrouped bucket is empty", () => {
      const selection: StatusPageResourceSelection =
        StatusPageResourceExplorerUtil.getInitialSelection({
          statusPageGroups: buildHierarchy(),
          countIndex: buildCountIndex([
            makeResource({ id: "a", groupId: CORPORATE }),
          ]),
        });

      expect(selection.type).toBe(StatusPageResourceSelectionType.Group);
      expect(selection.statusPageGroupId).toBe(CORPORATE);
    });

    test("on the ungrouped bucket when the page has no groups", () => {
      expect(
        StatusPageResourceExplorerUtil.getInitialSelection({
          statusPageGroups: [],
          countIndex: buildCountIndex([]),
        }).type,
      ).toBe(StatusPageResourceSelectionType.Ungrouped);
    });

    /*
     * With truncated counts the page cannot tell an empty bucket from a full
     * one, and guessing wrong hides resources behind a group nobody picked.
     */
    test("on the ungrouped bucket when the counts are not trustworthy", () => {
      expect(
        StatusPageResourceExplorerUtil.getInitialSelection({
          statusPageGroups: buildHierarchy(),
          countIndex: buildCountIndex(
            [makeResource({ id: "a", groupId: CORPORATE })],
            5000,
          ),
        }).type,
      ).toBe(StatusPageResourceSelectionType.Ungrouped);
    });
  });

  describe("naming a resource", () => {
    test("prefers the monitor, then the monitor group, then the display name", () => {
      expect(
        StatusPageResourceExplorerUtil.getResourceName(
          makeResource({
            id: "a",
            monitorName: "API",
            displayName: "Public API",
          }),
        ),
      ).toBe("API");

      expect(
        StatusPageResourceExplorerUtil.getResourceName(
          makeResource({
            id: "b",
            monitorGroupName: "Edge",
            displayName: "Public Edge",
          }),
        ),
      ).toBe("Edge");

      /* A resource whose monitor was deleted still has to be identifiable. */
      expect(
        StatusPageResourceExplorerUtil.getResourceName(
          makeResource({ id: "c", displayName: "Public API" }),
        ),
      ).toBe("Public API");

      expect(
        StatusPageResourceExplorerUtil.getResourceName(
          makeResource({ id: "d" }),
        ),
      ).toBe("Unknown resource");
    });
  });

  describe("filtering a group's resources", () => {
    const resources: Array<StatusPageResource> = [
      makeResource({ id: "a", monitorName: "API", displayName: "Public API" }),
      makeResource({
        id: "b",
        monitorName: "Database",
        displayName: "Storage",
      }),
      makeResource({ id: "c", monitorGroupName: "Edge Nodes" }),
    ];

    test("matches the monitor name, the monitor group name and the display name", () => {
      expect(
        StatusPageResourceExplorerUtil.filterResources({
          statusPageResources: resources,
          searchText: "api",
        }).length,
      ).toBe(1);

      expect(
        StatusPageResourceExplorerUtil.filterResources({
          statusPageResources: resources,
          searchText: "storage",
        }).length,
      ).toBe(1);

      expect(
        StatusPageResourceExplorerUtil.filterResources({
          statusPageResources: resources,
          searchText: "edge",
        }).length,
      ).toBe(1);
    });

    test("returns everything when nothing was typed", () => {
      expect(
        StatusPageResourceExplorerUtil.filterResources({
          statusPageResources: resources,
          searchText: "   ",
        }),
      ).toBe(resources);
    });
  });

  describe("reordering", () => {
    const resources: Array<StatusPageResource> = [
      makeResource({ id: "a", order: 1 }),
      makeResource({ id: "b", order: 2 }),
      makeResource({ id: "c", order: 3 }),
    ];

    /*
     * The write is "take the place of whoever is standing there" - the server
     * renumbers the rest of the group around it.
     */
    test("writes the order of the resource being displaced", () => {
      expect(
        StatusPageResourceExplorerUtil.getReorderTargetOrder({
          statusPageResources: resources,
          fromIndex: 2,
          toIndex: 0,
        }),
      ).toBe(1);

      expect(
        StatusPageResourceExplorerUtil.getReorderTargetOrder({
          statusPageResources: resources,
          fromIndex: 0,
          toIndex: 2,
        }),
      ).toBe(3);
    });

    test("writes nothing for a move that does not move anything", () => {
      expect(
        StatusPageResourceExplorerUtil.getReorderTargetOrder({
          statusPageResources: resources,
          fromIndex: 1,
          toIndex: 1,
        }),
      ).toBeNull();

      expect(
        StatusPageResourceExplorerUtil.getReorderTargetOrder({
          statusPageResources: resources,
          fromIndex: 0,
          toIndex: 9,
        }),
      ).toBeNull();

      expect(
        StatusPageResourceExplorerUtil.getReorderTargetOrder({
          statusPageResources: [makeResource({ id: "a" }), resources[1]!],
          fromIndex: 1,
          toIndex: 0,
        }),
      ).toBeNull();
    });

    test("puts the row where it was dropped without waiting for the write", () => {
      expect(
        StatusPageResourceExplorerUtil.getResourcesInNewOrder({
          statusPageResources: resources,
          fromIndex: 2,
          toIndex: 0,
        }).map((resource: StatusPageResource) => {
          return resource._id;
        }),
      ).toEqual(["c", "a", "b"]);
    });

    test("leaves the list alone when the move is not real", () => {
      expect(
        StatusPageResourceExplorerUtil.getResourcesInNewOrder({
          statusPageResources: resources,
          fromIndex: 1,
          toIndex: 1,
        }),
      ).toBe(resources);

      expect(
        StatusPageResourceExplorerUtil.getResourcesInNewOrder({
          statusPageResources: resources,
          fromIndex: -1,
          toIndex: 1,
        }),
      ).toBe(resources);
    });
  });

  describe("grid groups", () => {
    test("reads the comma separated axis values a group is defined by", () => {
      expect(
        StatusPageResourceExplorerUtil.parseAxisValues(" Auth , API ,, "),
      ).toEqual(["Auth", "API"]);

      expect(StatusPageResourceExplorerUtil.parseAxisValues(null)).toEqual([]);
    });

    /*
     * Axis values are free text, so any separator an operator could type would
     * let ("A B", "C") and ("A", "B C") collapse into one cell.
     */
    test("keeps two different cells apart even when the values contain spaces", () => {
      expect(
        StatusPageResourceExplorerUtil.getGridCellKey("A B", "C"),
      ).not.toBe(StatusPageResourceExplorerUtil.getGridCellKey("A", "B C"));
    });

    test("sorts resources into cells and strands the ones with no cell", () => {
      const model: StatusPageResourceGridModel =
        StatusPageResourceExplorerUtil.buildGridModel({
          statusPageResources: [
            makeResource({
              id: "a",
              monitorName: "Auth US",
              rowAxisValue: "Auth",
              columnAxisValue: "US-East",
            }),
            makeResource({
              id: "b",
              monitorName: "Auth EU",
              rowAxisValue: "Auth",
              columnAxisValue: "EU-West",
            }),
            /* A row value that was renamed on the Groups tab. */
            makeResource({
              id: "c",
              monitorName: "Stranded",
              rowAxisValue: "Billing",
              columnAxisValue: "US-East",
            }),
            /* Never placed at all. */
            makeResource({ id: "d", monitorName: "Unplaced" }),
          ],
          rowValues: ["Auth", "API"],
          columnValues: ["US-East", "EU-West"],
        });

      expect(
        model.resourcesByCellKey.get(
          StatusPageResourceExplorerUtil.getGridCellKey("Auth", "US-East"),
        )?.length,
      ).toBe(1);

      expect(
        model.resourcesByCellKey.get(
          StatusPageResourceExplorerUtil.getGridCellKey("API", "US-East"),
        ),
      ).toBeUndefined();

      expect(
        model.orphanResources.map((resource: StatusPageResource) => {
          return resource._id;
        }),
      ).toEqual(["c", "d"]);
    });
  });

  describe("labels", () => {
    test("says nothing at all while the counts cannot be trusted", () => {
      const incomplete: StatusPageResourceCountIndex = buildCountIndex(
        [],
        5000,
      );

      expect(
        StatusPageResourceExplorerUtil.getNavigatorCountLabel({
          row: {
            ownResourceCount: 3,
            subtreeResourceCount: 3,
          } as StatusPageResourceNavigatorRow,
          countIndex: incomplete,
        }),
      ).toBeNull();

      expect(
        StatusPageResourceExplorerUtil.getNavigatorCountTooltip({
          row: {
            ownResourceCount: 3,
            subtreeResourceCount: 3,
          } as StatusPageResourceNavigatorRow,
          countIndex: incomplete,
        }),
      ).toBeUndefined();
    });

    test("pluralises the resource count", () => {
      expect(
        StatusPageResourceExplorerUtil.getResourceCountLabel({ count: 1 }),
      ).toBe("1 resource");

      expect(
        StatusPageResourceExplorerUtil.getResourceCountLabel({ count: 4 }),
      ).toBe("4 resources");
    });

    /*
     * A group holding nothing itself but a hundred resources below it is not
     * empty, and a bare "0" beside it sends an operator hunting for monitors
     * that are right there.
     */
    test("a group that only holds resources further down says so", () => {
      const complete: StatusPageResourceCountIndex = buildCountIndex([]);

      expect(
        StatusPageResourceExplorerUtil.getNavigatorCountLabel({
          row: {
            ownResourceCount: 0,
            subtreeResourceCount: 100,
          } as StatusPageResourceNavigatorRow,
          countIndex: complete,
        }),
      ).toBe("+100");

      expect(
        StatusPageResourceExplorerUtil.getNavigatorCountLabel({
          row: {
            ownResourceCount: 2,
            subtreeResourceCount: 100,
          } as StatusPageResourceNavigatorRow,
          countIndex: complete,
        }),
      ).toBe("2");

      expect(
        StatusPageResourceExplorerUtil.getNavigatorCountTooltip({
          row: {
            ownResourceCount: 2,
            subtreeResourceCount: 100,
          } as StatusPageResourceNavigatorRow,
          countIndex: complete,
        }),
      ).toBe("2 resources in this group · 100 including sub groups");

      expect(
        StatusPageResourceExplorerUtil.getNavigatorCountTooltip({
          row: {
            ownResourceCount: 1,
            subtreeResourceCount: 1,
          } as StatusPageResourceNavigatorRow,
          countIndex: complete,
        }),
      ).toBe("1 resource in this group");
    });

    test("pluralises the sub group count and stays silent at zero", () => {
      expect(
        StatusPageResourceExplorerUtil.getSubGroupCountLabel({
          subGroupCount: 0,
        }),
      ).toBeNull();

      expect(
        StatusPageResourceExplorerUtil.getSubGroupCountLabel({
          subGroupCount: 1,
        }),
      ).toBe("1 sub group");

      expect(
        StatusPageResourceExplorerUtil.getSubGroupCountLabel({
          subGroupCount: 12,
        }),
      ).toBe("12 sub groups");
    });
  });
});
