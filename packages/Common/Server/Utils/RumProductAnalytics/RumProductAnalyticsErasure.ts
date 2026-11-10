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

function scopedTo(subject: ProductAnalyticsErasureSubject): Statement {
  const statement: Statement = projectClause(subject.projectId);

  if (subject.rumApplicationId) {
    statement.append(applicationClause(subject.rumApplicationId.toString()));
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

function bySessionIds(
  subject: ProductAnalyticsErasureSubject,
): Array<ProductAnalyticsErasureFilter> {
  const sessionIds: Array<string> = Array.from(
    new Set<string>(subject.sessionIds || []),
  ).filter((sessionId: string): boolean => {
    return sessionId.length > 0;
  });

  const filters: Array<ProductAnalyticsErasureFilter> = [];

  for (const ids of chunk(
    sessionIds,
    PRODUCT_ANALYTICS_ERASURE_IDS_PER_MUTATION,
  )) {
    for (const tableName of PRODUCT_ANALYTICS_SESSION_ID_TABLES) {
      const where: Statement = scopedTo(subject);

      where.append(
        SQL` AND sessionId IN ${{
          type: TableColumnType.Text,
          value: new Includes(ids),
        }}`,
      );

      filters.push({ tableName: tableName, where: where });
    }
  }

  return filters;
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
