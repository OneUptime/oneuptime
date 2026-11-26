import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";
import SecurityEventLateArrival from "../../Models/AnalyticsModels/SecurityEventLateArrival";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import {
  SECURITY_EVENT_LATE_ARRIVAL_MAX_SOURCES,
  SecurityEventLateArrivalSource,
  SecurityEventLateArrivals,
  getLateArrivalsSince,
} from "../../Types/SecurityEvent/SecurityEventLateArrival";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../Utils/Telemetry/TelemetryReadScope";

// ClickHouse renders DateTime64 and DateTime as "2026-10-14 09:00:00[.000000000]", in UTC.
function readDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const text: string = String(value);
  const date: Date = new Date(
    text.includes("T") ? text : `${text.replace(" ", "T")}Z`,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function readCount(value: unknown): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/*
 * The security events that arrived more than a day after they happened
 * (#10491), as the materialized view counted them
 * (Models/AnalyticsModels/SecurityEventLateArrival): how many, from which
 * sources, and when they happened and arrived.
 */
export class SecurityEventLateArrivalService extends AnalyticsDatabaseService<SecurityEventLateArrival> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: SecurityEventLateArrival,
      database: clickhouseDatabase,
    });
  }

  /*
   * One read of a project's days since arrivedSince, a row per source, the
   * sources with the most late events first. A read made for a person
   * names the sources they may read (TelemetryReadAccess.getServiceFilter).
   */
  public buildLateArrivalsStatement(data: {
    projectId: ObjectID;
    arrivedSince: Date;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT vendorName, productName, countMerge(eventCountState) AS eventCount, minMerge(happenedFromState) AS happenedFrom, maxMerge(happenedToState) AS happenedTo, minMerge(arrivedFromState) AS arrivedFrom, maxMerge(arrivedToState) AS arrivedTo FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND day >= ${{
        type: TableColumnType.Date,
        value: data.arrivedSince,
      }}`,
    );
    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );
    statement.append(
      SQL` GROUP BY vendorName, productName ORDER BY eventCount DESC, productName ASC, vendorName ASC LIMIT ${{
        type: TableColumnType.Number,
        value: SECURITY_EVENT_LATE_ARRIVAL_MAX_SOURCES,
      }}`,
    );
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 30 }));

    return statement;
  }

  // What arrived late in the last week (SECURITY_EVENT_LATE_ARRIVAL_NOTICE_DAYS).
  public async getLateArrivals(data: {
    projectId: ObjectID;
    serviceFilter?: TelemetryServiceFilter | undefined;
    now?: Date | undefined;
  }): Promise<SecurityEventLateArrivals> {
    const arrivedSince: Date = getLateArrivalsSince(
      data.now || OneUptimeDate.getCurrentDate(),
    );

    const result: Results = await this.executeQuery(
      this.buildLateArrivalsStatement({
        projectId: data.projectId,
        arrivedSince,
        serviceFilter: data.serviceFilter,
      }),
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return SecurityEventLateArrivalService.readLateArrivals({
      arrivedSince,
      rows: response.data || [],
    });
  }

  // The rows as sources: one with no count, or a time that is not one, is left out.
  public static readLateArrivals(data: {
    arrivedSince: Date;
    rows: Array<JSONObject>;
  }): SecurityEventLateArrivals {
    const sources: Array<SecurityEventLateArrivalSource> = [];

    for (const row of data.rows) {
      const eventCount: number = readCount(row["eventCount"]);
      const happenedFrom: Date | null = readDate(row["happenedFrom"]);
      const happenedTo: Date | null = readDate(row["happenedTo"]);
      const arrivedFrom: Date | null = readDate(row["arrivedFrom"]);
      const arrivedTo: Date | null = readDate(row["arrivedTo"]);

      if (
        eventCount === 0 ||
        !happenedFrom ||
        !happenedTo ||
        !arrivedFrom ||
        !arrivedTo
      ) {
        continue;
      }

      sources.push({
        vendorName: String(row["vendorName"] ?? ""),
        productName: String(row["productName"] ?? ""),
        eventCount,
        happenedFrom,
        happenedTo,
        arrivedFrom,
        arrivedTo,
      });
    }

    return {
      arrivedSince: data.arrivedSince,
      eventCount: sources.reduce(
        (total: number, source: SecurityEventLateArrivalSource): number => {
          return total + source.eventCount;
        },
        0,
      ),
      sources,
    };
  }
}

export default new SecurityEventLateArrivalService();
