import { ResponseJSON } from "@clickhouse/client";
import AIInsightSeverity from "../../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import AnalyticsTableName from "../../../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../../../Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "../../../../../../Types/Date";
import {
  DATA_CHECK_METRIC_NAME,
  DataCheckAttribute,
} from "../../../../../../Types/DataObservability/DataCheckMetric";
import {
  DataObservabilityAttribute,
  DataObservabilityMetricName,
} from "../../../../../../Types/DataObservability/DataObservabilityMetric";
import { JSONObject } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import { Results } from "../../../../../Services/AnalyticsDatabaseService";
import MetricService from "../../../../../Services/MetricService";
import { getClickhouseDatabaseName } from "../../../../AnalyticsDatabase/ClusterConfig";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../../../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../../../AnalyticsDatabase/Statement";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * DataDrift — a table's rows, or a data check's value, moving slowly enough
 * that no alert will ever fire. A step down pages someone at once (Row Count
 * Fell Sharply); a table losing a few percent a day never crosses a line, and
 * a null rate creeping from 1% to 3% stays inside its own learned baseline as
 * the baseline learns it. So a table's week is compared with the week before.
 *
 * It never pages: it is a look-here in AI Insights, and it never routes to an
 * auto-fix, as growth and decline both have ordinary explanations.
 * Deterministic, no LLM. MetricDrift covers the metric as a whole, by store;
 * this reads it table by table, which that view cannot, so it runs once a day.
 */

// How far a week's mean must have moved from the week before's to be worth a look.
export const DATA_DRIFT_MIN_RELATIVE_CHANGE: number = 0.2;

// A week holds about 2,000 collections: below this, a table is too new to compare.
export const DATA_DRIFT_MIN_SAMPLES: number = 100;

// The busiest movers: a platform-wide change moves every table, and the rest are echoes.
export const DATA_DRIFT_MAX_INSIGHTS: number = 5;

const WEEK_IN_DAYS: number = 7;
const MAX_ROWS: number = 5000;

// When in the day it runs, UTC: the scan runs far more often than this needs to.
const SCAN_HOUR: number = 6;
const SCAN_TICK_IN_MINUTES: number = 15;

export interface DataDriftRow {
  name: string;
  subject: string;
  subjectName: string;
  recentMean: number;
  priorMean: number;
  recentSamples: number;
  priorSamples: number;
}

export interface DataDriftFinding extends DataDriftRow {
  relativeChange: number;
}

export function buildDataDriftStatement(data: {
  projectId: ObjectID;
  now: Date;
}): Statement {
  const recentStart: Date = OneUptimeDate.addRemoveDays(
    data.now,
    -WEEK_IN_DAYS,
  );
  const priorStart: Date = OneUptimeDate.addRemoveDays(
    data.now,
    -2 * WEEK_IN_DAYS,
  );
  const statement: Statement = SQL`SELECT name, subject, any(subjectName) AS subjectName, avgIf(value, time >= ${{
    type: TableColumnType.Date,
    value: recentStart,
  }}) AS recentMean, avgIf(value, time < ${{
    type: TableColumnType.Date,
    value: recentStart,
  }}) AS priorMean, countIf(time >= ${{
    type: TableColumnType.Date,
    value: recentStart,
  }}) AS recentSamples, countIf(time < ${{
    type: TableColumnType.Date,
    value: recentStart,
  }}) AS priorSamples FROM (SELECT name, time, value, multiIf(name = ${{
    type: TableColumnType.Text,
    value: DATA_CHECK_METRIC_NAME,
  }}, attributes[${{
    type: TableColumnType.Text,
    value: DataCheckAttribute.CheckId,
  }}], attributes[${{
    type: TableColumnType.Text,
    value: DataObservabilityAttribute.TableId,
  }}]) AS subject, multiIf(name = ${{
    type: TableColumnType.Text,
    value: DATA_CHECK_METRIC_NAME,
  }}, attributes[${{
    type: TableColumnType.Text,
    value: DataCheckAttribute.CheckName,
  }}], attributes[${{
    type: TableColumnType.Text,
    value: DataObservabilityAttribute.TableKey,
  }}]) AS subjectName FROM `;

  statement.append(
    `${getClickhouseDatabaseName()}.${AnalyticsTableName.Metric}`,
  );
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND name IN (${{
      type: TableColumnType.Text,
      value: DataObservabilityMetricName.RowCount,
    }}, ${{
      type: TableColumnType.Text,
      value: DATA_CHECK_METRIC_NAME,
    }}) AND time >= ${{
      type: TableColumnType.Date,
      value: priorStart,
    }} AND time < ${{
      type: TableColumnType.Date,
      value: data.now,
    }}) WHERE subject != '' GROUP BY name, subject LIMIT ${{
      type: TableColumnType.Number,
      value: MAX_ROWS,
    }}`,
  );
  statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

  return statement;
}

export default class DataDriftDetector implements InsightDetector {
  public insightType: AIInsightType = AIInsightType.DataDrift;

  // Pure decision: enough samples in both weeks, and moved far enough. Biggest movers first.
  public static evaluateDrift(
    rows: ReadonlyArray<DataDriftRow>,
  ): Array<DataDriftFinding> {
    const findings: Array<DataDriftFinding> = [];

    for (const row of rows) {
      if (
        row.recentSamples < DATA_DRIFT_MIN_SAMPLES ||
        row.priorSamples < DATA_DRIFT_MIN_SAMPLES ||
        row.priorMean === 0
      ) {
        continue;
      }

      const relativeChange: number =
        (row.recentMean - row.priorMean) / Math.abs(row.priorMean);

      if (Math.abs(relativeChange) >= DATA_DRIFT_MIN_RELATIVE_CHANGE) {
        findings.push({ ...row, relativeChange });
      }
    }

    return findings
      .sort((a: DataDriftFinding, b: DataDriftFinding): number => {
        return (
          Math.abs(b.relativeChange) - Math.abs(a.relativeChange) ||
          a.subject.localeCompare(b.subject)
        );
      })
      .slice(0, DATA_DRIFT_MAX_INSIGHTS);
  }

  public static readRow(row: JSONObject): DataDriftRow {
    return {
      name: String(row["name"] || ""),
      subject: String(row["subject"] || ""),
      subjectName: String(row["subjectName"] || ""),
      recentMean: Number(row["recentMean"]) || 0,
      priorMean: Number(row["priorMean"]) || 0,
      recentSamples: Number(row["recentSamples"]) || 0,
      priorSamples: Number(row["priorSamples"]) || 0,
    };
  }

  public static toCandidate(finding: DataDriftFinding): InsightCandidate {
    const isCheck: boolean = finding.name === DATA_CHECK_METRIC_NAME;
    const percent: number = Math.round(finding.relativeChange * 100);
    const change: string = `${percent >= 0 ? "+" : ""}${percent}%`;
    const what: string = isCheck
      ? `Data check "${finding.subjectName}"`
      : `Rows in ${finding.subjectName}`;

    return {
      insightType: AIInsightType.DataDrift,
      fingerprint: `data-drift:${finding.name}:${finding.subject}`,
      title: `${what} moved ${change} in a week`,
      detailMarkdown: [
        "**Slow change in data (week over week)**",
        "",
        `- ${what}`,
        `- This week's average: ${finding.recentMean.toFixed(2)}`,
        `- Last week's average: ${finding.priorMean.toFixed(2)}`,
        `- Change: ${change}`,
        "",
        "It moved too slowly for an alert. This is a heads-up, not an alarm: growth and decline both have ordinary explanations.",
      ].join("\n"),
      severity: AIInsightSeverity.Low,
      metricName: finding.name,
      evidence: {
        dataDrift: {
          metricName: finding.name,
          subject: finding.subjectName,
          recentMean: finding.recentMean,
          priorMean: finding.priorMean,
          relativeChange: finding.relativeChange,
        },
      },
    };
  }

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    // The scan ticks every fifteen minutes, and this one read is a day's worth.
    if (
      context.now.getUTCHours() !== SCAN_HOUR ||
      context.now.getUTCMinutes() >= SCAN_TICK_IN_MINUTES
    ) {
      return [];
    }

    const result: Results = await MetricService.executeQuery(
      buildDataDriftStatement({
        projectId: context.projectId,
        now: context.now,
      }),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    return DataDriftDetector.evaluateDrift(
      ((response.data || []) as Array<JSONObject>).map(
        DataDriftDetector.readRow,
      ),
    ).map(DataDriftDetector.toCandidate);
  }
}
