import { describe, expect, test } from "@jest/globals";
import {
  CloudAccountCostSummary,
  CloudCostState,
  CloudCostTotals,
  totalCloudCosts,
} from "../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  COST_SETUP_DOCS_PATHS,
  COST_SETUP_STEPS,
  COST_STATE_LABELS,
  LESS_THAN_LAST_MONTH,
  MORE_THAN_LAST_MONTH,
  SAME_AS_LAST_MONTH,
  SAVINGS_SETUP_DOCS_PATHS,
  SAVINGS_SETUP_STEPS,
  formatCloudMoney,
  getCloudCostGaps,
  getCloudSpendChangeLine,
  hasCloudCosts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostWords";

/*
 * How the Cloud pages say what the clouds cost: money in the reader's own
 * way of writing it, how this month compares with last month by now, and
 * why an account's costs could not be read - with what each cloud needs
 * for them to be.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");
const GERMAN: Translator = createTranslator(undefined, "de");
const PERSIAN: Translator = createTranslator(undefined, "fa");

function summary(
  overrides: Partial<CloudAccountCostSummary> = {},
): CloudAccountCostSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 0,
    lastMonth: 0,
    monthFullDays: 0,
    lastMonthToDate: 0,
    projectedMonth: 0,
    last30Days: 0,
    topServices: [],
    readAt: "2026-11-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("money", () => {
  test("whole from a thousand, with cents below it, in the reader's way of writing it", () => {
    expect(
      formatCloudMoney({
        amount: 4120.4,
        currency: "USD",
        translator: ENGLISH,
      }),
    ).toBe("$4,120");
    expect(
      formatCloudMoney({ amount: 12.4, currency: "usd", translator: ENGLISH }),
    ).toBe("$12.40");
    expect(
      formatCloudMoney({
        amount: 12.4,
        currency: "USD",
        translator: ENGLISH,
        whole: true,
      }),
    ).toBe("$12");
    // German writes the dot and the comma the other way round, the sign after.
    expect(
      formatCloudMoney({ amount: 4120, currency: "EUR", translator: GERMAN }),
    ).toBe("4.120 €");
    // Persian in its own digits.
    expect(
      formatCloudMoney({ amount: 4120, currency: "USD", translator: PERSIAN }),
    ).toMatch(/۴٬۱۲۰/);
  });

  test("a currency code Intl does not know is still written, and nothing is not a number", () => {
    expect(
      formatCloudMoney({
        amount: 5,
        currency: "NOTACODE",
        translator: ENGLISH,
      }),
    ).toBe("NOTACODE 5.00");
    expect(
      formatCloudMoney({
        amount: Number.NaN,
        currency: "USD",
        translator: ENGLISH,
      }),
    ).toBe("$0.00");
    expect(
      formatCloudMoney({ amount: 3, currency: "", translator: ENGLISH }),
    ).toBe("$3.00");
  });
});

describe("this month against last month by now", () => {
  test("more, less, the same, or nothing to compare with", () => {
    expect(
      getCloudSpendChangeLine({
        current: 1120,
        previous: 1000,
        translator: ENGLISH,
      }),
    ).toEqual({ text: "12% more than last month by now", tone: "up" });
    expect(
      getCloudSpendChangeLine({
        current: 700,
        previous: 1000,
        translator: ENGLISH,
      }),
    ).toEqual({ text: "30% less than last month by now", tone: "down" });
    expect(
      getCloudSpendChangeLine({
        current: 1003,
        previous: 1000,
        translator: ENGLISH,
      }),
    ).toEqual({ text: SAME_AS_LAST_MONTH, tone: "flat" });
    expect(
      getCloudSpendChangeLine({
        current: 10,
        previous: 0,
        translator: ENGLISH,
      }),
    ).toBeNull();
    expect(MORE_THAN_LAST_MONTH).toContain("{{percent}}");
    expect(LESS_THAN_LAST_MONTH).toContain("{{percent}}");
  });
});

describe("accounts whose costs are not read", () => {
  test("listed with why, so none is read as costing nothing", () => {
    expect(
      getCloudCostGaps([
        { name: "web", provider: "aws", summary: summary() },
        {
          name: "data",
          provider: "azure",
          summary: summary({
            state: CloudCostState.NotAllowed,
            message: "Give it Cost Management Reader.",
          }),
        },
        { name: "new", provider: "gcp", summary: null },
      ]),
    ).toEqual([
      {
        accountName: "data",
        provider: "azure",
        state: CloudCostState.NotAllowed,
        message: "Give it Cost Management Reader.",
      },
    ]);
  });

  test("costs are shown once any account's are read", () => {
    const none: CloudCostTotals = totalCloudCosts([
      summary({ state: CloudCostState.NotSetUp }),
    ]);
    const some: CloudCostTotals = totalCloudCosts([
      summary({ monthToDate: 1 }),
    ]);

    expect(hasCloudCosts(none)).toBe(false);
    expect(hasCloudCosts(some)).toBe(true);
  });

  test("every state has its label, and every cloud its step and its guide's section", () => {
    for (const state of Object.values(CloudCostState)) {
      expect(COST_STATE_LABELS[state]).toBeTruthy();
    }

    for (const provider of Object.values(CloudProvider)) {
      expect(COST_SETUP_STEPS[provider]).toBeTruthy();
      expect(SAVINGS_SETUP_STEPS[provider]).toBeTruthy();
      expect(COST_SETUP_DOCS_PATHS[provider]).toMatch(
        /^\/docs\/telemetry\/cloud-costs#[a-z-]+$/,
      );
      expect(SAVINGS_SETUP_DOCS_PATHS[provider]).toMatch(
        /^\/docs\/telemetry\/cloud-costs#[a-z-]+$/,
      );
    }

    // What each cloud needs, in the words of its own console.
    expect(COST_SETUP_STEPS[CloudProvider.AWS]).toContain("Cost Explorer");
    expect(COST_SETUP_STEPS[CloudProvider.Azure]).toContain(
      "Cost Management Reader",
    );
    expect(COST_SETUP_STEPS[CloudProvider.GCP]).toContain("BigQuery");
    expect(SAVINGS_SETUP_STEPS[CloudProvider.AWS]).toContain(
      "Cost Optimization Hub",
    );
  });
});
