import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A monitor group's Current Status in the list of groups.
 *
 * The server answers an empty group's status as the operational one, so the
 * list showed a green Operational for a group whose own Overview says it has
 * no monitors yet. The list now counts the group's monitors beside its
 * status and says "No monitors yet" the way the Overview does - and when the
 * count cannot be read, it shows the status as the server gives it rather
 * than failing the row.
 *
 * A group whose monitors all have monitoring turned off says "Disabled"
 * (issue #6401): nothing checks them, so their worst status is only what
 * their last checks saw. When that cannot be read, the status is shown as
 * the server gives it.
 */

const mockPost: MockFunction = getJestMockFunction();
const mockCount: MockFunction = getJestMockFunction();
const mockSummary: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringAPI",
  () => {
    return {
      __esModule: true,
      fetchMonitorGroupMonitoringSummary: (
        ...args: Array<unknown>
      ): unknown => {
        return mockSummary(...args);
      },
      setMonitorGroupMonitoring: jest.fn(),
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return mockCount(...args);
      },
    },
  };
});

import CurrentStatusElement from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/CurrentStatus";
import { NO_MONITORS_STATUS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/NoMonitorsStatus";
import { MONITOR_GROUP_DISABLED_STATUS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringCopy";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";

const GROUP_ID: string = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";

function status(name: string, color: string): MonitorStatus {
  const item: MonitorStatus = new MonitorStatus();
  item.id = new ObjectID("22222222-2222-4222-8222-222222222222");
  item.name = name;
  item.color = new Color(color);
  return item;
}

beforeEach(() => {
  mockPost.mockReset();
  mockCount.mockReset();
  mockSummary.mockReset();
  mockPost.mockResolvedValue(status("Operational", "#10b981"));
  mockSummary.mockResolvedValue({ monitorCount: 3, monitoringOffCount: 0 });
});

afterEach(() => {
  cleanup();
});

async function renderStatus(): Promise<void> {
  render(<CurrentStatusElement monitorGroupId={new ObjectID(GROUP_ID)} />);
  // Either the status or the empty group's line, once the reads are back.
  await screen.findByText(/Operational|Offline|No monitors yet|Disabled/);
}

describe("a monitor group's Current Status in the list of groups", () => {
  test("an empty group says it has no monitors yet - not a green Operational", async () => {
    mockCount.mockResolvedValue(0);

    await renderStatus();

    const line: HTMLElement = screen.getByTestId(NO_MONITORS_STATUS_TEST_ID);
    expect(line).toHaveTextContent("No monitors yet");
    // Quiet grey, like the Overview's, not a status colour.
    expect(line).toHaveClass("text-sm", "text-gray-500");
    expect(screen.queryByText("Operational")).toBeNull();
  });

  test("it counts the monitors of this group, beside reading its status", async () => {
    mockCount.mockResolvedValue(0);

    await renderStatus();

    expect(mockCount).toHaveBeenCalledTimes(1);
    const counted: { modelType: unknown; query: Record<string, unknown> } =
      mockCount.mock.calls[0]![0] as {
        modelType: unknown;
        query: Record<string, unknown>;
      };
    expect(counted.modelType).toBe(MonitorGroupResource);
    expect(String(counted.query["monitorGroupId"])).toBe(GROUP_ID);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  test("a group with monitors shows its status, as before", async () => {
    mockCount.mockResolvedValue(3);
    mockPost.mockResolvedValue(status("Offline", "#ef4444"));

    await renderStatus();

    expect(screen.getByText("Offline")).toBeVisible();
    expect(screen.queryByTestId(NO_MONITORS_STATUS_TEST_ID)).toBeNull();
  });

  test("a group whose monitors all have monitoring off says Disabled, in grey and still - not their last status", async () => {
    mockCount.mockResolvedValue(3);
    mockSummary.mockResolvedValue({ monitorCount: 3, monitoringOffCount: 3 });
    mockPost.mockResolvedValue(status("Offline", "#ef4444"));

    await renderStatus();

    const disabled: HTMLElement = screen.getByTestId(
      MONITOR_GROUP_DISABLED_STATUS_TEST_ID,
    );
    expect(disabled).toHaveTextContent("Disabled");
    expect(screen.queryByText("Offline")).toBeNull();
    // Still: no ping animation on a group nothing checks.
    expect(disabled.querySelector(".motion-safe\\:animate-ping")).toBeNull();
  });

  test("it reads this group's monitoring beside its status", async () => {
    mockCount.mockResolvedValue(3);

    await renderStatus();

    expect(mockSummary).toHaveBeenCalledTimes(1);
    expect(String(mockSummary.mock.calls[0]![0])).toBe(GROUP_ID);
  });

  test("some monitors still checked: the group shows its status, as before", async () => {
    mockCount.mockResolvedValue(3);
    mockSummary.mockResolvedValue({ monitorCount: 3, monitoringOffCount: 2 });
    mockPost.mockResolvedValue(status("Offline", "#ef4444"));

    await renderStatus();

    expect(screen.getByText("Offline")).toBeVisible();
    expect(
      screen.queryByTestId(MONITOR_GROUP_DISABLED_STATUS_TEST_ID),
    ).toBeNull();
  });

  test("an empty group says it has no monitors yet, whatever its monitoring reads", async () => {
    mockCount.mockResolvedValue(0);
    mockSummary.mockResolvedValue({ monitorCount: 0, monitoringOffCount: 0 });

    await renderStatus();

    expect(screen.getByTestId(NO_MONITORS_STATUS_TEST_ID)).toBeVisible();
    expect(
      screen.queryByTestId(MONITOR_GROUP_DISABLED_STATUS_TEST_ID),
    ).toBeNull();
  });

  test("when its monitoring cannot be read, it shows the status as the server gives it", async () => {
    mockCount.mockResolvedValue(3);
    mockSummary.mockRejectedValue(new Error("Not allowed.") as never);

    await renderStatus();

    expect(screen.getByText("Operational")).toBeVisible();
    expect(screen.queryByText("Not allowed.")).toBeNull();
  });

  test("when the monitors cannot be counted, it still shows the status", async () => {
    mockCount.mockRejectedValue(new Error("Not allowed."));

    await renderStatus();

    expect(screen.getByText("Operational")).toBeVisible();
    expect(screen.queryByTestId(NO_MONITORS_STATUS_TEST_ID)).toBeNull();
    expect(screen.queryByText("Not allowed.")).toBeNull();
  });
});
