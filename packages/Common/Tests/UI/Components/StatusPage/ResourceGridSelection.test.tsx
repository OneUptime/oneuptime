import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import ResourceGrid from "../../../../UI/Components/StatusPage/ResourceGrid";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test - the checkbox on a grid group's resource chips.
 *
 * A grid group is the same resources as a list group in a different
 * arrangement, and clearing twenty seven of them one at a time is no better
 * here than it is there (issue #3419). So the chips carry the same box the list
 * rows do, the resources that fell off the grid carry it too - they are the ones
 * most likely to be cleared out en masse - and the bulk bar that acts on the
 * selection is drawn once by the pane above, shared between the two layouts.
 */

type MakeResourceFunction = (data: {
  id?: string | undefined;
  monitorName: string;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}) => StatusPageResource;

const makeResource: MakeResourceFunction = (data: {
  id?: string | undefined;
  monitorName: string;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();

  if (data.id) {
    resource._id = data.id;
  }

  const monitor: Monitor = new Monitor();
  monitor._id = `monitor-${data.id || "none"}`;
  monitor.name = data.monitorName;
  resource.monitor = monitor;

  if (data.rowAxisValue) {
    resource.rowAxisValue = data.rowAxisValue;
  }

  if (data.columnAxisValue) {
    resource.columnAxisValue = data.columnAxisValue;
  }

  return resource;
};

const AUTH_US: StatusPageResource = makeResource({
  id: "resource-auth-us",
  monitorName: "Auth US",
  rowAxisValue: "Auth",
  columnAxisValue: "US-East",
});
const AUTH_EU: StatusPageResource = makeResource({
  id: "resource-auth-eu",
  monitorName: "Auth EU",
  rowAxisValue: "Auth",
  columnAxisValue: "EU-West",
});
/* Its row is not one this group defines, so it never reaches a cell. */
const STRANDED: StatusPageResource = makeResource({
  id: "resource-stranded",
  monitorName: "Stranded",
  rowAxisValue: "Renamed",
  columnAxisValue: "US-East",
});

const onToggleResourceSelected: jest.MockedFunction<any> = jest.fn();

interface RenderOptions {
  statusPageResources?: Array<StatusPageResource> | undefined;
  isSelectable?: boolean | undefined;
  selectedResourceIds?: Set<string> | undefined;
}

type RenderGridFunction = (
  options?: RenderOptions,
) => ReturnType<typeof render>;

const renderGrid: RenderGridFunction = (
  options: RenderOptions = {},
): ReturnType<typeof render> => {
  return render(
    <ResourceGrid
      rowLabel="Service"
      columnLabel="Region"
      rowValues={["Auth", "API"]}
      columnValues={["US-East", "EU-West"]}
      statusPageResources={
        options.statusPageResources || [AUTH_US, AUTH_EU, STRANDED]
      }
      getResourceElement={(
        statusPageResource: StatusPageResource,
      ): ReactElement => {
        return <span>{statusPageResource.monitor?.name || "Unknown"}</span>;
      }}
      isCreateable={true}
      isEditable={true}
      isDeleteable={true}
      isSelectable={
        options.isSelectable === undefined ? true : options.isSelectable
      }
      selectedResourceIds={options.selectedResourceIds || new Set<string>()}
      onToggleResourceSelected={onToggleResourceSelected}
      onAddToCell={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );
};

type ChipByNameFunction = (name: string) => HTMLElement;

const chipByName: ChipByNameFunction = (name: string): HTMLElement => {
  const chip: HTMLElement | undefined = [
    ...screen.queryAllByTestId("status-page-resource-grid-cell-item"),
    ...screen.queryAllByTestId("status-page-resource-grid-orphan"),
  ].find((candidate: HTMLElement) => {
    return (candidate.textContent || "").includes(name);
  });

  if (!chip) {
    throw new Error(`No chip called ${name} is on screen`);
  }

  return chip;
};

describe("ResourceGrid - selecting resources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("when the operator may remove resources", () => {
    test("every chip in a cell carries a box", () => {
      renderGrid();

      expect(
        within(chipByName("Auth US")).getByRole("checkbox"),
      ).toBeInTheDocument();
      expect(
        within(chipByName("Auth EU")).getByRole("checkbox"),
      ).toBeInTheDocument();
    });

    /*
     * The stranded resources are the ones an operator is most likely to want
     * gone in a single move: they are invisible to visitors and usually the
     * wake of an axis value that was renamed underneath them.
     */
    test("a resource that fell off the grid carries one too", () => {
      renderGrid();

      expect(
        screen.getByTestId("status-page-resource-grid-orphans"),
      ).toBeInTheDocument();
      expect(
        within(chipByName("Stranded")).getByRole("checkbox"),
      ).toBeInTheDocument();
    });

    test("a box is named after the monitor it selects", () => {
      renderGrid();

      expect(screen.getByLabelText("Select Auth US")).toBeInTheDocument();
      expect(screen.getByLabelText("Select Stranded")).toBeInTheDocument();
    });

    test("ticking a chip reports the resource it was drawn from", () => {
      renderGrid();

      fireEvent.click(within(chipByName("Auth EU")).getByRole("checkbox"));

      expect(onToggleResourceSelected).toHaveBeenCalledTimes(1);
      expect(onToggleResourceSelected.mock.calls[0]![0]).toBe(AUTH_EU);
    });

    test("ticking a stranded resource reports it as well", () => {
      renderGrid();

      fireEvent.click(within(chipByName("Stranded")).getByRole("checkbox"));

      expect(onToggleResourceSelected.mock.calls[0]![0]).toBe(STRANDED);
    });

    test("a selected chip is ticked, filled, and says so in the DOM", () => {
      renderGrid({
        selectedResourceIds: new Set<string>(["resource-auth-us"]),
      });

      expect(within(chipByName("Auth US")).getByRole("checkbox")).toBeChecked();
      expect(chipByName("Auth US")).toHaveAttribute("data-selected", "true");
      expect(chipByName("Auth US").className).toContain("bg-indigo-50");

      expect(
        within(chipByName("Auth EU")).getByRole("checkbox"),
      ).not.toBeChecked();
      expect(chipByName("Auth EU")).toHaveAttribute("data-selected", "false");
      expect(chipByName("Auth EU").className).toContain("bg-white");
    });

    test("a resource with no id cannot be ticked", () => {
      renderGrid({
        statusPageResources: [
          makeResource({
            monitorName: "Nameless",
            rowAxisValue: "Auth",
            columnAxisValue: "US-East",
          }),
        ],
      });

      expect(
        within(chipByName("Nameless")).getByRole("checkbox"),
      ).toBeDisabled();
    });

    /*
     * The boxes are not the only controls on a chip, and the ones that were
     * there before still have to work.
     */
    test("the per-chip edit and remove buttons are still there", () => {
      renderGrid();

      expect(
        within(chipByName("Auth US")).getByTestId(
          "status-page-resource-grid-edit",
        ),
      ).toBeInTheDocument();
      expect(
        within(chipByName("Auth US")).getByTestId(
          "status-page-resource-grid-delete",
        ),
      ).toBeInTheDocument();
    });

    test("a grid with no axes still draws nothing of its own", () => {
      render(
        <ResourceGrid
          rowLabel="Service"
          columnLabel="Region"
          rowValues={[]}
          columnValues={[]}
          statusPageResources={[AUTH_US]}
          getResourceElement={(): ReactElement => {
            return <span>Auth US</span>;
          }}
          isCreateable={true}
          isEditable={true}
          isDeleteable={true}
          isSelectable={true}
          selectedResourceIds={new Set<string>()}
          onToggleResourceSelected={onToggleResourceSelected}
          onAddToCell={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />,
      );

      expect(
        screen.getByTestId("status-page-resource-grid-no-axes"),
      ).toBeInTheDocument();
      expect(screen.queryAllByRole("checkbox").length).toBe(0);
    });
  });

  describe("when the operator may not remove resources", () => {
    test("there are no boxes anywhere on the grid", () => {
      renderGrid({ isSelectable: false });

      expect(screen.queryAllByRole("checkbox").length).toBe(0);
      expect(
        screen.queryAllByTestId("status-page-resource-grid-select").length,
      ).toBe(0);
    });

    test("no chip claims to be selected", () => {
      renderGrid({
        isSelectable: false,
        selectedResourceIds: new Set<string>(["resource-auth-us"]),
      });

      expect(chipByName("Auth US")).toHaveAttribute("data-selected", "false");
      expect(chipByName("Auth US").className).toContain("bg-white");
    });
  });
});
