import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_EXPORT_SOURCE_COLUMNS,
  AuditLogExportRecord,
  readAuditLogExportDate,
  toAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import OneUptimeDate from "Common/Types/Date";
import QueryTimeoutException from "Common/Types/Exception/QueryTimeoutException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The audit log export's read against a real ClickHouse server.
 *
 * The Enterprise exporter sends each export the entries recorded since its
 * cursor, a batch at a time: AuditLogService.findEntriesForExport, keyset-
 * paged on (createdAt, _id) - createdAt is whole seconds, so entries
 * recorded in the same second are common, and the cursor is the last
 * entry delivered. The unit suite pins the statement; this one shows what
 * it READS, from a table built from the real AuditLog model and written
 * through the real AuditLogService.create, as the recorder writes it:
 *
 *   1. paging a project's entries a few at a time reads each exactly once,
 *      oldest first, ties within a second by id, and no other project's;
 *   2. an instance export (no project) reads every project's, the same way;
 *   3. the window holds: nothing before the export's start or after the
 *      settle bound, both ends included;
 *   4. a cursor inside a second resumes after its entry, not after the
 *      second;
 *   5. every row read is the export record's source columns, and becomes
 *      the record of the entry written;
 *   6. a read stopped at its time limit fails, rather than answering some
 *      rows that are not the first ones (which would move the cursor past
 *      entries never sent).
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/AuditLogExportReadClickhouse.test.ts
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

import {
  AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS,
  AuditLogService,
} from "Common/Server/Services/AuditLogService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

// The audit log's table, as the model names it.
const TABLE: string = new AuditLog().tableName;

const database: string = `audit_log_export_read_test_${process.pid}_${Date.now()}`;

const SECOND: number = 1000;

const PROJECT_A: ObjectID = new ObjectID(
  "a1000000-0000-4000-8000-00000000a001",
);
const PROJECT_B: ObjectID = new ObjectID(
  "b2000000-0000-4000-8000-00000000b002",
);

// A whole second three hours back: the export's start, and its settle bound 30 seconds on.
const START_MS: number =
  Math.floor((Date.now() - 3 * 60 * 60 * SECOND) / SECOND) * SECOND;
const START: Date = new Date(START_MS);
const UNTIL: Date = new Date(START_MS + 30 * SECOND);

// The second most entries share, so ties are ordered by id.
const TIE_MS: number = START_MS + 10 * SECOND;

interface EntryFixture {
  id: string;
  projectId: ObjectID;
  createdAtMs: number;
  resourceName: string;
}

let fixtureCounter: number = 0;

// Random (v4) ids, so the order entries are written in is not their id order.
function entryAt(
  createdAtMs: number,
  projectId: ObjectID = PROJECT_A,
): EntryFixture {
  fixtureCounter++;

  return {
    id: ObjectID.generate().toString(),
    projectId: projectId,
    createdAtMs: createdAtMs,
    resourceName: `Monitor ${fixtureCounter}`,
  };
}

const BEFORE_START: Array<EntryFixture> = [
  entryAt(START_MS - SECOND),
  entryAt(START_MS - 1, PROJECT_B),
];

const AT_START: EntryFixture = entryAt(START_MS);

const ONE_A_SECOND: Array<EntryFixture> = Array.from(
  { length: 7 },
  (_: unknown, index: number): EntryFixture => {
    return entryAt(START_MS + (index + 1) * SECOND);
  },
);

const TIES: Array<EntryFixture> = [
  ...Array.from({ length: 9 }, (): EntryFixture => {
    return entryAt(TIE_MS);
  }),
  ...Array.from({ length: 4 }, (): EntryFixture => {
    return entryAt(TIE_MS, PROJECT_B);
  }),
];

const OTHER_PROJECT: Array<EntryFixture> = [
  entryAt(START_MS + 2 * SECOND, PROJECT_B),
  entryAt(START_MS + 5 * SECOND, PROJECT_B),
];

const LATER: Array<EntryFixture> = Array.from(
  { length: 6 },
  (_: unknown, index: number): EntryFixture => {
    return entryAt(START_MS + (20 + index) * SECOND);
  },
);

const AT_UNTIL: EntryFixture = entryAt(UNTIL.getTime());

const AFTER_UNTIL: Array<EntryFixture> = [
  entryAt(UNTIL.getTime() + SECOND),
  entryAt(UNTIL.getTime() + 2 * SECOND, PROJECT_B),
];

// Written in this order: neither time nor id order.
const ALL_ENTRIES: Array<EntryFixture> = [
  ...LATER,
  AT_UNTIL,
  ...TIES.slice(4),
  ...BEFORE_START,
  ...OTHER_PROJECT,
  AT_START,
  ...TIES.slice(0, 4),
  ...ONE_A_SECOND,
  ...AFTER_UNTIL,
];

function changesOf(entry: EntryFixture): Array<JSONObject> {
  return [
    { field: "name", oldValue: null, newValue: entry.resourceName },
    { field: "description", oldValue: "Before", newValue: "After" },
  ];
}

// Entries in the order an export reads them: by second, then by id.
function inReadOrder(entries: Array<EntryFixture>): Array<string> {
  return [...entries]
    .sort((a: EntryFixture, b: EntryFixture): number => {
      if (a.createdAtMs !== b.createdAtMs) {
        return a.createdAtMs - b.createdAtMs;
      }

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((entry: EntryFixture): string => {
      return entry.id;
    });
}

function inWindow(entry: EntryFixture): boolean {
  return (
    entry.createdAtMs >= START.getTime() && entry.createdAtMs <= UNTIL.getTime()
  );
}

function entriesOf(projectId: ObjectID | null): Array<EntryFixture> {
  return ALL_ENTRIES.filter((entry: EntryFixture): boolean => {
    return (
      inWindow(entry) &&
      (!projectId || entry.projectId.toString() === projectId.toString())
    );
  });
}

type Cursor = { createdAt: Date; id: ObjectID } | null;

// The cursor after a row, as the exporter keeps it: the last entry delivered.
function cursorAfter(row: JSONObject): Cursor {
  const record: AuditLogExportRecord = toAuditLogExportRecord(row)!;

  return {
    createdAt: new Date(record.createdAt),
    id: new ObjectID(record.id),
  };
}

// The service on the test database, built as the default one is on the install's.
let service: AuditLogService;

// Every batch until an empty one, as the exporter reads them.
async function pageThrough(data: {
  projectId: ObjectID | null;
  limit: number;
  after?: Cursor;
}): Promise<{ rows: Array<JSONObject>; batches: number }> {
  const rows: Array<JSONObject> = [];
  let after: Cursor = data.after || null;
  let batches: number = 0;

  for (let attempt: number = 0; attempt < 200; attempt++) {
    const batch: Array<JSONObject> = await service.findEntriesForExport({
      projectId: data.projectId,
      startsAt: START,
      until: UNTIL,
      after: after,
      limit: data.limit,
    });

    if (batch.length === 0) {
      return { rows, batches };
    }

    expect(batch.length).toBeLessThanOrEqual(data.limit);

    batches++;
    rows.push(...batch);
    after = cursorAfter(batch[batch.length - 1]!);
  }

  throw new Error("The read never ran out of entries.");
}

function idsOf(rows: Array<JSONObject>): Array<string> {
  return rows.map((row: JSONObject): string => {
    return String(row["_id"]);
  });
}

/*
 * The read as built, with a slow filter folded in and its time limit cut to
 * a second on one thread, so a real server stops it at the limit the way it
 * would stop a read of a busy month at 45. Everything else - the WHERE, the
 * order, the overflow mode - is the statement as built.
 */
class SlowReadStatement extends Statement {
  public constructor(private readonly source: Statement) {
    super();
  }

  public override get query(): string {
    let query: string = this.source.query;

    for (const expected of [
      " ORDER BY createdAt ASC, _id ASC LIMIT ",
      `max_execution_time = ${AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS}`,
      "timeout_overflow_mode = 'throw'",
    ]) {
      if (!query.includes(expected)) {
        throw new Error(`Unexpected export read statement: ${query}`);
      }
    }

    query = query
      .replace(
        " ORDER BY createdAt ASC, _id ASC LIMIT ",
        " AND sleepEachRow(0.2) = 0 ORDER BY createdAt ASC, _id ASC LIMIT ",
      )
      .replace(
        `max_execution_time = ${AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS}`,
        // Merged parts are read a block at a time, which may hold every row.
        "max_execution_time = 1, max_block_size = 1, max_threads = 1, function_sleep_max_microseconds_per_block = 60000000",
      );

    return query;
  }

  public override get query_params(): Record<string, unknown> {
    return this.source.query_params;
  }
}

async function countEntries(client: ClickhouseClient): Promise<number> {
  const result: { json: () => Promise<{ data?: Array<JSONObject> }> } =
    (await client.query({
      query: `SELECT count() AS count FROM ${database}.${TABLE}`,
      format: "JSON",
    })) as unknown as { json: () => Promise<{ data?: Array<JSONObject> }> };

  return Number((await result.json()).data?.[0]?.["count"]);
}

integration("The audit log export's read against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;

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
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    /*
     * The model's columns, keys, TTL and settings, on one node: an install
     * creates the same table as a cluster's local table, read through a
     * Distributed one, which this server has no cluster for.
     */
    const model: AuditLog = new AuditLog();
    const columns: Statement = new StatementGenerator<AuditLog>({
      modelType: AuditLog,
      database: clickhouse,
    }).toColumnsCreateStatement(model.tableColumns);

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) TTL ${model.ttlExpression} SETTINGS ${model.tableSettings}`,
      query_params: columns.query_params,
    });

    service = new AuditLogService(clickhouse);

    const retentionDate: Date = OneUptimeDate.addRemoveDays(new Date(), 30);

    /*
     * Written as the recorder writes them: root, through the service, which
     * records each "now" - here each fixture's time, in order (the first
     * test checks every entry landed at its own).
     */
    const times: Array<number> = ALL_ENTRIES.map(
      (fixture: EntryFixture): number => {
        return fixture.createdAtMs;
      },
    );

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return new Date(times.shift() ?? Date.now());
    });

    await service.createMany({
      items: ALL_ENTRIES.map((fixture: EntryFixture): AuditLog => {
        const entry: AuditLog = new AuditLog();
        entry.id = new ObjectID(fixture.id);
        entry.projectId = fixture.projectId;
        entry.action = AuditLogAction.Update;
        entry.resourceType = "Monitor";
        entry.resourceId = new ObjectID("c3000000-0000-4000-8000-00000000c003");
        entry.resourceName = fixture.resourceName;
        entry.userType = "User";
        entry.changes = changesOf(fixture);
        entry.retentionDate = retentionDate;
        return entry;
      }),
      props: { isRoot: true },
    });

    jest.restoreAllMocks();

    /*
     * An insert is answered a moment before its rows can be read (the last
     * few were missing from a read run at once): wait until every entry
     * can be. The exporter's settle time is the same allowance, a minute.
     */
    for (let attempt: number = 0; attempt < 120; attempt++) {
      if ((await countEntries(client)) === ALL_ENTRIES.length) {
        return;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 250);
      });
    }

    throw new Error("The fixture's entries never all became readable.");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the fixture wrote every entry, each at its own time", async () => {
    const result: {
      json: () => Promise<{ data?: Array<{ count?: string | number }> }>;
    } = (await client.query({
      query: `SELECT count() AS count, countIf(createdAt = toDateTime({tie:UInt32})) AS ties FROM ${database}.${TABLE}`,
      query_params: { tie: Math.floor(TIE_MS / SECOND) },
      format: "JSON",
    })) as unknown as {
      json: () => Promise<{ data?: Array<{ count?: string | number }> }>;
    };
    const response: {
      data?: Array<{ count?: string | number; ties?: string | number }>;
    } = await result.json();

    expect(Number(response.data?.[0]?.count)).toBe(ALL_ENTRIES.length);
    expect(Number(response.data?.[0]?.ties)).toBe(TIES.length);

    const stored: { json: () => Promise<{ data?: Array<JSONObject> }> } =
      (await client.query({
        query: `SELECT _id, toUnixTimestamp(createdAt) AS seconds FROM ${database}.${TABLE}`,
        format: "JSON",
      })) as unknown as { json: () => Promise<{ data?: Array<JSONObject> }> };

    for (const row of (await stored.json()).data || []) {
      const fixture: EntryFixture = ALL_ENTRIES.find(
        (entry: EntryFixture): boolean => {
          return entry.id === String(row["_id"]);
        },
      )!;

      // Whole seconds: the one fixture a millisecond before the start is the second before it.
      expect({ id: fixture.id, seconds: Number(row["seconds"]) }).toEqual({
        id: fixture.id,
        seconds: Math.floor(fixture.createdAtMs / SECOND),
      });
    }
  });

  test("a project's entries are read oldest first, each exactly once, ties in a second by id, and no other project's", async () => {
    const expected: Array<string> = inReadOrder(entriesOf(PROJECT_A));
    const read: { rows: Array<JSONObject>; batches: number } =
      await pageThrough({ projectId: PROJECT_A, limit: 4 });

    expect(expected.length).toBe(24);
    expect(idsOf(read.rows)).toEqual(expected);
    expect(read.batches).toBe(6);
    expect(
      read.rows.every((row: JSONObject): boolean => {
        return String(row["projectId"]) === PROJECT_A.toString();
      }),
    ).toBe(true);
  });

  test("whatever the batch size, the same entries in the same order", async () => {
    const expected: Array<string> = inReadOrder(entriesOf(PROJECT_A));

    for (const limit of [1, 3, 9, 24, 500]) {
      const read: { rows: Array<JSONObject>; batches: number } =
        await pageThrough({ projectId: PROJECT_A, limit });

      expect({ limit, ids: idsOf(read.rows) }).toEqual({
        limit,
        ids: expected,
      });
    }
  });

  test("an instance export reads every project's entries, the same way", async () => {
    const expected: Array<string> = inReadOrder(entriesOf(null));
    const read: { rows: Array<JSONObject>; batches: number } =
      await pageThrough({ projectId: null, limit: 5 });

    expect(expected.length).toBe(30);
    expect(idsOf(read.rows)).toEqual(expected);
    expect(
      new Set(
        read.rows.map((row: JSONObject): string => {
          return String(row["projectId"]);
        }),
      ),
    ).toEqual(new Set([PROJECT_A.toString(), PROJECT_B.toString()]));
  });

  test("nothing before the export's start or after the settle bound is read, and both ends are", async () => {
    const ids: Array<string> = idsOf(
      (await pageThrough({ projectId: null, limit: 500 })).rows,
    );

    expect(ids).toContain(AT_START.id);
    expect(ids).toContain(AT_UNTIL.id);

    for (const outside of [...BEFORE_START, ...AFTER_UNTIL]) {
      expect(ids).not.toContain(outside.id);
    }
  });

  test("a cursor inside a second resumes after its entry, not after the second", async () => {
    const tiesOfA: Array<string> = inReadOrder(
      TIES.filter((entry: EntryFixture): boolean => {
        return entry.projectId.toString() === PROJECT_A.toString();
      }),
    );
    const expected: Array<string> = inReadOrder(entriesOf(PROJECT_A));
    const cursorAt: number = expected.indexOf(tiesOfA[2]!);

    const read: { rows: Array<JSONObject>; batches: number } =
      await pageThrough({
        projectId: PROJECT_A,
        limit: 4,
        after: {
          createdAt: new Date(TIE_MS),
          id: new ObjectID(tiesOfA[2]!),
        },
      });

    expect(idsOf(read.rows).slice(0, 6)).toEqual(tiesOfA.slice(3));
    expect(idsOf(read.rows)).toEqual(expected.slice(cursorAt + 1));
  });

  test("a cursor at the last entry reads nothing more", async () => {
    const expected: Array<string> = inReadOrder(entriesOf(PROJECT_A));
    const last: EntryFixture = ALL_ENTRIES.find(
      (entry: EntryFixture): boolean => {
        return entry.id === expected[expected.length - 1];
      },
    )!;

    const rows: Array<JSONObject> = await service.findEntriesForExport({
      projectId: PROJECT_A,
      startsAt: START,
      until: UNTIL,
      after: {
        createdAt: new Date(last.createdAtMs),
        id: new ObjectID(last.id),
      },
      limit: 100,
    });

    expect(rows).toEqual([]);
  });

  test("every row is the export record's source columns, and becomes the record of the entry written", async () => {
    const rows: Array<JSONObject> = (
      await pageThrough({ projectId: PROJECT_A, limit: 500 })
    ).rows;

    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [...AUDIT_LOG_EXPORT_SOURCE_COLUMNS].sort(),
      );

      const fixture: EntryFixture = ALL_ENTRIES.find(
        (entry: EntryFixture): boolean => {
          return entry.id === String(row["_id"]);
        },
      )!;
      const record: AuditLogExportRecord = toAuditLogExportRecord(row)!;

      expect({
        id: record.id,
        createdAt: record.createdAt,
        projectId: record.projectId,
        action: record.action,
        resourceType: record.resourceType,
        resourceName: record.resourceName,
        userType: record.userType,
        apiKeyId: record.apiKeyId,
        changes: record.changes,
      }).toEqual({
        id: fixture.id,
        createdAt: new Date(fixture.createdAtMs).toISOString(),
        projectId: fixture.projectId.toString(),
        action: AuditLogAction.Update,
        resourceType: "Monitor",
        resourceName: fixture.resourceName,
        userType: "User",
        apiKeyId: null,
        changes: changesOf(fixture),
      });
      expect(readAuditLogExportDate(row["createdAt"])?.getTime()).toBe(
        fixture.createdAtMs,
      );
    }
  });

  test("a read stopped at its time limit fails, and never answers some rows that are not the first ones", async () => {
    const statement: Statement = AuditLogService.toExportReadStatement({
      databaseName: database,
      tableName: TABLE,
      projectId: null,
      startsAt: START,
      until: UNTIL,
      after: null,
      limit: 500,
    });

    let error: unknown = null;

    try {
      const result: { json: () => Promise<{ data?: Array<unknown> }> } =
        (await service.executeQuery(
          new SlowReadStatement(statement),
        )) as unknown as { json: () => Promise<{ data?: Array<unknown> }> };

      await result.json();
    } catch (caught) {
      error = caught;
    }

    // Recorded on the export as its error; the same batch is read again on its next run.
    expect({
      isQueryTimeoutException: error instanceof QueryTimeoutException,
      error: String(error),
    }).toEqual({ isQueryTimeoutException: true, error: String(error) });
  });
});

describe("Audit log export read ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
