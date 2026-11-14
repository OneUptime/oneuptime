import { describe, expect, test } from "@jest/globals";
import {
  RESOURCE_AGENT_HEARD_WINDOW_MS,
  ResourceConnectionState,
  getResourceConnectionState,
  getResourceLastSeenDate,
  isResourceAgentHeard,
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

/*
 * Issue #7439: an agent that reads its resource from an API (a Proxmox
 * cluster) keeps a second clock, agentLastSeenAt. While the agent was heard
 * recently and the resource is not connected, the agent is running but
 * cannot read the resource - the API needs looking at, not the agent.
 */
describe("getResourceConnectionState with the agent's own clock", () => {
  const NOW: Date = new Date("2026-11-13T12:00:00.000Z");
  const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
    return new Date(NOW.getTime() - minutes * 60 * 1000);
  };

  test("read before, not now, the agent heard: the read stopped", () => {
    expect(
      getResourceConnectionState({
        status: "disconnected",
        lastSeenAt: minutesAgo(25),
        agentLastSeenAt: minutesAgo(2),
        now: NOW,
      }),
    ).toBe(ResourceConnectionState.ReadingStopped);
  });

  test("never read, the agent heard: no read yet", () => {
    expect(
      getResourceConnectionState({
        status: "disconnected",
        lastSeenAt: null,
        agentLastSeenAt: minutesAgo(1),
        now: NOW,
      }),
    ).toBe(ResourceConnectionState.NotReadYet);
  });

  test("Connected wins, whatever the agent's clock says", () => {
    for (const agentLastSeenAt of [minutesAgo(1), minutesAgo(90), null]) {
      expect(
        getResourceConnectionState({
          status: "connected",
          lastSeenAt: minutesAgo(1),
          agentLastSeenAt,
          now: NOW,
        }),
      ).toBe(ResourceConnectionState.Connected);
    }
  });

  test("an agent last heard longer ago than the window has stopped: Disconnected, or never connected", () => {
    expect(
      getResourceConnectionState({
        status: "disconnected",
        lastSeenAt: minutesAgo(60),
        agentLastSeenAt: minutesAgo(16),
        now: NOW,
      }),
    ).toBe(ResourceConnectionState.Disconnected);
    expect(
      getResourceConnectionState({
        status: "disconnected",
        lastSeenAt: undefined,
        agentLastSeenAt: minutesAgo(16),
        now: NOW,
      }),
    ).toBe(ResourceConnectionState.NeverConnected);
  });

  test("without the agent's clock - every other resource - the three states are all there is", () => {
    expect(
      getResourceConnectionState({
        status: "disconnected",
        lastSeenAt: minutesAgo(25),
        now: NOW,
      }),
    ).toBe(ResourceConnectionState.Disconnected);
    expect(
      getResourceConnectionState({ status: "disconnected", lastSeenAt: null }),
    ).toBe(ResourceConnectionState.NeverConnected);
  });

  test("an ISO string from the API reads as a Date does", () => {
    expect(
      getResourceConnectionState({
        status: "disconnected",
        lastSeenAt: minutesAgo(25).toISOString(),
        agentLastSeenAt: minutesAgo(2).toISOString(),
        now: NOW,
      }),
    ).toBe(ResourceConnectionState.ReadingStopped);
  });

  test("an agentLastSeenAt that is not a date is never heard", () => {
    expect(
      getResourceConnectionState({
        status: "disconnected",
        lastSeenAt: minutesAgo(25),
        agentLastSeenAt: "not a date",
        now: NOW,
      }),
    ).toBe(ResourceConnectionState.Disconnected);
  });
});

describe("isResourceAgentHeard", () => {
  const NOW: Date = new Date("2026-11-13T12:00:00.000Z");

  test("the window is the server's own 15 minutes", () => {
    expect(RESOURCE_AGENT_HEARD_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  test("heard up to and including 15 minutes ago, not a millisecond more", () => {
    const edge: Date = new Date(NOW.getTime() - RESOURCE_AGENT_HEARD_WINDOW_MS);
    expect(isResourceAgentHeard({ agentLastSeenAt: edge, now: NOW })).toBe(
      true,
    );
    expect(
      isResourceAgentHeard({
        agentLastSeenAt: new Date(edge.getTime() - 1),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a time a little ahead of the reader's clock still counts as heard", () => {
    expect(
      isResourceAgentHeard({
        agentLastSeenAt: new Date(NOW.getTime() + 90 * 1000),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("never heard is not heard", () => {
    expect(isResourceAgentHeard({ agentLastSeenAt: null, now: NOW })).toBe(
      false,
    );
    expect(isResourceAgentHeard({ agentLastSeenAt: undefined })).toBe(false);
  });
});
