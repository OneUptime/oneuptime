import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Ceph form's Custom Metric judges each pool or daemon on its own, and
 * offers the aggregations that do not add up scrapes. The rules themselves
 * are pinned in Common (CephMetricCatalog.test.ts); this pins that the form
 * uses them.
 */
const source: string = fs
  .readFileSync(
    path.join(
      __dirname,
      "../../FeatureSet/Dashboard/src/Components/Form/Monitor/CephMonitor/CephMonitorStepForm.tsx",
    ),
    "utf8",
  )
  .replace(/\s+/g, " ");

describe("CephMonitorStepForm: Custom Metric", () => {
  test("groups the metric by its pool or daemon label", () => {
    expect(source).toContain(
      "groupByAttributeKey: getCephGroupByKeyForScope( metric.defaultResourceScope, ),",
    );
  });

  test("offers the aggregations getCephCustomMetricAggregations names, keeping a saved one", () => {
    expect(source).toContain(
      "return getCephCustomMetricAggregations(current).map(",
    );
    expect(source).toContain(
      "options={getCephAggregationOptions(customAggregation)}",
    );
    // No hard-coded list of every aggregation is left behind.
    expect(source).not.toContain(
      '{ label: "Sum", value: MetricsAggregationType.Sum }, { label: "Count", value: MetricsAggregationType.Count }, ];',
    );
  });
});
