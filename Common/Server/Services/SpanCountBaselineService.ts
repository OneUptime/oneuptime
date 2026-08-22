import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import SpanCountBaseline from "../../Models/AnalyticsModels/SpanCountBaseline";
import { MetricBaselineService } from "./MetricBaselineService";
import CountAnomaly, {
  CountBaselineStats,
  CountBaselineSummary,
} from "../Utils/Monitor/Criteria/CountAnomaly";
import logger, { LogAttributes } from "../Utils/Logger";
import ObjectID from "../../Types/ObjectID";

/**
 * Read-side service for the `SpanCountBaseline` MV target table — the
 * span-volume peer of `MetricBaselineService`.
 *
 * The table is declared by the {@link SpanCountBaseline} model and
 * created by the boot-time analytics schema-sync (table + MV, both
 * idempotent). Rows are populated by the attached MV; this service only
 * reads.
 *
 * `getBaseline(...)` fetches the per-minute span counts of one
 * hour-of-week cell over the rolling window and computes the stats in
 * app code via {@link CountAnomaly.computeStats} — the input is at most
 * `60 × ceil(windowDays / 7)` rows, and keeping the math in TS makes it
 * unit-testable. Window/minSamples defaults and caps are shared with
 * MetricBaselineService so every anomaly criterion behaves alike.
 */
export class SpanCountBaselineService extends AnalyticsDatabaseService<SpanCountBaseline> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: SpanCountBaseline, database: clickhouseDatabase });
  }

  /**
   * Fetch the rolling-window baseline of spans-per-minute for one
   * (project, [services], [statuses], hour-of-week) cell. Returns null
   * when no data exists.
   *
   * `telemetryServiceIds` empty/omitted aggregates across every service
   * in the project; `spanStatusCodes` empty/omitted aggregates across
   * every span status — matching how the Traces monitor query itself
   * broadens when those filters are unset.
   */
  public async getBaseline(input: {
    projectId: ObjectID | string;
    telemetryServiceIds?: Array<ObjectID | string> | undefined;
    spanStatusCodes?: Array<number> | undefined;
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

    /*
     * Persisted monitor steps round-trip through JSON, so status codes
     * can arrive as numeric strings — coerce before filtering rather
     * than silently dropping the criterion's scope.
     */
    const statusCodes: Array<number> = (input.spanStatusCodes || [])
      .map((code: number) => {
        return Number(code);
      })
      .filter((code: number) => {
        return Number.isFinite(code);
      });
    const statusCodeClause: string =
      statusCodes.length > 0
        ? `AND statusCode IN (${statusCodes
            .map((code: number) => {
              return String(Math.floor(code));
            })
            .join(", ")})`
        : "";

    /*
     * One row per non-empty minute cell; each row's merged count is a
     * raw baseline sample ("spans in that minute"). GROUP BY day +
     * minuteOfHour also folds across services/statuses when the IN
     * clauses are broad, so a multi-service monitor baselines its
     * combined volume — matching what its observed spanCount measures.
     */
    const sql: string = `
      SELECT
        countMerge(spanCountState) AS c
      FROM SpanCountBaseline
      WHERE projectId = '${projectIdStr}'
        ${serviceIdClause}
        ${statusCodeClause}
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

    logger.debug("SpanCountBaselineService.getBaseline", {
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

export default new SpanCountBaselineService();
