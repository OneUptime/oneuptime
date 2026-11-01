import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import LogCountBaseline from "../../Models/AnalyticsModels/LogCountBaseline";
import { CountBaselineSummary } from "../Utils/Monitor/Criteria/CountAnomaly";
import CountWindowBaseline from "../Utils/Monitor/CountWindowBaseline";
import logger, { LogAttributes } from "../Utils/Logger";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";

/**
 * Read-side service for the `LogCountBaseline` MV target table — the
 * log-volume peer of `SpanCountBaselineService` (see that service and
 * `MetricBaselineService` for the shared design notes).
 *
 * `getBaseline(...)` reads what is normal for a monitor's window from
 * the earlier weeks of the rolling window (see
 * {@link CountWindowBaseline}). Window/minSamples defaults and caps are
 * shared with MetricBaselineService so every anomaly criterion behaves
 * alike.
 */
export class LogCountBaselineService extends AnalyticsDatabaseService<LogCountBaseline> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: LogCountBaseline, database: clickhouseDatabase });
  }

  /**
   * Fetch the rolling-window baseline of a window of `windowSeconds`
   * ending at `windowEnd`, as logs per minute, for one (project,
   * [services], [severities]) scope. Returns null while the services
   * have nothing in the rolling window.
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

    const severities: Array<string> = (input.severityTexts || [])
      .filter((severity: string) => {
        return Boolean(severity);
      })
      .map((severity: string) => {
        return this.escapeString(severity);
      });
    /*
     * GROUP BY a window also folds across services/severities when the
     * IN clauses are broad, so a multi-service monitor baselines its
     * combined volume — matching what its observed logCount measures.
     */
    const summary: CountBaselineSummary | null = await CountWindowBaseline.read(
      {
        tableName: "LogCountBaseline",
        countExpression:
          severities.length > 0
            ? `countMergeIf(logCountState, severityText IN (${severities
                .map((severity: string) => {
                  return `'${severity}'`;
                })
                .join(", ")}))`
            : "countMerge(logCountState)",
        scopeClause: `projectId = '${projectIdStr}' ${serviceIdClause}`,
        windowEnd: input.windowEnd,
        windowSeconds: input.windowSeconds,
        windowDays: input.windowDays,
        minSamples: input.minSamples,
        query: async (sql: string): Promise<Array<JSONObject>> => {
          const resultSet: {
            json: () => Promise<{ data: Array<JSONObject> }>;
          } = (await this.executeQuery(sql)) as unknown as {
            json: () => Promise<{ data: Array<JSONObject> }>;
          };

          return (await resultSet.json()).data;
        },
      },
    );

    logger.debug("LogCountBaselineService.getBaseline", {
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

export default new LogCountBaselineService();
