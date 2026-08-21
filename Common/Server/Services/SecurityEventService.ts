import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";
import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";

export interface DetectionMatchGroup {
  groupValue: string;
  matchCount: number;
  sampleMessage: string;
  sampleObservables: Array<string>;
}

export class SecurityEventService extends AnalyticsDatabaseService<SecurityEvent> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: SecurityEvent, database: clickhouseDatabase });
  }

  /*
   * Detection-engine query: count matching events in a window, grouped by
   * an optional field expression. `whereFragment` and
   * `groupByExpression` are Statements built by SigmaClickhouseCompiler —
   * every rule-controlled value inside them is a bound parameter.
   */
  public async findDetectionMatches(data: {
    projectId: ObjectID;
    startTime: Date;
    endTime: Date;
    whereFragment: Statement;
    groupByExpression: Statement | null;
    maxGroups: number;
  }): Promise<Array<DetectionMatchGroup>> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT `;

    if (data.groupByExpression) {
      statement.append(data.groupByExpression);
    } else {
      statement.append("''");
    }

    statement.append(
      ` AS groupValue, count() AS matchCount, any(message) AS sampleMessage, arrayDistinct(arrayFlatten(groupArray(20)(observables))) AS sampleObservables FROM ${databaseName}.${this.model.tableName} WHERE `,
    );

    statement.append(
      SQL`projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.startTime,
      }} AND time < ${{
        type: TableColumnType.DateTime64,
        value: data.endTime,
      }} AND (`,
    );

    statement.append(data.whereFragment);
    statement.append(") GROUP BY groupValue ORDER BY matchCount DESC LIMIT ");
    statement.append(
      SQL`${{
        type: TableColumnType.Number,
        value: data.maxGroups,
      }}`,
    );
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 60 }));

    const result: Results = await this.executeQuery(statement);

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map((row: JSONObject): DetectionMatchGroup => {
      return {
        groupValue: String(row["groupValue"] ?? ""),
        matchCount: Number(row["matchCount"] || 0),
        sampleMessage: String(row["sampleMessage"] ?? ""),
        sampleObservables: Array.isArray(row["sampleObservables"])
          ? (row["sampleObservables"] as Array<unknown>).map(
              (value: unknown): string => {
                return String(value);
              },
            )
          : [],
      };
    });
  }
}

export default new SecurityEventService();
