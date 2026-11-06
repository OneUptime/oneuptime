import { describe, expect, test } from "@jest/globals";
import AIInsightSeverity from "../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../Types/AI/AIInsightType";
import { DATA_CHECK_METRIC_NAME } from "../../../../Types/DataObservability/DataCheckMetric";
import { DataObservabilityMetricName } from "../../../../Types/DataObservability/DataObservabilityMetric";
import DataDriftDetector, {
  DATA_DRIFT_MAX_INSIGHTS,
  DataDriftFinding,
  DataDriftRow,
} from "../../../../Server/Utils/AI/SRE/Insights/Detectors/DataDriftDetector";
import { InsightCandidate } from "../../../../Server/Utils/AI/SRE/Insights/Types";

/*
 * A table's rows, or a data check's value, moving too slowly for an alert: a
 * look-here in AI Insights, never a page.
 */

function row(overrides: Partial<DataDriftRow> = {}): DataDriftRow {
  return {
    name: DataObservabilityMetricName.RowCount,
    subject: "table-1",
    subjectName: "public.orders",
    recentMean: 700,
    priorMean: 1000,
    recentSamples: 2000,
    priorSamples: 2000,
    ...overrides,
  };
}

describe("what counts as drift", () => {
  test("a table that lost 30% in a week", () => {
    const [finding]: Array<DataDriftFinding> = DataDriftDetector.evaluateDrift([
      row(),
    ]);

    expect(finding?.relativeChange).toBeCloseTo(-0.3);
  });

  test("a small move is ordinary", () => {
    expect(DataDriftDetector.evaluateDrift([row({ recentMean: 900 })])).toEqual(
      [],
    );
  });

  test("a table too new to compare says nothing", () => {
    expect(
      DataDriftDetector.evaluateDrift([row({ priorSamples: 10 })]),
    ).toEqual([]);
    expect(
      DataDriftDetector.evaluateDrift([row({ recentSamples: 10 })]),
    ).toEqual([]);
  });

  test("nothing to compare with is not growth", () => {
    expect(DataDriftDetector.evaluateDrift([row({ priorMean: 0 })])).toEqual(
      [],
    );
  });

  test("the biggest movers, and only a few", () => {
    const findings: Array<DataDriftFinding> = DataDriftDetector.evaluateDrift(
      Array.from({ length: DATA_DRIFT_MAX_INSIGHTS + 3 }).map(
        (_: unknown, index: number) => {
          return row({
            subject: `table-${index}`,
            recentMean: 1000 + 300 + index * 100,
          });
        },
      ),
    );

    expect(findings).toHaveLength(DATA_DRIFT_MAX_INSIGHTS);
    expect(findings[0]?.subject).toBe(`table-${DATA_DRIFT_MAX_INSIGHTS + 2}`);
  });
});

describe("what it says", () => {
  test("a table's rows, as a look-here", () => {
    const candidate: InsightCandidate = DataDriftDetector.toCandidate({
      ...row(),
      relativeChange: -0.3,
    });

    expect(candidate.insightType).toBe(AIInsightType.DataDrift);
    expect(candidate.title).toBe("Rows in public.orders moved -30% in a week");
    expect(candidate.severity).toBe(AIInsightSeverity.Low);
    expect(candidate.fingerprint).toBe(
      `data-drift:${DataObservabilityMetricName.RowCount}:table-1`,
    );
    expect(candidate.evidence.dataDrift?.subject).toBe("public.orders");
  });

  test("a check by its name", () => {
    expect(
      DataDriftDetector.toCandidate({
        ...row({
          name: DATA_CHECK_METRIC_NAME,
          subject: "check-1",
          subjectName: "Emails look right",
        }),
        relativeChange: 0.5,
      }).title,
    ).toBe('Data check "Emails look right" moved +50% in a week');
  });
});
