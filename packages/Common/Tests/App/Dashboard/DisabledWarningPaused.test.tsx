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
 * THE BANNER OF A MONITOR A MAINTENANCE EVENT PAUSED (issue #11433).
 *
 * It said "We are not monitoring this monitor since it is disabled because
 * of an ongoing maintenance event. To enable active monitoring, please end
 * the maintenance event." under the title "This monitor is disabled" - the
 * Monitors table's word for monitoring turned off - and nothing of whether
 * the paused time counts in uptime. It now reads as the incident's banner
 * does: the monitor is paused, until when, what uptime makes of the time
 * (left out while the event sets no status, counted as the status it sets
 * otherwise, read from the monitor's newest status event), what happens to
 * what reaches it, and how to have it checked again.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import DisabledWarning, {
  getMaintenanceNoticeMessage,
  getMonitoringOffNotice,
  MAINTENANCE_PAUSE_MESSAGES,
  MonitoringOffNotice,
  MonitoringOffReason,
  PAUSED_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import MonitorPausedBy from "../../../Types/Monitor/MonitorPausedBy";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

const MONITOR_ID: ObjectID = new ObjectID(
  "11433000-0000-4000-8000-0000000000d1",
);

function monitorWith(values: Partial<Monitor>): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = MonitorType.API;
  Object.assign(monitor, values);
  return monitor;
}

function statusEvent(data: {
  isMonitoringOff: boolean;
  pausedBy?: MonitorPausedBy | undefined;
}): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline(
    ObjectID.generate(),
  );
  row.isMonitoringOff = data.isMonitoringOff;

  if (data.pausedBy) {
    row.pausedBy = data.pausedBy;
  }

  return row;
}

const IN_MAINTENANCE: Monitor = monitorWith({
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("what the maintenance banner says", () => {
  test("paused, never disabled: the title of a monitor an incident or an event paused", () => {
    expect(PAUSED_TITLE).toBe("This monitor is paused");

    for (const monitor of [
      IN_MAINTENANCE,
      monitorWith({ disableActiveMonitoringBecauseOfManualIncident: true }),
    ]) {
      const notice: MonitoringOffNotice = getMonitoringOffNotice(monitor)!;
      expect(notice.title).toBe("This monitor is paused");
      expect(notice.title.toLowerCase()).not.toContain("disabled");
    }

    // Turned off keeps its own words.
    expect(
      getMonitoringOffNotice(monitorWith({ disableActiveMonitoring: true }))!
        .title,
    ).toBe("Monitoring is turned off");
  });

  test("each message says what the pause does, what reaches the monitor, and how to have it checked again", () => {
    for (const message of Object.values(MAINTENANCE_PAUSE_MESSAGES)) {
      expect(message).toContain(
        "A maintenance event in progress paused this monitor's checks until it ends.",
      );
      expect(message).toContain(
        "What reaches it meanwhile is listed in Monitoring Logs, not evaluated.",
      );
      expect(message).toContain(
        "To check it again now, end the event or take this monitor off it.",
      );
      // The record's name since #6817, never the old one.
      expect(message).not.toContain("scheduled maintenance event");
      expect(message).not.toContain("disabled");
    }

    expect(MAINTENANCE_PAUSE_MESSAGES.leftOutOfUptime).toContain(
      "The event sets no status for this monitor, so uptime, status pages and SLOs leave this time out.",
    );
    expect(MAINTENANCE_PAUSE_MESSAGES.countedInUptime).toContain(
      "Uptime, status pages and SLOs count this time as the status the event sets.",
    );
    expect(MAINTENANCE_PAUSE_MESSAGES.eitherWay).toContain(
      "count this time as the status the event sets, or leave it out when the event sets none.",
    );
  });

  test.each([
    [
      "left out because maintenance paused it",
      statusEvent({
        isMonitoringOff: true,
        pausedBy: MonitorPausedBy.ScheduledMaintenance,
      }),
      MAINTENANCE_PAUSE_MESSAGES.leftOutOfUptime,
    ],
    [
      "left out because maintenance and an incident paused it",
      statusEvent({
        isMonitoringOff: true,
        pausedBy: MonitorPausedBy.IncidentAndScheduledMaintenance,
      }),
      MAINTENANCE_PAUSE_MESSAGES.leftOutOfUptime,
    ],
    [
      "counted: the event puts it in a status",
      statusEvent({ isMonitoringOff: false }),
      MAINTENANCE_PAUSE_MESSAGES.countedInUptime,
    ],
    [
      "left out, but not marked as maintenance's (from before #11433)",
      statusEvent({ isMonitoringOff: true }),
      MAINTENANCE_PAUSE_MESSAGES.eitherWay,
    ],
    ["not read", null, MAINTENANCE_PAUSE_MESSAGES.eitherWay],
  ] as Array<[string, MonitorStatusTimeline | null, string]>)(
    "the newest status event %s: its message",
    (_label: string, latest: MonitorStatusTimeline | null, message: string) => {
      expect(getMaintenanceNoticeMessage(latest)).toBe(message);
      expect(getMonitoringOffNotice(IN_MAINTENANCE, latest)).toEqual({
        reason: MonitoringOffReason.ScheduledMaintenance,
        title: PAUSED_TITLE,
        message: message,
      });
    },
  );
});

describe("the banner on a monitor's pages during maintenance", () => {
  async function renderBanner(): Promise<void> {
    render(<DisabledWarning monitorId={MONITOR_ID} />);
    await flush();
  }

  test("reads the monitor's newest status event, one row, and says what uptime makes of the time", async () => {
    getItemMock.mockResolvedValue(IN_MAINTENANCE as never);
    getListMock.mockResolvedValue({
      data: [
        statusEvent({
          isMonitoringOff: true,
          pausedBy: MonitorPausedBy.ScheduledMaintenance,
        }),
      ],
      count: 1,
    } as never);

    await renderBanner();

    expect(screen.getByText("This monitor is paused")).toBeInTheDocument();
    expect(
      screen.getByText(MAINTENANCE_PAUSE_MESSAGES.leftOutOfUptime),
    ).toBeInTheDocument();

    const request: {
      query: { monitorId: ObjectID };
      limit: number;
      select: Record<string, boolean>;
      sort: Record<string, string>;
    } = getListMock.mock.calls[0]![0] as never;
    expect(request.query.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(request.limit).toBe(1);
    expect(request.select).toMatchObject({
      isMonitoringOff: true,
      pausedBy: true,
    });
    expect(request.sort).toEqual({ startsAt: SortOrder.Descending });
  });

  test("an event that sets a status: the time counts, as the banner says", async () => {
    getItemMock.mockResolvedValue(IN_MAINTENANCE as never);
    getListMock.mockResolvedValue({
      data: [statusEvent({ isMonitoringOff: false })],
      count: 1,
    } as never);

    await renderBanner();

    expect(
      screen.getByText(MAINTENANCE_PAUSE_MESSAGES.countedInUptime),
    ).toBeInTheDocument();
  });

  test("the status event cannot be read: the banner says both ways, and no error shows", async () => {
    getItemMock.mockResolvedValue(IN_MAINTENANCE as never);
    getListMock.mockRejectedValue(new Error("Forbidden") as never);

    await renderBanner();

    expect(screen.getByText("This monitor is paused")).toBeInTheDocument();
    expect(
      screen.getByText(MAINTENANCE_PAUSE_MESSAGES.eitherWay),
    ).toBeInTheDocument();
  });

  test("a monitor an incident paused, or one turned off, reads no status event", async () => {
    getItemMock.mockResolvedValue(
      monitorWith({
        disableActiveMonitoringBecauseOfManualIncident: true,
      }) as never,
    );

    await renderBanner();

    expect(screen.getByText("This monitor is paused")).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });
});
