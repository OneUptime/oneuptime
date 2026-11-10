import { JSONObject } from "../../../Types/JSON";
import MonitorGroupMonitoring, {
  MonitorGroupMonitoringState,
  MonitorGroupMonitoringSummary,
} from "../../../Utils/Monitor/MonitorGroupMonitoring";
import { describe, expect, test } from "@jest/globals";

/*
 * MONITORING FOR EVERY MONITOR OF A MONITOR GROUP (issue #6401).
 *
 * How many of a group's monitors are checked, the state the group's
 * Monitoring card and its Current Status read from that, and the summary as
 * the server answers it and the dashboard reads it back. Nothing is stored
 * on the group: it is off when monitoring is off for every monitor in it.
 */

function summary(
  monitorCount: number,
  monitoringOffCount: number,
): MonitorGroupMonitoringSummary {
  return { monitorCount, monitoringOffCount };
}

describe("MonitorGroupMonitoring.getSummary", () => {
  test("counts the monitors given and those whose monitoring is off", () => {
    expect(
      MonitorGroupMonitoring.getSummary([
        { disableActiveMonitoring: true },
        { disableActiveMonitoring: false },
        { disableActiveMonitoring: true },
        {},
        { disableActiveMonitoring: null },
      ]),
    ).toEqual(summary(5, 2));
  });

  test("no monitors: nothing on, nothing off", () => {
    expect(MonitorGroupMonitoring.getSummary([])).toEqual(summary(0, 0));
  });
});

describe("MonitorGroupMonitoring.getState", () => {
  test.each([
    [summary(0, 0), MonitorGroupMonitoringState.NoMonitors],
    [summary(1, 0), MonitorGroupMonitoringState.On],
    [summary(4, 0), MonitorGroupMonitoringState.On],
    [summary(1, 1), MonitorGroupMonitoringState.Off],
    [summary(4, 4), MonitorGroupMonitoringState.Off],
    [summary(4, 1), MonitorGroupMonitoringState.Mixed],
    [summary(4, 3), MonitorGroupMonitoringState.Mixed],
  ])(
    "%j reads as %s",
    (
      value: MonitorGroupMonitoringSummary,
      state: MonitorGroupMonitoringState,
    ) => {
      expect(MonitorGroupMonitoring.getState(value)).toBe(state);
    },
  );
});

describe("MonitorGroupMonitoring.isMonitoringOffForEveryMonitor", () => {
  test("true only when every monitor of the group has monitoring off", () => {
    expect(
      MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(summary(3, 3)),
    ).toBe(true);
    expect(
      MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(summary(3, 2)),
    ).toBe(false);
    expect(
      MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(summary(3, 0)),
    ).toBe(false);
  });

  test("a group with no monitor to check is not off: it has nothing to be off about", () => {
    expect(
      MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(summary(0, 0)),
    ).toBe(false);
  });

  test("no summary - it could not be read - is not off", () => {
    expect(MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(null)).toBe(
      false,
    );
    expect(
      MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(undefined),
    ).toBe(false);
  });
});

describe("MonitorGroupMonitoring: the server's answer", () => {
  test("a summary is written as its two counts", () => {
    expect(MonitorGroupMonitoring.toJSON(summary(5, 2))).toEqual({
      monitorCount: 5,
      monitoringOffCount: 2,
    });
  });

  test("a change also says how many monitors the press turned", () => {
    expect(
      MonitorGroupMonitoring.toJSON({
        monitorCount: 5,
        monitoringOffCount: 5,
        changedCount: 3,
      }),
    ).toEqual({ monitorCount: 5, monitoringOffCount: 5, changedCount: 3 });
  });

  test("reads back what it writes", () => {
    expect(
      MonitorGroupMonitoring.fromJSON(
        MonitorGroupMonitoring.toJSON({
          monitorCount: 7,
          monitoringOffCount: 1,
          changedCount: 1,
        }),
      ),
    ).toEqual(summary(7, 1));
  });

  test.each([
    ["no answer", null],
    ["an empty answer", {}],
    ["a count that is missing", { monitorCount: 3 }],
    ["a count as text", { monitorCount: "3", monitoringOffCount: 1 }],
    ["a negative count", { monitorCount: 3, monitoringOffCount: -1 }],
    ["a fraction", { monitorCount: 3.5, monitoringOffCount: 1 }],
    ["more off than there are", { monitorCount: 2, monitoringOffCount: 3 }],
    ["not a number", { monitorCount: Number.NaN, monitoringOffCount: 0 }],
  ])(
    "%s is no summary - a page shows nothing rather than a wrong count",
    (_name: string, json: unknown) => {
      expect(
        MonitorGroupMonitoring.fromJSON(json as JSONObject | null),
      ).toBeNull();
    },
  );

  test("zero monitors is a summary: the group has none to check", () => {
    expect(
      MonitorGroupMonitoring.fromJSON({
        monitorCount: 0,
        monitoringOffCount: 0,
      }),
    ).toEqual(summary(0, 0));
  });
});
