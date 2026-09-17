import { SloWidgetMetric } from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import SloHistoryMetricName from "../../../Types/ServiceLevelObjective/SloHistoryMetricName";
import { getSloHistoryMetricName } from "../../../Utils/Slo/SloWidgetFormat";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * SloHistory.metricName values are persisted: 400 days of ClickHouse rows
 * already carry them. These tests pin the names in one place and check that
 * the writer (the evaluation worker) and the readers (the dashboard widget
 * and the SLO overview) all agree with it — so a rename, or a new copy of a
 * string that drifts, fails here instead of silently emptying every chart.
 */

const REPO_ROOT: string = path.join(__dirname, "../../../..");

const WORKER_SOURCE: string = fs.readFileSync(
  path.join(REPO_ROOT, "App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts"),
  "utf8",
);

type EscapeRegExpFunction = (value: string) => string;

const escapeRegExp: EscapeRegExpFunction = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

describe("SloHistoryMetricName", () => {
  test("the persisted values never change", () => {
    expect({ ...SloHistoryMetricName }).toEqual({
      SliPercent: "sli.percent",
      ErrorBudgetRemainingPercent: "error.budget.remaining.percent",
      BurnRate: "burn.rate",
    });
  });

  test.each(Object.entries(SloHistoryMetricName))(
    "the evaluation worker writes %s",
    (member: string, value: string) => {
      /*
       * Either the literal or the enum member is fine — what matters is that
       * a history row is written under exactly this name.
       */
      const writes: RegExp = new RegExp(
        `metricName:\\s*(?:"${escapeRegExp(value)}"|SloHistoryMetricName\\.${member})`,
      );

      expect(WORKER_SOURCE).toMatch(writes);
    },
  );

  test("the dashboard SLO widget reads the same names", () => {
    expect(getSloHistoryMetricName(SloWidgetMetric.Sli)).toBe(
      SloHistoryMetricName.SliPercent,
    );
    expect(getSloHistoryMetricName(SloWidgetMetric.ErrorBudgetRemaining)).toBe(
      SloHistoryMetricName.ErrorBudgetRemainingPercent,
    );
    expect(getSloHistoryMetricName(SloWidgetMetric.BurnRate)).toBe(
      SloHistoryMetricName.BurnRate,
    );
  });

  test("the SLO overview components use the enum, never a raw copy of a name", () => {
    const sloComponentsDirectory: string = path.join(
      REPO_ROOT,
      "App/FeatureSet/Dashboard/src/Components/Slo",
    );

    const overviewFiles: Array<string> = fs
      .readdirSync(sloComponentsDirectory)
      .filter((fileName: string) => {
        return (
          fileName.startsWith("SloOverview") ||
          fileName.startsWith("SloBudget") ||
          fileName === "useSloHistorySeries.ts"
        );
      });

    // The burn-down card and the history hook must both be in scope.
    expect(overviewFiles).toEqual(
      expect.arrayContaining([
        "SloBudgetBurnDownCard.tsx",
        "useSloHistorySeries.ts",
      ]),
    );

    for (const fileName of overviewFiles) {
      const source: string = fs.readFileSync(
        path.join(sloComponentsDirectory, fileName),
        "utf8",
      );

      for (const value of Object.values(SloHistoryMetricName)) {
        expect({ fileName, hasRawName: source.includes(`"${value}"`) }).toEqual(
          { fileName, hasRawName: false },
        );
      }
    }
  });
});
