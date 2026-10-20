import LlmCostBudget from "../../../../Models/DatabaseModels/LlmCostBudget";
import ObjectID from "../../../../Types/ObjectID";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import LlmCostBudgetEvaluator from "../../../../Server/Utils/Telemetry/LlmCostBudgetEvaluator";
import LlmProviderSpend from "../../../../Server/Utils/LlmObservability/LlmProviderSpend";
import LlmCostBudgetService from "../../../../Server/Services/LlmCostBudgetService";
import MetricService from "../../../../Server/Services/MetricService";
import SpanService from "../../../../Server/Services/SpanService";
import LlmBudgetSpendSource from "../../../../Types/LlmObservability/LlmBudgetSpendSource";
import {
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_MODEL_ATTRIBUTE,
  LLM_PROVIDER_NAME_ATTRIBUTE,
} from "../../../../Types/LlmObservability/LlmProviderUsageMetrics";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A budget that counts the connected AI provider accounts: its spend is the
 * bill they report for the UTC day so far (oneuptime.llm.provider.cost),
 * scoped to its provider and model, never added to the spans' or metrics'
 * figure - the bill already holds those calls. `jest` is the global one, as
 * in LlmCostBudgetEvaluator.test.ts.
 */

jest.mock("../../../../Server/Services/SpanService", () => {
  return { __esModule: true, default: { aggregateBy: jest.fn() } };
});

jest.mock("../../../../Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { insertJsonRows: jest.fn(), aggregateBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: { indexMetricNameServiceNameMap: jest.fn() },
  };
});

type MockedFn = jest.Mock;

const spans: { aggregateBy: MockedFn } = SpanService as unknown as {
  aggregateBy: MockedFn;
};
const metrics: { aggregateBy: MockedFn } = MetricService as unknown as {
  aggregateBy: MockedFn;
};

const NOW: Date = new Date(Date.UTC(2026, 9, 19, 14, 30, 0));
const DAY_START: Date = new Date(Date.UTC(2026, 9, 19, 0, 0, 0));

function budget(overrides: Partial<LlmCostBudget> = {}): LlmCostBudget {
  const value: LlmCostBudget = new LlmCostBudget();
  value.id = ObjectID.generate();
  value.projectId = new ObjectID("11111111-1111-4111-8111-111111111111");
  value.name = "OpenAI bill";
  value.dailyBudgetInUSD = 100;
  value.spendSource = LlmBudgetSpendSource.Providers;
  return Object.assign(value, overrides);
}

interface AggregateCall {
  query: Record<string, unknown>;
  aggregationType: string;
  aggregateColumnName: string;
  timeoutOverflowMode: string;
  startTimestamp: Date;
  endTimestamp: Date;
}

beforeEach(() => {
  jest.clearAllMocks();
  spans.aggregateBy.mockResolvedValue({ data: [{ value: 999 }] } as never);
  metrics.aggregateBy.mockResolvedValue({ data: [] } as never);
});

describe("A budget on the provider accounts", () => {
  test("counts the providers' cost for the day so far, and never the spans", async () => {
    metrics.aggregateBy.mockResolvedValue({
      data: [{ value: 12.5 }, { value: 2.25 }],
    } as never);

    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: budget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).resolves.toEqual({ spendInUSD: 14.75, source: "providers" });

    expect(spans.aggregateBy).not.toHaveBeenCalled();

    const call: AggregateCall = metrics.aggregateBy.mock
      .calls[0]![0] as AggregateCall;
    expect(call.query["name"]).toBe(LLM_PROVIDER_COST_METRIC_NAME);
    expect(call.query["projectId"]).toEqual(budget().projectId);
    expect(call.query["time"]).toEqual(new InBetween(DAY_START, NOW));
    expect(call.query["attributes"]).toBeUndefined();
    expect(call.aggregationType).toBe("Sum");
    expect(call.aggregateColumnName).toBe("value");
    // A read that timed out must fail the evaluation, never read as less spend.
    expect(call.timeoutOverflowMode).toBe("throw");
  });

  test("is scoped to its provider and model", async () => {
    metrics.aggregateBy.mockResolvedValue({ data: [{ value: 3 }] } as never);

    await LlmCostBudgetEvaluator.resolveSpend({
      budget: budget({ llmSystem: " openai ", llmModel: "gpt-4o" }),
      dayStart: DAY_START,
      now: NOW,
    });

    const call: AggregateCall = metrics.aggregateBy.mock
      .calls[0]![0] as AggregateCall;
    expect(call.query["attributes"]).toEqual({
      [LLM_PROVIDER_NAME_ATTRIBUTE]: "openai",
      [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-4o",
    });
  });

  test("a day with no bill yet is 'none'; corrections never make it negative", async () => {
    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: budget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).resolves.toEqual({ spendInUSD: 0, source: "none" });

    metrics.aggregateBy.mockResolvedValue({
      data: [{ value: 5 }, { value: -7 }],
    } as never);
    expect(
      await LlmProviderSpend.getCostInUSD({
        projectId: budget().projectId!,
        startTime: DAY_START,
        endTime: NOW,
      }),
    ).toBe(0);
  });

  test("a failed read fails the evaluation", async () => {
    metrics.aggregateBy.mockRejectedValue(
      new Error("clickhouse timeout") as never,
    );

    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: budget(),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).rejects.toThrow("clickhouse timeout");
  });

  test("a budget on the AI calls still counts the spans", async () => {
    await expect(
      LlmCostBudgetEvaluator.resolveSpend({
        budget: budget({ spendSource: LlmBudgetSpendSource.Calls }),
        dayStart: DAY_START,
        now: NOW,
      }),
    ).resolves.toEqual({ spendInUSD: 999, source: "spans" });
  });
});

describe("LlmCostBudgetService: where a budget counts its spend", () => {
  type HookAccess = {
    onBeforeCreate: (createBy: CreateBy<LlmCostBudget>) => Promise<unknown>;
    onBeforeUpdate: (updateBy: UpdateBy<LlmCostBudget>) => Promise<unknown>;
  };
  const service: HookAccess = LlmCostBudgetService as unknown as HookAccess;

  function createBy(spendSource: unknown): CreateBy<LlmCostBudget> {
    const value: LlmCostBudget = new LlmCostBudget();
    value.dailyBudgetInUSD = 10;
    (value as unknown as Record<string, unknown>)["spendSource"] = spendSource;
    return { data: value, props: { isRoot: true } } as CreateBy<LlmCostBudget>;
  }

  test.each([[undefined], [null], ["calls"], ["providers"]])(
    "%s is accepted",
    async (spendSource: unknown) => {
      await expect(
        service.onBeforeCreate(createBy(spendSource)),
      ).resolves.toBeDefined();
      await expect(
        service.onBeforeUpdate({
          query: {},
          data: { spendSource },
          props: { isRoot: true },
        } as unknown as UpdateBy<LlmCostBudget>),
      ).resolves.toBeDefined();
    },
  );

  test.each([["both"], ["Providers"], [1]])(
    "%s is refused",
    async (spendSource: unknown) => {
      await expect(
        service.onBeforeCreate(createBy(spendSource)),
      ).rejects.toThrow(BadDataException);
      await expect(
        service.onBeforeUpdate({
          query: {},
          data: { spendSource },
          props: { isRoot: true },
        } as unknown as UpdateBy<LlmCostBudget>),
      ).rejects.toThrow("Count spend from must be");
    },
  );

  test("a new budget counts the AI calls unless told otherwise", () => {
    expect(new LlmCostBudget().spendSource ?? LlmBudgetSpendSource.Calls).toBe(
      LlmBudgetSpendSource.Calls,
    );
  });
});
