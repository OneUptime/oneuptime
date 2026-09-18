import { describe, expect, test } from "@jest/globals";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import NetworkPathTrace from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import { NetworkTopologyNode } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { NetworkDeviceDiagnosticPingResult } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
/*
 * Static import on purpose. The module is pure (Common/Types only), so it
 * loads in the App suite's plain Node environment without a browser stub —
 * and DeviceDiagnosticsWiring.test.ts pins that it stays that way.
 */
import {
  DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES,
  DIAGNOSTIC_MAX_POLL_ATTEMPTS,
  DIAGNOSTIC_POLL_INTERVAL_IN_MS,
  DIAGNOSTIC_TIMEOUT_IN_MS,
  LatencySummary,
  PingResultSummary,
  TraceRouteSummary,
  canRunDiagnosticsOnNode,
  describePingResult,
  describeTraceRoute,
  diagnosticTimeoutMessage,
  formatMilliseconds,
  formatPercent,
  latencyPointsFromAggregates,
  summarizeLatencySeries,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsViewModel";

/*
 * Issue #3745: the words the drawer uses for a ping or traceroute result.
 * Pinned here rather than through a renderer because these are the
 * sentences an operator reads to decide whether to page somebody, and a
 * regression in "Reachable with packet loss" → "Reachable" is invisible to
 * a type checker.
 */

const MANAGED_SWITCH: NetworkTopologyNode = {
  id: "switch-1",
  name: "core-sw-01",
  isManaged: true,
  kind: "device",
  status: "up",
};

function pingResult(
  overrides: Partial<NetworkDeviceDiagnosticPingResult> = {},
): NetworkDeviceDiagnosticPingResult {
  return {
    isOnline: true,
    failureCause: "",
    pingResponse: {
      packetsSent: 5,
      packetsReceived: 5,
      packetLossPercent: 0,
      minRoundTripTimeInMs: 10.24,
      maxRoundTripTimeInMs: 20.06,
      avgRoundTripTimeInMs: 12.44,
      jitterInMs: 1.234,
    },
    ...overrides,
  };
}

function rowValue(summary: PingResultSummary, label: string): string {
  const found: { label: string; value: string } | undefined = summary.rows.find(
    (row: { label: string; value: string }): boolean => {
      return row.label === label;
    },
  );

  if (!found) {
    throw new Error(`No row labelled ${label}`);
  }

  return found.value;
}

describe("polling constants", () => {
  test("polls every three seconds and gives up after two minutes", () => {
    expect(DIAGNOSTIC_POLL_INTERVAL_IN_MS).toBe(3000);
    expect(DIAGNOSTIC_TIMEOUT_IN_MS).toBe(120000);
    expect(DIAGNOSTIC_MAX_POLL_ATTEMPTS).toBe(40);
  });

  test("the attempt cap is derived from the two, not typed separately", () => {
    expect(DIAGNOSTIC_MAX_POLL_ATTEMPTS).toBe(
      Math.ceil(DIAGNOSTIC_TIMEOUT_IN_MS / DIAGNOSTIC_POLL_INTERVAL_IN_MS),
    );
  });

  /*
   * A single rejected read is retried; only a streak ends the run. Three is
   * nine seconds of a dead API, well short of the two-minute cap.
   */
  test("tolerates two rejected reads in a row, not three", () => {
    expect(DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES).toBe(3);
    expect(DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES).toBeLessThan(
      DIAGNOSTIC_MAX_POLL_ATTEMPTS,
    );
  });
});

describe("canRunDiagnosticsOnNode", () => {
  test("a managed device node qualifies", () => {
    expect(canRunDiagnosticsOnNode(MANAGED_SWITCH)).toBe(true);
  });

  test("an older payload with no kind still qualifies when managed", () => {
    expect(
      canRunDiagnosticsOnNode({ ...MANAGED_SWITCH, kind: undefined }),
    ).toBe(true);
  });

  test("an unmanaged neighbour has no row and no probe to run from", () => {
    expect(
      canRunDiagnosticsOnNode({
        ...MANAGED_SWITCH,
        id: "unmanaged:phone",
        isManaged: false,
        kind: "unmanaged",
      }),
    ).toBe(false);
  });

  test("an endpoint is not something the map pings, managed or not", () => {
    expect(
      canRunDiagnosticsOnNode({ ...MANAGED_SWITCH, kind: "endpoint" }),
    ).toBe(false);
    expect(
      canRunDiagnosticsOnNode({
        ...MANAGED_SWITCH,
        isManaged: false,
        kind: "endpoint",
      }),
    ).toBe(false);
  });
});

describe("describePingResult", () => {
  test("a clean ping is Reachable with the four statistics rows", () => {
    const summary: PingResultSummary = describePingResult(pingResult());

    expect(summary.headline).toBe("Reachable");
    expect(summary.tone).toBe("up");
    expect(
      summary.rows.map((row: { label: string; value: string }): string => {
        return row.label;
      }),
    ).toEqual(["Average RTT", "Min / Max RTT", "Jitter", "Packet loss"]);
    expect(rowValue(summary, "Average RTT")).toBe("12.4 ms");
    expect(rowValue(summary, "Min / Max RTT")).toBe("10.2 ms / 20.1 ms");
    expect(rowValue(summary, "Jitter")).toBe("1.2 ms");
    expect(rowValue(summary, "Packet loss")).toBe("0% (5/5 received)");
  });

  test("names the host first when the caller knows it", () => {
    const summary: PingResultSummary = describePingResult(
      pingResult(),
      "10.0.0.1",
    );

    expect(summary.rows[0]).toEqual({ label: "Host", value: "10.0.0.1" });
  });

  test("some replies lost is degraded, not up and not down", () => {
    const summary: PingResultSummary = describePingResult(
      pingResult({
        pingResponse: {
          packetsSent: 5,
          packetsReceived: 3,
          packetLossPercent: 40,
          avgRoundTripTimeInMs: 30,
        },
      }),
    );

    expect(summary.headline).toBe("Reachable with packet loss");
    expect(summary.tone).toBe("degraded");
    expect(rowValue(summary, "Packet loss")).toBe("40% (3/5 received)");
  });

  test("every reply lost is Unreachable, with the cause and 100% loss", () => {
    const summary: PingResultSummary = describePingResult(
      pingResult({
        isOnline: false,
        failureCause: "No reply from 10.0.0.9 after 5 packets.",
        pingResponse: {
          packetsSent: 5,
          packetsReceived: 0,
          packetLossPercent: 100,
        },
      }),
    );

    expect(summary.headline).toBe("Unreachable");
    expect(summary.tone).toBe("down");
    expect(summary.rows[0]).toEqual({
      label: "Reason",
      value: "No reply from 10.0.0.9 after 5 packets.",
    });
    expect(rowValue(summary, "Average RTT")).toBe("—");
    expect(rowValue(summary, "Packet loss")).toBe("100% (0/5 received)");
  });

  /*
   * isOnline is what the probe concluded; a payload that says offline with
   * a loss figure below 100 (a TCP fallback, an older probe) is still down.
   */
  test("trusts isOnline over the loss figure", () => {
    const summary: PingResultSummary = describePingResult(
      pingResult({ isOnline: false, failureCause: "" }),
    );

    expect(summary.headline).toBe("Unreachable");
    expect(summary.tone).toBe("down");
  });

  test("no packet statistics at all: only the cause is worth a row", () => {
    const summary: PingResultSummary = describePingResult({
      isOnline: false,
      failureCause: "ICMP is not usable on this probe.",
      pingResponse: undefined,
    });

    expect(summary.headline).toBe("Unreachable");
    expect(summary.tone).toBe("down");
    expect(summary.rows).toEqual([
      { label: "Reason", value: "ICMP is not usable on this probe." },
    ]);
  });

  test("a fractional loss keeps one decimal", () => {
    expect(formatPercent(33.333)).toBe("33.3%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(100)).toBe("100%");
  });
});

describe("describeTraceRoute", () => {
  const trace: NetworkPathTrace = {
    timestamp: new Date("2026-09-15T10:00:00Z"),
    traceRoute: {
      destinationAddress: "10.0.0.1",
      destinationHostName: "core.example.com",
      isComplete: true,
      totalHops: 3,
      failedHop: undefined,
      failureMessage: undefined,
      hops: [
        {
          hopNumber: 1,
          address: "192.168.1.1",
          hostName: "gw",
          roundTripTimeInMS: 1,
          isTimeout: false,
        },
        {
          hopNumber: 2,
          address: undefined,
          hostName: undefined,
          roundTripTimeInMS: undefined,
          isTimeout: true,
        },
        {
          hopNumber: 3,
          address: "10.0.0.1",
          hostName: "core.example.com",
          roundTripTimeInMS: 4,
          isTimeout: false,
        },
      ],
    },
  };

  test("a complete route counts its hops", () => {
    const summary: TraceRouteSummary = describeTraceRoute(trace);

    expect(summary.headline).toBe("Reached the destination in 3 hops");
    expect(summary.note).toBeUndefined();
    expect(summary.dnsLine).toBeUndefined();
    expect(summary.hops).toHaveLength(3);
  });

  test("one hop is singular", () => {
    const summary: TraceRouteSummary = describeTraceRoute({
      ...trace,
      traceRoute: {
        ...trace.traceRoute!,
        hops: [trace.traceRoute!.hops[0]!],
        totalHops: 1,
      },
    });

    expect(summary.headline).toBe("Reached the destination in 1 hop");
  });

  test("a broken route names the hop and carries the trace's own message", () => {
    const summary: TraceRouteSummary = describeTraceRoute({
      ...trace,
      traceRoute: {
        ...trace.traceRoute!,
        isComplete: false,
        failedHop: 4,
        failureMessage: "Destination host unreachable",
      },
    });

    expect(summary.headline).toBe("Route broke at hop 4");
    expect(summary.note).toBe("Destination host unreachable");
  });

  test("an incomplete route with no failed hop did not reach the destination", () => {
    const summary: TraceRouteSummary = describeTraceRoute({
      ...trace,
      traceRoute: { ...trace.traceRoute!, isComplete: false },
    });

    expect(summary.headline).toBe("Did not reach the destination");
    expect(summary.note).toBeUndefined();
  });

  test("no trace at all is still a sentence, with no hops", () => {
    const summary: TraceRouteSummary = describeTraceRoute({
      timestamp: trace.timestamp,
    });

    expect(summary.headline).toBe("Did not reach the destination");
    expect(summary.hops).toEqual([]);
  });

  test("a DNS lookup that worked says what it resolved to", () => {
    const summary: TraceRouteSummary = describeTraceRoute({
      ...trace,
      dnsLookup: {
        hostName: "core.example.com",
        resolvedAddresses: ["10.0.0.1", "10.0.0.2"],
        resolvedInMS: 12,
        isSuccess: true,
        errorMessage: undefined,
      },
    });

    expect(summary.dnsLine).toBe(
      "core.example.com resolved to 10.0.0.1, 10.0.0.2 in 12 ms",
    );
  });

  test("a DNS lookup that failed says so, with the resolver's reason", () => {
    const summary: TraceRouteSummary = describeTraceRoute({
      ...trace,
      dnsLookup: {
        hostName: "core.example.com",
        resolvedAddresses: [],
        resolvedInMS: 3,
        isSuccess: false,
        errorMessage: "ENOTFOUND",
      },
    });

    expect(summary.dnsLine).toBe(
      "Lookup for core.example.com failed — ENOTFOUND",
    );
  });
});

describe("diagnosticTimeoutMessage", () => {
  test("names the probe when it is known", () => {
    const message: string = diagnosticTimeoutMessage(
      NetworkDeviceDiagnosticType.Ping,
      "Rack 3",
    );

    expect(message).toContain(
      'The probe "Rack 3" did not report a ping result',
    );
    expect(message).toContain("within two minutes");
    expect(message).toContain("probe is online");
    expect(message).toContain("supports on-demand diagnostics");
  });

  test("falls back to the device's probe, and names the traceroute", () => {
    const message: string = diagnosticTimeoutMessage(
      NetworkDeviceDiagnosticType.Traceroute,
    );

    expect(message).toContain(
      "This device's probe did not report a traceroute result",
    );
    expect(message).not.toContain('"');
  });
});

describe("summarizeLatencySeries", () => {
  test("nothing to summarize is undefined, not a row of zeros", () => {
    expect(summarizeLatencySeries([])).toBeUndefined();
  });

  test("one point is its own latest, min, max and average", () => {
    const summary: LatencySummary | undefined = summarizeLatencySeries([
      { time: "2026-09-15T10:00:00.000Z", value: 12.5 },
    ]);

    expect(summary).toEqual({
      latest: 12.5,
      min: 12.5,
      max: 12.5,
      avg: 12.5,
      count: 1,
    });
  });

  test("many points: the last is latest, the rest are folded", () => {
    const summary: LatencySummary | undefined = summarizeLatencySeries([
      { time: "2026-09-15T10:00:00.000Z", value: 10 },
      { time: "2026-09-15T10:01:00.000Z", value: 30 },
      { time: "2026-09-15T10:02:00.000Z", value: 20 },
    ]);

    expect(summary).toEqual({
      latest: 20,
      min: 10,
      max: 30,
      avg: 20,
      count: 3,
    });
  });
});

describe("latencyPointsFromAggregates", () => {
  test("sorts oldest first and drops rows with no number in them", () => {
    const rows: Array<AggregateModel> = [
      { timestamp: new Date("2026-09-15T10:02:00Z"), value: 20 },
      { timestamp: new Date("2026-09-15T10:00:00Z"), value: 10 },
      {
        timestamp: new Date("2026-09-15T10:01:00Z"),
        value: Number.NaN,
      },
      { timestamp: new Date("2026-09-15T10:03:00Z"), value: 30 },
    ];

    expect(latencyPointsFromAggregates(rows)).toEqual([
      { time: "2026-09-15T10:00:00.000Z", value: 10 },
      { time: "2026-09-15T10:02:00.000Z", value: 20 },
      { time: "2026-09-15T10:03:00.000Z", value: 30 },
    ]);
  });

  test("accepts the ISO strings the API actually returns", () => {
    const rows: Array<AggregateModel> = [
      {
        timestamp: "2026-09-15T10:00:00.000Z" as unknown as Date,
        value: 7,
      },
    ];

    expect(latencyPointsFromAggregates(rows)).toEqual([
      { time: "2026-09-15T10:00:00.000Z", value: 7 },
    ]);
  });
});

describe("formatMilliseconds", () => {
  test("one decimal, with the unit", () => {
    expect(formatMilliseconds(12.44)).toBe("12.4 ms");
    expect(formatMilliseconds(0)).toBe("0.0 ms");
  });

  test("a missing value is a dash, not NaN ms", () => {
    expect(formatMilliseconds(undefined)).toBe("—");
    expect(formatMilliseconds(Number.NaN)).toBe("—");
  });
});
