import { describe, expect, test } from "@jest/globals";
import Span from "Common/Models/AnalyticsModels/Span";
import {
  REPLAY_CLOCK_ANCHOR_MAX_DELTA_MS,
  REPLAY_CLOCK_ANCHOR_TOLERANCE_MS,
  ReplayClockAlignmentState,
  ReplaySignal,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  REPLAY_CLOCK_INGEST_LAG_ALLOWANCE_MS,
  ReplayClockAnchorPair,
  ReplayClockNetworkAnchor,
  ReplayClockSpanAnchor,
  alignTelemetryOffsetMs,
  alignmentLabelFor,
  collectClockAnchorPairs,
  computeClockAlignment,
  describeClockAlignment,
  formatAlignmentUncertainty,
  makePendingClockAlignment,
  medianOf,
  networkAnchorsFromSignals,
  spanAnchorsFromRows,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayClockAlignment";

/*
 * Server rows land on the recording's clock by rowUnixMs - startTimeUnixMs,
 * refined by the delta that request/span pairs agree on. The rules that
 * decide when that delta is trusted are the difference between "the log
 * line appears 1.5s before the click that caused it" and a rail people
 * believe, so each threshold is pinned here.
 */

const START_UNIX_MS: number = 1_700_000_000_000;

function network(traceId: string, offsetMs: number): ReplayClockNetworkAnchor {
  return { traceId: traceId, offsetMs: offsetMs };
}

function span(traceId: string, atMs: number): ReplayClockSpanAnchor {
  return { traceId: traceId, startUnixMs: START_UNIX_MS + atMs };
}

function align(
  networkAnchors: Array<ReplayClockNetworkAnchor>,
  spanAnchors: Array<ReplayClockSpanAnchor>,
  clockSkewMs?: number | null,
): ReplayClockAlignmentState {
  return computeClockAlignment({
    startTimeUnixMs: START_UNIX_MS,
    networkAnchors: networkAnchors,
    spanAnchors: spanAnchors,
    clockSkewMs: clockSkewMs,
    hasTelemetry: true,
  });
}

describe("collectClockAnchorPairs", () => {
  test("pairs each trace's earliest request row with its earliest span, once per trace", () => {
    const pairs: Array<ReplayClockAnchorPair> = collectClockAnchorPairs(
      START_UNIX_MS,
      [
        network("t1", 10_000),
        network("t1", 9_000),
        network("t2", 20_000),
        network("orphan", 30_000),
      ],
      [span("t1", 12_000), span("t1", 8_500), span("t2", 19_000), span("x", 1)],
    );

    expect(pairs).toEqual([
      {
        traceId: "t1",
        networkOffsetMs: 9_000,
        spanStartUnixMs: START_UNIX_MS + 8_500,
        deltaMs: -500,
      },
      {
        traceId: "t2",
        networkOffsetMs: 20_000,
        spanStartUnixMs: START_UNIX_MS + 19_000,
        deltaMs: -1_000,
      },
    ]);
  });

  test("ignores anchors with no trace id or non-finite times", () => {
    expect(
      collectClockAnchorPairs(
        START_UNIX_MS,
        [network("", 1), network("t1", Number.NaN)],
        [span("t1", 5)],
      ),
    ).toEqual([]);
  });

  test("networkAnchorsFromSignals lifts only recording network rows with a trace id", () => {
    const signals: Array<ReplaySignal> = [
      {
        id: "rec:0:0",
        kind: "network",
        source: "recording",
        offsetMs: 100,
        severity: "info",
        title: "GET 200 /a",
        links: { traceId: "t1" },
        detail: {},
      },
      {
        id: "rec:0:1",
        kind: "network",
        source: "recording",
        offsetMs: 200,
        severity: "info",
        title: "GET 200 /b",
        links: {},
        detail: {},
      },
      {
        id: "span:x",
        kind: "span",
        source: "telemetry",
        offsetMs: 300,
        severity: "info",
        title: "span",
        links: { traceId: "t2" },
        detail: {},
      },
    ];

    expect(networkAnchorsFromSignals(signals)).toEqual([
      { traceId: "t1", offsetMs: 100 },
    ]);
  });

  test("spanAnchorsFromRows lifts trace id and start time from Span rows, skipping sparse ones", () => {
    const complete: Span = new Span();

    complete.traceId = "t1";
    complete.startTime = new Date(START_UNIX_MS + 5_000);

    const noTrace: Span = new Span();

    noTrace.startTime = new Date(START_UNIX_MS);

    const noStart: Span = new Span();

    noStart.traceId = "t2";

    expect(spanAnchorsFromRows([noTrace, complete, noStart])).toEqual([
      { traceId: "t1", startUnixMs: START_UNIX_MS + 5_000 },
    ]);
  });
});

describe("computeClockAlignment", () => {
  test("is pending until any telemetry has loaded", () => {
    expect(
      computeClockAlignment({
        startTimeUnixMs: START_UNIX_MS,
        networkAnchors: [network("t1", 1)],
        spanAnchors: [span("t1", 1)],
        hasTelemetry: false,
      }),
    ).toEqual(makePendingClockAlignment());
  });

  test("anchors on the median of >= 2 pairs that agree within the tolerance", () => {
    const state: ReplayClockAlignmentState = align(
      [network("t1", 10_000), network("t2", 20_000), network("t3", 30_000)],
      [span("t1", 8_600), span("t2", 18_500), span("t3", 28_300)],
      12_345,
    );

    expect(state.status).toBe("anchored");
    /* deltas: -1400, -1500, -1700 -> median -1500 */
    expect(state.deltaMs).toBe(-1_500);
    expect(state.pairCount).toBe(3);
    /* Spread of the agreeing pairs, not the manifest's skew. */
    expect(state.uncertaintyMs).toBe(200);
  });

  test("anchors with exactly two agreeing pairs and averages the even median", () => {
    const state: ReplayClockAlignmentState = align(
      [network("t1", 10_000), network("t2", 20_000)],
      [span("t1", 9_000), span("t2", 18_800)],
    );

    expect(state.status).toBe("anchored");
    expect(state.deltaMs).toBe(-1_100);
    expect(state.pairCount).toBe(2);
    expect(state.uncertaintyMs).toBe(100);
  });

  test("stays unanchored with 0 or 1 pairs and reports |clockSkew| + ingest lag", () => {
    const none: ReplayClockAlignmentState = align([], [], 3_000);
    const one: ReplayClockAlignmentState = align(
      [network("t1", 10_000)],
      [span("t1", 9_000)],
      -3_000,
    );

    expect(none).toEqual({
      status: "unanchored",
      deltaMs: 0,
      pairCount: 0,
      uncertaintyMs: 3_000 + REPLAY_CLOCK_INGEST_LAG_ALLOWANCE_MS,
    });
    expect(one.status).toBe("unanchored");
    expect(one.deltaMs).toBe(0);
    expect(one.pairCount).toBe(1);
    /* The skew's sign is irrelevant to the uncertainty window. */
    expect(one.uncertaintyMs).toBe(
      3_000 + REPLAY_CLOCK_INGEST_LAG_ALLOWANCE_MS,
    );
  });

  test("stays unanchored when the pairs disagree by more than the tolerance", () => {
    const state: ReplayClockAlignmentState = align(
      [network("t1", 10_000), network("t2", 20_000)],
      [
        span("t1", 9_000),
        span("t2", 20_000 - 1_000 - REPLAY_CLOCK_ANCHOR_TOLERANCE_MS - 1),
      ],
    );

    expect(state.status).toBe("unanchored");
    expect(state.deltaMs).toBe(0);
    expect(state.pairCount).toBe(2);
  });

  test("outvotes one wild pair when at least two others agree", () => {
    const state: ReplayClockAlignmentState = align(
      [network("t1", 10_000), network("t2", 20_000), network("t3", 30_000)],
      [span("t1", 9_000), span("t2", 19_000), span("t3", 90_000)],
    );

    expect(state.status).toBe("anchored");
    expect(state.deltaMs).toBe(-1_000);
    expect(state.pairCount).toBe(2);
  });

  test("refuses a median delta at or beyond 5 minutes as a wrong pairing", () => {
    const shift: number = REPLAY_CLOCK_ANCHOR_MAX_DELTA_MS;
    const state: ReplayClockAlignmentState = align(
      [network("t1", 10_000), network("t2", 20_000)],
      [span("t1", 10_000 + shift), span("t2", 20_000 + shift)],
    );
    const justUnder: ReplayClockAlignmentState = align(
      [network("t1", 10_000), network("t2", 20_000)],
      [span("t1", 10_000 + shift - 1), span("t2", 20_000 + shift - 1)],
    );

    expect(state.status).toBe("unanchored");
    expect(state.deltaMs).toBe(0);
    expect(justUnder.status).toBe("anchored");
    expect(justUnder.deltaMs).toBe(shift - 1);
  });

  test("honours an explicit ingest-lag allowance and a missing skew", () => {
    const state: ReplayClockAlignmentState = computeClockAlignment({
      startTimeUnixMs: START_UNIX_MS,
      networkAnchors: [],
      spanAnchors: [],
      clockSkewMs: null,
      hasTelemetry: true,
      ingestLagAllowanceMs: 500,
    });

    expect(state.uncertaintyMs).toBe(500);
  });
});

describe("alignTelemetryOffsetMs", () => {
  test("baseline is rowUnixMs - startTimeUnixMs, with the delta only when anchored", () => {
    const anchored: ReplayClockAlignmentState = {
      status: "anchored",
      deltaMs: -1_500,
      pairCount: 2,
      uncertaintyMs: 0,
    };
    const unanchored: ReplayClockAlignmentState = {
      status: "unanchored",
      deltaMs: 0,
      pairCount: 0,
      uncertaintyMs: 5_000,
    };

    expect(
      alignTelemetryOffsetMs(START_UNIX_MS + 42_000, START_UNIX_MS, unanchored),
    ).toBe(42_000);
    expect(
      alignTelemetryOffsetMs(START_UNIX_MS + 42_000, START_UNIX_MS, anchored),
    ).toBe(40_500);
    expect(
      alignTelemetryOffsetMs(
        START_UNIX_MS + 42_000,
        START_UNIX_MS,
        makePendingClockAlignment(),
      ),
    ).toBe(42_000);
  });

  test("takes no clock skew parameter: skew is a client-side delta and must not touch server rows", () => {
    expect(alignTelemetryOffsetMs.length).toBe(3);
  });

  test("labels rows anchored only when the state is anchored", () => {
    expect(
      alignmentLabelFor({
        status: "anchored",
        deltaMs: 1,
        pairCount: 2,
        uncertaintyMs: 0,
      }),
    ).toBe("anchored");
    expect(alignmentLabelFor(makePendingClockAlignment())).toBe("unanchored");
  });
});

describe("copy", () => {
  test("describes anchored and unanchored states with numbers, and nothing while pending", () => {
    expect(describeClockAlignment(makePendingClockAlignment())).toBe("");
    expect(
      describeClockAlignment({
        status: "anchored",
        deltaMs: -1_500,
        pairCount: 6,
        uncertaintyMs: 0,
      }),
    ).toBe("Server times anchored via 6 traces");
    expect(
      describeClockAlignment({
        status: "anchored",
        deltaMs: -1_500,
        pairCount: 1,
        uncertaintyMs: 200,
      }),
    ).toBe("Server times anchored via 1 trace (±200ms)");
    expect(
      describeClockAlignment({
        status: "unanchored",
        deltaMs: 0,
        pairCount: 0,
        uncertaintyMs: 3_000,
      }),
    ).toBe("Server times unanchored; clock skew up to 3s");
    expect(
      describeClockAlignment({
        status: "unanchored",
        deltaMs: 0,
        pairCount: 0,
        uncertaintyMs: 0,
      }),
    ).toBe(
      "Server times unanchored; no trace shared between the recording and the backend yet",
    );
  });

  test("formats the uncertainty as a +- window", () => {
    expect(
      formatAlignmentUncertainty({
        status: "unanchored",
        deltaMs: 0,
        pairCount: 0,
        uncertaintyMs: 3_500,
      }),
    ).toBe("±3.5s");
    expect(
      formatAlignmentUncertainty({
        status: "unanchored",
        deltaMs: 0,
        pairCount: 0,
        uncertaintyMs: 12_400,
      }),
    ).toBe("±12s");
    expect(formatAlignmentUncertainty(makePendingClockAlignment())).toBe("");
  });

  test("medianOf handles empty, odd and even lists", () => {
    expect(medianOf([])).toBe(0);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });
});
