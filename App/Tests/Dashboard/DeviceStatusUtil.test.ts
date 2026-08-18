import { describe, expect, test } from "@jest/globals";
import DeviceStatusUtil, {
  DEVICE_MIN_STALE_WINDOW_IN_MINUTES,
  DEVICE_MISSED_POLL_ALLOWANCE,
  DEVICE_STATUS_SELECT,
  DeviceReachabilityResult,
  NetworkDeviceStatus,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";

/*
 * DeviceStatusUtil is the dashboard's door onto the shared reachability
 * rule (Common/Utils/NetworkDevice/DeviceReachabilityUtil, which has the
 * exhaustive matrix). What is pinned here is the part the dashboard owns:
 * that the door delegates rather than re-deciding, that it accepts a
 * NetworkDevice row as-is, and that DEVICE_STATUS_SELECT names every column
 * the rule reads — a page that selects a subset silently falls back to the
 * legacy freshness path and puts the bug back.
 *
 * Time is not faked: getStatus reads the wall clock, so every case here is
 * expressed as an offset from `Date.now()` at call time, which is what a
 * page render actually does.
 */

const MS_PER_MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MS_PER_MINUTE);
}

describe("DEVICE_STATUS_SELECT", () => {
  /*
   * The exact set the rule reads. If a column is added to the rule and not
   * here, every page keeps compiling and quietly starts getting the wrong
   * answer — so the set is asserted whole, not key by key.
   */
  test("names every column the reachability rule reads", () => {
    expect(DEVICE_STATUS_SELECT).toEqual({
      isReachable: true,
      lastPolledAt: true,
      lastSeenAt: true,
      pollingIntervalInMinutes: true,
    });
  });

  test("spreads into a ModelAPI select without nesting", () => {
    const select: Record<string, unknown> = {
      ...DEVICE_STATUS_SELECT,
      name: true,
    };

    expect(select["isReachable"]).toBe(true);
    expect(select["lastPolledAt"]).toBe(true);
    expect(select["name"]).toBe(true);
  });
});

describe("the constants the dashboard copy quotes", () => {
  test("are re-exported so a tooltip cannot drift from the rule", () => {
    expect(DEVICE_MISSED_POLL_ALLOWANCE).toBe(10);
    expect(DEVICE_MIN_STALE_WINDOW_IN_MINUTES).toBe(60);
  });
});

describe("NetworkDeviceStatus", () => {
  test("carries the display strings the pills render", () => {
    expect(NetworkDeviceStatus.Up).toBe("Up");
    expect(NetworkDeviceStatus.Down).toBe("Down");
    expect(NetworkDeviceStatus.Pending).toBe("Pending");
  });
});

describe("DeviceStatusUtil.getStatus", () => {
  test("a device whose last poll succeeded is Up", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  test("a device whose last poll failed is Down", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(40),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceStatus.Down);
  });

  test("a device that has never been polled is Pending", () => {
    expect(DeviceStatusUtil.getStatus({})).toBe(NetworkDeviceStatus.Pending);
  });

  /*
   * Issue #3220. The device in the report answered SNMP — its Interfaces
   * tab showed 14 ports up — but its probe, 980 devices behind, had not got
   * back to it for 21 minutes, and the pill said Down.
   */
  test("issue #3220: a device polled 21 minutes ago on a 5-minute interval is Up", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(21),
        lastSeenAt: minutesAgo(21),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  test("a device on a 30-minute interval is not permanently Down", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(29),
        lastSeenAt: minutesAgo(29),
        pollingIntervalInMinutes: 30,
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  test("a device nothing has polled for hours is Down", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(180),
        lastSeenAt: minutesAgo(180),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceStatus.Down);
  });

  test("accepts the ISO strings a NetworkDevice row carries after a fetch", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(2).toISOString(),
        lastSeenAt: minutesAgo(2).toISOString(),
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  /*
   * The one that keeps the fix honest under a partial select: a page that
   * forgets isReachable gets the legacy freshness answer, and this pins
   * that it is at least the GENEROUS freshness answer rather than the
   * 15-minute one the bug came from.
   */
  test("a row with only lastSeenAt still falls back to freshness", () => {
    expect(DeviceStatusUtil.getStatus({ lastSeenAt: minutesAgo(21) })).toBe(
      NetworkDeviceStatus.Up,
    );
    expect(DeviceStatusUtil.getStatus({ lastSeenAt: minutesAgo(180) })).toBe(
      NetworkDeviceStatus.Down,
    );
  });
});

describe("DeviceStatusUtil.getReachability", () => {
  test("hands the pill everything it needs to explain itself", () => {
    const result: DeviceReachabilityResult = DeviceStatusUtil.getReachability({
      isReachable: true,
      lastPolledAt: minutesAgo(180),
      lastSeenAt: minutesAgo(180),
      pollingIntervalInMinutes: 5,
    });

    expect(result.status).toBe(NetworkDeviceStatus.Down);
    expect(result.isStale).toBe(true);
    expect(result.staleWindowInMinutes).toBe(60);
    expect(result.lastContactAt).toBeInstanceOf(Date);
  });

  /*
   * The two Down tooltips say different things — "check the device" versus
   * "check the probe" — and isStale is what picks between them.
   */
  test("a device that answered nothing is Down but not stale", () => {
    const result: DeviceReachabilityResult = DeviceStatusUtil.getReachability({
      isReachable: false,
      lastPolledAt: minutesAgo(1),
      lastSeenAt: minutesAgo(600),
      pollingIntervalInMinutes: 5,
    });

    expect(result.status).toBe(NetworkDeviceStatus.Down);
    expect(result.isStale).toBe(false);
  });
});

describe("DeviceStatusUtil.getStaleWindowInMinutes", () => {
  test("scales with the device's own interval, floored at an hour", () => {
    expect(DeviceStatusUtil.getStaleWindowInMinutes(5)).toBe(60);
    expect(DeviceStatusUtil.getStaleWindowInMinutes(undefined)).toBe(60);
    expect(DeviceStatusUtil.getStaleWindowInMinutes(30)).toBe(300);
  });
});
