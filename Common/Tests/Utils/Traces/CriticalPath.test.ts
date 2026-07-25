import CriticalPathUtil, {
  CriticalPathResult,
  ServiceBreakdown,
  SpanData,
  SpanSelfTime,
} from "../../../Utils/Traces/CriticalPath";
import { describe, expect, test } from "@jest/globals";

/*
 * CriticalPathUtil is a zero-dependency interval/graph engine over trace spans.
 * The math is subtle (overlapping-child interval merge, longest-weighted path
 * with self-time), and its output drives the "where did the latency go" views,
 * so these tests pin the numeric behavior with hand-computed fixtures.
 */

function span(
  spanId: string,
  parentSpanId: string | undefined,
  start: number,
  end: number,
  primaryEntityId?: string,
): SpanData {
  return {
    spanId,
    parentSpanId,
    startTimeUnixNano: start,
    endTimeUnixNano: end,
    durationUnixNano: end - start,
    primaryEntityId,
    name: spanId,
  };
}

describe("CriticalPathUtil.computeSelfTimes", () => {
  test("a leaf span's self-time equals its whole duration", () => {
    const times: Map<string, SpanSelfTime> = CriticalPathUtil.computeSelfTimes([
      span("a", undefined, 0, 100),
    ]);

    const a: SpanSelfTime = times.get("a")!;
    expect(a.selfTimeUnixNano).toBe(100);
    expect(a.childTimeUnixNano).toBe(0);
    expect(a.selfTimePercent).toBe(100);
  });

  test("subtracts a single child's covered time", () => {
    const times: Map<string, SpanSelfTime> = CriticalPathUtil.computeSelfTimes([
      span("root", undefined, 0, 100),
      span("child", "root", 10, 40),
    ]);

    expect(times.get("root")!.selfTimeUnixNano).toBe(70);
    expect(times.get("root")!.childTimeUnixNano).toBe(30);
    expect(times.get("root")!.selfTimePercent).toBe(70);
  });

  test("sums two non-overlapping children", () => {
    const times: Map<string, SpanSelfTime> = CriticalPathUtil.computeSelfTimes([
      span("root", undefined, 0, 100),
      span("c1", "root", 10, 30),
      span("c2", "root", 50, 80),
    ]);
    // covered = 20 + 30 = 50 -> self = 50
    expect(times.get("root")!.childTimeUnixNano).toBe(50);
    expect(times.get("root")!.selfTimeUnixNano).toBe(50);
  });

  test("merges overlapping children into one interval", () => {
    const times: Map<string, SpanSelfTime> = CriticalPathUtil.computeSelfTimes([
      span("root", undefined, 0, 100),
      span("c1", "root", 10, 50),
      span("c2", "root", 30, 70),
    ]);
    // merged interval [10,70] = 60 -> self = 40
    expect(times.get("root")!.childTimeUnixNano).toBe(60);
    expect(times.get("root")!.selfTimeUnixNano).toBe(40);
  });

  test("clamps children that spill past the parent window", () => {
    const times: Map<string, SpanSelfTime> = CriticalPathUtil.computeSelfTimes([
      span("root", undefined, 0, 100),
      span("c1", "root", -50, 150),
    ]);
    // clamped to [0,100] = 100 -> self = 0
    expect(times.get("root")!.childTimeUnixNano).toBe(100);
    expect(times.get("root")!.selfTimeUnixNano).toBe(0);
  });

  test("self-time is floored at zero and percent is zero for a zero-duration span", () => {
    const zero: SpanData = span("z", undefined, 5, 5);
    const times: Map<string, SpanSelfTime> = CriticalPathUtil.computeSelfTimes([
      zero,
    ]);
    expect(times.get("z")!.selfTimeUnixNano).toBe(0);
    expect(times.get("z")!.selfTimePercent).toBe(0);
  });
});

describe("CriticalPathUtil.computeCriticalPath", () => {
  test("returns all-zero result for an empty trace", () => {
    const result: CriticalPathResult = CriticalPathUtil.computeCriticalPath([]);
    expect(result).toEqual({
      criticalPathSpanIds: [],
      totalTraceDurationUnixNano: 0,
      criticalPathDurationUnixNano: 0,
    });
  });

  test("a single span is its own critical path", () => {
    const result: CriticalPathResult = CriticalPathUtil.computeCriticalPath([
      span("only", undefined, 0, 100),
    ]);
    expect(result.criticalPathSpanIds).toEqual(["only"]);
    expect(result.totalTraceDurationUnixNano).toBe(100);
    expect(result.criticalPathDurationUnixNano).toBe(100);
  });

  test("follows the heavier of two parallel children", () => {
    const result: CriticalPathResult = CriticalPathUtil.computeCriticalPath([
      span("root", undefined, 0, 100),
      span("fast", "root", 10, 40), // duration 30
      span("slow", "root", 10, 90), // duration 80
    ]);

    expect(result.criticalPathSpanIds).toEqual(["root", "slow"]);
    expect(result.totalTraceDurationUnixNano).toBe(100);
    // root self-time (100 - merged[10,90]=80 => 20) + slow weight 80 = 100
    expect(result.criticalPathDurationUnixNano).toBe(100);
  });

  test("treats a span whose parent is absent from the set as a root", () => {
    const result: CriticalPathResult = CriticalPathUtil.computeCriticalPath([
      span("orphan", "missing-parent", 0, 50),
    ]);
    expect(result.criticalPathSpanIds).toEqual(["orphan"]);
    expect(result.criticalPathDurationUnixNano).toBe(50);
  });
});

describe("CriticalPathUtil.computeServiceBreakdown", () => {
  test("aggregates self-time per service and sorts descending", () => {
    const breakdown: Array<ServiceBreakdown> =
      CriticalPathUtil.computeServiceBreakdown([
        span("root", undefined, 0, 100, "A"),
        span("child", "root", 20, 60, "B"),
      ]);

    // root self = 100 - 40 = 60 (service A); child self = 40 (service B)
    expect(breakdown).toHaveLength(2);
    expect(breakdown[0]!.primaryEntityId).toBe("A");
    expect(breakdown[0]!.selfTimeUnixNano).toBe(60);
    expect(breakdown[0]!.percentOfTrace).toBe(60);
    expect(breakdown[1]!.primaryEntityId).toBe("B");
    expect(breakdown[1]!.selfTimeUnixNano).toBe(40);
    expect(breakdown[1]!.percentOfTrace).toBe(40);
  });

  test("groups spans without a service id under 'unknown'", () => {
    const breakdown: Array<ServiceBreakdown> =
      CriticalPathUtil.computeServiceBreakdown([span("a", undefined, 0, 10)]);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]!.primaryEntityId).toBe("unknown");
    expect(breakdown[0]!.spanCount).toBe(1);
  });

  test("accumulates span counts and durations per service", () => {
    const breakdown: Array<ServiceBreakdown> =
      CriticalPathUtil.computeServiceBreakdown([
        span("s1", undefined, 0, 100, "A"),
        span("s2", undefined, 100, 150, "A"),
      ]);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]!.spanCount).toBe(2);
    expect(breakdown[0]!.totalDurationUnixNano).toBe(150);
  });
});
