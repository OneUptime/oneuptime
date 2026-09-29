import { describe, expect, test } from "@jest/globals";
import fillFlowSeriesGaps, {
  FlowSeriesPointLike,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/FlowSeriesUtil";

/*
 * The Traffic page's bandwidth chart positions points by array index, so
 * the series must contain every bucket in the window — the API returns
 * only non-empty buckets. These pin the gap filling: zero buckets appear,
 * existing buckets survive untouched, ClickHouse's timezone-less UTC
 * strings parse correctly, and malformed input never amplifies.
 */

function point(time: string, octets: number): FlowSeriesPointLike {
  return { time, octets, packets: Math.ceil(octets / 100) };
}

describe("fillFlowSeriesGaps", () => {
  test("fills silent buckets with zeros across the window", () => {
    const filled: Array<FlowSeriesPointLike> = fillFlowSeriesGaps(
      [
        point("2026-07-24T10:00:00.000Z", 6000),
        point("2026-07-24T10:04:00.000Z", 1200),
      ],
      60,
      "2026-07-24T10:00:00.000Z",
      "2026-07-24T10:05:00.000Z",
    );

    expect(filled).toHaveLength(5);
    expect(filled[0]!.octets).toBe(6000);
    expect(filled[1]!.octets).toBe(0);
    expect(filled[2]!.octets).toBe(0);
    expect(filled[3]!.octets).toBe(0);
    expect(filled[4]!.octets).toBe(1200);
  });

  test("parses ClickHouse timezone-less bucket strings as UTC", () => {
    const filled: Array<FlowSeriesPointLike> = fillFlowSeriesGaps(
      [point("2026-07-24 10:01:00", 500)],
      60,
      "2026-07-24T10:00:00.000Z",
      "2026-07-24T10:03:00.000Z",
    );

    expect(filled).toHaveLength(3);
    expect(filled[1]!.octets).toBe(500);
  });

  test("a gap-free series passes through with the same values", () => {
    const series: Array<FlowSeriesPointLike> = [
      point("2026-07-24T10:00:00.000Z", 1),
      point("2026-07-24T10:01:00.000Z", 2),
    ];

    const filled: Array<FlowSeriesPointLike> = fillFlowSeriesGaps(
      series,
      60,
      "2026-07-24T10:00:00.000Z",
      "2026-07-24T10:02:00.000Z",
    );

    expect(
      filled.map((p: FlowSeriesPointLike) => {
        return p.octets;
      }),
    ).toEqual([1, 2]);
  });

  test("aligns the walk to the bucket grid, not the raw window start", () => {
    // Window starts mid-bucket; buckets are toStartOfInterval-aligned.
    const filled: Array<FlowSeriesPointLike> = fillFlowSeriesGaps(
      [point("2026-07-24T10:00:00.000Z", 900)],
      60,
      "2026-07-24T10:00:30.000Z",
      "2026-07-24T10:02:30.000Z",
    );

    expect(filled[0]!.time).toBe("2026-07-24T10:00:00.000Z");
    expect(filled[0]!.octets).toBe(900);
  });

  test("never amplifies malformed input", () => {
    const original: Array<FlowSeriesPointLike> = [
      point("2026-07-24T10:00:00.000Z", 1),
    ];

    // Tiny bucket over a huge window would generate millions of points.
    expect(
      fillFlowSeriesGaps(
        original,
        60,
        "2026-01-01T00:00:00.000Z",
        "2026-12-31T00:00:00.000Z",
      ),
    ).toBe(original);

    // Zero/negative bucket, inverted window, unparseable dates.
    expect(fillFlowSeriesGaps(original, 0, "a", "b")).toBe(original);
    expect(
      fillFlowSeriesGaps(
        original,
        60,
        "2026-07-24T11:00:00.000Z",
        "2026-07-24T10:00:00.000Z",
      ),
    ).toBe(original);
  });
});
