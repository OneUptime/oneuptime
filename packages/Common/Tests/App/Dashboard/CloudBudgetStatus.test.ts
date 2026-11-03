import { describe, expect, test } from "@jest/globals";
import {
  BUDGET_NOT_CHECKED,
  BUDGET_ON_COURSE_TO_PASS,
  BUDGET_OVER,
  BUDGET_PASSED_THRESHOLD,
  BUDGET_PAUSED,
  BUDGET_WITHIN,
  CloudBudgetStatus,
  getCloudBudgetStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudBudgetStatus";

/*
 * What a budget's row on Cloud > Budgets says of this month, from what its
 * checks last worked out: paused, not checked yet, over, past one of its
 * alert thresholds (the highest), on course to be passed, or within it.
 */

const CHECKED: Date = new Date("2026-11-20T06:00:00.000Z");

function status(
  overrides: Partial<Parameters<typeof getCloudBudgetStatus>[0]> = {},
): CloudBudgetStatus {
  return getCloudBudgetStatus({
    isEnabled: true,
    amount: 5000,
    spent: 1000,
    projected: 3000,
    thresholds: "50,80,100",
    lastCheckedAt: CHECKED,
    ...overrides,
  });
}

describe("a budget's month", () => {
  test("within it, and how much is spent", () => {
    expect(status()).toEqual({
      label: BUDGET_WITHIN,
      tone: "positive",
      percentSpent: 20,
    });
  });

  test("past a threshold: the highest one passed", () => {
    expect(status({ spent: 4100 })).toEqual({
      label: BUDGET_PASSED_THRESHOLD,
      threshold: 80,
      tone: "warning",
      percentSpent: 82,
    });
    expect(status({ spent: 2600 }).threshold).toBe(50);
    expect(BUDGET_PASSED_THRESHOLD).toContain("{{percent}}");
  });

  test("over, once all of it is spent - whatever the thresholds", () => {
    expect(status({ spent: 5000 })).toMatchObject({
      label: BUDGET_OVER,
      tone: "danger",
      percentSpent: 100,
    });
    expect(status({ spent: 6000, thresholds: "" }).percentSpent).toBe(120);
  });

  test("on course to pass: under every threshold, but heading past the amount", () => {
    expect(status({ spent: 1000, projected: 5200 })).toMatchObject({
      label: BUDGET_ON_COURSE_TO_PASS,
      tone: "warning",
    });
  });

  test("paused, or not checked yet: nothing said of its month", () => {
    expect(status({ isEnabled: false, spent: 9000 })).toMatchObject({
      label: BUDGET_PAUSED,
      tone: "neutral",
    });
    expect(status({ lastCheckedAt: null })).toMatchObject({
      label: BUDGET_NOT_CHECKED,
      tone: "neutral",
    });
    // An amount of nothing is not one to be within.
    expect(status({ amount: 0 })).toMatchObject({
      label: BUDGET_NOT_CHECKED,
      percentSpent: 0,
    });
  });

  test("figures stored as text, or not stored, are read as numbers", () => {
    expect(
      status({
        amount: "5000" as unknown as number,
        spent: "4500" as unknown as number,
        projected: undefined,
        thresholds: ["90"],
        lastCheckedAt: CHECKED.toISOString(),
      }),
    ).toMatchObject({ label: BUDGET_PASSED_THRESHOLD, threshold: 90 });
    expect(status({ spent: null, projected: null })).toMatchObject({
      label: BUDGET_WITHIN,
      percentSpent: 0,
    });
  });
});
