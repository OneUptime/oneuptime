import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import {
  BillingPeriod,
  YearlySaving,
  findPlanByPlanId,
  formatPlanPriceInUSD,
  getBillingPeriodOfPlanId,
  getChargePerUserInUSD,
  getDefaultPlanIdForNewProject,
  getMonthlyPricePerUserInUSD,
  getPlanIdForPeriod,
  getTrialDays,
  getYearlySaving,
  getYearlySavingPercent,
  isPlanFree,
} from "../../../Types/Billing/SubscriptionPlanPricing";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What a plan costs, as every plan picker quotes it (SubscriptionPlanPricing).
 *
 * The Create New Project dialog and the Billing page's Change Plan switch
 * said "Yearly Plan (Save 20%)" whatever the prices were. OneUptime Cloud's
 * plans (the SUBSCRIPTION_PLAN_* lines of packages/Common/test-setup.sh,
 * which the Common, App and Enterprise suites run with) save 9% (Growth,
 * $22 a month or $20 a month billed yearly) and 15% (Scale, $99 or $84):
 * nobody was ever offered 20%. The saving is now worked out from the prices,
 * rounded down so it never promises more than they give.
 */

const FREE: SubscriptionPlan = new SubscriptionPlan(
  "price_free_month",
  "price_free_year",
  "Free",
  0,
  0,
  1,
  0,
);
const GROWTH: SubscriptionPlan = new SubscriptionPlan(
  "price_growth_month",
  "price_growth_year",
  "Growth",
  22,
  20,
  2,
  14,
);
const SCALE: SubscriptionPlan = new SubscriptionPlan(
  "price_scale_month",
  "price_scale_year",
  "Scale",
  99,
  84,
  3,
  14,
);
const ENTERPRISE: SubscriptionPlan = new SubscriptionPlan(
  "price_enterprise_month",
  "price_enterprise_year",
  "Enterprise",
  -1,
  -1,
  4,
  14,
);

const CLOUD_PLANS: Array<SubscriptionPlan> = [FREE, GROWTH, SCALE, ENTERPRISE];

type PlanFunction = (data: {
  monthly: number;
  yearly: number;
  trial?: number;
  name?: string;
}) => SubscriptionPlan;

const plan: PlanFunction = (data: {
  monthly: number;
  yearly: number;
  trial?: number;
  name?: string;
}): SubscriptionPlan => {
  const name: string = data.name || "Plan";

  return new SubscriptionPlan(
    `${name}_month`,
    `${name}_year`,
    name,
    data.monthly,
    data.yearly,
    1,
    data.trial || 0,
  );
};

describe("SubscriptionPlanPricing", () => {
  describe("the Stripe price for a period", () => {
    it("is the yearly price id for Yearly and the monthly one for Monthly", () => {
      expect(getPlanIdForPeriod(GROWTH, BillingPeriod.Yearly)).toBe(
        "price_growth_year",
      );
      expect(getPlanIdForPeriod(GROWTH, BillingPeriod.Monthly)).toBe(
        "price_growth_month",
      );
    });

    it("tells which period a plan id is billed by", () => {
      expect(getBillingPeriodOfPlanId(SCALE, "price_scale_year")).toBe(
        BillingPeriod.Yearly,
      );
      expect(getBillingPeriodOfPlanId(SCALE, "price_scale_month")).toBe(
        BillingPeriod.Monthly,
      );
      expect(getBillingPeriodOfPlanId(SCALE, "price_growth_year")).toBeNull();
      expect(getBillingPeriodOfPlanId(SCALE, "")).toBeNull();
    });

    it("reads one id configured for both periods as yearly, as SubscriptionPlan.isYearlyPlan does", () => {
      const sameIds: SubscriptionPlan = new SubscriptionPlan(
        "price_one",
        "price_one",
        "Growth",
        22,
        20,
        2,
        14,
      );

      expect(getBillingPeriodOfPlanId(sameIds, "price_one")).toBe(
        BillingPeriod.Yearly,
      );
    });

    it("finds the plan by either of its prices, and nothing for anything else", () => {
      expect(findPlanByPlanId(CLOUD_PLANS, "price_scale_month")).toBe(SCALE);
      expect(findPlanByPlanId(CLOUD_PLANS, "price_scale_year")).toBe(SCALE);
      expect(findPlanByPlanId(CLOUD_PLANS, "price_unknown")).toBeUndefined();
      expect(findPlanByPlanId(CLOUD_PLANS, "")).toBeUndefined();
      expect(findPlanByPlanId(CLOUD_PLANS, null)).toBeUndefined();
      expect(findPlanByPlanId(CLOUD_PLANS, undefined)).toBeUndefined();
      expect(findPlanByPlanId([], "price_scale_year")).toBeUndefined();
    });
  });

  describe("what a user costs", () => {
    it("is quoted per month: the monthly price, or the yearly price per month", () => {
      expect(getMonthlyPricePerUserInUSD(GROWTH, BillingPeriod.Monthly)).toBe(
        22,
      );
      expect(getMonthlyPricePerUserInUSD(GROWTH, BillingPeriod.Yearly)).toBe(
        20,
      );
      expect(getMonthlyPricePerUserInUSD(FREE, BillingPeriod.Yearly)).toBe(0);
    });

    it("is charged a month at a time, or twelve months at once when billed yearly", () => {
      expect(getChargePerUserInUSD(GROWTH, BillingPeriod.Monthly)).toBe(22);
      expect(getChargePerUserInUSD(GROWTH, BillingPeriod.Yearly)).toBe(240);
      expect(getChargePerUserInUSD(SCALE, BillingPeriod.Monthly)).toBe(99);
      expect(getChargePerUserInUSD(SCALE, BillingPeriod.Yearly)).toBe(1008);
      expect(getChargePerUserInUSD(FREE, BillingPeriod.Yearly)).toBe(0);
    });

    it("has no price when the price is custom (Enterprise)", () => {
      expect(
        getMonthlyPricePerUserInUSD(ENTERPRISE, BillingPeriod.Monthly),
      ).toBeNull();
      expect(
        getMonthlyPricePerUserInUSD(ENTERPRISE, BillingPeriod.Yearly),
      ).toBeNull();
      expect(
        getChargePerUserInUSD(ENTERPRISE, BillingPeriod.Yearly),
      ).toBeNull();
    });

    it("is free only at $0, and a custom price is never free", () => {
      expect(isPlanFree(FREE, BillingPeriod.Monthly)).toBe(true);
      expect(isPlanFree(FREE, BillingPeriod.Yearly)).toBe(true);
      expect(isPlanFree(GROWTH, BillingPeriod.Yearly)).toBe(false);
      expect(isPlanFree(ENTERPRISE, BillingPeriod.Yearly)).toBe(false);
      // Free only yearly: the monthly price still costs money.
      const yearlyOnlyFree: SubscriptionPlan = plan({ monthly: 5, yearly: 0 });
      expect(isPlanFree(yearlyOnlyFree, BillingPeriod.Yearly)).toBe(true);
      expect(isPlanFree(yearlyOnlyFree, BillingPeriod.Monthly)).toBe(false);
    });
  });

  describe("the trial a new project starts with", () => {
    it("is the plan's trial period in days", () => {
      expect(getTrialDays(GROWTH)).toBe(14);
      expect(getTrialDays(FREE)).toBe(0);
    });

    it("is none for a period that is not a positive number", () => {
      expect(getTrialDays(plan({ monthly: 1, yearly: 1, trial: -3 }))).toBe(0);
      expect(getTrialDays(plan({ monthly: 1, yearly: 1, trial: NaN }))).toBe(0);
      // SubscriptionPlan.getSubscriptionPlans parses an empty trial as NaN.
      const parsed: Array<SubscriptionPlan> =
        SubscriptionPlan.getSubscriptionPlans({
          SUBSCRIPTION_PLAN_X: "Growth,m,y,22,20,2,",
        });
      expect(getTrialDays(parsed[0]!)).toBe(0);
    });

    it("counts whole days", () => {
      expect(getTrialDays(plan({ monthly: 1, yearly: 1, trial: 7.9 }))).toBe(7);
    });
  });

  describe("what yearly saves", () => {
    it("is 9% on Growth and 15% on Scale, rounded down - never the 20% it used to promise", () => {
      expect(getYearlySavingPercent(GROWTH)).toBe(9);
      expect(getYearlySavingPercent(SCALE)).toBe(15);
      expect(getYearlySaving(CLOUD_PLANS)).toEqual({
        percent: 15,
        isSameForEveryPlan: false,
      } as YearlySaving);
    });

    it("is exactly what the prices give when they give a whole percent", () => {
      expect(getYearlySavingPercent(plan({ monthly: 25, yearly: 20 }))).toBe(
        20,
      );
      expect(getYearlySavingPercent(plan({ monthly: 10, yearly: 5 }))).toBe(50);
      // (100 - 71) / 100 * 100 is 28.999999999999996 in floating point.
      expect(getYearlySavingPercent(plan({ monthly: 100, yearly: 71 }))).toBe(
        29,
      );
    });

    it("is exact for every whole-dollar price pair up to $300", () => {
      for (let monthly: number = 1; monthly <= 300; monthly++) {
        for (let yearly: number = 0; yearly < monthly; yearly++) {
          const percent: number = getYearlySavingPercent(
            plan({ monthly: monthly, yearly: yearly }),
          );

          // Whole numbers: the saving in hundredths of a dollar, no rounding.
          const savedHundredths: number = (monthly - yearly) * 100;

          expect(percent * monthly <= savedHundredths).toBe(true);
          expect((percent + 1) * monthly > savedHundredths).toBe(true);
        }
      }
    });

    it("is nothing on a free plan, a custom price, or a yearly price that is not lower", () => {
      expect(getYearlySavingPercent(FREE)).toBe(0);
      expect(getYearlySavingPercent(ENTERPRISE)).toBe(0);
      expect(getYearlySavingPercent(plan({ monthly: 20, yearly: 20 }))).toBe(0);
      expect(getYearlySavingPercent(plan({ monthly: 20, yearly: 25 }))).toBe(0);
      expect(getYearlySavingPercent(plan({ monthly: 20, yearly: -2 }))).toBe(0);
      expect(getYearlySavingPercent(plan({ monthly: NaN, yearly: 2 }))).toBe(0);
    });

    it("says 'the same for every plan' only when every paid plan saves that much", () => {
      const a: SubscriptionPlan = plan({ monthly: 25, yearly: 20, name: "A" });
      const b: SubscriptionPlan = plan({ monthly: 50, yearly: 40, name: "B" });
      const c: SubscriptionPlan = plan({ monthly: 50, yearly: 50, name: "C" });

      expect(getYearlySaving([FREE, a, b, ENTERPRISE])).toEqual({
        percent: 20,
        isSameForEveryPlan: true,
      });
      // C saves nothing yearly, so A and B save "up to" 20%.
      expect(getYearlySaving([FREE, a, b, c])).toEqual({
        percent: 20,
        isSameForEveryPlan: false,
      });
    });

    it("is null when no plan is cheaper yearly", () => {
      expect(getYearlySaving([])).toBeNull();
      expect(getYearlySaving([FREE, ENTERPRISE])).toBeNull();
      expect(getYearlySaving([plan({ monthly: 9, yearly: 9 })])).toBeNull();
    });

    it("never promises more than the prices give, for any prices", () => {
      const random: SeededRandom = seededRandom(20261016);

      for (let draw: number = 0; draw < 2000; draw++) {
        const monthly: number = 1 + random(500);
        const yearly: number = random(monthly + 50);
        const percent: number = getYearlySavingPercent(
          plan({ monthly: monthly, yearly: yearly }),
        );
        const trueSaving: number =
          yearly < monthly ? ((monthly - yearly) / monthly) * 100 : 0;

        expect(Number.isInteger(percent)).toBe(true);
        expect(percent).toBeGreaterThanOrEqual(0);
        expect(percent).toBeLessThanOrEqual(trueSaving + 1e-9);
        expect(trueSaving - percent).toBeLessThan(1);
      }
    });

    it("holds for the plans OneUptime Cloud is configured with", () => {
      const setup: string = fs.readFileSync(
        path.join(__dirname, "..", "..", "..", "test-setup.sh"),
        "utf8",
      );
      const env: Record<string, string> = {};

      for (const line of setup.split("\n")) {
        if (line.startsWith("SUBSCRIPTION_PLAN_")) {
          const separator: number = line.indexOf("=");
          env[line.slice(0, separator)] = line.slice(separator + 1);
        }
      }

      const cloud: Array<SubscriptionPlan> =
        SubscriptionPlan.getSubscriptionPlans(env);

      expect(
        cloud.map((cloudPlan: SubscriptionPlan): string => {
          return cloudPlan.getName();
        }),
      ).toEqual(["Free", "Growth", "Scale", "Enterprise"]);
      expect(getYearlySaving(cloud)).toEqual({
        percent: 15,
        isSameForEveryPlan: false,
      });
      expect(
        cloud.map((cloudPlan: SubscriptionPlan): number => {
          return getYearlySavingPercent(cloudPlan);
        }),
      ).toEqual([0, 9, 15, 0]);
      expect(getDefaultPlanIdForNewProject(cloud, BillingPeriod.Yearly)).toBe(
        cloud[0]!.getYearlyPlanId(),
      );
    });
  });

  describe("the plan a new project starts on", () => {
    it("is the first free plan, at the period shown", () => {
      expect(
        getDefaultPlanIdForNewProject(CLOUD_PLANS, BillingPeriod.Yearly),
      ).toBe("price_free_year");
      expect(
        getDefaultPlanIdForNewProject(CLOUD_PLANS, BillingPeriod.Monthly),
      ).toBe("price_free_month");
    });

    it("is the free one wherever it is listed", () => {
      expect(
        getDefaultPlanIdForNewProject(
          [GROWTH, SCALE, FREE],
          BillingPeriod.Yearly,
        ),
      ).toBe("price_free_year");
    });

    it("is none when every plan costs money: a paid plan is always picked on purpose", () => {
      expect(
        getDefaultPlanIdForNewProject(
          [GROWTH, SCALE, ENTERPRISE],
          BillingPeriod.Yearly,
        ),
      ).toBeNull();
      expect(
        getDefaultPlanIdForNewProject([], BillingPeriod.Yearly),
      ).toBeNull();
    });
  });

  describe("prices as the pricing page writes them", () => {
    it("writes whole dollars without cents and with a thousands separator", () => {
      expect(formatPlanPriceInUSD(0)).toBe("$0");
      expect(formatPlanPriceInUSD(20)).toBe("$20");
      expect(formatPlanPriceInUSD(240)).toBe("$240");
      expect(formatPlanPriceInUSD(1008)).toBe("$1,008");
      expect(formatPlanPriceInUSD(1250000)).toBe("$1,250,000");
    });

    it("writes cents when there are any", () => {
      expect(formatPlanPriceInUSD(0.1)).toBe("$0.10");
      expect(formatPlanPriceInUSD(12345.5)).toBe("$12,345.50");
      expect(formatPlanPriceInUSD(19.99)).toBe("$19.99");
    });
  });
});
