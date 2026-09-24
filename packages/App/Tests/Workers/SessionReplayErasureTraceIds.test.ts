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
  eraseSessionBatch,
  getErasedSessionsKey,
  MAX_SESSION_IDS_PER_MUTATION,
  MAX_TRACE_IDS_PER_MUTATION,
  MAX_TRACE_IDS_PER_SESSION_BATCH,
  processErasureRequest,
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

function traceRows(ids: Array<unknown>): Array<JSONObject> {
  return ids.map((id: unknown): JSONObject => {
    return { traceId: id } as JSONObject;
  });
}

function hexIds(count: number, seed: string): Array<string> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): string => {
      return `${seed}${index.toString(16).padStart(32 - seed.length, "0")}`;
    },
  );
}

/* The one Array(String) parameter each of these statements binds. */
function boundIds(statement: Statement): Array<string> {
  const arrays: Array<unknown> = Object.values(statement.query_params).filter(
    (value: unknown): boolean => {
      return Array.isArray(value);
    },
  );

  expect(arrays.length).toBe(1);

  return arrays[0] as Array<string>;
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
   * The header table must never be a source of trace ids: a page-set id in
   * RumSession.traceIds can be shared far beyond the erased visit.
   */
  jest.spyOn(RumSessionService, "executeQuery").mockImplementation(((
    statement: Statement,
  ): Promise<unknown> => {
    headerReads.push(statement);
    return Promise.resolve(
      resultSetOf([{ sessionId: sessionA, traceIds: ["f".repeat(32)] }]),
    );
  }) as never);

  jest.spyOn(SpanService, "executeQuery").mockImplementation(((
    statement: Statement,
    options?: ClickhouseExecuteOptions,
  ): Promise<unknown> => {
    events.push({
      kind: "read-trace-ids",
      ids: boundIds(statement),
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
): Array<HarnessEvent> {
  return events.filter((event: HarnessEvent): boolean => {
    return event.kind === "delete" && (!column || event.column === column);
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

  test("reads distinct trace ids from the Span table, through the Distributed table", () => {
    expect(statement.query).toContain("SELECT DISTINCT traceId AS traceId");
    expect(Object.values(statement.query_params)).toContain(
      AnalyticsTableName.Span,
    );
    expect(Object.values(statement.query_params)).not.toContain(
      `${AnalyticsTableName.Span}Local`,
    );
    expect(Object.values(statement.query_params)).toContain(databaseName);
  });

  test("is scoped to the project and to the batch's session ids, bound rather than inlined", () => {
    expect(statement.query).toContain("projectId =");
    expect(statement.query).toContain("sessionId IN");
    expect(statement.query).toContain("Array(String)");
    expect(statement.query).not.toContain(sessionA);
    expect(Object.values(statement.query_params)).toContain(
      projectId.toString(),
    );
    expect(boundIds(statement)).toEqual([sessionA, sessionB]);
  });

  test("skips spans with no trace id", () => {
    expect(statement.query).toContain("traceId != ''");
  });

  test("is bounded by a raw LIMIT, not an Identifier placeholder", () => {
    expect(
      statement.query.endsWith(`LIMIT ${MAX_TRACE_IDS_PER_SESSION_BATCH}`),
    ).toBe(true);
    expect(statement.query).not.toMatch(/LIMIT \{p\d+:/);
  });

  test("never reads the header table, whose traceIds include page-set ids", () => {
    expect(Object.values(statement.query_params)).not.toContain(
      AnalyticsTableName.RumSession,
    );
    expect(statement.query).not.toContain("traceIds");
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

    expect(statement.query).toContain("projectId =");
    expect(statement.query).toContain("traceId IN");
    expect(statement.query).toContain("Array(String)");
    expect(statement.query).not.toContain("SELECT");
    expect(statement.query).not.toContain("sessionId");
    expect(statement.query).not.toContain(traceOne);
    expect(Object.values(statement.query_params)).toContain(
      projectId.toString(),
    );
    expect(boundIds(statement)).toEqual([traceOne, traceTwo]);
  });

  test("the per-mutation ceiling matches the session-id deletes", () => {
    expect(MAX_TRACE_IDS_PER_MUTATION).toBe(1000);
    expect(MAX_TRACE_IDS_PER_MUTATION).toBe(MAX_SESSION_IDS_PER_MUTATION);
    expect(MAX_TRACE_IDS_PER_SESSION_BATCH).toBe(10000);
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

    /* Exactly one read, for exactly this batch's sessions. */
    const reads: Array<HarnessEvent> = harness.events.filter(
      (event: HarnessEvent): boolean => {
        return event.kind === "read-trace-ids";
      },
    );

    expect(reads.length).toBe(1);
    expect(reads[0]!.ids).toEqual([sessionA, sessionB]);
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

  test("more than one mutation's worth of trace ids is chunked at MAX_TRACE_IDS_PER_MUTATION", async () => {
    const ids: Array<string> = hexIds(2500, "a");
    const harness: Harness = installHarness({ traceIdRows: traceRows(ids) });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    const byTrace: Array<HarnessEvent> = deletes(harness.events, "traceId");

    /* Three chunks, each submitted to Log, then ExceptionInstance, then Span. */
    expect(
      byTrace.map((event: HarnessEvent): string => {
        return `${event.label}:${event.ids.length}`;
      }),
    ).toEqual([
      "logs:1000",
      "exceptions:1000",
      "spans:1000",
      "logs:1000",
      "exceptions:1000",
      "spans:1000",
      "logs:500",
      "exceptions:500",
      "spans:500",
    ]);

    for (const label of ["logs", "exceptions", "spans"]) {
      const covered: Array<string> = byTrace
        .filter((event: HarnessEvent): boolean => {
          return event.label === label;
        })
        .flatMap((event: HarnessEvent): Array<string> => {
          return event.ids;
        });

      /* Every id once, none twice. */
      expect(covered).toEqual(ids);
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
      expect.stringContaining("trace(s) stamped"),
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

  test("the read and the deletes go through the migration pool", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows([traceOne]),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    const read: HarnessEvent | undefined = harness.events.find(
      (event: HarnessEvent): boolean => {
        return event.kind === "read-trace-ids";
      },
    );

    /*
     * An unbounded read of the project's span history can outlast the App
     * pool's 58s socket-idle timer before its first byte.
     */
    expect(read?.options).toBe(MigrationExecuteOptions);
    expect(read?.options?.useMigrationConnection).toBe(true);

    for (const event of deletes(harness.events, "traceId")) {
      expect(event.options).toBe(MigrationExecuteOptions);
    }
  });

  test("a batch that reaches the cap is logged, and still erases what it read", async () => {
    const harness: Harness = installHarness({
      traceIdRows: traceRows(hexIds(MAX_TRACE_IDS_PER_SESSION_BATCH, "c")),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("NOT removed"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(projectId.toString()),
    );

    const byTrace: Array<HarnessEvent> = deletes(harness.events, "traceId");

    expect(byTrace.length).toBe(
      (MAX_TRACE_IDS_PER_SESSION_BATCH / MAX_TRACE_IDS_PER_MUTATION) * 3,
    );
  });

  test("a batch below the cap logs no warning", async () => {
    installHarness({
      traceIdRows: traceRows(hexIds(MAX_TRACE_IDS_PER_SESSION_BATCH - 1, "d")),
    });

    await eraseSessionBatch({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: [sessionA],
    });

    expect(logger.warn).not.toHaveBeenCalled();
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
      traceIdRows: traceRows(hexIds(1500, "e")),
      failDelete: (
        label: DeleteLabel,
        column: DeleteColumn,
        ids: Array<string>,
      ): boolean => {
        /* The second chunk's ExceptionInstance mutation is refused. */
        return (
          label === "exceptions" && column === "traceId" && ids.length === 500
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

    const reads: Array<number> = [];

    harness.events.forEach((event: HarnessEvent, index: number): void => {
      if (event.kind === "read-trace-ids") {
        reads.push(index);
      }
    });

    expect(reads.length).toBe(2);
    expect(harness.events[reads[0]!]!.ids).toEqual(
      ids.slice(0, MAX_SESSION_IDS_PER_MUTATION),
    );
    expect(harness.events[reads[1]!]!.ids).toEqual(
      ids.slice(MAX_SESSION_IDS_PER_MUTATION),
    );

    /* The second read comes after the first batch's pins and before its own deletes. */
    const firstPins: number = harness.events.findIndex(
      (event: HarnessEvent): boolean => {
        return event.kind === "pins";
      },
    );

    expect(reads[1]!).toBeGreaterThan(firstPins);
    expect(harness.events[reads[1]! + 1]!.kind).toBe("delete");

    /* One set of three trace-id deletes per batch. */
    expect(deletes(harness.events, "traceId").length).toBe(6);
    expect(requestHarness.markCompleted).toHaveBeenCalledTimes(1);
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

    expect(
      harness.events.filter((event: HarnessEvent): boolean => {
        return event.kind === "read-trace-ids";
      }).length,
    ).toBe(1);
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
