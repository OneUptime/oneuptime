import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const MONITOR_ONE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161010";
const MONITOR_TWO_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161011";
const LABEL_ONE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161020";
const LABEL_TWO_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161021";

/*
 * The picker, reduced to its two ways of filling the selection. "Bulk-add by
 * label" is the one that matters here: the real control expands a label into
 * the monitors carrying it and then discards the label, so onLabelsBulkAdded
 * is the only thing that tells the modal a selection came from a label at all.
 */
jest.mock("Common/UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      isMultiSelect?: boolean;
      error?: string;
      onChange?: (value: Array<string>) => void;
      onLabelsBulkAdded?: (labels: Array<{ id: string; name: string }>) => void;
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
          <button
            type="button"
            onClick={() => {
              props.onChange?.([MONITOR_TWO_ID, MONITOR_ONE_ID]);
              props.onLabelsBulkAdded?.([
                { id: LABEL_ONE_ID, name: "WB Digital" },
              ]);
            }}
          >
            Bulk-add by label
          </button>
          <button
            type="button"
            onClick={() => {
              props.onChange?.([MONITOR_TWO_ID, MONITOR_ONE_ID]);
              props.onLabelsBulkAdded?.([
                { id: LABEL_TWO_ID, name: "WB Digital Service" },
              ]);
            }}
          >
            Bulk-add by a second label
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
      create: jest.fn(),
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
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageMonitorRule from "../../../Models/DatabaseModels/StatusPageMonitorRule";
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

const mockCreate: jest.MockedFunction<any> =
  ModelAPI.create as unknown as jest.MockedFunction<any>;

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

const callOrder: Array<string> = [];

/** The StatusPageMonitorRule the modal asked ModelAPI to create, if any. */
type CreatedRuleFunction = () => StatusPageMonitorRule | null;

const createdRule: CreatedRuleFunction = (): StatusPageMonitorRule | null => {
  const call: any = mockCreate.mock.calls[0];

  return call ? (call[0].model as StatusPageMonitorRule) : null;
};

describe("BulkAddStatusPageMonitorsModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetList.mockImplementation(async (): Promise<any> => {
      return {
        data: [
          makeMonitor(MONITOR_ONE_ID, "Checkout API", "Takes payments"),
          makeMonitor(MONITOR_TWO_ID, "Billing Worker", "Sends invoices"),
        ],
        count: 2,
      };
    });

    callOrder.length = 0;

    mockBulkAdd.mockImplementation(
      async (
        options: BulkAddStatusPageMonitorsOptions,
      ): Promise<BulkAddStatusPageMonitorsResult> => {
        callOrder.push("bulkAdd");
        return { succeeded: options.monitors, failed: [] };
      },
    );

    mockCreate.mockImplementation(async (request: any): Promise<any> => {
      callOrder.push("create");
      return request?.model;
    });
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

/*
 * #3418. Filling a group from a label used to be a one-time expansion: the
 * label became a list of monitors, each became a resource, and the label was
 * thrown away - so a monitor given that label the next day landed on no page,
 * and with ten status pages that meant re-populating groups by hand daily.
 *
 * A StatusPageMonitorRule is the durable form of the same intent; the server
 * re-runs it on every monitor create and relabel. These tests drive the real
 * modal and assert on what it actually posts.
 */
describe("BulkAddStatusPageMonitorsModal - keeping a label-filled group filled", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    callOrder.length = 0;

    mockGetList.mockImplementation(async (): Promise<any> => {
      return {
        data: [
          makeMonitor(MONITOR_ONE_ID, "Checkout API", "Takes payments"),
          makeMonitor(MONITOR_TWO_ID, "Billing Worker", "Sends invoices"),
        ],
        count: 2,
      };
    });

    mockBulkAdd.mockImplementation(
      async (
        options: BulkAddStatusPageMonitorsOptions,
      ): Promise<BulkAddStatusPageMonitorsResult> => {
        callOrder.push("bulkAdd");
        return { succeeded: options.monitors, failed: [] };
      },
    );

    mockCreate.mockImplementation(async (request: any): Promise<any> => {
      callOrder.push("create");
      return request?.model;
    });
  });

  /*
   * The question only means something once a label has been used, so it is not
   * asked of somebody picking monitors one at a time.
   */
  test("does not ask about syncing until a label has been used", () => {
    const view: ReturnType<typeof render> = renderModal();

    expect(
      view.queryByText("Keep This Group In Sync With These Labels"),
    ).not.toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));

    expect(
      view.getByText("Keep This Group In Sync With These Labels"),
    ).toBeVisible();
  });

  test("writes no rule for monitors picked one at a time", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  /*
   * The headline. Before the fix nothing at all was written here, and the
   * label was gone the moment the dialog closed.
   */
  test("writes a rule for the label the group was filled from", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    const rule: StatusPageMonitorRule | null = createdRule();

    expect(rule?.statusPageId?.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(rule?.statusPageGroupId?.toString()).toBe(GROUP_ID.toString());
    expect(rule?.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(rule?.isEnabled).toBe(true);
    expect(
      (rule?.monitorLabels || []).map((label: Label) => {
        return label.id?.toString();
      }),
    ).toEqual([LABEL_ONE_ID]);
  });

  /*
   * name is a required, non-nullable column. A rule built without one is
   * rejected by the server, and the only symptom is the group quietly not
   * being kept in sync - the original bug, wearing a hat.
   */
  test("gives the rule every column the model requires", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    const rule: StatusPageMonitorRule = createdRule()!;

    for (const column of rule.getRequiredColumns().columns) {
      expect({
        column: column,
        value: (rule as unknown as Record<string, unknown>)[column],
      }).toEqual({ column: column, value: expect.anything() });
    }

    expect(rule.name).toBe("Label: WB Digital");
  });

  /*
   * The server's backfill skips monitors already on the page, so writing the
   * rule second is the only thing stopping every monitor this add just created
   * getting a second resource - and a public page listing each one twice.
   */
  test("writes the rule only after the resources exist", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    expect(callOrder).toEqual(["bulkAdd", "create"]);
  });

  test("carries every label when the picker was used twice", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));
    fireEvent.click(
      view.getByRole("button", { name: "Bulk-add by a second label" }),
    );
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    expect(
      (createdRule()?.monitorLabels || []).map((label: Label) => {
        return label.id?.toString();
      }),
    ).toEqual([LABEL_ONE_ID, LABEL_TWO_ID]);
  });

  test("names the labels it is keeping in sync with", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));
    fireEvent.click(
      view.getByRole("button", { name: "Bulk-add by a second label" }),
    );
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    expect(createdRule()?.name).toBe("Labels: WB Digital, WB Digital Service");
  });

  /*
   * Somebody who pruned the expanded list by hand is saying they want these
   * monitors and not the label. Turning it off has to mean exactly the old
   * behaviour.
   */
  test("writes no rule when the sync is turned off", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));

    const toggle: HTMLElement = view.getByRole("switch", {
      name: /Keep This Group In Sync With These Labels/,
    });

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  /*
   * A grid group places every resource in a row/column cell, and the public
   * page skips one that has neither. A rule has nowhere to record the cell, so
   * every monitor it added later would be on the page and rendered nowhere -
   * better not to offer the promise at all.
   */
  test("never offers the sync for a grid group", async () => {
    const view: ReturnType<typeof render> = renderModal({
      gridPlacement: {
        rowLabel: "Environment",
        rowValues: ["Production", "Staging"],
        columnLabel: "Region",
        columnValues: ["US East", "EU West"],
      },
    });

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));

    expect(
      view.queryByText("Keep This Group In Sync With These Labels"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      view.getByRole("button", { name: "Choose Select environment" }),
    );
    fireEvent.click(view.getByRole("button", { name: "Choose Select region" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("tells the user the group is now kept in sync", async () => {
    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(
      await view.findByText(/stays in sync with the labels you used/),
    ).toBeVisible();
  });

  /*
   * Creating a rule needs a permission adding a resource does not, so this
   * happens to real people. It must not read as a failed add - the resources
   * are there.
   */
  test("keeps the monitors it added when the rule is refused", async () => {
    mockCreate.mockRejectedValue(new Error("Permission denied"));

    const view: ReturnType<typeof render> = renderModal();

    fireEvent.click(view.getByRole("button", { name: "Bulk-add by label" }));
    await goToLastStep(view);
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(
      await view.findByText("Added 2 of 2 selected monitors."),
    ).toBeVisible();
    expect(
      view.getByText(/could not be kept in sync with the labels you used/),
    ).toBeVisible();
  });
});
