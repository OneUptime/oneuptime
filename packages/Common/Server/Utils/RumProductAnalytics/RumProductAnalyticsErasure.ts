import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import {
  getStorageTableName,
  onClusterClause,
} from "../AnalyticsDatabase/ClusterConfig";
import { RumSessionErasureRequestType } from "../../../Models/DatabaseModels/RumSessionErasureRequest";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import { PRODUCT_ANALYTICS_IDENTIFIED_PREFIX } from "../../../Types/Rum/ProductAnalytics";

/*
 * What a session replay erasure request removes from product analytics
 * (issue #6444), for Workers/Jobs/Rum/ProcessSessionErasureRequests.
 *
 * The job finds a subject's sessions through RumSessionV1, the recordings'
 * headers - and those go with the recordings' retention, while product
 * analytics keeps a session's summary for a year and a month. So the job
 * erases the sessions it found by id, as it erases everything else, and
 * then what only product analytics still holds, by the subject itself:
 *
 *  - a user: every session that named them, found in the product analytics
 *    session table and removed by id - so the row their first, anonymous
 *    write left goes too (a user who signed in half-way through a session
 *    is on its finished rows only) - and their monthly rows;
 *  - an application: all of its rows, in both tables;
 *  - a date range: the sessions that started in it. The monthly person
 *    rows stay: they hold who came in a month and how often, never what a
 *    session did, and the sessions they count may lie outside the range.
 *  - a list of sessions: those sessions, by id (the job's batches do it).
 *
 * The events table (part two: RumProductAnalyticsEventV1, every session's
 * events, recorded or not) goes the same way: by session id beside the
 * session summaries, a user's sessions found in it too and its rows that
 * name the user by key, an application's rows, and a date range's events
 * by when they happened.
 *
 * Every filter starts with the project, and with the application when the
 * request names one.
 *
 * A request says how many rows it removed (productAnalyticsRowsDeleted,
 * issue #6628). A ClickHouse delete returns no count, so each filter's rows
 * are counted with a SELECT under the same WHERE just before its delete is
 * queued (buildProductAnalyticsCountStatement): a session summary once,
 * however many writes of it are still unmerged, a person's month once, and
 * each event. A delete only lands later, so two deletes of one request must
 * never match the same rows or those rows would count twice. The batches'
 * deletes are therefore cut to what the request's last deletes do not take
 * (buildProductAnalyticsBatchFilters): an application's batches leave
 * product analytics to its application-wide deletes, and a date range's
 * leave the summaries and the events inside the range to its range deletes.
 */

/* Sessions one mutation names, as the job's own deletes do. */
export const PRODUCT_ANALYTICS_ERASURE_IDS_PER_MUTATION: number = 1000;

export interface ProductAnalyticsErasureSubject {
  projectId: ObjectID;
  requestType: RumSessionErasureRequestType;
  /* The application a request is scoped to, when it is. */
  rumApplicationId?: ObjectID | undefined;
  /* The user's key (ByIdentifiedUserKey) or the application's id (ByRumApplication). */
  targetValue?: string | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  /*
   * Sessions to remove by id: the request's own list, or the user's
   * sessions buildProductAnalyticsUserSessionLookup found.
   */
  sessionIds?: Array<string> | undefined;
  /*
   * ByIdentifiedUserKey only. False on a pass whose lookup filled its page,
   * so more of the user's sessions remain for the next pass: the user's
   * monthly rows and the events that name them by key wait for the pass
   * that finds the last of their sessions. Removed earlier, the events by
   * key would take with them the only rows a later pass finds a session
   * by, and leave that session's events from before identify() behind.
   * Left out, the pass is the last.
   */
  isFinalPass?: boolean | undefined;
}

/*
 * What a batch of the job's (the sessions it found, erased by id with their
 * recordings) takes from product analytics, by the request that found it:
 *
 *  - a list of sessions or a user: their summaries and their events, by id;
 *  - an application: nothing - its application-wide deletes, last, take
 *    every row of it, and the batches' would match the same rows again;
 *  - a date range: the events of its sessions that happened outside the
 *    range, by id. The sessions started in the range, so their summaries,
 *    and their events inside it, go with the range deletes.
 */
export interface ProductAnalyticsBatchScope {
  projectId: ObjectID;
  requestType: RumSessionErasureRequestType;
  sessionIds: Array<string>;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
}

/* The product analytics tables that hold rows by session id. */
export const PRODUCT_ANALYTICS_SESSION_ID_TABLES: ReadonlyArray<AnalyticsTableName> =
  [
    AnalyticsTableName.RumProductAnalyticsSession,
    AnalyticsTableName.RumProductAnalyticsEvent,
  ];

export interface ProductAnalyticsErasureFilter {
  /* The model's table name; the delete statement names its storage table. */
  tableName: AnalyticsTableName;
  where: Statement;
}

function projectClause(projectId: ObjectID): Statement {
  return SQL`projectId = ${{
    type: TableColumnType.ObjectID,
    value: projectId,
  }}`;
}

function applicationClause(rumApplicationId: string): Statement {
  return SQL` AND rumApplicationId = ${{
    type: TableColumnType.Text,
    value: rumApplicationId,
  }}`;
}

function scopedTo(scope: {
  projectId: ObjectID;
  rumApplicationId?: ObjectID | undefined;
}): Statement {
  const statement: Statement = projectClause(scope.projectId);

  if (scope.rumApplicationId) {
    statement.append(applicationClause(scope.rumApplicationId.toString()));
  }

  return statement;
}

function chunk(values: Array<string>, size: number): Array<Array<string>> {
  const chunks: Array<Array<string>> = [];

  for (let index: number = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function distinctSessionIds(
  sessionIds: Array<string> | undefined,
): Array<string> {
  return Array.from(new Set<string>(sessionIds || [])).filter(
    (sessionId: string): boolean => {
      return sessionId.length > 0;
    },
  );
}

function bySessionIds(
  subject: ProductAnalyticsErasureSubject,
): Array<ProductAnalyticsErasureFilter> {
  return buildProductAnalyticsSessionIdFilters({
    projectId: subject.projectId,
    rumApplicationId: subject.rumApplicationId,
    sessionIds: subject.sessionIds || [],
  });
}

/*
 * Sessions removed by id, from the summaries and the events (or the tables
 * named), in mutations of at most PRODUCT_ANALYTICS_ERASURE_IDS_PER_MUTATION
 * ids. `extra` is appended to every filter's WHERE.
 */
export function buildProductAnalyticsSessionIdFilters(data: {
  projectId: ObjectID;
  rumApplicationId?: ObjectID | undefined;
  sessionIds: Array<string>;
  tableNames?: ReadonlyArray<AnalyticsTableName> | undefined;
  extra?: (() => Statement) | undefined;
}): Array<ProductAnalyticsErasureFilter> {
  const filters: Array<ProductAnalyticsErasureFilter> = [];

  for (const ids of chunk(
    distinctSessionIds(data.sessionIds),
    PRODUCT_ANALYTICS_ERASURE_IDS_PER_MUTATION,
  )) {
    for (const tableName of data.tableNames ||
      PRODUCT_ANALYTICS_SESSION_ID_TABLES) {
      const where: Statement = scopedTo(data);

      where.append(
        SQL` AND sessionId IN ${{
          type: TableColumnType.Text,
          value: new Includes(ids),
        }}`,
      );

      if (data.extra) {
        where.append(data.extra());
      }

      filters.push({ tableName: tableName, where: where });
    }
  }

  return filters;
}

/*
 * What one batch of the job's takes from product analytics (see
 * ProductAnalyticsBatchScope). Pinned to the project; the ids are the
 * batch's, which only ever name sessions of the request's subject.
 */
export function buildProductAnalyticsBatchFilters(
  scope: ProductAnalyticsBatchScope,
): Array<ProductAnalyticsErasureFilter> {
  switch (scope.requestType) {
    case RumSessionErasureRequestType.ByRumApplication:
      return [];

    case RumSessionErasureRequestType.ByDateRange: {
      if (!scope.startDate || !scope.endDate) {
        throw new Error("ByDateRange erasure request has no start or end date");
      }

      const startDate: Date = scope.startDate;
      const endDate: Date = scope.endDate;

      return buildProductAnalyticsSessionIdFilters({
        projectId: scope.projectId,
        sessionIds: scope.sessionIds,
        tableNames: [AnalyticsTableName.RumProductAnalyticsEvent],
        extra: (): Statement => {
          return SQL` AND (time < ${{
            type: TableColumnType.DateTime64,
            value: startDate,
          }} OR time > ${{
            type: TableColumnType.DateTime64,
            value: endDate,
          }})`;
        },
      });
    }

    default:
      return buildProductAnalyticsSessionIdFilters({
        projectId: scope.projectId,
        sessionIds: scope.sessionIds,
      });
  }
}

/*
 * How one table's rows are counted: a session summary once however many of
 * its writes are still unmerged (the provisional, finished and pinned rows
 * of a session fold into one), a person's month once, and every event.
 */
const COUNTED_ROWS_SQL: Record<string, string> = {
  [AnalyticsTableName.RumProductAnalyticsSession]: "uniqExact(sessionId)",
  [AnalyticsTableName.RumProductAnalyticsUser]: "uniqExact(personKey, month)",
  [AnalyticsTableName.RumProductAnalyticsEvent]: "count()",
};

/*
 * The rows one filter's delete is about to remove, counted under the same
 * WHERE across the cluster (the Distributed table), as paRows. Run just
 * before the delete is queued: a delete only lands later, and a count after
 * it would find the rows still there or gone depending on how far the
 * mutation got.
 */
export function buildProductAnalyticsCountStatement(data: {
  databaseName: string;
  filter: ProductAnalyticsErasureFilter;
}): Statement {
  const counted: string | undefined = COUNTED_ROWS_SQL[data.filter.tableName];

  if (!counted) {
    throw new Error(
      `${data.filter.tableName} is not a product analytics table erasure counts`,
    );
  }

  return SQL`SELECT toFloat64(`
    .append(counted)
    .append(
      SQL`) AS paRows FROM ${data.databaseName}.${data.filter.tableName} WHERE `,
    )
    .append(data.filter.where);
}

/*
 * The deletes a request needs on the product analytics tables, beyond the
 * session-id deletes of the job's batches. Throws on a request that does
 * not say what it erases, as the job's own lookups do.
 */
export function buildProductAnalyticsErasureFilters(
  subject: ProductAnalyticsErasureSubject,
): Array<ProductAnalyticsErasureFilter> {
  switch (subject.requestType) {
    case RumSessionErasureRequestType.BySessionId:
      return bySessionIds(subject);

    case RumSessionErasureRequestType.ByIdentifiedUserKey: {
      const userKey: string = (subject.targetValue || "").trim();

      if (!userKey) {
        throw new Error("ByIdentifiedUserKey erasure request has no user key");
      }

      /*
       * More of the user's sessions remain: only the ones found go now,
       * and the rows by key wait for the last pass (isFinalPass).
       */
      if (subject.isFinalPass === false) {
        return bySessionIds(subject);
      }

      const months: Statement = scopedTo(subject);

      months.append(
        SQL` AND personKey = ${{
          type: TableColumnType.Text,
          value: `${PRODUCT_ANALYTICS_IDENTIFIED_PREFIX}${userKey}`,
        }}`,
      );

      /*
       * The events that named the user, by key: the sessions found by id
       * are capped per run, this is not.
       */
      const events: Statement = scopedTo(subject);

      events.append(
        SQL` AND identifiedUserKey = ${{
          type: TableColumnType.Text,
          value: userKey,
        }}`,
      );

      return [
        ...bySessionIds(subject),
        {
          tableName: AnalyticsTableName.RumProductAnalyticsUser,
          where: months,
        },
        {
          tableName: AnalyticsTableName.RumProductAnalyticsEvent,
          where: events,
        },
      ];
    }

    case RumSessionErasureRequestType.ByRumApplication: {
      const rumApplicationId: string =
        (subject.targetValue || "").trim() ||
        subject.rumApplicationId?.toString() ||
        "";

      if (!rumApplicationId) {
        throw new Error(
          "ByRumApplication erasure request carries no application id",
        );
      }

      return [
        AnalyticsTableName.RumProductAnalyticsSession,
        AnalyticsTableName.RumProductAnalyticsUser,
        AnalyticsTableName.RumProductAnalyticsEvent,
      ].map((tableName: AnalyticsTableName): ProductAnalyticsErasureFilter => {
        const where: Statement = projectClause(subject.projectId);
        where.append(applicationClause(rumApplicationId));

        return { tableName: tableName, where: where };
      });
    }

    case RumSessionErasureRequestType.ByDateRange: {
      if (!subject.startDate || !subject.endDate) {
        throw new Error("ByDateRange erasure request has no start or end date");
      }

      const where: Statement = scopedTo(subject);

      where.append(
        SQL` AND startTime >= ${{
          type: TableColumnType.DateTime64,
          value: subject.startDate,
        }} AND startTime <= ${{
          type: TableColumnType.DateTime64,
          value: subject.endDate,
        }}`,
      );

      const events: Statement = scopedTo(subject);

      events.append(
        SQL` AND time >= ${{
          type: TableColumnType.DateTime64,
          value: subject.startDate,
        }} AND time <= ${{
          type: TableColumnType.DateTime64,
          value: subject.endDate,
        }}`,
      );

      return [
        {
          tableName: AnalyticsTableName.RumProductAnalyticsSession,
          where: where,
        },
        {
          tableName: AnalyticsTableName.RumProductAnalyticsEvent,
          where: events,
        },
      ];
    }

    default:
      throw new Error(
        `Unsupported erasure request type "${String(subject.requestType)}"`,
      );
  }
}

/*
 * Every session product analytics holds that named the user, at most
 * `limit` of them: the job removes them by id, so the first, anonymous row
 * of a session they signed in during goes with the rest. Read from the
 * session summaries (recorded sessions) or, with `tableName`, from the
 * events (every session): the job asks both.
 *
 * An empty key is refused, not looked up: `identifiedUserKey = ''` is every
 * session in which nobody signed in.
 */
export function buildProductAnalyticsUserSessionLookup(data: {
  databaseName: string;
  projectId: ObjectID;
  identifiedUserKey: string;
  rumApplicationId?: ObjectID | undefined;
  limit: number;
  tableName?:
    | AnalyticsTableName.RumProductAnalyticsSession
    | AnalyticsTableName.RumProductAnalyticsEvent
    | undefined;
}): Statement {
  const identifiedUserKey: string = data.identifiedUserKey.trim();

  if (!identifiedUserKey) {
    throw new Error("ByIdentifiedUserKey erasure request has no user key");
  }

  const statement: Statement = SQL`SELECT DISTINCT sessionId AS paSessionId FROM ${data.databaseName}.${data.tableName || AnalyticsTableName.RumProductAnalyticsSession} WHERE `;

  statement.append(projectClause(data.projectId));

  if (data.rumApplicationId) {
    statement.append(applicationClause(data.rumApplicationId.toString()));
  }

  statement.append(
    SQL` AND identifiedUserKey = ${{
      type: TableColumnType.Text,
      value: identifiedUserKey,
    }} LIMIT ${{
      type: TableColumnType.Number,
      value: data.limit,
    }}`,
  );

  return statement;
}

/*
 * The mutation for one filter: on the LOCAL storage table, dispatched to
 * every shard (ON CLUSTER), as the job's other deletes are - a lightweight
 * DELETE can target neither a Distributed table nor a cluster.
 */
export function buildProductAnalyticsDeleteStatement(data: {
  databaseName: string;
  filter: ProductAnalyticsErasureFilter;
}): Statement {
  return SQL`ALTER TABLE ${data.databaseName}.${getStorageTableName(data.filter.tableName)}`
    .append(onClusterClause())
    .append(" DELETE WHERE ")
    .append(data.filter.where);
}
