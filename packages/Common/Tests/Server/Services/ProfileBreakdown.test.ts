import ProfileAggregationService, {
  BreakdownResult,
} from "../../../Server/Services/ProfileAggregationService";
import ProfileDatabaseService from "../../../Server/Services/ProfileService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach, jest } from "@jest/globals";

/*
 * Replace the ClickHouse boundary: getBreakdown reads pre-grouped rows
 * from the Profile table via ProfileDatabaseService.executeQuery (NOT
 * the sample service — breakdowns never touch the huge ProfileSample
 * table). Everything after the read (totals, shares, limit) is pure.
 */
const stubBreakdownRows: (rows: Array<JSONObject>) => void = (
  rows: Array<JSONObject>,
): void => {
  const fakeResult: Results = {
    json: () => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  jest
    .spyOn(ProfileDatabaseService, "executeQuery")
    .mockResolvedValue(fakeResult);
};

describe("ProfileAggregationService.getBreakdown", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("computes shares against the pre-limit total and keeps descending order", async () => {
    /*
     * Rows arrive sorted by summed sampleCount descending — the query's
     * ORDER BY guarantees it, so the service preserves order instead of
     * re-sorting. ClickHouse's JSON output renders wide numerics as
     * strings, so one row uses string values to cover Number() coercion.
     * The empty-value row stands in for profiles missing the dimension
     * and must be dropped before it pollutes the total.
     */
    stubBreakdownRows([
      {
        breakdownValue: "svc-a",
        totalSampleCount: "500",
        profileCount: "5",
      },
      {
        breakdownValue: "svc-b",
        totalSampleCount: 300,
        profileCount: 3,
      },
      {
        breakdownValue: "svc-c",
        totalSampleCount: 200,
        profileCount: 2,
      },
      {
        breakdownValue: "",
        totalSampleCount: 999,
        profileCount: 9,
      },
    ]);

    const result: BreakdownResult =
      await ProfileAggregationService.getBreakdown({
        projectId: ObjectID.generate(),
        startTime: new Date("2026-06-01T00:00:00Z"),
        endTime: new Date("2026-06-02T00:00:00Z"),
        breakdownBy: "service",
        limit: 2,
      });

    /*
     * The total covers ALL named groups (including svc-c, which the
     * limit drops) but not the empty-value row — shares must stay
     * percentages of the real volume, not of the visible top-N.
     */
    expect(result.totalSampleCount).toBe(1000);

    // Limit applies AFTER the total: only the top two groups come back.
    expect(result.items.length).toBe(2);
    expect(result.items[0]!.value).toBe("svc-a");
    expect(result.items[0]!.sampleCount).toBe(500);
    expect(result.items[0]!.profileCount).toBe(5);
    expect(result.items[0]!.share).toBe(50);

    expect(result.items[1]!.value).toBe("svc-b");
    expect(result.items[1]!.sampleCount).toBe(300);
    expect(result.items[1]!.share).toBe(30);

    // Descending order survives the trip through the service.
    expect(result.items[0]!.sampleCount).toBeGreaterThanOrEqual(
      result.items[1]!.sampleCount,
    );

    // Truncated shares undercount: they sum to at most 100, never more.
    const shareSum: number = result.items.reduce(
      (sum: number, item: { share: number }) => {
        return sum + item.share;
      },
      0,
    );
    expect(shareSum).toBeLessThanOrEqual(100);
    expect(shareSum).toBe(80);
  });

  test("shares sum to exactly 100 when no group is dropped by the limit", async () => {
    stubBreakdownRows([
      { breakdownValue: "svc-a", totalSampleCount: 500, profileCount: 5 },
      { breakdownValue: "svc-b", totalSampleCount: 300, profileCount: 3 },
      { breakdownValue: "svc-c", totalSampleCount: 200, profileCount: 2 },
    ]);

    const result: BreakdownResult =
      await ProfileAggregationService.getBreakdown({
        projectId: ObjectID.generate(),
        startTime: new Date("2026-06-01T00:00:00Z"),
        endTime: new Date("2026-06-02T00:00:00Z"),
        breakdownBy: "service",
      });

    // The default limit (10) exceeds the group count — nothing dropped.
    expect(result.items.length).toBe(3);
    expect(result.totalSampleCount).toBe(1000);

    const shareSum: number = result.items.reduce(
      (sum: number, item: { share: number }) => {
        return sum + item.share;
      },
      0,
    );
    expect(shareSum).toBe(100);
  });

  test("guards share math against a zero total instead of producing NaN", async () => {
    /*
     * A group can legitimately report zero samples (e.g. profiles
     * ingested with empty sample sets). 0/0 would yield NaN and break
     * every percentage formatter downstream.
     */
    stubBreakdownRows([
      { breakdownValue: "svc-empty", totalSampleCount: 0, profileCount: 1 },
    ]);

    const result: BreakdownResult =
      await ProfileAggregationService.getBreakdown({
        projectId: ObjectID.generate(),
        startTime: new Date("2026-06-01T00:00:00Z"),
        endTime: new Date("2026-06-02T00:00:00Z"),
        breakdownBy: "service",
      });

    expect(result.totalSampleCount).toBe(0);
    expect(result.items.length).toBe(1);
    expect(result.items[0]!.share).toBe(0);
    expect(Number.isNaN(result.items[0]!.share)).toBe(false);
  });
});
