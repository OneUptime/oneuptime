import { describe, expect, test } from "@jest/globals";
import {
  ResourceConnectionState,
  getResourceConnectionState,
  getResourceLastSeenDate,
  isResourceStatusConnected,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionState";

/*
 * What the "how do I connect this?" card on a resource overview reads off
 * the resource: connected (draw nothing), never connected (install the
 * agent) or connected once and then stopped (check on the agent).
 *
 * The status words mirror every overview hero's badge - "connected" and
 * "active", in any case - so the card and the badge above it cannot
 * disagree.
 */

describe("isResourceStatusConnected", () => {
  test.each([
    ["connected", true],
    ["active", true],
    ["Connected", true],
    ["ACTIVE", true],
    ["disconnected", false],
    ["inactive", false],
    ["Disconnected", false],
    ["connecting", false],
    ["", false],
  ])("%p reads as connected: %p", (status: string, expected: boolean) => {
    expect(isResourceStatusConnected(status)).toBe(expected);
  });

  test("a missing status is not connected", () => {
    expect(isResourceStatusConnected(undefined)).toBe(false);
    expect(isResourceStatusConnected(null)).toBe(false);
  });
});

describe("getResourceLastSeenDate", () => {
  test("a Date is returned as it is", () => {
    const seen: Date = new Date("2026-09-30T10:00:00.000Z");

    expect(getResourceLastSeenDate(seen)).toBe(seen);
  });

  test("an ISO string (as the API can hand it back) is parsed", () => {
    expect(
      getResourceLastSeenDate("2026-09-30T10:00:00.000Z")?.toISOString(),
    ).toBe("2026-09-30T10:00:00.000Z");
  });

  test("nothing seen is null", () => {
    expect(getResourceLastSeenDate(undefined)).toBeNull();
    expect(getResourceLastSeenDate(null)).toBeNull();
    expect(getResourceLastSeenDate("")).toBeNull();
  });

  test("a value that is not a date is treated as never seen", () => {
    expect(getResourceLastSeenDate("not a date")).toBeNull();
    expect(getResourceLastSeenDate(new Date("nope"))).toBeNull();
  });
});

describe("getResourceConnectionState", () => {
  const SEEN: Date = new Date("2026-09-30T10:00:00.000Z");

  test("a connected resource is Connected, whether or not lastSeenAt is set", () => {
    expect(
      getResourceConnectionState({ status: "connected", lastSeenAt: SEEN }),
    ).toBe(ResourceConnectionState.Connected);
    expect(
      getResourceConnectionState({ status: "connected", lastSeenAt: null }),
    ).toBe(ResourceConnectionState.Connected);
    expect(
      getResourceConnectionState({ status: "active", lastSeenAt: undefined }),
    ).toBe(ResourceConnectionState.Connected);
  });

  test("a resource created by hand (default status, never seen) is NeverConnected", () => {
    // The columns' defaults: otelCollectorStatus 'disconnected', no lastSeenAt.
    expect(
      getResourceConnectionState({ status: "disconnected", lastSeenAt: null }),
    ).toBe(ResourceConnectionState.NeverConnected);
  });

  test("no status and no lastSeenAt is NeverConnected", () => {
    expect(
      getResourceConnectionState({ status: undefined, lastSeenAt: undefined }),
    ).toBe(ResourceConnectionState.NeverConnected);
    expect(getResourceConnectionState({ status: null, lastSeenAt: null })).toBe(
      ResourceConnectionState.NeverConnected,
    );
  });

  test("a resource that reported before and was then marked disconnected is Disconnected", () => {
    expect(
      getResourceConnectionState({ status: "disconnected", lastSeenAt: SEEN }),
    ).toBe(ResourceConnectionState.Disconnected);
  });

  test("any other status with a lastSeenAt is Disconnected, not connected", () => {
    expect(
      getResourceConnectionState({ status: "inactive", lastSeenAt: SEEN }),
    ).toBe(ResourceConnectionState.Disconnected);
    expect(
      getResourceConnectionState({
        status: undefined,
        lastSeenAt: "2026-09-30T10:00:00.000Z",
      }),
    ).toBe(ResourceConnectionState.Disconnected);
  });

  test("an unparseable lastSeenAt does not count as having been seen", () => {
    expect(
      getResourceConnectionState({
        status: "disconnected",
        lastSeenAt: "garbage",
      }),
    ).toBe(ResourceConnectionState.NeverConnected);
  });

  test("the three states are distinct values", () => {
    expect(
      new Set([
        ResourceConnectionState.Connected,
        ResourceConnectionState.NeverConnected,
        ResourceConnectionState.Disconnected,
      ]).size,
    ).toBe(3);
  });
});
