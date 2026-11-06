import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import {
  DataObservabilityTableErrorLog,
  DataObservabilityTableErrors,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { Results } from "../../Services/AnalyticsDatabaseService";
import DataAssetService from "../../Services/DataAssetService";
import DataAssetUsageService from "../../Services/DataAssetUsageService";
import LogService from "../../Services/LogService";
import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import { getClickhouseDatabaseName } from "../AnalyticsDatabase/ClusterConfig";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { readClickhouseDate } from "./TableUsageDiscovery";
import { ResponseJSON } from "@clickhouse/client";

/*
 * THE ERRORS BEHIND A TABLE THAT STOPPED CHANGING.
 *
 * When a table goes quiet, the service that writes it is where to look, and its
 * own errors often name the table: a column that does not exist, a constraint
 * that fails, a lock that times out. So this finds, in the services seen writing
 * the table (TableUsageDiscovery), the exceptions still open and the error logs
 * of the last day that mention it by name.
 *
 * A name is matched as text, so a very short one would match everything: under
 * MIN_NAME_LENGTH nothing is searched.
 */

const MAX_WRITERS: number = 10;
const MAX_EXCEPTIONS: number = 10;
const MAX_LOGS: number = 20;
const MAX_MESSAGE_LENGTH: number = 400;
const LOG_WINDOW_IN_HOURS: number = 24;
const MIN_NAME_LENGTH: number = 4;

// What OpenTelemetry calls ERROR and above.
const ERROR_SEVERITY_NUMBER: number = 17;

export function buildTableErrorLogsStatement(data: {
  projectId: ObjectID;
  serviceIds: Array<ObjectID>;
  tableName: string;
  since: Date;
}): Statement {
  const statement: Statement = SQL`SELECT time, severityText, body, primaryEntityId FROM `;

  statement.append(`${getClickhouseDatabaseName()}.${AnalyticsTableName.Log}`);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.Date,
      value: data.since,
    }} AND severityNumber >= ${{
      type: TableColumnType.Number,
      value: ERROR_SEVERITY_NUMBER,
    }} AND positionCaseInsensitive(body, ${{
      type: TableColumnType.Text,
      value: data.tableName,
    }}) > 0 AND (`,
  );

  data.serviceIds.forEach((serviceId: ObjectID, index: number) => {
    if (index > 0) {
      statement.append(" OR ");
    }

    statement.append(
      SQL`primaryEntityId = ${{
        type: TableColumnType.ObjectID,
        value: serviceId,
      }}`,
    );
  });

  statement.append(
    SQL`) ORDER BY time DESC LIMIT ${{
      type: TableColumnType.Number,
      value: MAX_LOGS,
    }}`,
  );
  statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

  return statement;
}

export function readTableErrorLog(
  row: JSONObject,
  serviceNames: Map<string, string>,
): DataObservabilityTableErrorLog | null {
  const time: Date | null = readClickhouseDate(row["time"]);

  return time
    ? {
        time: time.toISOString(),
        severity: String(row["severityText"] || ""),
        body: String(row["body"] || "").slice(0, MAX_MESSAGE_LENGTH),
        serviceName:
          serviceNames.get(String(row["primaryEntityId"] || "")) || "",
      }
    : null;
}

export default class DataTableErrors {
  public static async read(data: {
    projectId: ObjectID;
    dataAssetId: ObjectID;
    now: Date;
  }): Promise<DataObservabilityTableErrors> {
    const answer: DataObservabilityTableErrors = {
      services: [],
      exceptions: [],
      logs: [],
    };
    const asset: DataAsset | null = await DataAssetService.findOneBy({
      query: { projectId: data.projectId, _id: data.dataAssetId },
      select: { name: true },
      props: { isRoot: true },
    });
    const writers: Array<DataAssetUsage> = await DataAssetUsageService.findBy({
      query: {
        projectId: data.projectId,
        dataAssetId: data.dataAssetId,
        accessKind: DataAssetAccessKind.Write,
      },
      select: { serviceId: true, serviceName: true },
      limit: MAX_WRITERS,
      skip: 0,
      props: { isRoot: true },
    });
    const serviceNames: Map<string, string> = new Map();
    const serviceIds: Array<ObjectID> = [];

    for (const writer of writers) {
      if (writer.serviceId) {
        serviceIds.push(writer.serviceId);
        serviceNames.set(writer.serviceId.toString(), writer.serviceName || "");
      }
    }

    answer.services = [...serviceNames.values()];

    const name: string = asset?.name || "";

    if (serviceIds.length === 0 || name.length < MIN_NAME_LENGTH) {
      return answer;
    }

    const exceptions: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: {
          projectId: data.projectId,
          primaryEntityId: new Includes(serviceIds),
          message: new Search(name),
          isResolved: false,
          isArchived: false,
        },
        select: {
          _id: true,
          exceptionType: true,
          message: true,
          occuranceCount: true,
          lastSeenAt: true,
          primaryEntityId: true,
        },
        sort: { lastSeenAt: SortOrder.Descending },
        limit: MAX_EXCEPTIONS,
        skip: 0,
        props: { isRoot: true },
      });

    answer.exceptions = exceptions.map((exception: TelemetryException) => {
      return {
        id: exception.id?.toString() || "",
        type: exception.exceptionType || "",
        message: (exception.message || "").slice(0, MAX_MESSAGE_LENGTH),
        serviceName:
          serviceNames.get(exception.primaryEntityId?.toString() || "") || "",
        count: exception.occuranceCount || 0,
        lastSeenAt: exception.lastSeenAt
          ? new Date(exception.lastSeenAt).toISOString()
          : null,
      };
    });

    const result: Results = await LogService.executeQuery(
      buildTableErrorLogsStatement({
        projectId: data.projectId,
        serviceIds,
        tableName: name,
        since: OneUptimeDate.addRemoveHours(data.now, -LOG_WINDOW_IN_HOURS),
      }),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    for (const row of (response.data || []) as Array<JSONObject>) {
      const log: DataObservabilityTableErrorLog | null = readTableErrorLog(
        row,
        serviceNames,
      );

      if (log) {
        answer.logs.push(log);
      }
    }

    return answer;
  }
}
