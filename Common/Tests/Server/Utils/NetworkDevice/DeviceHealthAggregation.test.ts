import { describe, expect, test } from "@jest/globals";
import {
  DEVICE_COUNT_AGGREGATE,
  DEVICE_HEALTH_AGGREGATES,
  DEVICE_HEALTH_GROUP_COLUMNS,
  DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE,
  DEVICE_HEALTH_NOW_PARAMETER,
  DeviceHealthGroup,
  DeviceHealthGroupAlias,
  INTERFACES_DOWN_AGGREGATE,
  deviceHealthInputForGroup,
  deviceRollupStateForGroup,
  parseDeviceHealthGroup,
} from "../../../../Server/Utils/NetworkDevice/DeviceHealthAggregation";
import { AggregateColumn, AggregateRow } from "../../../../Server/Types/Database/AggregateBy";
import {
  DeviceHealthStateInput,
  NetworkDeviceHealthState,
  deviceHealthState,
} from "../../../../Utils/NetworkDevice/DeviceHealthStateUtil";
import DeviceReachabilityUtil, {
  DEFAULT_DEVICE_POLLING_INTERVAL_IN_MINUTES,
  DEVICE_MIN_STALE_WINDOW_IN_MINUTES,
  DEVICE_MISSED_POLL_ALLOWANCE,
} from "../../../../Utils/NetworkDevice/DeviceReachabilityUtil";
import SiteStatusRollupUtil, {
  DeviceHealthState,
} from "../../../../Utils/NetworkSite/SiteStatusRollupUtil";
import OneUptimeDate from "../../../../Types/Date";

/*
 * The claim this whole module rests on: grouping devices by the facts the
 * classifier reads, and then classifying the GROUPS, produces exactly the
 * verdicts classifying every device individually would have produced.
 *
 * If that is not true the rollups are wrong in a way nothing on screen would
 * reveal — a site card would print a number, and it would simply be a
 * different number from the one the device list under it adds up to. So it is
 * proved here exhaustively rather than sampled.
 */

const NOW: Date = OneUptimeDate.fromString("2026-08-27T12:00:00.000Z");

/** A device row as it exists in Postgres, before any grouping. */
interface DeviceRow {
  monitorStatusIsOffline: boolean | undefined;
  isReachable: boolean | null;
  lastPolledAt: Date | null;
  lastSeenAt: Date | null;
  pollingIntervalInMinutes: number | null;
  interfacesDown: number;
}

/*
 * What the SQL grouping computes, restated in TypeScript so a device row can
 * be turned into the bucket it would land in.
 *
 * This is the ONE thing that exists twice — the predicate is evaluated by
 * Postgres in production and here in the test — so it is written against the
 * shared util rather than against a hard-coded window, and a separate test
 * below pins the SQL to the same three constants.
 */
function bucketFor(device: DeviceRow, now: Date): DeviceHealthGroup {
  const contactTimes: Array<number> = [device.lastPolledAt, device.lastSeenAt]
    .filter((value: Date | null): value is Date => {
      return value !== null;
    })
    .map((value: Date): number => {
      return value.getTime();
    });

  const lastContactAt: number | null =
    contactTimes.length > 0 ? Math.max(...contactTimes) : null;

  const staleWindowInMinutes: number =
    DeviceReachabilityUtil.getStaleWindowInMinutes(
      device.pollingIntervalInMinutes,
    );

  return {
    siteId: null,
    // The bucket key stands for the status; the flag is passed alongside it.
    monitorStatusId:
      device.monitorStatusIsOffline === undefined ? null : "status-id",
    monitoringMethod: null,
    isReachable: device.isReachable,
    hasBeenPolled: device.lastPolledAt !== null,
    hasBeenSeen: device.lastSeenAt !== null,
    isStale:
      lastContactAt !== null &&
      lastContactAt < now.getTime() - staleWindowInMinutes * 60 * 1000,
    hasDownInterfaces: device.interfacesDown > 0,
    deviceCount: 1,
    interfacesDownTotal: device.interfacesDown,
  };
}

function toClassifierInput(device: DeviceRow): DeviceHealthStateInput {
  return {
    monitorStatusIsOffline: device.monitorStatusIsOffline,
    isReachable: device.isReachable,
    lastPolledAt: device.lastPolledAt,
    lastSeenAt: device.lastSeenAt,
    pollingIntervalInMinutes: device.pollingIntervalInMinutes,
    interfacesDown: device.interfacesDown,
  };
}

/*
 * Every device row the classifier can tell apart, built from the cross
 * product of what it reads.
 *
 * The timestamps deliberately include a fresh one, a stale one and a value
 * either side of a NON-default polling interval — that last pair is what
 * catches a staleness rule that quietly uses a fixed window instead of each
 * device's own.
 */
function everyDistinguishableDevice(): Array<DeviceRow> {
  const rows: Array<DeviceRow> = [];

  const monitorStates: Array<boolean | undefined> = [undefined, true, false];
  const reachableStates: Array<boolean | null> = [null, true, false];
  const intervals: Array<number | null> = [null, 5, 240];
  const interfaceCounts: Array<number> = [0, 3];

  // Well inside every window this suite can produce, and well outside them.
  const fresh: Date = OneUptimeDate.addRemoveMinutes(NOW, -1);
  const veryStale: Date = OneUptimeDate.addRemoveMinutes(NOW, -60 * 24 * 30);
  /*
   * Stale for a 5-minute device (window 60 min) and fresh for a 240-minute
   * one (window 2,400 min). Nothing else in this matrix separates the two.
   */
  const between: Date = OneUptimeDate.addRemoveMinutes(NOW, -600);

  const timestamps: Array<Date | null> = [null, fresh, between, veryStale];

  for (const monitorStatusIsOffline of monitorStates) {
    for (const isReachable of reachableStates) {
      for (const lastPolledAt of timestamps) {
        for (const lastSeenAt of timestamps) {
          for (const pollingIntervalInMinutes of intervals) {
            for (const interfacesDown of interfaceCounts) {
              rows.push({
                monitorStatusIsOffline: monitorStatusIsOffline,
                isReachable: isReachable,
                lastPolledAt: lastPolledAt,
                lastSeenAt: lastSeenAt,
                pollingIntervalInMinutes: pollingIntervalInMinutes,
                interfacesDown: interfacesDown,
              });
            }
          }
        }
      }
    }
  }

  return rows;
}

describe("bucketing a device loses nothing the classifier reads", () => {
  const devices: Array<DeviceRow> = everyDistinguishableDevice();

  test("the matrix is big enough to be worth calling exhaustive", () => {
    // 3 monitor states x 3 reachability x 4 x 4 timestamps x 3 intervals x 2.
    expect(devices).toHaveLength(3 * 3 * 4 * 4 * 3 * 2);
  });

  test("every device classifies the same through its bucket as directly", () => {
    const disagreements: Array<string> = [];

    for (const device of devices) {
      const direct: NetworkDeviceHealthState = deviceHealthState(
        toClassifierInput(device),
        NOW,
      );

      const viaBucket: NetworkDeviceHealthState = deviceHealthState(
        deviceHealthInputForGroup({
          group: bucketFor(device, NOW),
          monitorStatusIsOffline: device.monitorStatusIsOffline,
          now: NOW,
        }),
        NOW,
      );

      if (direct !== viaBucket) {
        disagreements.push(
          `${JSON.stringify(device)}: direct=${direct} bucket=${viaBucket}`,
        );
      }
    }

    expect(disagreements).toEqual([]);
  });

  /*
   * The assertion above would also pass if the classifier answered the same
   * thing for everything. It does not — this is what proves the matrix is
   * actually exercising the rule.
   */
  test("the matrix reaches all four verdicts", () => {
    const seen: Set<NetworkDeviceHealthState> =
      new Set<NetworkDeviceHealthState>();

    for (const device of devices) {
      seen.add(deviceHealthState(toClassifierInput(device), NOW));
    }

    expect(Array.from(seen).sort()).toEqual([
      "degraded",
      "down",
      "healthy",
      "unknown",
    ]);
  });

  /*
   * The site rollup reads the same buckets through a different rule, and it
   * has to survive the round trip too — a rollup that disagreed with the
   * device counts under it would colour a site by devices it does not have.
   */
  test("the site rollup rule survives the round trip as well", () => {
    const operational: { monitorStatusId: string; priority: number } = {
      monitorStatusId: "operational",
      priority: 1,
    };
    const offline: { monitorStatusId: string; priority: number } = {
      monitorStatusId: "offline",
      priority: 3,
    };

    const disagreements: Array<string> = [];

    for (const device of devices) {
      // Only the unstamped path: a stamped status is carried verbatim.
      if (device.monitorStatusIsOffline !== undefined) {
        continue;
      }

      const directState: DeviceHealthState = {
        isReachable: device.isReachable,
        lastPolledAt: device.lastPolledAt,
        lastSeenAt: device.lastSeenAt,
        pollingIntervalInMinutes: device.pollingIntervalInMinutes,
      };

      const direct: string | null = SiteStatusRollupUtil.worstStatus({
        deviceStates: [directState],
        operationalStatus: operational,
        offlineStatus: offline,
        now: NOW,
      });

      const viaBucket: string | null = SiteStatusRollupUtil.worstStatus({
        deviceStates: [
          deviceRollupStateForGroup({
            group: bucketFor(device, NOW),
            now: NOW,
          }),
        ],
        operationalStatus: operational,
        offlineStatus: offline,
        now: NOW,
      });

      if (direct !== viaBucket) {
        disagreements.push(
          `${JSON.stringify(device)}: direct=${direct} bucket=${viaBucket}`,
        );
      }
    }

    expect(disagreements).toEqual([]);
  });

  /*
   * A bucket carries "is it stale", not "when was it last seen" — so the
   * synthetic timestamps have to land on the right side of the DEFAULT
   * window, which is the one the classifier will re-derive from them. A
   * sentinel that was only just outside it would work today and break the
   * moment the allowance is tuned.
   */
  test("the synthetic stale timestamp is far outside the default window", () => {
    const staleInput: DeviceHealthStateInput = deviceHealthInputForGroup({
      group: {
        siteId: null,
        monitorStatusId: null,
        monitoringMethod: null,
        isReachable: null,
        hasBeenPolled: true,
        hasBeenSeen: true,
        isStale: true,
        hasDownInterfaces: false,
        deviceCount: 1,
        interfacesDownTotal: 0,
      },
      now: NOW,
    });

    const defaultWindowInMinutes: number =
      DeviceReachabilityUtil.getStaleWindowInMinutes(undefined);

    const ageInMinutes: number =
      (NOW.getTime() - new Date(staleInput.lastSeenAt as Date).getTime()) /
      60000;

    expect(ageInMinutes).toBeGreaterThan(defaultWindowInMinutes * 100);
  });

  test("a fresh bucket is judged fresh, not merely recent", () => {
    const freshInput: DeviceHealthStateInput = deviceHealthInputForGroup({
      group: {
        siteId: null,
        monitorStatusId: null,
        monitoringMethod: null,
        isReachable: null,
        hasBeenPolled: true,
        hasBeenSeen: true,
        isStale: false,
        hasDownInterfaces: false,
        deviceCount: 1,
        interfacesDownTotal: 0,
      },
      now: NOW,
    });

    expect(deviceHealthState(freshInput, NOW)).toBe("healthy");
  });

  /*
   * A bucket says whether there are dark ports, not how many — the classifier
   * only asks "> 0". Reconstructing a count of 1 is what makes that true, and
   * a reconstruction that passed 0 would silently turn every degraded device
   * healthy.
   */
  test("a bucket with dark ports reconstructs as degraded", () => {
    expect(
      deviceHealthState(
        deviceHealthInputForGroup({
          group: {
            siteId: null,
            monitorStatusId: null,
            monitoringMethod: null,
            isReachable: true,
            hasBeenPolled: true,
            hasBeenSeen: true,
            isStale: false,
            hasDownInterfaces: true,
            deviceCount: 40,
            interfacesDownTotal: 91,
          },
          now: NOW,
        }),
        NOW,
      ),
    ).toBe("degraded");
  });

  /*
   * `deviceHealthState` must not start reading the monitoring method: it does
   * not today, and a bucket that carried it into the input would change every
   * monitor-backed device's verdict on the site cards without touching a
   * single line of the classifier.
   */
  test("carrying the monitoring method does not change the health verdict", () => {
    const base: DeviceHealthGroup = {
      siteId: null,
      monitorStatusId: null,
      monitoringMethod: null,
      isReachable: true,
      hasBeenPolled: true,
      hasBeenSeen: true,
      isStale: false,
      hasDownInterfaces: false,
      deviceCount: 1,
      interfacesDownTotal: 0,
    };

    const withMethod: DeviceHealthGroup = {
      ...base,
      monitoringMethod: "Monitor",
    };

    expect(
      deviceHealthState(
        deviceHealthInputForGroup({ group: withMethod, now: NOW }),
        NOW,
      ),
    ).toBe(
      deviceHealthState(
        deviceHealthInputForGroup({ group: base, now: NOW }),
        NOW,
      ),
    );
  });
});

describe("the SQL the buckets are built from", () => {
  function expressionFor(alias: string, columns: Array<AggregateColumn>): string {
    const column: AggregateColumn | undefined = columns.find(
      (candidate: AggregateColumn): boolean => {
        return candidate.alias === alias;
      },
    );

    if (!column) {
      throw new Error(`No aggregate column aliased "${alias}"`);
    }

    return column.expression;
  }

  const staleExpression: string = expressionFor(
    DeviceHealthGroupAlias.IsStale,
    DEVICE_HEALTH_GROUP_COLUMNS,
  );

  /*
   * The staleness window is the one rule that IS evaluated in SQL rather than
   * by the shared util, so the numbers in it have to come from the util's own
   * constants. Interpolated, they cannot drift; hard-coded, the database and
   * the pill would disagree about the same device the day either moves.
   */
  test("the stale window is built from the shared constants, not literals", () => {
    expect(staleExpression).toContain(
      `${DEFAULT_DEVICE_POLLING_INTERVAL_IN_MINUTES}`,
    );
    expect(staleExpression).toContain(`* ${DEVICE_MISSED_POLL_ALLOWANCE}`);
    expect(staleExpression).toContain(`${DEVICE_MIN_STALE_WINDOW_IN_MINUTES}`);
  });

  /*
   * GREATEST over both timestamps, because `newerOf` in the shared util does
   * the same: lastPolledAt alone is wrong for rows written before that column
   * existed, and lastSeenAt alone calls a device that is being polled and
   * failing "out of contact" when it is very much in contact.
   */
  test("staleness measures the newer of the two contact timestamps", () => {
    expect(staleExpression).toContain(
      `GREATEST("NetworkDevice"."lastPolledAt", "NetworkDevice"."lastSeenAt")`,
    );
  });

  /*
   * "Now" is bound rather than taken from the database clock, so every bucket
   * on a response — and the classifier that reads them — is measured against
   * one instant.
   */
  test('"now" is a bound parameter, not NOW()', () => {
    expect(staleExpression).toContain(`:${DEVICE_HEALTH_NOW_PARAMETER}`);
    expect(staleExpression).not.toContain("NOW()");
    expect(staleExpression).not.toContain("CURRENT_TIMESTAMP");
  });

  /*
   * Every fact the classifier reads has to be a group key. One missing and
   * devices that classify differently share a bucket, so one of them gets the
   * other's verdict — with no error anywhere.
   */
  test("the group keys cover every input the classifiers read", () => {
    const aliases: Array<string> = DEVICE_HEALTH_GROUP_COLUMNS.map(
      (column: AggregateColumn): string => {
        return column.alias;
      },
    );

    expect(aliases.sort()).toEqual(
      [
        DeviceHealthGroupAlias.MonitorStatusId,
        DeviceHealthGroupAlias.MonitoringMethod,
        DeviceHealthGroupAlias.IsReachable,
        DeviceHealthGroupAlias.HasBeenPolled,
        DeviceHealthGroupAlias.HasBeenSeen,
        DeviceHealthGroupAlias.IsStale,
        DeviceHealthGroupAlias.HasDownInterfaces,
      ].sort(),
    );
  });

  test("the per-site grouping adds the site and changes nothing else", () => {
    expect(DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE).toHaveLength(
      DEVICE_HEALTH_GROUP_COLUMNS.length + 1,
    );
    expect(DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE[0]?.alias).toBe(
      DeviceHealthGroupAlias.SiteId,
    );
    expect(DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE.slice(1)).toEqual(
      DEVICE_HEALTH_GROUP_COLUMNS,
    );
  });

  /*
   * Interfaces are SUMmed, not counted. A switch with three dark ports has to
   * contribute three, or the fleet's "interfaces down" figure silently becomes
   * "devices with an interface down" — a smaller number that looks just as
   * plausible.
   */
  test("dark ports are summed, and the bucket count is a count", () => {
    expect(INTERFACES_DOWN_AGGREGATE.expression).toContain(
      `SUM("NetworkDevice"."interfacesDown")`,
    );
    // SUM over no rows is NULL in SQL; the tile must print 0.
    expect(INTERFACES_DOWN_AGGREGATE.expression).toContain("COALESCE");
    expect(DEVICE_COUNT_AGGREGATE.expression).toBe("COUNT(*)");
    expect(DEVICE_HEALTH_AGGREGATES).toEqual([
      DEVICE_COUNT_AGGREGATE,
      INTERFACES_DOWN_AGGREGATE,
    ]);
  });

  /*
   * Grouping by the raw `interfacesDown` value would produce a bucket per
   * distinct port count — close to one per device on a real fleet, which is
   * the whole cost this exists to remove.
   */
  test("interface counts are grouped as a boolean, not by value", () => {
    expect(
      expressionFor(
        DeviceHealthGroupAlias.HasDownInterfaces,
        DEVICE_HEALTH_GROUP_COLUMNS,
      ),
    ).toContain("> 0");
  });

  test("every column is qualified with the model alias", () => {
    for (const column of [
      ...DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE,
      ...DEVICE_HEALTH_AGGREGATES,
    ]) {
      if (column.expression.includes('"')) {
        expect(column.expression).toContain(`"NetworkDevice"."`);
      }
    }
  });
});

describe("reading a bucket back off the wire", () => {
  /*
   * Postgres hands COUNT and SUM back as strings. A parser that trusted the
   * runtime type would give the site cards numbers that render fine and then
   * add by concatenating.
   */
  test("counts arrive as strings and come back as numbers", () => {
    const row: AggregateRow = {
      [DeviceHealthGroupAlias.SiteId]: "site-1",
      [DeviceHealthGroupAlias.MonitorStatusId]: null,
      [DeviceHealthGroupAlias.MonitoringMethod]: "SNMP",
      [DeviceHealthGroupAlias.IsReachable]: true,
      [DeviceHealthGroupAlias.HasBeenPolled]: true,
      [DeviceHealthGroupAlias.HasBeenSeen]: true,
      [DeviceHealthGroupAlias.IsStale]: false,
      [DeviceHealthGroupAlias.HasDownInterfaces]: true,
      [DeviceHealthGroupAlias.DeviceCount]: "1204",
      [DeviceHealthGroupAlias.InterfacesDownTotal]: "3311",
    };

    const group: DeviceHealthGroup = parseDeviceHealthGroup(row);

    expect(group.deviceCount).toBe(1204);
    expect(group.interfacesDownTotal).toBe(3311);
    expect(group.siteId).toBe("site-1");
    expect(group.monitoringMethod).toBe("SNMP");
  });

  /*
   * `isReachable` is three-state and NULL is a real answer — "never polled".
   * Collapsing it to false would turn every unpolled device into a down one.
   */
  test("a null isReachable stays null rather than becoming false", () => {
    const group: DeviceHealthGroup = parseDeviceHealthGroup({
      [DeviceHealthGroupAlias.IsReachable]: null,
      [DeviceHealthGroupAlias.DeviceCount]: "7",
    });

    expect(group.isReachable).toBeNull();
    expect(group.deviceCount).toBe(7);
  });

  test("booleans in Postgres's short form are read correctly", () => {
    const group: DeviceHealthGroup = parseDeviceHealthGroup({
      [DeviceHealthGroupAlias.IsStale]: "t",
      [DeviceHealthGroupAlias.HasBeenPolled]: "f",
      [DeviceHealthGroupAlias.IsReachable]: "t",
      [DeviceHealthGroupAlias.DeviceCount]: "1",
    });

    expect(group.isStale).toBe(true);
    expect(group.hasBeenPolled).toBe(false);
    expect(group.isReachable).toBe(true);
  });

  /*
   * Devices with no site group under a NULL key. They belong to no level of
   * the hierarchy, and a parser that turned that into the empty string would
   * bucket them all under whichever site happened to have "" as an id.
   */
  test("a bucket with no site is null, not an empty string", () => {
    const group: DeviceHealthGroup = parseDeviceHealthGroup({
      [DeviceHealthGroupAlias.SiteId]: null,
      [DeviceHealthGroupAlias.DeviceCount]: "3",
    });

    expect(group.siteId).toBeNull();
  });
});
