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
import { DEVICE_FRESH_WINDOW_MINUTES } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";

/*
 * The Network Overview page's fleet rollups. Device freshness runs
 * through DeviceStatusUtil, which reads the wall clock — so these freeze
 * time the same way DeviceStatusUtil.test.ts does.
 */

const NOW: Date = new Date("2026-07-16T12:00:00.000Z");
const MS_PER_MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MS_PER_MINUTE);
}

const FRESH: Date = minutesAgo(1);
const STALE: Date = minutesAgo(DEVICE_FRESH_WINDOW_MINUTES + 5);
const STALER: Date = minutesAgo(DEVICE_FRESH_WINDOW_MINUTES + 60);

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
      { _id: "a", lastSeenAt: FRESH, interfacesDown: 0 },
      { _id: "b", lastSeenAt: STALE, interfacesDown: 2 },
      { _id: "c", lastSeenAt: undefined, interfacesDown: undefined },
      { _id: "d", lastSeenAt: FRESH, interfacesDown: 3 },
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
  test("unreachable devices come first, stalest first", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "recent-down", lastSeenAt: STALE },
      { _id: "old-down", lastSeenAt: STALER },
      { _id: "healthy", lastSeenAt: FRESH },
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
      { _id: "one-down", lastSeenAt: FRESH, interfacesDown: 1 },
      { _id: "hard-down", lastSeenAt: STALE },
      { _id: "three-down", lastSeenAt: FRESH, interfacesDown: 3 },
      { _id: "clean", lastSeenAt: FRESH, interfacesDown: 0 },
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
      { _id: "never-seen", lastSeenAt: undefined, interfacesDown: 0 },
    ];

    expect(pickDevicesNeedingAttention(devices, 10)).toEqual([]);
  });

  test("respects the limit", () => {
    const devices: Array<OverviewDeviceRow> = [
      { _id: "a", lastSeenAt: STALE },
      { _id: "b", lastSeenAt: STALER },
      { _id: "c", lastSeenAt: FRESH, interfacesDown: 1 },
    ];

    expect(pickDevicesNeedingAttention(devices, 2)).toHaveLength(2);
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
