import { describe, expect, test } from "@jest/globals";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import MeasurementAggregationType, {
  MeasurementAggregationTypeUtil,
} from "../../../Types/Measurement/MeasurementAggregationType";

/*
 * MeasurementAggregationType is the deliberately-narrow subset of
 * AggregationType a measurement chart is allowed to default to (Sum is left
 * out on purpose: summing durations across incidents is meaningless). The Util
 * maps each subset member onto the full AggregationType the query layer
 * understands. The mapping is a switch with a default arm, so the failure it
 * invites is a member added to the enum without a matching case — it would
 * silently fall through to Avg. This suite pins the mapping and that
 * exhaustiveness.
 */

describe("MeasurementAggregationType", () => {
  test("is a strict subset of AggregationType and excludes Sum/Count", () => {
    const full: Array<string> = Object.values(AggregationType);
    for (const member of Object.values(MeasurementAggregationType)) {
      // Every measurement member must be a real AggregationType value.
      expect(full).toContain(member);
    }
    // The two intentionally-omitted members must never appear here.
    expect(Object.values(MeasurementAggregationType)).not.toContain(
      AggregationType.Sum as unknown as MeasurementAggregationType,
    );
    expect(Object.values(MeasurementAggregationType)).not.toContain(
      AggregationType.Count as unknown as MeasurementAggregationType,
    );
  });
});

describe("MeasurementAggregationTypeUtil.toAggregationType", () => {
  const CASES: Array<[MeasurementAggregationType, AggregationType]> = [
    [MeasurementAggregationType.Avg, AggregationType.Avg],
    [MeasurementAggregationType.Max, AggregationType.Max],
    [MeasurementAggregationType.Min, AggregationType.Min],
    [MeasurementAggregationType.P50, AggregationType.P50],
    [MeasurementAggregationType.P90, AggregationType.P90],
    [MeasurementAggregationType.P95, AggregationType.P95],
    [MeasurementAggregationType.P99, AggregationType.P99],
  ];

  test.each(CASES)(
    "maps %s to the matching AggregationType",
    (input: MeasurementAggregationType, expected: AggregationType) => {
      expect(MeasurementAggregationTypeUtil.toAggregationType(input)).toBe(
        expected,
      );
    },
  );

  test("covers every enum member (no member falls through to the default)", () => {
    /*
     * If a new member is added to MeasurementAggregationType without its own
     * case, it would resolve to Avg here. Compare against an independently
     * built expectation so that fall-through is caught rather than accepted.
     */
    const mapped: Set<AggregationType> = new Set<AggregationType>(
      Object.values(MeasurementAggregationType).map(
        (m: MeasurementAggregationType) => {
          return MeasurementAggregationTypeUtil.toAggregationType(m);
        },
      ),
    );
    // Avg, Max, Min, P50, P90, P95, P99 => 7 distinct targets.
    expect(mapped.size).toBe(Object.values(MeasurementAggregationType).length);
  });

  test("defaults undefined to Avg", () => {
    // The picker can be empty; an unset selection must resolve to a safe Avg.
    expect(MeasurementAggregationTypeUtil.toAggregationType(undefined)).toBe(
      AggregationType.Avg,
    );
  });

  test("an unknown value falls back to Avg rather than throwing", () => {
    // Defensive: a value outside the enum (bad persisted data) must not crash.
    expect(
      MeasurementAggregationTypeUtil.toAggregationType(
        "NotARealAggregation" as MeasurementAggregationType,
      ),
    ).toBe(AggregationType.Avg);
  });

  test("only ever returns AggregationTypes valid for measurements", () => {
    /*
     * The mapping must never emit Sum or Count — those are exactly the
     * aggregations the measurement subset exists to keep out.
     */
    for (const member of Object.values(MeasurementAggregationType)) {
      const result: AggregationType =
        MeasurementAggregationTypeUtil.toAggregationType(member);
      expect(result).not.toBe(AggregationType.Sum);
      expect(result).not.toBe(AggregationType.Count);
    }
  });
});
