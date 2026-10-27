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
import {
  TimeoutOverflowMode,
  getQuerySettings,
} from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../Types/SecurityCase/SecurityConnection";
import { SECURITY_FINDINGS_CATEGORY_UID } from "../../Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { SECURITY_EVENT_RECORD_COLUMNS } from "../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../Utils/Telemetry/TelemetryReadScope";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  HTTP_ACTIVITY_CLASS_UID,
  SECURITY_ATTACK_CAMPAIGNS_MAX,
  SecurityAttackCampaign,
  readSecurityAttackCampaign,
} from "../../Types/SecurityEvent/SecurityAttackCampaign";
import { WEB_ATTACK_KIND_ATTRIBUTE } from "../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";

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
  /*
   * A correlation rule's match (CorrelationRuleMatcher): what happened, in
   * one sentence ("5 events of Failed sign-in, then Successful sign-in, 3
   * minutes apart"), written on its finding, alert and case.
   */
  summary?: string | undefined;
  /*
   * Each group-by field of a correlation and its value, so the case types
   * each entity by the field it came from. A single rule's group is typed
   * by the rule's Group By Field instead.
   */
  groupFields?: Array<{ field: string; value: string }> | undefined;
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

/*
 * What the events table says about one observable value over a window: how
 * many events mention it, how many of those are findings (a rule's, a
 * feed's or a connected product's), the worst severity among them, and when
 * it was first and last seen.
 */
export interface ObservableActivity {
  value: string;
  eventCount: number;
  findingCount: number;
  maxSeverityId: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
}

// Findings: OCSF Detection Finding and Incident Finding.
export const SECURITY_FINDING_CLASS_UIDS: Array<number> = [2004, 2005];

/*
 * How long the reads behind Security Events' connections may run - a case's
 * Connected Signals, a resource page's Security card - and how they stop: a
 * person is waiting, so a quarter of a minute, and 'throw', so a read that
 * runs out of time fails as exactly that rather than answering "nothing".
 */
export const SECURITY_CONNECTION_READ_TIME_LIMIT: Readonly<{
  maxExecutionTimeInSeconds: number;
  timeoutOverflowMode: TimeoutOverflowMode;
}> = {
  maxExecutionTimeInSeconds: 15,
  timeoutOverflowMode: "throw",
};

/*
 * How many security events named a record over a window: the Security card
 * on its page. The findings among them, the worst severity and when the
 * latest was.
 */
export interface SecurityEventsNamingSummary {
  eventCount: number;
  findingCount: number;
  maxSeverityId: number;
  lastSeen: Date | null;
}

// A record a "Your logs" event's log line was sent under, and how many events say so.
export interface SecurityEventLogResource {
  type: string;
  id: string;
  eventCount: number;
}

// The most values one activity lookup reads.
export const OBSERVABLE_ACTIVITY_MAX_VALUES: number = 50;

function readDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const text: string = String(value);
  // ClickHouse renders DateTime64 as "2026-10-14 09:00:00.000000000", in UTC.
  const date: Date = new Date(
    text.includes("T") ? text : `${text.replace(" ", "T")}Z`,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * One page of the events that arrived (createdAt) in a window, for a
 * destination to send: in arrival order, and in _id order within a second,
 * so the same window read again gives the same pages.
 */
export interface FindArrivedEventsData {
  projectId: ObjectID;
  // Exclusive.
  arrivedAfter: Date;
  // Inclusive.
  arrivedUntil: Date;
  /*
   * Events that happened before this are left out. The table is sorted by
   * the time events happened, so this is what keeps the read to the recent
   * parts of it.
   */
  happenedAfter: Date;
  // Only the Findings category (SecurityEventDestinationScope.Detections).
  findingsOnly: boolean;
  // Products whose events are never read (a SIEM's own imported alerts).
  excludeProductNames: Array<string>;
  limit: number;
  offset: number;
}

export class SecurityEventService extends AnalyticsDatabaseService<SecurityEvent> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: SecurityEvent, database: clickhouseDatabase });
  }

  /*
   * The events of one project that arrived in a window, a page at a time:
   * what a Security Event Destination sends. Always one project's: the
   * project is the first condition, so no read can return another
   * project's events.
   */
  public async findArrivedEvents(
    data: FindArrivedEventsData,
  ): Promise<Array<JSONObject>> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT `;
    statement.append(SECURITY_EVENT_RECORD_COLUMNS.join(", "));
    statement.append(` FROM ${databaseName}.${this.model.tableName} WHERE `);
    statement.append(
      SQL`projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.happenedAfter,
      }} AND createdAt > ${{
        type: TableColumnType.Date,
        value: data.arrivedAfter,
      }} AND createdAt <= ${{
        type: TableColumnType.Date,
        value: data.arrivedUntil,
      }}`,
    );

    if (data.findingsOnly) {
      statement.append(
        SQL` AND categoryUid = ${{
          type: TableColumnType.Number,
          value: SECURITY_FINDINGS_CATEGORY_UID,
        }}`,
      );
    }

    if (data.excludeProductNames.length > 0) {
      statement.append(
        SQL` AND NOT has(${{
          type: TableColumnType.ArrayText,
          value: data.excludeProductNames,
        }}, productName)`,
      );
    }

    statement.append(
      SQL` ORDER BY createdAt ASC, _id ASC LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.trunc(data.limit)),
      }} OFFSET ${{
        type: TableColumnType.Number,
        value: Math.max(0, Math.trunc(data.offset)),
      }}`,
    );
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 60 }));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
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

  /*
   * How active each of these values has been over a window, read from the
   * observables of every event: the case page's entity panel and the Look Up
   * Entity Activity playbook step. Values are matched as stored (the case's
   * entities come from these same observables); the bloom index on the
   * column narrows the scan to the granules that hold one.
   */
  public async findObservableActivity(data: {
    projectId: ObjectID;
    values: Array<string>;
    startTime: Date;
    endTime: Date;
    /*
     * The sources whose events the reader may read, for a read made for a
     * person (TelemetryReadAccess.getServiceFilter): a Security role scoped
     * to the sources it owns, or to some labels, reads those sources' events
     * alone. None: every source of the project, for OneUptime's own reads
     * (the Look Up Entity Activity step).
     */
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Promise<Array<ObservableActivity>> {
    const values: Array<string> = Array.from(
      new Set(
        data.values
          .map((value: string): string => {
            return value.trim();
          })
          .filter((value: string): boolean => {
            return value.length > 0;
          }),
      ),
    ).slice(0, OBSERVABLE_ACTIVITY_MAX_VALUES);

    if (values.length === 0) {
      return [];
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT observable AS value, count() AS eventCount, countIf(classUid IN (2004, 2005)) AS findingCount, max(severityId) AS maxSeverityId, min(time) AS firstSeen, max(time) AS lastSeen FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` ARRAY JOIN observables AS observable WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.startTime,
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: data.endTime,
      }} AND hasAny(observables, ${{
        type: TableColumnType.ArrayText,
        value: values,
      }}) AND has(${{
        type: TableColumnType.ArrayText,
        value: values,
      }}, observable)`,
    );
    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );
    statement.append(
      SQL` GROUP BY value ORDER BY eventCount DESC LIMIT ${{
        type: TableColumnType.Number,
        value: OBSERVABLE_ACTIVITY_MAX_VALUES,
      }}`,
    );
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 30 }));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map((row: JSONObject): ObservableActivity => {
      return {
        value: String(row["value"] ?? ""),
        eventCount: Number(row["eventCount"] || 0),
        findingCount: Number(row["findingCount"] || 0),
        maxSeverityId: Number(row["maxSeverityId"] || 0),
        firstSeen: readDate(row["firstSeen"]),
        lastSeen: readDate(row["lastSeen"]),
      };
    });
  }

  /*
   * The project's web attacks over a window, one row per address that sent
   * them (Types/SecurityEvent/SecurityAttackCampaign): how many requests,
   * how far they got, what kinds of attack, which tools, which requests.
   * Worst first - the furthest any request got, then the most requests -
   * and at most `limit + 1` rows, so the caller can tell there were more.
   */
  public async findAttackCampaigns(data: {
    projectId: ObjectID;
    startTime: Date;
    endTime: Date;
    limit: number;
  }): Promise<Array<SecurityAttackCampaign>> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;
    const limit: number = Math.max(
      1,
      Math.min(SECURITY_ATTACK_CAMPAIGNS_MAX, Math.trunc(data.limit)),
    );

    const statement: Statement = SQL`SELECT principalIp AS sourceIp, count() AS requestCount, countIf(requestOutcome = ${{
      type: TableColumnType.Text,
      value: SecurityEventRequestOutcome.Rejected,
    }}) AS rejectedCount, countIf(requestOutcome = ${{
      type: TableColumnType.Text,
      value: SecurityEventRequestOutcome.ReachedApp,
    }}) AS reachedAppCount, countIf(requestOutcome = ${{
      type: TableColumnType.Text,
      value: SecurityEventRequestOutcome.Errored,
    }}) AS erroredCount, countIf(requestOutcome = ${{
      type: TableColumnType.Text,
      value: SecurityEventRequestOutcome.ReachedDatabase,
    }}) AS reachedDatabaseCount, max(multiIf(requestOutcome = ${{
      type: TableColumnType.Text,
      value: SecurityEventRequestOutcome.ReachedDatabase,
    }}, 4, requestOutcome = ${{
      type: TableColumnType.Text,
      value: SecurityEventRequestOutcome.Errored,
    }}, 3, requestOutcome = ${{
      type: TableColumnType.Text,
      value: SecurityEventRequestOutcome.ReachedApp,
    }}, 2, requestOutcome = ${{
      type: TableColumnType.Text,
      value: SecurityEventRequestOutcome.Rejected,
    }}, 1, 0)) AS worstOutcomeRank, max(severityId) AS maxSeverityId, groupUniqArray(5)(attributes[${{
      type: TableColumnType.Text,
      value: WEB_ATTACK_KIND_ATTRIBUTE,
    }}]) AS attackKinds, groupUniqArray(3)(attributes[${{
      type: TableColumnType.Text,
      value: SECURITY_REQUEST_ATTRIBUTES.userAgent,
    }}]) AS userAgents, uniq(targetResource) AS targetCount, groupUniqArray(3)(substring(targetResource, 1, 300)) AS sampleTargets, min(time) AS firstSeen, max(time) AS lastSeen FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.startTime,
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: data.endTime,
      }} AND classUid = ${{
        type: TableColumnType.Number,
        value: HTTP_ACTIVITY_CLASS_UID,
      }} GROUP BY sourceIp ORDER BY worstOutcomeRank DESC, requestCount DESC, sourceIp ASC LIMIT ${{
        type: TableColumnType.Number,
        value: limit + 1,
      }}`,
    );
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 30 }));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map(
      (row: JSONObject): SecurityAttackCampaign => {
        return {
          ...readSecurityAttackCampaign(row),
          firstSeen: readDate(row["firstSeen"])?.toISOString() || "",
          lastSeen: readDate(row["lastSeen"])?.toISOString() || "",
        };
      },
    );
  }

  /*
   * How many events named any of these values, or were read from this
   * record's logs, over a window: a resource page's Security card. The
   * values are matched as stored, in the spellings given (the caller passes
   * the usual casings - getObservableSearchValues), so the bloom index on
   * the observables narrows the scan; the log record by the attribute "Your
   * logs" events carry, which only they have, so its keys' index skips the
   * rest.
   */
  public async countEventsNaming(data: {
    projectId: ObjectID;
    values: Array<string>;
    // The record's id, matched against the log resource of "Your logs" events.
    logResourceId?: ObjectID | undefined;
    startTime: Date;
    endTime: Date;
  }): Promise<SecurityEventsNamingSummary> {
    const values: Array<string> = Array.from(
      new Set(
        data.values
          .map((value: string): string => {
            return value.trim();
          })
          .filter((value: string): boolean => {
            return value.length > 0;
          }),
      ),
    ).slice(0, OBSERVABLE_ACTIVITY_MAX_VALUES);

    if (values.length === 0 && !data.logResourceId) {
      return {
        eventCount: 0,
        findingCount: 0,
        maxSeverityId: 0,
        lastSeen: null,
      };
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT count() AS eventCount, countIf(classUid IN (2004, 2005)) AS findingCount, max(severityId) AS maxSeverityId, max(time) AS lastSeen FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.startTime,
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: data.endTime,
      }} AND (`,
    );

    if (values.length > 0) {
      statement.append(
        SQL`hasAny(observables, ${{
          type: TableColumnType.ArrayText,
          value: values,
        }})`,
      );
    }

    if (data.logResourceId) {
      if (values.length > 0) {
        statement.append(" OR ");
      }

      statement.append(
        SQL`(has(attributeKeys, ${{
          type: TableColumnType.Text,
          value: SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
        }}) AND attributes[${{
          type: TableColumnType.Text,
          value: SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
        }}] = ${{
          type: TableColumnType.Text,
          value: data.logResourceId.toString(),
        }})`,
      );
    }

    statement.append(")");
    statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();
    const row: JSONObject = (response.data || [])[0] || {};
    const eventCount: number = Number(row["eventCount"] || 0);

    return {
      eventCount,
      findingCount: Number(row["findingCount"] || 0),
      maxSeverityId: eventCount > 0 ? Number(row["maxSeverityId"] || 0) : 0,
      // An empty window's max(time) is the epoch, not a time anything was seen.
      lastSeen: eventCount > 0 ? readDate(row["lastSeen"]) : null,
    };
  }

  /*
   * The records the log lines behind events naming these values were sent
   * under ("Your logs" events say), the most named first: a case's
   * connection to the very host or service whose logs it was found in.
   */
  public async findLogResourcesNaming(data: {
    projectId: ObjectID;
    values: Array<string>;
    startTime: Date;
    endTime: Date;
    limit: number;
  }): Promise<Array<SecurityEventLogResource>> {
    const values: Array<string> = Array.from(
      new Set(
        data.values
          .map((value: string): string => {
            return value.trim();
          })
          .filter((value: string): boolean => {
            return value.length > 0;
          }),
      ),
    ).slice(0, OBSERVABLE_ACTIVITY_MAX_VALUES);

    if (values.length === 0) {
      return [];
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT attributes[${{
      type: TableColumnType.Text,
      value: SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
    }}] AS resourceType, attributes[${{
      type: TableColumnType.Text,
      value: SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
    }}] AS resourceId, count() AS eventCount FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.startTime,
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: data.endTime,
      }} AND hasAny(observables, ${{
        type: TableColumnType.ArrayText,
        value: values,
      }}) AND has(attributeKeys, ${{
        type: TableColumnType.Text,
        value: SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
      }}) GROUP BY resourceType, resourceId ORDER BY eventCount DESC, resourceId ASC LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.min(100, Math.trunc(data.limit))),
      }}`,
    );
    statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || [])
      .map((row: JSONObject): SecurityEventLogResource => {
        return {
          type: String(row["resourceType"] ?? "").trim(),
          id: String(row["resourceId"] ?? "").trim(),
          eventCount: Number(row["eventCount"] || 0),
        };
      })
      .filter((resource: SecurityEventLogResource): boolean => {
        return Boolean(resource.type) && ObjectID.isValidUUID(resource.id);
      });
  }

  /*
   * Whether the project has any security event since this time: a project
   * that does not use Security Events is shown nothing about it on its other
   * pages. One row read at most, from the start of the project's range.
   */
  public async hasEventsSince(data: {
    projectId: ObjectID;
    startTime: Date;
  }): Promise<boolean> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT 1 AS found FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.startTime,
      }} LIMIT 1`,
    );
    statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).length > 0;
  }
}

export default new SecurityEventService();
