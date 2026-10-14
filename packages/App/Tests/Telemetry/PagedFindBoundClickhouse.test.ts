import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  ClickHouseSettings,
  SORT_KEY_PAGE_BOUND_ALIAS,
  SORT_KEY_PAGE_VALUES_ALIAS,
} from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * A paged find against a real ClickHouse server (issue #4710).
 *
 * To page without sorting every matching row, a find whose ORDER BY ends
 * in the `_id` tiebreaker first reads its leading sort key alone, in key
 * order, and stops after skip + limit rows (AnalyticsDatabaseService
 * .toSortKeyPageBound). Before #4710 the wide read then took every row
 * with key >= min(those values): a filter matching a few rows spread over
 * the range made that bound cover the range, and with no match min() was
 * 1970 - either way the range was read twice. Now the wide read takes the
 * rows whose key is one of the page's own values, past the earlier pages'
 * ties with its first value.
 *
 * This suite reads the Log model's own table through a Distributed table
 * over the server's `default` cluster, as production does, and shows:
 *
 *   1. Every page is exactly the unbounded page, ties included: the same
 *      rows in the same order as an independent reading of the fixture -
 *      newest and oldest first, two sort keys, a String leading key whose
 *      ties hold thousands of rows, the audit log's second-precision
 *      DateTime key, one tie group spanning a dozen pages,
 *      expired rows and another project's rows that must never appear,
 *      a page 131,100 rows deep (past where ClickHouse stops folding big
 *      constants) and the 10,001-row page an API caller can ask for.
 *   2. The range is never read twice: a filter that matches nothing, or a
 *      page past the last match, selects exactly the marks the unbounded
 *      find selects; a filter matching a few rows adds only the granules
 *      holding them; a sparse filter's deep page adds only its own. The
 *      shape before #4710 is measured beside it on the same fixture, so a
 *      fixture that could no longer show the double read fails too.
 *   3. The saving the bound exists for is kept: an unfiltered first page
 *      reads a small fraction of what the unbounded find reads.
 *
 * Granules are 128 rows (index_granularity = 128, adaptive granularity
 * off), so a fixture of tens of thousands of rows spans hundreds of them.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/PagedFindBoundClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import LogService from "Common/Server/Services/LogService";
import AuditLogService from "Common/Server/Services/AuditLogService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `paged_find_bound_test_${process.pid}_${Date.now()}`;

const SECOND: number = 1000;
const DAY: number = 24 * 60 * 60 * SECOND;
// Four days back from today's midnight (UTC): every row is in the past.
const WINDOW_START: Date = new Date(
  Math.floor(Date.now() / DAY) * DAY - 4 * DAY,
);
const WINDOW_END: Date = new Date(WINDOW_START.getTime() + 4 * DAY);

const GRANULE_ROWS: number = 128;

// The project the finds read, another whose rows must never appear, and one for the deep pages.
const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000004710",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000004710",
);
const DEEP_PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000004710",
);

const SERVICES: Array<string> = [
  "cccccccc-0000-4000-8000-000000000001",
  "cccccccc-0000-4000-8000-000000000002",
  "cccccccc-0000-4000-8000-000000000003",
];

/*
 * The fixture, one formula per column, written once for ClickHouse (SQL
 * below) and once for the oracle (here). Row i of the project:
 *
 *   time      groups of 4 rows share a second, one group a minute; rows
 *             8000..8599 all share one second - a tie group of 600;
 *   _id       a UUID whose text order scrambles the rows of a tie group;
 *   service   i % 3 - a String sort key with ties of ~6,700 rows;
 *   severity  Fatal every 97th row, Error every 10th, else Information;
 *   body      "needle-4710" in 7 rows spread over the range, one of them
 *             (i = 3857) past its retention, so a search finds 6;
 *   expired   every 50th row (i % 50 = 7) is past its retention.
 */
const ROWS: number = 20000;
const TIE_START: number = 8000;
const TIE_ROWS: number = 600;
const RARE_EVERY: number = 2857;
const RARE_AT: number = 1000;
const OTHER_ROWS: number = 3000;
const DEEP_ROWS: number = 140000;
// Audit log entries, 25 to a second: its createdAt is a DateTime, whole seconds.
const AUDIT_ROWS: number = 3000;
const AUDIT_PER_SECOND: number = 25;

function secondOf(index: number): number {
  const group: number =
    index >= TIE_START && index < TIE_START + TIE_ROWS
      ? Math.floor(TIE_START / 4)
      : Math.floor(index / 4);

  return group * 60;
}

function idOf(prefix: string, index: number): string {
  const scrambled: number = (index % 10) * 1000000 + Math.floor(index / 10);
  return `${prefix}-${String(scrambled).padStart(12, "0")}`;
}

const PROJECT_ID_PREFIX: string = "00000000-0000-4000-8000";
const OTHER_ID_PREFIX: string = "00000000-0000-4000-8001";
const DEEP_ID_PREFIX: string = "00000000-0000-4000-8002";
const AUDIT_ID_PREFIX: string = "00000000-0000-4000-8003";

interface FixtureRow {
  index: number;
  second: number;
  id: string;
  service: string;
  severity: string;
  rare: boolean;
  expired: boolean;
}

const FIXTURE: Array<FixtureRow> = Array.from(
  { length: ROWS },
  (_unused: unknown, index: number): FixtureRow => {
    return {
      index: index,
      second: secondOf(index),
      id: idOf(PROJECT_ID_PREFIX, index),
      service: SERVICES[index % 3]!,
      severity:
        index % 97 === 0 ? "Fatal" : index % 10 === 0 ? "Error" : "Information",
      rare: index % RARE_EVERY === RARE_AT,
      expired: index % 50 === 7,
    };
  },
);

// The same formulas, in ClickHouse's words, over numbers(): the row index is `number`.
const SQL_SECOND: string = `if(number >= ${TIE_START} AND number < ${TIE_START + TIE_ROWS}, ${Math.floor(TIE_START / 4)}, intDiv(number, 4)) * 60`;

function sqlId(prefix: string): string {
  return `concat('${prefix}-', leftPad(toString((number % 10) * 1000000 + intDiv(number, 10)), 12, '0'))`;
}

/*
 * Text order, as ClickHouse compares Strings: byte by byte. (Every text
 * here is ASCII, where UTF-16 code units and bytes agree.)
 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

// --- The oracle: what an unbounded find returns, read from the fixture ---

type FixtureFilter = (row: FixtureRow) => boolean;

interface SortSpec {
  // The leading key: the row's time, or its service.
  lead: "time" | "service";
  leadOrder: SortOrder;
  // A second key between the lead and the tiebreaker.
  severityOrder?: SortOrder | undefined;
}

function oracle(filter: FixtureFilter, sort: SortSpec): Array<string> {
  const sign: (order: SortOrder) => number = (order: SortOrder): number => {
    return order === SortOrder.Ascending ? 1 : -1;
  };
  const tiebreak: SortOrder = sort.severityOrder ?? sort.leadOrder;

  return FIXTURE.filter((row: FixtureRow): boolean => {
    return !row.expired && filter(row);
  })
    .sort((left: FixtureRow, right: FixtureRow): number => {
      const lead: number =
        sort.lead === "time"
          ? left.second - right.second
          : compareText(left.service, right.service);

      return (
        sign(sort.leadOrder) * lead ||
        (sort.severityOrder
          ? sign(sort.severityOrder) *
            compareText(left.severity, right.severity)
          : 0) ||
        sign(tiebreak) * compareText(left.id, right.id)
      );
    })
    .map((row: FixtureRow): string => {
      return row.id;
    });
}

// --- The filters a find can carry, as the explorer sends them ---

interface FilterCase {
  label: string;
  query: Record<string, unknown>;
  filter: FixtureFilter;
}

const window: () => InBetween<Date> = (): InBetween<Date> => {
  return new InBetween<Date>(WINDOW_START, WINDOW_END);
};

const FILTERS: Array<FilterCase> = [
  {
    label: "no filter",
    query: {},
    filter: (): boolean => {
      return true;
    },
  },
  {
    label: "a common value (Information, 90%)",
    query: { severityText: "Information" },
    filter: (row: FixtureRow): boolean => {
      return row.severity === "Information";
    },
  },
  {
    label: "a sparse value (Fatal, 1%)",
    query: { severityText: "Fatal" },
    filter: (row: FixtureRow): boolean => {
      return row.severity === "Fatal";
    },
  },
  {
    label: "a body search matching 6 rows spread over the range",
    query: { body: new Search("needle-4710") },
    filter: (row: FixtureRow): boolean => {
      return row.rare;
    },
  },
  {
    label: "a body search matching nothing",
    query: { body: new Search("no-such-needle-4710") },
    filter: (): boolean => {
      return false;
    },
  },
];

const NEWEST_FIRST: SortSpec = { lead: "time", leadOrder: SortOrder.Descending };
const OLDEST_FIRST: SortSpec = { lead: "time", leadOrder: SortOrder.Ascending };

function toServiceSort(sort: SortSpec): Record<string, SortOrder> {
  const out: Record<string, SortOrder> = {
    [sort.lead === "time" ? "time" : "primaryEntityId"]: sort.leadOrder,
  };

  if (sort.severityOrder) {
    out["severityText"] = sort.severityOrder;
  }

  return out;
}

// Pages of one size from every offset worth checking: the first pages, the last, those across the tie group of 600.
function offsetsToCheck(
  expected: Array<string>,
  limit: number,
): Array<number> {
  const offsets: Set<number> = new Set<number>();
  const pages: number = Math.ceil(expected.length / limit) + 1;

  if (pages <= 60) {
    for (let page: number = 0; page < pages; page++) {
      offsets.add(page * limit);
    }

    return [...offsets];
  }

  for (let page: number = 0; page < 6; page++) {
    offsets.add(page * limit);
  }

  for (let page: number = pages - 4; page < pages; page++) {
    offsets.add(page * limit);
  }

  // The big tie group, wherever this order puts it, page by page across it.
  const tieIds: Set<string> = new Set(
    FIXTURE.filter((row: FixtureRow): boolean => {
      return row.index >= TIE_START && row.index < TIE_START + TIE_ROWS;
    }).map((row: FixtureRow): string => {
      return row.id;
    }),
  );
  const first: number = expected.findIndex((id: string): boolean => {
    return tieIds.has(id);
  });

  if (first >= 0) {
    const start: number = Math.max(0, Math.floor(first / limit) - 1) * limit;

    for (
      let offset: number = start;
      offset <= first + TIE_ROWS + limit;
      offset += limit
    ) {
      offsets.add(offset);
    }

    // And offsets that start a page part-way into the group.
    offsets.add(first + 1);
    offsets.add(first + Math.floor(TIE_ROWS / 2) + 3);
  }

  return [...offsets].sort((left: number, right: number): number => {
    return left - right;
  });
}

interface ReadStats {
  marks: number;
  readRows: number;
}

integration("a paged find against ClickHouse (#4710)", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: Record<string, unknown> | undefined;
  let originalAudit: Record<string, unknown> | undefined;
  let measureSettings: ClickHouseSettings = {};

  const projectWindow: (
    projectId: ObjectID,
    extra: Record<string, unknown>,
  ) => Record<string, unknown> = (
    projectId: ObjectID,
    extra: Record<string, unknown>,
  ): Record<string, unknown> => {
    return { projectId: projectId, time: window(), ...extra };
  };

  // A page as the explorer's list reads it: LogService.findBy.
  async function findPage(
    query: Record<string, unknown>,
    sort: SortSpec,
    skip: number,
    limit: number,
  ): Promise<Array<string>> {
    const logs: Array<Log> = await LogService.findBy({
      query: query as any,
      select: { time: true },
      sort: toServiceSort(sort) as any,
      skip: skip,
      limit: limit,
      props: { isRoot: true },
    });

    return logs.map((log: Log): string => {
      return log._id!.toString();
    });
  }

  // The statement LogService sends for a page.
  function findStatement(
    query: Record<string, unknown>,
    sort: SortSpec,
    skip: number,
    limit: number,
  ): Statement {
    return LogService.toFindStatement({
      query: query as any,
      select: { _id: true, time: true, body: true } as any,
      sort: toServiceSort(sort) as any,
      skip: skip,
      limit: limit,
      props: { isRoot: true },
    }).statement;
  }

  interface Sendable {
    query: string;
    params: Record<string, unknown>;
  }

  const pageBoundSelect: string = `AS ${SORT_KEY_PAGE_BOUND_ALIAS} SELECT `;
  const pageBoundIn: string = ` GLOBAL IN (SELECT arrayJoin(tupleElement(${SORT_KEY_PAGE_BOUND_ALIAS}, 1)))`;
  const pageBoundOffset: string = `OFFSET tupleElement(${SORT_KEY_PAGE_BOUND_ALIAS}, 2)`;

  // The page bound's three pieces in a statement: [WITH clause end, IN condition start, IN condition end].
  function boundPieces(query: string): [number, number, number] {
    const selectAt: number = query.indexOf(pageBoundSelect);
    const inAt: number = query.indexOf(pageBoundIn);
    const conditionAt: number = query.lastIndexOf(" AND {", inAt);

    expect(query.startsWith("WITH (")).toBe(true);
    expect(selectAt).toBeGreaterThan(0);
    expect(inAt).toBeGreaterThan(selectAt);
    expect(conditionAt).toBeGreaterThan(selectAt);
    expect(query).toContain(pageBoundOffset);

    return [
      selectAt + pageBoundSelect.length - "SELECT ".length,
      conditionAt,
      inAt + pageBoundIn.length,
    ];
  }

  // The same find as it is sent without a bound: its own WHERE, ORDER BY, LIMIT and OFFSET.
  function unbounded(statement: Statement, skip: number): Sendable {
    const query: string = statement.query;
    const [selectAt, conditionAt, conditionEnd] = boundPieces(query);

    return {
      query: (
        query.slice(selectAt, conditionAt) + query.slice(conditionEnd)
      ).replace(pageBoundOffset, "OFFSET {unboundedSkip:Int32}"),
      params: { ...statement.query_params, unboundedSkip: skip },
    };
  }

  /*
   * The same find as it was sent before #4710: the unbounded find plus
   * `key >= min(the first skip + limit key values)` (or `<= max(...)`
   * oldest first), the narrow read taken from the statement itself.
   */
  function beforeTheFix(
    statement: Statement,
    skip: number,
    descending: boolean,
  ): Sendable {
    const query: string = statement.query;
    const [selectAt, conditionAt, conditionEnd] = boundPieces(query);
    const withClause: string = query.slice(0, selectAt);
    const narrowAt: number =
      withClause.lastIndexOf("FROM (SELECT ") + "FROM (".length;
    const narrowEnd: number = withClause.indexOf(
      `))) AS ${SORT_KEY_PAGE_BOUND_ALIAS}`,
    );
    const narrowRead: string = withClause.slice(narrowAt, narrowEnd);
    // The key as the page's WHERE names it, and as the narrow read does.
    const key: string = query.slice(
      conditionAt + " AND ".length,
      query.indexOf(" GLOBAL IN", conditionAt),
    );
    const narrowKey: string = narrowRead.slice(
      "SELECT ".length,
      narrowRead.indexOf(" FROM "),
    );

    expect(statement.query_params[key.slice(1).split(":")[0]!]).toBe(
      statement.query_params[narrowKey.slice(1).split(":")[0]!],
    );

    const range: string = descending
      ? ` AND ${key} >= (SELECT min(${narrowKey}) FROM (${narrowRead}))`
      : ` AND ${key} <= (SELECT max(${narrowKey}) FROM (${narrowRead}))`;

    return {
      query: (
        query.slice(selectAt, conditionAt) +
        range +
        query.slice(conditionEnd)
      ).replace(pageBoundOffset, "OFFSET {unboundedSkip:Int32}"),
      params: { ...statement.query_params, unboundedSkip: skip },
    };
  }

  async function ids(sendable: Sendable): Promise<Array<string>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: sendable.query,
      query_params: sendable.params,
      format: "JSONEachRow",
    });

    return ((await result.json()) as Array<{ _id: string }>).map(
      (row: { _id: string }): string => {
        return row._id;
      },
    );
  }

  /*
   * The marks ClickHouse selected for a read and the rows it read, from its
   * own query log. The log entry is written after the answer is sent, so
   * the flush is repeated until it is there.
   */
  async function readStats(sendable: Sendable): Promise<ReadStats> {
    const queryId: string = `paged-find-bound-${ObjectID.generate().toString()}`;

    const result: { json: () => Promise<unknown> } = await client.query({
      query: sendable.query,
      query_params: sendable.params,
      format: "JSONEachRow",
      query_id: queryId,
      clickhouse_settings: measureSettings,
    });
    await result.json();

    for (let attempt: number = 0; attempt < 100; attempt++) {
      await client.command({ query: "SYSTEM FLUSH LOGS" });

      const logged: { json: () => Promise<unknown> } = await client.query({
        query:
          "SELECT sum(ProfileEvents['SelectedMarks']) AS marks, sum(read_rows) AS readRows, count() AS entries FROM system.query_log WHERE type = 'QueryFinish' AND (query_id = {id:String} OR initial_query_id = {id:String})",
        query_params: { id: queryId },
        format: "JSONEachRow",
      });

      const [row] = (await logged.json()) as Array<{
        marks: string | number;
        readRows: string | number;
        entries: string | number;
      }>;

      if (Number(row!.entries) > 0) {
        return { marks: Number(row!.marks), readRows: Number(row!.readRows) };
      }

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 100);
      });
    }

    throw new Error(`No query_log entry for ${queryId}.`);
  }

  // How many granules hold a row whose time is one of the page's values.
  async function granulesHoldingPageValues(
    statement: Statement,
  ): Promise<number> {
    const query: string = statement.query;
    const [selectAt] = boundPieces(query);

    const result: { json: () => Promise<unknown> } = await client.query({
      query: `${query.slice(0, selectAt)}SELECT count() AS granules FROM (SELECT DISTINCT _part, intDiv(_part_offset, ${GRANULE_ROWS}) FROM ${database}.LogItemV3Local WHERE projectId = '${PROJECT_ID.toString()}' AND time IN (SELECT arrayJoin(tupleElement(${SORT_KEY_PAGE_BOUND_ALIAS}, 1))))`,
      query_params: statement.query_params,
      format: "JSONEachRow",
    });

    const [row] = (await result.json()) as Array<{ granules: string | number }>;

    return Number(row!.granules);
  }

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 240000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    /*
     * Production reads a Distributed table over the cluster; the server's
     * own one-shard `default` cluster gives this suite the same shape.
     */
    const clusters: { json: () => Promise<unknown> } = await client.query({
      query: "SELECT count() AS shards FROM system.clusters WHERE cluster = 'default'",
      format: "JSONEachRow",
    });
    const [cluster] = (await clusters.json()) as Array<{
      shards: string | number;
    }>;

    expect(Number(cluster!.shards)).toBeGreaterThanOrEqual(1);

    // Measured without the query condition cache, so a repeat read is not cheaper for an earlier one.
    const conditionCache: { json: () => Promise<unknown> } = await client.query({
      query: "SELECT count() AS present FROM system.settings WHERE name = 'use_query_condition_cache'",
      format: "JSONEachRow",
    });
    const [cache] = (await conditionCache.json()) as Array<{
      present: string | number;
    }>;
    measureSettings = (
      Number(cache!.present) > 0 ? { use_query_condition_cache: 0 } : {}
    ) as ClickHouseSettings;

    /*
     * A model's own table (its columns, skip indexes, partitioning, keys)
     * as `<table>Local`, and the Distributed table the service reads in
     * front of it.
     */
    const createTables: (modelType: {
      new (): AnalyticsBaseModel;
    }) => Promise<void> = async (modelType: {
      new (): AnalyticsBaseModel;
    }): Promise<void> => {
      const model: AnalyticsBaseModel = new modelType();
      const generator: StatementGenerator<AnalyticsBaseModel> =
        new StatementGenerator<AnalyticsBaseModel>({
          modelType: modelType,
          database: clickhouse,
        });
      const columns: Statement = generator.toColumnsCreateStatement(
        model.tableColumns,
      );

      await client.command({
        query: `CREATE TABLE ${database}.${model.tableName}Local (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS index_granularity = ${GRANULE_ROWS}, index_granularity_bytes = 0`,
        query_params: columns.query_params,
      });

      await client.command({
        query: `CREATE TABLE ${database}.${model.tableName} AS ${database}.${model.tableName}Local ENGINE = Distributed('default', ${database}, ${model.tableName}Local, ${model.shardingKey || "rand()"})`,
      });
    };

    await createTables(Log);
    await createTables(AuditLog);

    original = {
      database: LogService.database,
      databaseClient: LogService.databaseClient,
      ingestDatabase: LogService.ingestDatabase,
      ingestDatabaseClient: LogService.ingestDatabaseClient,
    };
    originalAudit = {
      database: AuditLogService.database,
      databaseClient: AuditLogService.databaseClient,
    };

    LogService.database = clickhouse;
    LogService.databaseClient = client;
    LogService.ingestDatabase = clickhouse;
    LogService.ingestDatabaseClient = client;
    AuditLogService.database = clickhouse;
    AuditLogService.databaseClient = client;

    const start: string = OneUptimeDate.toClickhouseDateTime64(WINDOW_START);
    const live: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    );
    const expired: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveHours(new Date(), -1),
    );

    const insert: (
      projectId: ObjectID,
      idPrefix: string,
      fromRow: number,
      toRow: number,
      second: string,
      columns: {
        service: string;
        severity: string;
        body: string;
        retention: string;
      },
    ) => Promise<void> = async (
      projectId: ObjectID,
      idPrefix: string,
      fromRow: number,
      toRow: number,
      second: string,
      columns: {
        service: string;
        severity: string;
        body: string;
        retention: string;
      },
    ): Promise<void> => {
      await client.command({
        query: `INSERT INTO ${database}.LogItemV3Local (projectId, primaryEntityId, primaryEntityType, time, timeUnixNano, severityText, severityNumber, attributes, attributeKeys, entityKeys, body, retentionDate, _id, createdAt)
          SELECT '${projectId.toString()}', ${columns.service}, 'Service', addSeconds(toDateTime64('${start}', 9), ${second}) AS rowTime, toUInt64(toUnixTimestamp64Nano(rowTime)), ${columns.severity}, 9, map('row', toString(number)), ['row'], [], ${columns.body}, ${columns.retention}, ${sqlId(idPrefix)}, now()
          FROM numbers(${fromRow}, ${toRow - fromRow})`,
      });
    };

    const ownColumns: {
      service: string;
      severity: string;
      body: string;
      retention: string;
    } = {
      service: `['${SERVICES.join("', '")}'][number % 3 + 1]`,
      severity:
        "multiIf(number % 97 = 0, 'Fatal', number % 10 = 0, 'Error', 'Information')",
      body: `concat('row ', toString(number), if(number % ${RARE_EVERY} = ${RARE_AT}, ' needle-4710', ''))`,
      retention: `if(number % 50 = 7, toDateTime('${expired}'), toDateTime('${live}'))`,
    };

    // Three inserts, so each day of the range is split over several parts, as live ingest leaves it.
    for (const [fromRow, toRow] of [
      [0, 7000],
      [7000, 14000],
      [14000, ROWS],
    ] as Array<[number, number]>) {
      await insert(
        PROJECT_ID,
        PROJECT_ID_PREFIX,
        fromRow,
        toRow,
        SQL_SECOND,
        ownColumns,
      );
    }

    // Another project's rows in the same seconds, matching every filter: never part of a page.
    await insert(OTHER_PROJECT_ID, OTHER_ID_PREFIX, 0, OTHER_ROWS, "intDiv(number, 2) * 100", {
      service: `'${SERVICES[0]!}'`,
      severity: "'Fatal'",
      body: "'other project needle-4710'",
      retention: `toDateTime('${live}')`,
    });

    // The deep project: two rows a second, enough rows to page past 131,072.
    await insert(DEEP_PROJECT_ID, DEEP_ID_PREFIX, 0, DEEP_ROWS, "intDiv(number, 2)", {
      service: `'${SERVICES[1]!}'`,
      severity: "'Information'",
      body: "'deep'",
      retention: `toDateTime('${live}')`,
    });

    // Audit log entries: 25 to a second, so every page boundary falls inside a tie.
    await client.command({
      query: `INSERT INTO ${database}.${new AuditLog().tableName}Local (projectId, resourceType, resourceId, action, changes, retentionDate, _id, createdAt)
        SELECT '${PROJECT_ID.toString()}', ['Monitor', 'Incident'][number % 2 + 1], toString(number % 7), 'Update', '{}', toDateTime('${live}'), ${sqlId(AUDIT_ID_PREFIX)}, addSeconds(toDateTime('${OneUptimeDate.toClickhouseDateTime(WINDOW_START)}'), intDiv(number, ${AUDIT_PER_SECOND}))
        FROM numbers(${AUDIT_ROWS})`,
    });

    const parts: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT count() AS parts, sum(rows) AS rows FROM system.parts WHERE database = {database:String} AND table = 'LogItemV3Local' AND active",
      query_params: { database: database },
      format: "JSONEachRow",
    });
    const [layout] = (await parts.json()) as Array<{
      parts: string | number;
      rows: string | number;
    }>;

    expect(Number(layout!.rows)).toBe(ROWS + OTHER_ROWS + DEEP_ROWS);
    // Several parts: a read in key order merges them, as it does in production.
    expect(Number(layout!.parts)).toBeGreaterThan(4);
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(LogService, original);
    }

    if (originalAudit) {
      Object.assign(AuditLogService, originalAudit);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the fixture holds the cases a page bound has to get right", () => {
    const visible: Array<FixtureRow> = FIXTURE.filter((row: FixtureRow) => {
      return !row.expired;
    });

    expect(
      visible.filter((row: FixtureRow): boolean => {
        return row.rare;
      }),
    ).toHaveLength(6);
    // The seventh match is past its retention: a search must not find it.
    expect(
      FIXTURE.filter((row: FixtureRow): boolean => {
        return row.rare && row.expired;
      }).map((row: FixtureRow): number => {
        return row.index;
      }),
    ).toEqual([3857]);
    expect(
      visible.filter((row: FixtureRow): boolean => {
        return row.second === secondOf(TIE_START);
      }).length,
    ).toBeGreaterThan(500);
    expect(
      FIXTURE.filter((row: FixtureRow): boolean => {
        return row.expired;
      }).length,
    ).toBe(ROWS / 50);
    expect(new Set(FIXTURE.map((row: FixtureRow) => row.id)).size).toBe(ROWS);
  });

  test("the explorer's list find carries the page bound", () => {
    const query: string = findStatement(
      projectWindow(PROJECT_ID, {}),
      NEWEST_FIRST,
      0,
      101,
    ).query;

    expect(query.startsWith("WITH (")).toBe(true);
    expect(query).toContain(`AS ${SORT_KEY_PAGE_VALUES_ALIAS}`);
    expect(query).toContain(pageBoundIn);
    expect(query).toContain(pageBoundOffset);
  });

  describe("every page is the unbounded page, ties included", () => {
    test.each(FILTERS)(
      "$label: newest and oldest first, pages of 1, 7 and 50, against the fixture",
      async ({ query, filter }: FilterCase) => {
        for (const sort of [NEWEST_FIRST, OLDEST_FIRST]) {
          const expected: Array<string> = oracle(filter, sort);

          for (const limit of [1, 7, 50]) {
            const offsets: Array<number> =
              limit === 1
                ? [0, 1, 2, expected.length - 1, expected.length]
                : offsetsToCheck(expected, limit);

            for (const skip of offsets.filter((offset: number) => {
              return offset >= 0;
            })) {
              expect([
                sort.leadOrder,
                limit,
                skip,
                await findPage(projectWindow(PROJECT_ID, query), sort, skip, limit),
              ]).toEqual([
                sort.leadOrder,
                limit,
                skip,
                expected.slice(skip, skip + limit),
              ]);
            }
          }
        }
      },
    );

    test.each([
      ["newest first", NEWEST_FIRST],
      ["oldest first", OLDEST_FIRST],
    ])(
      "%s: paging through a sparse filter returns every matching row exactly once, in order",
      async (_label: string, sort: SortSpec) => {
        const fatal: FilterCase = FILTERS[2]!;
        const seen: Array<string> = [];

        for (let skip: number = 0; ; skip += 13) {
          const page: Array<string> = await findPage(
            projectWindow(PROJECT_ID, fatal.query),
            sort,
            skip,
            13,
          );

          if (page.length === 0) {
            break;
          }

          seen.push(...page);
        }

        expect(seen).toEqual(oracle(fatal.filter, sort));
        expect(new Set(seen).size).toBe(seen.length);
      },
    );

    test("the tie group of 600 rows, paged 50 at a time, is returned whole, once, in _id order", async () => {
      const expected: Array<string> = oracle((): boolean => {
        return true;
      }, NEWEST_FIRST);
      const tieSecond: number = secondOf(TIE_START);
      const tieIds: Array<string> = FIXTURE.filter((row: FixtureRow) => {
        return !row.expired && row.second === tieSecond;
      })
        .map((row: FixtureRow): string => {
          return row.id;
        })
        .sort(compareText)
        .reverse();
      const first: number = expected.indexOf(tieIds[0]!);

      expect(first).toBeGreaterThan(0);

      const seen: Array<string> = [];

      for (
        let skip: number = first - (first % 50);
        skip < first + tieIds.length;
        skip += 50
      ) {
        seen.push(
          ...(await findPage(projectWindow(PROJECT_ID, {}), NEWEST_FIRST, skip, 50)),
        );
      }

      expect(
        seen.filter((id: string): boolean => {
          return tieIds.includes(id);
        }),
      ).toEqual(tieIds);
    });

    test("two sort keys: time newest first, then severity: the page bound reads the leading key, the order holds both", async () => {
      const sort: SortSpec = {
        lead: "time",
        leadOrder: SortOrder.Descending,
        severityOrder: SortOrder.Ascending,
      };
      const expected: Array<string> = oracle((): boolean => {
        return true;
      }, sort);

      for (const skip of offsetsToCheck(expected, 50)) {
        expect([skip, await findPage(projectWindow(PROJECT_ID, {}), sort, skip, 50)]).toEqual([
          skip,
          expected.slice(skip, skip + 50),
        ]);
      }
    });

    test.each([
      ["descending", SortOrder.Descending],
      ["ascending", SortOrder.Ascending],
    ])(
      "a String leading key (service, %s) whose ties hold thousands of rows",
      async (_label: string, order: SortOrder) => {
        const sort: SortSpec = { lead: "service", leadOrder: order };
        const expected: Array<string> = oracle((): boolean => {
          return true;
        }, sort);

        // A third of the rows tie on each service: pages inside and across those ties.
        const third: number = Math.floor(expected.length / 3);

        for (const skip of [0, 50, third - 25, third, third + 1, 2 * third - 7, expected.length - 30, expected.length]) {
          expect([skip, await findPage(projectWindow(PROJECT_ID, {}), sort, skip, 50)]).toEqual([
            skip,
            expected.slice(skip, skip + 50),
          ]);
        }

        expect(
          findStatement(projectWindow(PROJECT_ID, {}), sort, 0, 50).query.startsWith(
            "WITH (",
          ),
        ).toBe(true);
      },
    );

    test("expired rows and another project's rows never reach a page", async () => {
      const expiredIds: Set<string> = new Set(
        FIXTURE.filter((row: FixtureRow): boolean => {
          return row.expired;
        }).map((row: FixtureRow): string => {
          return row.id;
        }),
      );

      const rare: Array<string> = await findPage(
        projectWindow(PROJECT_ID, FILTERS[3]!.query),
        NEWEST_FIRST,
        0,
        100,
      );

      expect(rare).toHaveLength(6);
      expect(
        rare.every((id: string): boolean => {
          return id.startsWith(PROJECT_ID_PREFIX) && !expiredIds.has(id);
        }),
      ).toBe(true);

      const all: Array<string> = await findPage(
        projectWindow(PROJECT_ID, {}),
        NEWEST_FIRST,
        0,
        10000,
      );

      expect(all).toHaveLength(10000);
      expect(
        all.some((id: string): boolean => {
          return expiredIds.has(id) || !id.startsWith(PROJECT_ID_PREFIX);
        }),
      ).toBe(false);
    });

    test.each([
      ["newest first", SortOrder.Descending],
      ["oldest first", SortOrder.Ascending],
    ])(
      "the audit log (%s): a second-precision DateTime key, 25 entries a second, every page of 7 and of 50",
      async (_label: string, order: SortOrder) => {
        const sign: number = order === SortOrder.Ascending ? 1 : -1;
        const expected: Array<string> = Array.from(
          { length: AUDIT_ROWS },
          (_unused: unknown, index: number): { second: number; id: string } => {
            return {
              second: Math.floor(index / AUDIT_PER_SECOND),
              id: idOf(AUDIT_ID_PREFIX, index),
            };
          },
        )
          .sort(
            (
              left: { second: number; id: string },
              right: { second: number; id: string },
            ): number => {
              return (
                sign * (left.second - right.second) ||
                sign * compareText(left.id, right.id)
              );
            },
          )
          .map((row: { second: number; id: string }): string => {
            return row.id;
          });

        for (const limit of [7, 50]) {
          const pages: number = limit === 7 ? 45 : AUDIT_ROWS / limit + 1;

          for (let page: number = 0; page < pages; page++) {
            const skip: number = page * limit;
            const entries: Array<AuditLog> = await AuditLogService.findBy({
              query: { projectId: PROJECT_ID },
              select: { createdAt: true },
              sort: { createdAt: order },
              skip: skip,
              limit: limit,
              props: { isRoot: true },
            });

            expect([
              limit,
              skip,
              entries.map((entry: AuditLog): string => {
                return entry._id!.toString();
              }),
            ]).toEqual([limit, skip, expected.slice(skip, skip + limit)]);
          }
        }

        expect(
          AuditLogService.toFindStatement({
            query: { projectId: PROJECT_ID },
            select: { createdAt: true },
            sort: { createdAt: order },
            skip: 0,
            limit: 50,
            props: { isRoot: true },
          }).statement.query.startsWith("WITH ("),
        ).toBe(true);
      },
    );

    /*
     * Past 131,072 values ClickHouse no longer folds a function of them
     * into a constant, and an OFFSET must be one. The page's offset is
     * worked out inside the bound's subquery, so this depth is no
     * different from the first page.
     */
    test.each([
      ["newest first", SortOrder.Descending],
      ["oldest first", SortOrder.Ascending],
    ])(
      "%s: a page 131,100 rows deep, the last page and one past it, and the 10,001 rows an API caller can ask for",
      async (_label: string, order: SortOrder) => {
        const sort: SortSpec = { lead: "time", leadOrder: order };
        const query: Record<string, unknown> = projectWindow(DEEP_PROJECT_ID, {});

        for (const [skip, limit] of [
          [131100, 101],
          [DEEP_ROWS - 37, 101],
          [DEEP_ROWS, 101],
          [0, 10001],
          [20000, 10001],
        ] as Array<[number, number]>) {
          const statement: Statement = findStatement(query, sort, skip, limit);
          const page: Array<string> = await ids({
            query: statement.query,
            params: statement.query_params,
          });

          expect([skip, limit, page]).toEqual([
            skip,
            limit,
            await ids(unbounded(statement, skip)),
          ]);
          expect(page).toHaveLength(Math.max(0, Math.min(limit, DEEP_ROWS - skip)));
        }
      },
    );
  });

  describe("the range is never read twice", () => {
    test("a filter that matches nothing selects exactly the marks the unbounded find selects - before #4710, twice as many", async () => {
      const statement: Statement = findStatement(
        projectWindow(PROJECT_ID, FILTERS[4]!.query),
        NEWEST_FIRST,
        0,
        101,
      );

      const bounded: ReadStats = await readStats({
        query: statement.query,
        params: statement.query_params,
      });
      const plain: ReadStats = await readStats(unbounded(statement, 0));
      const before: ReadStats = await readStats(beforeTheFix(statement, 0, true));

      expect(plain.marks).toBeGreaterThan(100);
      expect(bounded.marks).toBe(plain.marks);
      // Plus the one row of system.one that the page-values subquery reads.
      expect(bounded.readRows).toBeLessThanOrEqual(plain.readRows + 1);
      // The fixture shows the double read the fix removes.
      expect(before.marks).toBe(2 * plain.marks);
    });

    test("oldest first, a filter that matches nothing reads no more than the unbounded find", async () => {
      const statement: Statement = findStatement(
        projectWindow(PROJECT_ID, FILTERS[4]!.query),
        OLDEST_FIRST,
        0,
        101,
      );

      const bounded: ReadStats = await readStats({
        query: statement.query,
        params: statement.query_params,
      });
      const plain: ReadStats = await readStats(unbounded(statement, 0));

      expect(bounded.marks).toBe(plain.marks);
      expect(bounded.readRows).toBeLessThanOrEqual(plain.readRows + 1);
    });

    test("a page past the last match selects exactly the marks the unbounded find selects", async () => {
      for (const filter of [FILTERS[3]!, FILTERS[2]!]) {
        const skip: number = 5000;
        const statement: Statement = findStatement(
          projectWindow(PROJECT_ID, filter.query),
          NEWEST_FIRST,
          skip,
          101,
        );

        expect(await ids({ query: statement.query, params: statement.query_params })).toEqual([]);

        const bounded: ReadStats = await readStats({
          query: statement.query,
          params: statement.query_params,
        });
        const plain: ReadStats = await readStats(unbounded(statement, skip));
        const before: ReadStats = await readStats(beforeTheFix(statement, skip, true));

        expect([filter.label, bounded.marks]).toEqual([filter.label, plain.marks]);
        expect(before.marks).toBeGreaterThan(plain.marks + plain.marks / 2);
      }
    });

    test("a body search matching 6 rows spread over the range adds only the granules holding them", async () => {
      const statement: Statement = findStatement(
        projectWindow(PROJECT_ID, FILTERS[3]!.query),
        NEWEST_FIRST,
        0,
        101,
      );

      const holding: number = await granulesHoldingPageValues(statement);
      const bounded: ReadStats = await readStats({
        query: statement.query,
        params: statement.query_params,
      });
      const plain: ReadStats = await readStats(unbounded(statement, 0));
      const before: ReadStats = await readStats(beforeTheFix(statement, 0, true));

      expect(holding).toBeGreaterThanOrEqual(6);
      expect(holding).toBeLessThanOrEqual(12);
      expect(bounded.marks).toBeLessThanOrEqual(plain.marks + 2 * holding);
      // The range the old bound re-read covered nearly all of it.
      expect(before.marks).toBeGreaterThan(plain.marks + plain.marks / 2);
    });

    test("a sparse filter's deep page adds the granules holding its own values, not the pages before it", async () => {
      const skip: number = 150;
      const statement: Statement = findStatement(
        projectWindow(PROJECT_ID, FILTERS[2]!.query),
        NEWEST_FIRST,
        skip,
        20,
      );

      const holding: number = await granulesHoldingPageValues(statement);
      const bounded: ReadStats = await readStats({
        query: statement.query,
        params: statement.query_params,
      });
      const plain: ReadStats = await readStats(unbounded(statement, skip));
      const before: ReadStats = await readStats(beforeTheFix(statement, skip, true));

      expect(holding).toBeLessThanOrEqual(2 * 20);
      expect(bounded.marks).toBeLessThanOrEqual(plain.marks + 2 * holding);
      expect(before.marks).toBeGreaterThan(bounded.marks + holding);
    });
  });

  describe("the saving the bound exists for is kept", () => {
    test.each([
      ["newest first", NEWEST_FIRST],
      ["oldest first", OLDEST_FIRST],
    ])(
      "%s, no filter: the first page reads a fraction of the rows the unbounded find reads",
      async (_label: string, sort: SortSpec) => {
        const statement: Statement = findStatement(
          projectWindow(PROJECT_ID, {}),
          sort,
          0,
          101,
        );

        const bounded: ReadStats = await readStats({
          query: statement.query,
          params: statement.query_params,
        });
        const plain: ReadStats = await readStats(unbounded(statement, 0));

        /*
         * The unbounded find reads most of the range (ClickHouse's top-N
         * filtering skips the odd granule); the bounded one, measured at
         * about a tenth of it here, a few granules of each part.
         */
        expect(plain.readRows).toBeGreaterThan(ROWS / 2);
        expect(bounded.readRows * 3).toBeLessThan(plain.readRows);
      },
    );
  });
});

describe("paged find ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
