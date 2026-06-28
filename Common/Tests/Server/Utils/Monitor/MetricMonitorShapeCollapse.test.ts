import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import {
  MetricReadPlan,
  computeShapeKey,
  groupReadPlansByShape,
  seriesCacheKey,
  computeCollapseRatio,
} from "../../../../Server/Utils/Monitor/MetricMonitorShapeCollapse";

const basePlan: (overrides: Partial<MetricReadPlan>) => MetricReadPlan = (
  overrides: Partial<MetricReadPlan>,
): MetricReadPlan => {
  return {
    monitorId: "m1",
    projectId: "p1",
    metricName: "cpu",
    aggregationType: MetricsAggregationType.Avg,
    windowStartEpochSec: 1000,
    windowEndEpochSec: 1060,
    primaryEntityIds: null,
    collapsible: true,
    ...overrides,
  };
};

describe("MetricMonitorShapeCollapse", () => {
  describe("computeShapeKey", () => {
    test("same project/agg/window/scope-mode collapse regardless of metric name or entity set", () => {
      const a: string = computeShapeKey(
        basePlan({ metricName: "cpu", primaryEntityIds: ["e1"] }),
      );
      const b: string = computeShapeKey(
        basePlan({ metricName: "mem", primaryEntityIds: ["e2"] }),
      );
      expect(a).toBe(b);
    });

    test("differs by aggregation type", () => {
      expect(
        computeShapeKey(
          basePlan({ aggregationType: MetricsAggregationType.Avg }),
        ),
      ).not.toBe(
        computeShapeKey(
          basePlan({ aggregationType: MetricsAggregationType.Sum }),
        ),
      );
    });

    test("differs by window", () => {
      expect(computeShapeKey(basePlan({ windowEndEpochSec: 1060 }))).not.toBe(
        computeShapeKey(basePlan({ windowEndEpochSec: 1120 })),
      );
    });

    test("project-wide and entity-scoped reads never share a shape", () => {
      expect(computeShapeKey(basePlan({ primaryEntityIds: null }))).not.toBe(
        computeShapeKey(basePlan({ primaryEntityIds: ["e1"] })),
      );
    });
  });

  describe("groupReadPlansByShape", () => {
    test("collapses three same-shape monitors into one bucket with union of names+entities", () => {
      const plans: Array<MetricReadPlan> = [
        basePlan({
          monitorId: "m1",
          metricName: "cpu",
          primaryEntityIds: ["e1"],
        }),
        basePlan({
          monitorId: "m2",
          metricName: "mem",
          primaryEntityIds: ["e2"],
        }),
        basePlan({
          monitorId: "m3",
          metricName: "cpu",
          primaryEntityIds: ["e3"],
        }),
      ];

      const { buckets, uncollapsible } = groupReadPlansByShape(plans);

      expect(uncollapsible).toHaveLength(0);
      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.plans).toHaveLength(3);
      expect(buckets[0]!.metricNames.sort()).toEqual(["cpu", "mem"]);
      expect(buckets[0]!.primaryEntityIds!.sort()).toEqual(["e1", "e2", "e3"]);
    });

    test("separates project-wide from entity-scoped and different windows", () => {
      const plans: Array<MetricReadPlan> = [
        basePlan({ monitorId: "m1", primaryEntityIds: null }),
        basePlan({ monitorId: "m2", primaryEntityIds: ["e1"] }),
        basePlan({
          monitorId: "m3",
          primaryEntityIds: null,
          windowEndEpochSec: 9999,
        }),
      ];

      const { buckets } = groupReadPlansByShape(plans);
      expect(buckets).toHaveLength(3);
    });

    test("project-wide bucket keeps primaryEntityIds null (no entity predicate)", () => {
      const { buckets } = groupReadPlansByShape([
        basePlan({ primaryEntityIds: null }),
      ]);
      expect(buckets[0]!.primaryEntityIds).toBeNull();
    });

    test("non-collapsible plans are routed to the per-monitor fallback", () => {
      const plans: Array<MetricReadPlan> = [
        basePlan({ monitorId: "m1", collapsible: true }),
        basePlan({ monitorId: "m2", collapsible: false }),
      ];
      const { buckets, uncollapsible } = groupReadPlansByShape(plans);
      expect(buckets).toHaveLength(1);
      expect(
        uncollapsible.map((p: MetricReadPlan) => {
          return p.monitorId;
        }),
      ).toEqual(["m2"]);
    });
  });

  describe("seriesCacheKey", () => {
    test("round-trips a (shape, name, entity) series identity", () => {
      const k: string = seriesCacheKey({
        shapeKey: "v1|p1|...",
        metricName: "cpu",
        primaryEntityId: "e1",
      });
      expect(k).toBe("v1|p1|...::cpu::e1");
    });

    test("project-wide series use an empty entity segment", () => {
      expect(
        seriesCacheKey({
          shapeKey: "s",
          metricName: "cpu",
          primaryEntityId: null,
        }),
      ).toBe("s::cpu::");
    });
  });

  describe("computeCollapseRatio", () => {
    test("returns monitors / reads", () => {
      expect(
        computeCollapseRatio({ monitorsEvaluated: 1000, readsIssued: 10 }),
      ).toBe(100);
    });

    test("returns 1 when no reads were issued (no divide-by-zero)", () => {
      expect(
        computeCollapseRatio({ monitorsEvaluated: 0, readsIssued: 0 }),
      ).toBe(1);
    });
  });
});
