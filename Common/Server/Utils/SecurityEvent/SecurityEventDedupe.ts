import { ResponseJSON, ResultSet } from "@clickhouse/client";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityEventService from "../../Services/SecurityEventService";
import {
  getClickhouseClusterName,
  getClickhouseDatabaseName,
  getStorageTableName,
} from "../AnalyticsDatabase/ClusterConfig";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";

export const SECURITY_EVENT_DEDUPE_CHUNK_SIZE: number = 1000;
export const SECURITY_EVENT_DEDUPE_TIME_LIMIT_MS: number = 2 * 60 * 1000;

/*
 * Which stored eventUids already exist for one source in one project.
 *
 * ClickHouse does not deduplicate eventUid, so every managed connector
 * looks up before it inserts, under a per-source lock. This is a
 * correctness lookup, not a dashboard query: a partial result on timeout
 * or a lagging replica would create duplicates, so it reads every replica
 * and fails closed on an unavailable shard. Shared by the Google SecOps
 * poller and the Security Event Connections poller so the two cannot
 * drift.
 */
export default class SecurityEventDedupe {
  public static async findExistingEventUids(data: {
    projectId: ObjectID;
    vendorName: string;
    productName: string;
    ids: Array<string>;
  }): Promise<Set<string>> {
    const existing: Set<string> = new Set();
    const startedMs: number = Date.now();

    for (
      let offset: number = 0;
      offset < data.ids.length;
      offset += SECURITY_EVENT_DEDUPE_CHUNK_SIZE
    ) {
      if (Date.now() - startedMs >= SECURITY_EVENT_DEDUPE_TIME_LIMIT_MS) {
        throw new Error(
          "Duplicate lookup exceeded its time limit. Retry a smaller import window.",
        );
      }

      const statement: Statement = SQL`SELECT DISTINCT eventUid FROM clusterAllReplicas(
        ${{ type: TableColumnType.Text, value: getClickhouseClusterName() }},
        ${{ type: TableColumnType.Text, value: getClickhouseDatabaseName() }},
        ${{ type: TableColumnType.Text, value: getStorageTableName(SecurityEventService.model.tableName) }}
      ) WHERE projectId = ${{ type: TableColumnType.ObjectID, value: data.projectId }}
        AND vendorName = ${{ type: TableColumnType.Text, value: data.vendorName }}
        AND productName = ${{ type: TableColumnType.Text, value: data.productName }}
        AND eventUid IN ${{ type: TableColumnType.ArrayText, value: data.ids.slice(offset, offset + SECURITY_EVENT_DEDUPE_CHUNK_SIZE) }}`;

      statement.append(
        getQuerySettings({
          maxExecutionTimeInSeconds: 30,
          timeoutOverflowMode: "throw",
          boundScanMemory: true,
          additionalSettings: { skip_unavailable_shards: 0 },
        }),
      );

      const response: ResultSet<"JSON"> =
        await SecurityEventService.executeQuery(statement);
      const result: ResponseJSON<JSONObject> =
        await response.json<JSONObject>();

      for (const row of result.data) {
        if (typeof row["eventUid"] === "string") {
          existing.add(row["eventUid"]);
        }
      }
    }

    return existing;
  }
}
