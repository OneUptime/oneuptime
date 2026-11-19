import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataCheckService from "../../../../Server/Services/DataCheckService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import DataCircuitBreaker from "../../../../Server/Utils/DataObservability/DataCircuitBreaker";
import DataObservabilityAttentionReader from "../../../../Server/Utils/DataObservability/DataObservabilityAttentionReader";
import DataObservabilityReadScope, {
  DataObservabilityScope,
  withConditions,
} from "../../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import DataTableLineageReader, {
  DataPipelineLineageReader,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { DataAssetFreshness } from "../../../../Types/DataObservability/DataAssetFreshness";
import {
  DataCircuitBreakerAnswer,
  DataCircuitBreakerReason,
  DataCircuitBreakerReasonKind,
  DataCircuitBreakerRequest,
  DataCircuitBreakerVerdict,
} from "../../../../Types/DataObservability/DataCircuitBreaker";
import { DataPipelineCircuitBreakerState } from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataCheckHealth,
  DataCheckHealthAnswer,
} from "../../../../Types/DataObservability/DataObservabilityAttention";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProducts";

/*
 * THE CIRCUIT BREAKER, ANSWERED (#6548).
 *
 * A pipeline step asks, with an API key, before it runs: go, or stop?
 *
 *   orders_daily (airflow://prod) reads public.orders and public.customers,
 *   and writes marts.revenue.
 *   public.orders has a failing check and a passing one; public.customers
 *   is late, and its one check could not run; raw.payments has no check.
 *
 * What it reads is what its caller may read; a pipeline named by a name two
 * namespaces share is refused; a name that matches no table is told back,
 * never taken as a table that passed; alerts that cannot be read throw; a
 * request that names a pipeline keeps its answer on it, a dry run keeps
 * nothing; and while Data Observability is switched off the answer is go,
 * having read and kept nothing.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const EARLIER: Date = new Date("2026-11-19T09:00:00.000Z");

function id(kind: number, index: number): string {
  return `${kind.toString().padStart(8, "0")}-0000-4000-8000-${index
    .toString()
    .padStart(12, "0")}`;
}

const ORDERS: string = id(1, 1);
const CUSTOMERS: string = id(1, 2);
const PAYMENTS: string = id(1, 3);
const REVENUE: string = id(1, 4);
const GONE: string = id(1, 5);

const ORDERS_DAILY: string = id(2, 1);
const LOAD_PROD: string = id(2, 2);
const LOAD_STAGING: string = id(2, 3);

const UNIQUE_CHECK: string = id(3, 1);
const NOT_NULL_CHECK: string = id(3, 2);
const CUSTOMERS_CHECK: string = id(3, 3);

const READER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  apiKeyId: new ObjectID(id(9, 1)),
} as DatabaseCommonInteractionProps;

interface TableRow {
  id: string;
  assetKey: string;
  name: string;
  isDropped?: boolean;
  lastChangedAt: Date;
  updateIntervalInSeconds: number;
}

const TABLES: Array<TableRow> = [
  // Changed an hour ago, every hour: fresh.
  {
    id: ORDERS,
    assetKey: "public.orders",
    name: "orders",
    lastChangedAt: new Date("2026-11-19T11:00:00.000Z"),
    updateIntervalInSeconds: 3_600,
  },
  // A daily table not changed for three days: late.
  {
    id: CUSTOMERS,
    assetKey: "public.customers",
    name: "customers",
    lastChangedAt: new Date("2026-11-16T12:00:00.000Z"),
    updateIntervalInSeconds: 86_400,
  },
  {
    id: PAYMENTS,
    assetKey: "raw.payments",
    name: "payments",
    lastChangedAt: new Date("2026-11-19T11:30:00.000Z"),
    updateIntervalInSeconds: 3_600,
  },
  {
    id: REVENUE,
    assetKey: "marts.revenue",
    name: "revenue",
    lastChangedAt: new Date("2026-11-19T11:30:00.000Z"),
    updateIntervalInSeconds: 3_600,
  },
  {
    id: GONE,
    assetKey: "public.gone",
    name: "gone",
    isDropped: true,
    lastChangedAt: new Date("2026-10-01T00:00:00.000Z"),
    updateIntervalInSeconds: 3_600,
  },
];

interface CheckRow {
  id: string;
  name: string;
  dataAssetId: string;
  health: DataCheckHealth;
}

const CHECKS: Array<CheckRow> = [
  {
    id: UNIQUE_CHECK,
    name: "unique order id",
    dataAssetId: ORDERS,
    health: DataCheckHealth.Failing,
  },
  {
    id: NOT_NULL_CHECK,
    name: "order id is never empty",
    dataAssetId: ORDERS,
    health: DataCheckHealth.Passing,
  },
  {
    id: CUSTOMERS_CHECK,
    name: "customer email looks like one",
    dataAssetId: CUSTOMERS,
    health: DataCheckHealth.CouldNotRun,
  },
];

interface PipelineRow {
  id: string;
  jobName: string;
  jobNamespace: string;
  circuitBreakerStopsOnLateTables?: boolean;
  circuitBreakerStoppedAt?: Date | null;
  circuitBreakerCheckedAt?: Date | null;
  circuitBreakerReasons?: Array<DataCircuitBreakerReason> | null;
}

let pipelines: Array<PipelineRow>;
let scope: DataObservabilityScope;
let pipelineQueries: Array<Record<string, unknown>>;
let assetQueries: Array<Record<string, unknown>>;
let checkQueries: Array<Record<string, unknown>>;
let writes: Array<{ id: string; data: Record<string, unknown> }>;
let healthAsked: Array<{
  reader: DatabaseCommonInteractionProps;
  throwsWhenAlertsUnreadable: boolean | undefined;
  checks: Array<string>;
}>;
let scopedReaderScopes: Array<DataObservabilityScope | undefined>;
let offReason: ServerProductOffReason | null;

// What a raw condition (findWithSameText, QueryHelper.any) was handed.
function parameterOf(value: unknown): unknown {
  if (!(value instanceof FindOperator)) {
    return undefined;
  }

  const parameters: Record<string, unknown> =
    (value as FindOperator<unknown>).objectLiteralParameters || {};

  return Object.values(parameters)[0];
}

// The text a findWithSameText condition looks for, lower case.
function sameText(value: unknown): string | null {
  const parameter: unknown = parameterOf(value);

  return typeof parameter === "string" ? parameter : null;
}

// The ids a condition names: one ID, or any of a list.
function idsIn(value: unknown): Array<string> | null {
  if (value instanceof Includes) {
    return value.values.map((entry: unknown): string => {
      return String(entry);
    });
  }

  if (value instanceof ObjectID) {
    return [value.toString()];
  }

  const parameter: unknown = parameterOf(value);

  return Array.isArray(parameter)
    ? parameter.map((entry: unknown): string => {
        return String(entry);
      })
    : null;
}

function pipelineModel(row: PipelineRow): DataPipeline {
  const model: DataPipeline = new DataPipeline();

  model._id = row.id;
  model.jobName = row.jobName;
  model.jobNamespace = row.jobNamespace;
  model.pipelineKey = `${row.jobNamespace}/${row.jobName}`;
  model.circuitBreakerStopsOnLateTables =
    row.circuitBreakerStopsOnLateTables === true;
  model.circuitBreakerStoppedAt = row.circuitBreakerStoppedAt || undefined!;
  model.circuitBreakerCheckedAt = row.circuitBreakerCheckedAt || undefined!;
  model.circuitBreakerReasons = row.circuitBreakerReasons || undefined!;

  return model;
}

function tableModel(row: TableRow): DataAsset {
  const model: DataAsset = new DataAsset();

  model._id = row.id;
  model.assetKey = row.assetKey;
  model.name = row.name;
  model.dataStoreName = "warehouse";
  model.assetKind = DataAssetKind.Table;
  model.lastChangedAt = row.lastChangedAt;
  model.updateIntervalInSeconds = row.updateIntervalInSeconds;
  model.isDropped = row.isDropped === true;

  return model;
}

function arrange(): void {
  pipelines = [
    {
      id: ORDERS_DAILY,
      jobName: "orders_daily",
      jobNamespace: "airflow://prod",
    },
    { id: LOAD_PROD, jobName: "load", jobNamespace: "airflow://prod" },
    { id: LOAD_STAGING, jobName: "load", jobNamespace: "airflow://staging" },
  ];
  scope = DataObservabilityReadScope.wholeProject(PROJECT);
  pipelineQueries = [];
  assetQueries = [];
  checkQueries = [];
  writes = [];
  healthAsked = [];
  scopedReaderScopes = [];
  offReason = null;

  jest.spyOn(ServerProducts, "getOffReason").mockImplementation((async () => {
    return offReason;
  }) as never);
  jest
    .spyOn(DataObservabilityReadScope, "get")
    .mockImplementation((async () => {
      return scope;
    }) as never);

  jest.spyOn(DataPipelineService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }) => {
    pipelineQueries.push(data.query);
    const byId: Array<string> | null = idsIn(data.query["_id"]);
    const key: string | null = sameText(data.query["pipelineKey"]);
    const name: string | null = sameText(data.query["jobName"]);

    return pipelines
      .filter((row: PipelineRow): boolean => {
        if (byId) {
          return byId.includes(row.id);
        }

        if (key !== null) {
          return `${row.jobNamespace}/${row.jobName}`.toLowerCase() === key;
        }

        return name !== null && row.jobName.toLowerCase() === name;
      })
      .map(pipelineModel);
  }) as never);
  jest
    .spyOn(DataPipelineService, "findOneBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      pipelineQueries.push(data.query);
      const byId: Array<string> = idsIn(data.query["_id"]) || [];
      const row: PipelineRow | undefined = pipelines.find(
        (each: PipelineRow): boolean => {
          return byId.includes(each.id);
        },
      );

      return row ? pipelineModel(row) : null;
    }) as never);
  jest
    .spyOn(DataPipelineService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      writes.push({ id: data.id.toString(), data: data.data });
    }) as never);

  jest
    .spyOn(DataTableLineageReader, "getScopedDatabaseReader")
    .mockImplementation((async (
      _projectId: ObjectID,
      _reader: DatabaseCommonInteractionProps | null,
      readScope?: DataObservabilityScope,
    ) => {
      scopedReaderScopes.push(readScope);
      return {} as DataPipelineLineageReader;
    }) as never);
  jest
    .spyOn(DataTableLineageReader, "readPipelineTables")
    .mockImplementation((async (
      _reader: DataPipelineLineageReader,
      dataPipelineId: string,
    ) => {
      return dataPipelineId === ORDERS_DAILY
        ? {
            read: new Map<string, Date | null>([
              [ORDERS, NOW],
              [CUSTOMERS, NOW],
            ]),
            written: new Map<string, Date | null>([[REVENUE, NOW]]),
            isTruncated: false,
          }
        : { read: new Map(), written: new Map(), isTruncated: false };
    }) as never);

  jest.spyOn(DataAssetService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }) => {
    assetQueries.push(data.query);
    const byId: Array<string> | null = idsIn(data.query["_id"]);
    const key: string | null = sameText(data.query["assetKey"]);
    const name: string | null = sameText(data.query["name"]);

    return TABLES.filter((row: TableRow): boolean => {
      if (data.query["isDropped"] === false && row.isDropped) {
        return false;
      }

      if (byId) {
        return byId.includes(row.id);
      }

      if (key !== null) {
        return row.assetKey.toLowerCase() === key;
      }

      return name !== null && row.name.toLowerCase() === name;
    }).map(tableModel);
  }) as never);

  jest.spyOn(DataCheckService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }) => {
    checkQueries.push(data.query);
    const tables: Array<string> = idsIn(data.query["dataAssetId"]) || [];

    return CHECKS.filter((row: CheckRow): boolean => {
      return tables.includes(row.dataAssetId);
    }).map((row: CheckRow): DataCheck => {
      const model: DataCheck = new DataCheck();
      model._id = row.id;
      model.name = row.name;
      model.dataAssetId = new ObjectID(row.dataAssetId);
      return model;
    });
  }) as never);

  jest
    .spyOn(DataObservabilityAttentionReader, "getCheckHealth")
    .mockImplementation((async (data: {
      reader: DatabaseCommonInteractionProps;
      checks: Array<DataCheck>;
      throwsWhenAlertsUnreadable?: boolean;
    }) => {
      healthAsked.push({
        reader: data.reader,
        throwsWhenAlertsUnreadable: data.throwsWhenAlertsUnreadable,
        checks: data.checks.map((check: DataCheck): string => {
          return check.id!.toString();
        }),
      });

      const answers: Map<string, DataCheckHealthAnswer> = new Map();

      for (const check of data.checks) {
        const row: CheckRow | undefined = CHECKS.find(
          (each: CheckRow): boolean => {
            return each.id === check.id!.toString();
          },
        );

        answers.set(check.id!.toString(), {
          health: row?.health || DataCheckHealth.Waiting,
          alert: null,
        });
      }

      return answers;
    }) as never);
}

function request(
  data: Partial<DataCircuitBreakerRequest>,
): DataCircuitBreakerRequest {
  return {
    pipeline: null,
    tables: [],
    stopsOnLateTables: null,
    isDryRun: false,
    failWithStatusCode: false,
    ...data,
  };
}

async function ask(
  data: Partial<DataCircuitBreakerRequest>,
): Promise<DataCircuitBreakerAnswer> {
  return await DataCircuitBreaker.check({
    projectId: PROJECT,
    request: request(data),
    props: READER,
    now: NOW,
  });
}

function reasonsOf(answer: DataCircuitBreakerAnswer): Array<string> {
  return answer.reasons.map((reason: DataCircuitBreakerReason): string => {
    return `${reason.kind}: ${reason.table}${reason.check ? ` / ${reason.check}` : ""}`;
  });
}

beforeEach(() => {
  arrange();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a pipeline asks before it runs", () => {
  test("named by its namespace/name: the tables it reads are judged, a failing check stops it, and the stop is kept on it", async () => {
    const answer: DataCircuitBreakerAnswer = await ask({
      pipeline: "airflow://prod/orders_daily",
    });

    expect(answer.verdict).toBe(DataCircuitBreakerVerdict.Stop);
    expect(reasonsOf(answer)).toEqual([
      "Check Failing: public.orders / unique order id",
    ]);
    expect(answer.reasons[0]).toMatchObject({
      dataAssetId: ORDERS,
      dataCheckId: UNIQUE_CHECK,
      database: "warehouse",
    });
    // What it writes is its output, never an input to judge.
    expect(
      answer.tables.map((table: DataCircuitBreakerAnswer["tables"][number]) => {
        return table.table;
      }),
    ).toEqual(["public.customers", "public.orders"]);
    expect(answer.tables[1]).toMatchObject({
      checkCount: 2,
      failingCheckCount: 1,
      freshness: DataAssetFreshness.Fresh,
    });
    expect(answer.pipeline).toEqual({
      dataPipelineId: ORDERS_DAILY,
      name: "orders_daily",
      namespace: "airflow://prod",
    });
    expect(answer.isRecorded).toBe(true);
    expect(answer.isSwitchedOff).toBe(false);
    expect(answer.checkedAt).toBe(NOW.toISOString());
    expect(answer.answer).toBe(
      "Stop: orders_daily should not run. The check unique order id is failing on public.orders (warehouse).",
    );

    expect(writes).toEqual([
      {
        id: ORDERS_DAILY,
        data: {
          circuitBreakerCheckedAt: NOW,
          circuitBreakerStoppedAt: NOW,
          circuitBreakerReasons: answer.reasons,
        },
      },
    ]);
  });

  test("named by its ID, or its name alone, it is the same pipeline", async () => {
    expect(
      (await ask({ pipeline: ORDERS_DAILY })).pipeline?.dataPipelineId,
    ).toBe(ORDERS_DAILY);
    expect(
      (await ask({ pipeline: "ORDERS_DAILY" })).pipeline?.dataPipelineId,
    ).toBe(ORDERS_DAILY);
  });

  test("a late table it reads stops it once its setting says late tables do", async () => {
    pipelines[0]!.circuitBreakerStopsOnLateTables = true;

    const answer: DataCircuitBreakerAnswer = await ask({
      pipeline: "orders_daily",
    });

    expect(answer.stopsOnLateTables).toBe(true);
    expect(reasonsOf(answer)).toEqual([
      "Check Failing: public.orders / unique order id",
      "Table Late: public.customers",
    ]);
    expect(answer.reasons[1]!.lateBySeconds).toBe(86_400);
  });

  test("the request's own word on late tables wins over the pipeline's setting", async () => {
    pipelines[0]!.circuitBreakerStopsOnLateTables = true;

    expect(
      (await ask({ pipeline: "orders_daily", stopsOnLateTables: false }))
        .stopsOnLateTables,
    ).toBe(false);
    expect(
      reasonsOf(
        await ask({ pipeline: "orders_daily", stopsOnLateTables: false }),
      ),
    ).toEqual(["Check Failing: public.orders / unique order id"]);
  });

  test("a check that could not run stops nothing: nothing is known against it", async () => {
    const answer: DataCircuitBreakerAnswer = await ask({
      tables: ["public.customers"],
    });

    expect(answer.verdict).toBe(DataCircuitBreakerVerdict.Go);
    expect(answer.tables[0]).toMatchObject({
      table: "public.customers",
      checkCount: 1,
      failingCheckCount: 0,
      freshness: DataAssetFreshness.Late,
    });
  });

  test("a name two namespaces share is refused with both, never guessed", async () => {
    await expect(ask({ pipeline: "load" })).rejects.toThrow(BadDataException);
    await expect(ask({ pipeline: "load" })).rejects.toThrow(
      "More than one pipeline is named load: airflow://prod/load, airflow://staging/load. Name it with its namespace, as namespace/name, or by its ID.",
    );
    expect(
      (await ask({ pipeline: "airflow://staging/load" })).pipeline
        ?.dataPipelineId,
    ).toBe(LOAD_STAGING);
  });

  test("a pipeline nobody knows is refused, with how to name it", async () => {
    await expect(ask({ pipeline: "nightly_export" })).rejects.toThrow(
      "No pipeline named nightly_export was found.",
    );
    expect(writes).toEqual([]);
  });

  test("a pipeline whose lineage OneUptime has not seen goes, saying nothing was checked", async () => {
    const answer: DataCircuitBreakerAnswer = await ask({
      pipeline: "airflow://prod/load",
    });

    expect(answer.verdict).toBe(DataCircuitBreakerVerdict.Go);
    expect(answer.tables).toEqual([]);
    expect(answer.answer).toBe(
      "Go: load may run, but OneUptime knows none of the tables it reads yet, so nothing was checked.",
    );
  });
});

describe("the tables a request names", () => {
  test("by schema.table key, by name alone, by ID - together with the pipeline's own", async () => {
    const answer: DataCircuitBreakerAnswer = await ask({
      tables: ["raw.payments", "Customers", ORDERS],
    });

    expect(
      answer.tables.map((table: DataCircuitBreakerAnswer["tables"][number]) => {
        return table.dataAssetId;
      }),
    ).toEqual([CUSTOMERS, ORDERS, PAYMENTS]);
    expect(answer.notFound).toEqual([]);
    expect(answer.verdict).toBe(DataCircuitBreakerVerdict.Stop);
  });

  test("a table with no checks goes", async () => {
    const answer: DataCircuitBreakerAnswer = await ask({
      tables: ["raw.payments"],
    });

    expect(answer.verdict).toBe(DataCircuitBreakerVerdict.Go);
    expect(answer.tables[0]).toMatchObject({ checkCount: 0 });
    expect(answer.answer).toBe(
      "Go: the pipeline may run. The table it reads, raw.payments, has no failing check.",
    );
  });

  test("a name that matches no table, or only a dropped one, is told back as not found", async () => {
    const answer: DataCircuitBreakerAnswer = await ask({
      tables: ["public.ordrs", "public.gone", "raw.payments"],
    });

    expect(answer.notFound).toEqual(["public.ordrs", "public.gone"]);
    expect(answer.tables).toHaveLength(1);
    expect(answer.answer).toContain(
      "Not found, so not checked: public.ordrs, public.gone.",
    );
  });

  test("tables alone keep nothing: no pipeline was named", async () => {
    const answer: DataCircuitBreakerAnswer = await ask({
      tables: ["public.orders"],
    });

    expect(answer.verdict).toBe(DataCircuitBreakerVerdict.Stop);
    expect(answer.isRecorded).toBe(false);
    expect(writes).toEqual([]);
  });

  test("a pipeline and tables together judge both", async () => {
    const answer: DataCircuitBreakerAnswer = await ask({
      pipeline: "airflow://prod/load",
      tables: ["public.orders"],
    });

    expect(reasonsOf(answer)).toEqual([
      "Check Failing: public.orders / unique order id",
    ]);
    expect(writes[0]!.id).toBe(LOAD_PROD);
  });
});

describe("what is kept on the pipeline", () => {
  test("a go clears the stop and its reasons, and says when it was asked", async () => {
    pipelines[1]!.circuitBreakerStoppedAt = EARLIER;

    await ask({ pipeline: "airflow://prod/load" });

    expect(writes).toEqual([
      {
        id: LOAD_PROD,
        data: {
          circuitBreakerCheckedAt: NOW,
          circuitBreakerStoppedAt: null,
          circuitBreakerReasons: null,
        },
      },
    ]);
  });

  test("a stop of a pipeline already stopped keeps when it first stopped, with the latest reasons", async () => {
    pipelines[0]!.circuitBreakerStoppedAt = EARLIER;

    await ask({ pipeline: "orders_daily" });

    expect(writes[0]!.data["circuitBreakerStoppedAt"]).toBe(EARLIER);
    expect(writes[0]!.data["circuitBreakerCheckedAt"]).toBe(NOW);
    expect(
      (writes[0]!.data["circuitBreakerReasons"] as Array<unknown>).length,
    ).toBe(1);
  });

  test("a dry run answers the same, and keeps nothing", async () => {
    const answer: DataCircuitBreakerAnswer = await ask({
      pipeline: "orders_daily",
      isDryRun: true,
    });

    expect(answer.verdict).toBe(DataCircuitBreakerVerdict.Stop);
    expect(answer.isRecorded).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("what its caller may read", () => {
  test("how each check stands is read by the alerts the caller may see, and unreadable alerts throw", async () => {
    await ask({ tables: ["public.orders"] });

    expect(healthAsked).toEqual([
      {
        reader: READER,
        throwsWhenAlertsUnreadable: true,
        checks: [UNIQUE_CHECK, NOT_NULL_CHECK],
      },
    ]);
  });

  test("a run is never let through because the alerts could not be read", async () => {
    jest
      .spyOn(DataObservabilityAttentionReader, "getCheckHealth")
      .mockRejectedValue(new Error("Alert table is unreadable") as never);

    await expect(ask({ pipeline: "orders_daily" })).rejects.toThrow(
      "Alert table is unreadable",
    );
    expect(writes).toEqual([]);
  });

  test("a narrowed caller's every read carries its grants, and its lineage is the scoped one", async () => {
    const owned: ReturnType<typeof QueryHelper.any> = QueryHelper.any([ORDERS]);
    scope = {
      isWholeProject: false,
      assetQuery: { projectId: PROJECT, _id: owned },
      checkQuery: { projectId: PROJECT, dataAssetId: owned },
      pipelineQuery: { projectId: PROJECT, ownerOnly: true } as never,
    };
    // The grant reaches public.orders: what the database hands back for it.
    jest.spyOn(DataAssetService, "findBy").mockImplementation((async (data: {
      query: Record<string, unknown>;
    }) => {
      assetQueries.push(data.query);
      return [tableModel(TABLES[0]!)];
    }) as never);
    jest.spyOn(DataCheckService, "findBy").mockImplementation((async (data: {
      query: Record<string, unknown>;
    }) => {
      checkQueries.push(data.query);
      const check: DataCheck = new DataCheck();
      check._id = UNIQUE_CHECK;
      check.name = "unique order id";
      check.dataAssetId = new ObjectID(ORDERS);
      return [check];
    }) as never);

    const answer: DataCircuitBreakerAnswer = await ask({
      pipeline: "orders_daily",
      tables: ["public.orders"],
    });

    expect(answer.verdict).toBe(DataCircuitBreakerVerdict.Stop);
    expect(pipelineQueries[0]).toEqual(
      withConditions<DataPipeline>(scope.pipelineQuery, {
        pipelineKey: pipelineQueries[0]!["pipelineKey"],
      } as never),
    );
    expect(pipelineQueries[0]!["ownerOnly"]).toBe(true);
    expect(scopedReaderScopes).toEqual([scope]);

    // The tables named and judged are read among those the grants reach: the grant's id condition kept, ANDed with the route's.
    expect(assetQueries.length).toBeGreaterThan(0);

    for (const query of assetQueries) {
      expect(query["projectId"]).toBe(PROJECT);
      expect(query["_id"]).toBeDefined();
      expect(query["isDropped"]).toBe(false);
    }

    // Named by key: the grant's own condition, as it was.
    expect(assetQueries[0]!["_id"]).toBe(owned);
    // Read by id: the grant's condition ANDed with the route's, never replaced by it.
    expect(assetQueries[assetQueries.length - 1]!["_id"]).not.toBe(owned);

    // Its checks among the checks the grants reach, a reconciliation's left out.
    expect(checkQueries[0]!["projectId"]).toBe(PROJECT);
    expect(checkQueries[0]!["dataAssetId"]).toBeDefined();
    expect(checkQueries[0]!["dataAssetId"]).not.toBe(owned);
    expect(checkQueries[0]!["dataReconciliationId"]).toBeDefined();
  });

  test("another project's pipeline is not found: every read is the caller's project's", async () => {
    await ask({ pipeline: "orders_daily" });

    for (const query of [
      ...pipelineQueries,
      ...assetQueries,
      ...checkQueries,
    ]) {
      expect(query["projectId"]).toBe(PROJECT);
    }
  });
});

describe("switched off on the server", () => {
  test("goes, having read and kept nothing", async () => {
    offReason = "Admin" as unknown as ServerProductOffReason;

    const answer: DataCircuitBreakerAnswer = await ask({
      pipeline: "orders_daily",
      tables: ["public.orders"],
      stopsOnLateTables: true,
    });

    expect(answer).toMatchObject({
      verdict: DataCircuitBreakerVerdict.Go,
      reasons: [],
      tables: [],
      notFound: [],
      pipeline: null,
      isRecorded: false,
      isSwitchedOff: true,
      stopsOnLateTables: true,
    });
    expect(answer.answer).toBe(
      "Go: Data Observability is switched off on this server, so nothing was checked.",
    );
    expect(pipelineQueries).toEqual([]);
    expect(assetQueries).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe("how a pipeline's circuit breaker stands, for its page", () => {
  const ON_ORDERS: DataCircuitBreakerReason = {
    kind: DataCircuitBreakerReasonKind.CheckFailing,
    dataAssetId: ORDERS,
    table: "public.orders",
    database: "warehouse",
    check: "unique order id",
    dataCheckId: UNIQUE_CHECK,
    lateBySeconds: 0,
  };
  const ON_CUSTOMERS: DataCircuitBreakerReason = {
    kind: DataCircuitBreakerReasonKind.TableLate,
    dataAssetId: CUSTOMERS,
    table: "public.customers",
    database: "warehouse",
    check: null,
    dataCheckId: null,
    lateBySeconds: 3_600,
  };

  async function state(): Promise<DataPipelineCircuitBreakerState | null> {
    return await DataCircuitBreaker.readState({
      projectId: PROJECT,
      dataPipelineId: new ObjectID(ORDERS_DAILY),
      props: READER,
    });
  }

  test("stopped: since when, and every reason, for a reader of the whole project", async () => {
    pipelines[0] = {
      ...pipelines[0]!,
      circuitBreakerStopsOnLateTables: true,
      circuitBreakerCheckedAt: NOW,
      circuitBreakerStoppedAt: EARLIER,
      circuitBreakerReasons: [ON_ORDERS, ON_CUSTOMERS],
    };

    expect(await state()).toEqual({
      dataPipelineId: ORDERS_DAILY,
      stopsOnLateTables: true,
      checkedAt: NOW.toISOString(),
      stoppedAt: EARLIER.toISOString(),
      reasons: [ON_ORDERS, ON_CUSTOMERS],
    });
  });

  test("a reason about a table its reader may not read is never named", async () => {
    pipelines[0] = {
      ...pipelines[0]!,
      circuitBreakerStoppedAt: EARLIER,
      circuitBreakerReasons: [ON_ORDERS, ON_CUSTOMERS],
    };
    scope = {
      isWholeProject: false,
      assetQuery: { projectId: PROJECT, ownerOnly: true } as never,
      checkQuery: { projectId: PROJECT },
      pipelineQuery: { projectId: PROJECT },
    };
    jest
      .spyOn(DataObservabilityReadScope, "getReadableIds")
      .mockResolvedValue(new Set([CUSTOMERS]) as never);

    expect((await state())?.reasons).toEqual([ON_CUSTOMERS]);
  });

  test("saying go, it has no reasons, whatever the column still holds", async () => {
    pipelines[0] = {
      ...pipelines[0]!,
      circuitBreakerCheckedAt: NOW,
      circuitBreakerStoppedAt: null,
      circuitBreakerReasons: [ON_ORDERS],
    };

    expect(await state()).toMatchObject({
      checkedAt: NOW.toISOString(),
      stoppedAt: null,
      reasons: [],
    });
  });

  test("never asked: nothing to say yet", async () => {
    expect(await state()).toEqual({
      dataPipelineId: ORDERS_DAILY,
      stopsOnLateTables: false,
      checkedAt: null,
      stoppedAt: null,
      reasons: [],
    });
  });

  test("a pipeline its reader may not read is not found", async () => {
    pipelines = [];

    expect(await state()).toBeNull();
  });
});
