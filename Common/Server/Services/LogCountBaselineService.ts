import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import LogCountBaseline from "../../Models/AnalyticsModels/LogCountBaseline";
import { MetricBaselineService } from "./MetricBaselineService";
import CountAnomaly, {
  CountBaselineStats,
  CountBaselineSummary,
} from "../Utils/Monitor/Criteria/CountAnomaly";
import logger, { LogAttributes } from "../Utils/Logger";
import ObjectID from "../../Types/ObjectID";

/**
 * Read-side service for the `LogCountBaseline` MV target table — the
 * log-volume peer of `SpanCountBaselineService` (see that service and
 * `MetricBaselineService` for the shared design notes).
 *
 * `getBaseline(...)` fetches the per-minute log counts of one
 * hour-of-week cell over the rolling window and computes the stats in
 * app code via {@link CountAnomaly.computeStats}. Window/minSamples
 * defaults and caps are shared with MetricBaselineService so every
 * anomaly criterion behaves alike.
 */
export class LogCountBaselineService extends AnalyticsDatabaseService<LogCountBaseline> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: LogCountBaseline, database: clickhouseDatabase });
  }

  /**
   * Fetch the rolling-window baseline of logs-per-minute for one
   * (project, [services], [severities], hour-of-week) cell. Returns
   * null when no data exists.
   *
   * `telemetryServiceIds` empty/omitted aggregates across every service
   * in the project; `severityTexts` empty/omitted aggregates across
   * every severity — matching how the Logs monitor query itself
   * broadens when those filters are unset.
   */
  public async getBaseline(input: {
    projectId: ObjectID | string;
    telemetryServiceIds?: Array<ObjectID | string> | undefined;
    severityTexts?: Array<string> | undefined;
    hourOfWeek: number;
    windowDays?: number | undefined;
    minSamples?: number | undefined;
  }): Promise<CountBaselineSummary | null> {
    const windowDays: number = Math.min(
      input.windowDays || MetricBaselineService.DEFAULT_WINDOW_DAYS,
      MetricBaselineService.MAX_WINDOW_DAYS,
    );
    const minSamples: number =
      input.minSamples || MetricBaselineService.DEFAULT_MIN_SAMPLES;

    const projectIdStr: string = this.escapeString(
      input.projectId instanceof ObjectID
        ? input.projectId.toString()
        : input.projectId,
    );
    const hour: number = Math.max(
      0,
      Math.min(167, Math.floor(input.hourOfWeek)),
    );

    const serviceIds: Array<string> = (input.telemetryServiceIds || []).map(
      (id: ObjectID | string) => {
        return this.escapeString(id instanceof ObjectID ? id.toString() : id);
      },
    );
    const serviceIdClause: string =
      serviceIds.length > 0
        ? `AND primaryEntityId IN (${serviceIds
            .map((id: string) => {
              return `'${id}'`;
            })
            .join(", ")})`
        : "";

    const severities: Array<string> = (input.severityTexts || [])
      .filter((severity: string) => {
        return Boolean(severity);
      })
      .map((severity: string) => {
        return this.escapeString(severity);
      });
    const severityClause: string =
      severities.length > 0
        ? `AND severityText IN (${severities
            .map((severity: string) => {
              return `'${severity}'`;
            })
            .join(", ")})`
        : "";

    /*
     * One row per non-empty minute cell; each row's merged count is a
     * raw baseline sample ("logs in that minute"). GROUP BY day +
     * minuteOfHour also folds across services/severities when the IN
     * clauses are broad, so a multi-service monitor baselines its
     * combined volume — matching what its observed logCount measures.
     */
    const sql: string = `
      SELECT
        countMerge(logCountState) AS c
      FROM LogCountBaseline
      WHERE projectId = '${projectIdStr}'
        ${serviceIdClause}
        ${severityClause}
        AND hourOfWeek = ${hour}
        AND day >= today() - INTERVAL ${windowDays} DAY
      GROUP BY day, minuteOfHour
    `;

    const resultSet: {
      json: () => Promise<{ data: Array<{ c: number | string }> }>;
    } = (await this.executeQuery(sql)) as unknown as {
      json: () => Promise<{ data: Array<{ c: number | string }> }>;
    };

    const parsed: { data: Array<{ c: number | string }> } =
      await resultSet.json();

    const counts: Array<number> = parsed.data.map(
      (row: { c: number | string }) => {
        return this.toNumber(row.c);
      },
    );

    const stats: CountBaselineStats | null = CountAnomaly.computeStats(counts);
    if (!stats) {
      return null;
    }

    const summary: CountBaselineSummary = {
      ...stats,
      isReliable: stats.sampleCount >= minSamples,
      windowDays,
      hourOfWeek: hour,
    };

    logger.debug("LogCountBaselineService.getBaseline", {
      projectId: projectIdStr,
      hourOfWeek: hour,
      sampleCount: summary.sampleCount,
      isReliable: summary.isReliable,
    } as LogAttributes);

    return summary;
  }

  private toNumber(v: number | string | undefined): number {
    if (typeof v === "number") {
      return v;
    }
    const n: number = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private escapeString(v: string): string {
    // ClickHouse string-literal escape for backslash and single quote.
    return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }
}

export default new LogCountBaselineService();
