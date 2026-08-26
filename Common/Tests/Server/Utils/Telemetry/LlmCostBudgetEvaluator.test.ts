import LlmCostBudget from "../../../../Models/DatabaseModels/LlmCostBudget";
import Span from "../../../../Models/AnalyticsModels/Span";
import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Query from "../../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import LlmCostBudgetEvaluator, {
  LLM_BUDGET_ID_ATTRIBUTE,
  LLM_BUDGET_MODEL_ATTRIBUTE,
  LLM_BUDGET_NAME_ATTRIBUTE,
  LLM_BUDGET_PERCENT_METRIC_NAME,
  LLM_BUDGET_PROVIDER_ATTRIBUTE,
  LLM_BUDGET_SERVICE_ID_ATTRIBUTE,
  LLM_BUDGET_SPEND_METRIC_NAME,
} from "../../../../Server/Utils/Telemetry/LlmCostBudgetEvaluator";
import LlmCostBudgetService from "../../../../Server/Services/LlmCostBudgetService";
import MetricService from "../../../../Server/Services/MetricService";
import SpanService from "../../../../Server/Services/SpanService";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import { LlmMicroUsdCostMetricNames } from "../../../../Types/Telemetry/LlmMetricConventions";
import { LlmMetricScope } from "../../../../Utils/Telemetry/LlmMetricQuery";
/*
 * `jest` deliberately comes from the global scope, not @jest/globals — the
 * imported value would shadow the global `jest` NAMESPACE and break the
 * `jest.Mock` type annotations below (house convention, see
 * Tests/UI/Components/Workflow/ModelSchema.test.ts).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../Server/Services/SpanService", () => {
  return {
    __esModule: true,
    default: {
      aggregateBy: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: {
      insertJsonRows: jest.fn(),
      /*
       * aggregateBy backs the metric-sourced spend fallback that
       * resolveSpend reaches for when the span stream is empty.
       */
      aggregateBy: jest.fn(),
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

const mockedSpanService: { aggregateBy: MockedFn } = SpanService as unknown as {
  aggregateBy: MockedFn;
};

const mockedMetricService: {
  insertJsonRows: MockedFn;
  aggregateBy: MockedFn;
} = MetricService as unknown as {
  insertJsonRows: MockedFn;
  aggregateBy: MockedFn;
};

/*
 * Metric-sourced cost is TWO aggregates, not one: the USD-denominated metric
 * names and the micro-USD ones (the Codex CLI reports millionths of a dollar)
 * are queried separately and scaled before being added, because a single Sum
 * over both units cannot be un-mixed afterwards. A plain mockResolvedValue
 * answers BOTH queries with the same payload, which would feed the same
 * figure in twice — once at 1e-6 — and quietly skew every expectation here.
 *
 * So the mock dispatches on the metric names the query actually selects: the
 * rows are the project's USD spend, and the micro-USD query correctly finds
 * nothing.
 */
function mockUsdMetricRows(rows: Array<JSONObject>): void {
  mockedMetricService.aggregateBy.mockImplementation(
    (aggregate: { query: Record<string, unknown> }): Promise<JSONObject> => {
      const names: Array<string> = ((
        aggregate?.query?.["name"] as { values?: Array<string> } | undefined
      )?.values || []) as Array<string>;

      const isMicroUsd: boolean = names.some((name: string) => {
        return LlmMicroUsdCostMetricNames.includes(name);
      });

      return Promise.resolve({ data: isMicroUsd ? [] : rows });
    },
  );
}

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

describe("LlmCostBudgetEvaluator.buildSpanQuery", () => {
  const dayStart: Date = LlmCostBudgetEvaluator.getUtcDayStart(NOW);

  test("base query filters project, LLM spans, and the day window", () => {
    const budget: LlmCostBudget = makeBudget();

    const query: Query<Span> = LlmCostBudgetEvaluator.buildSpanQuery({
      budget,
      dayStart,
      now: NOW,
    });

    const record: Record<string, unknown> = query as Record<string, unknown>;

    expect(record["projectId"]).toBe(budget.projectId);
    expect(record["isLlmSpan"]).toBe(true);
    expect(record["startTime"]).toBeInstanceOf(InBetween);
    expect(record["primaryEntityId"]).toBeUndefined();
    expect(record["llmSystem"]).toBeUndefined();
    expect(record["llmRequestModel"]).toBeUndefined();
  });

  test("optional scoping filters are applied when set", () => {
    const serviceId: ObjectID = ObjectID.generate();
    const budget: LlmCostBudget = makeBudget({
      serviceId: serviceId,
      llmSystem: "openai",
      llmModel: "gpt-4o",
    });

    const query: Record<string, unknown> =
      LlmCostBudgetEvaluator.buildSpanQuery({
        budget,
        dayStart,
        now: NOW,
      }) as Record<string, unknown>;

    expect(query["primaryEntityId"]).toBe(serviceId);
    expect(query["llmSystem"]).toBe("openai");
    expect(query["llmRequestModel"]).toBe("gpt-4o");
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

describe("LlmCostBudgetEvaluator.evaluateBudget — orchestration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSpanService.aggregateBy.mockResolvedValue({ data: [] } as never);
    mockedMetricService.aggregateBy.mockResolvedValue({ data: [] } as never);
    mockedMetricService.insertJsonRows.mockResolvedValue(undefined as never);
    mockedBudgetService.updateOneById.mockResolvedValue(undefined as never);
    mockedTelemetryUtil.indexMetricNameServiceNameMap.mockResolvedValue(
      undefined as never,
    );
  });

  function mockSpend(valueInUSD: number): void {
    mockedSpanService.aggregateBy.mockResolvedValue({
      data: [{ timestamp: NOW, value: valueInUSD }],
    } as never);
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

  test("multiple aggregation rows are summed", async () => {
    const budget: LlmCostBudget = makeBudget();
    mockedSpanService.aggregateBy.mockResolvedValue({
      data: [
        { timestamp: NOW, value: 3.5 },
        { timestamp: NOW, value: 4.5 },
      ],
    } as never);

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

    expect(mockedSpanService.aggregateBy).not.toHaveBeenCalled();
    expect(mockedBudgetService.updateOneById).not.toHaveBeenCalled();
    expect(mockedMetricService.insertJsonRows).not.toHaveBeenCalled();
  });

  test("the ClickHouse aggregation is scoped and fails loud", async () => {
    const budget: LlmCostBudget = makeBudget();
    mockSpend(1);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    const aggregateArg: Record<string, unknown> = mockedSpanService.aggregateBy
      .mock.calls[0]![0] as Record<string, unknown>;

    expect(aggregateArg["aggregateColumnName"]).toBe("llmCost");
    expect(aggregateArg["timeoutOverflowMode"]).toBe("throw");
    expect(aggregateArg["startTimestamp"]).toEqual(
      LlmCostBudgetEvaluator.getUtcDayStart(NOW),
    );
    expect(aggregateArg["endTimestamp"]).toBe(NOW);
    expect(
      (aggregateArg["query"] as Record<string, unknown>)["isLlmSpan"],
    ).toBe(true);
  });
});

describe("LlmCostBudgetEvaluator.evaluateAllBudgets — sweep resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedMetricService.aggregateBy.mockResolvedValue({ data: [] } as never);
    mockedMetricService.insertJsonRows.mockResolvedValue(undefined as never);
    mockedBudgetService.updateOneById.mockResolvedValue(undefined as never);
    mockedTelemetryUtil.indexMetricNameServiceNameMap.mockResolvedValue(
      undefined as never,
    );
  });

  test("one failing budget never aborts the sweep", async () => {
    const failing: LlmCostBudget = makeBudget({ name: "failing" });
    const healthy: LlmCostBudget = makeBudget({ name: "healthy" });

    mockedBudgetService.findBy.mockResolvedValue([failing, healthy] as never);
    mockedSpanService.aggregateBy
      .mockRejectedValueOnce(new Error("ClickHouse timeout") as never)
      .mockResolvedValueOnce({
        data: [{ timestamp: NOW, value: 5 }],
      } as never);

    await LlmCostBudgetEvaluator.evaluateAllBudgets();

    // The healthy budget still got its spend stamped and metrics published.
    expect(mockedBudgetService.updateOneById).toHaveBeenCalledTimes(1);
    const updateArg: { id: ObjectID } = mockedBudgetService.updateOneById.mock
      .calls[0]![0] as { id: ObjectID };
    expect(updateArg.id.toString()).toBe(healthy.id!.toString());
    expect(mockedMetricService.insertJsonRows).toHaveBeenCalledTimes(1);
  });

  test("no enabled budgets means no ClickHouse queries at all", async () => {
    mockedBudgetService.findBy.mockResolvedValue([] as never);

    await LlmCostBudgetEvaluator.evaluateAllBudgets();

    expect(mockedSpanService.aggregateBy).not.toHaveBeenCalled();
    expect(mockedMetricService.aggregateBy).not.toHaveBeenCalled();
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

describe("LlmCostBudgetEvaluator.buildMetricScope", () => {
  const DAY_START: Date = new Date(Date.UTC(2026, 7, 22, 0, 0, 0));

  test("carries the project and the day-so-far window", () => {
    const budget: LlmCostBudget = makeBudget();

    const scope: LlmMetricScope = LlmCostBudgetEvaluator.buildMetricScope({
      budget,
      dayStart: DAY_START,
      now: NOW,
    });

    expect(scope.projectId).toBe(budget.projectId);
    expect(scope.startTime).toBe(DAY_START);
    expect(scope.endTime).toBe(NOW);
  });

  test("leaves an unscoped budget unscoped — it must see every datapoint", () => {
    const scope: LlmMetricScope = LlmCostBudgetEvaluator.buildMetricScope({
      budget: makeBudget(),
      dayStart: DAY_START,
      now: NOW,
    });

    expect(scope.serviceId).toBeUndefined();
    expect(scope.llmSystem).toBeUndefined();
    expect(scope.llmModel).toBeUndefined();
  });

  test("mirrors the budget's service / provider / model scoping", () => {
    const serviceId: ObjectID = ObjectID.generate();

    const scope: LlmMetricScope = LlmCostBudgetEvaluator.buildMetricScope({
      budget: makeBudget({
        serviceId: serviceId,
        llmSystem: "anthropic",
        llmModel: "claude-sonnet-4",
      }),
      dayStart: DAY_START,
      now: NOW,
    });

    expect(scope.serviceId).toBe(serviceId);
    expect(scope.llmSystem).toBe("anthropic");
    expect(scope.llmModel).toBe("claude-sonnet-4");
  });

  /*
   * The span query and the metric query must narrow to the same slice of
   * traffic, or the fallback would silently measure something else.
   */
  test("agrees with buildSpanQuery on the service scope", () => {
    const serviceId: ObjectID = ObjectID.generate();
    const budget: LlmCostBudget = makeBudget({ serviceId: serviceId });

    const spanQuery: Record<string, unknown> =
      LlmCostBudgetEvaluator.buildSpanQuery({
        budget,
        dayStart: DAY_START,
        now: NOW,
      }) as unknown as Record<string, unknown>;

    const scope: LlmMetricScope = LlmCostBudgetEvaluator.buildMetricScope({
      budget,
      dayStart: DAY_START,
      now: NOW,
    });

    expect(spanQuery["primaryEntityId"]).toBe(scope.serviceId);
  });
});

describe("LlmCostBudgetEvaluator.resolveSpend — source selection", () => {
  const DAY_START: Date = new Date(Date.UTC(2026, 7, 22, 0, 0, 0));

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSpanService.aggregateBy.mockResolvedValue({ data: [] } as never);
    mockedMetricService.aggregateBy.mockResolvedValue({ data: [] } as never);
  });

  function mockSpanSpend(value: number): void {
    mockedSpanService.aggregateBy.mockResolvedValue({
      data: [{ timestamp: NOW, value: value }],
    } as never);
  }

  function mockMetricSpend(value: number): void {
    mockUsdMetricRows([{ timestamp: NOW, value: value }]);
  }

  test("uses spans when the span stream reported spend", async () => {
    mockSpanSpend(42);
    mockMetricSpend(999);

    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: makeBudget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).resolves.toEqual({ spendInUSD: 42, source: "spans" });
  });

  /*
   * The double-counting guard, and the reason this is a fallback rather than a
   * sum: an SDK emitting both signals would otherwise report 1041 here, and a
   * budget that fires on spend that never happened is worse than one that
   * misses.
   */
  test("never adds metric spend on top of span spend", async () => {
    mockSpanSpend(42);
    mockMetricSpend(999);

    const resolved: { spendInUSD: number } =
      await LlmCostBudgetEvaluator.resolveSpend({
        budget: makeBudget(),
        dayStart: DAY_START,
        now: NOW,
      });

    expect(resolved.spendInUSD).toBe(42);
    expect(resolved.spendInUSD).not.toBe(1041);
  });

  test("does not query metrics at all when spans answered", async () => {
    mockSpanSpend(42);

    await LlmCostBudgetEvaluator.resolveSpend({
      budget: makeBudget(),
      dayStart: DAY_START,
      now: NOW,
    });

    expect(mockedMetricService.aggregateBy).not.toHaveBeenCalled();
  });

  test("falls back to metrics when the span stream is empty", async () => {
    mockMetricSpend(17.5);

    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: makeBudget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).resolves.toEqual({ spendInUSD: 17.5, source: "metrics" });
  });

  test("reports source 'none' when both streams are empty", async () => {
    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: makeBudget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).resolves.toEqual({ spendInUSD: 0, source: "none" });
  });

  test("treats a zero-valued span bucket as no span spend", async () => {
    mockSpanSpend(0);
    mockMetricSpend(8);

    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: makeBudget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).resolves.toEqual({ spendInUSD: 8, source: "metrics" });
  });

  test("a zero metric total still resolves to 'none', not 'metrics'", async () => {
    mockMetricSpend(0);

    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: makeBudget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).resolves.toEqual({ spendInUSD: 0, source: "none" });
  });

  /*
   * Returning 0 on a failed metric query would silently suppress a real
   * breach — the same reasoning behind the span aggregate's
   * timeoutOverflowMode: 'throw'. evaluateAllBudgets isolates the failure.
   */
  test("propagates a metric-query failure rather than reporting zero spend", async () => {
    mockedMetricService.aggregateBy.mockRejectedValue(
      new Error("clickhouse timeout") as never,
    );

    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: makeBudget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).rejects.toThrow("clickhouse timeout");
  });

  test("propagates a span-query failure without reaching the fallback", async () => {
    mockedSpanService.aggregateBy.mockRejectedValue(
      new Error("span boom") as never,
    );

    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: makeBudget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).rejects.toThrow("span boom");

    expect(mockedMetricService.aggregateBy).not.toHaveBeenCalled();
  });

  test("sums multiple metric buckets", async () => {
    mockUsdMetricRows([
      { timestamp: NOW, value: 1.5 },
      { timestamp: NOW, value: 2.5 },
    ]);

    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: makeBudget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).resolves.toEqual({ spendInUSD: 4, source: "metrics" });
  });

  test("passes the budget's scope through to the metric query", async () => {
    const serviceId: ObjectID = ObjectID.generate();
    mockMetricSpend(3);

    await LlmCostBudgetEvaluator.resolveSpend({
      budget: makeBudget({ serviceId: serviceId, llmSystem: "openai" }),
      dayStart: DAY_START,
      now: NOW,
    });

    const aggregateArg: { query: Record<string, unknown> } = mockedMetricService
      .aggregateBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
    };

    expect(aggregateArg.query["primaryEntityId"]).toBe(serviceId);
    expect(aggregateArg.query["attributes"]).toEqual({
      "gen_ai.system": "openai",
    });
  });
});

describe("LlmCostBudgetEvaluator.evaluateBudget — metric-sourced spend", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSpanService.aggregateBy.mockResolvedValue({ data: [] } as never);
    mockedMetricService.aggregateBy.mockResolvedValue({ data: [] } as never);
    mockedMetricService.insertJsonRows.mockResolvedValue(undefined as never);
    mockedBudgetService.updateOneById.mockResolvedValue(undefined as never);
    mockedTelemetryUtil.indexMetricNameServiceNameMap.mockResolvedValue(
      undefined as never,
    );
  });

  test("a metrics-only project gets its spend stamped on the budget row", async () => {
    mockUsdMetricRows([{ timestamp: NOW, value: 60 }]);

    const budget: LlmCostBudget = makeBudget({ dailyBudgetInUSD: 100 });

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    const updateArg: { data: Record<string, unknown> } = mockedBudgetService
      .updateOneById.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };

    expect(updateArg.data["currentDaySpendInUSD"]).toBe(60);
  });

  test("a metrics-only project publishes the same budget series as a span-backed one", async () => {
    mockUsdMetricRows([{ timestamp: NOW, value: 80 }]);

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
    mockUsdMetricRows([{ timestamp: NOW, value: 5 }]);

    const budget: LlmCostBudget = makeBudget();

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    const rows: Array<Record<string, unknown>> = mockedMetricService
      .insertJsonRows.mock.calls[0]![0] as Array<Record<string, unknown>>;

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
