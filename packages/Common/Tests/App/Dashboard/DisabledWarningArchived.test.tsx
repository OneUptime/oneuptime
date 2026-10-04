import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Monitoring is turned off", on a monitor that is archived.
 *
 * An archived monitor is not checked either, but the archived banner at the
 * top of its pages already says so and offers to unarchive it. Two banners
 * for one fact would make the reader work out which one matters, so the
 * disabled banner stays quiet while the monitor is archived - and speaks again
 * as soon as it is unarchived, if the monitor is also disabled. It follows an
 * archive or unarchive made elsewhere on the page without a reload.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import { announceArchiveStateChange } from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ArchiveStateEvents";
import DisabledWarning, {
  getDisabledMessage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

const MONITOR_ID: ObjectID = new ObjectID(
  "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b",
);

const DISABLED_MESSAGE: string =
  "Nothing checks this monitor while monitoring is off: its status stays at the last one recorded, and it opens no incidents or alerts.";

function monitorWith(values: Partial<Monitor>): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = MonitorType.API;
  Object.assign(monitor, values);
  return monitor;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function bannerShown(): boolean {
  return screen.queryByText("Monitoring is turned off") !== null;
}

beforeEach(() => {
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("getDisabledMessage for an archived monitor", () => {
  test("says nothing, even when the monitor is also disabled", () => {
    expect(
      getDisabledMessage(
        monitorWith({ isArchived: true, disableActiveMonitoring: true }),
      ),
    ).toBe("");
  });

  test("says nothing, even when an incident or maintenance also paused it", () => {
    expect(
      getDisabledMessage(
        monitorWith({
          isArchived: true,
          disableActiveMonitoringBecauseOfManualIncident: true,
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        }),
      ),
    ).toBe("");
  });

  test("a disabled monitor that is not archived is still reported", () => {
    expect(
      getDisabledMessage(
        monitorWith({ isArchived: false, disableActiveMonitoring: true }),
      ),
    ).toBe(DISABLED_MESSAGE);
  });
});

describe("the disabled banner on an archived monitor's pages", () => {
  test("is not shown, and the monitor is read with its archive flag", async () => {
    getItemMock.mockResolvedValue(
      monitorWith({ isArchived: true, disableActiveMonitoring: true }) as never,
    );

    render(<DisabledWarning monitorId={MONITOR_ID} />);
    await flush();

    expect(bannerShown()).toBe(false);
    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["isArchived"]).toBe(true);
  });

  test("goes away when the monitor is archived on the page, and comes back when it is unarchived", async () => {
    getItemMock.mockResolvedValue(
      monitorWith({
        isArchived: false,
        disableActiveMonitoring: true,
      }) as never,
    );

    render(<DisabledWarning monitorId={MONITOR_ID} />);
    await flush();
    expect(bannerShown()).toBe(true);

    getItemMock.mockResolvedValue(
      monitorWith({ isArchived: true, disableActiveMonitoring: true }) as never,
    );
    act(() => {
      announceArchiveStateChange({
        modelType: Monitor,
        modelId: MONITOR_ID,
        isArchived: true,
      });
    });
    await flush();
    expect(bannerShown()).toBe(false);

    getItemMock.mockResolvedValue(
      monitorWith({
        isArchived: false,
        disableActiveMonitoring: true,
      }) as never,
    );
    act(() => {
      announceArchiveStateChange({
        modelType: Monitor,
        modelId: MONITOR_ID,
        isArchived: false,
      });
    });
    await flush();
    expect(bannerShown()).toBe(true);
    expect(screen.getByText(DISABLED_MESSAGE)).toBeInTheDocument();
  });

  test("does not re-read for another monitor's archive", async () => {
    getItemMock.mockResolvedValue(
      monitorWith({
        isArchived: false,
        disableActiveMonitoring: true,
      }) as never,
    );

    render(<DisabledWarning monitorId={MONITOR_ID} />);
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    act(() => {
      announceArchiveStateChange({
        modelType: Monitor,
        modelId: OTHER_MONITOR_ID,
        isArchived: true,
      });
    });
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(bannerShown()).toBe(true);
  });
});
