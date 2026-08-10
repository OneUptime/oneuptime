import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageGroupViewMode from "../../../../Types/StatusPage/StatusPageGroupViewMode";
import ResourceGroupNavigator from "../../../../UI/Components/StatusPage/ResourceGroupNavigator";
import StatusPageResourceExplorerUtil, {
  StatusPageResourceCountIndex,
  StatusPageResourceNavigatorRow,
  StatusPageResourceSelection,
  StatusPageResourceSelectionType,
} from "../../../../Utils/StatusPage/ResourceExplorer";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test - the group hierarchy on Status Page > Resources.
 *
 * This is one control doing two jobs that used to be two pages. It is the
 * navigator: a row selects a group, which is what puts that group's monitors in
 * the pane beside it. It is also the group manager that Status Page > Groups
 * used to be: a row is where a group is given a sub group, renamed, reordered,
 * identified and deleted.
 *
 * So the assertions here are about keeping those two jobs from eating each
 * other:
 *
 *   - opening a branch and selecting a group are separate acts, because an
 *     operator has to be able to look inside a branch without losing the group
 *     they were filling,
 *   - the nesting is drawn, with guide rails that end where their level ends,
 *   - the counts say what a group holds and what is further down, and say
 *     nothing at all when they are not trustworthy,
 *   - every action the Groups page offered survives, gated on the same
 *     permissions,
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

function makeResource(data: {
  id: string;
  groupId?: ObjectID | undefined;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = data.id;

  if (data.groupId) {
    resource.statusPageGroupId = data.groupId;
  }

  return resource;
}

function makeCountIndex(
  statusPageResources: Array<StatusPageResource> = [],
): StatusPageResourceCountIndex {
  return StatusPageResourceExplorerUtil.buildResourceCountIndex({
    statusPageResources: statusPageResources,
  });
}

function makeRows(data: {
  statusPageGroups?: Array<StatusPageGroup> | undefined;
  countIndex?: StatusPageResourceCountIndex | undefined;
  expandAll?: boolean | undefined;
  searchText?: string | undefined;
  maxRows?: number | undefined;
}): Array<StatusPageResourceNavigatorRow> {
  const statusPageGroups: Array<StatusPageGroup> =
    data.statusPageGroups || makeHierarchy();

  return StatusPageResourceExplorerUtil.getNavigatorRows({
    statusPageGroups: statusPageGroups,
    countIndex: data.countIndex || makeCountIndex(),
    expandedGroupIds:
      data.expandAll === false
        ? new Set<string>()
        : new Set<string>(
            StatusPageResourceExplorerUtil.getAllGroupIds({
              statusPageGroups: statusPageGroups,
            }),
          ),
    searchText: data.searchText,
    maxRows: data.maxRows,
  }).rows;
}

const UNGROUPED_SELECTION: StatusPageResourceSelection = {
  type: StatusPageResourceSelectionType.Ungrouped,
  statusPageGroupId: null,
};

function renderNavigator(
  props: Partial<React.ComponentProps<typeof ResourceGroupNavigator>> = {},
): ReturnType<typeof render> {
  return render(
    <ResourceGroupNavigator
      rows={props.rows === undefined ? makeRows({}) : props.rows}
      countIndex={props.countIndex || makeCountIndex()}
      selection={props.selection || UNGROUPED_SELECTION}
      searchText={props.searchText === undefined ? "" : props.searchText}
      hiddenRowCount={
        props.hiddenRowCount === undefined ? 0 : props.hiddenRowCount
      }
      onShowMore={props.onShowMore || jest.fn()}
      onSelect={props.onSelect || jest.fn()}
      onToggleExpand={props.onToggleExpand || jest.fn()}
      isCreateable={
        props.isCreateable === undefined ? true : props.isCreateable
      }
      isEditable={props.isEditable === undefined ? true : props.isEditable}
      isDeleteable={
        props.isDeleteable === undefined ? true : props.isDeleteable
      }
      onCreateGroup={props.onCreateGroup}
      onAddSubGroup={props.onAddSubGroup}
      onEditGroup={props.onEditGroup}
      onDeleteGroup={props.onDeleteGroup}
      onMoveGroupUp={props.onMoveGroupUp}
      onMoveGroupDown={props.onMoveGroupDown}
      onShowGroupId={props.onShowGroupId}
      busyGroupId={props.busyGroupId}
    />,
  );
}

function rowFor(name: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .getAllByTestId("status-page-resource-navigator-row")
    .find((candidate: HTMLElement) => {
      return within(candidate)
        .getAllByTestId("status-page-resource-navigator-name")
        .some((element: HTMLElement) => {
          return element.textContent === name;
        });
    });

  if (!row) {
    throw new Error(`No row for ${name}`);
  }

  return row;
}

function rowNames(): Array<string> {
  return screen
    .getAllByTestId("status-page-resource-navigator-name")
    .map((element: HTMLElement) => {
      return element.textContent || "";
    });
}

function openMenuFor(name: string): HTMLElement {
  fireEvent.click(
    within(rowFor(name)).getByTestId("status-page-resource-navigator-more"),
  );

  return screen.getByRole("menu");
}

describe("ResourceGroupNavigator", () => {
  describe("the tree", () => {
    test("draws one row per row it is handed, in the order it is handed them", () => {
      renderNavigator();

      expect(rowNames()).toEqual([
        "Corporate",
        "Region 1000",
        "Market 1001",
        "Unit 0152",
        "Region 2000",
      ]);
    });

    test("is announced as a tree", () => {
      renderNavigator();

      expect(screen.getByRole("tree")).toHaveAttribute(
        "aria-label",
        "Status page groups",
      );
      expect(screen.getAllByRole("treeitem").length).toBe(5);
    });

    test("every row reports its level", () => {
      renderNavigator();

      expect(rowFor("Corporate")).toHaveAttribute("aria-level", "1");
      expect(rowFor("Region 1000")).toHaveAttribute("aria-level", "2");
      expect(rowFor("Market 1001")).toHaveAttribute("aria-level", "3");
      expect(rowFor("Unit 0152")).toHaveAttribute("aria-level", "4");
    });

    test("every row reports its place among its siblings", () => {
      renderNavigator();

      expect(rowFor("Region 1000")).toHaveAttribute("aria-posinset", "1");
      expect(rowFor("Region 1000")).toHaveAttribute("aria-setsize", "2");
      expect(rowFor("Region 2000")).toHaveAttribute("aria-posinset", "2");
      expect(rowFor("Region 2000")).toHaveAttribute("aria-setsize", "2");
    });

    /*
     * A tree tells a screen reader "1 of 2 at level 2". During a search the
     * counts it quotes have to be the ones on screen, or they describe a tree
     * nobody can see.
     */
    test("a filtered level reports the counts that survived the filter", () => {
      renderNavigator({ rows: makeRows({ searchText: "Region 1000" }) });

      expect(rowFor("Region 1000")).toHaveAttribute("aria-setsize", "1");
    });

    test("each row carries its depth and id for anything reading the DOM", () => {
      renderNavigator();

      expect(rowFor("Market 1001")).toHaveAttribute("data-depth", "2");
      expect(rowFor("Market 1001")).toHaveAttribute(
        "data-group-id",
        MARKET.toString(),
      );
    });

    test("a group with no name is still a row you can act on", () => {
      const unnamed: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "",
        order: 1,
      });

      renderNavigator({ rows: makeRows({ statusPageGroups: [unnamed] }) });

      expect(rowNames()).toEqual(["Untitled group"]);
    });

    test("says so when a search matched nothing at all", () => {
      renderNavigator({ rows: [], searchText: "nothing here" });

      expect(
        screen.getByTestId("status-page-resource-navigator-empty").textContent,
      ).toContain("nothing here");
    });

    /*
     * An empty tree with no search running is a status page nobody has grouped
     * yet, which is a different message from a search that found nothing.
     */
    test("an ungrouped status page is told what groups are for", () => {
      renderNavigator({ rows: [], searchText: "" });

      expect(
        screen.getByTestId("status-page-resource-navigator-empty").textContent,
      ).toContain("No groups yet");
    });
  });

  describe("selecting versus opening", () => {
    /*
     * The whole reason the chevron is a separate control. An operator filling
     * "Region 1000" has to be able to look inside "Corporate" without the pane
     * beside them jumping to it.
     */
    test("the chevron opens a branch and selects nothing", () => {
      const onToggleExpand: (statusPageGroupId: string) => void = jest.fn();
      const onSelect: (selection: StatusPageResourceSelection) => void =
        jest.fn();

      renderNavigator({
        onToggleExpand: onToggleExpand,
        onSelect: onSelect,
      });

      fireEvent.click(
        within(rowFor("Corporate")).getByTestId(
          "status-page-resource-navigator-disclosure",
        ),
      );

      expect(onToggleExpand).toHaveBeenCalledWith(CORPORATE.toString());
      expect(onSelect).not.toHaveBeenCalled();
    });

    test("the row selects the group and opens nothing", () => {
      const onToggleExpand: (statusPageGroupId: string) => void = jest.fn();
      const onSelect: (selection: StatusPageResourceSelection) => void =
        jest.fn();

      renderNavigator({
        onToggleExpand: onToggleExpand,
        onSelect: onSelect,
      });

      fireEvent.click(
        within(rowFor("Corporate")).getByTestId(
          "status-page-resource-navigator-select",
        ),
      );

      expect(onSelect).toHaveBeenCalledWith({
        type: StatusPageResourceSelectionType.Group,
        statusPageGroupId: CORPORATE.toString(),
      });
      expect(onToggleExpand).not.toHaveBeenCalled();
    });

    test("the selected group is the one marked as selected", () => {
      renderNavigator({
        selection: {
          type: StatusPageResourceSelectionType.Group,
          statusPageGroupId: MARKET.toString(),
        },
      });

      expect(rowFor("Market 1001")).toHaveAttribute("aria-selected", "true");
      expect(rowFor("Corporate")).toHaveAttribute("aria-selected", "false");
    });

    /*
     * The resources that belong to no group are a real place on a status page -
     * they are drawn above every group - so they are selectable like anything
     * else rather than being a group with a null id.
     */
    test("the ungrouped bucket is selectable and reports being current", () => {
      const onSelect: (selection: StatusPageResourceSelection) => void =
        jest.fn();

      renderNavigator({ onSelect: onSelect });

      const ungrouped: HTMLElement = screen.getByTestId(
        "status-page-resource-navigator-ungrouped",
      );

      expect(ungrouped).toHaveAttribute("aria-current", "true");

      fireEvent.click(ungrouped);

      expect(onSelect).toHaveBeenCalledWith(UNGROUPED_SELECTION);
    });

    test("a leaf keeps the chevron's column so every name starts on one line", () => {
      renderNavigator();

      expect(
        within(rowFor("Unit 0152")).getByTestId(
          "status-page-resource-navigator-leaf-spacer",
        ),
      ).toBeInTheDocument();
      expect(
        within(rowFor("Unit 0152")).queryByTestId(
          "status-page-resource-navigator-disclosure",
        ),
      ).not.toBeInTheDocument();
    });

    test("a collapsed row says so, and offers to expand", () => {
      renderNavigator({ rows: makeRows({ expandAll: false }) });

      expect(rowFor("Corporate")).toHaveAttribute("aria-expanded", "false");
      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-resource-navigator-disclosure",
        ),
      ).toHaveAttribute("aria-label", "Expand Corporate");
    });

    test("an expanded row offers to collapse", () => {
      renderNavigator();

      expect(rowFor("Corporate")).toHaveAttribute("aria-expanded", "true");
      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-resource-navigator-disclosure",
        ),
      ).toHaveAttribute("aria-label", "Collapse Corporate");
    });
  });

  /*
   * The arrow keys everybody already knows from a file tree. Without them the
   * only way through a large hierarchy from the keyboard is Tab, which stops on
   * every chevron and every row action on the way past and cannot skip a
   * subtree at all.
   */
  describe("walking the tree from the keyboard", () => {
    type SelectButtonFunction = (name: string) => HTMLElement;

    const selectButtonFor: SelectButtonFunction = (
      name: string,
    ): HTMLElement => {
      return within(rowFor(name)).getByTestId(
        "status-page-resource-navigator-select",
      );
    };

    type PressFunction = (name: string, key: string) => void;

    const press: PressFunction = (name: string, key: string): void => {
      const button: HTMLElement = selectButtonFor(name);

      button.focus();
      fireEvent.keyDown(button, { key: key });
    };

    test("down and up walk the rows that are on screen", () => {
      renderNavigator();

      press("Corporate", "ArrowDown");
      expect(document.activeElement).toBe(selectButtonFor("Region 1000"));

      fireEvent.keyDown(document.activeElement as HTMLElement, {
        key: "ArrowDown",
      });
      expect(document.activeElement).toBe(selectButtonFor("Market 1001"));

      fireEvent.keyDown(document.activeElement as HTMLElement, {
        key: "ArrowUp",
      });
      expect(document.activeElement).toBe(selectButtonFor("Region 1000"));
    });

    test("home and end jump to the ends", () => {
      renderNavigator();

      press("Market 1001", "End");
      expect(document.activeElement).toBe(selectButtonFor("Region 2000"));

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
      expect(document.activeElement).toBe(selectButtonFor("Corporate"));
    });

    test("the ends do not wrap around", () => {
      renderNavigator();

      press("Corporate", "ArrowUp");
      expect(document.activeElement).toBe(selectButtonFor("Corporate"));

      press("Region 2000", "ArrowDown");
      expect(document.activeElement).toBe(selectButtonFor("Region 2000"));
    });

    test("right opens a closed branch, and steps into an open one", () => {
      const onToggleExpand: (statusPageGroupId: string) => void = jest.fn();

      renderNavigator({
        rows: makeRows({ expandAll: false }),
        onToggleExpand: onToggleExpand,
      });

      press("Corporate", "ArrowRight");

      expect(onToggleExpand).toHaveBeenCalledWith(CORPORATE.toString());
    });

    test("right on an already open branch moves to its first child", () => {
      const onToggleExpand: (statusPageGroupId: string) => void = jest.fn();

      renderNavigator({ onToggleExpand: onToggleExpand });

      press("Corporate", "ArrowRight");

      expect(onToggleExpand).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(selectButtonFor("Region 1000"));
    });

    test("left closes the branch you are standing in", () => {
      const onToggleExpand: (statusPageGroupId: string) => void = jest.fn();

      renderNavigator({ onToggleExpand: onToggleExpand });

      press("Region 1000", "ArrowLeft");

      expect(onToggleExpand).toHaveBeenCalledWith(REGION_ONE.toString());
    });

    /*
     * Skipping a subtree is the thing Tab cannot do, and the only reason a
     * fifteen hundred group hierarchy is navigable from a keyboard at all.
     */
    test("left on a leaf climbs out to the group that contains it", () => {
      const onToggleExpand: (statusPageGroupId: string) => void = jest.fn();

      renderNavigator({ onToggleExpand: onToggleExpand });

      press("Unit 0152", "ArrowLeft");

      expect(onToggleExpand).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(selectButtonFor("Market 1001"));
    });

    test("keys that are not navigation are left alone", () => {
      const onToggleExpand: (statusPageGroupId: string) => void = jest.fn();
      const onSelect: (selection: StatusPageResourceSelection) => void =
        jest.fn();

      renderNavigator({
        onToggleExpand: onToggleExpand,
        onSelect: onSelect,
      });

      press("Corporate", "a");

      expect(document.activeElement).toBe(selectButtonFor("Corporate"));
      expect(onToggleExpand).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("creating a group from the section header", () => {
    test("is offered beside the list it will join", () => {
      const onCreateGroup: () => void = jest.fn();

      renderNavigator({ onCreateGroup: onCreateGroup });

      fireEvent.click(
        screen.getByTestId("status-page-resource-navigator-create-group"),
      );

      expect(onCreateGroup).toHaveBeenCalled();
    });

    test("is not offered to someone who cannot create", () => {
      renderNavigator({ isCreateable: false, onCreateGroup: jest.fn() });

      expect(
        screen.queryByTestId("status-page-resource-navigator-create-group"),
      ).not.toBeInTheDocument();
    });
  });

  describe("the guide rails", () => {
    test("a top level row has no indent columns", () => {
      renderNavigator();

      expect(
        within(rowFor("Corporate")).queryAllByTestId(
          "status-page-resource-navigator-rail",
        ).length,
      ).toBe(0);
      expect(
        within(rowFor("Corporate")).queryByTestId(
          "status-page-resource-navigator-connector",
        ),
      ).not.toBeInTheDocument();
    });

    test("a nested row hangs off a connector", () => {
      renderNavigator();

      expect(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-resource-navigator-connector",
        ),
      ).toBeInTheDocument();
    });

    test("one ancestor rail is drawn per level between the row and the left edge", () => {
      renderNavigator();

      expect(
        within(rowFor("Region 1000")).queryAllByTestId(
          "status-page-resource-navigator-rail",
        ).length,
      ).toBe(0);
      expect(
        within(rowFor("Market 1001")).queryAllByTestId(
          "status-page-resource-navigator-rail",
        ).length,
      ).toBe(1);
      expect(
        within(rowFor("Unit 0152")).queryAllByTestId(
          "status-page-resource-navigator-rail",
        ).length,
      ).toBe(2);
    });

    /*
     * "Region 1000" still has "Region 2000" below it, so the rail running past
     * its descendants continues; nothing follows "Region 2000", so it does not.
     */
    test("a rail continues only while its level still has rows below", () => {
      renderNavigator();

      type RailsFunction = (name: string) => Array<string | null>;

      const railsFor: RailsFunction = (name: string): Array<string | null> => {
        return within(rowFor(name))
          .getAllByTestId("status-page-resource-navigator-rail")
          .map((rail: HTMLElement) => {
            return rail.getAttribute("data-rail-continues");
          });
      };

      /*
       * "Region 1000" still has "Region 2000" below it, so its rail runs past
       * everything nested under it; "Market 1001" is the last of its level, so
       * the rail standing for it has already ended by the time "Unit 0152" is
       * drawn.
       */
      expect(railsFor("Market 1001")).toEqual(["true"]);
      expect(railsFor("Unit 0152")).toEqual(["true", "false"]);
    });

    test("the last row of a level ends its connector in an elbow", () => {
      renderNavigator();

      expect(
        within(rowFor("Region 2000"))
          .getByTestId("status-page-resource-navigator-connector")
          .getAttribute("data-is-last-sibling"),
      ).toBe("true");
      expect(
        within(rowFor("Region 1000"))
          .getByTestId("status-page-resource-navigator-connector")
          .getAttribute("data-is-last-sibling"),
      ).toBe("false");
    });

    test("rails are decoration and are hidden from screen readers", () => {
      renderNavigator();

      for (const rail of screen.getAllByTestId(
        "status-page-resource-navigator-rail",
      )) {
        expect(rail).toHaveAttribute("aria-hidden", "true");
      }
    });
  });

  describe("the counts", () => {
    /*
     * A group holding nothing itself but with resources nested under it is not
     * empty, and a bare "0" beside it would send an operator hunting through
     * the hierarchy for monitors that are right there.
     */
    test("show what a group holds, and what is below it when it holds none", () => {
      const countIndex: StatusPageResourceCountIndex = makeCountIndex([
        makeResource({ id: "a", groupId: MARKET }),
        makeResource({ id: "b", groupId: MARKET }),
        makeResource({ id: "c", groupId: REGION_TWO }),
      ]);

      renderNavigator({
        countIndex: countIndex,
        rows: makeRows({ countIndex: countIndex }),
      });

      expect(
        within(rowFor("Market 1001")).getByTestId(
          "status-page-resource-navigator-count",
        ).textContent,
      ).toBe("2");
      expect(
        within(rowFor("Corporate")).getByTestId(
          "status-page-resource-navigator-count",
        ).textContent,
      ).toBe("+3");
    });

    /*
     * An operator deciding which group still needs monitors is going to trust
     * these numbers, so a count built from a truncated read says nothing.
     */
    test("say nothing at all when the count pass came back truncated", () => {
      const countIndex: StatusPageResourceCountIndex =
        StatusPageResourceExplorerUtil.buildResourceCountIndex({
          statusPageResources: [makeResource({ id: "a", groupId: MARKET })],
          totalCount: 900,
        });

      renderNavigator({
        countIndex: countIndex,
        rows: makeRows({ countIndex: countIndex }),
      });

      expect(
        screen.queryAllByTestId("status-page-resource-navigator-count").length,
      ).toBe(0);
      expect(
        screen.queryByTestId("status-page-resource-navigator-ungrouped-count"),
      ).not.toBeInTheDocument();
    });

    test("the ungrouped bucket carries its own count", () => {
      const countIndex: StatusPageResourceCountIndex = makeCountIndex([
        makeResource({ id: "a" }),
        makeResource({ id: "b" }),
        makeResource({ id: "c", groupId: MARKET }),
      ]);

      renderNavigator({
        countIndex: countIndex,
        rows: makeRows({ countIndex: countIndex }),
      });

      expect(
        screen.getByTestId("status-page-resource-navigator-ungrouped-count")
          .textContent,
      ).toBe("2");
    });
  });

  describe("rows the cap is holding back", () => {
    test("are offered a page at a time", () => {
      const onShowMore: () => void = jest.fn();

      renderNavigator({ hiddenRowCount: 12, onShowMore: onShowMore });

      const showMore: HTMLElement = screen.getByTestId(
        "status-page-resource-navigator-show-more",
      );

      expect(showMore.textContent).toContain("12");

      fireEvent.click(within(showMore).getByRole("button"));

      expect(onShowMore).toHaveBeenCalled();
    });

    test("are not mentioned when there are none", () => {
      renderNavigator({ hiddenRowCount: 0 });

      expect(
        screen.queryByTestId("status-page-resource-navigator-show-more"),
      ).not.toBeInTheDocument();
    });
  });

  describe("group actions", () => {
    test("a group can be given a sub group from its own row", () => {
      const onAddSubGroup: (statusPageGroup: StatusPageGroup) => void =
        jest.fn();

      renderNavigator({ onAddSubGroup: onAddSubGroup });

      const addButton: HTMLElement = within(rowFor("Region 1000")).getByTestId(
        "status-page-resource-navigator-add-sub-group",
      );

      expect(addButton).toHaveAttribute(
        "aria-label",
        "Add a sub group inside Region 1000",
      );

      fireEvent.click(addButton);

      expect(
        (
          (onAddSubGroup as jest.Mock).mock.calls[0]![0] as StatusPageGroup
        )._id?.toString(),
      ).toBe(REGION_ONE.toString());
    });

    test("editing, reordering, identifying and deleting live behind the row's overflow menu", () => {
      renderNavigator({
        onEditGroup: jest.fn(),
        onMoveGroupUp: jest.fn(),
        onMoveGroupDown: jest.fn(),
        onShowGroupId: jest.fn(),
        onDeleteGroup: jest.fn(),
      });

      const menu: HTMLElement = openMenuFor("Region 1000");
      const labels: Array<string> = within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement) => {
          return item.textContent || "";
        });

      expect(labels).toEqual([
        "Edit group",
        "Move up",
        "Move down",
        "Show ID",
        "Delete group",
      ]);
    });

    test("editing reports the group that was chosen", () => {
      const onEditGroup: (statusPageGroup: StatusPageGroup) => void = jest.fn();

      renderNavigator({ onEditGroup: onEditGroup });

      fireEvent.click(
        within(openMenuFor("Market 1001")).getByText("Edit group"),
      );

      expect(
        (
          (onEditGroup as jest.Mock).mock.calls[0]![0] as StatusPageGroup
        )._id?.toString(),
      ).toBe(MARKET.toString());
    });

    test("deleting reports the group that was chosen", () => {
      const onDeleteGroup: (statusPageGroup: StatusPageGroup) => void =
        jest.fn();

      renderNavigator({ onDeleteGroup: onDeleteGroup });

      fireEvent.click(
        within(openMenuFor("Market 1001")).getByText("Delete group"),
      );

      expect(
        (
          (onDeleteGroup as jest.Mock).mock.calls[0]![0] as StatusPageGroup
        )._id?.toString(),
      ).toBe(MARKET.toString());
    });

    test("moving reports the group and the direction", () => {
      const onMoveGroupUp: (statusPageGroup: StatusPageGroup) => void =
        jest.fn();
      const onMoveGroupDown: (statusPageGroup: StatusPageGroup) => void =
        jest.fn();

      renderNavigator({
        onMoveGroupUp: onMoveGroupUp,
        onMoveGroupDown: onMoveGroupDown,
      });

      fireEvent.click(within(openMenuFor("Region 2000")).getByText("Move up"));

      expect(
        (
          (onMoveGroupUp as jest.Mock).mock.calls[0]![0] as StatusPageGroup
        )._id?.toString(),
      ).toBe(REGION_TWO.toString());

      fireEvent.click(
        within(openMenuFor("Region 1000")).getByText("Move down"),
      );

      expect(
        (
          (onMoveGroupDown as jest.Mock).mock.calls[0]![0] as StatusPageGroup
        )._id?.toString(),
      ).toBe(REGION_ONE.toString());
    });

    /*
     * Offered but disabled rather than absent: a menu whose contents change
     * shape from row to row is a menu you have to read every time.
     */
    test("a move with no sibling that way is offered but disabled", () => {
      renderNavigator({
        onMoveGroupUp: jest.fn(),
        onMoveGroupDown: jest.fn(),
      });

      const menu: HTMLElement = openMenuFor("Region 1000");

      expect(
        within(menu).getByText("Move up").closest("button"),
      ).toBeDisabled();
      expect(
        within(menu).getByText("Move down").closest("button"),
      ).not.toBeDisabled();
    });

    test("showing the id reports the group that was chosen", () => {
      const onShowGroupId: (statusPageGroup: StatusPageGroup) => void =
        jest.fn();

      renderNavigator({ onShowGroupId: onShowGroupId });

      fireEvent.click(within(openMenuFor("Unit 0152")).getByText("Show ID"));

      expect(
        (
          (onShowGroupId as jest.Mock).mock.calls[0]![0] as StatusPageGroup
        )._id?.toString(),
      ).toBe(UNIT.toString());
    });
  });

  describe("permissions", () => {
    test("a viewer who cannot create sees no add button", () => {
      renderNavigator({
        isCreateable: false,
        onAddSubGroup: jest.fn(),
      });

      expect(
        screen.queryAllByTestId("status-page-resource-navigator-add-sub-group")
          .length,
      ).toBe(0);
    });

    test("a viewer who cannot edit is offered neither the edit nor the moves", () => {
      renderNavigator({
        isEditable: false,
        onEditGroup: jest.fn(),
        onMoveGroupUp: jest.fn(),
        onMoveGroupDown: jest.fn(),
        onShowGroupId: jest.fn(),
      });

      const labels: Array<string> = within(openMenuFor("Region 1000"))
        .getAllByRole("menuitem")
        .map((item: HTMLElement) => {
          return item.textContent || "";
        });

      expect(labels).toEqual(["Show ID"]);
    });

    test("a viewer who cannot delete is not offered delete", () => {
      renderNavigator({
        isDeleteable: false,
        onShowGroupId: jest.fn(),
        onDeleteGroup: jest.fn(),
      });

      expect(
        within(openMenuFor("Region 1000")).queryByText("Delete group"),
      ).not.toBeInTheDocument();
    });

    test("a row with no actions at all draws no cluster", () => {
      renderNavigator({
        isCreateable: false,
        isEditable: false,
        isDeleteable: false,
      });

      expect(
        screen.queryAllByTestId("status-page-resource-navigator-actions")
          .length,
      ).toBe(0);
    });

    /*
     * The navigator is how a read only viewer gets around the status page, so
     * losing the actions must not lose the hierarchy or the ability to select.
     */
    test("a read only viewer still sees the whole hierarchy and can select", () => {
      const onSelect: (selection: StatusPageResourceSelection) => void =
        jest.fn();

      renderNavigator({
        isCreateable: false,
        isEditable: false,
        isDeleteable: false,
        onSelect: onSelect,
      });

      expect(rowNames().length).toBe(5);

      fireEvent.click(
        within(rowFor("Market 1001")).getByTestId(
          "status-page-resource-navigator-select",
        ),
      );

      expect(onSelect).toHaveBeenCalled();
    });
  });

  describe("a row whose write is in flight", () => {
    const busyProps: Partial<
      React.ComponentProps<typeof ResourceGroupNavigator>
    > = {
      busyGroupId: REGION_ONE.toString(),
      onAddSubGroup: jest.fn(),
      onEditGroup: jest.fn(),
      onMoveGroupUp: jest.fn(),
      onMoveGroupDown: jest.fn(),
      onDeleteGroup: jest.fn(),
      onShowGroupId: jest.fn(),
    };

    /*
     * The server renumbers a group's siblings on every reorder, so two writes
     * in flight at once resolve against a hierarchy neither of them saw.
     */
    test("says so, and refuses further actions", () => {
      renderNavigator(busyProps);

      expect(rowFor("Region 1000")).toHaveAttribute("aria-busy", "true");
      expect(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-resource-navigator-add-sub-group",
        ),
      ).toBeDisabled();
      expect(
        within(rowFor("Region 1000")).getByTestId(
          "status-page-resource-navigator-more",
        ),
      ).toBeDisabled();
    });

    test("leaves every other row alone", () => {
      renderNavigator(busyProps);

      expect(rowFor("Region 2000")).not.toHaveAttribute("aria-busy");
      expect(
        within(rowFor("Region 2000")).getByTestId(
          "status-page-resource-navigator-more",
        ),
      ).not.toBeDisabled();
    });

    test("no row is busy when nothing is in flight", () => {
      renderNavigator({ busyGroupId: null });

      for (const row of screen.getAllByTestId(
        "status-page-resource-navigator-row",
      )) {
        expect(row).not.toHaveAttribute("aria-busy");
      }
    });
  });

  describe("search results and their context", () => {
    /*
     * A row that is only on screen to give a match its place in the hierarchy
     * is context, not a result, and is drawn quieter.
     */
    test("rows that are only context are drawn quieter than the matches", () => {
      renderNavigator({
        rows: makeRows({ searchText: "Market 1001" }),
        searchText: "Market 1001",
      });

      const match: HTMLElement = within(rowFor("Market 1001")).getByTestId(
        "status-page-resource-navigator-name",
      );
      const context: HTMLElement = within(rowFor("Corporate")).getByTestId(
        "status-page-resource-navigator-name",
      );

      expect(match.className).not.toContain("text-gray-400");
      expect(context.className).toContain("text-gray-400");
    });

    test("with no search running, every row is drawn as itself", () => {
      renderNavigator();

      for (const name of screen.getAllByTestId(
        "status-page-resource-navigator-name",
      )) {
        expect(name.className).not.toContain("text-gray-400");
      }
    });
  });

  describe("a grid group", () => {
    /*
     * A grid group lays its resources out as a matrix, which is the difference
     * between "add a monitor" and "add a monitor to a cell". The row says so
     * before it is selected.
     */
    test("is marked as one, and a list group is not", () => {
      const groups: Array<StatusPageGroup> = [
        makeGroup({
          id: CORPORATE,
          name: "Matrix",
          order: 1,
          viewMode: StatusPageGroupViewMode.Grid,
        }),
        makeGroup({ id: REGION_TWO, name: "Plain", order: 2 }),
      ];

      renderNavigator({ rows: makeRows({ statusPageGroups: groups }) });

      expect(rowFor("Matrix")).toHaveAttribute(
        "data-view-mode",
        StatusPageGroupViewMode.Grid,
      );
      expect(rowFor("Plain")).toHaveAttribute(
        "data-view-mode",
        StatusPageGroupViewMode.List,
      );
    });
  });
});
