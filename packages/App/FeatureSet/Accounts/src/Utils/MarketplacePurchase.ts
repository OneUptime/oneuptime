import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import {
  MarketplacePurchaseDetails,
  MarketplacePurchasePlan,
  MarketplacePurchaseProject,
  MarketplacePurchaseProjectRefusal,
} from "Common/Types/Marketplace/MarketplacePurchase";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";

/*
 * Reading what the server says about a marketplace purchase
 * (/api/marketplace/purchase/details), defensively: the page draws only what
 * it can recognize, and treats anything else as an answer it cannot use.
 */
export default class MarketplacePurchaseUtil {
  public static parseDetails(
    data: JSONObject | null | undefined,
  ): MarketplacePurchaseDetails | null {
    if (!data || typeof data !== "object") {
      return null;
    }

    const marketplace: unknown = data["marketplace"];

    if (!CloudMarketplaceUtil.isCloudMarketplace(marketplace)) {
      return null;
    }

    const readString: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const value: unknown = data[key];
      return typeof value === "string" && value ? value : null;
    };

    const status: unknown = data["status"];

    return {
      marketplace: marketplace as CloudMarketplace,
      marketplaceName:
        readString("marketplaceName") ||
        CloudMarketplaceUtil.getDisplayName(marketplace as CloudMarketplace),
      status: Object.values(MarketplaceSubscriptionStatus).includes(
        status as MarketplaceSubscriptionStatus,
      )
        ? (status as MarketplaceSubscriptionStatus)
        : MarketplaceSubscriptionStatus.Pending,
      buyerId: readString("buyerId"),
      buyerEmail: readString("buyerEmail"),
      marketplacePlan: readString("marketplacePlan"),
      isFreeTrial: data["isFreeTrial"] === true,
      linkedProjectId: readString("linkedProjectId"),
      signedInEmail: readString("signedInEmail") || "",
      projects: MarketplacePurchaseUtil.parseProjects(data["projects"]),
      plans: MarketplacePurchaseUtil.parsePlans(data["plans"]),
      canCreateProject: data["canCreateProject"] === true,
    };
  }

  private static parseProjects(
    value: unknown,
  ): Array<MarketplacePurchaseProject> {
    if (!Array.isArray(value)) {
      return [];
    }

    const projects: Array<MarketplacePurchaseProject> = [];

    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const project: JSONObject = entry as JSONObject;

      if (typeof project["id"] !== "string" || !project["id"]) {
        continue;
      }

      const refusal: unknown = project["refusal"];

      projects.push({
        id: project["id"],
        name: typeof project["name"] === "string" ? project["name"] : "",
        isEligible: project["isEligible"] === true,
        ...(Object.values(MarketplacePurchaseProjectRefusal).includes(
          refusal as MarketplacePurchaseProjectRefusal,
        )
          ? { refusal: refusal as MarketplacePurchaseProjectRefusal }
          : {}),
      });
    }

    return projects;
  }

  private static parsePlans(value: unknown): Array<MarketplacePurchasePlan> {
    if (!Array.isArray(value)) {
      return [];
    }

    const plans: Array<MarketplacePurchasePlan> = [];

    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const plan: JSONObject = entry as JSONObject;
      const price: number = Number(plan["monthlyPricePerUserInUSD"]);

      if (typeof plan["planId"] !== "string" || !plan["planId"]) {
        continue;
      }

      plans.push({
        planId: plan["planId"],
        name: typeof plan["name"] === "string" ? plan["name"] : "",
        monthlyPricePerUserInUSD:
          Number.isFinite(price) && price > 0 ? price : 0,
        isCustomPricing: plan["isCustomPricing"] === true,
      });
    }

    return plans;
  }

  public static getEligibleProjects(
    details: MarketplacePurchaseDetails,
  ): Array<MarketplacePurchaseProject> {
    return details.projects.filter(
      (project: MarketplacePurchaseProject): boolean => {
        return project.isEligible;
      },
    );
  }

  /*
   * The plan a new project starts on: the first one with a price - someone
   * buying through a marketplace has chosen to pay - or the first of all.
   */
  public static getDefaultPlanId(
    plans: Array<MarketplacePurchasePlan>,
  ): string {
    const firstPaid: MarketplacePurchasePlan | undefined = plans.find(
      (plan: MarketplacePurchasePlan): boolean => {
        return plan.monthlyPricePerUserInUSD > 0;
      },
    );

    return (firstPaid || plans[0])?.planId || "";
  }

  // "$22", "$0.50": how the pricing page writes money.
  public static formatPrice(amountInUSD: number): string {
    return Number.isInteger(amountInUSD)
      ? `$${amountInUSD}`
      : `$${amountInUSD.toFixed(2)}`;
  }

  // Only a relative path on this site is ever followed after the purchase is set up.
  public static isSafeRedirectUrl(value: unknown): value is string {
    return (
      typeof value === "string" &&
      value.startsWith("/dashboard/") &&
      !value.startsWith("//") &&
      !value.includes("\\")
    );
  }
}
