import LlmCostBudget from "../../../../Models/DatabaseModels/LlmCostBudget";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Span from "../../../../Models/AnalyticsModels/Span";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Query from "../../../../Types/BaseDatabase/Query";
import ObjectID from "../../../../Types/ObjectID";
import LlmCostBudgetEvaluator, {
  DEFAULT_WARNING_THRESHOLD_PERCENT,
  LlmCostBudgetDecision,
} from "../../../../Server/Utils/Telemetry/LlmCostBudgetEvaluator";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import LlmCostBudgetService from "../../../../Server/Services/LlmCostBudgetService";
import SpanService from "../../../../Server/Services/SpanService";
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

jest.mock("../../../../Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/AlertSeverityService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/LlmCostBudgetService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      getBudgetAlertFingerprint: jest.fn(
        (data: {
          llmCostBudgetId: { toString: () => string };
          kind: string;
        }): string => {
          return `llm-cost-budget:${data.llmCostBudgetId.toString()}:${data.kind}`;
        },
      ),
    },
  };
});

type MockedFn = jest.Mock;

const mockedSpanService: { aggregateBy: MockedFn } = SpanService as unknown as {
  aggregateBy: MockedFn;
};

const mockedAlertService: { findOneBy: MockedFn; create: MockedFn } =
  AlertService as unknown as {
    findOneBy: MockedFn;
    create: MockedFn;
  };

const mockedAlertSeverityService: { findOneBy: MockedFn } =
  AlertSeverityService as unknown as {
    findOneBy: MockedFn;
  };

const mockedBudgetService: {
  findBy: MockedFn;
  updateOneById: MockedFn;
  getBudgetAlertFingerprint: MockedFn;
} = LlmCostBudgetService as unknown as {
  findBy: MockedFn;
  updateOneById: MockedFn;
  getBudgetAlertFingerprint: MockedFn;
};

// 2026-08-21 14:30:00 UTC — an arbitrary mid-day instant.
const NOW: Date = new Date(Date.UTC(2026, 7, 21, 14, 30, 0));

function makeDecisionInput(overrides: {
  spendInUSD?: number;
  dailyBudgetInUSD?: number;
  warningThresholdPercent?: number | undefined;
  lastWarningAlertCreatedAt?: Date | undefined;
  lastBreachAlertCreatedAt?: Date | undefined;
  now?: Date;
}): Parameters<typeof LlmCostBudgetEvaluator.decide>[0] {
  return {
    spendInUSD: overrides.spendInUSD ?? 0,
    dailyBudgetInUSD: overrides.dailyBudgetInUSD ?? 100,
    warningThresholdPercent: overrides.warningThresholdPercent,
    lastWarningAlertCreatedAt: overrides.lastWarningAlertCreatedAt,
    lastBreachAlertCreatedAt: overrides.lastBreachAlertCreatedAt,
    now: overrides.now ?? NOW,
  };
}

describe("LlmCostBudgetEvaluator.decide — thresholds", () => {
  test("spend below the warning threshold fires nothing", () => {
    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({ spendInUSD: 50 }),
    );

    expect(decision.percentUsed).toBe(50);
    expect(decision.shouldFireWarning).toBe(false);
    expect(decision.shouldFireBreach).toBe(false);
  });

  test("spend exactly at the default 80% threshold fires a warning", () => {
    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({ spendInUSD: 80 }),
    );

    expect(decision.percentUsed).toBe(80);
    expect(decision.shouldFireWarning).toBe(true);
    expect(decision.shouldFireBreach).toBe(false);
  });

  test("spend just under 100% fires only a warning", () => {
    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({ spendInUSD: 99.99 }),
    );

    expect(decision.shouldFireWarning).toBe(true);
    expect(decision.shouldFireBreach).toBe(false);
  });

  test("spend exactly at 100% fires a breach, not a warning", () => {
    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({ spendInUSD: 100 }),
    );

    expect(decision.percentUsed).toBe(100);
    expect(decision.shouldFireWarning).toBe(false);
    expect(decision.shouldFireBreach).toBe(true);
  });

  test("spend that jumps straight past 100% fires one breach only", () => {
    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({ spendInUSD: 250 }),
    );

    expect(decision.percentUsed).toBe(250);
    expect(decision.shouldFireWarning).toBe(false);
    expect(decision.shouldFireBreach).toBe(true);
  });

  test("a custom warning threshold is honored", () => {
    const at49: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({ spendInUSD: 49, warningThresholdPercent: 50 }),
    );
    const at50: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({ spendInUSD: 50, warningThresholdPercent: 50 }),
    );

    expect(at49.shouldFireWarning).toBe(false);
    expect(at50.shouldFireWarning).toBe(true);
  });

  test("invalid warning thresholds fall back to the default", () => {
    for (const bad of [0, -5, 100, 150, NaN]) {
      const below: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
        makeDecisionInput({
          spendInUSD: DEFAULT_WARNING_THRESHOLD_PERCENT - 1,
          warningThresholdPercent: bad,
        }),
      );
      const at: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
        makeDecisionInput({
          spendInUSD: DEFAULT_WARNING_THRESHOLD_PERCENT,
          warningThresholdPercent: bad,
        }),
      );

      expect(below.shouldFireWarning).toBe(false);
      expect(at.shouldFireWarning).toBe(true);
    }
  });

  test("undefined warning threshold uses the default", () => {
    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({
        spendInUSD: DEFAULT_WARNING_THRESHOLD_PERCENT,
        warningThresholdPercent: undefined,
      }),
    );

    expect(decision.shouldFireWarning).toBe(true);
  });
});

describe("LlmCostBudgetEvaluator.decide — invalid inputs never fire", () => {
  test.each([
    ["zero budget", { spendInUSD: 100, dailyBudgetInUSD: 0 }],
    ["negative budget", { spendInUSD: 100, dailyBudgetInUSD: -10 }],
    ["NaN budget", { spendInUSD: 100, dailyBudgetInUSD: NaN }],
    ["Infinity budget", { spendInUSD: 100, dailyBudgetInUSD: Infinity }],
    ["negative spend", { spendInUSD: -1, dailyBudgetInUSD: 100 }],
    ["NaN spend", { spendInUSD: NaN, dailyBudgetInUSD: 100 }],
  ])("%s", (_label: string, input: Record<string, unknown>) => {
    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput(input as { spendInUSD: number }),
    );

    expect(decision.percentUsed).toBe(0);
    expect(decision.shouldFireWarning).toBe(false);
    expect(decision.shouldFireBreach).toBe(false);
  });

  test("zero spend against a valid budget is quiet", () => {
    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({ spendInUSD: 0 }),
    );

    expect(decision.percentUsed).toBe(0);
    expect(decision.shouldFireWarning).toBe(false);
    expect(decision.shouldFireBreach).toBe(false);
  });
});

describe("LlmCostBudgetEvaluator.decide — once-per-UTC-day dedup", () => {
  test("warning does not re-fire when already warned today", () => {
    const earlierToday: Date = new Date(Date.UTC(2026, 7, 21, 2, 0, 0));

    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({
        spendInUSD: 90,
        lastWarningAlertCreatedAt: earlierToday,
      }),
    );

    expect(decision.shouldFireWarning).toBe(false);
  });

  test("warning re-fires the next UTC day", () => {
    const yesterday: Date = new Date(Date.UTC(2026, 7, 20, 23, 59, 59));

    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({
        spendInUSD: 90,
        lastWarningAlertCreatedAt: yesterday,
      }),
    );

    expect(decision.shouldFireWarning).toBe(true);
  });

  test("breach does not re-fire when already breached today", () => {
    const earlierToday: Date = new Date(Date.UTC(2026, 7, 21, 1, 0, 0));

    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({
        spendInUSD: 150,
        lastBreachAlertCreatedAt: earlierToday,
      }),
    );

    expect(decision.shouldFireBreach).toBe(false);
    // Breach supersedes warning even when suppressed — no downgrade alert.
    expect(decision.shouldFireWarning).toBe(false);
  });

  test("breach fires even when a warning already fired earlier today", () => {
    const earlierToday: Date = new Date(Date.UTC(2026, 7, 21, 9, 0, 0));

    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({
        spendInUSD: 120,
        lastWarningAlertCreatedAt: earlierToday,
      }),
    );

    expect(decision.shouldFireBreach).toBe(true);
  });

  test("breach re-fires on a fresh UTC day", () => {
    const yesterday: Date = new Date(Date.UTC(2026, 7, 20, 12, 0, 0));

    const decision: LlmCostBudgetDecision = LlmCostBudgetEvaluator.decide(
      makeDecisionInput({
        spendInUSD: 150,
        lastBreachAlertCreatedAt: yesterday,
      }),
    );

    expect(decision.shouldFireBreach).toBe(true);
  });
});

describe("LlmCostBudgetEvaluator UTC day helpers", () => {
  test("getUtcDayStart returns midnight UTC of the same day", () => {
    const dayStart: Date = LlmCostBudgetEvaluator.getUtcDayStart(NOW);

    expect(dayStart.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  test("getUtcDayStart is idempotent", () => {
    const once: Date = LlmCostBudgetEvaluator.getUtcDayStart(NOW);
    const twice: Date = LlmCostBudgetEvaluator.getUtcDayStart(once);

    expect(twice.getTime()).toBe(once.getTime());
  });

  test("isSameUtcDay is false for undefined", () => {
    expect(LlmCostBudgetEvaluator.isSameUtcDay(undefined, NOW)).toBe(false);
  });

  test("isSameUtcDay is true across hours of the same UTC day", () => {
    const morning: Date = new Date(Date.UTC(2026, 7, 21, 0, 0, 1));
    const night: Date = new Date(Date.UTC(2026, 7, 21, 23, 59, 59));

    expect(LlmCostBudgetEvaluator.isSameUtcDay(morning, night)).toBe(true);
  });

  test("isSameUtcDay is false one second across midnight UTC", () => {
    const beforeMidnight: Date = new Date(Date.UTC(2026, 7, 20, 23, 59, 59));
    const afterMidnight: Date = new Date(Date.UTC(2026, 7, 21, 0, 0, 0));

    expect(
      LlmCostBudgetEvaluator.isSameUtcDay(beforeMidnight, afterMidnight),
    ).toBe(false);
  });

  test("isSameUtcDay does not confuse the same day-of-month across months or years", () => {
    const sameDayOtherMonth: Date = new Date(Date.UTC(2026, 6, 21, 14, 0, 0));
    const sameDayOtherYear: Date = new Date(Date.UTC(2025, 7, 21, 14, 0, 0));

    expect(LlmCostBudgetEvaluator.isSameUtcDay(sameDayOtherMonth, NOW)).toBe(
      false,
    );
    expect(LlmCostBudgetEvaluator.isSameUtcDay(sameDayOtherYear, NOW)).toBe(
      false,
    );
  });
});

function makeBudget(overrides?: Partial<LlmCostBudget>): LlmCostBudget {
  const budget: LlmCostBudget = new LlmCostBudget();
  budget.id = ObjectID.generate();
  budget.projectId = ObjectID.generate();
  budget.name = "Prod LLM budget";
  budget.dailyBudgetInUSD = 100;
  budget.warningThresholdPercent = 80;

  return Object.assign(budget, overrides);
}

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

describe("LlmCostBudgetEvaluator.evaluateBudget — orchestration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSpanService.aggregateBy.mockResolvedValue({ data: [] } as never);
    mockedAlertService.findOneBy.mockResolvedValue(null as never);
    mockedAlertService.create.mockResolvedValue(new Alert() as never);
    mockedAlertSeverityService.findOneBy.mockResolvedValue(null as never);
    mockedBudgetService.updateOneById.mockResolvedValue(undefined as never);
  });

  function mockSpend(valueInUSD: number): void {
    mockedSpanService.aggregateBy.mockResolvedValue({
      data: [{ timestamp: NOW, value: valueInUSD }],
    } as never);
  }

  test("stamps spend on the budget even when nothing fires", async () => {
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
    expect(mockedAlertService.create).not.toHaveBeenCalled();
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

  test("fires a warning alert with fingerprint, severity, and on-call stubs", async () => {
    const severityId: ObjectID = ObjectID.generate();
    const policyId: ObjectID = ObjectID.generate();
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = policyId;

    const budget: LlmCostBudget = makeBudget({
      alertSeverityId: severityId,
      onCallDutyPolicies: [policy],
    });
    mockSpend(85);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedAlertService.create).toHaveBeenCalledTimes(1);
    const created: Alert = (
      mockedAlertService.create.mock.calls[0]![0] as { data: Alert }
    ).data;

    expect(created.title).toContain("warning");
    expect(created.title).toContain(budget.name!);
    expect(created.description).toContain("$85.00");
    expect(created.description).toContain("$100.00");
    expect(created.description).toContain("85%");
    expect(created.alertSeverityId).toBe(severityId);
    expect(created.seriesFingerprint).toBe(
      `llm-cost-budget:${budget.id!.toString()}:warning`,
    );
    expect(created.isCreatedAutomatically).toBe(true);
    expect(created.onCallDutyPolicies).toHaveLength(1);
    expect(created.onCallDutyPolicies![0]!._id).toBe(policyId.toString());

    // Budget severity was provided — no fallback lookup.
    expect(mockedAlertSeverityService.findOneBy).not.toHaveBeenCalled();

    // Second update stamps the warning dedup timestamp.
    expect(mockedBudgetService.updateOneById).toHaveBeenCalledTimes(2);
    const stampArg: { data: Record<string, unknown> } = mockedBudgetService
      .updateOneById.mock.calls[1]![0] as {
      data: Record<string, unknown>;
    };
    expect(stampArg.data["lastWarningAlertCreatedAt"]).toBe(NOW);
  });

  test("fires a breach alert past 100% and stamps the breach timestamp", async () => {
    const budget: LlmCostBudget = makeBudget({
      alertSeverityId: ObjectID.generate(),
    });
    mockSpend(130);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedAlertService.create).toHaveBeenCalledTimes(1);
    const created: Alert = (
      mockedAlertService.create.mock.calls[0]![0] as { data: Alert }
    ).data;

    expect(created.title).toContain("exceeded");
    expect(created.seriesFingerprint).toBe(
      `llm-cost-budget:${budget.id!.toString()}:breach`,
    );

    const stampArg: { data: Record<string, unknown> } = mockedBudgetService
      .updateOneById.mock.calls[1]![0] as {
      data: Record<string, unknown>;
    };
    expect(stampArg.data["lastBreachAlertCreatedAt"]).toBe(NOW);
    expect(stampArg.data["lastWarningAlertCreatedAt"]).toBeUndefined();
  });

  test("scope filters appear in the alert description", async () => {
    const budget: LlmCostBudget = makeBudget({
      alertSeverityId: ObjectID.generate(),
      llmSystem: "openai",
      llmModel: "gpt-4o",
    });
    mockSpend(85);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    const created: Alert = (
      mockedAlertService.create.mock.calls[0]![0] as { data: Alert }
    ).data;
    expect(created.description).toContain("provider openai");
    expect(created.description).toContain("model gpt-4o");
  });

  test("an open alert in the same series suppresses creation and the stamp", async () => {
    const budget: LlmCostBudget = makeBudget({
      alertSeverityId: ObjectID.generate(),
    });
    mockSpend(85);
    mockedAlertService.findOneBy.mockResolvedValue(new Alert() as never);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedAlertService.create).not.toHaveBeenCalled();
    // Only the spend stamp — no dedup-timestamp update.
    expect(mockedBudgetService.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("falls back to the project's lowest-order severity", async () => {
    const fallbackSeverityId: ObjectID = ObjectID.generate();
    const severity: AlertSeverity = new AlertSeverity();
    severity.id = fallbackSeverityId;

    // makeBudget sets no alertSeverityId — the fallback path.
    const budget: LlmCostBudget = makeBudget();
    mockSpend(85);
    mockedAlertSeverityService.findOneBy.mockResolvedValue(severity as never);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedAlertSeverityService.findOneBy).toHaveBeenCalledTimes(1);
    const created: Alert = (
      mockedAlertService.create.mock.calls[0]![0] as { data: Alert }
    ).data;
    expect(created.alertSeverityId!.toString()).toBe(
      fallbackSeverityId.toString(),
    );
  });

  test("a project with no severity at all skips alert creation gracefully", async () => {
    const budget: LlmCostBudget = makeBudget();
    mockSpend(85);
    mockedAlertSeverityService.findOneBy.mockResolvedValue(null as never);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedAlertService.create).not.toHaveBeenCalled();
    // No stamp — the alert never fired, so tomorrow's evaluation retries.
    expect(mockedBudgetService.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("a warning already fired today does not create another alert", async () => {
    const budget: LlmCostBudget = makeBudget({
      alertSeverityId: ObjectID.generate(),
      lastWarningAlertCreatedAt: new Date(Date.UTC(2026, 7, 21, 3, 0, 0)),
    });
    mockSpend(85);

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedAlertService.create).not.toHaveBeenCalled();
  });

  test("budgets missing required fields are skipped without side effects", async () => {
    const budget: LlmCostBudget = makeBudget();
    delete budget.dailyBudgetInUSD;

    await LlmCostBudgetEvaluator.evaluateBudget({ budget, now: NOW });

    expect(mockedSpanService.aggregateBy).not.toHaveBeenCalled();
    expect(mockedBudgetService.updateOneById).not.toHaveBeenCalled();
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
    mockedAlertService.findOneBy.mockResolvedValue(null as never);
    mockedAlertService.create.mockResolvedValue(new Alert() as never);
    mockedBudgetService.updateOneById.mockResolvedValue(undefined as never);
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

    // The healthy budget still got its spend stamped.
    expect(mockedBudgetService.updateOneById).toHaveBeenCalledTimes(1);
    const updateArg: { id: ObjectID } = mockedBudgetService.updateOneById.mock
      .calls[0]![0] as { id: ObjectID };
    expect(updateArg.id.toString()).toBe(healthy.id!.toString());
  });

  test("no enabled budgets means no ClickHouse queries at all", async () => {
    mockedBudgetService.findBy.mockResolvedValue([] as never);

    await LlmCostBudgetEvaluator.evaluateAllBudgets();

    expect(mockedSpanService.aggregateBy).not.toHaveBeenCalled();
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
