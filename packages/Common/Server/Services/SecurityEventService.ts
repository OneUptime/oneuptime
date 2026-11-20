import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";
import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import TelemetryRowRetention from "../Utils/Telemetry/TelemetryRowRetention";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import {
  TimeoutOverflowMode,
  getQuerySettings,
} from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import {
  SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
  SECURITY_LOG_FUNCTION_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
  SecurityLogOwner,
} from "../../Types/SecurityCase/SecurityConnection";
import { SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_VALUES } from "../../Types/SecurityEvent/SecurityEventScope";
import { DETECTION_LATE_EVENT_WINDOW_IN_MINUTES } from "../../Types/SecurityEvent/DetectionFindingConstants";
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
import { CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE } from "../../Utils/SecurityEvent/ScrubbedAddress";
import { assertDetectionReadFits } from "../Utils/SecurityEvent/Watchlists/SecurityWatchlistMatch";
import SecurityWatchlistQueryBinder from "../Utils/SecurityEvent/Watchlists/SecurityWatchlistQueryBinder";
import AggregateBy from "../Types/AnalyticsDatabase/AggregateBy";
import CountBy from "../Types/AnalyticsDatabase/CountBy";
import ExistsBy from "../Types/AnalyticsDatabase/ExistsBy";
import FindBy from "../Types/AnalyticsDatabase/FindBy";
import { OnCreate, OnFind } from "../Types/AnalyticsDatabase/Hooks";
import Query from "../Types/AnalyticsDatabase/Query";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CreateBy from "../Types/AnalyticsDatabase/CreateBy";
import Dictionary from "../../Types/Dictionary";
import { AttributeType } from "../Utils/Telemetry/Telemetry";
import { copyOwnValues } from "../../Utils/LookupTable";
import {
  foldResourceIdObservables,
  readSecurityEventLogOwners,
  readSecurityLogOwners,
} from "../../Utils/SecurityCase/SecurityConnectionMatch";
import { foldCloudResourceAttribute } from "../Utils/SecurityEvent/SecurityEventRow";

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
  /*
   * When the earliest of the group's matches happened. A scheduled run of a
   * rule that fires on each match judges what arrived since the last run,
   * whenever it happened, and says it covers events from here.
   */
  firstSeenAt?: Date | undefined;
}

/*
 * WHAT A RUN OF A RULE JUDGES, BY WHEN IT ARRIVED.
 *
 * A rule that counts (Types/SecurityEvent/RealTimeDetection) reads a window
 * of its interval as it stood when the events it judges came in, and keeps
 * a group only when those events are what brought it to the threshold: one
 * of them is among the group's matches, and with only what came in before
 * them the group had not reached it. A burst fires once, on the events that
 * make the count; a late event that makes it fires too; and a group past it
 * stays quiet until the next window. Two kinds of run judge events so:
 *
 *  - A real-time run judges the events one write handed it, by id: ids are
 *    time-ordered (UUIDv7, made as each row is built), so a later id came
 *    in later, and the window as it stood is the events with an id no later
 *    than the write's last.
 *  - A scheduled run judges every event that arrived since the rule's last
 *    run (#10337): createdAt, stamped as each row is built, after the
 *    rule's last run and no later than this one. An event that happened
 *    long before it reached OneUptime - a batch a shipper held, a span that
 *    ended a minute after it started, a flow read in whole windows - is
 *    judged by the first run after it arrived, once, with the events of the
 *    window it happened in.
 */
export interface DetectionWriteArrival {
  kind?: "write" | undefined;
  // The write's events, by id.
  candidateIds: Array<string>;
  // The lowest and the highest of them.
  firstId: string;
  lastId: string;
  // When they happened, at most: the groups they name are read there.
  candidateStartTime: Date;
  candidateEndTime: Date;
}

export interface DetectionRunArrival {
  kind: "run";
  // What the rule's last run judged: everything that arrived by then. Exclusive.
  arrivedAfter: Date;
  // What this run judges up to. Inclusive.
  arrivedUntil: Date;
  // When the events it judges happened, at most: the groups they name are read there.
  candidateStartTime: Date;
  candidateEndTime: Date;
}

/*
 * How long before it arrived an event a scheduled run judges may have
 * happened (DETECTION_LATE_EVENT_WINDOW_IN_MINUTES), held to each event:
 * one that reached OneUptime later than that is stored and searchable, and
 * Run on Past Events reads it, but no run judges it.
 */
const DETECTION_RUN_LATE_EVENT_SECONDS: number =
  DETECTION_LATE_EVENT_WINDOW_IN_MINUTES * 60;

export type DetectionArrivalRead = DetectionWriteArrival | DetectionRunArrival;

// The window as it stood when the events judged came in.
export function detectionArrivedBy(arrival: DetectionArrivalRead): Statement {
  if (arrival.kind === "run") {
    return SQL`createdAt <= ${{
      type: TableColumnType.Date,
      value: arrival.arrivedUntil,
    }}`;
  }

  return SQL`_id <= ${{
    type: TableColumnType.Text,
    value: arrival.lastId,
  }}`;
}

// What had come in before them: judged already.
export function detectionArrivedBefore(
  arrival: DetectionArrivalRead,
): Statement {
  if (arrival.kind === "run") {
    return SQL`createdAt <= ${{
      type: TableColumnType.Date,
      value: arrival.arrivedAfter,
    }}`;
  }

  return SQL`_id < ${{
    type: TableColumnType.Text,
    value: arrival.firstId,
  }}`;
}

// One of the events judged: for a run, one that arrived in it, within a day of when it happened.
export function isDetectionArrivalCandidate(
  arrival: DetectionArrivalRead,
): Statement {
  if (arrival.kind === "run") {
    return SQL`(createdAt > ${{
      type: TableColumnType.Date,
      value: arrival.arrivedAfter,
    }} AND createdAt <= ${{
      type: TableColumnType.Date,
      value: arrival.arrivedUntil,
    }} AND time >= createdAt - toIntervalSecond(${{
      type: TableColumnType.Number,
      value: DETECTION_RUN_LATE_EVENT_SECONDS,
    }}))`;
  }

  return SQL`has(${{
    type: TableColumnType.ArrayText,
    value: arrival.candidateIds,
  }}, _id)`;
}

export interface FindDetectionMatchesData {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  whereFragment: Statement;
  groupByExpression: Statement | null;
  /*
   * Whether an event has a value for the field the rule groups by
   * (buildSigmaFieldHasValue): a rule that counts per value leaves out the
   * events that have none, so they never add up as one value (#10415).
   */
  groupHasValueExpression?: Statement | null | undefined;
  distinctCountExpression: Statement | null;
  minMatchCount: number;
  maxGroups: number;
  // A window of a rule that counts, as the events it judges found it.
  arrival?: DetectionArrivalRead | undefined;
  // Read when each group's earliest match happened (DetectionMatchGroup.firstSeenAt).
  readFirstSeen?: boolean | undefined;
}

/*
 * The windows of a rule's interval that hold an event a scheduled run
 * judges (DetectionRunArrival), and when the first of the window's arrived:
 * the windows a run of a rule that counts reads.
 */
export interface DetectionArrivalWindow {
  // Where the window starts, on the clock (getRealTimeCountWindow).
  windowStart: Date;
  // When the earliest of its events the run judges arrived.
  firstArrivedAt: Date;
}

export interface FindDetectionArrivalWindowsData {
  projectId: ObjectID;
  // Exclusive.
  arrivedAfter: Date;
  // Inclusive.
  arrivedUntil: Date;
  /*
   * When the events may have happened. The table is sorted by the time
   * events happened, so this is what keeps the read to the recent parts of
   * it; createdAt's own index skips the rest of those.
   */
  happenedAfter: Date;
  happenedBefore: Date;
  // The rule's condition, with its exceptions.
  whereFragment: Statement;
  windowInMinutes: number;
  limit: number;
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
   * READS THAT MATCH A WATCHLIST. A search, a Security Events monitor or a
   * hunt names a list on a field (OnWatchlist, NotOnWatchlist); every read
   * of the table reads the lists its query names first - as the caller, in
   * the caller's project - and puts them in place
   * (SecurityWatchlistQueryBinder), so the list, its count, its chart and
   * its facets all match the same values. A query that names none is read
   * as it always was.
   */
  private async bindWatchlists(
    query: Query<SecurityEvent>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<SecurityEvent>> {
    return await SecurityWatchlistQueryBinder.bind<Query<SecurityEvent>>({
      query,
      props,
    });
  }

  // A list or one event: findBy and findOneBy both pass here.
  protected override async onBeforeFind(
    findBy: FindBy<SecurityEvent>,
  ): Promise<OnFind<SecurityEvent>> {
    const onFind: OnFind<SecurityEvent> = await super.onBeforeFind(findBy);

    return {
      ...onFind,
      findBy: {
        ...onFind.findBy,
        query: await this.bindWatchlists(
          onFind.findBy.query,
          onFind.findBy.props,
        ),
      },
    };
  }

  protected override async onBeforeCount(
    countBy: CountBy<SecurityEvent>,
  ): Promise<CountBy<SecurityEvent>> {
    const prepared: CountBy<SecurityEvent> = await super.onBeforeCount(countBy);

    return {
      ...prepared,
      query: await this.bindWatchlists(prepared.query, prepared.props),
    };
  }

  // A chart, or a facet's counts.
  public override async aggregateBy(
    aggregateBy: AggregateBy<SecurityEvent>,
  ): Promise<AggregatedResult> {
    return await super.aggregateBy({
      ...aggregateBy,
      query: await this.bindWatchlists(aggregateBy.query, aggregateBy.props),
    });
  }

  // A monitor's rule preview: its query's count in each window.
  public override async countPerWindow(data: {
    query: Query<SecurityEvent>;
    timeColumnName: string;
    windowInSeconds: number;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<{ time: Date; count: number }>> {
    return await super.countPerWindow({
      ...data,
      query: await this.bindWatchlists(data.query, data.props),
    });
  }

  public override async existsBy(
    existsBy: ExistsBy<SecurityEvent>,
  ): Promise<boolean> {
    return await super.existsBy({
      ...existsBy,
      query: await this.bindWatchlists(existsBy.query, existsBy.props),
    });
  }

  /*
   * An event created through the API keeps a cloud resource's ID as every
   * writer's row does (SecurityEventRow, #10034): an Azure resource ID by
   * its key, in lower case, among its observables and as the cloud resource
   * its log line was of - the spelling a resource's page searches for. Only
   * the event's own values change; nothing is written.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<SecurityEvent>,
  ): Promise<OnCreate<SecurityEvent>> {
    const onCreate: OnCreate<SecurityEvent> = await super.onBeforeCreate(
      createBy,
    );
    const event: SecurityEvent = onCreate.createBy.data;

    if (Array.isArray(event.observables)) {
      event.observables = foldResourceIdObservables(event.observables);
    }

    if (
      event.attributes &&
      typeof event.attributes === "object" &&
      !Array.isArray(event.attributes)
    ) {
      const attributes: Dictionary<AttributeType | Array<AttributeType>> =
        copyOwnValues<AttributeType | Array<AttributeType>>(
          event.attributes as Dictionary<AttributeType | Array<AttributeType>>,
        );

      foldCloudResourceAttribute(attributes);
      event.attributes = attributes as JSONObject;
    }

    return onCreate;
  }

  // Its resource's retention for security events, as on ingest.
  protected override async getRetentionDateOnCreate(
    securityEvent: SecurityEvent,
  ): Promise<Date | null> {
    return await TelemetryRowRetention.getRetentionDate({
      row: securityEvent,
      pillar: "securityEvents",
    });
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
   *
   * A rule that counts per value - a group field, and a threshold above
   * one or a distinct count - leaves out the events with no value for its
   * group field (groupHasValueExpression, #10415), in the read and in the
   * groups an arrival names: every failed sign-in with no address is no
   * "one IP address". One that fires on each event keeps them, in a group
   * of their own, as before.
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

    statement.append(" AS distinctCount");

    const arrival: DetectionArrivalRead | undefined = data.arrival;

    if (arrival) {
      // What had come in before the events judged, and their own matches.
      statement.append(", countIf(");
      statement.append(detectionArrivedBefore(arrival));
      statement.append(") AS matchCountBefore, ");

      if (data.distinctCountExpression) {
        statement.append("uniqExactIf(nullIf(");
        statement.append(data.distinctCountExpression);
        statement.append(", ''), ");
        statement.append(detectionArrivedBefore(arrival));
        statement.append(")");
      } else {
        statement.append("0");
      }

      statement.append(" AS distinctCountBefore, countIf(");
      statement.append(isDetectionArrivalCandidate(arrival));
      statement.append(") AS candidateMatches");
    }

    if (data.readFirstSeen) {
      statement.append(", min(time) AS firstSeenAt");
    }

    statement.append(
      `, any(message) AS sampleMessage, arrayDistinct(arrayFlatten(groupArray(20)(observables))) AS sampleObservables FROM ${databaseName}.${this.model.tableName} WHERE `,
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
    statement.append(")");

    const minMatchCount: number = Math.max(1, data.minMatchCount);
    const leavesOutNoValue: boolean = Boolean(
      data.groupByExpression &&
        data.groupHasValueExpression &&
        (data.distinctCountExpression || minMatchCount > 1),
    );

    // Events with no value for the group field are no value to count.
    if (leavesOutNoValue) {
      statement.append(" AND (");
      statement.append(data.groupHasValueExpression!);
      statement.append(")");
    }

    if (arrival) {
      // The window as it stood when the events judged came in.
      statement.append(" AND ");
      statement.append(detectionArrivedBy(arrival));

      // Only the groups the events judged name: read where they happened.
      if (data.groupByExpression) {
        statement.append(" AND ");
        statement.append(data.groupByExpression);
        statement.append(" IN (SELECT ");
        statement.append(data.groupByExpression);
        statement.append(
          ` FROM ${databaseName}.${this.model.tableName} WHERE `,
        );
        statement.append(
          SQL`projectId = ${{
            type: TableColumnType.ObjectID,
            value: data.projectId,
          }} AND time >= ${{
            type: TableColumnType.DateTime64,
            value: arrival.candidateStartTime,
          }} AND time < ${{
            type: TableColumnType.DateTime64,
            value: arrival.candidateEndTime,
          }} AND `,
        );
        statement.append(isDetectionArrivalCandidate(arrival));

        // Nor are the groups of events that have none of the field.
        if (leavesOutNoValue) {
          statement.append(" AND (");
          statement.append(data.groupHasValueExpression!);
          statement.append(")");
        }

        statement.append(")");
      }
    }

    statement.append(" GROUP BY groupValue");

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

    if (arrival) {
      /*
       * A group the events judged brought to the threshold: one of them
       * matched, and what came in before them had not reached the count.
       */
      statement.append(
        ` HAVING candidateMatches > 0 AND ${effectiveCountColumn} >= `,
      );
      statement.append(
        SQL`${{
          type: TableColumnType.Number,
          value: minMatchCount,
        }}`,
      );
      statement.append(` AND ${effectiveCountColumn}Before < `);
      statement.append(
        SQL`${{
          type: TableColumnType.Number,
          value: minMatchCount,
        }}`,
      );
    } else if (data.distinctCountExpression || minMatchCount > 1) {
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

    // A rule's watchlists travel with the read: refused here when one request cannot carry them.
    assertDetectionReadFits(statement);

    const result: Results = await this.executeQuery(statement);

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map((row: JSONObject): DetectionMatchGroup => {
      const firstSeenAt: Date | null = data.readFirstSeen
        ? readDate(row["firstSeenAt"])
        : null;

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
        ...(firstSeenAt ? { firstSeenAt } : {}),
      };
    });
  }

  /*
   * The windows of a rule's interval that hold an event a scheduled run
   * judges - one that arrived in the run and meets the rule's condition -
   * with when the first of each window's arrived, earliest first: what a
   * run of a rule that counts reads (DetectionRuleEvaluator). Windows are
   * cut on the clock from the Unix epoch, as getRealTimeCountWindow cuts
   * them, so the window a scheduled run reads is the one a real-time run
   * would.
   */
  public async findDetectionArrivalWindows(
    data: FindDetectionArrivalWindowsData,
  ): Promise<Array<DetectionArrivalWindow>> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;
    const windowInSeconds: number =
      Math.max(1, Math.floor(data.windowInMinutes)) * 60;

    const statement: Statement = SQL`SELECT intDiv(toUnixTimestamp(time), ${{
      type: TableColumnType.Number,
      value: windowInSeconds,
    }}) AS windowIndex, min(createdAt) AS firstArrivedAt FROM `;
    statement.append(`${databaseName}.${this.model.tableName} WHERE `);
    statement.append(
      SQL`projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.happenedAfter,
      }} AND time < ${{
        type: TableColumnType.DateTime64,
        value: data.happenedBefore,
      }} AND `,
    );
    statement.append(
      isDetectionArrivalCandidate({
        kind: "run",
        arrivedAfter: data.arrivedAfter,
        arrivedUntil: data.arrivedUntil,
        candidateStartTime: data.happenedAfter,
        candidateEndTime: data.happenedBefore,
      }),
    );
    statement.append(" AND (");
    statement.append(data.whereFragment);
    statement.append(
      SQL`) GROUP BY windowIndex ORDER BY firstArrivedAt ASC, windowIndex ASC LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.trunc(data.limit)),
      }}`,
    );
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 60 }));

    // A rule's watchlists travel with the read: refused here when one request cannot carry them.
    assertDetectionReadFits(statement);

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const windows: Array<DetectionArrivalWindow> = [];
    const rows: Array<JSONObject> = (response.data || []) as Array<JSONObject>;

    for (const row of rows) {
      const windowIndex: number = Number(row["windowIndex"]);
      const firstArrivedAt: Date | null = readDate(row["firstArrivedAt"]);

      if (!Number.isFinite(windowIndex) || !firstArrivedAt) {
        continue;
      }

      windows.push({
        windowStart: new Date(windowIndex * windowInSeconds * 1000),
        firstArrivedAt,
      });
    }

    return windows;
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
   * The row of requests with no address counts those whose address a scrub
   * rule hid (#10397), so it can say why it names none.
   */
  public async findAttackCampaigns(data: {
    projectId: ObjectID;
    startTime: Date;
    endTime: Date;
    limit: number;
    // The sources the reader may read; none: every one (findObservableActivity).
    serviceFilter?: TelemetryServiceFilter | undefined;
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
    }}]) AS userAgents, uniq(targetResource) AS targetCount, groupUniqArray(3)(substring(targetResource, 1, 300)) AS sampleTargets, min(time) AS firstSeen, max(time) AS lastSeen, countIf(principalIp = '' AND attributes[${{
      type: TableColumnType.Text,
      value: SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden,
    }}] = ${{
      type: TableColumnType.Text,
      value: CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE,
    }}) AS hiddenAddressCount FROM `;
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
      }}`,
    );
    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );
    statement.append(
      SQL` GROUP BY sourceIp ORDER BY worstOutcomeRank DESC, requestCount DESC, sourceIp ASC LIMIT ${{
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
   * rest. A network device's own logs are told by the attribute ingest
   * writes on every line it matched to it (`networkDevice.id`, carried onto
   * each event read from one), the same way.
   */
  public async countEventsNaming(data: {
    projectId: ObjectID;
    values: Array<string>;
    // The record's id, matched against the log resource of "Your logs" events.
    logResourceId?: ObjectID | undefined;
    /*
     * The attribute the events read from the record's own logs carry, and
     * the values it takes for the record: a network device's
     * `networkDevice.id`, a cloud resource's ID in the spellings events
     * keep it in (#10034).
     */
    attribute?: { key: string; values: Array<string> } | undefined;
    startTime: Date;
    endTime: Date;
    // The sources the reader may read; none: every one (findObservableActivity).
    serviceFilter?: TelemetryServiceFilter | undefined;
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

    const attributeValues: Array<string> = Array.from(
      new Set(
        (data.attribute?.values || []).filter((value: string): boolean => {
          return typeof value === "string" && value.length > 0;
        }),
      ),
    ).slice(0, SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_VALUES);
    const attribute: { key: string; values: Array<string> } | null =
      data.attribute && data.attribute.key && attributeValues.length > 0
        ? { key: data.attribute.key, values: attributeValues }
        : null;

    if (values.length === 0 && !data.logResourceId && !attribute) {
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

    if (attribute) {
      if (values.length > 0 || data.logResourceId) {
        statement.append(" OR ");
      }

      statement.append(
        attribute.values.length === 1
          ? SQL`(has(attributeKeys, ${{
              type: TableColumnType.Text,
              value: attribute.key,
            }}) AND attributes[${{
              type: TableColumnType.Text,
              value: attribute.key,
            }}] = ${{
              type: TableColumnType.Text,
              value: attribute.values[0]!,
            }})`
          : SQL`(has(attributeKeys, ${{
              type: TableColumnType.Text,
              value: attribute.key,
            }}) AND has(${{
              type: TableColumnType.ArrayText,
              value: attribute.values,
            }}, attributes[${{
              type: TableColumnType.Text,
              value: attribute.key,
            }}]))`,
      );
    }

    statement.append(")");
    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );
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
    // The sources the reader may read; none: every one (findObservableActivity).
    serviceFilter?: TelemetryServiceFilter | undefined;
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
      }})`,
    );
    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );
    statement.append(
      SQL` GROUP BY resourceType, resourceId ORDER BY eventCount DESC, resourceId ASC LIMIT ${{
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
   * The cloud resources and serverless functions whose own log lines or
   * spans the events naming these values were read from (#10033), the most
   * named first: the ID a cloud account's stream stamped on the line, the
   * faas.name it carried (Types/SecurityCase/SecurityConnection
   * SecurityLogOwner). A case's connection to the very database or function
   * whose logs it was found in, whatever service they were filed under. The
   * observables' bloom index narrows the read, and the attribute keys' the
   * events that carry either.
   */
  public async findLogOwnersNaming(data: {
    projectId: ObjectID;
    values: Array<string>;
    startTime: Date;
    endTime: Date;
    limit: number;
    // The sources the reader may read; none: every one (findObservableActivity).
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Promise<Array<SecurityLogOwner>> {
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
      value: SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
    }}] AS cloudResourceId, attributes[${{
      type: TableColumnType.Text,
      value: SECURITY_LOG_FUNCTION_ATTRIBUTE,
    }}] AS functionName, count() AS eventCount FROM `;
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
      }}) AND (has(attributeKeys, ${{
        type: TableColumnType.Text,
        value: SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
      }}) OR has(attributeKeys, ${{
        type: TableColumnType.Text,
        value: SECURITY_LOG_FUNCTION_ATTRIBUTE,
      }}))`,
    );
    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );
    statement.append(
      SQL` GROUP BY cloudResourceId, functionName ORDER BY eventCount DESC, cloudResourceId ASC, functionName ASC LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.min(100, Math.trunc(data.limit))),
      }}`,
    );
    statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();
    const owners: Array<SecurityLogOwner> = [];
    const rows: Array<JSONObject> = (response.data || []) as Array<JSONObject>;

    for (const row of rows) {
      owners.push(
        ...readSecurityEventLogOwners({
          [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: String(
            row["cloudResourceId"] ?? "",
          ),
          [SECURITY_LOG_FUNCTION_ATTRIBUTE]: String(row["functionName"] ?? ""),
        }),
      );
    }

    // Each once, the most named first.
    return readSecurityLogOwners(owners);
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
