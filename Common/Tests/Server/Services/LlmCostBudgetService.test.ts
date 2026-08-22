import LlmCostBudget from "../../../Models/DatabaseModels/LlmCostBudget";
import BadDataException from "../../../Types/Exception/BadDataException";
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

  test("accepts a fractional budget", async () => {
    const result: { createBy: CreateBy<LlmCostBudget> } =
      await service.onBeforeCreate(makeCreateBy({ dailyBudgetInUSD: 0.5 }));

    expect(result.createBy.data.dailyBudgetInUSD).toBe(0.5);
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

  test("an update not touching the budget passes through", async () => {
    const result: { updateBy: UpdateBy<LlmCostBudget> } =
      await service.onBeforeUpdate(makeUpdateBy({ name: "renamed" }));

    expect(result.updateBy.data["name"]).toBe("renamed");
  });
});
