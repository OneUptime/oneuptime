import ObjectID from "../../../../Types/ObjectID";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageResponse,
  emptyLlmMetricUsageFigures,
} from "../../../../Types/Telemetry/LlmMetricUsageApi";
import LlmMetricSpend from "../../../../Server/Utils/Telemetry/LlmMetricSpend";
import LlmMetricUsageReader, {
  LlmMetricUsageReadQuery,
} from "../../../../Server/Utils/Telemetry/LlmMetricUsageReader";
import { LlmMetricScope } from "../../../../Utils/Telemetry/LlmMetricQuery";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE BUDGETS' METRIC-SOURCED SPEND.
 *
 * LlmCostBudgetEvaluator falls back to the GenAI metrics when a budget's
 * spans hold no spend. That figure gates alerting, and it used to add up
 * every point of the cost counters: a cumulative counter's points are its
 * running total, so a Claude Code session exporting every minute had its
 * spend counted once per export, and a budget fired on spend that never
 * happened. LlmMetricSpend now asks LlmMetricUsageReader, which counts a
 * counter the way it counts (its own suites pin the SQL and the fold);
 * these pin how a budget's scope becomes the reader's query and what comes
 * back.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const START: Date = new Date("2026-08-26T00:00:00.000Z");
const END: Date = new Date("2026-08-26T09:30:00.000Z");

function scope(overrides?: Partial<LlmMetricScope>): LlmMetricScope {
  return {
    projectId: PROJECT_ID,
    startTime: START,
    endTime: END,
    ...overrides,
  };
}

function usage(
  overrides: Partial<LlmMetricUsageResponse["totals"]>,
): LlmMetricUsageResponse {
  return {
    totals: { ...emptyLlmMetricUsageFigures(), ...overrides },
    groups: [],
    truncated: false,
  };
}

let readSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  readSpy = jest
    .spyOn(LlmMetricUsageReader, "read")
    .mockResolvedValue(usage({}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function lastQuery(): LlmMetricUsageReadQuery {
  const calls: Array<Array<unknown>> = readSpy.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as LlmMetricUsageReadQuery;
}

describe("a budget's scope as the reader's query", () => {
  test("the project and the window, as totals", () => {
    expect(LlmMetricSpend.toReadQuery(scope())).toEqual({
      projectId: PROJECT_ID,
      startTime: START,
      endTime: END,
      dimension: LlmMetricUsageDimension.None,
      serviceId: undefined,
      llmSystem: undefined,
      llmModel: undefined,
      llmUser: undefined,
      llmTeam: undefined,
    });
  });

  test("a service, a provider and a model narrow it", () => {
    const query: LlmMetricUsageReadQuery = LlmMetricSpend.toReadQuery(
      scope({
        serviceId: SERVICE_ID,
        llmSystem: "openai",
        llmModel: "gpt-4o",
      }),
    );

    expect(query.serviceId).toBe(SERVICE_ID);
    expect(query.llmSystem).toBe("openai");
    expect(query.llmModel).toBe("gpt-4o");
  });

  test("a person is the email, else the id; a team is the team", () => {
    expect(
      LlmMetricSpend.toReadQuery(
        scope({ llmUserEmail: "ana@example.com", llmUserId: "u-1" }),
      ).llmUser,
    ).toBe("ana@example.com");
    expect(
      LlmMetricSpend.toReadQuery(scope({ llmUserId: "u-1" })).llmUser,
    ).toBe("u-1");
    expect(LlmMetricSpend.toReadQuery(scope({ llmTeam: "platform" })).llmTeam)
      .toBe("platform");
  });

  test("a budget never asks for groups: one total is all it compares", () => {
    expect(LlmMetricSpend.toReadQuery(scope()).dimension).toBe(
      LlmMetricUsageDimension.None,
    );
  });
});

describe("getCostInUSD", () => {
  test("is the reader's cost total", async () => {
    readSpy.mockResolvedValue(usage({ costUsd: 12.75, hasCost: true }) as never);

    await expect(LlmMetricSpend.getCostInUSD(scope())).resolves.toBe(12.75);
    expect(lastQuery().projectId).toBe(PROJECT_ID);
  });

  test("nothing matched is 0", async () => {
    await expect(LlmMetricSpend.getCostInUSD(scope())).resolves.toBe(0);
  });

  test("passes the budget's scope to the read", async () => {
    await LlmMetricSpend.getCostInUSD(
      scope({ serviceId: SERVICE_ID, llmSystem: "azure.ai.openai" }),
    );

    expect(lastQuery().serviceId).toBe(SERVICE_ID);
    expect(lastQuery().llmSystem).toBe("azure.ai.openai");
  });

  /*
   * A budget whose read failed must not read as a budget with no spend:
   * that would silently suppress a real breach. evaluateAllBudgets isolates
   * the failure to the one budget.
   */
  test("a failed read throws rather than reporting zero spend", async () => {
    readSpy.mockRejectedValue(new Error("Timeout exceeded") as never);

    await expect(LlmMetricSpend.getCostInUSD(scope())).rejects.toThrow(
      "Timeout exceeded",
    );
  });
});

describe("getTokenTotals", () => {
  test("are the reader's input and output totals", async () => {
    readSpy.mockResolvedValue(
      usage({ inputTokens: 1200, outputTokens: 340, hasTokens: true }) as never,
    );

    await expect(LlmMetricSpend.getTokenTotals(scope())).resolves.toEqual({
      inputTokens: 1200,
      outputTokens: 340,
    });
  });

  test("a failed read throws", async () => {
    readSpy.mockRejectedValue(new Error("boom") as never);

    await expect(LlmMetricSpend.getTokenTotals(scope())).rejects.toThrow(
      "boom",
    );
  });
});
