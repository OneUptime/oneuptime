import GroupHierarchy from "../../../../UI/Components/StatusPage/GroupHierarchy";
import StatusPageGroupHierarchyViewUtil, {
  StatusPageGroupHierarchyRow,
} from "../../../../Utils/StatusPage/GroupHierarchyView";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupViewMode from "../../../../Types/StatusPage/StatusPageGroupViewMode";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test - the status page group hierarchy as the operator who
 * builds it sees it.
 *
 * This replaced a flat ModelTable with a "Parent Group" column, so the
 * assertions here are about the things a table could not do and this has to:
 *
 *   - the nesting is drawn, with guide rails that end where their level ends,
 *   - every row is a disclosure control that reports its own state,
 *   - a screen reader is told the same tree a sighted operator sees, including
 *     during a search that has filtered levels down,
 *   - every action the table offered survives, gated on the same permissions,
 *   - and a row whose write is in flight cannot be told to do anything else.
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

function makeGroup(data: {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
  order?: number | undefined;
  description?: string | undefined;
  viewMode?: StatusPageGroupViewMode | undefined;
  isExpandedByDefault?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
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

  if (data.isExpandedByDefault !== undefined) {
    group.isExpandedByDefault = data.isExpandedByDefault;
  }

  if (data.showUptimePercent !== undefined) {
    group.showUptimePercent = data.showUptimePercent;
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

function makeRows(data: {
  statusPageGroups?: Array<StatusPageGroup> | undefined;
  expandAll?: boolean | undefined;
  searchText?: string | undefined;
}): Array<StatusPageGroupHierarchyRow> {
  const statusPageGroups: Array<StatusPageGroup> =
    data.statusPageGroups || makeHierarchy();

  return StatusPageGroupHierarchyViewUtil.getRows({
    statusPageGroups: statusPageGroups,
    expandedGroupIds:
      data.expandAll === false
        ? new Set<string>()
        : StatusPageGroupHierarchyViewUtil.getExpandableGroupIds({
            statusPageGroups: statusPageGroups,
          }),
    searchText: data.searchText,
  });
}

function renderTree(
  props: Partial<React.ComponentProps<typeof GroupHierarchy>> = {},
): ReturnType<typeof render> {
  return render(
    <GroupHierarchy
      rows={props.rows === undefined ? makeRows({}) : props.rows}
      onToggleExpand={props.onToggleExpand || jest.fn()}
      isCreateable={
        props.isCreateable === undefined ? true : props.isCreateable
      }
      isEditable={props.isEditable === undefined ? true : props.isEditable}
      isDeleteable={
        props.isDeleteable === undefined ? true : props.isDeleteable
      }
      onAddSubGroup={props.onAddSubGroup}
      onEdit={props.onEdit}
      onDelete={props.onDelete}
      onMoveUp={props.onMoveUp}
      onMoveDown={props.onMoveDown}
      onShowId={props.onShowId}
      busyGroupId={props.busyGroupId}
      ariaLabel={props.ariaLabel}
    />,
  );
}

function rowFor(name: string): HTMLElement {
  const label: HTMLElement = screen.getByText(name);
  const row: HTMLElement | null = label.closest(
    "[data-testid='status-page-group-hierarchy-row']",
  );

  if (!row) {
    throw new Error(`No row for ${name}`);
  }

  return row as HTMLElement;
}

function rowNames(): Array<string> {
  return screen
    .getAllByTestId("status-page-group-hierarchy-name")
    .map((element: HTMLElement) => {
      return element.textContent || "";
    });
}

describe("GroupHierarchy", () => {
  describe("the tree", () => {
    test("draws one row per row it is handed, in the order it is handed them", () => {
      renderTree();

      expect(rowNames()).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
        "Unit 0152",
        "Region 2000",
      ]);
    });

    test("renders nothing but the tree container when there are no rows", () => {
      renderTree({ rows: [] });

      expect(
        screen.getByTestId("status-page-group-hierarchy"),
      ).toBeInTheDocument();
      expect(
        screen.queryAllByTestId("status-page-group-hierarchy-row"),
      ).toHaveLength(0);
    });

    test("is announced as a tree", () => {
      renderTree();

      expect(screen.getByRole("tree")).toHaveAttribute(
        "aria-label",
        "Status page group hierarchy",
      );
      expect(screen.getAllByRole("treeitem")).toHaveLength(5);
    });

    test("the caller can name the tree", () => {
      renderTree({ ariaLabel: "Groups on Acme Status" });

      expect(screen.getByRole("tree")).toHaveAttribute(
        "aria-label",
        "Groups on Acme Status",
      );
    });

    /*
     * Rows are siblings in the DOM whatever their depth - the tree is rendered
     * flat so a collapsed subtree is genuinely absent - so aria-level is the
     * only thing telling a screen reader the shape of what it is reading.
     */
    test("every row reports its level", () => {
      renderTree();

      expect(rowFor("Corporate")).toHaveAttribute("aria-level", "1");
      expect(rowFor("Region 1000")).toHaveAttribute("aria-level", "2");
      expect(rowFor("Market 1001")).toHaveAttribute("aria-level", "3");
      expect(rowFor("Unit 0152")).toHaveAttribute("aria-level", "4");
    });

    test("every row reports its place among its siblings", () => {
      renderTree();

      expect(rowFor("Region 1000")).toHaveAttribute("aria-posinset", "1");
      expect(rowFor("Region 1000")).toHaveAttribute("aria-setsize", "2");
      expect(rowFor("Region 2000")).toHaveAttribute("aria-posinset", "2");
      expect(rowFor("Region 2000")).toHaveAttribute("aria-setsize", "2");
    });

    /*
     * A search narrows a level, and the counts read out have to be the ones on
     * screen or they describe a tree nobody can see.
     */
    test("a filtered level reports the counts that survived the filter", () => {
      renderTree({ rows: makeRows({ searchText: "Region 1000" }) });

      expect(rowFor("Region 1000")).toHaveAttribute("aria-setsize", "1");
      expect(rowFor("Region 1000")).toHaveAttribute("aria-posinset", "1");
    });

    test("each row carries its depth and id for anything reading the DOM", () => {
      renderTree();

      expect(rowFor("Market 1001")).toHaveAttribute("data-depth", "2");
      expect(rowFor("Market 1001")).toHaveAttribute(
        "data-group-id",
        MARKET.toString(),
      );
    });

    test("a group with no name is still a row you can act on", () => {
      const nameless: StatusPageGroup = new StatusPageGroup();
      nameless._id = CORPORATE.toString();

      renderTree({
        rows: makeRows({ statusPageGroups: [nameless] }),
      });

      expect(screen.getByText("Untitled group")).toBeInTheDocument();
    });
  });

  describe("disclosure", () => {
    test("a group with sub groups gets a chevron; a leaf gets a spacer", () => {
      renderTree();

      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-group-hierarchy-disclosure",
        ),
      ).toBeInTheDocument();
      expect(
        within(rowFor("Unit 0152")).queryByTestId(
          "status-page-group-hierarchy-disclosure",
        ),
      ).not.toBeInTheDocument();
      expect(
        within(rowFor("Unit 0152")).getByTestId(
          "status-page-group-hierarchy-leaf-spacer",
        ),
      ).toBeInTheDocument();
    });

    test("only a row that can be opened reports an expanded state", () => {
      renderTree();

      expect(rowFor("Corporate")).toHaveAttribute("aria-expanded", "true");
      expect(rowFor("Unit 0152")).not.toHaveAttribute("aria-expanded");
    });

    test("a collapsed row says so", () => {
      renderTree({ rows: makeRows({ expandAll: false }) });

      expect(rowFor("Corporate")).toHaveAttribute("aria-expanded", "false");
      expect(rowNames()).toEqual(["Corporate"]);
    });

    test("the chevron is a real button, named for what it will do", () => {
      renderTree({ rows: makeRows({ expandAll: false }) });

      const chevron: HTMLElement = within(rowFor("Corporate")).getByTestId(
        "status-page-group-hierarchy-disclosure",
      );

      expect(chevron.tagName).toBe("BUTTON");
      expect(chevron).toHaveAttribute("type", "button");
      expect(chevron).toHaveAttribute("aria-label", "Expand Corporate");
    });

    test("an expanded row's chevron offers to collapse it", () => {
      renderTree();

      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-group-hierarchy-disclosure",
        ),
      ).toHaveAttribute("aria-label", "Collapse Corporate");
    });

    test("clicking the chevron reports which group was toggled", () => {
      const onToggleExpand: (statusPageGroupId: string) => void = jest.fn();

      renderTree({ onToggleExpand: onToggleExpand });

      fireEvent.click(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-disclosure",
        ),
      );

      expect(onToggleExpand).toHaveBeenCalledWith(REGION_ONE.toString());
    });

    /*
     * A chevron that opens onto nothing reads as a broken row, so the control
     * is keyed on the children that are actually in the view rather than on the
     * children the group has.
     */
    test("a group with no children in the current view loses its chevron", () => {
      const rows: Array<StatusPageGroupHierarchyRow> = makeRows({});
      const corporate: StatusPageGroupHierarchyRow = rows[0]!;

      renderTree({
        rows: [
          {
            ...corporate,
            hasVisibleSubGroups: false,
            isExpanded: false,
          },
        ],
      });

      expect(
        within(rowFor("Corporate")).queryByTestId(
          "status-page-group-hierarchy-disclosure",
        ),
      ).not.toBeInTheDocument();
      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-group-hierarchy-leaf-spacer",
        ),
      ).toBeInTheDocument();
      expect(rowFor("Corporate")).not.toHaveAttribute("aria-expanded");
    });

    /*
     * The other half of the same rule, from the search side: a search pulls a
     * match's whole subtree along with it, so it can never strand a group with
     * a chevron over children it filtered out from under it.
     */
    test("a search never leaves a group holding a chevron it cannot open", () => {
      for (const searchText of [
        "Corporate",
        "Region",
        "Market 1001",
        "Unit 0152",
      ]) {
        const rows: Array<StatusPageGroupHierarchyRow> = makeRows({
          searchText: searchText,
        });

        for (const row of rows) {
          expect(row.hasVisibleSubGroups).toBe(row.hasSubGroups);
        }
      }
    });
  });

  describe("the guide rails", () => {
    test("a top level row has no indent columns", () => {
      renderTree();

      expect(
        within(rowFor("Corporate")).queryAllByTestId(
          "status-page-group-hierarchy-rail",
        ),
      ).toHaveLength(0);
      expect(
        within(rowFor("Corporate")).queryByTestId(
          "status-page-group-hierarchy-connector",
        ),
      ).not.toBeInTheDocument();
    });

    test("a nested row hangs off a connector", () => {
      renderTree();

      expect(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-connector",
        ),
      ).toBeInTheDocument();
    });

    test("one ancestor rail is drawn per level between the row and the left edge", () => {
      renderTree();

      expect(
        within(rowFor("Region 1000")).queryAllByTestId(
          "status-page-group-hierarchy-rail",
        ),
      ).toHaveLength(0);
      expect(
        within(rowFor("Market 1001")).queryAllByTestId(
          "status-page-group-hierarchy-rail",
        ),
      ).toHaveLength(1);
      expect(
        within(rowFor("Unit 0152")).queryAllByTestId(
          "status-page-group-hierarchy-rail",
        ),
      ).toHaveLength(2);
    });

    /*
     * The headline regression a tree without rails has: at depth 3 there is
     * nothing at all telling you which of the levels above the row is still
     * open beside it.
     */
    test("a rail continues only while its level still has rows below", () => {
      renderTree();

      const unitRails: Array<HTMLElement> = within(
        rowFor("Unit 0152"),
      ).getAllByTestId("status-page-group-hierarchy-rail");

      /*
       * Region 1000 is followed by Region 2000, so its column keeps its line;
       * Market 1001 is Region 1000's only child, so its column is blank.
       */
      expect(unitRails[0]).toHaveAttribute("data-rail-continues", "true");
      expect(unitRails[1]).toHaveAttribute("data-rail-continues", "false");
    });

    test("the last row of a level ends its connector in an elbow", () => {
      renderTree();

      expect(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-connector",
        ),
      ).toHaveAttribute("data-is-last-sibling", "false");
      expect(
        within(rowFor("Region 2000")).getByTestId(
          "status-page-group-hierarchy-connector",
        ),
      ).toHaveAttribute("data-is-last-sibling", "true");
    });

    test("rails are decoration and are hidden from screen readers", () => {
      renderTree();

      for (const rail of within(rowFor("Unit 0152")).getAllByTestId(
        "status-page-group-hierarchy-rail",
      )) {
        expect(rail).toHaveAttribute("aria-hidden", "true");
      }

      expect(
        within(rowFor("Unit 0152")).getByTestId(
          "status-page-group-hierarchy-connector",
        ),
      ).toHaveAttribute("aria-hidden", "true");
    });
  });

  describe("what a row says about its group", () => {
    test("a group with sub groups is badged with how many", () => {
      renderTree();

      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-group-hierarchy-sub-group-count",
        ),
      ).toHaveTextContent("2 sub groups");
    });

    test("one sub group is not 1 sub groups", () => {
      renderTree();

      expect(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-sub-group-count",
        ),
      ).toHaveTextContent("1 sub group");
    });

    test("a leaf carries no sub group badge", () => {
      renderTree();

      expect(
        within(rowFor("Unit 0152")).queryByTestId(
          "status-page-group-hierarchy-sub-group-count",
        ),
      ).not.toBeInTheDocument();
    });

    test("a grid group says so", () => {
      renderTree({
        rows: makeRows({
          statusPageGroups: [
            makeGroup({
              id: CORPORATE,
              name: "Corporate",
              order: 1,
              viewMode: StatusPageGroupViewMode.Grid,
            }),
            makeGroup({ id: REGION_ONE, name: "Region 1000", order: 2 }),
          ],
        }),
      });

      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-group-hierarchy-view-mode",
        ),
      ).toHaveTextContent("Grid");
      expect(
        within(rowFor("Region 1000")).queryByTestId(
          "status-page-group-hierarchy-view-mode",
        ),
      ).not.toBeInTheDocument();
    });

    /*
     * isExpandedByDefault defaults to true, so badging the groups that ARE
     * expanded would put a chip on nearly every row and say nothing.
     */
    test("only a group that starts collapsed on the status page is badged", () => {
      renderTree({
        rows: makeRows({
          statusPageGroups: [
            makeGroup({
              id: CORPORATE,
              name: "Corporate",
              order: 1,
              isExpandedByDefault: false,
            }),
            makeGroup({
              id: REGION_ONE,
              name: "Region 1000",
              order: 2,
              isExpandedByDefault: true,
            }),
            makeGroup({ id: REGION_TWO, name: "Region 2000", order: 3 }),
          ],
        }),
      });

      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-group-hierarchy-collapsed-by-default",
        ),
      ).toBeInTheDocument();
      expect(
        within(rowFor("Region 1000")).queryByTestId(
          "status-page-group-hierarchy-collapsed-by-default",
        ),
      ).not.toBeInTheDocument();
      expect(
        within(rowFor("Region 2000")).queryByTestId(
          "status-page-group-hierarchy-collapsed-by-default",
        ),
      ).not.toBeInTheDocument();
    });

    test("a group that publishes uptime is badged", () => {
      renderTree({
        rows: makeRows({
          statusPageGroups: [
            makeGroup({
              id: CORPORATE,
              name: "Corporate",
              order: 1,
              showUptimePercent: true,
            }),
            makeGroup({ id: REGION_ONE, name: "Region 1000", order: 2 }),
          ],
        }),
      });

      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-group-hierarchy-uptime",
        ),
      ).toBeInTheDocument();
      expect(
        within(rowFor("Region 1000")).queryByTestId(
          "status-page-group-hierarchy-uptime",
        ),
      ).not.toBeInTheDocument();
    });

    test("a description is shown under the name", () => {
      renderTree({
        rows: makeRows({
          statusPageGroups: [
            makeGroup({
              id: CORPORATE,
              name: "Corporate",
              order: 1,
              description: "Everything the payments team owns",
            }),
          ],
        }),
      });

      expect(
        screen.getByTestId("status-page-group-hierarchy-description"),
      ).toHaveTextContent("Everything the payments team owns");
    });

    test("a group with no description gets no empty line", () => {
      renderTree();

      expect(
        screen.queryByTestId("status-page-group-hierarchy-description"),
      ).not.toBeInTheDocument();
    });

    /*
     * A long name truncates rather than wrapping - it is the only shrinkable
     * item in the row - so the full name has to stay reachable in the title.
     */
    test("a long name ellipsizes and keeps the full name reachable", () => {
      renderTree();

      const name: HTMLElement = within(rowFor("Corporate")).getByTestId(
        "status-page-group-hierarchy-name",
      );

      expect(name.className).toContain("truncate");
      expect(name).toHaveAttribute("title", "Corporate");
    });
  });

  describe("search results and their context", () => {
    test("rows that matched are marked as matches", () => {
      renderTree({ rows: makeRows({ searchText: "Unit 0152" }) });

      expect(rowFor("Unit 0152")).toHaveAttribute("data-search-match", "true");
    });

    /*
     * A row that is only on screen to give a match its place in the hierarchy
     * is context, not a result, and is drawn quieter to say so.
     */
    test("rows that are only context are marked, and drawn quieter", () => {
      renderTree({ rows: makeRows({ searchText: "Unit 0152" }) });

      expect(rowFor("Corporate")).toHaveAttribute("data-search-match", "false");
      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-group-hierarchy-name",
        ).className,
      ).toContain("text-gray-400");
      expect(
        within(rowFor("Unit 0152")).getByTestId(
          "status-page-group-hierarchy-name",
        ).className,
      ).toContain("text-gray-900");
    });

    test("with no search running, every row is drawn as itself", () => {
      renderTree();

      expect(rowFor("Corporate")).toHaveAttribute("data-search-match", "true");
    });
  });

  describe("row actions", () => {
    test("a group can be given a sub group from its own row", () => {
      const onAddSubGroup: (statusPageGroup: StatusPageGroup) => void =
        jest.fn();

      renderTree({ onAddSubGroup: onAddSubGroup });

      fireEvent.click(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-add-sub-group",
        ),
      );

      expect(onAddSubGroup).toHaveBeenCalledTimes(1);
      expect((onAddSubGroup as jest.Mock).mock.calls[0]![0].name).toBe(
        "Region 1000",
      );
    });

    test("the add button names the group it will nest under", () => {
      renderTree({ onAddSubGroup: jest.fn() });

      expect(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-add-sub-group",
        ),
      ).toHaveAttribute("aria-label", "Add a sub group inside Region 1000");
    });

    test("a group can be edited from its own row", () => {
      const onEdit: (statusPageGroup: StatusPageGroup) => void = jest.fn();

      renderTree({ onEdit: onEdit });

      fireEvent.click(
        within(rowFor("Market 1001")).getByTestId(
          "status-page-group-hierarchy-edit",
        ),
      );

      expect((onEdit as jest.Mock).mock.calls[0]![0].name).toBe("Market 1001");
    });

    test("delete, reorder and show id live behind the row's overflow menu", () => {
      renderTree({
        onDelete: jest.fn(),
        onMoveUp: jest.fn(),
        onMoveDown: jest.fn(),
        onShowId: jest.fn(),
      });

      fireEvent.click(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-more",
        ),
      );

      expect(screen.getByText("Move up")).toBeInTheDocument();
      expect(screen.getByText("Move down")).toBeInTheDocument();
      expect(screen.getByText("Show ID")).toBeInTheDocument();
      expect(screen.getByText("Delete group")).toBeInTheDocument();
    });

    test("deleting reports the group that was chosen", () => {
      const onDelete: (statusPageGroup: StatusPageGroup) => void = jest.fn();

      renderTree({ onDelete: onDelete });

      fireEvent.click(
        within(rowFor("Region 2000")).getByTestId(
          "status-page-group-hierarchy-more",
        ),
      );
      fireEvent.click(screen.getByText("Delete group"));

      expect((onDelete as jest.Mock).mock.calls[0]![0].name).toBe(
        "Region 2000",
      );
    });

    test("moving reports the group and the direction", () => {
      const onMoveUp: (statusPageGroup: StatusPageGroup) => void = jest.fn();
      const onMoveDown: (statusPageGroup: StatusPageGroup) => void = jest.fn();

      renderTree({ onMoveUp: onMoveUp, onMoveDown: onMoveDown });

      fireEvent.click(
        within(rowFor("Region 2000")).getByTestId(
          "status-page-group-hierarchy-more",
        ),
      );
      fireEvent.click(screen.getByText("Move up"));

      expect((onMoveUp as jest.Mock).mock.calls[0]![0].name).toBe(
        "Region 2000",
      );
      expect(onMoveDown).not.toHaveBeenCalled();
    });

    /*
     * `order` is a flat sequence across the status page and the service
     * renumbers siblings around every write, so an offered move that has no
     * neighbour to swap with would send a write with nothing to do.
     */
    test("a move with no sibling that way is offered but disabled", () => {
      renderTree({ onMoveUp: jest.fn(), onMoveDown: jest.fn() });

      fireEvent.click(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-more",
        ),
      );

      expect(screen.getByText("Move up").closest("button")).toBeDisabled();
      expect(screen.getByText("Move down").closest("button")).toBeEnabled();
    });

    test("showing the id reports the group that was chosen", () => {
      const onShowId: (statusPageGroup: StatusPageGroup) => void = jest.fn();

      renderTree({ onShowId: onShowId });

      fireEvent.click(
        within(rowFor("Unit 0152")).getByTestId(
          "status-page-group-hierarchy-more",
        ),
      );
      fireEvent.click(screen.getByText("Show ID"));

      expect((onShowId as jest.Mock).mock.calls[0]![0]._id).toBe(
        UNIT.toString(),
      );
    });
  });

  describe("permissions", () => {
    test("a viewer who cannot create sees no add button", () => {
      renderTree({ isCreateable: false, onAddSubGroup: jest.fn() });

      expect(
        screen.queryAllByTestId("status-page-group-hierarchy-add-sub-group"),
      ).toHaveLength(0);
    });

    test("a viewer who cannot edit sees neither the edit button nor the moves", () => {
      renderTree({
        isEditable: false,
        onEdit: jest.fn(),
        onMoveUp: jest.fn(),
        onMoveDown: jest.fn(),
        onShowId: jest.fn(),
      });

      expect(
        screen.queryAllByTestId("status-page-group-hierarchy-edit"),
      ).toHaveLength(0);

      fireEvent.click(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-more",
        ),
      );

      expect(screen.queryByText("Move up")).not.toBeInTheDocument();
      expect(screen.getByText("Show ID")).toBeInTheDocument();
    });

    test("a viewer who cannot delete is not offered delete", () => {
      renderTree({
        isDeleteable: false,
        onDelete: jest.fn(),
        onShowId: jest.fn(),
      });

      fireEvent.click(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-group-hierarchy-more",
        ),
      );

      expect(screen.queryByText("Delete group")).not.toBeInTheDocument();
    });

    /*
     * The menu is the row's only overflow affordance, so with nothing to put in
     * it the trigger is an empty popover waiting to happen.
     */
    test("a row with no menu actions draws no menu", () => {
      renderTree({ isEditable: false, isDeleteable: false });

      expect(
        screen.queryAllByTestId("status-page-group-hierarchy-more"),
      ).toHaveLength(0);
    });

    test("a read only viewer still sees the whole hierarchy", () => {
      renderTree({
        isCreateable: false,
        isEditable: false,
        isDeleteable: false,
      });

      expect(rowNames()).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
        "Unit 0152",
        "Region 2000",
      ]);
    });
  });

  describe("a row whose write is in flight", () => {
    /*
     * The service renumbers siblings on every reorder, so two writes in flight
     * at once resolve against a hierarchy neither of them saw.
     */
    test("says so, and refuses further actions", () => {
      renderTree({
        busyGroupId: REGION_ONE.toString(),
        onAddSubGroup: jest.fn(),
        onEdit: jest.fn(),
        onDelete: jest.fn(),
        onMoveUp: jest.fn(),
        onMoveDown: jest.fn(),
      });

      const row: HTMLElement = rowFor("Region 1000");

      expect(row).toHaveAttribute("aria-busy", "true");
      expect(
        within(row).getByTestId("status-page-group-hierarchy-add-sub-group"),
      ).toBeDisabled();
      expect(
        within(row).getByTestId("status-page-group-hierarchy-edit"),
      ).toBeDisabled();
    });

    test("leaves every other row alone", () => {
      renderTree({
        busyGroupId: REGION_ONE.toString(),
        onEdit: jest.fn(),
      });

      expect(rowFor("Region 2000")).not.toHaveAttribute("aria-busy");
      expect(
        within(rowFor("Region 2000")).getByTestId(
          "status-page-group-hierarchy-edit",
        ),
      ).toBeEnabled();
    });

    test("no row is busy when nothing is in flight", () => {
      renderTree({ busyGroupId: null, onEdit: jest.fn() });

      for (const row of screen.getAllByTestId(
        "status-page-group-hierarchy-row",
      )) {
        expect(row).not.toHaveAttribute("aria-busy");
      }
    });
  });

  /*
   * A ten level hierarchy is the shape this page exists for, and it is the one
   * a flat table made unreadable.
   */
  describe("a deep hierarchy", () => {
    function makeDeepGroups(levels: number): Array<StatusPageGroup> {
      const statusPageGroups: Array<StatusPageGroup> = [];
      const ids: Array<ObjectID> = [];

      for (let level: number = 0; level < levels; level++) {
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

      return statusPageGroups;
    }

    test("renders every level and reaches the leaf", () => {
      renderTree({ rows: makeRows({ statusPageGroups: makeDeepGroups(10) }) });

      for (let level: number = 0; level < 10; level++) {
        expect(screen.getByText(`Level ${level}`)).toBeInTheDocument();
      }
    });

    test("every level below the top hangs off its own connector", () => {
      renderTree({ rows: makeRows({ statusPageGroups: makeDeepGroups(10) }) });

      for (let level: number = 1; level < 10; level++) {
        expect(
          within(rowFor(`Level ${level}`)).getByTestId(
            "status-page-group-hierarchy-connector",
          ),
        ).toBeInTheDocument();
      }
    });

    /*
     * An only child's column is blank, so a straight chain draws exactly one
     * line - its own connector - however deep it goes.
     */
    test("a straight chain draws no continuing rails", () => {
      renderTree({ rows: makeRows({ statusPageGroups: makeDeepGroups(10) }) });

      for (const rail of within(rowFor("Level 9")).getAllByTestId(
        "status-page-group-hierarchy-rail",
      )) {
        expect(rail).toHaveAttribute("data-rail-continues", "false");
      }
    });

    test("the indent stops growing once the cap is reached", () => {
      renderTree({ rows: makeRows({ statusPageGroups: makeDeepGroups(16) }) });

      const railsAt: (level: number) => number = (level: number): number => {
        return within(rowFor(`Level ${level}`)).queryAllByTestId(
          "status-page-group-hierarchy-rail",
        ).length;
      };

      expect(railsAt(3)).toBe(2);
      expect(railsAt(15)).toBe(
        StatusPageGroupHierarchyViewUtil.MaxIndentColumns - 1,
      );
      expect(railsAt(15)).toBe(
        railsAt(StatusPageGroupHierarchyViewUtil.MaxIndentColumns),
      );
    });
  });
});
