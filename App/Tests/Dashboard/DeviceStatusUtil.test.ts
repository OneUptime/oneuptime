import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DeviceStatusUtil, {
  DEVICE_FRESH_WINDOW_MINUTES,
  NetworkDeviceStatus,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";

/*
 * DeviceStatusUtil classifies a device from its lastSeenAt timestamp:
 * never seen -> Pending, seen within the freshness window -> Up, older ->
 * Down. The cutoff is computed from the wall clock inside getStatus, so
 * these tests freeze time with jest's fake timers — that is the only way
 * the "exactly at the boundary" case is deterministic.
 */

// The frozen "now" every test in this file runs at.
const NOW: Date = new Date("2026-07-16T12:00:00.000Z");

const MS_PER_MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number, extraMs: number = 0): Date {
  return new Date(NOW.getTime() - minutes * MS_PER_MINUTE - extraMs);
}

describe("DEVICE_FRESH_WINDOW_MINUTES", () => {
  test("is 15 minutes — the window the device list and topology agree on", () => {
    expect(DEVICE_FRESH_WINDOW_MINUTES).toBe(15);
  });
});

describe("NetworkDeviceStatus", () => {
  test("carries the display strings the device list renders", () => {
    expect(NetworkDeviceStatus.Up).toBe("Up");
    expect(NetworkDeviceStatus.Down).toBe("Down");
    expect(NetworkDeviceStatus.Pending).toBe("Pending");
  });
});

describe("DeviceStatusUtil.getStatus", () => {
  beforeEach(() => {
    /*
     * Only Date needs faking; the sinon backend jest 28 uses cannot hijack
     * the read-only `performance` global on current Node, so leave the
     * timer/callback APIs alone.
     */
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

  describe("devices that were never polled", () => {
    test("undefined lastSeenAt is Pending", () => {
      expect(DeviceStatusUtil.getStatus(undefined)).toBe(
        NetworkDeviceStatus.Pending,
      );
    });

    test("null lastSeenAt (raw API payloads) is Pending", () => {
      expect(DeviceStatusUtil.getStatus(null as unknown as undefined)).toBe(
        NetworkDeviceStatus.Pending,
      );
    });

    test("empty-string lastSeenAt is Pending", () => {
      expect(DeviceStatusUtil.getStatus("")).toBe(NetworkDeviceStatus.Pending);
    });
  });

  describe("devices seen within the fresh window", () => {
    test("seen right now is Up", () => {
      expect(DeviceStatusUtil.getStatus(new Date(NOW))).toBe(
        NetworkDeviceStatus.Up,
      );
    });

    test("seen one minute ago is Up", () => {
      expect(DeviceStatusUtil.getStatus(minutesAgo(1))).toBe(
        NetworkDeviceStatus.Up,
      );
    });

    test("seen one millisecond inside the window is Up", () => {
      expect(
        DeviceStatusUtil.getStatus(minutesAgo(DEVICE_FRESH_WINDOW_MINUTES, -1)),
      ).toBe(NetworkDeviceStatus.Up);
    });

    test("a slightly future lastSeenAt (probe clock skew) is Up, not Down", () => {
      expect(DeviceStatusUtil.getStatus(minutesAgo(-1))).toBe(
        NetworkDeviceStatus.Up,
      );
    });

    test("accepts an ISO string the API serializes", () => {
      expect(DeviceStatusUtil.getStatus("2026-07-16T11:55:00.000Z")).toBe(
        NetworkDeviceStatus.Up,
      );
    });
  });

  describe("the boundary", () => {
    /*
     * The util uses a strict `lastSeen < cutoff` comparison, so a device
     * seen exactly DEVICE_FRESH_WINDOW_MINUTES ago sits ON the cutoff and
     * is still Up — only strictly older timestamps go Down. This pins the
     * comparator's direction; if the comparison ever becomes `<=`, this
     * test is the one that must be consciously flipped.
     */
    test("seen exactly 15 minutes ago is still Up (strict comparison)", () => {
      expect(
        DeviceStatusUtil.getStatus(minutesAgo(DEVICE_FRESH_WINDOW_MINUTES)),
      ).toBe(NetworkDeviceStatus.Up);
    });

    test("seen one millisecond past the window is Down", () => {
      expect(
        DeviceStatusUtil.getStatus(minutesAgo(DEVICE_FRESH_WINDOW_MINUTES, 1)),
      ).toBe(NetworkDeviceStatus.Down);
    });
  });

  describe("stale devices", () => {
    test("seen sixteen minutes ago is Down", () => {
      expect(DeviceStatusUtil.getStatus(minutesAgo(16))).toBe(
        NetworkDeviceStatus.Down,
      );
    });

    test("seen hours ago via an ISO string is Down", () => {
      expect(DeviceStatusUtil.getStatus("2026-07-16T08:00:00.000Z")).toBe(
        NetworkDeviceStatus.Down,
      );
    });

    test("seen days ago is Down", () => {
      expect(
        DeviceStatusUtil.getStatus(new Date("2026-07-01T00:00:00.000Z")),
      ).toBe(NetworkDeviceStatus.Down);
    });
  });
});
