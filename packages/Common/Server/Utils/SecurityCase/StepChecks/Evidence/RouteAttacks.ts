import AnalyticsTableName from "../../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { SECURITY_LOG_RESOURCE_ID_ATTRIBUTE } from "../../../../../Types/SecurityCase/SecurityConnection";
import { HTTP_ACTIVITY_CLASS_UID } from "../../../../../Types/SecurityEvent/SecurityAttackCampaign";
import EdgeAction, {
  EDGE_ACTION_ATTRIBUTE,
} from "../../../../../Types/SecurityEvent/EdgeAction";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { readClickhouseTime } from "../../../../../Utils/SecurityCase/SecurityCaseStoryItems";
import {
  RouteAttackScope,
  RouteMatchKind,
} from "../../../../../Utils/SecurityCase/RouteAttackScope";
import { WEB_ATTACK_KIND_ATTRIBUTE } from "../../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import SecurityEventService from "../../../../Services/SecurityEventService";
import {
  QuerySettingsOptions,
  getQuerySettings,
} from "../../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../../AnalyticsDatabase/Statement";
import { readAnalyticsRows } from "./AddressRequests";

/*
 * THE ATTACK REQUESTS TO A ROUTE, BEFORE AND AFTER A CHANGE SHIPPED
 * (#10347): the security events the app's own logs and traces raised for
 * the case's kind of attack on the case's route (RouteAttackScope), and how
 * far each request got (SecurityEventRequestOutcome) - what says whether a
 * fix worked, which a ticketing system cannot: the same attack that used
 * to reach the database is turned away now.
 *
 * Read as requests, not events: a request the app both traced and logged
 * raised an event from each, so the events of one trace are one request,
 * at the furthest any of them says it got. Counted on each side of the
 * change: before it, and after the rollout grace that follows it (old pods
 * still draining answer as the old code did), so neither side holds the
 * rollout's requests.
 *
 * What the edge in front of the app stopped (a Cloudflare block or
 * challenge, EdgeAction) never reached the app, so it says nothing of the
 * fix and is counted apart: a virtual patch (#10351) that turns the attack
 * away at the edge keeps it from the app, and the check says so. What the
 * edge only logged or let through reached the app, whose own events count
 * it.
 *
 * Bounded: one project, one window of at most FIX_ROUTE_WINDOW_MAX_DAYS,
 * and a read that runs out of time fails - never read as "no attacks".
 */

export const ROUTE_ATTACKS_READ_LIMIT: QuerySettingsOptions = {
  maxExecutionTimeInSeconds: 30,
  timeoutOverflowMode: "throw",
};

// The most traces a reading keeps of the attacks that got through after the change.
export const ROUTE_ATTACKS_MAX_TRACES: number = 20;

// How far each request got, counted on one side of the change.
export interface RouteAttackCounts {
  requests: number;
  rejected: number;
  reachedApp: number;
  errored: number;
  reachedDatabase: number;
  // No outcome: the request could not be followed.
  unknown: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

export interface RouteAttacksReading {
  scope: RouteAttackScope;
  windowStart: Date;
  windowEnd: Date;
  // The change asked about, and the end of its rollout grace; null: none.
  splitAt: Date | null;
  settledAt: Date | null;
  // Before the change (all of them, with none), and after its rollout.
  before: RouteAttackCounts;
  after: RouteAttackCounts;
  // The whole window.
  all: RouteAttackCounts;
  // The latest request that got past the app's checks (Reached App or worse), and that broke something or reached the database.
  lastThroughAt: Date | null;
  lastHarmAt: Date | null;
  // After the rollout: the first that got past the app's checks, and the first that broke something or reached the database.
  firstThroughAfterAt: Date | null;
  firstHarmAfterAt: Date | null;
  throughAfterTraceIds: Array<string>;
  // Attacks on the route the edge stopped from the change on: they never reached the app.
  edgeStoppedAfter: number;
}

export const EMPTY_ROUTE_ATTACK_COUNTS: RouteAttackCounts = {
  requests: 0,
  rejected: 0,
  reachedApp: 0,
  errored: 0,
  reachedDatabase: 0,
  unknown: 0,
  firstAt: null,
  lastAt: null,
};

// The edge actions after which a request went no further than the edge.
const EDGE_STOPPED: ReadonlyArray<string> = [
  EdgeAction.Blocked,
  EdgeAction.Challenged,
];

/*
 * A path written in an address, as ClickHouse reads it out: no scheme and
 * host, no query or fragment. A trusted literal of the statement, never a
 * value from an event.
 */
const PATH_OF: (column: string) => string = (column: string): string => {
  return `extract(${column}, '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]*)?([^?#]*)')`;
};

/*
 * The attack requests to the route over the window, as one row of counts
 * on each side of `splitAt`. Every value from the case - the route, the
 * kinds, the services, the moments - is a parameter.
 */
export function buildRouteAttacksStatement(data: {
  projectId: ObjectID;
  scope: RouteAttackScope;
  start: Date;
  end: Date;
  splitAt: Date | null;
  settledAt: Date | null;
}): Statement {
  // A change never asked about splits at the window's end: every request is before it.
  const split: Date = data.splitAt || data.end;
  const settled: Date = data.settledAt || data.end;
  const statement: Statement = SQL`SELECT `;

  /*
   * One request a row of the inner read: requestAt (its first event),
   * outcomeRank (the furthest any of its events says it got: 0 not
   * followed, 1 Rejected to 4 Reached Database), isEdge (the edge stopped
   * it) and requestTraceId. Aliases no column or function shares, so none
   * shadows another.
   */
  const sides: Array<{ prefix: string; condition: () => void }> = [
    {
      prefix: "before",
      condition: (): void => {
        statement.append(
          SQL`isEdge = 0 AND requestAt < ${{ type: TableColumnType.DateTime64, value: split }}`,
        );
      },
    },
    {
      prefix: "after",
      condition: (): void => {
        statement.append(
          SQL`isEdge = 0 AND requestAt >= ${{ type: TableColumnType.DateTime64, value: settled }}`,
        );
      },
    },
    {
      prefix: "all",
      condition: (): void => {
        statement.append("isEdge = 0");
      },
    },
  ];
  const outcomes: Array<{ name: string; rank: number }> = [
    { name: "Unknown", rank: 0 },
    { name: "Rejected", rank: 1 },
    { name: "ReachedApp", rank: 2 },
    { name: "Errored", rank: 3 },
    { name: "ReachedDatabase", rank: 4 },
  ];

  for (const side of sides) {
    statement.append("countIf(");
    side.condition();
    statement.append(`) AS ${side.prefix}Requests, `);

    for (const outcome of outcomes) {
      statement.append("countIf(");
      side.condition();
      statement.append(
        ` AND outcomeRank = ${outcome.rank}) AS ${side.prefix}${outcome.name}, `,
      );
    }

    statement.append("minIf(requestAt, ");
    side.condition();
    statement.append(`) AS ${side.prefix}First, maxIf(requestAt, `);
    side.condition();
    statement.append(`) AS ${side.prefix}Last, `);
  }

  statement.append(
    "maxIf(requestAt, isEdge = 0 AND outcomeRank >= 2) AS lastThrough, maxIf(requestAt, isEdge = 0 AND outcomeRank >= 3) AS lastHarm, minIf(requestAt, ",
  );
  sides[1]!.condition();
  statement.append(
    " AND outcomeRank >= 2) AS firstThroughAfter, minIf(requestAt, ",
  );
  sides[1]!.condition();
  statement.append(" AND outcomeRank >= 3) AS firstHarmAfter, ");
  // A parametric aggregate's size is a constant of the statement, never a parameter.
  statement.append(
    `groupUniqArrayIf(${ROUTE_ATTACKS_MAX_TRACES})(requestTraceId, `,
  );
  sides[1]!.condition();
  statement.append(
    SQL` AND outcomeRank >= 2 AND requestTraceId != '') AS throughAfterTraceIds, countIf(isEdge = 1 AND requestAt >= ${{
      type: TableColumnType.DateTime64,
      value: split,
    }}) AS edgeStoppedAfter FROM (SELECT if(traceId != '', traceId, eventUid) AS requestKey, min(time) AS requestAt, max(multiIf(requestOutcome = ${{
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
    }}, 1, 0)) AS outcomeRank, max(attributes[${{
      type: TableColumnType.Text,
      value: EDGE_ACTION_ATTRIBUTE,
    }}] != '') AS isEdge, any(traceId) AS requestTraceId FROM `,
  );
  statement.append(AnalyticsTableName.SecurityEvent);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.start,
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: data.end,
    }} AND classUid = ${{
      type: TableColumnType.Number,
      value: HTTP_ACTIVITY_CLASS_UID,
    }}`,
  );

  // The case's kinds of attack; a case whose requests named none reads any.
  if (data.scope.kinds.length > 0) {
    statement.append(
      SQL` AND has(${{
        type: TableColumnType.ArrayText,
        value: data.scope.kinds,
      }}, lower(attributes[${{
        type: TableColumnType.Text,
        value: WEB_ATTACK_KIND_ATTRIBUTE,
      }}]))`,
    );
  }

  /*
   * The route: a request's route, or its address's path - the address it
   * asked for, or the request the event is about. Held as the scope holds
   * it: the route itself (with or without a trailing slash), or the part
   * before a traversal.
   */
  const paths: Array<string> = [
    `attributes['${SECURITY_REQUEST_ATTRIBUTES.route}']`,
    PATH_OF(`attributes['${SECURITY_REQUEST_ATTRIBUTES.url}']`),
    PATH_OF("targetResource"),
  ];

  statement.append(" AND (");
  paths.forEach((path: string, index: number): void => {
    statement.append(index === 0 ? "" : " OR ");

    if (data.scope.match.kind === RouteMatchKind.Prefix) {
      statement.append(`startsWith(${path}, `);
      statement.append(
        SQL`${{ type: TableColumnType.Text, value: data.scope.match.path }})`,
      );
      return;
    }

    statement.append(
      SQL`has(${{
        type: TableColumnType.ArrayText,
        value: [data.scope.match.path, `${data.scope.match.path}/`],
      }}, `,
    );
    statement.append(`${path})`);
  });
  statement.append(")");

  /*
   * The app's own events, from the services that answered the case's
   * requests - or any, when they named none - and what the edge stopped,
   * wherever it was read from: the edge is no service of the app's.
   */
  statement.append(
    SQL` AND (has(${{
      type: TableColumnType.ArrayText,
      value: [...EDGE_STOPPED],
    }}, attributes[${{
      type: TableColumnType.Text,
      value: EDGE_ACTION_ATTRIBUTE,
    }}]) OR (attributes[${{
      type: TableColumnType.Text,
      value: EDGE_ACTION_ATTRIBUTE,
    }}] = ''`,
  );

  if (data.scope.serviceIds.length > 0) {
    statement.append(
      SQL` AND has(${{
        type: TableColumnType.ArrayText,
        value: data.scope.serviceIds,
      }}, attributes[${{
        type: TableColumnType.Text,
        value: SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
      }}])`,
    );
  }

  statement.append(")) GROUP BY requestKey)");
  statement.append(getQuerySettings(ROUTE_ATTACKS_READ_LIMIT));

  return statement;
}

function readCount(value: JSONValue | undefined): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

// A moment ClickHouse wrote, null for none - min/max of no rows is the epoch.
function readMoment(value: JSONValue | undefined): Date | null {
  const time: Date | null = readClickhouseTime(value);

  return time && time.getTime() > 0 ? time : null;
}

function readCounts(row: JSONObject, prefix: string): RouteAttackCounts {
  const requests: number = readCount(row[`${prefix}Requests`]);

  if (requests === 0) {
    return { ...EMPTY_ROUTE_ATTACK_COUNTS };
  }

  return {
    requests,
    rejected: readCount(row[`${prefix}Rejected`]),
    reachedApp: readCount(row[`${prefix}ReachedApp`]),
    errored: readCount(row[`${prefix}Errored`]),
    reachedDatabase: readCount(row[`${prefix}ReachedDatabase`]),
    unknown: readCount(row[`${prefix}Unknown`]),
    firstAt: readMoment(row[`${prefix}First`]),
    lastAt: readMoment(row[`${prefix}Last`]),
  };
}

// The statement's row, read back; no row is no attack.
export function readRouteAttacksRow(data: {
  row: JSONObject | undefined;
  scope: RouteAttackScope;
  start: Date;
  end: Date;
  splitAt: Date | null;
  settledAt: Date | null;
}): RouteAttacksReading {
  const row: JSONObject = data.row || {};
  const traceIds: JSONValue | undefined = row["throughAfterTraceIds"];

  return {
    scope: data.scope,
    windowStart: data.start,
    windowEnd: data.end,
    splitAt: data.splitAt,
    settledAt: data.settledAt,
    before: readCounts(row, "before"),
    after: readCounts(row, "after"),
    all: readCounts(row, "all"),
    lastThroughAt: readMoment(row["lastThrough"]),
    lastHarmAt: readMoment(row["lastHarm"]),
    firstThroughAfterAt: readMoment(row["firstThroughAfter"]),
    firstHarmAfterAt: readMoment(row["firstHarmAfter"]),
    throughAfterTraceIds: Array.isArray(traceIds)
      ? (traceIds as Array<JSONValue>)
          .filter((traceId: JSONValue): boolean => {
            return typeof traceId === "string" && traceId.length > 0;
          })
          .map((traceId: JSONValue): string => {
            return String(traceId);
          })
          .slice(0, ROUTE_ATTACKS_MAX_TRACES)
      : [],
    edgeStoppedAfter: readCount(row["edgeStoppedAfter"]),
  };
}

export default class RouteAttacks {
  /*
   * The attack requests to the route over the window, on each side of the
   * change. Throws when they could not be read: a check that cannot read
   * its data says it cannot tell.
   */
  public static async read(data: {
    projectId: ObjectID;
    scope: RouteAttackScope;
    start: Date;
    end: Date;
    splitAt: Date | null;
    settledAt: Date | null;
  }): Promise<RouteAttacksReading> {
    const rows: Array<JSONObject> = await readAnalyticsRows(
      SecurityEventService,
      buildRouteAttacksStatement(data),
    );

    return readRouteAttacksRow({ ...data, row: rows[0] });
  }
}
