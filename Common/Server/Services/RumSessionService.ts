import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import RumSession from "../../Models/AnalyticsModels/RumSession";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import { ResponseJSON, ResultSet } from "@clickhouse/client";

export class RumSessionService extends AnalyticsDatabaseService<RumSession> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: RumSession, database: clickhouseDatabase });
  }

  /*
   * Session-replay usage for billing.
   *
   * Deliberately NOT the inherited groupTelemetryUsageByService, for two
   * reasons that both matter:
   *
   * 1. It meters off THIS table, never the chunk table. Chunks are
   *    partitioned by expiry date, so a "yesterday" window over them cannot
   *    prune partitions and would full-scan a multi-gigabyte blob table under
   *    the 120s cap. A timeout there is not a retry - stageTelemetryUsage
   *    always targets yesterday and nothing re-stages an older date, so the
   *    day would be billed as zero permanently.
   *
   * 2. It sums the exact payloadBytes recorded at ingest rather than
   *    byteSize(*). byteSize is ClickHouse's uncompressed in-memory row size,
   *    which for a table whose rows are mostly a few narrow numbers would
   *    have nothing to do with what was actually ingested.
   *
   * isFinalized = 1 excludes provisional headers, whose aggregates are still
   * zero. A session that finalizes across the staging boundary is therefore
   * billed on the following day's run at its true size, rather than being
   * billed now at zero and never corrected.
   *
   * The inner ORDER BY / LIMIT 1 BY collapses ReplacingMergeTree versions:
   * there is no FINAL support anywhere in this repo, so duplicate versions of
   * a header are visible until a merge and would otherwise be summed twice.
   */
  @CaptureSpan()
  public async groupSessionReplayUsageByEntity(data: {
    projectId: ObjectID;
    startDate: Date;
    endDate: Date;
  }): Promise<
    Array<{
      primaryEntityId: string;
      primaryEntityType: string | null;
      rowCount: number;
      estimatedBytes: number;
    }>
  > {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT primaryEntityId AS primaryEntityId, primaryEntityType AS primaryEntityType, count() AS rowCount, sum(payloadBytes) AS estimatedBytes FROM (SELECT projectId, sessionId, primaryEntityId, primaryEntityType, payloadBytes FROM ${databaseName}.${this.model.tableName} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND startTime >= ${{
      type: TableColumnType.DateTime64,
      value: data.startDate,
    }} AND startTime <= ${{
      type: TableColumnType.DateTime64,
      value: data.endDate,
    }} AND isFinalized = 1 ORDER BY version DESC LIMIT 1 BY projectId, sessionId) GROUP BY primaryEntityId, primaryEntityType`;

    /*
     * Same reasoning as the shared billing scan: no
     * timeout_overflow_mode='break', because a partial aggregation would
     * silently undercount and be billed as though it were complete.
     */
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 120 }));

    const dbResult: ResultSet<"JSON"> = await this.executeQuery(statement);
    const responseJSON: ResponseJSON<JSONObject> =
      await dbResult.json<JSONObject>();
    const items: Array<JSONObject> = responseJSON.data ? responseJSON.data : [];

    const results: Array<{
      primaryEntityId: string;
      primaryEntityType: string | null;
      rowCount: number;
      estimatedBytes: number;
    }> = [];

    for (const item of items) {
      const primaryEntityId: string = (item["primaryEntityId"] as string) || "";

      if (!primaryEntityId) {
        continue;
      }

      const entityTypeRaw: unknown = item["primaryEntityType"];
      const primaryEntityType: string | null =
        typeof entityTypeRaw === "string" && entityTypeRaw.trim()
          ? entityTypeRaw
          : null;

      results.push({
        primaryEntityId: primaryEntityId,
        primaryEntityType: primaryEntityType,
        /*
         * 64-bit sums arrive from ClickHouse as JSON strings, so Number() is
         * load-bearing rather than defensive.
         */
        rowCount: Number(item["rowCount"]) || 0,
        estimatedBytes: Number(item["estimatedBytes"]) || 0,
      });
    }

    return results;
  }
}

export default new RumSessionService();
