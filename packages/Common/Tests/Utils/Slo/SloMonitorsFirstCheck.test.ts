import { describe, expect, test } from "@jest/globals";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { MONITOR_PAUSE_FLAGS_SELECT } from "../../../Utils/Monitor/MonitorPauseState";
import {
  areSloMonitorsWaitingForFirstCheck,
  SLO_MONITOR_FIRST_CHECK_SELECT,
  SloMonitorFirstCheckFields,
} from "../../../Utils/Slo/SloMonitorsFirstCheck";

/*
 * Whether a Monitor Uptime SLO only waits for its monitors' first check
 * (#9089): the rule the evaluation worker gives its reason by and the SLO
 * page's "Waiting for the first check" banner reads.
 */

const NEVER_CHECKED: SloMonitorFirstCheckFields = {
  monitorType: MonitorType.Website,
  firstMeasuredAt: null,
  isArchived: false,
  disableActiveMonitoring: false,
  disableActiveMonitoringBecauseOfManualIncident: false,
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
};

const CHECKED: SloMonitorFirstCheckFields = {
  ...NEVER_CHECKED,
  firstMeasuredAt: new Date("2026-09-01T00:00:00.000Z"),
};

describe("areSloMonitorsWaitingForFirstCheck", () => {
  test("reads every pause flag the worker reads, and whether something checked the monitor", () => {
    expect(SLO_MONITOR_FIRST_CHECK_SELECT).toEqual({
      ...MONITOR_PAUSE_FLAGS_SELECT,
      monitorType: true,
      firstMeasuredAt: true,
    });
  });

  test("waits when nothing has checked any of its monitors", () => {
    expect(areSloMonitorsWaitingForFirstCheck([NEVER_CHECKED])).toBe(true);
    expect(
      areSloMonitorsWaitingForFirstCheck([NEVER_CHECKED, NEVER_CHECKED]),
    ).toBe(true);
  });

  test("does not wait once one monitor has been checked", () => {
    expect(areSloMonitorsWaitingForFirstCheck([NEVER_CHECKED, CHECKED])).toBe(
      false,
    );
    expect(areSloMonitorsWaitingForFirstCheck([CHECKED])).toBe(false);
  });

  test.each([
    { isArchived: true },
    { disableActiveMonitoring: true },
    { disableActiveMonitoringBecauseOfManualIncident: true },
    { disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true },
  ])("leaves a paused monitor out (%o)", (pause: Record<string, boolean>) => {
    // A checked monitor that is paused does not stop the wait...
    expect(
      areSloMonitorsWaitingForFirstCheck([
        { ...CHECKED, ...pause },
        NEVER_CHECKED,
      ]),
    ).toBe(true);

    // ...and an SLO whose monitors are all paused is Paused, not waiting.
    expect(
      areSloMonitorsWaitingForFirstCheck([{ ...NEVER_CHECKED, ...pause }]),
    ).toBe(false);
  });

  test("never claims a wait it cannot see", () => {
    expect(areSloMonitorsWaitingForFirstCheck([])).toBe(false);
    expect(areSloMonitorsWaitingForFirstCheck(null)).toBe(false);
    expect(areSloMonitorsWaitingForFirstCheck(undefined)).toBe(false);

    // Read without the column: counts as measured, as everywhere.
    expect(
      areSloMonitorsWaitingForFirstCheck([
        { ...NEVER_CHECKED, firstMeasuredAt: undefined },
      ]),
    ).toBe(false);

    // A manual monitor's status is the one a person sets.
    expect(
      areSloMonitorsWaitingForFirstCheck([
        { ...NEVER_CHECKED, monitorType: MonitorType.Manual },
      ]),
    ).toBe(false);
  });
});

/*
 * The SLO page's notice banner reads these columns of an SLO's monitors
 * through the SLO - `monitors: { _id: true, ...SLO_MONITOR_FIRST_CHECK_SELECT }`
 * - and the server refuses a relation read of a column without
 * canReadOnRelationQuery, failing the whole read for everyone. Three had
 * none (firstMeasuredAt and two pause flags), so the banner's read failed
 * and an archived SLO's Settings page lost "This SLO is archived": found by
 * 16.0.0's release run.
 */
describe("SLO_MONITOR_FIRST_CHECK_SELECT, read through an SLO's monitors", () => {
  test("names only columns a relation read may select", () => {
    const monitors: TableColumnMetadata =
      new ServiceLevelObjective().getTableColumnMetadata("monitors");
    const monitor: BaseModel = new monitors.modelType!();

    const unreadable: Array<string> = Object.keys(
      SLO_MONITOR_FIRST_CHECK_SELECT,
    ).filter((column: string): boolean => {
      return !monitor.getTableColumnMetadata(column)?.canReadOnRelationQuery;
    });

    expect(unreadable).toEqual([]);
  });
});
