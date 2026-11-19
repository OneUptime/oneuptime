import { describe, expect, test } from "@jest/globals";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import {
  DATA_CIRCUIT_BREAKER_STOP_STATUS_CODE,
  DataCircuitBreakerAnswer,
  DataCircuitBreakerInput,
  DataCircuitBreakerReason,
  DataCircuitBreakerReasonKind,
  DataCircuitBreakerRequest,
  DataCircuitBreakerVerdict,
  MAX_CIRCUIT_BREAKER_REASONS,
  MAX_CIRCUIT_BREAKER_TABLES,
  decideDataCircuitBreaker,
  describeDataCircuitBreakerReason,
  describeLateness,
  formatDataCircuitBreakerAnswer,
  readDataCircuitBreakerReasons,
  readDataCircuitBreakerRequest,
} from "../../../Types/DataObservability/DataCircuitBreaker";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * A CIRCUIT BREAKER'S RULE (#6548): should a pipeline run, given the tables
 * it reads?
 *
 *   - a failing check of a table it reads stops it, always;
 *   - a late table stops it only when late tables do (the pipeline's
 *     setting, or the request's own);
 *   - a table with no checks, a fresh one, one whose rhythm is not known
 *     yet and a view stop nothing: nothing is known against them;
 *   - every reason names its table, and its check or how late it is, the
 *     failing checks first, then the latest table first;
 *   - the request is read strictly: a pipeline or tables, each named as
 *     text, and never more tables than one answer judges.
 */

const ORDERS: string = "11111111-1111-4111-8111-111111111111";
const CUSTOMERS: string = "22222222-2222-4222-8222-222222222222";
const PAYMENTS: string = "33333333-3333-4333-8333-333333333333";
const NOT_NULL: string = "44444444-4444-4444-8444-444444444444";
const UNIQUE: string = "55555555-5555-4555-8555-555555555555";

function input(
  data: Partial<DataCircuitBreakerInput> & { dataAssetId: string },
): DataCircuitBreakerInput {
  return {
    table: "public.orders",
    database: "warehouse",
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    checkCount: 0,
    failingChecks: [],
    ...data,
  };
}

function answer(
  data: Partial<DataCircuitBreakerAnswer> = {},
): Pick<
  DataCircuitBreakerAnswer,
  | "verdict"
  | "reasons"
  | "tables"
  | "notFound"
  | "pipeline"
  | "stopsOnLateTables"
  | "isSwitchedOff"
> {
  return {
    verdict: DataCircuitBreakerVerdict.Go,
    reasons: [],
    tables: [],
    notFound: [],
    pipeline: null,
    stopsOnLateTables: false,
    isSwitchedOff: false,
    ...data,
  };
}

function table(name: string): DataCircuitBreakerAnswer["tables"][number] {
  return {
    dataAssetId: ORDERS,
    table: name,
    database: "warehouse",
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    checkCount: 1,
    failingCheckCount: 0,
  };
}

function thrown(body: unknown): string {
  try {
    readDataCircuitBreakerRequest(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("The request was read, and should have been refused.");
}

describe("what a request asks", () => {
  test("a pipeline alone, by its name", () => {
    expect(
      readDataCircuitBreakerRequest({
        pipeline: "  airflow://prod/orders_daily.load_orders  ",
      }),
    ).toEqual<DataCircuitBreakerRequest>({
      pipeline: "airflow://prod/orders_daily.load_orders",
      tables: [],
      stopsOnLateTables: null,
      isDryRun: false,
      failWithStatusCode: false,
    });
  });

  test("tables alone, trimmed, each once, blank ones left out", () => {
    expect(
      readDataCircuitBreakerRequest({
        tables: [" public.orders", "public.orders", "", "raw.payments "],
      }).tables,
    ).toEqual(["public.orders", "raw.payments"]);
  });

  test("a pipeline and tables together, a dry run, late tables and a status code", () => {
    expect(
      readDataCircuitBreakerRequest({
        pipeline: ORDERS,
        tables: ["public.customers"],
        stopsOnLateTables: true,
        dryRun: true,
        failWithStatusCode: true,
      }),
    ).toEqual<DataCircuitBreakerRequest>({
      pipeline: ORDERS,
      tables: ["public.customers"],
      stopsOnLateTables: true,
      isDryRun: true,
      failWithStatusCode: true,
    });
  });

  test("stopsOnLateTables false is the request's own choice, never the pipeline's", () => {
    expect(
      readDataCircuitBreakerRequest({ pipeline: "a", stopsOnLateTables: false })
        .stopsOnLateTables,
    ).toBe(false);
    expect(
      readDataCircuitBreakerRequest({ pipeline: "a", stopsOnLateTables: null })
        .stopsOnLateTables,
    ).toBeNull();
  });

  test("only true is a dry run, or a status code: a string is not", () => {
    const request: DataCircuitBreakerRequest = readDataCircuitBreakerRequest({
      pipeline: "a",
      dryRun: "true",
      failWithStatusCode: 1,
    });

    expect(request.isDryRun).toBe(false);
    expect(request.failWithStatusCode).toBe(false);
  });

  test.each([
    ["nothing at all", undefined],
    ["an empty body", {}],
    ["a list as the body", ["public.orders"]],
    ["a blank pipeline and no tables", { pipeline: "   ", tables: [] }],
  ])("%s asks nothing, and is refused", (_what: string, body: unknown) => {
    expect(thrown(body)).toBe(
      "Name the pipeline that is about to run, or the tables it reads.",
    );
  });

  test("tables that are not a list are refused", () => {
    expect(thrown({ tables: "public.orders" })).toContain(
      "Name the tables as a list",
    );
  });

  test("a table or pipeline that is not text is refused", () => {
    expect(thrown({ tables: [42] })).toContain("Name each table as text");
    expect(thrown({ pipeline: { id: ORDERS } })).toContain(
      "Name each pipeline as text",
    );
  });

  test("a name longer than any table's is refused", () => {
    expect(thrown({ tables: ["x".repeat(501)] })).toContain(
      "at most 500 characters",
    );
  });

  test(`at most ${MAX_CIRCUIT_BREAKER_TABLES} tables in one request`, () => {
    const tables: Array<string> = Array.from(
      { length: MAX_CIRCUIT_BREAKER_TABLES + 1 },
      (_value: unknown, index: number): string => {
        return `public.table_${index}`;
      },
    );

    expect(thrown({ tables })).toContain(
      `at most ${MAX_CIRCUIT_BREAKER_TABLES} tables`,
    );
    expect(
      readDataCircuitBreakerRequest({ tables: tables.slice(1) }).tables,
    ).toHaveLength(MAX_CIRCUIT_BREAKER_TABLES);
  });

  test("stopsOnLateTables that is not true or false is refused", () => {
    expect(thrown({ pipeline: "a", stopsOnLateTables: "yes" })).toBe(
      "stopsOnLateTables is true or false.",
    );
  });

  test("a stop answers HTTP 412 when asked to", () => {
    expect(DATA_CIRCUIT_BREAKER_STOP_STATUS_CODE).toBe(412);
  });
});

describe("the rule", () => {
  test("no table to judge: go", () => {
    expect(
      decideDataCircuitBreaker({ tables: [], stopsOnLateTables: true }),
    ).toEqual({ verdict: DataCircuitBreakerVerdict.Go, reasons: [] });
  });

  test("a table with no checks stops nothing, however late, while late tables do not stop it", () => {
    expect(
      decideDataCircuitBreaker({
        tables: [
          input({
            dataAssetId: ORDERS,
            freshness: DataAssetFreshness.Late,
            lateBySeconds: 7_200,
          }),
        ],
        stopsOnLateTables: false,
      }).verdict,
    ).toBe(DataCircuitBreakerVerdict.Go);
  });

  test("a failing check stops it, and names the check and its table", () => {
    expect(
      decideDataCircuitBreaker({
        tables: [
          input({
            dataAssetId: ORDERS,
            checkCount: 2,
            failingChecks: [
              { dataCheckId: NOT_NULL, name: "order id is never empty" },
            ],
          }),
        ],
        stopsOnLateTables: false,
      }),
    ).toEqual({
      verdict: DataCircuitBreakerVerdict.Stop,
      reasons: [
        {
          kind: DataCircuitBreakerReasonKind.CheckFailing,
          dataAssetId: ORDERS,
          table: "public.orders",
          database: "warehouse",
          check: "order id is never empty",
          dataCheckId: NOT_NULL,
          lateBySeconds: 0,
        },
      ],
    });
  });

  test("a late table stops it when late tables do, and says how late", () => {
    expect(
      decideDataCircuitBreaker({
        tables: [
          input({
            dataAssetId: CUSTOMERS,
            table: "public.customers",
            freshness: DataAssetFreshness.Late,
            lateBySeconds: 3_600.7,
          }),
        ],
        stopsOnLateTables: true,
      }),
    ).toEqual({
      verdict: DataCircuitBreakerVerdict.Stop,
      reasons: [
        {
          kind: DataCircuitBreakerReasonKind.TableLate,
          dataAssetId: CUSTOMERS,
          table: "public.customers",
          database: "warehouse",
          check: null,
          dataCheckId: null,
          lateBySeconds: 3_600,
        },
      ],
    });
  });

  test.each([
    DataAssetFreshness.Fresh,
    DataAssetFreshness.Unknown,
    DataAssetFreshness.NotApplicable,
  ])(
    "a table that is %s never stops it, even while late tables do",
    (freshness: DataAssetFreshness) => {
      expect(
        decideDataCircuitBreaker({
          tables: [input({ dataAssetId: ORDERS, freshness, checkCount: 3 })],
          stopsOnLateTables: true,
        }).verdict,
      ).toBe(DataCircuitBreakerVerdict.Go);
    },
  );

  test("every reason, failing checks first by table and check, then late tables, the latest first", () => {
    const decision: ReturnType<typeof decideDataCircuitBreaker> =
      decideDataCircuitBreaker({
        tables: [
          input({
            dataAssetId: PAYMENTS,
            table: "raw.payments",
            freshness: DataAssetFreshness.Late,
            lateBySeconds: 600,
          }),
          input({
            dataAssetId: ORDERS,
            table: "public.orders",
            freshness: DataAssetFreshness.Late,
            lateBySeconds: 86_400,
            failingChecks: [
              { dataCheckId: UNIQUE, name: "unique order id" },
              { dataCheckId: NOT_NULL, name: "not null order id" },
            ],
          }),
          input({
            dataAssetId: CUSTOMERS,
            table: "public.customers",
            failingChecks: [{ dataCheckId: NOT_NULL, name: "a check" }],
          }),
        ],
        stopsOnLateTables: true,
      });

    expect(decision.verdict).toBe(DataCircuitBreakerVerdict.Stop);
    expect(
      decision.reasons.map((reason: DataCircuitBreakerReason): string => {
        return `${reason.kind}: ${reason.table}${reason.check ? ` / ${reason.check}` : ""}`;
      }),
    ).toEqual([
      "Check Failing: public.customers / a check",
      "Check Failing: public.orders / not null order id",
      "Check Failing: public.orders / unique order id",
      "Table Late: public.orders",
      "Table Late: raw.payments",
    ]);
  });

  test(`at most ${MAX_CIRCUIT_BREAKER_REASONS} reasons, the failing checks kept first`, () => {
    const decision: ReturnType<typeof decideDataCircuitBreaker> =
      decideDataCircuitBreaker({
        tables: Array.from(
          { length: MAX_CIRCUIT_BREAKER_REASONS + 5 },
          (_value: unknown, index: number): DataCircuitBreakerInput => {
            return input({
              dataAssetId: ORDERS,
              table: `public.t${String(index).padStart(2, "0")}`,
              freshness: DataAssetFreshness.Late,
              lateBySeconds: 60,
              failingChecks: [{ dataCheckId: NOT_NULL, name: "check" }],
            });
          },
        ),
        stopsOnLateTables: true,
      });

    expect(decision.reasons).toHaveLength(MAX_CIRCUIT_BREAKER_REASONS);
    expect(
      decision.reasons.every((reason: DataCircuitBreakerReason): boolean => {
        return reason.kind === DataCircuitBreakerReasonKind.CheckFailing;
      }),
    ).toBe(true);
  });
});

describe("the answer in words", () => {
  test("how late, as a sentence says it", () => {
    expect(describeLateness(30)).toBe("1 minute");
    expect(describeLateness(60 * 12)).toBe("12 minutes");
    expect(describeLateness(3_600)).toBe("1 hour");
    expect(describeLateness(3_600 * 6)).toBe("6 hours");
    expect(describeLateness(86_400 * 3)).toBe("3 days");
  });

  test("a reason in a sentence, with its database", () => {
    expect(
      describeDataCircuitBreakerReason({
        kind: DataCircuitBreakerReasonKind.CheckFailing,
        dataAssetId: ORDERS,
        table: "public.orders",
        database: "warehouse",
        check: "order id is never empty",
        dataCheckId: NOT_NULL,
        lateBySeconds: 0,
      }),
    ).toBe(
      "The check order id is never empty is failing on public.orders (warehouse).",
    );
    expect(
      describeDataCircuitBreakerReason({
        kind: DataCircuitBreakerReasonKind.TableLate,
        dataAssetId: CUSTOMERS,
        table: "public.customers",
        database: null,
        check: null,
        dataCheckId: null,
        lateBySeconds: 7_200,
      }),
    ).toBe("public.customers is late by 2 hours.");
  });

  test("a stop says so first, then every reason", () => {
    expect(
      formatDataCircuitBreakerAnswer(
        answer({
          verdict: DataCircuitBreakerVerdict.Stop,
          pipeline: {
            dataPipelineId: ORDERS,
            name: "orders_daily.load_orders",
            namespace: "airflow://prod",
          },
          reasons: [
            {
              kind: DataCircuitBreakerReasonKind.CheckFailing,
              dataAssetId: ORDERS,
              table: "public.orders",
              database: null,
              check: "unique order id",
              dataCheckId: UNIQUE,
              lateBySeconds: 0,
            },
          ],
          tables: [table("public.orders")],
        }),
      ),
    ).toBe(
      "Stop: orders_daily.load_orders should not run. The check unique order id is failing on public.orders.",
    );
  });

  test("a go says what was judged", () => {
    expect(
      formatDataCircuitBreakerAnswer(
        answer({ tables: [table("public.orders")] }),
      ),
    ).toBe(
      "Go: the pipeline may run. The table it reads, public.orders, has no failing check.",
    );
    expect(
      formatDataCircuitBreakerAnswer(
        answer({
          tables: [table("public.orders")],
          stopsOnLateTables: true,
        }),
      ),
    ).toBe(
      "Go: the pipeline may run. The table it reads, public.orders, has no failing check and is not late.",
    );
    expect(
      formatDataCircuitBreakerAnswer(
        answer({
          tables: [table("public.orders"), table("public.customers")],
          stopsOnLateTables: true,
        }),
      ),
    ).toBe(
      "Go: the pipeline may run. None of the 2 tables it reads has a failing check or is late.",
    );
  });

  test("a go that judged nothing says so, never that the tables passed", () => {
    expect(formatDataCircuitBreakerAnswer(answer())).toBe(
      "Go: the pipeline may run, but OneUptime knows none of the tables it reads yet, so nothing was checked.",
    );
  });

  test("names it could not find are told back, never taken as tables that passed", () => {
    expect(
      formatDataCircuitBreakerAnswer(
        answer({
          tables: [table("public.orders")],
          notFound: ["public.ordrs", "raw.unknown"],
        }),
      ),
    ).toContain(
      "Not found, so not checked: public.ordrs, raw.unknown. Check each name, and that the API key may read the table.",
    );
  });

  test("switched off on the server: go, having checked nothing", () => {
    expect(
      formatDataCircuitBreakerAnswer(
        answer({ isSwitchedOff: true, notFound: ["anything"] }),
      ),
    ).toBe(
      "Go: Data Observability is switched off on this server, so nothing was checked.",
    );
  });
});

describe("the reasons a pipeline keeps, read back", () => {
  const reason: DataCircuitBreakerReason = {
    kind: DataCircuitBreakerReasonKind.CheckFailing,
    dataAssetId: ORDERS,
    table: "public.orders",
    database: "warehouse",
    check: "unique order id",
    dataCheckId: UNIQUE,
    lateBySeconds: 0,
  };

  test("a reason reads back as it was kept", () => {
    expect(readDataCircuitBreakerReasons([reason])).toEqual([reason]);
  });

  test("whatever is not a reason is left out", () => {
    expect(
      readDataCircuitBreakerReasons([
        null,
        "a string",
        ["a list"],
        { ...reason, kind: "Something Else" },
        { ...reason, dataAssetId: "not-an-id" },
        { ...reason, table: 7 },
        reason,
      ]),
    ).toEqual([reason]);
  });

  test("its loose fields are made safe: no stray ids, no negative lateness", () => {
    expect(
      readDataCircuitBreakerReasons([
        {
          kind: DataCircuitBreakerReasonKind.TableLate,
          dataAssetId: CUSTOMERS,
          table: "public.customers",
          database: 3,
          check: ["x"],
          dataCheckId: "nope",
          lateBySeconds: -40,
        },
        {
          kind: DataCircuitBreakerReasonKind.TableLate,
          dataAssetId: PAYMENTS,
          table: "raw.payments",
          lateBySeconds: "90.9",
        },
      ]),
    ).toEqual([
      {
        kind: DataCircuitBreakerReasonKind.TableLate,
        dataAssetId: CUSTOMERS,
        table: "public.customers",
        database: null,
        check: null,
        dataCheckId: null,
        lateBySeconds: 0,
      },
      {
        kind: DataCircuitBreakerReasonKind.TableLate,
        dataAssetId: PAYMENTS,
        table: "raw.payments",
        database: null,
        check: null,
        dataCheckId: null,
        lateBySeconds: 90,
      },
    ]);
  });

  test(`a column holding anything but a list holds none, and at most ${MAX_CIRCUIT_BREAKER_REASONS} are read`, () => {
    expect(readDataCircuitBreakerReasons(null)).toEqual([]);
    expect(readDataCircuitBreakerReasons({ reasons: [reason] })).toEqual([]);
    expect(
      readDataCircuitBreakerReasons(
        Array.from({ length: MAX_CIRCUIT_BREAKER_REASONS + 3 }, () => {
          return reason;
        }),
      ),
    ).toHaveLength(MAX_CIRCUIT_BREAKER_REASONS);
  });
});
