import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/UI/Components/ModelList/ModelList", () => {
  return {
    __esModule: true,
    default: (props: {
      modelType: new () => { name?: string };
      onSelectChange?: (items: Array<{ name?: string }>) => void;
    }) => {
      return (
        <button
          type="button"
          onClick={() => {
            const first: { name?: string } = new props.modelType();
            first.name = "Checkout API";
            const second: { name?: string } = new props.modelType();
            second.name = "Billing Worker";
            props.onSelectChange?.([first, second]);
          }}
        >
          Select two monitors
        </button>
      );
    },
  };
});

jest.mock("Common/UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      ariaLabel?: string;
      options: Array<{ value: string }>;
      onChange?: (value: string) => void;
    }) => {
      return (
        <button
          type="button"
          aria-label={props.ariaLabel}
          onClick={() => {
            props.onChange?.(props.options[0]!.value);
          }}
        >
          Choose {props.ariaLabel}
        </button>
      );
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
import ObjectID from "../../../Types/ObjectID";

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

describe("BulkAddStatusPageMonitorsModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBulkAdd.mockImplementation(
      async (
        options: BulkAddStatusPageMonitorsOptions,
      ): Promise<BulkAddStatusPageMonitorsResult> => {
        return { succeeded: options.monitors, failed: [] };
      },
    );
  });

  test("requires at least one monitor before enabling the bulk action", () => {
    const view: ReturnType<typeof render> = render(
      <BulkAddStatusPageMonitorsModal
        projectId={PROJECT_ID}
        statusPageId={STATUS_PAGE_ID}
        statusPageGroupId={GROUP_ID}
        onClose={jest.fn()}
        onComplete={jest.fn()}
      />,
    );

    const submit: HTMLElement = view.getByTestId("modal-footer-submit-button");
    expect(submit).toBeDisabled();

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));

    expect(submit).not.toBeDisabled();
    expect(submit).toHaveTextContent("Add 2 Monitors");
  });

  test("submits selected monitors to the requested status page group", async () => {
    const onComplete: (result: BulkAddStatusPageMonitorsResult) => void =
      jest.fn((_result: BulkAddStatusPageMonitorsResult): void => {});
    const view: ReturnType<typeof render> = render(
      <BulkAddStatusPageMonitorsModal
        projectId={PROJECT_ID}
        statusPageId={STATUS_PAGE_ID}
        statusPageGroupId={GROUP_ID}
        onClose={jest.fn()}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    });

    const options: BulkAddStatusPageMonitorsOptions =
      mockBulkAdd.mock.calls[0]![0];
    expect(options.projectId).toBe(PROJECT_ID);
    expect(options.statusPageId).toBe(STATUS_PAGE_ID);
    expect(options.statusPageGroupId).toBe(GROUP_ID);
    expect(
      options.monitors.map((monitor: Monitor) => {
        return monitor.name;
      }),
    ).toEqual(["Checkout API", "Billing Worker"]);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(view.getByText("Added 2 of 2 selected monitors.")).toBeVisible();
    });
  });

  test("requires and submits a shared grid placement", async () => {
    const view: ReturnType<typeof render> = render(
      <BulkAddStatusPageMonitorsModal
        projectId={PROJECT_ID}
        statusPageId={STATUS_PAGE_ID}
        statusPageGroupId={GROUP_ID}
        gridPlacement={{
          rowLabel: "Environment",
          rowValues: ["Production", "Staging"],
          columnLabel: "Region",
          columnValues: ["US East", "EU West"],
        }}
        onClose={jest.fn()}
        onComplete={jest.fn()}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    const submit: HTMLElement = view.getByTestId("modal-footer-submit-button");
    expect(submit).toBeDisabled();

    fireEvent.click(view.getByRole("button", { name: "Environment row" }));
    expect(submit).toBeDisabled();

    fireEvent.click(view.getByRole("button", { name: "Region column" }));
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

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
    const view: ReturnType<typeof render> = render(
      <BulkAddStatusPageMonitorsModal
        projectId={PROJECT_ID}
        statusPageId={STATUS_PAGE_ID}
        onClose={onClose}
        onComplete={jest.fn()}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Select two monitors" }));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(view.getByText("Added 1 of 2 selected monitors.")).toBeVisible();
    });

    expect(view.getByText("Added (1)")).toBeVisible();
    expect(view.getByText("Failed (1)")).toBeVisible();
    expect(view.getByText("Checkout API")).toBeVisible();
    expect(view.getByText(/Billing Worker:/)).toBeVisible();
    expect(view.getByText("Permission denied")).toBeVisible();
    expect(view.queryByText("Select two monitors")).not.toBeInTheDocument();

    fireEvent.click(view.getByTestId("modal-footer-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockBulkAdd).toHaveBeenCalledTimes(1);
  });
});
