import { describe, expect, test } from "@jest/globals";
import {
  NETWORK_DEVICE_REFRESH_GIVE_UP_MS,
  NETWORK_DEVICE_REFRESH_PENDING_MS,
  NETWORK_DEVICE_REFRESH_POLL_AT,
  NetworkDeviceRefreshProgress,
  canRefreshNetworkDevice,
  getNetworkDeviceRefreshProgress,
  getNetworkDeviceRefreshReaders,
  isFirstPollSinceRefresh,
  isNetworkDeviceRefreshPending,
} from "../../../Utils/NetworkDevice/NetworkDeviceRefresh";

/*
 * Refresh: who can be asked to read a network device again now, when a
 * second ask is the first one, which poll answers it, and where it stands -
 * shared by the refresh route, the poll pipeline and the Dashboard's button.
 */

const PROBE_ID: string = "30000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-28T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

const CONTROLLER_READING: Record<string, unknown> = {
  provider: "meraki",
  readBy: {
    type: "networkController",
    id: "22222222-2222-4222-8222-222222222222",
    name: "Acme Retail",
  },
  readAt: "2026-10-28T11:55:00.000Z",
  values: { model: "MR46" },
};

describe("who can be asked to read a device again", () => {
  test("its probe, when one polls it: polling on, a probe, an address, not monitor-backed", () => {
    expect(
      getNetworkDeviceRefreshReaders({
        probeId: PROBE_ID,
        hostname: "10.0.0.2",
        isPollingEnabled: true,
        monitoringMethod: "Probe",
      }),
    ).toEqual({ isProbePolled: true });

    // Rows from before ping-first polling read as probe-polled.
    for (const legacy of [undefined, null, "", "SNMP"]) {
      expect(
        getNetworkDeviceRefreshReaders({
          probeId: PROBE_ID,
          hostname: "10.0.0.2",
          monitoringMethod: legacy,
        }).isProbePolled,
      ).toBe(true);
    }
  });

  test.each([
    ["no probe", { probeId: undefined }],
    ["no address", { hostname: " " }],
    ["polling off", { isPollingEnabled: false }],
    ["monitor-backed", { monitoringMethod: "Monitor" }],
  ])("not its probe: %s", (_: string, overrides: Record<string, unknown>) => {
    expect(
      getNetworkDeviceRefreshReaders({
        probeId: PROBE_ID,
        hostname: "10.0.0.2",
        isPollingEnabled: true,
        ...overrides,
      }).isProbePolled,
    ).toBe(false);
  });

  test("its controller, when a connection keeps a reading on it", () => {
    const readers: ReturnType<typeof getNetworkDeviceRefreshReaders> =
      getNetworkDeviceRefreshReaders({
        monitoringMethod: "Monitor",
        discoveredDetails: { controller: CONTROLLER_READING },
      });

    expect(readers.isProbePolled).toBe(false);
    expect(readers.controller?.readBy.id).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  test("Refresh is offered when either can, and only then", () => {
    expect(
      canRefreshNetworkDevice({ probeId: PROBE_ID, hostname: "10.0.0.2" }),
    ).toBe(true);
    expect(
      canRefreshNetworkDevice({
        discoveredDetails: { controller: CONTROLLER_READING },
      }),
    ).toBe(true);
    expect(canRefreshNetworkDevice({ hostname: "10.0.0.2" })).toBe(false);
    expect(
      canRefreshNetworkDevice({
        probeId: PROBE_ID,
        hostname: "10.0.0.2",
        monitoringMethod: "Monitor",
        discoveredDetails: { controller: "forged" },
      }),
    ).toBe(false);
  });
});

describe("a second ask is the first one", () => {
  test("within a minute of the first, while it waits for its poll", () => {
    expect(
      isNetworkDeviceRefreshPending({
        refreshRequestedAt: new Date(NOW.getTime() - 30 * SECOND),
        lastPolledAt: new Date(NOW.getTime() - 4 * MINUTE),
        now: NOW,
      }),
    ).toBe(true);
    // Never polled at all yet.
    expect(
      isNetworkDeviceRefreshPending({
        refreshRequestedAt: new Date(NOW.getTime() - 30 * SECOND).toISOString(),
        lastPolledAt: undefined,
        now: NOW,
      }),
    ).toBe(true);
  });

  test("not once its poll landed, nor a minute on, nor without a first", () => {
    expect(
      isNetworkDeviceRefreshPending({
        refreshRequestedAt: new Date(NOW.getTime() - 30 * SECOND),
        lastPolledAt: new Date(NOW.getTime() - 10 * SECOND),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isNetworkDeviceRefreshPending({
        refreshRequestedAt: new Date(
          NOW.getTime() - NETWORK_DEVICE_REFRESH_PENDING_MS,
        ),
        lastPolledAt: undefined,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isNetworkDeviceRefreshPending({
        refreshRequestedAt: undefined,
        lastPolledAt: undefined,
        now: NOW,
      }),
    ).toBe(false);
    // A clock ahead of ours is no ask from the future.
    expect(
      isNetworkDeviceRefreshPending({
        refreshRequestedAt: new Date(NOW.getTime() + MINUTE),
        lastPolledAt: undefined,
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("the poll that answers it", () => {
  test("the first poll since the ask, and only that one", () => {
    const askedAt: Date = new Date(NOW.getTime() - MINUTE);

    expect(
      isFirstPollSinceRefresh({
        refreshRequestedAt: askedAt,
        previousLastPolledAt: new Date(NOW.getTime() - 5 * MINUTE),
      }),
    ).toBe(true);
    expect(
      isFirstPollSinceRefresh({
        refreshRequestedAt: askedAt,
        previousLastPolledAt: undefined,
      }),
    ).toBe(true);
    expect(
      isFirstPollSinceRefresh({
        refreshRequestedAt: askedAt,
        previousLastPolledAt: new Date(NOW.getTime() - 30 * SECOND),
      }),
    ).toBe(false);
    expect(
      isFirstPollSinceRefresh({
        refreshRequestedAt: null,
        previousLastPolledAt: undefined,
      }),
    ).toBe(false);
    expect(
      isFirstPollSinceRefresh({
        refreshRequestedAt: "not a time",
        previousLastPolledAt: undefined,
      }),
    ).toBe(false);
  });

  test("a refreshed device goes first in its probe's queue", () => {
    expect(NETWORK_DEVICE_REFRESH_POLL_AT.getTime()).toBe(0);
  });
});

describe("where a refresh stands", () => {
  const askedAt: Date = new Date(NOW.getTime() - 20 * SECOND);

  test("waiting for its probe", () => {
    expect(
      getNetworkDeviceRefreshProgress({
        requestedAt: askedAt,
        lastPolledAt: new Date(NOW.getTime() - 3 * MINUTE),
        isReachable: true,
        now: NOW,
      }),
    ).toBe(NetworkDeviceRefreshProgress.Waiting);
  });

  test("read, once a poll landed and reached it", () => {
    expect(
      getNetworkDeviceRefreshProgress({
        requestedAt: askedAt,
        lastPolledAt: new Date(NOW.getTime() - 5 * SECOND).toISOString(),
        isReachable: true,
        now: NOW,
      }),
    ).toBe(NetworkDeviceRefreshProgress.Read);
  });

  test("unreachable, when that poll could not reach it", () => {
    expect(
      getNetworkDeviceRefreshProgress({
        requestedAt: askedAt,
        lastPolledAt: new Date(NOW.getTime() - 5 * SECOND),
        isReachable: false,
        now: NOW,
      }),
    ).toBe(NetworkDeviceRefreshProgress.Unreachable);
  });

  test("late, when nothing polled it in the time a poll takes", () => {
    expect(
      getNetworkDeviceRefreshProgress({
        requestedAt: new Date(
          NOW.getTime() - NETWORK_DEVICE_REFRESH_GIVE_UP_MS,
        ),
        lastPolledAt: undefined,
        isReachable: undefined,
        now: NOW,
      }),
    ).toBe(NetworkDeviceRefreshProgress.Late);
    expect(NETWORK_DEVICE_REFRESH_GIVE_UP_MS).toBe(3 * MINUTE);
  });
});
