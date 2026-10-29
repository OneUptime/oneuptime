import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";
import ThreatIntelIndicator from "../../Models/AnalyticsModels/ThreatIntelIndicator";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../Types/BaseDatabase/Includes";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";

/*
 * The current state of one indicator value, resolved version-aware.
 *
 * The table is ReplacingMergeTree keyed (projectId, feedId,
 * indicatorValue, stixId) and merges are asynchronous, so every "current
 * state" read here resolves versions with argMax(column, version) grouped
 * by the FULL identity — never coarser. Two distinct STIX objects can
 * carry the same value (the standard replace-then-revoke workflow), and a
 * coarser group would let the latest-modified object's revocation or
 * expiry mask another object's still-active claim. So: resolve per
 * identity, apply the active predicate per identity, and only then
 * collapse to one row per value, keeping the value alive while ANY of its
 * identities is active.
 *
 * No alias in these statements spells a column that its own SELECT reads
 * (issue #5157). ClickHouse resolves a name to a SELECT alias before a
 * column of the same name - under its current analyzer and the older one
 * alike - so `max(confidence) AS confidence` beside
 * `argMax(stixId, confidence)` turned the second into an aggregate inside
 * an aggregate, and every match, enrichment and poll query failed with
 * ILLEGAL_AGGREGATION. Each level below names what it computes
 * (feedNameLatest, confidenceLatest, identityStixId, ...), and only the
 * level that answers the caller takes the plain names the rows are read by.
 * ThreatIntelIndicatorService.test.ts holds these statements to that rule,
 * and ClickhouseAliasShadowGuard holds every query in the code clear of the
 * failure.
 */
export interface ActiveIndicator {
  indicatorValue: string;
  feedId: string;
  feedName: string;
  stixId: string;
  indicatorType: string;
  indicatorName: string;
  confidence: number;
}

export interface IndicatorMatchGroup {
  indicatorValue: string;
  stixId: string;
  indicatorType: string;
  indicatorName: string;
  confidence: number;
  matchCount: number;
  sampleMessage: string;
  sampleObservables: Array<string>;
}

export interface FindIndicatorMatchesData {
  projectId: ObjectID;
  feedId: ObjectID;
  startTime: Date;
  endTime: Date;
  maxGroups: number;
}

/*
 * The latest stored version of one (stixId, indicatorValue) identity in a
 * feed — what the poller reads before ingesting a page, to retract values
 * an updated pattern dropped and to keep retention monotonic per object.
 */
export interface StoredIndicatorVersion {
  stixId: string;
  indicatorValue: string;
  indicatorType: string;
  indicatorName: string;
  confidence: number;
  version: number;
  validFrom: string;
  validUntil: string;
  retentionDate: string;
}

/*
 * The active-indicator predicate, applied over the argMax-resolved latest
 * version of one full identity: not revoked, and `now` inside the
 * validity window. TTL (retentionDate) is garbage collection only and
 * never part of this predicate.
 */
function appendActiveHavingClause(statement: Statement, now: Date): void {
  statement.append(
    SQL` HAVING revokedLatest = false AND validFromLatest <= ${{
      type: TableColumnType.DateTime64,
      value: now,
    }} AND validUntilLatest > ${{
      type: TableColumnType.DateTime64,
      value: now,
    }}`,
  );
}

export class ThreatIntelIndicatorService extends AnalyticsDatabaseService<ThreatIntelIndicator> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: ThreatIntelIndicator, database: clickhouseDatabase });
  }

  /*
   * Cheap existence probe for the ingest-time enricher's short-circuit:
   * does this project have ANY indicator rows at all? Deliberately not
   * version- or validity-aware — a false positive costs one lookup query,
   * a scan for exactness would cost more than it saves.
   */
  public async hasIndicatorsForProject(projectId: ObjectID): Promise<boolean> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT 1 FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: projectId,
      }} LIMIT 1`,
    );
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 10 }));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).length > 0;
  }

  /*
   * The shared inner resolution: latest version per FULL identity
   * (feedId, indicatorValue, stixId), active predicate applied per
   * identity. Callers wrap this in a collapse to one row per value, which
   * reads identityStixId and the *Latest columns - none of them a column
   * of the table, so no alias here or there shadows one.
   */
  private appendPerIdentityActiveSubquery(
    statement: Statement,
    options: {
      databaseName: string;
      whereClause: Statement;
      groupByFeedId: boolean;
      now: Date;
    },
  ): void {
    statement.append(
      `SELECT
        indicatorValue,${options.groupByFeedId ? "\n        feedId," : ""}
        stixId AS identityStixId,
        argMax(feedName, version) AS feedNameLatest,
        argMax(indicatorType, version) AS indicatorTypeLatest,
        argMax(indicatorName, version) AS indicatorNameLatest,
        argMax(confidence, version) AS confidenceLatest,
        argMax(revoked, version) AS revokedLatest,
        argMax(validFrom, version) AS validFromLatest,
        argMax(validUntil, version) AS validUntilLatest
      FROM ${options.databaseName}.${this.model.tableName}`,
    );

    statement.append(options.whereClause);

    statement.append(
      ` GROUP BY ${
        options.groupByFeedId ? "feedId, " : ""
      }indicatorValue, stixId`,
    );

    appendActiveHavingClause(statement, options.now);
  }

  /*
   * Resolve which of `values` are active indicators right now, across all
   * of the project's feeds. Values must already be canonical (lowercased,
   * trimmed) — the poller stores them that way. Returns one row per
   * (feed, value); when several of a value's identities are active inside
   * one feed, the highest-confidence one represents it. The caller picks
   * a winner when one value is carried by several feeds.
   */
  public async findActiveIndicatorsByValues(data: {
    projectId: ObjectID;
    values: Array<string>;
    now: Date;
  }): Promise<Array<ActiveIndicator>> {
    if (data.values.length === 0) {
      return [];
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT
      indicatorValue,
      feedId,
      argMax(feedNameLatest, confidenceLatest) AS feedName,
      argMax(identityStixId, confidenceLatest) AS stixId,
      argMax(indicatorTypeLatest, confidenceLatest) AS indicatorType,
      argMax(indicatorNameLatest, confidenceLatest) AS indicatorName,
      max(confidenceLatest) AS confidence
    FROM (`;

    this.appendPerIdentityActiveSubquery(statement, {
      databaseName,
      whereClause: SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND indicatorValue IN ${{
        type: TableColumnType.Text,
        value: new Includes(data.values),
      }}`,
      groupByFeedId: true,
      now: data.now,
    });

    statement.append(`) GROUP BY feedId, indicatorValue`);
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 30 }));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map((row: JSONObject): ActiveIndicator => {
      return {
        indicatorValue: String(row["indicatorValue"] ?? ""),
        feedId: String(row["feedId"] ?? ""),
        feedName: String(row["feedName"] ?? ""),
        stixId: String(row["stixId"] ?? ""),
        indicatorType: String(row["indicatorType"] ?? ""),
        indicatorName: String(row["indicatorName"] ?? ""),
        confidence: Number(row["confidence"] || 0),
      };
    });
  }

  /*
   * The matcher's join: security events in [startTime, endTime) whose
   * observables carry one of this feed's active indicator values, grouped
   * per indicator value.
   *
   * Mechanics worth naming:
   *  - lowerUTF8 on the event side because observables preserve source
   *    casing (buildObservables dedupes case-insensitively but stores the
   *    original spelling) while indicator values are stored lowercased.
   *  - GLOBAL INNER JOIN: events and indicators shard differently, so a
   *    local per-shard join would silently miss cross-shard matches on a
   *    cluster. The broadcast side is one feed's active indicators.
   *  - the join side resolves per full identity and then collapses to ONE
   *    row per value (highest confidence represents it), so matchCount is
   *    events, never events x identities.
   *  - classUid != 2004 keeps findings (Sigma's and our own) out of the
   *    match input — threat intel matches raw telemetry, not derived
   *    findings, and this is also what makes the write-back loop-free.
   */
  public async findIndicatorMatches(
    data: FindIndicatorMatchesData,
  ): Promise<Array<IndicatorMatchGroup>> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const now: Date = data.endTime;

    const statement: Statement = SQL`SELECT
      i.indicatorValue AS indicatorValue,
      any(i.stixId) AS stixId,
      any(i.indicatorType) AS indicatorType,
      any(i.indicatorName) AS indicatorName,
      any(i.confidence) AS confidence,
      count() AS matchCount,
      any(e.message) AS sampleMessage,
      arrayDistinct(arrayFlatten(groupArray(20)(e.observables))) AS sampleObservables
    FROM `;

    statement.append(
      `${databaseName}.${AnalyticsTableName.SecurityEvent} AS e ARRAY JOIN e.observables AS matchedObservable GLOBAL INNER JOIN (SELECT
        indicatorValue,
        argMax(identityStixId, confidenceLatest) AS stixId,
        argMax(indicatorTypeLatest, confidenceLatest) AS indicatorType,
        argMax(indicatorNameLatest, confidenceLatest) AS indicatorName,
        max(confidenceLatest) AS confidence
      FROM (`,
    );

    this.appendPerIdentityActiveSubquery(statement, {
      databaseName,
      whereClause: SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND feedId = ${{
        type: TableColumnType.ObjectID,
        value: data.feedId,
      }}`,
      groupByFeedId: false,
      now,
    });

    statement.append(`) GROUP BY indicatorValue`);

    statement.append(
      SQL`) AS i ON lowerUTF8(matchedObservable) = i.indicatorValue WHERE e.projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND e.time >= ${{
        type: TableColumnType.DateTime64,
        value: data.startTime,
      }} AND e.time < ${{
        type: TableColumnType.DateTime64,
        value: data.endTime,
      }} AND e.classUid != ${{
        type: TableColumnType.Number,
        value: 2004,
      }} GROUP BY i.indicatorValue ORDER BY matchCount DESC LIMIT ${{
        type: TableColumnType.Number,
        value: data.maxGroups,
      }}`,
    );

    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 60 }));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map((row: JSONObject): IndicatorMatchGroup => {
      return {
        indicatorValue: String(row["indicatorValue"] ?? ""),
        stixId: String(row["stixId"] ?? ""),
        indicatorType: String(row["indicatorType"] ?? ""),
        indicatorName: String(row["indicatorName"] ?? ""),
        confidence: Number(row["confidence"] || 0),
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

  /*
   * A feed's active indicators of the given types, as a subquery of their
   * values (lowercased): what a watchlist that follows the feed matches an
   * event's field against (SecurityWatchlistMatch). Resolved per identity
   * like every read here, so a revoked or expired indicator, or one an
   * update retracted, is not on the list. Read where it is used, at each
   * run of a rule, so the list is the feed's as it stands then: nothing is
   * copied, and the feed's own poll keeps it up to date.
   */
  public buildActiveValuesSubquery(data: {
    projectId: ObjectID;
    feedId: ObjectID;
    indicatorTypes: Array<string>;
    now: Date;
  }): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT lowerUTF8(indicatorValue) FROM (`;

    this.appendPerIdentityActiveSubquery(statement, {
      databaseName,
      whereClause: SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND feedId = ${{
        type: TableColumnType.ObjectID,
        value: data.feedId,
      }}`,
      groupByFeedId: false,
      now: data.now,
    });

    statement.append(
      SQL`) WHERE indicatorTypeLatest IN ${{
        type: TableColumnType.Text,
        value: new Includes(data.indicatorTypes),
      }}`,
    );

    return statement;
  }

  /*
   * The values of one feed's identity (a list feed's single stixId) that
   * are active right now, resolved version-aware like every read here. The
   * list poller reads them before it writes a new copy of the list, to let
   * go of the values the list no longer has.
   */
  public async findActiveValuesForFeed(data: {
    projectId: ObjectID;
    feedId: ObjectID;
    stixId: string;
    now: Date;
    limit: number;
  }): Promise<Array<{ indicatorValue: string; indicatorType: string }>> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT
      indicatorValue,
      argMax(indicatorType, version) AS indicatorTypeLatest,
      argMax(revoked, version) AS revokedLatest,
      argMax(validFrom, version) AS validFromLatest,
      argMax(validUntil, version) AS validUntilLatest
    FROM `;

    statement.append(`${databaseName}.${this.model.tableName}`);

    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND feedId = ${{
        type: TableColumnType.ObjectID,
        value: data.feedId,
      }} AND stixId = ${{
        type: TableColumnType.Text,
        value: data.stixId,
      }} GROUP BY indicatorValue`,
    );

    appendActiveHavingClause(statement, data.now);

    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: data.limit,
      }}`,
    );

    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 30 }));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map(
      (row: JSONObject): { indicatorValue: string; indicatorType: string } => {
        return {
          indicatorValue: String(row["indicatorValue"] ?? ""),
          indicatorType: String(row["indicatorTypeLatest"] ?? ""),
        };
      },
    );
  }

  /*
   * The poller's pre-ingest read: the latest stored version of every
   * (stixId, indicatorValue) identity for the given STIX objects in one
   * feed — revoked or not, active or not. The poller uses it to
   *  - write tombstones for values an updated pattern no longer contains
   *    (their identity would otherwise never be superseded), and
   *  - keep each object's retentionDate monotonic, so a superseding
   *    version can never be TTL-dropped out of an earlier partition than
   *    a version it masks.
   */
  public async findLatestVersionsByStixIds(data: {
    projectId: ObjectID;
    feedId: ObjectID;
    stixIds: Array<string>;
  }): Promise<Array<StoredIndicatorVersion>> {
    if (data.stixIds.length === 0) {
      return [];
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    /*
     * Every aggregate reads version, so none of them may be named after
     * it, or after any other column one of them reads: max(version) AS
     * version made every argMax here an aggregate of an aggregate (#5157).
     */
    const statement: Statement = SQL`SELECT
      stixId,
      indicatorValue,
      argMax(indicatorType, version) AS indicatorTypeLatest,
      argMax(indicatorName, version) AS indicatorNameLatest,
      argMax(confidence, version) AS confidenceLatest,
      max(version) AS versionLatest,
      argMax(validFrom, version) AS validFromLatest,
      argMax(validUntil, version) AS validUntilLatest,
      max(retentionDate) AS retentionDateHighest
    FROM `;

    statement.append(`${databaseName}.${this.model.tableName}`);

    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND feedId = ${{
        type: TableColumnType.ObjectID,
        value: data.feedId,
      }} AND stixId IN ${{
        type: TableColumnType.Text,
        value: new Includes(data.stixIds),
      }} GROUP BY stixId, indicatorValue`,
    );

    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 30 }));

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []).map(
      (row: JSONObject): StoredIndicatorVersion => {
        return {
          stixId: String(row["stixId"] ?? ""),
          indicatorValue: String(row["indicatorValue"] ?? ""),
          indicatorType: String(row["indicatorTypeLatest"] ?? ""),
          indicatorName: String(row["indicatorNameLatest"] ?? ""),
          confidence: Number(row["confidenceLatest"] || 0),
          version: Number(row["versionLatest"] || 0),
          validFrom: String(row["validFromLatest"] ?? ""),
          validUntil: String(row["validUntilLatest"] ?? ""),
          retentionDate: String(row["retentionDateHighest"] ?? ""),
        };
      },
    );
  }
}

export default new ThreatIntelIndicatorService();
