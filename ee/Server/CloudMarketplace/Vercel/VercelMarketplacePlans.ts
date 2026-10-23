import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
  formatPriceInUSD,
} from "Common/Types/Billing/PayAsYouGoPricing";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import { getAllEnvVars } from "Common/Server/EnvironmentConfig";

/*
 * The plans a Vercel team chooses from when it adds OneUptime: OneUptime's
 * own plans - Free, Growth and Scale - at the prices on oneuptime.com, as
 * Vercel billing plans (resource-level subscriptions).
 *
 * Each plan's per-user price is charged for the people in the resource's
 * project; on every plan, active monitors and telemetry are charged as
 * used, as for every OneUptime Cloud project. So every plan needs a payment
 * method on Vercel, the Free one included: a Free plan with none could not
 * send telemetry or run an active monitor, which is what the integration is
 * for. A plan priced by agreement (Enterprise) is not offered here.
 *
 * A plan's ID on Vercel is its name, lowercased ("growth"): readable on the
 * team's invoices, and the same on every server. Renaming a plan in
 * SUBSCRIPTION_PLAN_* would leave existing resources on an ID that no longer
 * names a plan, so keep the names.
 */

export interface VercelPlanDetail {
  label: string;
  value?: string | undefined;
}

export interface VercelBillingPlan {
  id: string;
  type: "subscription";
  scope: "resource";
  name: string;
  description: string;
  paymentMethodRequired: boolean;
  cost: string;
  details: Array<VercelPlanDetail>;
}

export default class VercelMarketplacePlans {
  public static getVercelPlanId(plan: SubscriptionPlan): string {
    return plan
      .getName()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // OneUptime's plans that are sold on Vercel, cheapest first.
  public static getSellablePlans(): Array<SubscriptionPlan> {
    return SubscriptionPlan.getSubscriptionPlans(getAllEnvVars())
      .filter((plan: SubscriptionPlan): boolean => {
        return (
          !plan.isCustomPricing() &&
          Boolean(plan.getMonthlyPlanId()) &&
          Boolean(VercelMarketplacePlans.getVercelPlanId(plan))
        );
      })
      .sort((a: SubscriptionPlan, b: SubscriptionPlan): number => {
        return a.getPlanOrder() - b.getPlanOrder();
      });
  }

  public static getPlans(): Array<VercelBillingPlan> {
    return VercelMarketplacePlans.getSellablePlans().map(
      (plan: SubscriptionPlan): VercelBillingPlan => {
        return VercelMarketplacePlans.toVercelPlan(plan);
      },
    );
  }

  public static toVercelPlan(plan: SubscriptionPlan): VercelBillingPlan {
    const pricePerUser: number = VercelMarketplacePlans.getPricePerUser(plan);
    const trialDays: number = plan.getTrialPeriod();

    const details: Array<VercelPlanDetail> = [
      {
        label: "Users",
        value:
          pricePerUser > 0
            ? `${formatPriceInUSD(pricePerUser)} per user per month`
            : "No per-user price",
      },
      {
        label: "Active monitors",
        value: `${formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH)} per monitor per month`,
      },
      {
        label: "Logs, traces and metrics",
        value: `${formatPriceInUSD(TELEMETRY_PRICE_IN_USD_PER_GB)} per GB, kept ${TELEMETRY_PRICE_RETENTION_IN_DAYS} days`,
      },
      {
        label: "Session replay",
        value: `${formatPriceInUSD(SESSION_REPLAY_PRICE_IN_USD_PER_GB)} per GB`,
      },
    ];

    if (trialDays > 0) {
      details.push({
        label: "Free trial",
        value: `${trialDays} days of the plan and its usage`,
      });
    }

    return {
      id: VercelMarketplacePlans.getVercelPlanId(plan),
      type: "subscription",
      scope: "resource",
      name: plan.getName(),
      description:
        pricePerUser > 0
          ? `OneUptime's ${plan.getName()} plan: ${formatPriceInUSD(pricePerUser)} per user per month, plus monitors and telemetry as you use them.`
          : `OneUptime's ${plan.getName()} plan: no per-user price. Pay only for monitors and telemetry as you use them.`,
      paymentMethodRequired: true,
      cost:
        pricePerUser > 0
          ? `${formatPriceInUSD(pricePerUser)}/user/month + usage`
          : "Usage only",
      details: details,
    };
  }

  // The OneUptime plan a Vercel plan ID names, or undefined.
  public static findPlan(
    vercelPlanId: string | null | undefined,
  ): SubscriptionPlan | undefined {
    if (!vercelPlanId) {
      return undefined;
    }

    return VercelMarketplacePlans.getSellablePlans().find(
      (plan: SubscriptionPlan): boolean => {
        return VercelMarketplacePlans.getVercelPlanId(plan) === vercelPlanId;
      },
    );
  }

  // The Vercel plan ID of a OneUptime plan ID (Project.paymentProviderPlanId), or null.
  public static getVercelPlanIdOfPlanId(
    paymentProviderPlanId: string | null | undefined,
  ): string | null {
    if (!paymentProviderPlanId) {
      return null;
    }

    const plan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(
        paymentProviderPlanId,
        getAllEnvVars(),
      );

    if (!plan || plan.isCustomPricing()) {
      return null;
    }

    return VercelMarketplacePlans.getVercelPlanId(plan);
  }

  private static getPricePerUser(plan: SubscriptionPlan): number {
    const price: number = plan.getMonthlySubscriptionAmountInUSD();
    return Number.isFinite(price) && price > 0 ? price : 0;
  }
}
