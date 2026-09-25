import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import RumSessionErasureRequest, {
  RumSessionErasureRequestStatus,
  RumSessionErasureRequestType,
} from "Common/Models/DatabaseModels/RumSessionErasureRequest";
import RumSessionErasureRequestService from "Common/Server/Services/RumSessionErasureRequestService";
import RumSessionPinService from "Common/Server/Services/RumSessionPinService";
import ProjectService from "Common/Server/Services/ProjectService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import logger from "Common/Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Erasure of the telemetry joined to a session by TRACE id.
 *
 * The recorder puts the session id in the tracestate of the page's own
 * requests, so span ingest stamps the backend spans with it - but backend
 * logs, the exceptions derived from them and unstamped spans of the same
 * traces carry no session id, and the replay rail still shows them as part
 * of the recording by joining on trace id. Erasing the session has to take
 * them too, which means reading the stamped spans' trace ids BEFORE any
 * delete (ALTER ... DELETE is asynchronous: a subquery evaluated after the
 * Span delete would match nothing) and then deleting by a literal list.
 *
 * Only the traces that belong to the erased sessions ALONE go by trace id:
 * a stamp shows a session took part in a trace (a page-set traceparent is
 * stamped too, and a tracestate can be forged), not that the trace is the
 * session's. The lookup flags each candidate; the flag's SQL semantics were
 * checked against ClickHouse 24.8 and 26.7, and these tests pin its shape
 * and how the job acts on it.
 */

jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

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

/* In-memory Redis: the tombstone set and the finalizer's activity sets. */
const sets: Map<string, Set<string>> = new Map<string, Set<string>>();
let redisConnected: boolean = true;

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        if (!redisConnected) {
          return null;
        }

        return {
          sadd: (
            key: string,
            members: Array<string> | string,
          ): Promise<number> => {
            const set: Set<string> = sets.get(key) || new Set<string>();

            for (const member of Array.isArray(members) ? members : [members]) {
              set.add(member);
            }

            sets.set(key, set);
            return Promise.resolve(set.size);
          },
          smembers: (key: string): Promise<Array<string>> => {
            return Promise.resolve(Array.from(sets.get(key) || []));
          },
          sismember: (key: string, member: string): Promise<number> => {
            return Promise.resolve(sets.get(key)?.has(member) ? 1 : 0);
          },
          expire: (): Promise<number> => {
            return Promise.resolve(1);
          },
          zscan: (): Promise<[string, Array<string>]> => {
            return Promise.resolve(["0", []]);
          },
          zrem: (): Promise<number> => {
            return Promise.resolve(0);
          },
        };
      },
      isConnected: (): boolean => {
        return redisConnected;
      },
    },
  };
});

import {
  buildErasedSessionTraceIdStatement,
  buildTraceDeleteStatement,
  chunkTraceIds,
  eraseSessionBatch,
  getErasedSessionsKey,
  MAX_SESSION_IDS_PER_MUTATION,
  MAX_TRACE_ID_BYTES_PER_MUTATION,
  MAX_TRACE_ID_BYTES_PER_PARAMETER,
  MAX_TRACE_IDS_PER_MUTATION,
  processErasureRequest,
  splitTraceIdParameters,
  TRACE_DELETE_EXECUTE_OPTIONS,
  TRACE_DELETE_MAX_QUERY_SIZE,
  TRACE_OWNERSHIP_SKEW_MINUTES,
  traceIdUrlBytes,
  writeErasureTombstones,
} from "../../FeatureSet/Workers/Jobs/Rum/ProcessSessionErasureRequests";

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const otherProjectId: ObjectID = new ObjectID("6600000000000000000000e5");
const databaseName: string = "oneuptime";
const sessionA: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const sessionB: string = "2a1d0b5c7e3f48a9b2c4d6e8f0a11223";
const traceOne: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const traceTwo: string = "0af7651916cd43dd8448eb211c80319c";
const traceThree: string = "5b8aa5a2d2c872e8321cf37308d69df2";

/* ClickHouse's own limits on a request's URL, measured on 24.8 and 26.7. */
const HTTP_MAX_FIELD_VALUE_SIZE: number = 128 * 1024;
const HTTP_MAX_URI_SIZE: number = 1024 * 1024;

type DeleteLabel = "chunks" | "headers" | "logs" | "spans" | "exceptions";
type DeleteColumn = "sessionId" | "traceId";

interface HarnessEvent {
  kind: "read-chunks" | "read-trace-ids" | "delete" | "pins";
  label?: DeleteLabel | undefined;
  column?: DeleteColumn | undefined;
  ids: Array<string>;
  statement?: Statement | undefined;
  options?: ClickhouseExecuteOptions | undefined;
}

interface Harness {
  events: Array<HarnessEvent>;
  headerReads: Array<Statement>;
}

function resultSetOf(rows: Array<JSONObject>): unknown {
  return {
    json: (): Promise<{ data: Array<JSONObject> }> => {
      return Promise.resolve({ data: rows });
    },
  };
}

/* Lookup rows as ClickHouse returns them: owned (1) unless told otherwise. */
function traceRows(
  ids: Array<unknown>,
  ownedByBatch: unknown = 1,
): Array<JSONObject> {
  return ids.map((id: unknown): JSONObject => {
    return { traceId: id, ownedByBatch: ownedByBatch } as JSONObject;
  });
}

/* Ascending, so the rows are in the order the lookup's ORDER BY gives. */
function hexIds(count: number, seed: string): Array<string> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): string => {
      return `${seed}${index.toString(16).padStart(32 - seed.length, "0")}`;
    },
  );
}

function concat(arrays: Array<Array<string>>): Array<string> {
  return arrays.reduce((all: Array<string>, next: Array<string>) => {
    return all.concat(next);
  }, []);
}

/* Every Array(String) parameter a statement binds, in order. */
function arrayParams(statement: Statement): Array<Array<string>> {
  return Object.values(statement.query_params).filter(
    (value: unknown): boolean => {
      return Array.isArray(value);
    },
  ) as Array<Array<string>>;
}

/* The ids a delete or a chunk count binds, across all its parameters. */
function boundIds(statement: Statement): Array<string> {
  const arrays: Array<Array<string>> = arrayParams(statement);

  expect(arrays.length).toBeGreaterThan(0);

  return concat(arrays);
}

/* The lookup binds the batch twice (subquery, ownership test): one list. */
function lookupSessionIds(statement: Statement): Array<string> {
  const arrays: Array<Array<string>> = arrayParams(statement);

  expect(arrays.length).toBe(2);
  expect(arrays[1]).toEqual(arrays[0]);

  return arrays[0]!;
}

function deleteColumnOf(statement: Statement): DeleteColumn {
  if (statement.query.includes("traceId IN")) {
    return "traceId";
  }

  if (statement.query.includes("sessionId IN")) {
    return "sessionId";
  }

  throw new Error(`Unrecognised delete statement: ${statement.query}`);
}

/* The URL-encoded size @clickhouse/client gives one Array(String) of hex ids. */
function encodedParameterBytes(ids: Array<string>): number {
  const formatted: string = `[${ids
    .map((id: string): string => {
      return `'${id}'`;
    })
    .join(",")}]`;

  return new URLSearchParams({ v: formatted }).toString().length - 2;
}

function installHarness(data: {
  traceIdRows?: Array<JSONObject> | undefined;
  traceIdReadError?: Error | undefined;
  failDelete?:
    | ((
        label: DeleteLabel,
        column: DeleteColumn,
        ids: Array<string>,
      ) => boolean)
    | undefined;
}): Harness {
  const events: Array<HarnessEvent> = [];
  const headerReads: Array<Statement> = [];

  jest.spyOn(RumSessionChunkService, "executeQuery").mockImplementation(((
    statement: Statement,
  ): Promise<unknown> => {
    events.push({
      kind: "read-chunks",
      ids: boundIds(statement),
      statement: statement,
    });
    return Promise.resolve(resultSetOf([{ chunkCount: 3 }]));
  }) as never);

  /*
   * The header table is never a source of trace ids: RumSession.traceIds
   * lists the ids the recording observed (page-set ids, requests to listed
   * cross-origin APIs), which say nothing about whose a trace is.
   */
  jest.spyOn(RumSessionService, "executeQuery").mockImplementation(((
    statement: Statement,
  ): Promise<unknown> => {
    headerReads.push(statement);
    return Promise.resolve(
      resultSetOf([{ sessionId: sessionA, traceIds: ["f".repeat(32)] }]),
    );
  }) as never);

  /*
   * The trace-id lookup: one statement per batch, answered with every
   * candidate row, as ClickHouse answers a query with no LIMIT.
   */
  jest.spyOn(SpanService, "executeQuery").mockImplementation(((
    statement: Statement,
    options?: ClickhouseExecuteOptions,
  ): Promise<unknown> => {
    events.push({
      kind: "read-trace-ids",
      ids: lookupSessionIds(statement),
      statement: statement,
      options: options,
    });

    if (data.traceIdReadError) {
      return Promise.reject(data.traceIdReadError);
    }

    return Promise.resolve(resultSetOf(data.traceIdRows || []));
  }) as never);

  const services: Array<{ label: DeleteLabel; service: unknown }> = [
    { label: "chunks", service: RumSessionChunkService },
    { label: "headers", service: RumSessionService },
    { label: "logs", service: LogService },
    { label: "spans", service: SpanService },
    { label: "exceptions", service: ExceptionInstanceService },
  ];

  for (const entry of services) {
    jest
      .spyOn(
        entry.service as {
          execute: (
            statement: Statement,
            options?: ClickhouseExecuteOptions,
          ) => Promise<unknown>;
        },
        "execute",
      )
      .mockImplementation(((
        statement: Statement,
        options?: ClickhouseExecuteOptions,
      ): Promise<unknown> => {
        const column: DeleteColumn = deleteColumnOf(statement);
        const ids: Array<string> = boundIds(statement);

        if (data.failDelete && data.failDelete(entry.label, column, ids)) {
          return Promise.reject(new Error("Too many mutations"));
        }

        events.push({
          kind: "delete",
          label: entry.label,
          column: column,
          ids: ids,
          statement: statement,
          options: options,
        });

        return Promise.resolve({});
      }) as never);
  }

  jest
    .spyOn(RumSessionPinService, "deleteBy")
    .mockImplementation(((): Promise<number> => {
      events.push({ kind: "pins", ids: [] });
      return Promise.resolve(0);
    }) as never);

  return { events: events, headerReads: headerReads };
}

function deletes(
  events: Array<HarnessEvent>,
  column?: DeleteColumn,
  label?: DeleteLabel,
): Array<HarnessEvent> {
  return events.filter((event: HarnessEvent): boolean => {
    return (
      event.kind === "delete" &&
      (!column || event.column === column) &&
      (!label || event.label === label)
    );
  });
}

function reads(events: Array<HarnessEvent>): Array<HarnessEvent> {
  return events.filter((event: HarnessEvent): boolean => {
    return event.kind === "read-trace-ids";
  });
}

/* "logs:traceId" style tags, for readable order assertions. */
function sequenceOf(events: Array<HarnessEvent>): Array<string> {
  return events.map((event: HarnessEvent): string => {
    return event.kind === "delete"
      ? `${event.label}:${event.column}`
      : event.kind;
  });
}

/* Every trace id each table's trace-id deletes carried, in order. */
function traceIdsDeletedFrom(
  events: Array<HarnessEvent>,
  label: DeleteLabel,
): Array<string> {
  return concat(
    deletes(events, "traceId", label).map(
      (event: HarnessEvent): Array<string> => {
        return event.ids;
      },
    ),
  );
}

function normalized(statement: Statement): string {
  return statement.query.replace(/\s+/g, " ");
}

beforeEach(() => {
  sets.clear();
  redisConnected = true;
  (logger.warn as unknown as ReturnType<typeof jest.fn>).mockClear();
  (logger.info as unknown as ReturnType<typeof jest.fn>).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the trace-id lookup statement", () => {
  const statement: Statement = buildErasedSessionTraceIdStatement({
    databaseName: databaseName,
    projectId: projectId,
    sessionIds: [sessionA, sessionB],
  });
  const query: string = normalized(statement);

  test("reads the Span table, through the Distributed table, on both sides", () => {
    const params: Array<unknown> = Object.values(statement.query_params);

    expect(
      params.filter((value: unknown): boolean => {
        return value === AnalyticsTableName.Span;
      }).length,
    ).toBe(2);
    expect(params).not.toContain(`${AnalyticsTableName.Span}Local`);
    expect(params).toContain(databaseName);
  });

  test("is scoped to the project and to the batch's session ids, bound rather than inlined", () => {
    expect(query).toContain("WHERE projectId = {p");
    expect(query).toContain("AND sessionId IN {p");
    expect(query).toContain("Array(String)");
    expect(query).not.toContain(sessionA);
    expect(
      Object.values(statement.query_params).filter((value: unknown) => {
        return value === projectId.toString();
      }).length,
    ).toBe(2);
    expect(lookupSessionIds(statement)).toEqual([sessionA, sessionB]);
  });

  test("candidates are the traces of spans stamped with the batch's ids, via GLOBAL IN", () => {
    /*
     * Both sides read the Distributed table; a plain IN over a Distributed
     * subquery is Code 288 on a multi-shard cluster.
     */
    expect(query).toMatch(
      /AND traceId GLOBAL IN \( SELECT DISTINCT traceId FROM \{p\d+:Identifier\}\.\{p\d+:Identifier\} WHERE projectId = \{p\d+:String\} AND sessionId IN \{p\d+:Array\(String\)\} AND traceId != '' \)/,
    );
    expect(query).not.toMatch(/traceId IN \(\s*SELECT/);
  });

  test("flags a trace as the batch's own only when no other session stamped it and nothing in it starts well before or after its stamps", () => {
    /*
     * Both time bounds: a trace that was running before the session (a
     * server-rendered page's own trace) and one that other, unrecorded
     * visitors went on extending with no stamp (a reused page traceparent)
     * are not the session's.
     */
    expect(query).toContain(
      `countIf(sessionId != '' AND sessionId NOT IN {p0:Array(String)}) = 0 AND countIf(sessionId != '') > 0 AND min(startTime) >= minIf(startTime, sessionId != '') - INTERVAL ${TRACE_OWNERSHIP_SKEW_MINUTES} MINUTE AND max(startTime) <= maxIf(startTime, sessionId != '') + INTERVAL ${TRACE_OWNERSHIP_SKEW_MINUTES} MINUTE AS ownedByBatch`,
    );
    expect(TRACE_OWNERSHIP_SKEW_MINUTES).toBe(10);
    /* One row per candidate trace, flag and all: nothing is filtered away. */
    expect(query).toContain("GROUP BY traceId");
    expect(query).not.toContain("HAVING");
    expect(query).not.toContain("DISTINCT traceId AS traceId");
  });

  test("is one pass per batch: no LIMIT and no keyset, ordered by traceId", () => {
    /*
     * The candidate subquery and the GROUP BY have to see every candidate
     * before the first row is flagged, so a paged lookup re-ran both scans
     * of the project's span history for every page.
     */
    expect(query.endsWith("GROUP BY traceId ORDER BY traceId")).toBe(true);
    expect(query).not.toContain("LIMIT");
    expect(query).not.toContain("traceId >");
    expect(query).not.toContain("OFFSET");
  });

  test("leaves out spans with no trace id, on both sides", () => {
    expect(query.match(/AND traceId != ''/g)?.length).toBe(2);
    /* Bound: the project twice and the batch twice, nothing else. */
    expect(Object.keys(statement.query_params).length).toBe(8);
    expect(
      Object.values(statement.query_params).filter((value: unknown) => {
        return value === "";
      }),
    ).toEqual([]);
  });

  test("never reads the header table: its traceIds are ids the recording observed, not ones it owns", () => {
    expect(Object.values(statement.query_params)).not.toContain(
      AnalyticsTableName.RumSession,
    );
    expect(query).not.toContain("traceIds");
  });
});

describe("the trace-id delete statement", () => {
  test("targets the LOCAL storage table with ON CLUSTER, like the session-id deletes", () => {
    for (const tableName of [
      AnalyticsTableName.Log,
      AnalyticsTableName.ExceptionInstance,
      AnalyticsTableName.Span,
    ]) {
      const statement: Statement = buildTraceDeleteStatement({
        databaseName: databaseName,
        tableName: tableName,
        projectId: projectId,
        traceIds: [traceOne],
      });

      expect(statement.query).toContain("ALTER TABLE");
      expect(statement.query).toContain("ON CLUSTER");
      expect(statement.query).toContain("DELETE WHERE");
      expect(Object.values(statement.query_params)).toContain(
        `${tableName}Local`,
      );
    }
  });

  test("is constrained by project and a bound list of trace ids, never a subquery", () => {
    const statement: Statement = buildTraceDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.Log,
      projectId: projectId,
      traceIds: [traceOne, traceTwo],
    });

    expect(normalized(statement)).toMatch(
      /DELETE WHERE projectId = \{p\d+:String\} AND \(traceId IN \{p\d+:Array\(String\)\}\)$/,
    );
    expect(statement.query).not.toContain("SELECT");
    expect(statement.query).not.toContain("sessionId");
    expect(statement.query).not.toContain(traceOne);
    expect(Object.values(statement.query_params)).toContain(
      projectId.toString(),
    );
    expect(arrayParams(statement)).toEqual([[traceOne, traceTwo]]);
  });

  test("a full mutation's ids are split over OR-ed parameters that each fit ClickHouse's field limit", () => {
    const ids: Array<string> = hexIds(MAX_TRACE_IDS_PER_MUTATION, "a");
    const statement: Statement = buildTraceDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.Log,
      projectId: projectId,
      traceIds: ids,
    });
    const parameters: Array<Array<string>> = arrayParams(statement);

    /* One id list would be ~410 KB: "Field value too long". */
    expect(parameters.length).toBeGreaterThan(1);
    expect(concat(parameters)).toEqual(ids);

    let urlBytes: number = 0;

    for (const parameter of parameters) {
      const bytes: number = encodedParameterBytes(parameter);

      expect(bytes).toBeLessThanOrEqual(MAX_TRACE_ID_BYTES_PER_PARAMETER);
      expect(bytes).toBeLessThan(HTTP_MAX_FIELD_VALUE_SIZE);
      urlBytes += bytes;
    }

    expect(urlBytes).toBeLessThan(HTTP_MAX_URI_SIZE / 2);

    const clauses: Array<string> = normalized(statement)
      .split(" AND (")[1]!
      .replace(/\)$/, "")
      .split(" OR ");

    expect(clauses.length).toBe(parameters.length);

    for (const clause of clauses) {
      expect(clause).toMatch(/^traceId IN \{p\d+:Array\(String\)\}$/);
    }
  });

  test("an empty list matches nothing rather than rendering invalid SQL", () => {
    const statement: Statement = buildTraceDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.Log,
      projectId: projectId,
      traceIds: [],
    });

    expect(normalized(statement)).toMatch(/AND \(0\)$/);
    expect(arrayParams(statement)).toEqual([]);
  });
});

describe("trace-id mutation sizing", () => {
  test("ten thousand ids per mutation, inside ClickHouse's URL and query-size limits", () => {
    expect(MAX_TRACE_IDS_PER_MUTATION).toBe(10000);
    expect(MAX_TRACE_IDS_PER_MUTATION).toBeGreaterThan(
      MAX_SESSION_IDS_PER_MUTATION,
    );
    expect(MAX_TRACE_ID_BYTES_PER_PARAMETER).toBeLessThan(
      HTTP_MAX_FIELD_VALUE_SIZE,
    );
    expect(MAX_TRACE_ID_BYTES_PER_MUTATION).toBeLessThanOrEqual(
      HTTP_MAX_URI_SIZE / 2,
    );
    /* A full mutation of 32-hex ids is bounded by count, not bytes. */
    expect(
      traceIdUrlBytes(traceOne) * MAX_TRACE_IDS_PER_MUTATION,
    ).toBeLessThanOrEqual(MAX_TRACE_ID_BYTES_PER_MUTATION);
    /*
     * The queued ON CLUSTER text holds the ids as literals; it is never
     * longer than their URL form, so this bounds it twice over.
     */
    expect(TRACE_DELETE_MAX_QUERY_SIZE).toBeGreaterThanOrEqual(
      2 * MAX_TRACE_ID_BYTES_PER_MUTATION,
    );
  });

  test("traceIdUrlBytes is exact for hex ids and an upper bound for anything else", () => {
    expect(traceIdUrlBytes(traceOne)).toBe(
      encodedParameterBytes([traceOne, traceOne]) -
        encodedParameterBytes([traceOne]),
    );

    for (const odd of ["a'b\\c d", "trace/é", "\t\n'"]) {
      const escaped: string = odd
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\t/g, "\\t")
        .replace(/\n/g, "\\n");
      const actual: number =
        new URLSearchParams({ v: `'${escaped}',` }).toString().length - 2;

      expect(traceIdUrlBytes(odd)).toBeGreaterThanOrEqual(actual);
    }
  });

  test("chunkTraceIds cuts at ten thousand ids, in order, every id once, no trailing empty chunk", () => {
    const ids: Array<string> = hexIds(25000, "a");
    const chunks: Array<Array<string>> = chunkTraceIds(ids);

    expect(
      chunks.map((chunk: Array<string>): number => {
        return chunk.length;
      }),
    ).toEqual([10000, 10000, 5000]);
    expect(concat(chunks)).toEqual(ids);
    expect(chunkTraceIds(hexIds(20000, "b")).length).toBe(2);
    expect(chunkTraceIds([])).toEqual([]);
  });

  test("chunkTraceIds cuts earlier when the ids are long, so the URL still fits", () => {
    const longIds: Array<string> = hexIds(2000, "c").map(
      (id: string): string => {
        return id.repeat(16);
      },
    );
    const chunks: Array<Array<string>> = chunkTraceIds(longIds);

    expect(chunks.length).toBeGreaterThan(1);
    expect(concat(chunks)).toEqual(longIds);

    for (const chunk of chunks) {
      const bytes: number = chunk.reduce((sum: number, id: string) => {
        return sum + traceIdUrlBytes(id);
      }, 0);

      expect(bytes).toBeLessThanOrEqual(MAX_TRACE_ID_BYTES_PER_MUTATION);
    }
  });

  test("splitTraceIdParameters keeps every parameter under the field limit, and never drops an id", () => {
    const ids: Array<string> = hexIds(MAX_TRACE_IDS_PER_MUTATION, "d");
    const parameters: Array<Array<string>> = splitTraceIdParameters(ids);

    expect(concat(parameters)).toEqual(ids);

    for (const parameter of parameters) {
      expect(encodedParameterBytes(parameter)).toBeLessThanOrEqual(
        MAX_TRACE_ID_BYTES_PER_PARAMETER,
      );
    }

    /* An id over the budget on its own still gets a parameter of its own. */
    const huge: string = "e".repeat(MAX_TRACE_ID_BYTES_PER_PARAMETER);

    expect(splitTraceIdParameters([traceOne, huge, traceTwo])).toEqual([
      [traceOne],
      [huge],
      [traceTwo],
    ]);
  });
});

describe("eraseSessionBatch erases the telemetry joined by trace id", () => {
  test("the trace ids are materialised before any delete is submitted", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne, traceTwo]),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA, sessionB],
    });

    const readIndex: number = harness.events.findIndex(
      (event: HarnessEvent): boolean => {
        return event.kind === "read-trace-ids";
      },
    );
    const firstDeleteIndex: number = harness.events.findIndex(
      (event: HarnessEvent): boolean => {
        return event.kind === "delete";
      },
    );

    expect(readIndex).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIndex).toBeGreaterThan(readIndex);

    /* Exactly one lookup, for exactly this batch's sessions. */
    expect(reads(harness.events).length).toBe(1);
    expect(reads(harness.events)[0]!.ids).toEqual([sessionA, sessionB]);
  });

  test("Log, ExceptionInstance and Span rows are deleted by the materialised trace ids, on top of the session-id deletes", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne, traceTwo, traceThree]),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    const byTrace: Array<HarnessEvent> = deletes(harness.events, "traceId");

    expect(
      byTrace.map((event: HarnessEvent): DeleteLabel | undefined => {
        return event.label;
      }),
    ).toEqual(["logs", "exceptions", "spans"]);

    for (const event of byTrace) {
      expect(event.ids).toEqual([traceOne, traceTwo, traceThree]);
    }

    /* The existing session-id deletes are all still there. */
    const bySession: Array<HarnessEvent> = deletes(harness.events, "sessionId");

    expect(
      bySession.map((event: HarnessEvent): DeleteLabel | undefined => {
        return event.label;
      }),
    ).toEqual(["chunks", "logs", "spans", "exceptions", "headers"]);

    for (const event of bySession) {
      expect(event.ids).toEqual([sessionA]);
    }
  });

  test("the whole batch runs in an order a retry can finish", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne]),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    /*
     * Reads first; the recording's payload first of the deletes; the trace
     * deletes before the session-id delete on Span (whose rows are where
     * the list comes from); the header, which is how a lookup retry finds
     * the session at all, last of the ClickHouse deletes; pins last.
     */
    expect(sequenceOf(harness.events)).toEqual([
      "read-chunks",
      "read-trace-ids",
      "chunks:sessionId",
      "logs:traceId",
      "exceptions:traceId",
      "spans:traceId",
      "logs:sessionId",
      "spans:sessionId",
      "exceptions:sessionId",
      "headers:sessionId",
      "pins",
    ]);
  });

  test("a typical batch - up to ten thousand traces - adds exactly one trace-id mutation per table", async () => {
    const ids: Array<string> = hexIds(9999, "a");
    const harness: Harness = installHarness({ traceIdRows: traceRows(ids) });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(
      deletes(harness.events, "traceId").map((event: HarnessEvent): string => {
        return `${event.label}:${event.ids.length}`;
      }),
    ).toEqual(["logs:9999", "exceptions:9999", "spans:9999"]);
  });

  test("more than one mutation's worth of trace ids is chunked at MAX_TRACE_IDS_PER_MUTATION", async () => {
    const ids: Array<string> = hexIds(25000, "a");
    const harness: Harness = installHarness({ traceIdRows: traceRows(ids) });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    /* Three chunks, each submitted to Log, then ExceptionInstance, then Span. */
    expect(
      deletes(harness.events, "traceId").map((event: HarnessEvent): string => {
        return `${event.label}:${event.ids.length}`;
      }),
    ).toEqual([
      "logs:10000",
      "exceptions:10000",
      "spans:10000",
      "logs:10000",
      "exceptions:10000",
      "spans:10000",
      "logs:5000",
      "exceptions:5000",
      "spans:5000",
    ]);

    for (const label of ["logs", "exceptions", "spans"] as Array<DeleteLabel>) {
      /* Every id once, none twice. */
      expect(traceIdsDeletedFrom(harness.events, label)).toEqual(ids);
    }
  });

  test("an exact multiple of the ceiling produces no trailing empty mutation", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows(hexIds(MAX_TRACE_IDS_PER_MUTATION, "b")),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    const byTrace: Array<HarnessEvent> = deletes(harness.events, "traceId");

    expect(byTrace.length).toBe(3);

    for (const event of byTrace) {
      expect(event.ids.length).toBe(MAX_TRACE_IDS_PER_MUTATION);
    }
  });

  test("no stamped spans means no extra deletes at all", async () => {
    const harness: Harness = installHarness({ traceIdRows: [] });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(deletes(harness.events, "traceId")).toEqual([]);
    expect(sequenceOf(harness.events)).toEqual([
      "read-chunks",
      "read-trace-ids",
      "chunks:sessionId",
      "logs:sessionId",
      "spans:sessionId",
      "exceptions:sessionId",
      "headers:sessionId",
      "pins",
    ]);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("trace(s)"),
    );
  });

  test("empty, non-string and all-zero trace ids are dropped, and duplicates collapse", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows([
        traceOne,
        "",
        null,
        42,
        "00000000000000000000000000000000",
        "0000000000000000",
        traceOne,
        traceTwo,
      ]),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    /*
     * The all-zero id is W3C's "invalid" id, which log lines with no trace
     * context can carry: erasing by it would delete every uncorrelated log
     * line in the project.
     */
    for (const event of deletes(harness.events, "traceId")) {
      expect(event.ids).toEqual([traceOne, traceTwo]);
    }
  });

  test("a set of nothing but unusable ids submits no trace-id delete", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows(["", "00000000000000000000000000000000"]),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(deletes(harness.events, "traceId")).toEqual([]);
    expect(deletes(harness.events, "sessionId").length).toBe(5);
  });

  test("the lookup and every trace-id delete are scoped to the batch's project", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne]),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    const scoped: Array<HarnessEvent> = harness.events.filter(
      (event: HarnessEvent): boolean => {
        return (
          event.kind === "read-trace-ids" ||
          (event.kind === "delete" && event.column === "traceId")
        );
      },
    );

    expect(scoped.length).toBe(4);

    for (const event of scoped) {
      const params: Array<unknown> = Object.values(
        event.statement!.query_params,
      );

      expect(event.statement!.query).toContain("projectId =");
      expect(params).toContain(projectId.toString());
      expect(params).not.toContain(otherProjectId.toString());
    }
  });

  test("the header's traceIds are never a source: only stamped spans are", async () => {
    const harness: Harness = installHarness({ traceIdRows: [] });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    /*
     * The header stub answers with a page-set id; nothing reads it, and no
     * delete ever carries it.
     */
    expect(harness.headerReads).toEqual([]);

    for (const event of deletes(harness.events)) {
      expect(event.ids).not.toContain("f".repeat(32));
    }
  });

  test("the read and the deletes go through the migration pool; the trace-id deletes get room for their query text", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne]),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    /*
     * An unbounded read of the project's span history can outlast the App
     * pool's 58s socket-idle timer before its first byte.
     */
    expect(reads(harness.events)[0]!.options).toBe(MigrationExecuteOptions);
    expect(reads(harness.events)[0]!.options?.useMigrationConnection).toBe(
      true,
    );

    for (const event of deletes(harness.events, "traceId")) {
      expect(event.options).toBe(TRACE_DELETE_EXECUTE_OPTIONS);
    }

    /*
     * Everything MigrationExecuteOptions carries, plus max_query_size: the
     * queued ON CLUSTER text holds the ids as literals, and 26.7 parses it
     * under max_query_size (256 KiB by default).
     */
    expect(TRACE_DELETE_EXECUTE_OPTIONS.useMigrationConnection).toBe(true);
    expect(TRACE_DELETE_EXECUTE_OPTIONS.clickhouseSettings).toEqual({
      ...MigrationExecuteOptions.clickhouseSettings,
      max_query_size: String(TRACE_DELETE_MAX_QUERY_SIZE),
    });

    for (const event of deletes(harness.events, "sessionId")) {
      expect(event.options).toBe(MigrationExecuteOptions);
    }
  });

  test("a failed trace-id read submits no delete at all", async () => {
    const harness: Harness = installHarness({
      traceIdReadError: new Error("ClickHouse is unavailable"),
    });

    await expect(
      eraseSessionBatch({
        databaseName: databaseName,
        projectId: projectId,
        sessionIds: [sessionA],
      }),
    ).rejects.toThrow("ClickHouse is unavailable");

    expect(deletes(harness.events)).toEqual([]);
    expect(
      harness.events.some((event: HarnessEvent): boolean => {
        return event.kind === "pins";
      }),
    ).toBe(false);
  });

  test("a failed trace-id delete leaves Span's session-id delete and the header for the retry", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows(hexIds(15000, "e")),
      failDelete: (
        label: DeleteLabel,
        column: DeleteColumn,
        ids: Array<string>,
      ): boolean => {
        /* The second chunk's ExceptionInstance mutation is refused. */
        return (
          label === "exceptions" && column === "traceId" && ids.length === 5000
        );
      },
    });

    await expect(
      eraseSessionBatch({
        databaseName: databaseName,
        projectId: projectId,
        sessionIds: [sessionA],
      }),
    ).rejects.toThrow("Too many mutations");

    /*
     * The stamped spans that name the second chunk's trace ids are still
     * there, so the retry materialises them again; and the header is still
     * there, so a lookup-based retry still finds the session.
     */
    expect(sequenceOf(harness.events)).toEqual([
      "read-chunks",
      "read-trace-ids",
      "chunks:sessionId",
      "logs:traceId",
      "exceptions:traceId",
      "spans:traceId",
      "logs:traceId",
    ]);
  });
});

/*
 * Shared and pre-dated traces. The recorder stamps a page-set traceparent
 * too (it adds its member whenever a same-origin request has no
 * tracestate), so a server-rendered id cached for many visitors carries
 * every one of their sessions; and a forged tracestate can pull a known
 * trace into a session. Neither kind of trace is the erased session's to
 * take with it.
 */
describe("eraseSessionBatch erases by trace id only the traces the batch owns alone", () => {
  test("a trace another session also stamped is not in the delete list; the batch's own stamped spans still go", async () => {
    const harness: Harness = installHarness({
      traceIdRows: [
        ...traceRows([traceTwo]),
        /* also stamped by a session outside the batch */
        ...traceRows([traceOne], 0),
        ...traceRows([traceThree]),
      ],
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    for (const label of ["logs", "exceptions", "spans"] as Array<DeleteLabel>) {
      expect(traceIdsDeletedFrom(harness.events, label)).toEqual([
        traceTwo,
        traceThree,
      ]);
    }

    /*
     * Its spans stamped with the erased id are the session's own: the
     * session-id delete on Span takes them, whatever the trace.
     */
    expect(deletes(harness.events, "sessionId", "spans").length).toBe(1);
    expect(deletes(harness.events, "sessionId", "spans")[0]!.ids).toEqual([
      sessionA,
    ]);
  });

  test("a trace that started before the session (flagged not owned) is not in the delete list", async () => {
    const harness: Harness = installHarness({
      traceIdRows: [...traceRows([traceTwo], 0), ...traceRows([traceThree])],
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(traceIdsDeletedFrom(harness.events, "logs")).toEqual([traceThree]);
  });

  test("when no candidate is owned, nothing is deleted by trace id and the session-id deletes still run", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne, traceTwo], 0),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(deletes(harness.events, "traceId")).toEqual([]);
    expect(deletes(harness.events, "sessionId").length).toBe(5);
  });

  test("only a real true flag counts as owned; anything else is skipped", async () => {
    const harness: Harness = installHarness({
      traceIdRows: [
        { traceId: hexIds(1, "1")[0]!, ownedByBatch: 1 },
        { traceId: hexIds(1, "2")[0]!, ownedByBatch: "1" },
        { traceId: hexIds(1, "3")[0]!, ownedByBatch: true },
        { traceId: hexIds(1, "4")[0]!, ownedByBatch: 0 },
        { traceId: hexIds(1, "5")[0]!, ownedByBatch: "0" },
        { traceId: hexIds(1, "6")[0]!, ownedByBatch: null },
        { traceId: hexIds(1, "7")[0]!, ownedByBatch: "true" },
        { traceId: hexIds(1, "8")[0]! },
      ] as Array<JSONObject>,
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(traceIdsDeletedFrom(harness.events, "logs")).toEqual([
      hexIds(1, "1")[0]!,
      hexIds(1, "2")[0]!,
      hexIds(1, "3")[0]!,
    ]);
  });

  test("how many candidates were skipped is logged", async () => {
    installHarness({
      traceIdRows: [
        ...traceRows([traceTwo, traceThree], 0),
        ...traceRows([traceOne]),
      ],
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        `2 of 3 trace(s) stamped with erased sessions in project ${projectId.toString()} are shared with other sessions, or have spans that started more than ${TRACE_OWNERSHIP_SKEW_MINUTES} minutes before or after theirs`,
      ),
    );
  });

  test("nothing skipped, nothing logged about skipping", async () => {
    installHarness({ traceIdRows: traceRows([traceOne]) });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("shared with other sessions"),
    );
  });
});

/*
 * No cap, and one lookup per batch. The first lookup stopped at 10,000 ids
 * per batch, logged a warning and let the request complete, and the
 * session-id delete on Span then removed the stamped spans the rest could
 * have been found by. The next one paged by 10,000, but every page re-ran
 * the whole aggregation (two scans of the project's span history) before
 * its LIMIT threw most of it away.
 */
describe("eraseSessionBatch reads every trace id in one lookup before any delete", () => {
  test("more than ten thousand ids: one lookup, all before the first delete, every id deleted exactly once", async () => {
    const ids: Array<string> = hexIds(25000, "a");
    const harness: Harness = installHarness({ traceIdRows: traceRows(ids) });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    const lookups: Array<HarnessEvent> = reads(harness.events);

    expect(lookups.length).toBe(1);
    expect(normalized(lookups[0]!.statement!)).not.toContain("LIMIT");

    const firstDeleteIndex: number = harness.events.findIndex(
      (event: HarnessEvent): boolean => {
        return event.kind === "delete";
      },
    );

    expect(firstDeleteIndex).toBeGreaterThan(
      harness.events.indexOf(lookups[0]!),
    );

    for (const label of ["logs", "exceptions", "spans"] as Array<DeleteLabel>) {
      expect(traceIdsDeletedFrom(harness.events, label)).toEqual(ids);
    }

    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("exactly ten thousand ids is not taken as a full page: one lookup, nothing read again", async () => {
    const ids: Array<string> = hexIds(10000, "b");
    const harness: Harness = installHarness({ traceIdRows: traceRows(ids) });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(reads(harness.events).length).toBe(1);
    expect(traceIdsDeletedFrom(harness.events, "spans")).toEqual(ids);
  });

  test("skipped and unusable ids among many are left out, the rest all deleted", async () => {
    const ids: Array<string> = hexIds(10002, "c");
    const rows: Array<JSONObject> = traceRows(ids);

    rows[9999]!["ownedByBatch"] = 0;
    rows.push({ traceId: "", ownedByBatch: 1 });

    const harness: Harness = installHarness({ traceIdRows: rows });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(reads(harness.events).length).toBe(1);
    expect(traceIdsDeletedFrom(harness.events, "logs")).toEqual(
      ids.filter((_id: string, index: number): boolean => {
        return index !== 9999;
      }),
    );
  });
});

describe("processErasureRequest erases the trace-joined telemetry per batch", () => {
  const requestId: ObjectID = new ObjectID("6600000000000000000000d4");

  function explicitRequest(data: {
    ids: Array<string>;
    attempts?: number | undefined;
  }): RumSessionErasureRequest {
    const request: RumSessionErasureRequest = new RumSessionErasureRequest();

    request.id = requestId;
    request.projectId = projectId;
    request.requestType = RumSessionErasureRequestType.BySessionId;
    request.targetValue = data.ids.join(",");
    request.attempts = data.attempts || 0;

    return request;
  }

  type SpiedFn = ReturnType<typeof jest.fn>;

  interface RequestHarness {
    markCompleted: SpiedFn;
    updateOneById: SpiedFn;
    markFailed: SpiedFn;
  }

  function installRequestHarness(): RequestHarness {
    jest
      .spyOn(RumSessionErasureRequestService, "markInProgress")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectService, "sendEmailToProjectOwners")
      .mockResolvedValue(undefined as never);

    return {
      markCompleted: jest
        .spyOn(RumSessionErasureRequestService, "markCompleted")
        .mockResolvedValue(undefined as never) as unknown as SpiedFn,
      updateOneById: jest
        .spyOn(RumSessionErasureRequestService, "updateOneById")
        .mockResolvedValue(undefined as never) as unknown as SpiedFn,
      markFailed: jest
        .spyOn(RumSessionErasureRequestService, "markFailed")
        .mockResolvedValue(undefined as never) as unknown as SpiedFn,
    };
  }

  test("each batch of sessions reads its own trace ids before its own deletes", async () => {
    const ids: Array<string> = hexIds(MAX_SESSION_IDS_PER_MUTATION + 1, "9");
    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne]),
    });
    const requestHarness: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: explicitRequest({ ids: ids }),
    });

    const readIndexes: Array<number> = [];

    harness.events.forEach((event: HarnessEvent, index: number): void => {
      if (event.kind === "read-trace-ids") {
        readIndexes.push(index);
      }
    });

    expect(readIndexes.length).toBe(2);
    expect(harness.events[readIndexes[0]!]!.ids).toEqual(
      ids.slice(0, MAX_SESSION_IDS_PER_MUTATION),
    );
    expect(harness.events[readIndexes[1]!]!.ids).toEqual(
      ids.slice(MAX_SESSION_IDS_PER_MUTATION),
    );

    /* The second read comes after the first batch's pins and before its own deletes. */
    const firstPins: number = harness.events.findIndex(
      (event: HarnessEvent): boolean => {
        return event.kind === "pins";
      },
    );

    expect(readIndexes[1]!).toBeGreaterThan(firstPins);
    expect(harness.events[readIndexes[1]! + 1]!.kind).toBe("delete");

    /*
     * One lookup per batch, and each judges ownership against its own
     * sessions only (the NOT IN set is the batch, which lookupSessionIds
     * checks): a trace stamped by sessions in different batches looks
     * shared to a lookup that still sees the other batch's stamps.
     */
    for (const index of readIndexes) {
      expect(
        arrayParams(harness.events[index]!.statement!).map(
          (sessionIds: Array<string>): number => {
            return sessionIds.length;
          },
        ),
      ).toEqual(
        index === readIndexes[0]
          ? [MAX_SESSION_IDS_PER_MUTATION, MAX_SESSION_IDS_PER_MUTATION]
          : [1, 1],
      );
    }

    /* One set of three trace-id deletes per batch. */
    expect(deletes(harness.events, "traceId").length).toBe(6);
    expect(requestHarness.markCompleted).toHaveBeenCalledTimes(1);
  });

  test("a batch naming more than twenty thousand traces completes after one lookup, every one of them erased", async () => {
    const traceIds: Array<string> = hexIds(20001, "a");
    const harness: Harness = installHarness({
      traceIdRows: traceRows(traceIds),
    });
    const requestHarness: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: explicitRequest({ ids: [sessionA] }),
    });

    expect(requestHarness.markCompleted).toHaveBeenCalledTimes(1);
    expect(requestHarness.updateOneById).not.toHaveBeenCalled();
    expect(reads(harness.events).length).toBe(1);

    for (const label of ["logs", "exceptions", "spans"] as Array<DeleteLabel>) {
      expect(traceIdsDeletedFrom(harness.events, label)).toEqual(traceIds);
    }

    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("a failed trace-id read requeues the request as a retry, with nothing deleted", async () => {
    const harness: Harness = installHarness({
      traceIdReadError: new Error("ClickHouse is unavailable"),
    });
    const requestHarness: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: explicitRequest({ ids: [sessionA] }),
    });

    expect(deletes(harness.events)).toEqual([]);
    expect(requestHarness.markCompleted).not.toHaveBeenCalled();
    expect(requestHarness.markFailed).not.toHaveBeenCalled();
    expect(requestHarness.updateOneById).toHaveBeenCalledTimes(1);

    const update: { data: Record<string, unknown> } = requestHarness
      .updateOneById.mock.calls[0]![0] as never;

    expect(update.data["status"]).toBe(RumSessionErasureRequestStatus.Pending);
    expect(update.data["attempts"]).toBe(1);

    /* The tombstone went in first, as it always does. */
    expect(
      sets.get(getErasedSessionsKey(projectId.toString()))?.has(sessionA),
    ).toBe(true);
  });

  test("the retry of a tombstoned session reads and erases its trace ids again", async () => {
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionA],
    });

    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne]),
    });
    installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: explicitRequest({ ids: [sessionA], attempts: 1 }),
    });

    expect(reads(harness.events).length).toBe(1);
    expect(deletes(harness.events, "traceId").length).toBe(3);
  });

  test("a first attempt skips an already-tombstoned session, trace-id read included", async () => {
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionA],
    });

    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne]),
    });
    const requestHarness: RequestHarness = installRequestHarness();

    await processErasureRequest({
      databaseName: databaseName,
      request: explicitRequest({ ids: [sessionA] }),
    });

    /* Its mutations are in flight from the earlier run; nothing is re-submitted. */
    expect(harness.events).toEqual([]);
    expect(requestHarness.markCompleted).toHaveBeenCalledTimes(1);
  });
});
