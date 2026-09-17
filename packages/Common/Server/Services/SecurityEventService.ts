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
  /*
   * uniqExact of the rule's distinctCountField over the group's matches;
   * 0 whenever the rule has no distinct-count field (the query emits a
   * constant, not an aggregate, in that case).
   */
  distinctCount: number;
  sampleMessage: string;
  sampleObservables: Array<string>;
}

export interface FindDetectionMatchesData {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  whereFragment: Statement;
  groupByExpression: Statement | null;
  distinctCountExpression: Statement | null;
  minMatchCount: number;
  maxGroups: number;
}

/*
 * The in-process twin of the HAVING clause findDetectionMatches emits —
 * exported so the evaluator's re-filter and the SQL builder live in one
 * file, and a change to either side of the firing predicate is reviewed
 * next to the other.
 */
export function doesGroupMeetDetectionThreshold(data: {
  group: DetectionMatchGroup;
  usesDistinctCount: boolean;
  minMatchCount: number;
}): boolean {
  if (data.group.matchCount <= 0) {
    return false;
  }

  const effectiveCount: number = data.usesDistinctCount
    ? data.group.distinctCount
    : data.group.matchCount;

  return effectiveCount >= Math.max(1, data.minMatchCount);
}

export class SecurityEventService extends AnalyticsDatabaseService<SecurityEvent> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: SecurityEvent, database: clickhouseDatabase });
  }

  /*
   * Detection-engine query: count matching events in a window, grouped by
   * an optional field expression. `whereFragment`, `groupByExpression`
   * and `distinctCountExpression` are Statements built by
   * SigmaClickhouseCompiler — every rule-controlled value inside them is
   * a bound parameter.
   *
   * When distinctCountExpression is set, the threshold applies to
   * uniqExact of that field, not the raw match count — and empty values
   * are excluded via nullIf, so "5 distinct usernames" never counts rows
   * that carry no username. The threshold is enforced in HAVING so the
   * maxGroups LIMIT keeps only qualifying groups instead of letting
   * noisy-but-under-threshold groups crowd out real ones.
   */
  public async findDetectionMatches(
    data: FindDetectionMatchesData,
  ): Promise<Array<DetectionMatchGroup>> {
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

    statement.append(" AS groupValue, count() AS matchCount, ");

    if (data.distinctCountExpression) {
      statement.append("uniqExact(nullIf(");
      statement.append(data.distinctCountExpression);
      statement.append(", ''))");
    } else {
      statement.append("0");
    }

    statement.append(
      ` AS distinctCount, any(message) AS sampleMessage, arrayDistinct(arrayFlatten(groupArray(20)(observables))) AS sampleObservables FROM ${databaseName}.${this.model.tableName} WHERE `,
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
    statement.append(") GROUP BY groupValue");

    /*
     * The effective count — what the rule's threshold means — is the
     * distinct count when a distinct expression was given, else the raw
     * match count. A distinct-count rule always gets a HAVING clause,
     * even at threshold 1: a group whose matches all lack the counted
     * field has distinctCount 0 and must not fire.
     */
    const effectiveCountColumn: string = data.distinctCountExpression
      ? "distinctCount"
      : "matchCount";
    const minMatchCount: number = Math.max(1, data.minMatchCount);

    if (data.distinctCountExpression || minMatchCount > 1) {
      statement.append(` HAVING ${effectiveCountColumn} >= `);
      statement.append(
        SQL`${{
          type: TableColumnType.Number,
          value: minMatchCount,
        }}`,
      );
    }

    statement.append(` ORDER BY ${effectiveCountColumn} DESC LIMIT `);
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
        distinctCount: Number(row["distinctCount"] || 0),
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
