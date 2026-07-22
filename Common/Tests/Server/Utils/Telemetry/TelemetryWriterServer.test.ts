import {
  FanInInsertError,
  FanInInsertTarget,
  FanInSubmitResult,
  TransientInsertError,
} from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import {
  InflightGate,
  TableTargetResolver,
  WriterInsertDeps,
  WriterInsertOutcome,
  createTableTargetResolver,
  handleWriterInsert,
  parseWriterInsertRequest,
  readWriterMaxInflightRequestsFromEnv,
} from "../../../../Server/Utils/Telemetry/TelemetryWriterServer";
import { JSONObject } from "../../../../Types/JSON";
import { type ClickHouseSettings } from "@clickhouse/client";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Writer-tier request handling: admission gate, validation, table
 * resolution, and the HTTP status contract for insert outcomes.
 */

function makeTarget(tableName: string): FanInInsertTarget {
  return {
    model: { tableName },
    insertJsonRows: async (): Promise<void> => {
      // unused — deps.submit is mocked in these tests
    },
  };
}

type SubmitCall = {
  tableName: string;
  rows: Array<JSONObject>;
  dedupToken: string;
  clickhouseSettings: ClickHouseSettings | undefined;
};

function makeDeps(data?: {
  flushed?: Promise<void>;
  forwardingEnabled?: boolean;
  tables?: Array<string>;
}): { deps: WriterInsertDeps; calls: Array<SubmitCall> } {
  const calls: Array<SubmitCall> = [];
  const resolver: TableTargetResolver = createTableTargetResolver(
    (data?.tables ?? ["LogTable"]).map((name: string) => {
      return makeTarget(name);
    }),
  );
  const deps: WriterInsertDeps = {
    resolveTarget: resolver,
    forwardingEnabled: data?.forwardingEnabled ?? false,
    submit: async (
      target: FanInInsertTarget,
      rows: Array<JSONObject>,
      options: {
        dedupToken: string;
        clickhouseSettings?: ClickHouseSettings | undefined;
      },
    ): Promise<FanInSubmitResult> => {
      calls.push({
        tableName: target.model.tableName,
        rows,
        dedupToken: options.dedupToken,
        clickhouseSettings: options.clickhouseSettings,
      });
      return { flushed: data?.flushed ?? Promise.resolve() };
    },
  };
  return { deps, calls };
}

function validBody(overrides?: JSONObject): JSONObject {
  return {
    tableName: "LogTable",
    rows: [{ a: 1 }, { a: 2 }],
    dedupToken: "job-1:LogTable:0",
    ...overrides,
  };
}

describe("InflightGate", () => {
  test("admits up to the cap, then sheds until released", () => {
    const gate: InflightGate = new InflightGate(2);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.inflight).toBe(2);

    gate.release();
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
  });
});

describe("readWriterMaxInflightRequestsFromEnv", () => {
  const saved: string | undefined =
    process.env["TELEMETRY_WRITER_MAX_INFLIGHT_REQUESTS"];

  afterEach(() => {
    if (saved === undefined) {
      delete process.env["TELEMETRY_WRITER_MAX_INFLIGHT_REQUESTS"];
    } else {
      process.env["TELEMETRY_WRITER_MAX_INFLIGHT_REQUESTS"] = saved;
    }
  });

  test("defaults to 100; honors valid overrides; rejects junk", () => {
    delete process.env["TELEMETRY_WRITER_MAX_INFLIGHT_REQUESTS"];
    expect(readWriterMaxInflightRequestsFromEnv()).toBe(100);

    process.env["TELEMETRY_WRITER_MAX_INFLIGHT_REQUESTS"] = "250";
    expect(readWriterMaxInflightRequestsFromEnv()).toBe(250);

    process.env["TELEMETRY_WRITER_MAX_INFLIGHT_REQUESTS"] = "-5";
    expect(readWriterMaxInflightRequestsFromEnv()).toBe(100);

    process.env["TELEMETRY_WRITER_MAX_INFLIGHT_REQUESTS"] = "abc";
    expect(readWriterMaxInflightRequestsFromEnv()).toBe(100);
  });
});

describe("parseWriterInsertRequest", () => {
  test("accepts a well-formed request", () => {
    const parsed: ReturnType<typeof parseWriterInsertRequest> =
      parseWriterInsertRequest(validBody({ clickhouseSettings: { x: 1 } }));
    expect(parsed).toEqual({
      tableName: "LogTable",
      rows: [{ a: 1 }, { a: 2 }],
      dedupToken: "job-1:LogTable:0",
      clickhouseSettings: { x: 1 },
    });
  });

  const badBodies: Array<{ label: string; body: unknown }> = [
    { label: "null body", body: null },
    { label: "array body", body: [] },
    { label: "string body", body: "hi" },
    { label: "missing tableName", body: validBody({ tableName: undefined }) },
    { label: "blank tableName", body: validBody({ tableName: "  " }) },
    { label: "rows not an array", body: validBody({ rows: "rows" }) },
    { label: "row is an array", body: validBody({ rows: [[1]] }) },
    { label: "row is null", body: validBody({ rows: [null] }) },
    { label: "missing dedupToken", body: validBody({ dedupToken: undefined }) },
    { label: "blank dedupToken", body: validBody({ dedupToken: " " }) },
    {
      label: "clickhouseSettings is an array",
      body: validBody({ clickhouseSettings: [1] }),
    },
  ];
  for (const { label, body } of badBodies) {
    test(`rejects ${label}`, () => {
      const parsed: ReturnType<typeof parseWriterInsertRequest> =
        parseWriterInsertRequest(body);
      expect("error" in parsed).toBe(true);
    });
  }
});

describe("handleWriterInsert", () => {
  test("200 after rows durably land; token and settings pass through", async () => {
    const { deps, calls } = makeDeps();
    const outcome: WriterInsertOutcome = await handleWriterInsert(
      validBody({ clickhouseSettings: { async_insert: 1 } }),
      deps,
    );

    expect(outcome.statusCode).toBe(200);
    expect(outcome.body).toEqual({ rowsAccepted: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tableName).toBe("LogTable");
    expect(calls[0]!.dedupToken).toBe("job-1:LogTable:0");
    expect(calls[0]!.clickhouseSettings).toEqual({ async_insert: 1 });
  });

  test("empty rows short-circuit to 200 without submitting", async () => {
    const { deps, calls } = makeDeps();
    const outcome: WriterInsertOutcome = await handleWriterInsert(
      validBody({ rows: [] }),
      deps,
    );
    expect(outcome.statusCode).toBe(200);
    expect(outcome.body).toEqual({ rowsAccepted: 0 });
    expect(calls).toHaveLength(0);
  });

  test("400 on malformed body", async () => {
    const { deps } = makeDeps();
    const outcome: WriterInsertOutcome = await handleWriterInsert(
      { nope: true },
      deps,
    );
    expect(outcome.statusCode).toBe(400);
  });

  test("503 on unknown table (retryable — rolling-upgrade version skew must self-heal)", async () => {
    const { deps, calls } = makeDeps();
    const outcome: WriterInsertOutcome = await handleWriterInsert(
      validBody({ tableName: "NoSuchTable" }),
      deps,
    );
    expect(outcome.statusCode).toBe(503);
    expect(String(outcome.body["message"])).toContain("NoSuchTable");
    expect(calls).toHaveLength(0);
  });

  test("503 when this pod itself forwards to a remote writer (loop guard)", async () => {
    const { deps, calls } = makeDeps({ forwardingEnabled: true });
    const outcome: WriterInsertOutcome = await handleWriterInsert(
      validBody(),
      deps,
    );
    expect(outcome.statusCode).toBe(503);
    expect(calls).toHaveLength(0);
  });

  test("503 when the flush fails on a still-transient error (caller retries)", async () => {
    const flushed: Promise<void> = Promise.reject(
      new FanInInsertError({
        tableName: "LogTable",
        attempts: 6,
        cause: new TransientInsertError("202 after all retries"),
      }),
    );
    flushed.catch(() => {
      // pre-observed
    });
    const { deps } = makeDeps({ flushed });
    const outcome: WriterInsertOutcome = await handleWriterInsert(
      validBody(),
      deps,
    );
    expect(outcome.statusCode).toBe(503);
  });

  test("500 when the flush fails definitively", async () => {
    const flushed: Promise<void> = Promise.reject(
      new FanInInsertError({
        tableName: "LogTable",
        attempts: 1,
        cause: new Error("schema mismatch"),
      }),
    );
    flushed.catch(() => {
      // pre-observed
    });
    const { deps } = makeDeps({ flushed });
    const outcome: WriterInsertOutcome = await handleWriterInsert(
      validBody(),
      deps,
    );
    expect(outcome.statusCode).toBe(500);
    expect(String(outcome.body["message"])).toContain("schema mismatch");
  });
});

describe("createTableTargetResolver", () => {
  test("resolves by exact table name and returns undefined otherwise", () => {
    const resolver: TableTargetResolver = createTableTargetResolver([
      makeTarget("A"),
      makeTarget("B"),
    ]);
    expect(resolver("A")?.model.tableName).toBe("A");
    expect(resolver("B")?.model.tableName).toBe("B");
    expect(resolver("C")).toBeUndefined();
  });
});
