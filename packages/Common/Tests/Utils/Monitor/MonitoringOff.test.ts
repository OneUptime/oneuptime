import { describe, expect, test } from "@jest/globals";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { getMetadataArgsStorage } from "typeorm";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitoringOff, {
  MONITORING_OFF_SELECT,
  MonitoringOffFlags,
} from "../../../Utils/Monitor/MonitoringOff";
import NotOperationalMonitorQuery from "../../../Utils/Monitor/NotOperationalMonitorQuery";

/*
 * A MONITOR WHOSE MONITORING IS TURNED OFF (issues #6475, #6476, #6477).
 *
 * Nothing checks such a monitor, so the status it holds - "Offline", say - is
 * only what its last check saw. MonitoringOff is the one rule the web reads
 * for it: whether a monitor is off, and which monitors' statuses are live.
 * Not Operational, the dashboards' Monitor List widget, OneUptime AI's
 * query_monitors and the Ask AI page context all ask it, and the mobile app's
 * copy is held to it (MonitorHealthMobileParity).
 */

const MONITORED: Record<string, unknown> = {
  isArchived: false,
  disableActiveMonitoring: false,
};

describe("MonitoringOff.isOff", () => {
  test("a monitor whose monitoring is turned off is off", () => {
    expect(MonitoringOff.isOff({ disableActiveMonitoring: true })).toBe(true);
  });

  test.each([false, undefined, null])(
    "disableActiveMonitoring %p is not off: monitoring is on, or the column was not read",
    (value: boolean | undefined | null) => {
      expect(MonitoringOff.isOff({ disableActiveMonitoring: value })).toBe(
        false,
      );
    },
  );

  test("only a true is off: a value that merely looks like one is not", () => {
    for (const value of ["true", "1", 1, {}, [], "false", 0]) {
      expect(
        MonitoringOff.isOff({
          disableActiveMonitoring: value as unknown as boolean,
        }),
      ).toBe(false);
    }
  });

  test("no monitor, or a monitor read without the column, is not off", () => {
    expect(MonitoringOff.isOff(null)).toBe(false);
    expect(MonitoringOff.isOff(undefined)).toBe(false);
    expect(MonitoringOff.isOff({})).toBe(false);
  });

  test("reads a Monitor as the API hands it over", () => {
    const off: Monitor = new Monitor();
    off.disableActiveMonitoring = true;
    const on: Monitor = new Monitor();
    on.disableActiveMonitoring = false;

    expect(MonitoringOff.isOff(off)).toBe(true);
    expect(MonitoringOff.isOff(on)).toBe(false);
    // A Monitor read without the column holds undefined there.
    expect(MonitoringOff.isOff(new Monitor())).toBe(false);
  });

  /*
   * Why "not read" is "on": the column is NOT NULL with a default of false,
   * so every stored monitor holds true or false, and a model read without it
   * holds undefined only because it was not asked for.
   */
  test("the column it reads is never NULL, and a new monitor's is false", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === Monitor &&
            candidate.propertyName === "disableActiveMonitoring"
          );
        },
      );

    expect(column).toBeDefined();
    expect(column!.options.nullable).toBe(false);
    expect(column!.options.default).toBe(false);
    expect(
      new Monitor().getTableColumnMetadata("disableActiveMonitoring")
        .defaultValue,
    ).toBe(false);
  });
});

describe("MonitoringOff.getMonitoredQuery", () => {
  test("the monitors whose status is live: not archived, monitoring on", () => {
    expect(MonitoringOff.getMonitoredQuery()).toEqual(MONITORED);
  });

  test("hands out a fresh query each time: a caller that adds to it changes no one else's", () => {
    const first: Record<string, unknown> =
      MonitoringOff.getMonitoredQuery() as Record<string, unknown>;
    first["name"] = "Checkout";
    first["disableActiveMonitoring"] = true;
    first["isArchived"] = true;

    expect(MonitoringOff.getMonitoredQuery()).toEqual(MONITORED);
    expect(MonitoringOff.getMonitoredQuery()).not.toBe(
      MonitoringOff.getMonitoredQuery(),
    );
  });

  test("a monitor it matches is never off", () => {
    expect(
      MonitoringOff.isOff(
        MonitoringOff.getMonitoredQuery() as unknown as MonitoringOffFlags,
      ),
    ).toBe(false);
  });

  test("Not Operational is it, with a status that is not operational", () => {
    expect(NotOperationalMonitorQuery.getQuery()).toEqual({
      ...MONITORED,
      currentMonitorStatus: { isOperationalState: false },
    });
  });
});

describe("MONITORING_OFF_SELECT", () => {
  test("reads the one column isOff answers from, and nothing else", () => {
    expect(MONITORING_OFF_SELECT).toEqual({ disableActiveMonitoring: true });
  });

  test("names a column of the Monitor model", () => {
    for (const column of Object.keys(MONITORING_OFF_SELECT)) {
      expect(new Monitor().isTableColumn(column)).toBe(true);
    }
  });
});
