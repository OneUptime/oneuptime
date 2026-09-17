import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import ResourceList from "../../../../UI/Components/StatusPage/ResourceList";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test - the checkbox column on a status page group's resource
 * list.
 *
 * A status page group holding twenty seven monitors could only be emptied one
 * monitor at a time: open a row's overflow menu, confirm, wait for the group to
 * reload, and start again on the next one (issue #3419). The list carries a box
 * per row and a box at the top of it now, and the pane above turns whatever is
 * ticked into one removal.
 *
 * The list itself holds no selection state - the pane does, because a selection
 * has to survive the refetch that follows every write. So everything here is
 * about what the list draws for a given selection and what it reports back, and
 * nothing here is about what the pane then does with it.
 */

type MakeResourceFunction = (data: {
  id?: string | undefined;
  monitorName?: string | undefined;
  displayName?: string | undefined;
}) => StatusPageResource;

const makeResource: MakeResourceFunction = (data: {
  id?: string | undefined;
  monitorName?: string | undefined;
  displayName?: string | undefined;
}): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();

  if (data.id) {
    resource._id = data.id;
  }

  if (data.monitorName) {
    const monitor: Monitor = new Monitor();
    monitor._id = `monitor-${data.id || "none"}`;
    monitor.name = data.monitorName;
    resource.monitor = monitor;
  }

  if (data.displayName) {
    resource.displayName = data.displayName;
  }

  return resource;
};

const API_RESOURCE: StatusPageResource = makeResource({
  id: "resource-api",
  monitorName: "API",
});
const DATABASE_RESOURCE: StatusPageResource = makeResource({
  id: "resource-database",
  monitorName: "Database",
});
const CACHE_RESOURCE: StatusPageResource = makeResource({
  id: "resource-cache",
  monitorName: "Cache",
});

const onToggleResourceSelected: jest.MockedFunction<any> = jest.fn();
const onToggleAllSelected: jest.MockedFunction<any> = jest.fn();
const onReorder: jest.MockedFunction<any> = jest.fn();
const onShowMore: jest.MockedFunction<any> = jest.fn();

interface RenderOptions {
  statusPageResources?: Array<StatusPageResource> | undefined;
  isSelectable?: boolean | undefined;
  selectedResourceIds?: Set<string> | undefined;
  isAllSelected?: boolean | undefined;
  isSelectionIndeterminate?: boolean | undefined;
  isReorderable?: boolean | undefined;
  visibleCount?: number | undefined;
}

type RenderListFunction = (
  options?: RenderOptions,
) => ReturnType<typeof render>;

const renderList: RenderListFunction = (
  options: RenderOptions = {},
): ReturnType<typeof render> => {
  return render(
    <ResourceList
      statusPageResources={
        options.statusPageResources || [
          API_RESOURCE,
          DATABASE_RESOURCE,
          CACHE_RESOURCE,
        ]
      }
      listKey="test"
      getResourceElement={(
        statusPageResource: StatusPageResource,
      ): ReactElement => {
        return <span>{statusPageResource.monitor?.name || "Unknown"}</span>;
      }}
      isEditable={true}
      isDeleteable={true}
      isReorderable={
        options.isReorderable === undefined ? false : options.isReorderable
      }
      isSelectable={
        options.isSelectable === undefined ? true : options.isSelectable
      }
      selectedResourceIds={options.selectedResourceIds || new Set<string>()}
      isAllSelected={Boolean(options.isAllSelected)}
      isSelectionIndeterminate={Boolean(options.isSelectionIndeterminate)}
      onToggleResourceSelected={onToggleResourceSelected}
      onToggleAllSelected={onToggleAllSelected}
      onEdit={() => {}}
      onDelete={() => {}}
      onShowId={() => {}}
      onReorder={onReorder}
      visibleCount={
        options.visibleCount === undefined ? 100 : options.visibleCount
      }
      onShowMore={onShowMore}
      emptyState={<div data-testid="empty-state">Nothing here</div>}
    />,
  );
};

type SelectAllBoxFunction = () => HTMLElement;

const selectAllBox: SelectAllBoxFunction = (): HTMLElement => {
  return screen.getByTestId("status-page-resource-list-select-all");
};

type RowByNameFunction = (name: string) => HTMLElement;

const rowByName: RowByNameFunction = (name: string): HTMLElement => {
  const row: HTMLElement | undefined = screen
    .queryAllByTestId("status-page-resource-row")
    .find((candidate: HTMLElement) => {
      return (candidate.textContent || "").includes(name);
    });

  if (!row) {
    throw new Error(`No row called ${name} is on screen`);
  }

  return row;
};

type RowBoxFunction = (name: string) => HTMLElement;

const rowBox: RowBoxFunction = (name: string): HTMLElement => {
  return within(rowByName(name)).getByRole("checkbox");
};

describe("ResourceList - selecting rows", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("when the operator may remove resources", () => {
    test("every row carries a box", () => {
      renderList();

      expect(
        screen.queryAllByTestId("status-page-resource-row-select").length,
      ).toBe(3);
    });

    /*
     * A bare box in a row is announced as "checkbox" and nothing else, so a
     * screen reader user hears the same word once per row with no way to tell
     * which row they are on.
     */
    test("a row's box is named after the monitor it selects", () => {
      renderList();

      expect(screen.getByLabelText("Select API")).toBeInTheDocument();
      expect(screen.getByLabelText("Select Database")).toBeInTheDocument();
    });

    test("the list is topped by a box that selects all of it", () => {
      renderList();

      expect(selectAllBox()).toBeInTheDocument();
      expect(screen.getByLabelText("Select all resources")).toBe(
        selectAllBox(),
      );
    });

    test("ticking a row reports that row, not its index", () => {
      renderList();

      fireEvent.click(rowBox("Database"));

      expect(onToggleResourceSelected).toHaveBeenCalledTimes(1);
      expect(onToggleResourceSelected.mock.calls[0]![0]).toBe(
        DATABASE_RESOURCE,
      );
    });

    test("un-ticking a selected row reports it too", () => {
      renderList({
        selectedResourceIds: new Set<string>(["resource-database"]),
      });

      fireEvent.click(rowBox("Database"));

      expect(onToggleResourceSelected.mock.calls[0]![0]).toBe(
        DATABASE_RESOURCE,
      );
    });

    test("a selected row is ticked and says so to anything reading the DOM", () => {
      renderList({ selectedResourceIds: new Set<string>(["resource-api"]) });

      expect(rowBox("API")).toBeChecked();
      expect(rowBox("Database")).not.toBeChecked();

      expect(rowByName("API")).toHaveAttribute("data-selected", "true");
      expect(rowByName("Database")).toHaveAttribute("data-selected", "false");
    });

    /*
     * A selection made near the top of a long list has to stay visible from the
     * bottom of it: the bulk bar says how many, and the fill says which.
     */
    test("a selected row is filled rather than left white", () => {
      renderList({ selectedResourceIds: new Set<string>(["resource-api"]) });

      expect(rowByName("API").className).toContain("bg-indigo-50");
      expect(rowByName("Database").className).toContain("bg-white");
    });

    test("the box at the top follows the state it is handed", () => {
      const { rerender } = renderList({ isAllSelected: true });

      expect(selectAllBox()).toBeChecked();

      rerender(
        <ResourceList
          statusPageResources={[API_RESOURCE]}
          listKey="test"
          getResourceElement={(): ReactElement => {
            return <span>API</span>;
          }}
          isEditable={true}
          isDeleteable={true}
          isReorderable={false}
          isSelectable={true}
          selectedResourceIds={new Set<string>()}
          isAllSelected={false}
          isSelectionIndeterminate={true}
          onToggleResourceSelected={onToggleResourceSelected}
          onToggleAllSelected={onToggleAllSelected}
          onEdit={() => {}}
          onDelete={() => {}}
          onShowId={() => {}}
          onReorder={onReorder}
          visibleCount={100}
          onShowMore={onShowMore}
          emptyState={<div />}
        />,
      );

      expect(selectAllBox()).not.toBeChecked();
      expect((selectAllBox() as HTMLInputElement).indeterminate).toBe(true);
    });

    test("ticking the box at the top asks for everything, un-ticking for nothing", () => {
      const { rerender } = renderList();

      fireEvent.click(selectAllBox());

      expect(onToggleAllSelected).toHaveBeenCalledTimes(1);
      expect(onToggleAllSelected.mock.calls[0]![0]).toBe(true);

      rerender(
        <ResourceList
          statusPageResources={[API_RESOURCE]}
          listKey="test"
          getResourceElement={(): ReactElement => {
            return <span>API</span>;
          }}
          isEditable={true}
          isDeleteable={true}
          isReorderable={false}
          isSelectable={true}
          selectedResourceIds={new Set<string>(["resource-api"])}
          isAllSelected={true}
          isSelectionIndeterminate={false}
          onToggleResourceSelected={onToggleResourceSelected}
          onToggleAllSelected={onToggleAllSelected}
          onEdit={() => {}}
          onDelete={() => {}}
          onShowId={() => {}}
          onReorder={onReorder}
          visibleCount={100}
          onShowMore={onShowMore}
          emptyState={<div />}
        />,
      );

      fireEvent.click(selectAllBox());

      expect(onToggleAllSelected).toHaveBeenCalledTimes(2);
      expect(onToggleAllSelected.mock.calls[1]![0]).toBe(false);
    });

    /*
     * The header row is the only place the select-all box can live, and below
     * sm it was hidden because it was labelling columns that are not drawn
     * there. A phone is exactly where removing twenty seven monitors one at a
     * time hurts most, so the row itself is drawn at every width and the column
     * headings are what is held back.
     */
    test("the header is drawn at every width once there is a box in it", () => {
      renderList();

      const header: HTMLElement = screen.getByTestId(
        "status-page-resource-list-header",
      );

      expect(header.className).toContain("flex");
      expect(header.className).not.toContain("hidden sm:flex");
      expect(within(header).getByText("Select all")).toBeInTheDocument();
    });

    /*
     * A focusable control inside an aria-hidden container is in the tab order
     * and out of the accessibility tree at the same time, which is worse than
     * not offering it at all.
     */
    test("the header does not hide its own checkbox from a screen reader", () => {
      renderList();

      expect(
        screen.getByTestId("status-page-resource-list-header"),
      ).not.toHaveAttribute("aria-hidden");
    });

    test("a row with no id cannot be ticked", () => {
      renderList({
        statusPageResources: [makeResource({ monitorName: "Orphan" })],
      });

      expect(rowBox("Orphan")).toBeDisabled();
    });

    /*
     * The box at the top means "everything this list was handed", and the rows
     * behind "Show more" were handed to it - they are simply not drawn yet. The
     * caller is the one that resolves that to ids, so all the list has to do is
     * ask once.
     */
    test("rows held back behind Show more still have a box waiting for them", () => {
      renderList({ visibleCount: 2 });

      expect(
        screen.queryAllByTestId("status-page-resource-row-select").length,
      ).toBe(2);

      fireEvent.click(selectAllBox());

      expect(onToggleAllSelected).toHaveBeenCalledTimes(1);
    });

    /*
     * The grip is the drag handle; the box is not. A list that can be both
     * reordered and selected has to keep the two apart, or every attempt to
     * tick a row starts a drag.
     */
    test("a reorderable list keeps its grip and its box apart", () => {
      renderList({ isReorderable: true });

      const row: HTMLElement = rowByName("API");

      expect(
        within(row).getByTestId("status-page-resource-row-drag-handle"),
      ).toBeInTheDocument();
      expect(within(row).getByRole("checkbox")).toBeInTheDocument();
    });

    test("an empty list is still the empty state, not a header over nothing", () => {
      renderList({ statusPageResources: [] });

      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
      expect(
        screen.queryByTestId("status-page-resource-list-select-all"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the operator may not remove resources", () => {
    /*
     * Removing is the only thing a selection is for here, so without it the
     * column would be a row of controls that lead nowhere - and it would cost
     * every row a slice of the width its monitor's name is drawn in.
     */
    test("there is no column of boxes at all", () => {
      renderList({ isSelectable: false });

      expect(
        screen.queryAllByTestId("status-page-resource-row-select").length,
      ).toBe(0);
      expect(screen.queryAllByRole("checkbox").length).toBe(0);
    });

    test("the header goes back to being column labels from sm up", () => {
      renderList({ isSelectable: false });

      const header: HTMLElement = screen.getByTestId(
        "status-page-resource-list-header",
      );

      expect(header.className).toContain("hidden");
      expect(header.className).toContain("sm:flex");
      expect(within(header).queryByText("Select all")).not.toBeInTheDocument();
    });

    test("no row claims to be selected", () => {
      renderList({
        isSelectable: false,
        /* Even handed a selection, which the pane would never do. */
        selectedResourceIds: new Set<string>(["resource-api"]),
      });

      expect(rowByName("API")).toHaveAttribute("data-selected", "false");
      expect(rowByName("API").className).toContain("bg-white");
    });
  });
});
