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
 */

const mockPost: MockFunction = getJestMockFunction();
const mockCount: MockFunction = getJestMockFunction();

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
  mockPost.mockResolvedValue(status("Operational", "#10b981"));
});

afterEach(() => {
  cleanup();
});

async function renderStatus(): Promise<void> {
  render(<CurrentStatusElement monitorGroupId={new ObjectID(GROUP_ID)} />);
  // Either the status or the empty group's line, once both reads are back.
  await screen.findByText(/Operational|Offline|No monitors yet/);
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

  test("when the monitors cannot be counted, it still shows the status", async () => {
    mockCount.mockRejectedValue(new Error("Not allowed."));

    await renderStatus();

    expect(screen.getByText("Operational")).toBeVisible();
    expect(screen.queryByTestId(NO_MONITORS_STATUS_TEST_ID)).toBeNull();
    expect(screen.queryByText("Not allowed.")).toBeNull();
  });
});
