import VercelMarketplacePlans, {
  VercelBillingPlan,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplacePlans";
import { describe, expect, it } from "@jest/globals";

/*
 * The plans a Vercel team adds OneUptime on are OneUptime's own, at the
 * prices on oneuptime.com: each plan's per-user price, plus monitors and
 * telemetry as used. Every one needs a payment method on Vercel - the Free
 * plan too, as its usage is billed - and a plan priced by agreement is not
 * offered.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    getAllEnvVars: (): Record<string, string> => {
      return {
        SUBSCRIPTION_PLAN_FREE: "Free,free_monthly,free_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,growth_monthly,growth_yearly,22,240,2,14",
        SUBSCRIPTION_PLAN_SCALE: "Scale,scale_monthly,scale_yearly,44,480,3,0",
        SUBSCRIPTION_PLAN_ENTERPRISE:
          "Enterprise,enterprise_monthly,enterprise_yearly,-1,-1,4,14",
      };
    },
  };
});

describe("VercelMarketplacePlans", () => {
  it("offers Free, Growth and Scale, cheapest first, and not Enterprise", () => {
    const plans: Array<VercelBillingPlan> = VercelMarketplacePlans.getPlans();

    expect(
      plans.map((plan: VercelBillingPlan) => {
        return plan.id;
      }),
    ).toEqual(["free", "growth", "scale"]);
  });

  it("describes each plan as a resource-level subscription that needs a payment method", () => {
    for (const plan of VercelMarketplacePlans.getPlans()) {
      expect(plan.type).toBe("subscription");
      expect(plan.scope).toBe("resource");
      expect(plan.paymentMethodRequired).toBe(true);
    }
  });

  it("prices a plan per user, with usage, as oneuptime.com does", () => {
    const [free, growth] = VercelMarketplacePlans.getPlans();

    expect(free!.name).toBe("Free");
    expect(free!.cost).toBe("Usage only");
    expect(free!.description).toContain("no per-user price");
    expect(free!.details).toEqual([
      { label: "Users", value: "No per-user price" },
      { label: "Active monitors", value: "$1 per monitor per month" },
      {
        label: "Logs, traces and metrics",
        value: "$0.10 per GB, kept 15 days",
      },
      { label: "Session replay", value: "$2 per GB" },
    ]);

    expect(growth!.cost).toBe("$22/user/month + usage");
    expect(growth!.description).toContain("$22 per user per month");
    expect(growth!.details).toContainEqual({
      label: "Users",
      value: "$22 per user per month",
    });
    expect(growth!.details).toContainEqual({
      label: "Free trial",
      value: "14 days of the plan and its usage",
    });
  });

  it("finds the OneUptime plan a Vercel plan ID names, and back", () => {
    expect(VercelMarketplacePlans.findPlan("growth")?.getMonthlyPlanId()).toBe(
      "growth_monthly",
    );
    expect(VercelMarketplacePlans.findPlan("enterprise")).toBeUndefined();
    expect(VercelMarketplacePlans.findPlan("platinum")).toBeUndefined();
    expect(VercelMarketplacePlans.findPlan(undefined)).toBeUndefined();

    expect(
      VercelMarketplacePlans.getVercelPlanIdOfPlanId("scale_monthly"),
    ).toBe("scale");
    expect(VercelMarketplacePlans.getVercelPlanIdOfPlanId("scale_yearly")).toBe(
      "scale",
    );
    expect(
      VercelMarketplacePlans.getVercelPlanIdOfPlanId("enterprise_monthly"),
    ).toBeNull();
    expect(VercelMarketplacePlans.getVercelPlanIdOfPlanId("nope")).toBeNull();
    expect(VercelMarketplacePlans.getVercelPlanIdOfPlanId(null)).toBeNull();
  });
});
