import LlmCostBudget from "../../../Models/DatabaseModels/LlmCostBudget";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import LlmCostBudgetService from "../../../Server/Services/LlmCostBudgetService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { describe, expect, test } from "@jest/globals";

/*
 * The create/update hooks are protected; reach them the way the DatabaseService
 * pipeline does, through the instance. They are pure validation (no DB access),
 * so no mocking is needed.
 */
type HookAccess = {
  onBeforeCreate: (
    createBy: CreateBy<LlmCostBudget>,
  ) => Promise<{ createBy: CreateBy<LlmCostBudget> }>;
  onBeforeUpdate: (
    updateBy: UpdateBy<LlmCostBudget>,
  ) => Promise<{ updateBy: UpdateBy<LlmCostBudget> }>;
};

const service: HookAccess = LlmCostBudgetService as unknown as HookAccess;

function makeCreateBy(data: Partial<LlmCostBudget>): CreateBy<LlmCostBudget> {
  const budget: LlmCostBudget = new LlmCostBudget();
  Object.assign(budget, data);

  return {
    data: budget,
    props: { isRoot: true },
  } as CreateBy<LlmCostBudget>;
}

function makeUpdateBy(data: Record<string, unknown>): UpdateBy<LlmCostBudget> {
  return {
    query: {},
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<LlmCostBudget>;
}

describe("LlmCostBudgetService.onBeforeCreate — dailyBudgetInUSD", () => {
  test("accepts a positive number", async () => {
    const result: { createBy: CreateBy<LlmCostBudget> } =
      await service.onBeforeCreate(makeCreateBy({ dailyBudgetInUSD: 250 }));

    expect(result.createBy.data.dailyBudgetInUSD).toBe(250);
  });

  test("coerces a numeric string to a number", async () => {
    const result: { createBy: CreateBy<LlmCostBudget> } =
      await service.onBeforeCreate(
        makeCreateBy({
          dailyBudgetInUSD: "99.50" as unknown as number,
        }),
      );

    expect(result.createBy.data.dailyBudgetInUSD).toBe(99.5);
    expect(typeof result.createBy.data.dailyBudgetInUSD).toBe("number");
  });

  test.each([
    ["zero", 0],
    ["negative", -5],
    ["NaN string", "not-a-number"],
    ["empty string", ""],
    ["missing", undefined],
  ])("rejects %s", async (_label: string, value: unknown) => {
    await expect(
      service.onBeforeCreate(
        makeCreateBy({ dailyBudgetInUSD: value as number }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("LlmCostBudgetService.onBeforeCreate — warningThresholdPercent", () => {
  test("accepts the boundary values 1 and 99", async () => {
    for (const value of [1, 99]) {
      const result: { createBy: CreateBy<LlmCostBudget> } =
        await service.onBeforeCreate(
          makeCreateBy({
            dailyBudgetInUSD: 100,
            warningThresholdPercent: value,
          }),
        );

      expect(result.createBy.data.warningThresholdPercent).toBe(value);
    }
  });

  test("coerces a numeric string threshold", async () => {
    const result: { createBy: CreateBy<LlmCostBudget> } =
      await service.onBeforeCreate(
        makeCreateBy({
          dailyBudgetInUSD: 100,
          warningThresholdPercent: "75" as unknown as number,
        }),
      );

    expect(result.createBy.data.warningThresholdPercent).toBe(75);
  });

  test("omitting the threshold is allowed — the column default applies", async () => {
    const result: { createBy: CreateBy<LlmCostBudget> } =
      await service.onBeforeCreate(makeCreateBy({ dailyBudgetInUSD: 100 }));

    expect(result.createBy.data.warningThresholdPercent).toBeUndefined();
  });

  test.each([
    ["zero", 0],
    ["100 — breach territory", 100],
    ["above 100", 150],
    ["negative", -10],
    ["non-numeric string", "eighty"],
    /*
     * The column is a Postgres integer — a fractional percent that passed
     * validation would fail the INSERT with a raw driver error.
     */
    ["fractional percent", 87.5],
    ["fractional percent string", "87.5"],
  ])("rejects %s", async (_label: string, value: unknown) => {
    await expect(
      service.onBeforeCreate(
        makeCreateBy({
          dailyBudgetInUSD: 100,
          warningThresholdPercent: value as number,
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("LlmCostBudgetService.onBeforeUpdate", () => {
  test("coerces and validates an updated budget", async () => {
    const result: { updateBy: UpdateBy<LlmCostBudget> } =
      await service.onBeforeUpdate(makeUpdateBy({ dailyBudgetInUSD: "500" }));

    expect(result.updateBy.data.dailyBudgetInUSD).toBe(500);
  });

  test("rejects an invalid updated budget", async () => {
    await expect(
      service.onBeforeUpdate(makeUpdateBy({ dailyBudgetInUSD: -1 })),
    ).rejects.toThrow(BadDataException);
  });

  test("rejects an invalid updated threshold", async () => {
    await expect(
      service.onBeforeUpdate(makeUpdateBy({ warningThresholdPercent: 100 })),
    ).rejects.toThrow(BadDataException);
  });

  test("an update touching neither numeric field passes through", async () => {
    const result: { updateBy: UpdateBy<LlmCostBudget> } =
      await service.onBeforeUpdate(makeUpdateBy({ name: "renamed" }));

    expect(result.updateBy.data["name"]).toBe("renamed");
  });
});

describe("LlmCostBudgetService.getBudgetAlertFingerprint", () => {
  test("is deterministic and distinguishes warning from breach", () => {
    const id: ObjectID = ObjectID.generate();

    const warning: string = LlmCostBudgetService.getBudgetAlertFingerprint({
      llmCostBudgetId: id,
      kind: "warning",
    });
    const breach: string = LlmCostBudgetService.getBudgetAlertFingerprint({
      llmCostBudgetId: id,
      kind: "breach",
    });

    expect(warning).toBe(`llm-cost-budget:${id.toString()}:warning`);
    expect(breach).toBe(`llm-cost-budget:${id.toString()}:breach`);
    expect(warning).not.toBe(breach);
  });
});
