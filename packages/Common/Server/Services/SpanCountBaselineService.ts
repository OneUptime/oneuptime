import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import SpanCountBaseline from "../../Models/AnalyticsModels/SpanCountBaseline";
import { CountBaselineSummary } from "../Utils/Monitor/Criteria/CountAnomaly";
import CountWindowBaseline from "../Utils/Monitor/CountWindowBaseline";
import logger, { LogAttributes } from "../Utils/Logger";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";

/**
 * Read-side service for the `SpanCountBaseline` MV target table — the
 * span-volume peer of `MetricBaselineService`.
 *
 * The table is declared by the {@link SpanCountBaseline} model and
 * created by the boot-time analytics schema-sync (table + MV, both
 * idempotent). Rows are populated by the attached MV; this service only
 * reads.
 *
 * `getBaseline(...)` reads what is normal for a monitor's window from
 * the earlier weeks of the rolling window (see
 * {@link CountWindowBaseline}) — keeping the math in TS makes it
 * unit-testable. Window/minSamples defaults and caps are shared with
 * MetricBaselineService so every anomaly criterion behaves alike.
 */
export class SpanCountBaselineService extends AnalyticsDatabaseService<SpanCountBaseline> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: SpanCountBaseline, database: clickhouseDatabase });
  }

  /**
   * Fetch the rolling-window baseline of a window of `windowSeconds`
   * ending at `windowEnd`, as spans per minute, for one (project,
   * [services], [statuses]) scope. Returns null while the services have
   * nothing in the rolling window.
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
    windowEnd: Date;
    windowSeconds: number;
    windowDays?: number | undefined;
    minSamples?: number | undefined;
  }): Promise<CountBaselineSummary | null> {
    const projectIdStr: string = this.escapeString(
      input.projectId instanceof ObjectID
        ? input.projectId.toString()
        : input.projectId,
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
    /*
     * GROUP BY a window also folds across services/statuses when the IN
     * clauses are broad, so a multi-service monitor baselines its
     * combined volume — matching what its observed spanCount measures.
     */
    const summary: CountBaselineSummary | null = await CountWindowBaseline.read(
      {
        tableName: "SpanCountBaseline",
        countExpression:
          statusCodes.length > 0
            ? `countMergeIf(spanCountState, statusCode IN (${statusCodes
                .map((code: number) => {
                  return String(Math.floor(code));
                })
                .join(", ")}))`
            : "countMerge(spanCountState)",
        scopeClause: `projectId = '${projectIdStr}' ${serviceIdClause}`,
        windowEnd: input.windowEnd,
        windowSeconds: input.windowSeconds,
        windowDays: input.windowDays,
        minSamples: input.minSamples,
        query: async (sql: string): Promise<Array<JSONObject>> => {
          const resultSet: { json: () => Promise<{ data: Array<JSONObject> }> } =
            (await this.executeQuery(sql)) as unknown as {
              json: () => Promise<{ data: Array<JSONObject> }>;
            };

          return (await resultSet.json()).data;
        },
      },
    );

    logger.debug("SpanCountBaselineService.getBaseline", {
      projectId: projectIdStr,
      hourOfWeek: summary?.hourOfWeek,
      sampleCount: summary?.sampleCount,
      isReliable: summary?.isReliable,
    } as LogAttributes);

    return summary;
  }

  private escapeString(v: string): string {
    // ClickHouse string-literal escape for backslash and single quote.
    return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }
}

export default new SpanCountBaselineService();
