import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  OverviewDeviceRow,
  OverviewSiteRow,
  pickDevicesNeedingAttention,
  pickSitesNeedingAttention,
  summarizeDeviceFleet,
  summarizeVendors,
} from "../../FeatureSet/Dashboard/src/Components/Network/NetworkOverviewUtil";
/*
 * The Network Overview page's fleet rollups. Device status runs through
 * DeviceStatusUtil, which reads the wall clock — so these freeze time the
 * same way the topology and rollup suites do.
 *
 * The rows here spell out the reachability columns rather than leaning on
 * lastSeenAt alone, because that is what the page selects
 * (DEVICE_STATUS_SELECT) and because the difference between "did not
 * answer" and "not asked recently" is the point of the fix these guard
 * (issue #3220).
 */

const NOW: Date = new Date("2026-07-16T12:00:00.000Z");
const MS_PER_MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MS_PER_MINUTE);
}

// A device whose last poll succeeded `minutes` ago.
function answered(minutes: number): Partial<OverviewDeviceRow> {
  return {
    isReachable: true,
    lastPolledAt: minutesAgo(minutes),
    lastSeenAt: minutesAgo(minutes),
    pollingIntervalInMinutes: 5,
  };
}

// A device whose last poll failed `minutes` ago.
function unreachable(
  minutes: number,
  lastAnsweredMinutesAgo: number,
): Partial<OverviewDeviceRow> {
  return {
    isReachable: false,
    lastPolledAt: minutesAgo(minutes),
    lastSeenAt: minutesAgo(lastAnsweredMinutesAgo),
    pollingIntervalInMinutes: 5,
  };
}

const HEALTHY: Partial<OverviewDeviceRow> = answered(1);
// Failed its last poll a minute ago; last answered 20 minutes ago.
const DOWN: Partial<OverviewDeviceRow> = unreachable(1, 20);
// Failed its last poll a minute ago; has not answered for hours.
const LONGER_DOWN: Partial<OverviewDeviceRow> = unreachable(1, 300);

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      "performance",
      "hrtime",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("summarizeDeviceFleet", () => {
  test("splits the fleet into up / down / pending and sums down interfaces", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "a", ...HEALTHY, interfacesDown: 0 },
      { _id: "b", ...DOWN, interfacesDown: 2 },
      { _id: "c", interfacesDown: undefined },
      { _id: "d", ...HEALTHY, interfacesDown: 3 },
    ];

    expect(summarizeDeviceFleet(devices)).toEqual({
      total: 4,
      up: 2,
      down: 1,
      pending: 1,
      interfacesDown: 5,
    });
  });

  test("an empty fleet is all zeroes", () => {
    expect(summarizeDeviceFleet([])).toEqual({
      total: 0,
      up: 0,
      down: 0,
      pending: 0,
      interfacesDown: 0,
    });
  });
});

describe("pickDevicesNeedingAttention", () => {
  test("unreachable devices come first, longest-silent first", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "recent-down", ...DOWN },
      { _id: "old-down", ...LONGER_DOWN },
      { _id: "healthy", ...HEALTHY },
    ];

    const picked: Array<OverviewDeviceRow> = pickDevicesNeedingAttention(
      devices,
      10,
    );

    expect(
      picked.map((device: OverviewDeviceRow) => {
        return device._id;
      }),
    ).toEqual(["old-down", "recent-down"]);
  });

  test("reachable devices with down interfaces follow, most down first", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "one-down", ...HEALTHY, interfacesDown: 1 },
      { _id: "hard-down", ...DOWN },
      { _id: "three-down", ...HEALTHY, interfacesDown: 3 },
      { _id: "clean", ...HEALTHY, interfacesDown: 0 },
    ];

    const picked: Array<OverviewDeviceRow> = pickDevicesNeedingAttention(
      devices,
      10,
    );

    expect(
      picked.map((device: OverviewDeviceRow) => {
        return device._id;
      }),
    ).toEqual(["hard-down", "three-down", "one-down"]);
  });

  test("pending (never-polled) devices are onboarding, not outages", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "never-polled", interfacesDown: 0 },
    ];

    expect(pickDevicesNeedingAttention(devices, 10)).toEqual([]);
  });

  test("respects the limit", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "a", ...DOWN },
      { _id: "b", ...LONGER_DOWN },
      { _id: "c", ...HEALTHY, interfacesDown: 1 },
    ];

    expect(pickDevicesNeedingAttention(devices, 2)).toHaveLength(2);
  });
});

/*
 * Issue #3220 at the page that summarises the whole fleet: the Overview's
 * "devices down" number was the same freshness count as the list's tile,
 * so on a fleet its probe could not keep up with it reported hundreds of
 * healthy devices as down.
 */
describe("issue #3220 — a fleet its probe cannot keep up with", () => {
  test("devices answering 21 minutes apart are all counted up", () => {
    const devices: Array<OverviewDeviceRow> = [16, 19, 21, 25, 30].map(
      (ageInMinutes: number, index: number): OverviewDeviceRow => {
        return { _id: `d${index}`, ...answered(ageInMinutes) };
      },
    );

    expect(summarizeDeviceFleet(devices)).toMatchObject({
      total: 5,
      up: 5,
      down: 0,
      pending: 0,
    });
  });

  test("none of them are put in front of a human as needing attention", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "lagging", ...answered(21) },
      { _id: "really-down", ...DOWN },
    ];

    expect(
      pickDevicesNeedingAttention(devices, 10).map(
        (device: OverviewDeviceRow) => {
          return device._id;
        },
      ),
    ).toEqual(["really-down"]);
  });

  /*
   * A fleet nothing has polled for hours keeps its last known verdicts, so
   * this summary matches the device list's tiles — which are SQL counts
   * over `isReachable` and cannot express a per-device staleness window.
   * The two pages disagreeing about the same fleet is the inconsistency
   * issue #3220 was reported as.
   */
  test("a fleet nothing has polled for hours keeps its last known verdicts", () => {
    const devices: Array<OverviewDeviceRow> = [1, 2, 3].map(
      (index: number): OverviewDeviceRow => {
        return { _id: `d${index}`, ...answered(240) };
      },
    );

    expect(summarizeDeviceFleet(devices)).toMatchObject({
      total: 3,
      up: 3,
      down: 0,
    });
  });
});

describe("pickSitesNeedingAttention", () => {
  test("only sites with a non-operational rollup qualify", () => {
    const sites: Array<OverviewSiteRow> = [
      { _id: "healthy", statusName: "Operational", isOperational: true },
      { _id: "down", statusName: "Offline", isOperational: false },
      { _id: "no-data", statusName: undefined, isOperational: undefined },
    ];

    const picked: Array<OverviewSiteRow> = pickSitesNeedingAttention(sites, 10);

    expect(
      picked.map((site: OverviewSiteRow) => {
        return site._id;
      }),
    ).toEqual(["down"]);
  });

  test("a site with no rollup yet is never flagged", () => {
    // isOperational false but no status name = inconsistent row; skip it.
    expect(
      pickSitesNeedingAttention(
        [{ _id: "weird", statusName: undefined, isOperational: false }],
        10,
      ),
    ).toEqual([]);
  });
});

describe("summarizeVendors", () => {
  test("groups by vendor, largest first, alphabetical on ties", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "a", vendor: "Cisco" },
      { _id: "b", vendor: "Cisco" },
      { _id: "c", vendor: "Juniper" },
      { _id: "d", vendor: "Arista" },
    ];

    expect(summarizeVendors(devices, 10)).toEqual([
      { vendor: "Cisco", count: 2 },
      { vendor: "Arista", count: 1 },
      { vendor: "Juniper", count: 1 },
    ]);
  });

  test("missing or blank vendors group as Unknown", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "a", vendor: undefined },
      { _id: "b", vendor: "   " },
    ];

    expect(summarizeVendors(devices, 10)).toEqual([
      { vendor: "Unknown", count: 2 },
    ]);
  });

  test("respects the limit", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "a", vendor: "Cisco" },
      { _id: "b", vendor: "Juniper" },
      { _id: "c", vendor: "Arista" },
    ];

    expect(summarizeVendors(devices, 2)).toHaveLength(2);
  });
});
