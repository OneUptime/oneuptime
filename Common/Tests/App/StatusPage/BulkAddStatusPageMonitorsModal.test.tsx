import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const MONITOR_ONE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161010";
const MONITOR_TWO_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161011";

jest.mock("Common/UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      isMultiSelect?: boolean;
      error?: string;
      onChange?: (value: Array<string>) => void;
    }) => {
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              props.onChange?.([MONITOR_TWO_ID, MONITOR_ONE_ID]);
            }}
          >
            {props.isMultiSelect ? "Select two monitors" : "Select one monitor"}
          </button>
          {props.error ? <p>{props.error}</p> : null}
        </div>
      );
    },
  };
});

jest.mock("Common/UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 1,
    default: (props: {
      placeholder?: string;
      error?: string;
      options: Array<{ value: string }>;
      onChange?: (value: string) => void;
    }) => {
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              props.onChange?.(props.options[0]!.value);
            }}
          >
            Choose {props.placeholder}
          </button>
          {props.error ? <p>{props.error}</p> : null}
        </div>
      );
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitors",
  () => {
    return {
      __esModule: true,
      default: jest.fn(),
    };
  },
);

import bulkAddStatusPageMonitors, {
  BulkAddStatusPageMonitorsOptions,
  BulkAddStatusPageMonitorsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitors";
import BulkAddStatusPageMonitorsModal from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorsModal";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161002",
);
const GROUP_ID: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-384194161003");

const mockBulkAdd: jest.MockedFunction<typeof bulkAddStatusPageMonitors> =
  bulkAddStatusPageMonitors as jest.MockedFunction<
    typeof bulkAddStatusPageMonitors
  >;

const mockGetList: jest.MockedFunction<any> =
  ModelAPI.getList as unknown as jest.MockedFunction<any>;

type MakeMonitorFunction = (
  id: string,
  name: string,
  description: string,
) => Monitor;

const makeMonitor: MakeMonitorFunction = (
  id: string,
  name: string,
  description: string,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.name = name;
  monitor.description = description;
  return monitor;
};

type MakeResourceFunction = (monitorId: string) => StatusPageResource;

const makeResource: MakeResourceFunction = (
  monitorId: string,
): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = `resource-for-${monitorId}`;
  resource.monitorId = new ObjectID(monitorId);
  return resource;
};

/*
 * The modal reads the monitors it was handed and, separately, the resources
 * the status page already has - so the list mock answers by model.
 */
type MockListsFunction = (
  existingResources?: Array<StatusPageResource>,
) => void;

const mockLists: MockListsFunction = (
  existingResources: Array<StatusPageResource> = [],
): void => {
  mockGetList.mockImplementation(async (data: any): Promise<any> => {
    if (data.modelType === StatusPageResource) {
      return { data: existingResources, count: existingResources.length };
    }

    return {
      data: [
        makeMonitor(MONITOR_ONE_ID, "Checkout API", "Takes payments"),
        makeMonitor(MONITOR_TWO_ID, "Billing Worker", "Sends invoices"),
      ],
      count: 2,
    };
  });
};

type RenderModalFunction = (
  overrides?: Partial<
    React.ComponentProps<typeof BulkAddStatusPageMonitorsModal>
  >,
) => ReturnType<typeof render>;

const renderModal: RenderModalFunction = (
  overrides: Partial<
    React.ComponentProps<typeof BulkAddStatusPageMonitorsModal>
  > = {},
): ReturnType<typeof render> => {
  return render(
    <BulkAddStatusPageMonitorsModal
      projectId={PROJECT_ID}
      statusPageId={STATUS_PAGE_ID}
      statusPageGroupId={GROUP_ID}
      onClose={jest.fn()}
      onComplete={jest.fn()}
      {...overrides}
    />,
  );
};

type GoToLastStepFunction = (view: ReturnType<typeof render>) => Promise<void>;

// The form has the same "Monitor Details" then "Advanced" steps as the single resource form.
const goToLastStep: GoToLastStepFunction = async (
  view: ReturnType<typeof render>,
): Promise<void> => {
  fireEvent.click(view.getByTestId("modal-footer-submit-button"));

  await waitFor(() => {
    expect(view.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Add Monitors",
    );
  });
};

describe("BulkAddStatusPageMonitorsModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockLists();

    mockBulkAdd.mockImplementation(
      async (
        options: BulkAddStatusPageMonitorsOptions,
      ): Promise<BulkAddStatusPageMonitorsResult> => {
        return { succeeded: options.monitors, failed: [], skipped: [] };
      },
    );
  });

  test("asks for monitors and the resource options, but never a display name", () => {
    const view: ReturnType<typeof render> = renderModal();

    expect(view.getByText("Monitors")).toBeVisible();
    expect(view.getByText("Monitor Details")).toBeVisible();
    expect(view.getByText("Advanced")).toBeVisible();
    expect(view.queryByText("Display Name")).not.toBeInTheDocument();
    expect(view.queryByText("Description")).not.toBeInTheDocument();
  });

  test("requires at least one monitor before the bulk add runs", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(view.getByText("Monitors is required.")).toBeVisible();
    });

    expect(mockBulkAdd).not.toHaveBeenCalled();
  });

  test("adds the selected monitors with the shared resource options", async () => {
    const onComplete: (result: BulkAddStatusPageMonitorsResult) => void =
      jest.fn((_result: BulkAddStatusPageMonitorsResult): void => {});
    const view: ReturnType<typeof render> = renderModal({ onComplete });

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    const options: BulkAddStatusPageMonitorsOptions =
      mockBulkAdd.mock.calls[0]![0];
    expect(options.projectId).toBe(PROJECT_ID);
    expect(options.statusPageId).toBe(STATUS_PAGE_ID);
    expect(options.statusPageGroupId).toBe(GROUP_ID);

    // Monitors are added in the order they were picked, not the order they were fetched in.
    expect(
      options.monitors.map((monitor: Monitor) => {
        return monitor.name;
      }),
    ).toEqual(["Billing Worker", "Checkout API"]);

    expect(options.resourceOptions).toEqual({
      displayTooltip: undefined,
      showCurrentStatus: true,
      showUptimePercent: false,
      uptimePercentPrecision: undefined,
      showStatusHistoryChart: true,
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(view.getByText("Added 2 of 2 selected monitors.")).toBeVisible();
    });
  });

  test("requires and submits a shared grid placement", async () => {
    const view: ReturnType<typeof render> = renderModal({
      gridPlacement: {
        rowLabel: "Environment",
        rowValues: ["Production", "Staging"],
        columnLabel: "Region",
        columnValues: ["US East", "EU West"],
      },
    });

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(view.getByText("Environment (Row) is required.")).toBeVisible();
    });
    expect(view.getByText("Region (Column) is required.")).toBeVisible();

    fireEvent.click(
      view.getByRole("button", { name: "Choose Select environment" }),
    );
    fireEvent.click(view.getByRole("button", { name: "Choose Select region" }));

    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    const options: BulkAddStatusPageMonitorsOptions =
      mockBulkAdd.mock.calls[0]![0];
    expect(options.rowAxisValue).toBe("Production");
    expect(options.columnAxisValue).toBe("US East");
  });

  /*
   * Issue #3420: picking monitors by label re-selects every monitor carrying
   * that label, the ones already on the page included. The modal has to tell
   * the add which monitors are already there, or each of them gets a second
   * resource and the public page lists it twice.
   */
  test("hands the status page's existing monitors to the bulk add", async () => {
    mockLists([makeResource(MONITOR_ONE_ID)]);

    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    const options: BulkAddStatusPageMonitorsOptions =
      mockBulkAdd.mock.calls[0]![0];
    expect(options.existingMonitorIds).toEqual([MONITOR_ONE_ID]);
  });

  test("reads the whole status page, not only the group being added to", async () => {
    mockLists([makeResource(MONITOR_ONE_ID)]);

    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    const resourceListCall: any = mockGetList.mock.calls.find((call: any) => {
      return call[0].modelType === StatusPageResource;
    });

    expect(resourceListCall).toBeDefined();
    expect(resourceListCall[0].query).toEqual({
      statusPageId: STATUS_PAGE_ID,
      projectId: PROJECT_ID,
    });
    expect(resourceListCall[0].query.statusPageGroupId).toBeUndefined();
    expect(resourceListCall[0].select).toMatchObject({ monitorId: true });
  });

  test("passes no existing monitors when the status page has none", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    expect(mockBulkAdd.mock.calls[0]![0].existingMonitorIds).toEqual([]);
  });

  test("ignores resources that point at a monitor group rather than a monitor", async () => {
    const monitorGroupResource: StatusPageResource = new StatusPageResource();
    monitorGroupResource._id = "resource-for-a-monitor-group";

    mockLists([monitorGroupResource, makeResource(MONITOR_TWO_ID)]);

    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    expect(mockBulkAdd.mock.calls[0]![0].existingMonitorIds).toEqual([
      MONITOR_TWO_ID,
    ]);
  });

  test("lists the monitors that were already on the page instead of failing them", async () => {
    mockBulkAdd.mockImplementationOnce(
      async (
        options: BulkAddStatusPageMonitorsOptions,
      ): Promise<BulkAddStatusPageMonitorsResult> => {
        return {
          succeeded: [options.monitors[0]!],
          failed: [],
          skipped: [options.monitors[1]!],
        };
      },
    );

    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(
        view.getByText(
          "Added 1 of 2 selected monitors. 1 monitor was already on this status page and was skipped.",
        ),
      ).toBeVisible();
    });

    // Skipped monitors are not an error, so the summary is the "Monitors Added" one.
    expect(view.getByText("Monitors Added")).toBeVisible();
    expect(view.getByText("Added (1)")).toBeVisible();
    expect(view.getByText("Already Added (1)")).toBeVisible();
    expect(view.queryByText(/^Failed/)).not.toBeInTheDocument();
  });

  test("says nothing was added when every selected monitor is already on the page", async () => {
    mockBulkAdd.mockImplementationOnce(
      async (
        options: BulkAddStatusPageMonitorsOptions,
      ): Promise<BulkAddStatusPageMonitorsResult> => {
        return {
          succeeded: [],
          failed: [],
          skipped: options.monitors,
        };
      },
    );

    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(
        view.getByText(
          "Added 0 of 2 selected monitors. 2 monitors were already on this status page and were skipped.",
        ),
      ).toBeVisible();
    });

    expect(view.queryByText(/^Added \(/)).not.toBeInTheDocument();
    expect(view.getByText("Already Added (2)")).toBeVisible();
    expect(view.getByText("Billing Worker")).toBeVisible();
    expect(view.getByText("Checkout API")).toBeVisible();
  });

  test("counts skipped, added and failed monitors in one summary", async () => {
    mockBulkAdd.mockImplementationOnce(
      async (
        options: BulkAddStatusPageMonitorsOptions,
      ): Promise<BulkAddStatusPageMonitorsResult> => {
        return {
          succeeded: [options.monitors[0]!],
          failed: [
            {
              monitor: options.monitors[1]!,
              error: new Error("Permission denied"),
            },
          ],
          skipped: [makeMonitor(MONITOR_ONE_ID, "Legacy API", "Already there")],
        };
      },
    );

    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(
        view.getByText(
          "Added 1 of 3 selected monitors. 1 monitor was already on this status page and was skipped.",
        ),
      ).toBeVisible();
    });

    expect(view.getByText("Monitor Add Results")).toBeVisible();
    expect(view.getByText("Added (1)")).toBeVisible();
    expect(view.getByText("Already Added (1)")).toBeVisible();
    expect(view.getByText("Failed (1)")).toBeVisible();
  });

  test("surfaces a failure to read the status page's existing resources", async () => {
    mockGetList.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === StatusPageResource) {
        throw new Error("Cannot read status page resources");
      }

      return {
        data: [makeMonitor(MONITOR_ONE_ID, "Checkout API", "Takes payments")],
        count: 1,
      };
    });

    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(view.getByText("Cannot read status page resources")).toBeVisible();
    });

    // Nothing is written when we cannot tell what is already there.
    expect(mockBulkAdd).not.toHaveBeenCalled();
  });

  test("shows a non-retryable completion summary for partial failures", async () => {
    mockBulkAdd.mockImplementationOnce(
      async (
        options: BulkAddStatusPageMonitorsOptions,
      ): Promise<BulkAddStatusPageMonitorsResult> => {
        return {
          succeeded: [options.monitors[0]!],
          failed: [
            {
              monitor: options.monitors[1]!,
              error: new Error("Permission denied"),
            },
          ],
          skipped: [],
        };
      },
    );
    const onClose: () => void = jest.fn((): void => {});
    const view: ReturnType<typeof render> = renderModal({ onClose });

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(view.getByText("Added 1 of 2 selected monitors.")).toBeVisible();
    });

    expect(view.getByText("Added (1)")).toBeVisible();
    expect(view.getByText("Failed (1)")).toBeVisible();
    expect(view.getByText("Billing Worker")).toBeVisible();
    expect(view.getByText(/Checkout API:/)).toBeVisible();
    expect(view.getByText("Permission denied")).toBeVisible();
    expect(view.queryByText("Select two monitors")).not.toBeInTheDocument();

    fireEvent.click(view.getByTestId("modal-footer-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockBulkAdd).toHaveBeenCalledTimes(1);
  });
});
