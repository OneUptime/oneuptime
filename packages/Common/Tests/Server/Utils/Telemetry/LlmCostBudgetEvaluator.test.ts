import LlmCostBudget from "../../../../Models/DatabaseModels/LlmCostBudget";
import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { LlmUsageDimension } from "../../../../Types/Telemetry/LlmUsageApi";
import LlmCostBudgetEvaluator, {
  LLM_BUDGET_ID_ATTRIBUTE,
  LLM_BUDGET_MODEL_ATTRIBUTE,
  LLM_BUDGET_NAME_ATTRIBUTE,
  LLM_BUDGET_PERCENT_METRIC_NAME,
  LLM_BUDGET_PROVIDER_ATTRIBUTE,
  LLM_BUDGET_SERVICE_ID_ATTRIBUTE,
  LLM_BUDGET_SPEND_METRIC_NAME,
  LlmResolvedSpend,
} from "../../../../Server/Utils/Telemetry/LlmCostBudgetEvaluator";
import { LlmUsageReadQuery } from "../../../../Server/Utils/Telemetry/LlmUsageReader";
import LlmCostBudgetService from "../../../../Server/Services/LlmCostBudgetService";
import MetricService from "../../../../Server/Services/MetricService";
import SpanService from "../../../../Server/Services/SpanService";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
/*
 * `jest` deliberately comes from the global scope, not @jest/globals — the
 * imported value would shadow the global `jest` NAMESPACE and break the
 * `jest.Mock` type annotations below (house convention, see
 * Tests/UI/Components/Workflow/ModelSchema.test.ts).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A budget's spend is what the Usage tab counts for the same scope
 * (LlmUsageReader): one read of the AI calls and one of the usage metrics,
 * each service counted from the signal it sends. These tests answer the two
 * reads as ClickHouse would - one total row per service - and pin what the
 * budget makes of them: an app's calls, a coding tool's metrics beside
 * them, an app that sends both counted once, and a failed read that fails
 * the evaluation rather than reading as nothing spent.
 */

jest.mock("../../../../Server/Services/SpanService", () => {
  return {
    __esModule: true,
    default: {
      // The AI calls' read (LlmUsageReader.buildSpanStatement).
      executeQuery: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: {
      insertJsonRows: jest.fn(),
      // The usage metrics' read (LlmMetricUsageReader.buildStatement).
      executeQuery: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/LlmCostBudgetService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      indexMetricNameServiceNameMap: jest.fn(),
    },
  };
});

type MockedFn = jest.Mock;

const mockedSpanService: { executeQuery: MockedFn } =
  SpanService as unknown as {
    executeQuery: MockedFn;
  };

const mockedMetricService: {
  insertJsonRows: MockedFn;
  executeQuery: MockedFn;
} = MetricService as unknown as {
  insertJsonRows: MockedFn;
  executeQuery: MockedFn;
};

const mockedBudgetService: {
  findBy: MockedFn;
  updateOneById: MockedFn;
} = LlmCostBudgetService as unknown as {
  findBy: MockedFn;
  updateOneById: MockedFn;
};

const mockedTelemetryUtil: { indexMetricNameServiceNameMap: MockedFn } =
  TelemetryUtil as unknown as {
    indexMetricNameServiceNameMap: MockedFn;
  };

// The services the reads answer for: an app, and the coding tools.
const APP: string = "a1000000000000000000000000000001";
const CLAUDE_CODE: string = "a1000000000000000000000000000002";
const CODEX: string = "a1000000000000000000000000000003";

interface SpanTotal {
  service: string;
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

interface MetricTotal {
  service: string;
  // Claude Code's cost counter unless said.
  metric?: string;
  tokenType?: string;
  value: number;
}

function answer(data: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<{ data: Array<JSONObject> }> => {
      return { data: data };
    },
  };
}

// What ClickHouse answers the AI calls' read: one total row per service.
function mockSpanTotals(rows: Array<SpanTotal>): void {
  mockedSpanService.executeQuery.mockResolvedValue(
    answer(
      rows.map((row: SpanTotal): JSONObject => {
        return {
          serviceKey: row.service,
          groupKey: "",
          calls: row.calls ?? 1,
          erroredCalls: 0,
          inputTokens: row.inputTokens ?? 0,
          outputTokens: row.outputTokens ?? 0,
          totalTokens: (row.inputTokens ?? 0) + (row.outputTokens ?? 0),
          costUsd: row.costUsd ?? 0,
        };
      }),
    ) as never,
  );
}

// What ClickHouse answers the usage metrics' read: one row per metric and service.
function mockMetricTotals(rows: Array<MetricTotal>): void {
  mockedMetricService.executeQuery.mockResolvedValue(
    answer(
      rows.map((row: MetricTotal): JSONObject => {
        return {
          metric: row.metric || "claude_code.cost.usage",
          serviceKey: row.service,
          groupKey: "",
          groupAttribute: "",
          tokenType: row.tokenType || "",
          value: row.value,
        };
      }),
    ) as never,
  );
}

function spanStatement(): Statement {
  return mockedSpanService.executeQuery.mock.calls[0]![0] as Statement;
}

function metricStatement(): Statement {
  return mockedMetricService.executeQuery.mock.calls[0]![0] as Statement;
}

function values(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

// 2026-08-22 14:30:00 UTC — an arbitrary mid-day instant.
const NOW: Date = new Date(Date.UTC(2026, 7, 22, 14, 30, 0));

function makeBudget(overrides?: Partial<LlmCostBudget>): LlmCostBudget {
  const budget: LlmCostBudget = new LlmCostBudget();
  budget.id = ObjectID.generate();
  budget.projectId = ObjectID.generate();
  budget.name = "Prod LLM budget";
  budget.dailyBudgetInUSD = 100;

  return Object.assign(budget, overrides);
}

describe("LlmCostBudgetEvaluator.computePercentUsed", () => {
  test("computes percent of budget", () => {
    expect(
      LlmCostBudgetEvaluator.computePercentUsed({
        spendInUSD: 82,
        dailyBudgetInUSD: 100,
      }),
    ).toBe(82);
  });

  test("supports values past 100%", () => {
    expect(
      LlmCostBudgetEvaluator.computePercentUsed({
        spendInUSD: 250,
        dailyBudgetInUSD: 100,
      }),
    ).toBe(250);
  });

  test("rounds to two decimal places — no float noise into monitors", () => {
    expect(
      LlmCostBudgetEvaluator.computePercentUsed({
        spendInUSD: 1 / 3,
        dailyBudgetInUSD: 100,
      }),
    ).toBe(0.33);
  });

  test.each([
    ["zero budget", { spendInUSD: 100, dailyBudgetInUSD: 0 }],
    ["negative budget", { spendInUSD: 100, dailyBudgetInUSD: -10 }],
    ["NaN budget", { spendInUSD: 100, dailyBudgetInUSD: NaN }],
    ["Infinity budget", { spendInUSD: 100, dailyBudgetInUSD: Infinity }],
    ["negative spend", { spendInUSD: -1, dailyBudgetInUSD: 100 }],
    ["NaN spend", { spendInUSD: NaN, dailyBudgetInUSD: 100 }],
  ])(
    "%s yields 0 — never NaN/Infinity into a metric series",
    (_label: string, input: Record<string, number>) => {
      expect(
        LlmCostBudgetEvaluator.computePercentUsed(
          input as { spendInUSD: number; dailyBudgetInUSD: number },
        ),
      ).toBe(0);
    },
  );

  test("zero spend is 0%", () => {
    expect(
      LlmCostBudgetEvaluator.computePercentUsed({
        spendInUSD: 0,
        dailyBudgetInUSD: 100,
      }),
    ).toBe(0);
  });
});

describe("LlmCostBudgetEvaluator.getUtcDayStart", () => {
  test("returns midnight UTC of the same day", () => {
    expect(LlmCostBudgetEvaluator.getUtcDayStart(NOW).toISOString()).toBe(
      "2026-08-22T00:00:00.000Z",
    );
  });

  test("is idempotent", () => {
    const once: Date = LlmCostBudgetEvaluator.getUtcDayStart(NOW);
    expect(LlmCostBudgetEvaluator.getUtcDayStart(once).getTime()).toBe(
      once.getTime(),
    );
  });
});

describe("LlmCostBudgetEvaluator.buildUsageQuery", () => {
  const dayStart: Date = LlmCostBudgetEvaluator.getUtcDayStart(NOW);

  test("the project's UTC day so far, totals only", () => {
    const budget: LlmCostBudget = makeBudget();

    const query: LlmUsageReadQuery = LlmCostBudgetEvaluator.buildUsageQuery({
      budget,
      dayStart,
      now: NOW,
    });

    expect(query.projectId).toBe(budget.projectId);
    expect(query.startTime).toBe(dayStart);
    expect(query.endTime).toBe(NOW);
    expect(query.dimension).toBe(LlmUsageDimension.None);
  });

  test("leaves an unscoped budget unscoped — it must see every call and point", () => {
    const query: LlmUsageReadQuery = LlmCostBudgetEvaluator.buildUsageQuery({
      budget: makeBudget(),
      dayStart,
      now: NOW,
    });

    expect(query.serviceId).toBeUndefined();
    expect(query.llmSystem).toBeUndefined();
    expect(query.llmModel).toBeUndefined();
    // A budget is not a person: no read scope, and the metrics are read.
    expect(query.serviceIds).toBeUndefined();
    expect(query.excludedServiceIds).toBeUndefined();
    expect(query.metricFilter).toBeUndefined();
  });

  test("carries the budget's service / provider / model scoping", () => {
    const serviceId: ObjectID = ObjectID.generate();

    const query: LlmUsageReadQuery = LlmCostBudgetEvaluator.buildUsageQuery({
      budget: makeBudget({
        serviceId: serviceId,
        llmSystem: "anthropic",
        llmModel: "claude-sonnet-4",
      }),
      dayStart,
      now: NOW,
    });

    expect(query.serviceId).toBe(serviceId);
    expect(query.llmSystem).toBe("anthropic");
    expect(query.llmModel).toBe("claude-sonnet-4");
  });
});

describe("LlmCostBudgetEvaluator.buildBudgetMetricRows", () => {
  test("builds one spend row and one percent row", () => {
    const budget: LlmCostBudget = makeBudget();

    const rows: Array<JSONObject> =
      LlmCostBudgetEvaluator.buildBudgetMetricRows({
        budget: budget,
        spendInUSD: 42.5,
        percentUsed: 42.5,
        now: NOW,
      });

    expect(rows).toHaveLength(2);

    const spendRow: JSONObject = rows[0]!;
    const percentRow: JSONObject = rows[1]!;

    expect(spendRow["name"]).toBe(LLM_BUDGET_SPEND_METRIC_NAME);
    expect(spendRow["value"]).toBe(42.5);
    expect(percentRow["name"]).toBe(LLM_BUDGET_PERCENT_METRIC_NAME);
    expect(percentRow["value"]).toBe(42.5);
  });

  test("rows carry the derived-metric row shape monitors expect", () => {
    const budget: LlmCostBudget = makeBudget();

    const rows: Array<JSONObject> =
      LlmCostBudgetEvaluator.buildBudgetMetricRows({
        budget: budget,
        spendInUSD: 1,
        percentUsed: 1,
        now: NOW,
      });

    for (const row of rows) {
      expect(row["projectId"]).toBe(budget.projectId!.toString());
      expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
      expect(row["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
      expect(row["timeUnixNano"]).toBe((NOW.getTime() * 1_000_000).toString());
      expect(row["_id"]).toBeTruthy();
      expect(row["retentionDate"]).toBeTruthy();

      const attributes: Record<string, string> = row["attributes"] as Record<
        string,
        string
      >;
      expect(attributes[LLM_BUDGET_ID_ATTRIBUTE]).toBe(budget.id!.toString());
      expect(attributes[LLM_BUDGET_NAME_ATTRIBUTE]).toBe(budget.name);

      const attributeKeys: Array<string> = row[
        "attributeKeys"
      ] as Array<string>;
      expect(attributeKeys).toEqual(Object.keys(attributes).sort());
    }
  });

  test("scope attributes appear only when the budget is scoped", () => {
    const unscoped: Array<JSONObject> =
      LlmCostBudgetEvaluator.buildBudgetMetricRows({
        budget: makeBudget(),
        spendInUSD: 1,
        percentUsed: 1,
        now: NOW,
      });

    const unscopedAttributes: Record<string, string> = unscoped[0]![
      "attributes"
    ] as Record<string, string>;
    expect(unscopedAttributes[LLM_BUDGET_SERVICE_ID_ATTRIBUTE]).toBeUndefined();
    expect(unscopedAttributes[LLM_BUDGET_PROVIDER_ATTRIBUTE]).toBeUndefined();
    expect(unscopedAttributes[LLM_BUDGET_MODEL_ATTRIBUTE]).toBeUndefined();

    const serviceId: ObjectID = ObjectID.generate();
    const scoped: Array<JSONObject> =
      LlmCostBudgetEvaluator.buildBudgetMetricRows({
        budget: makeBudget({
          serviceId: serviceId,
          llmSystem: "openai",
          llmModel: "gpt-4o",
        }),
        spendInUSD: 1,
        percentUsed: 1,
        now: NOW,
      });

    const scopedAttributes: Record<string, string> = scoped[0]![
      "attributes"
    ] as Record<string, string>;
    expect(scopedAttributes[LLM_BUDGET_SERVICE_ID_ATTRIBUTE]).toBe(
      serviceId.toString(),
    );
    expect(scopedAttributes[LLM_BUDGET_PROVIDER_ATTRIBUTE]).toBe("openai");
    expect(scopedAttributes[LLM_BUDGET_MODEL_ATTRIBUTE]).toBe("gpt-4o");
  });

  test("the two rows share one point in time", () => {
    const rows: Array<JSONObject> =
      LlmCostBudgetEvaluator.buildBudgetMetricRows({
        budget: makeBudget(),
        spendInUSD: 5,
        percentUsed: 5,
        now: NOW,
      });

    expect(rows[0]!["time"]).toBe(rows[1]!["time"]);
    expect(rows[0]!["timeUnixNano"]).toBe(rows[1]!["timeUnixNano"]);
  });
});

function resetReads(): void {
  jest.clearAllMocks();
  mockSpanTotals([]);
  mockMetricTotals([]);
  mockedMetricService.insertJsonRows.mockResolvedValue(undefined as never);
  mockedBudgetService.updateOneById.mockResolvedValue(undefined as never);
  mockedTelemetryUtil.indexMetricNameServiceNameMap.mockResolvedValue(
    undefined as never,
  );
}

describe("LlmCostBudgetEvaluator.evaluateBudget — orchestration", () => {
  beforeEach(() => {
    resetReads();
  });

  function mockSpend(valueInUSD: number): void {
    mockSpanTotals([{ service: APP, costUsd: valueInUSD }]);
  }

  test("stamps spend on the budget row", async () => {
    const budget: LlmCostBudget = makeBudget();
    mockSpend(10);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedBudgetService.updateOneById).toHaveBeenCalledTimes(1);
    const updateArg: { id: ObjectID; data: Record<string, unknown> } =
      mockedBudgetService.updateOneById.mock.calls[0]![0] as {
        id: ObjectID;
        data: Record<string, unknown>;
      };
    // ObjectID getters return fresh instances — compare by value.
    expect(updateArg.id.toString()).toBe(budget.id!.toString());
    expect(updateArg.data["currentDaySpendInUSD"]).toBe(10);
    expect(updateArg.data["spendLastEvaluatedAt"]).toBe(NOW);
  });

  test("publishes spend and percent metric points", async () => {
    const budget: LlmCostBudget = makeBudget({ dailyBudgetInUSD: 200 });
    mockSpend(164);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedMetricService.insertJsonRows).toHaveBeenCalledTimes(1);
    const rows: Array<JSONObject> = mockedMetricService.insertJsonRows.mock
      .calls[0]![0] as Array<JSONObject>;

    expect(rows).toHaveLength(2);
    expect(rows[0]!["name"]).toBe(LLM_BUDGET_SPEND_METRIC_NAME);
    expect(rows[0]!["value"]).toBe(164);
    expect(rows[1]!["name"]).toBe(LLM_BUDGET_PERCENT_METRIC_NAME);
    expect(rows[1]!["value"]).toBe(82);
  });

  test("registers the metric names for the picker", async () => {
    const budget: LlmCostBudget = makeBudget();
    mockSpend(1);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(
      mockedTelemetryUtil.indexMetricNameServiceNameMap,
    ).toHaveBeenCalledTimes(1);
    const registration: { metricNameServiceNameMap: Record<string, unknown> } =
      mockedTelemetryUtil.indexMetricNameServiceNameMap.mock.calls[0]![0] as {
        metricNameServiceNameMap: Record<string, unknown>;
      };
    expect(Object.keys(registration.metricNameServiceNameMap).sort()).toEqual(
      [LLM_BUDGET_PERCENT_METRIC_NAME, LLM_BUDGET_SPEND_METRIC_NAME].sort(),
    );
  });

  test("every service's spend is added up", async () => {
    const budget: LlmCostBudget = makeBudget();
    mockSpanTotals([
      { service: APP, costUsd: 3.5 },
      { service: CLAUDE_CODE, costUsd: 4.5 },
    ]);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    const updateArg: { data: Record<string, unknown> } = mockedBudgetService
      .updateOneById.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data["currentDaySpendInUSD"]).toBe(8);
  });

  test("budgets missing required fields are skipped without side effects", async () => {
    const budget: LlmCostBudget = makeBudget();
    delete budget.dailyBudgetInUSD;

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedSpanService.executeQuery).not.toHaveBeenCalled();
    expect(mockedMetricService.executeQuery).not.toHaveBeenCalled();
    expect(mockedBudgetService.updateOneById).not.toHaveBeenCalled();
    expect(mockedMetricService.insertJsonRows).not.toHaveBeenCalled();
  });

  test("both reads cover the UTC day so far, and fail loud", async () => {
    const budget: LlmCostBudget = makeBudget();
    mockSpend(1);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    const dayStart: string = OneUptimeDate.toClickhouseDateTime64(
      LlmCostBudgetEvaluator.getUtcDayStart(NOW),
    );
    const now: string = OneUptimeDate.toClickhouseDateTime64(NOW);

    for (const statement of [spanStatement(), metricStatement()]) {
      expect(values(statement)).toContain(budget.projectId!.toString());
      expect(values(statement)).toContain(dayStart);
      expect(values(statement)).toContain(now);
      expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
      expect(statement.query).not.toContain("'break'");
    }

    expect(spanStatement().query).toContain("AND isLlmSpan = 1");
  });

  /*
   * An agent run's, or a wrapper span's, repeat of its calls' cost is left
   * out of the sum (LlmCountedCallsSql), as on the Usage tab.
   */
  test("each model call's cost counts once", async () => {
    mockSpend(1);

    await LlmCostBudgetEvaluator.evaluateBudget({
      budget: makeBudget(),
      now: NOW,
    });

    expect(spanStatement().query).toContain(
      "sum(if(costCovered, 0, llmCost)) AS costUsd",
    );
    expect(spanStatement().query).toContain(
      "if(llmCost > 0, (cityHash64(traceId, spanId, 'c') IN (",
    );
  });
});

describe("LlmCostBudgetEvaluator.evaluateAllBudgets — sweep resilience", () => {
  beforeEach(() => {
    resetReads();
  });

  test("one failing budget never aborts the sweep", async () => {
    const failing: LlmCostBudget = makeBudget({ name: "failing" });
    const healthy: LlmCostBudget = makeBudget({ name: "healthy" });

    mockedBudgetService.findBy.mockResolvedValue([failing, healthy] as never);
    mockedSpanService.executeQuery
      .mockRejectedValueOnce(new Error("ClickHouse timeout") as never)
      .mockResolvedValueOnce(
        answer([
          {
            serviceKey: APP,
            groupKey: "",
            calls: 1,
            erroredCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 5,
          },
        ]) as never,
      );

    await LlmCostBudgetEvaluator.evaluateAllBudgets();

    // The healthy budget still got its spend stamped and metrics published.
    expect(mockedBudgetService.updateOneById).toHaveBeenCalledTimes(1);
    const updateArg: { id: ObjectID; data: Record<string, unknown> } =
      mockedBudgetService.updateOneById.mock.calls[0]![0] as {
        id: ObjectID;
        data: Record<string, unknown>;
      };
    expect(updateArg.id.toString()).toBe(healthy.id!.toString());
    expect(updateArg.data["currentDaySpendInUSD"]).toBe(5);
    expect(mockedMetricService.insertJsonRows).toHaveBeenCalledTimes(1);
  });

  test("no enabled budgets means no ClickHouse queries at all", async () => {
    mockedBudgetService.findBy.mockResolvedValue([] as never);

    await LlmCostBudgetEvaluator.evaluateAllBudgets();

    expect(mockedSpanService.executeQuery).not.toHaveBeenCalled();
    expect(mockedMetricService.executeQuery).not.toHaveBeenCalled();
  });

  test("only enabled budgets are loaded", async () => {
    mockedBudgetService.findBy.mockResolvedValue([] as never);

    await LlmCostBudgetEvaluator.evaluateAllBudgets();

    const findArg: { query: Record<string, unknown> } = mockedBudgetService
      .findBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
    };
    expect(findArg.query["isEnabled"]).toBe(true);
  });
});

describe("LlmCostBudgetEvaluator.resolveSpend — each service from its signal", () => {
  const DAY_START: Date = new Date(Date.UTC(2026, 7, 22, 0, 0, 0));

  beforeEach(() => {
    resetReads();
  });

  async function resolve(budget?: LlmCostBudget): Promise<LlmResolvedSpend> {
    return await LlmCostBudgetEvaluator.resolveSpend({
      budget: budget || makeBudget(),
      dayStart: DAY_START,
      now: NOW,
    });
  }

  test("an app's AI calls: their cost", async () => {
    mockSpanTotals([{ service: APP, costUsd: 42 }]);

    await expect(resolve()).resolves.toEqual({
      spendInUSD: 42,
      source: "spans",
    });
  });

  /*
   * The double-counting guard: an SDK that sends both signals for the same
   * calls (OpenLLMetry) would otherwise read 1041 here, and a budget that
   * fires on spend that never happened is worse than one that misses.
   */
  test("an app that sends both signals counts once, from its calls", async () => {
    mockSpanTotals([{ service: APP, costUsd: 42 }]);
    mockMetricTotals([{ service: APP, value: 999 }]);

    const resolved: LlmResolvedSpend = await resolve();

    expect(resolved).toEqual({ spendInUSD: 42, source: "spans" });
    expect(resolved.spendInUSD).not.toBe(1041);
  });

  /*
   * THE FIX. The metrics were read only when the whole project's calls
   * added up to nothing, so Claude Code's spend vanished from every budget
   * as soon as any app sent a priced call.
   */
  test("a coding tool's usage metrics count beside an app's calls", async () => {
    mockSpanTotals([{ service: APP, costUsd: 42 }]);
    mockMetricTotals([{ service: CLAUDE_CODE, value: 17.5 }]);

    await expect(resolve()).resolves.toEqual({
      spendInUSD: 59.5,
      source: "both",
    });
  });

  test("a metrics-only project counts its metrics", async () => {
    mockMetricTotals([{ service: CLAUDE_CODE, value: 17.5 }]);

    await expect(resolve()).resolves.toEqual({
      spendInUSD: 17.5,
      source: "metrics",
    });
  });

  test("calls with tokens and no price leave the cost to the service's cost metric", async () => {
    mockSpanTotals([{ service: APP, costUsd: 0, inputTokens: 1200 }]);
    mockMetricTotals([{ service: APP, value: 8 }]);

    await expect(resolve()).resolves.toEqual({
      spendInUSD: 8,
      source: "metrics",
    });
  });

  test("Codex's millionths of a USD are scaled before they are added", async () => {
    mockMetricTotals([
      { service: CODEX, metric: "codex.turn.cost_microusd", value: 2500000 },
      { service: CLAUDE_CODE, value: 1.25 },
    ]);

    const resolved: LlmResolvedSpend = await resolve();

    expect(resolved.source).toBe("metrics");
    expect(resolved.spendInUSD).toBeCloseTo(3.75, 10);
  });

  /*
   * Points that name no service are the project's Unknown Service (its id
   * is the project's), one service like any other.
   */
  test("metrics that name no service count as the Unknown Service", async () => {
    const budget: LlmCostBudget = makeBudget();
    mockSpanTotals([{ service: APP, costUsd: 42 }]);
    mockMetricTotals([{ service: budget.projectId!.toString(), value: 5 }]);

    await expect(resolve(budget)).resolves.toEqual({
      spendInUSD: 47,
      source: "both",
    });
  });

  test("reports source 'none' when both reads are empty", async () => {
    await expect(resolve()).resolves.toEqual({ spendInUSD: 0, source: "none" });
  });

  test("calls with no cost and no cost metric are 'none', not 'spans'", async () => {
    mockSpanTotals([{ service: APP, costUsd: 0, inputTokens: 1200 }]);

    await expect(resolve()).resolves.toEqual({ spendInUSD: 0, source: "none" });
  });

  test("a zero metric total still resolves to 'none', not 'metrics'", async () => {
    mockMetricTotals([{ service: CLAUDE_CODE, value: 0 }]);

    await expect(resolve()).resolves.toEqual({ spendInUSD: 0, source: "none" });
  });

  /*
   * Returning 0 on a failed read would silently suppress a real breach.
   * evaluateAllBudgets isolates the failure to the one budget.
   */
  test("propagates a metric-read failure rather than reporting zero spend", async () => {
    mockSpanTotals([{ service: APP, costUsd: 42 }]);
    mockedMetricService.executeQuery.mockRejectedValue(
      new Error("clickhouse timeout") as never,
    );

    await expect(resolve()).rejects.toThrow("clickhouse timeout");
  });

  test("propagates a call-read failure rather than counting the metrics alone", async () => {
    mockMetricTotals([{ service: CLAUDE_CODE, value: 17.5 }]);
    mockedSpanService.executeQuery.mockRejectedValue(
      new Error("span boom") as never,
    );

    await expect(resolve()).rejects.toThrow("span boom");
  });

  test("passes the budget's scope through to both reads", async () => {
    const serviceId: ObjectID = ObjectID.generate();
    mockSpanTotals([{ service: serviceId.toString(), costUsd: 3 }]);

    await resolve(
      makeBudget({
        serviceId: serviceId,
        llmSystem: "openai",
        llmModel: "gpt-4o",
      }),
    );

    const calls: Statement = spanStatement();

    expect(calls.query).toContain("AND primaryEntityId = ");
    expect(values(calls)).toContain(serviceId.toString());
    // The provider under every spelling it is stored as.
    expect(calls.query).toContain("AND llmSystem IN (");
    expect(values(calls)).toContainEqual(["openai", "OpenAI"]);
    expect(calls.query).toContain("AND llmRequestModel = ");
    expect(values(calls)).toContain("gpt-4o");

    const metrics: Statement = metricStatement();

    expect(metrics.query).toContain("AND primaryEntityId = ");
    expect(values(metrics)).toContain(serviceId.toString());
    // The provider under every spelling it is sent as, on either key.
    expect(metrics.query).toContain("attributes['gen_ai.system'] IN (");
    expect(metrics.query).toContain("attributes['gen_ai.provider.name'] IN (");
    expect(values(metrics)).toContainEqual(["openai", "OpenAI"]);
    expect(values(metrics)).toContain("gpt-4o");
  });

  test("an unscoped budget reads every service", async () => {
    mockSpanTotals([{ service: APP, costUsd: 3 }]);

    await resolve();

    for (const statement of [spanStatement(), metricStatement()]) {
      expect(statement.query).not.toContain("AND primaryEntityId = ");
      expect(statement.query).not.toContain("AND primaryEntityId IN (");
      expect(statement.query).not.toContain("AND primaryEntityId NOT IN (");
    }
  });
});

describe("LlmCostBudgetEvaluator.evaluateBudget — metric-sourced spend", () => {
  beforeEach(() => {
    resetReads();
  });

  test("a metrics-only project gets its spend stamped on the budget row", async () => {
    mockMetricTotals([{ service: CLAUDE_CODE, value: 60 }]);

    const budget: LlmCostBudget = makeBudget({ dailyBudgetInUSD: 100 });

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    const updateArg: { data: Record<string, unknown> } = mockedBudgetService
      .updateOneById.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };

    expect(updateArg.data["currentDaySpendInUSD"]).toBe(60);
  });

  test("a metrics-only project publishes the same budget series as a span-backed one", async () => {
    mockMetricTotals([{ service: CLAUDE_CODE, value: 80 }]);

    await LlmCostBudgetEvaluator.evaluateBudget({
      budget: makeBudget({ dailyBudgetInUSD: 100 }),
      now: NOW,
    });

    const rows: Array<Record<string, unknown>> = mockedMetricService
      .insertJsonRows.mock.calls[0]![0] as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(2);
    expect(rows[0]!["name"]).toBe(LLM_BUDGET_SPEND_METRIC_NAME);
    expect(rows[0]!["value"]).toBe(80);
    expect(rows[1]!["name"]).toBe(LLM_BUDGET_PERCENT_METRIC_NAME);
    expect(rows[1]!["value"]).toBe(80);
  });

  /*
   * The published series must stay byte-identical to what a span-backed budget
   * emits — existing monitors filter on oneuptime.llm.budget.id and must not
   * have to learn about the source.
   */
  test("the published series carries no source-specific attribute", async () => {
    mockSpanTotals([{ service: APP, costUsd: 2 }]);
    mockMetricTotals([{ service: CLAUDE_CODE, value: 5 }]);

    const budget: LlmCostBudget = makeBudget();

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    const rows: Array<Record<string, unknown>> = mockedMetricService
      .insertJsonRows.mock.calls[0]![0] as Array<Record<string, unknown>>;

    expect(rows[0]!["value"]).toBe(7);

    const attributes: Record<string, string> = rows[0]!["attributes"] as Record<
      string,
      string
    >;

    expect(Object.keys(attributes).sort()).toEqual(
      [LLM_BUDGET_ID_ATTRIBUTE, LLM_BUDGET_NAME_ATTRIBUTE].sort(),
    );
  });

  test("an idle project still stamps zero and publishes its series", async () => {
    await LlmCostBudgetEvaluator.evaluateBudget({
      budget: makeBudget(),
      now: NOW,
    });

    const updateArg: { data: Record<string, unknown> } = mockedBudgetService
      .updateOneById.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };

    expect(updateArg.data["currentDaySpendInUSD"]).toBe(0);
    expect(mockedMetricService.insertJsonRows).toHaveBeenCalledTimes(1);
  });
});
