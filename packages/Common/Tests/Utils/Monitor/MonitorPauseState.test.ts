import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorPauseState, {
  MONITOR_PAUSE_FLAGS_SELECT,
  MonitorPauseFlags,
  MonitorPauseReason,
} from "../../../Utils/Monitor/MonitorPauseState";
import { describe, expect, test } from "@jest/globals";

/*
 * MonitorPauseState is the one place that decides "is this monitor checked"
 * for a monitor already read, and MonitorService.getEnabledMonitorQuery is the
 * same rule as a query. Archiving added a fourth flag to the three that
 * already paused a monitor; these pin that every reader sees all four, in the
 * order a person needs to hear them.
 */

const FLAGS: Array<keyof MonitorPauseFlags> = [
  "isArchived",
  "disableActiveMonitoring",
  "disableActiveMonitoringBecauseOfManualIncident",
  "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
];

function flags(values: Partial<MonitorPauseFlags>): MonitorPauseFlags {
  return values as MonitorPauseFlags;
}

describe("MonitorPauseState", () => {
  test("a monitor with none of the four flags set is checked", () => {
    expect(MonitorPauseState.getPauseReason(flags({}))).toBeNull();
    expect(MonitorPauseState.isPaused(flags({}))).toBe(false);

    const allFalse: MonitorPauseFlags = flags({
      isArchived: false,
      disableActiveMonitoring: false,
      disableActiveMonitoringBecauseOfManualIncident: false,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
    });

    expect(MonitorPauseState.getPauseReason(allFalse)).toBeNull();
    expect(MonitorPauseState.isPaused(allFalse)).toBe(false);
  });

  test.each([
    ["isArchived", MonitorPauseReason.Archived],
    ["disableActiveMonitoring", MonitorPauseReason.Disabled],
    [
      "disableActiveMonitoringBecauseOfManualIncident",
      MonitorPauseReason.ManualIncident,
    ],
    [
      "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
      MonitorPauseReason.ScheduledMaintenance,
    ],
  ] as Array<[keyof MonitorPauseFlags, MonitorPauseReason]>)(
    "%s alone pauses the monitor, as %s",
    (flag: keyof MonitorPauseFlags, reason: MonitorPauseReason) => {
      const monitor: MonitorPauseFlags = flags({ [flag]: true });

      expect(MonitorPauseState.getPauseReason(monitor)).toBe(reason);
      expect(MonitorPauseState.isPaused(monitor)).toBe(true);
    },
  );

  test("archived is the reason reported when it is set alongside the others", () => {
    expect(
      MonitorPauseState.getPauseReason(
        flags({
          isArchived: true,
          disableActiveMonitoring: true,
          disableActiveMonitoringBecauseOfManualIncident: true,
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        }),
      ),
    ).toBe(MonitorPauseReason.Archived);
  });

  test("the others keep their order below archived: disabled, then incident, then maintenance", () => {
    expect(
      MonitorPauseState.getPauseReason(
        flags({
          disableActiveMonitoring: true,
          disableActiveMonitoringBecauseOfManualIncident: true,
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        }),
      ),
    ).toBe(MonitorPauseReason.Disabled);

    expect(
      MonitorPauseState.getPauseReason(
        flags({
          disableActiveMonitoringBecauseOfManualIncident: true,
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        }),
      ),
    ).toBe(MonitorPauseReason.ManualIncident);
  });

  test("only a real true pauses: null and undefined read as the column default", () => {
    expect(
      MonitorPauseState.isPaused(
        flags({
          isArchived: null as unknown as boolean,
          disableActiveMonitoring: undefined,
        }),
      ),
    ).toBe(false);
  });

  test("works on a Monitor model as read from the database", () => {
    const monitor: Monitor = new Monitor();
    monitor.isArchived = true;

    expect(MonitorPauseState.isPaused(monitor)).toBe(true);
    expect(MonitorPauseState.getPauseReason(monitor)).toBe(
      MonitorPauseReason.Archived,
    );
  });

  test("the select reads exactly the four flags, so no caller can read three of them", () => {
    expect(Object.keys(MONITOR_PAUSE_FLAGS_SELECT).sort()).toEqual(
      [...FLAGS].sort(),
    );

    for (const flag of FLAGS) {
      expect(MONITOR_PAUSE_FLAGS_SELECT[flag]).toBe(true);
      // Every flag is a real column on the model.
      expect(new Monitor().getTableColumnMetadata(flag)).toBeTruthy();
    }
  });

  test("the enabled-monitor query is the same rule: every flag must be false", () => {
    const query: Record<string, unknown> =
      MonitorService.getEnabledMonitorQuery() as Record<string, unknown>;

    expect(Object.keys(query).sort()).toEqual([...FLAGS].sort());

    for (const flag of FLAGS) {
      expect(query[flag]).toBe(false);
    }
  });
});
