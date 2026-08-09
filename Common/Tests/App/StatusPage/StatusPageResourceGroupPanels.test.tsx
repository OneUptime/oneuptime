import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test - what an open group in the Resources tab actually
 * contains.
 *
 * A group is opened to do one thing: put monitors into it. Both panels
 * therefore have to offer that without the operator hunting for it, and the
 * grid has to offer it per cell - a grid group exists precisely so that
 * "add this monitor at Auth x US-East" is one click rather than a form with
 * two dropdowns to fill in by hand.
 *
 * The other half is the same request-counting invariant the tree has (issue
 * #3042): a panel fetches its own group and nothing else, and it only fetches
 * because it was mounted, which only happens because its row was opened.
 */

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164001";
const STATUS_PAGE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164002";
const GROUP_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164003";

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("Common/UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      id: string;
      query: Record<string, unknown>;
      isCreateable?: boolean;
      filters?: Array<unknown>;
      cardProps?: { title?: string; buttons?: Array<{ title: string }> };
      saveFilterProps?: { tableId: string };
      onFetchSuccess?: (data: Array<unknown>, totalCount: number) => void;
      onFilterApplied?: (isFilterApplied: boolean) => void;
    }) => {
      return React.createElement(
        "div",
        {
          "data-testid": "mounted-model-table",
          "data-table-id": props.id,
          "data-group-id": String(props.query["statusPageGroupId"]),
          "data-createable": String(Boolean(props.isCreateable)),
          "data-filter-count": String((props.filters || []).length),
          "data-has-card": String(Boolean(props.cardProps)),
          "data-card-title": String(props.cardProps?.title ?? ""),
          "data-saved-views-id": String(props.saveFilterProps?.tableId ?? ""),
          "data-card-buttons": (props.cardProps?.buttons || [])
            .map((button: { title: string }) => {
              return button.title;
            })
            .join(","),
        },
        [
          React.createElement(
            "button",
            {
              key: "fetch",
              type: "button",
              "data-testid": "simulate-table-fetch",
              onClick: () => {
                props.onFetchSuccess?.([], 7);
              },
            },
            "fetch",
          ),
          React.createElement(
            "button",
            {
              key: "filter",
              type: "button",
              "data-testid": "simulate-filter-applied",
              onClick: () => {
                props.onFilterApplied?.(true);
              },
            },
            "filter",
          ),
        ],
      );
    },
  };
});

/*
 * The create modal is stubbed down to the one thing worth asserting: which
 * cell the operator clicked, carried through as the form's initial values.
 * Rendering the real ModelForm would drag in every dropdown on the resource
 * form and assert nothing extra.
 */
jest.mock("Common/UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      initialValues?: Record<string, unknown> | undefined;
    }) => {
      return React.createElement(
        "div",
        {
          "data-testid": "model-form-modal",
          "data-row": String(props.initialValues?.["rowAxisValue"] ?? ""),
          "data-column": String(props.initialValues?.["columnAxisValue"] ?? ""),
        },
        props.title,
      );
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      deleteItem: jest.fn(),
    },
  };
});

import GridResourceEditor from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/GridResourceEditor";
import StatusPageResourceListPanel from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourceListPanel";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const mockGetList: jest.MockedFunction<any> =
  ModelAPI.getList as unknown as jest.MockedFunction<any>;

type FlushEffectsFunction = () => Promise<void>;

const flushEffects: FlushEffectsFunction = async (): Promise<void> => {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

type MakeGridGroupFunction = (data?: {
  rowAxisValues?: string | undefined;
  columnAxisValues?: string | undefined;
}) => StatusPageGroup;

const makeGridGroup: MakeGridGroupFunction = (
  data: {
    rowAxisValues?: string | undefined;
    columnAxisValues?: string | undefined;
  } = {},
): StatusPageGroup => {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = GROUP_ID;
  group.name = "Grid Group";
  group.viewMode = StatusPageGroupViewMode.Grid;
  group.rowAxisLabel = "Service";
  group.columnAxisLabel = "Region";
  group.rowAxisValues =
    data.rowAxisValues === undefined ? "Auth, API" : data.rowAxisValues;
  group.columnAxisValues =
    data.columnAxisValues === undefined
      ? "US-East, EU-West"
      : data.columnAxisValues;

  return group;
};

interface RenderGridOptions {
  group?: StatusPageGroup | undefined;
  resources?: Array<StatusPageResource> | undefined;
  canCreateStatusPageResource?: boolean | undefined;
  onResourceCountLoaded?: ((count: number) => void) | undefined;
}

type RenderGridFunction = (data?: RenderGridOptions) => Promise<void>;

const renderGrid: RenderGridFunction = async (
  data: RenderGridOptions = {},
): Promise<void> => {
  const resources: Array<StatusPageResource> = data.resources || [];

  mockGetList.mockImplementation(async (): Promise<any> => {
    return {
      data: resources,
      count: resources.length,
      skip: 0,
      limit: resources.length,
    };
  });

  render(
    <GridResourceEditor
      group={data.group || makeGridGroup()}
      statusPageId={new ObjectID(STATUS_PAGE_ID)}
      projectId={new ObjectID(PROJECT_ID)}
      canCreateStatusPageResource={
        data.canCreateStatusPageResource === undefined
          ? true
          : data.canCreateStatusPageResource
      }
      baseFormFields={[]}
      formSteps={[{ title: "Monitor Details", id: "monitor-details" }]}
      onResourceCountLoaded={data.onResourceCountLoaded}
    />,
  );

  await flushEffects();
};

describe("An open group in the Resources tab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  describe("a list group", () => {
    type RenderPanelFunction = (
      overrides?: Partial<
        React.ComponentProps<typeof StatusPageResourceListPanel>
      >,
    ) => void;

    const renderPanel: RenderPanelFunction = (
      overrides: Partial<
        React.ComponentProps<typeof StatusPageResourceListPanel>
      > = {},
    ): void => {
      render(
        <StatusPageResourceListPanel
          statusPageId={new ObjectID(STATUS_PAGE_ID)}
          projectId={new ObjectID(PROJECT_ID)}
          statusPageGroupId={new ObjectID(GROUP_ID)}
          panelKey={GROUP_ID}
          title="Region 1000"
          canCreateStatusPageResource={true}
          isMonitorGroupsFeatureEnabled={false}
          formFields={[]}
          formSteps={[]}
          {...overrides}
        />,
      );
    };

    type TableFunction = () => HTMLElement;

    const table: TableFunction = (): HTMLElement => {
      return screen.getByTestId("mounted-model-table");
    };

    test("scopes its table to its own group and nothing else", () => {
      renderPanel();

      expect(table()).toHaveAttribute("data-group-id", GROUP_ID);
    });

    /*
     * Two groups can be open at once, and a table's DOM id is also its drag and
     * drop scope - two tables sharing one would let a row dragged in one group
     * reorder a row in the other.
     */
    test("its table id is unique to the group", () => {
      renderPanel();

      expect(table()).toHaveAttribute(
        "data-table-id",
        `status-page-resources-${GROUP_ID}`,
      );
    });

    /*
     * The ungrouped bucket is `statusPageGroupId IS NULL`, not "no filter" -
     * without it the bucket would list every resource on the status page.
     */
    test("the ungrouped bucket asks for the resources with no group", () => {
      renderPanel({ statusPageGroupId: undefined, panelKey: "ungrouped" });

      expect(table()).toHaveAttribute("data-group-id", "null");
    });

    /*
     * Everything below is the chrome that only exists when the table keeps its
     * Card - create, filter, column customisation and saved views all live in
     * that Card's header. Dropping the Card to make the panel look tidier
     * inside a tree row would silently take all four away, which is a bigger
     * regression than the nesting it avoids.
     */
    test("keeps the Card its table's controls live in", () => {
      renderPanel();

      expect(table()).toHaveAttribute("data-has-card", "true");
      expect(table()).toHaveAttribute("data-card-title", "Region 1000");
    });

    test("keeps the built in create flow", () => {
      renderPanel();

      expect(table()).toHaveAttribute("data-createable", "true");
    });

    test("keeps the resource filters", () => {
      renderPanel();

      expect(table()).toHaveAttribute("data-filter-count", "2");
    });

    /*
     * Saved views are stored server side against this id. Changing or dropping
     * it orphans every view an operator already saved.
     */
    test("keeps the saved view id the old page used", () => {
      renderPanel();

      expect(table()).toHaveAttribute(
        "data-saved-views-id",
        `status-page-resources-table-${GROUP_ID}`,
      );
    });

    test("offers the bulk add flow next to the table's own create button", () => {
      renderPanel();

      expect(table()).toHaveAttribute(
        "data-card-buttons",
        "Add Multiple Monitors",
      );
    });

    test("hides bulk add from someone who cannot create resources", () => {
      renderPanel({ canCreateStatusPageResource: false });

      expect(table()).toHaveAttribute("data-card-buttons", "");
    });

    /*
     * How the tree's counts stay honest without re-reading every resource on
     * the status page: every write path through this table ends in a refetch,
     * and the refetch reports the group's new size.
     */
    test("reports its group's size on every fetch", () => {
      const onResourceCountLoaded: jest.Mock<any, any> = jest.fn() as jest.Mock<
        any,
        any
      >;

      renderPanel({ onResourceCountLoaded: onResourceCountLoaded });

      fireEvent.click(screen.getByTestId("simulate-table-fetch"));

      expect(onResourceCountLoaded).toHaveBeenCalledWith(7);
    });

    /*
     * A filtered table fetches a subset, so the number it reports is the size
     * of the subset. Forwarding that would make the tree row above say the
     * group holds one resource because the operator narrowed the table to one.
     */
    test("does not report a filtered table's count as the group's size", () => {
      const onResourceCountLoaded: jest.Mock<any, any> = jest.fn() as jest.Mock<
        any,
        any
      >;

      renderPanel({ onResourceCountLoaded: onResourceCountLoaded });

      fireEvent.click(screen.getByTestId("simulate-filter-applied"));
      fireEvent.click(screen.getByTestId("simulate-table-fetch"));

      expect(onResourceCountLoaded).not.toHaveBeenCalled();
    });
  });

  describe("a grid group", () => {
    test("draws a column per column axis value and a row per row axis value", async () => {
      await renderGrid();

      expect(screen.getByText("Auth")).toBeInTheDocument();
      expect(screen.getByText("API")).toBeInTheDocument();
      expect(screen.getByText("US-East")).toBeInTheDocument();
      expect(screen.getByText("EU-West")).toBeInTheDocument();
    });

    test("every cell of the matrix is a place to add a monitor", async () => {
      await renderGrid();

      expect(screen.getAllByTestId("grid-cell-add-monitor")).toHaveLength(4);
    });

    /*
     * The point of a grid group. Clicking the Auth x EU-West cell has to open a
     * form that already knows it is the Auth x EU-West cell - otherwise the
     * grid is decoration and the operator still fills two dropdowns in by hand.
     */
    test("clicking a cell opens a form already placed at that cell", async () => {
      await renderGrid();

      const cells: Array<HTMLElement> = screen.getAllByTestId(
        "grid-cell-add-monitor",
      );

      /* Row order is Auth then API; column order is US-East then EU-West. */
      fireEvent.click(cells[1]!);

      await waitFor(() => {
        expect(screen.getByTestId("model-form-modal")).toBeInTheDocument();
      });

      expect(screen.getByTestId("model-form-modal")).toHaveAttribute(
        "data-row",
        "Auth",
      );
      expect(screen.getByTestId("model-form-modal")).toHaveAttribute(
        "data-column",
        "EU-West",
      );
    });

    test("each cell names the intersection it adds to, for screen readers", async () => {
      await renderGrid();

      expect(
        screen.getByLabelText("Add monitor to API and US-East"),
      ).toBeInTheDocument();
    });

    test("the toolbar's Add Monitor opens a form with no cell chosen", async () => {
      await renderGrid();

      fireEvent.click(screen.getByTestId("add-resource-to-grid"));

      await waitFor(() => {
        expect(screen.getByTestId("model-form-modal")).toBeInTheDocument();
      });

      expect(screen.getByTestId("model-form-modal")).toHaveAttribute(
        "data-row",
        "",
      );
    });

    test("puts each resource in the cell it belongs to", async () => {
      const resource: StatusPageResource = new StatusPageResource();
      resource._id = "0198c8ec-2a1d-7f0c-9e75-384194164009";
      resource.displayName = "Auth in EU";
      resource.rowAxisValue = "Auth";
      resource.columnAxisValue = "EU-West";

      await renderGrid({ resources: [resource] });

      expect(screen.getByText("Auth in EU")).toBeInTheDocument();
      expect(screen.getAllByTestId("grid-resource-cell-item")).toHaveLength(1);
    });

    /*
     * Axis values are free text and a group's axes can be edited after its
     * resources were placed, so a resource can end up pointing at a row or
     * column that no longer exists. Dropping it silently would lose a monitor
     * off the status page with nothing to say where it went.
     */
    test("a resource whose cell no longer exists is surfaced, not dropped", async () => {
      const resource: StatusPageResource = new StatusPageResource();
      resource._id = "0198c8ec-2a1d-7f0c-9e75-384194164010";
      resource.displayName = "Stale placement";
      resource.rowAxisValue = "Auth";
      resource.columnAxisValue = "Antarctica";

      await renderGrid({ resources: [resource] });

      expect(screen.getByText("Unassigned resources (1)")).toBeInTheDocument();
      expect(screen.getByText("Stale placement")).toBeInTheDocument();
    });

    test("a group with no axes yet says so instead of drawing an empty matrix", async () => {
      await renderGrid({
        group: makeGridGroup({ rowAxisValues: "", columnAxisValues: "" }),
      });

      expect(screen.queryAllByTestId("grid-cell-add-monitor")).toHaveLength(0);
      expect(
        screen.getByText(/before adding resources to the grid/),
      ).toBeInTheDocument();
    });

    test("hides its add buttons from someone who cannot create resources", async () => {
      await renderGrid({ canCreateStatusPageResource: false });

      expect(
        screen.queryByTestId("add-resource-to-grid"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("bulk-add-resources-to-grid"),
      ).not.toBeInTheDocument();
    });

    test("fetches only its own group's resources", async () => {
      await renderGrid();

      expect(mockGetList).toHaveBeenCalledTimes(1);
      expect(
        mockGetList.mock.calls[0]![0].query.statusPageGroupId.toString(),
      ).toBe(GROUP_ID);
    });

    /*
     * Same contract the list panel has: the group reports its own size so the
     * tree's collapsed row can say "3 resources" without the page re-reading
     * every resource on the status page.
     */
    test("reports its group's size once it has loaded", async () => {
      const onResourceCountLoaded: jest.Mock<any, any> = jest.fn() as jest.Mock<
        any,
        any
      >;

      const first: StatusPageResource = new StatusPageResource();
      first._id = "0198c8ec-2a1d-7f0c-9e75-384194164011";
      first.rowAxisValue = "Auth";
      first.columnAxisValue = "US-East";

      const second: StatusPageResource = new StatusPageResource();
      second._id = "0198c8ec-2a1d-7f0c-9e75-384194164012";
      second.rowAxisValue = "API";
      second.columnAxisValue = "EU-West";

      await renderGrid({
        resources: [first, second],
        onResourceCountLoaded: onResourceCountLoaded,
      });

      expect(onResourceCountLoaded).toHaveBeenCalledWith(2);
    });
  });
});
