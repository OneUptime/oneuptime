import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import PricingPlan from "../../../UI/Utils/PricingPlan";
import PricingPlanType from "../../../Types/PricingPlan";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * PricingPlan picks between two hard-coded Stripe catalogues based on whether
 * the public Stripe key is a test key. `env()` reads process.env on every call,
 * so each test can switch environment by setting STRIPE_PUBLIC_KEY.
 */

const TEST_PLAN_IDS: Array<string> = [
  "plan_GoWIYiX2L8hwzx",
  "plan_GoWIqpBpStiqQp",
  "plan_GoWKgxRnPPBJWy",
  "plan_GoWKiTdQ6NiQFw",
  "plan_H9Iox3l2YqLTDR",
  "plan_H9IlBKhsFz4hV2",
];

const LIVE_PLAN_IDS: Array<string> = [
  "plan_GoVgVbvNdbWwlm",
  "plan_GoVgJu5PKMLRJU",
  "plan_GoVi9EIa6MU0fG",
  "plan_GoViZshjqzZ0vv",
  "plan_H9Ii6Qj3HLdtty",
  "plan_H9IjvX2Flsvlcg",
];

const getPlanIds: () => Array<string> = (): Array<string> => {
  return PricingPlan.getPlans().map((plan: PricingPlanType) => {
    return plan.planId;
  });
};

const firstDollarAmount: (details: string) => number = (
  details: string,
): number => {
  const match: RegExpMatchArray | null = details.match(/\$(\d+)/);
  expect(match).not.toBeNull();
  return Number((match as RegExpMatchArray)[1]);
};

describe("UI PricingPlan util", () => {
  let originalStripeKey: string | undefined;

  beforeEach(() => {
    originalStripeKey = process.env["STRIPE_PUBLIC_KEY"];
    delete process.env["STRIPE_PUBLIC_KEY"];
  });

  afterEach(() => {
    if (originalStripeKey === undefined) {
      delete process.env["STRIPE_PUBLIC_KEY"];
    } else {
      process.env["STRIPE_PUBLIC_KEY"] = originalStripeKey;
    }
  });

  describe("getPlans environment selection", () => {
    it("returns the live catalogue when no Stripe key is configured", () => {
      expect(getPlanIds()).toEqual(LIVE_PLAN_IDS);
    });

    it("returns the live catalogue for an empty Stripe key", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "";
      expect(getPlanIds()).toEqual(LIVE_PLAN_IDS);
    });

    it("returns the live catalogue for a live Stripe key", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "pk_live_abc123";
      expect(getPlanIds()).toEqual(LIVE_PLAN_IDS);
    });

    it("returns the test catalogue for a pk_test key", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "pk_test_abc123";
      expect(getPlanIds()).toEqual(TEST_PLAN_IDS);
    });

    it("only treats a pk_test PREFIX as a test key", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "xpk_test_abc";
      expect(getPlanIds()).toEqual(LIVE_PLAN_IDS);

      process.env["STRIPE_PUBLIC_KEY"] = "PK_TEST_abc";
      expect(getPlanIds()).toEqual(LIVE_PLAN_IDS);
    });

    it("re-evaluates the environment on every call", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "pk_test_1";
      expect(getPlanIds()).toEqual(TEST_PLAN_IDS);

      process.env["STRIPE_PUBLIC_KEY"] = "pk_live_1";
      expect(getPlanIds()).toEqual(LIVE_PLAN_IDS);
    });

    it("returns a fresh array each call so callers cannot corrupt the catalogue", () => {
      const first: Array<PricingPlanType> = PricingPlan.getPlans();
      first.pop();
      (first[0] as PricingPlanType).amount = 1;

      const second: Array<PricingPlanType> = PricingPlan.getPlans();
      expect(second).toHaveLength(6);
      expect((second[0] as PricingPlanType).amount).toBe(25);
    });
  });

  describe.each([
    ["live", "pk_live_x"],
    ["test", "pk_test_x"],
  ])("%s catalogue shape", (_label: string, key: string) => {
    beforeEach(() => {
      process.env["STRIPE_PUBLIC_KEY"] = key;
    });

    it("has unique plan ids", () => {
      const ids: Array<string> = getPlanIds();
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("offers exactly a monthly and an annual plan for each category", () => {
      const plans: Array<PricingPlanType> = PricingPlan.getPlans();
      const categories: Array<string> = ["Startup", "Growth", "Scale"];

      expect(
        Array.from(
          new Set(
            plans.map((plan: PricingPlanType) => {
              return plan.category;
            }),
          ),
        ),
      ).toEqual(categories);

      for (const category of categories) {
        const types: Array<string> = plans
          .filter((plan: PricingPlanType) => {
            return plan.category === category;
          })
          .map((plan: PricingPlanType) => {
            return plan.type;
          })
          .sort();

        expect(types).toEqual(["annual", "month"]);
      }
    });

    it("prices tiers in ascending order and makes annual cheaper per month", () => {
      const plans: Array<PricingPlanType> = PricingPlan.getPlans();
      const monthly: Array<number> = plans
        .filter((plan: PricingPlanType) => {
          return plan.type === "month";
        })
        .map((plan: PricingPlanType) => {
          return plan.amount;
        });

      expect(monthly).toEqual([25, 59, 99]);

      for (const plan of plans.filter((p: PricingPlanType) => {
        return p.type === "annual";
      })) {
        const monthlyPlan: PricingPlanType = plans.find(
          (p: PricingPlanType) => {
            return p.category === plan.category && p.type === "month";
          },
        ) as PricingPlanType;

        /*
         * Compared with the ADVERTISED monthly price: because the monthly
         * Scale plan charges 99 (not the advertised 120), Scale annual is
         * exactly equal to the charged monthly amount (1188 / 12 === 99).
         */
        expect(plan.amount / 12).toBeLessThan(
          firstDollarAmount(monthlyPlan.details),
        );
        expect(plan.amount / 12).toBeLessThanOrEqual(monthlyPlan.amount);
      }
    });

    it("annual amount equals 12x the advertised per-month price", () => {
      const annualPlans: Array<PricingPlanType> = PricingPlan.getPlans().filter(
        (plan: PricingPlanType) => {
          return plan.type === "annual";
        },
      );

      for (const plan of annualPlans) {
        expect(plan.amount).toBe(firstDollarAmount(plan.details) * 12);
        expect(plan.details).toContain("paid annually");
      }
    });

    it("monthly Startup and Growth amounts match their advertised price", () => {
      const plans: Array<PricingPlanType> = PricingPlan.getPlans();

      for (const category of ["Startup", "Growth"]) {
        const plan: PricingPlanType = plans.find((p: PricingPlanType) => {
          return p.category === category && p.type === "month";
        }) as PricingPlanType;

        expect(plan.amount).toBe(firstDollarAmount(plan.details));
      }
    });

    /*
     * The monthly Scale plan charges 99 but advertises "$120 / Month / User".
     * Pinned here so the discrepancy is visible; see the report.
     */
    it("monthly Scale plan amount (99) differs from its advertised price ($120)", () => {
      const plan: PricingPlanType = PricingPlan.getPlans().find(
        (p: PricingPlanType) => {
          return p.category === "Scale" && p.type === "month";
        },
      ) as PricingPlanType;

      expect(plan.amount).toBe(99);
      expect(firstDollarAmount(plan.details)).toBe(120);
    });
  });

  describe("getPlanById", () => {
    it("returns the matching live plan", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "pk_live_x";

      expect(PricingPlan.getPlanById("plan_GoVi9EIa6MU0fG")).toEqual({
        category: "Growth",
        planId: "plan_GoVi9EIa6MU0fG",
        type: "month",
        amount: 59,
        details: "$59 / Month / User",
      });
    });

    it("returns the matching test plan", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "pk_test_x";

      expect(PricingPlan.getPlanById("plan_H9IlBKhsFz4hV2")).toEqual({
        category: "Scale",
        planId: "plan_H9IlBKhsFz4hV2",
        type: "annual",
        amount: 1188,
        details: "$99/mo per user paid annually. ",
      });
    });

    it("resolves every plan id in the active catalogue", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "pk_test_x";
      for (const id of TEST_PLAN_IDS) {
        expect(PricingPlan.getPlanById(id).planId).toBe(id);
      }

      process.env["STRIPE_PUBLIC_KEY"] = "pk_live_x";
      for (const id of LIVE_PLAN_IDS) {
        expect(PricingPlan.getPlanById(id).planId).toBe(id);
      }
    });

    it("does not resolve a test plan id when running against live Stripe", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "pk_live_x";

      expect(() => {
        PricingPlan.getPlanById("plan_GoWIYiX2L8hwzx");
      }).toThrow(BadDataException);
    });

    it("does not resolve a live plan id when running against test Stripe", () => {
      process.env["STRIPE_PUBLIC_KEY"] = "pk_test_x";

      expect(() => {
        PricingPlan.getPlanById("plan_GoVgVbvNdbWwlm");
      }).toThrow(BadDataException);
    });

    it("throws a BadDataException naming the unknown id", () => {
      expect(() => {
        PricingPlan.getPlanById("plan_does_not_exist");
      }).toThrow("Plan with id plan_does_not_exist not found");
    });

    it("does not match on empty or partial ids", () => {
      expect(() => {
        PricingPlan.getPlanById("");
      }).toThrow(BadDataException);

      expect(() => {
        PricingPlan.getPlanById("plan_GoVgVbvNdbWwl");
      }).toThrow(BadDataException);

      expect(() => {
        PricingPlan.getPlanById("PLAN_GOVGVBVNDBWWLM");
      }).toThrow(BadDataException);
    });
  });
});
