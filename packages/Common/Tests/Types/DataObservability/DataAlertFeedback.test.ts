import { describe, expect, test } from "@jest/globals";
import {
  applyRowCountTolerance,
  DataAlertCauseKind,
  DataAlertFeedback,
  DataAlertLikelyCause,
  DataAlertOutcome,
  DataObservabilityQuality,
  isNoiseFeedback,
  planDataAlertRetune,
  rankLikelyCauses,
  ROW_COUNT_TOLERANCE_MAX_PERCENT,
  summarizeDataQuality,
} from "../../../Types/DataObservability/DataAlertFeedback";
import { DataObservabilityMetricName } from "../../../Types/DataObservability/DataObservabilityMetric";

/*
 * What people say about a data alert changes what raises the next one, and
 * together with how quickly it was seen, measures how well the product works.
 */

function outcome(overrides: Partial<DataAlertOutcome> = {}): DataAlertOutcome {
  return {
    feedback: null,
    hadPersonAction: false,
    isCauseConfirmed: null,
    detectedAfterInSeconds: null,
    isConsequence: false,
    ...overrides,
  };
}

describe("feedback on an alert", () => {
  test("expected and not an issue are noise, useful is not", () => {
    expect(isNoiseFeedback(DataAlertFeedback.Expected)).toBe(true);
    expect(isNoiseFeedback(DataAlertFeedback.NotAnIssue)).toBe(true);
    expect(isNoiseFeedback(DataAlertFeedback.Useful)).toBe(false);
    expect(isNoiseFeedback(null)).toBe(false);
  });

  test("a late table called not an issue is given longer", () => {
    expect(
      planDataAlertRetune({
        feedback: DataAlertFeedback.NotAnIssue,
        metricName: DataObservabilityMetricName.OverdueSeconds,
        updateIntervalInSeconds: 3601,
        rowCountChangeTolerancePercent: null,
      }),
    ).toEqual({ updateIntervalInSeconds: 5402 });
  });

  test("a row count called not an issue tolerates more, up to a limit", () => {
    const retune: (tolerance: number | null) => number | undefined = (
      tolerance: number | null,
    ): number | undefined => {
      return planDataAlertRetune({
        feedback: DataAlertFeedback.NotAnIssue,
        metricName: DataObservabilityMetricName.RowCountChangePercent,
        updateIntervalInSeconds: null,
        rowCountChangeTolerancePercent: tolerance,
      })?.rowCountChangeTolerancePercent;
    };

    expect(retune(null)).toBe(65);
    expect(retune(65)).toBe(80);
    expect(retune(90)).toBe(ROW_COUNT_TOLERANCE_MAX_PERCENT);
    expect(retune(95)).toBe(ROW_COUNT_TOLERANCE_MAX_PERCENT);
  });

  test("expected was one planned event: nothing changes", () => {
    expect(
      planDataAlertRetune({
        feedback: DataAlertFeedback.Expected,
        metricName: DataObservabilityMetricName.OverdueSeconds,
        updateIntervalInSeconds: 3600,
        rowCountChangeTolerancePercent: null,
      }),
    ).toBeNull();
  });

  test("an alert on anything else has nothing to retune", () => {
    expect(
      planDataAlertRetune({
        feedback: DataAlertFeedback.NotAnIssue,
        metricName: DataObservabilityMetricName.SchemaChanges,
        updateIntervalInSeconds: 3600,
        rowCountChangeTolerancePercent: 50,
      }),
    ).toBeNull();
    expect(
      planDataAlertRetune({
        feedback: DataAlertFeedback.NotAnIssue,
        metricName: DataObservabilityMetricName.OverdueSeconds,
        updateIntervalInSeconds: null,
        rowCountChangeTolerancePercent: null,
      }),
    ).toBeNull();
  });
});

describe("a row count change inside the tolerance", () => {
  test("counts as none, in either direction", () => {
    expect(applyRowCountTolerance(-60, 65)).toBe(0);
    expect(applyRowCountTolerance(60, 65)).toBe(0);
  });

  test("outside it, or with none set, it stays", () => {
    expect(applyRowCountTolerance(-70, 65)).toBe(-70);
    expect(applyRowCountTolerance(-70, null)).toBe(-70);
  });
});

describe("how well the product is working", () => {
  test("no alerts: nothing to say, rather than a perfect score", () => {
    const quality: DataObservabilityQuality = summarizeDataQuality({
      windowInDays: 28,
      outcomes: [],
      reports: [],
      tableCount: 0,
      collectedTableCount: 0,
    });

    expect(quality.issueCount).toBe(0);
    expect(quality.precisionPercent).toBeNull();
    expect(quality.coveragePercent).toBeNull();
    expect(quality.caughtFirstPercent).toBeNull();
    expect(quality.medianTimeToDetectInSeconds).toBeNull();
    expect(quality.causeFoundPercent).toBeNull();
  });

  test("the measures count issues, not their consequences", () => {
    const quality: DataObservabilityQuality = summarizeDataQuality({
      windowInDays: 14,
      outcomes: [
        outcome({
          hadPersonAction: true,
          isCauseConfirmed: true,
          detectedAfterInSeconds: 60,
        }),
        outcome({
          feedback: DataAlertFeedback.Useful,
          isCauseConfirmed: false,
          detectedAfterInSeconds: 180,
        }),
        outcome({
          feedback: DataAlertFeedback.NotAnIssue,
          hadPersonAction: true,
          detectedAfterInSeconds: 600,
        }),
        outcome(),
        outcome({ isConsequence: true, hadPersonAction: true }),
      ],
      reports: [{ wasCaughtFirst: true }, { wasCaughtFirst: false }],
      tableCount: 10,
      collectedTableCount: 9,
    });

    expect(quality.issueCount).toBe(4);
    // Two useful issues in two weeks.
    expect(quality.usefulIssuesPerWeek).toBe(1);
    expect(quality.precisionPercent).toBe(75);
    expect(quality.coveragePercent).toBe(90);
    expect(quality.caughtFirstPercent).toBe(50);
    expect(quality.medianTimeToDetectInSeconds).toBe(180);
    expect(quality.causeFoundPercent).toBe(50);
  });
});

describe("why an alert most likely happened", () => {
  test("the most telling kind first, the latest of a kind first", () => {
    const causes: Array<DataAlertLikelyCause> = rankLikelyCauses([
      { kind: DataAlertCauseKind.SchemaChange, title: "schema" },
      {
        kind: DataAlertCauseKind.Deploy,
        title: "old deploy",
        at: "2026-11-01T00:00:00Z",
      },
      {
        kind: DataAlertCauseKind.Deploy,
        title: "new deploy",
        at: "2026-11-03T00:00:00Z",
      },
      { kind: DataAlertCauseKind.UpstreamAlert, title: "upstream" },
    ]);

    expect(
      causes.map((cause: DataAlertLikelyCause) => {
        return cause.title;
      }),
    ).toEqual(["upstream", "new deploy", "old deploy", "schema"]);
  });
});
