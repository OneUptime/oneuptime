import { JSONObject } from "../../../Types/JSON";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import {
  MarketplacePurchaseDetails,
  MarketplacePurchaseProjectRefusal,
} from "../../../Types/Marketplace/MarketplacePurchase";
import MarketplaceSubscriptionStatus from "../../../Types/Marketplace/MarketplaceSubscriptionStatus";
import MarketplacePurchaseUtil from "../../../../App/FeatureSet/Accounts/src/Utils/MarketplacePurchase";
import { describe, expect, test } from "@jest/globals";

/*
 * How the purchase page reads the server's answer and decides where to go
 * next. It draws only what it recognizes, and follows a redirect only onto
 * the dashboard of this site.
 */

describe("MarketplacePurchaseUtil.parseDetails", () => {
  test("reads a purchase, dropping projects and plans it cannot recognize", () => {
    const details: MarketplacePurchaseDetails | null =
      MarketplacePurchaseUtil.parseDetails({
        marketplace: "AWS",
        marketplaceName: "AWS Marketplace",
        status: "Active",
        buyerId: "123456789012",
        buyerEmail: null,
        marketplacePlan: "",
        isFreeTrial: "yes",
        linkedProjectId: null,
        signedInEmail: "ada@contoso.com",
        projects: [
          { id: "p-1", name: "Acme", isEligible: true },
          {
            id: "p-2",
            name: "Beta",
            isEligible: false,
            refusal: "not_billing_manager",
          },
          { id: "p-3", name: "Gamma", isEligible: "true", refusal: "made-up" },
          { name: "No ID", isEligible: true },
          "not-an-object",
        ],
        plans: [
          {
            planId: "growth_monthly",
            name: "Growth",
            monthlyPricePerUserInUSD: 22,
          },
          {
            planId: "free_monthly",
            name: "Free",
            monthlyPricePerUserInUSD: -1,
          },
          { name: "No ID", monthlyPricePerUserInUSD: 5 },
        ],
        canCreateProject: true,
      } as unknown as JSONObject);

    expect(details).toEqual({
      marketplace: CloudMarketplace.AWS,
      marketplaceName: "AWS Marketplace",
      status: MarketplaceSubscriptionStatus.Active,
      buyerId: "123456789012",
      buyerEmail: null,
      marketplacePlan: null,
      isFreeTrial: false,
      linkedProjectId: null,
      signedInEmail: "ada@contoso.com",
      projects: [
        { id: "p-1", name: "Acme", isEligible: true },
        {
          id: "p-2",
          name: "Beta",
          isEligible: false,
          refusal: MarketplacePurchaseProjectRefusal.NotBillingManager,
        },
        { id: "p-3", name: "Gamma", isEligible: false },
      ],
      plans: [
        {
          planId: "growth_monthly",
          name: "Growth",
          monthlyPricePerUserInUSD: 22,
          isCustomPricing: false,
        },
        {
          planId: "free_monthly",
          name: "Free",
          monthlyPricePerUserInUSD: 0,
          isCustomPricing: false,
        },
      ],
      canCreateProject: true,
    });
  });

  test("names the marketplace itself when the server does not, and treats an unknown status as pending", () => {
    expect(
      MarketplacePurchaseUtil.parseDetails({
        marketplace: "GoogleCloud",
        status: "Exploded",
      }),
    ).toMatchObject({
      marketplaceName: "Google Cloud Marketplace",
      status: MarketplaceSubscriptionStatus.Pending,
      projects: [],
      plans: [],
      canCreateProject: false,
    });
  });

  test("is null for an answer that is not a purchase on a marketplace it knows", () => {
    for (const data of [
      null,
      undefined,
      {},
      { marketplace: "Oracle" },
      { marketplace: 42 },
    ]) {
      expect(
        MarketplacePurchaseUtil.parseDetails(data as JSONObject | null),
      ).toBeNull();
    }
  });
});

describe("MarketplacePurchaseUtil helpers", () => {
  test("starts a new project on the first plan with a price", () => {
    expect(
      MarketplacePurchaseUtil.getDefaultPlanId([
        {
          planId: "free",
          name: "Free",
          monthlyPricePerUserInUSD: 0,
          isCustomPricing: false,
        },
        {
          planId: "growth",
          name: "Growth",
          monthlyPricePerUserInUSD: 22,
          isCustomPricing: false,
        },
      ]),
    ).toBe("growth");

    expect(
      MarketplacePurchaseUtil.getDefaultPlanId([
        {
          planId: "free",
          name: "Free",
          monthlyPricePerUserInUSD: 0,
          isCustomPricing: false,
        },
      ]),
    ).toBe("free");

    expect(MarketplacePurchaseUtil.getDefaultPlanId([])).toBe("");
  });

  test("writes prices the way the pricing page does", () => {
    expect(MarketplacePurchaseUtil.formatPrice(22)).toBe("$22");
    expect(MarketplacePurchaseUtil.formatPrice(0.5)).toBe("$0.50");
    expect(MarketplacePurchaseUtil.formatPrice(99.99)).toBe("$99.99");
  });

  test("follows a redirect only onto this site's dashboard", () => {
    expect(
      MarketplacePurchaseUtil.isSafeRedirectUrl(
        "/dashboard/11111111-1111-4111-8111-111111111111/settings/billing",
      ),
    ).toBe(true);

    for (const value of [
      "https://evil.example.com/dashboard/",
      "//evil.example.com/dashboard/",
      "/dashboard",
      "/accounts/login",
      "/dashboard/\\evil.example.com",
      "javascript:alert(1)",
      "",
      null,
      42,
    ]) {
      expect(MarketplacePurchaseUtil.isSafeRedirectUrl(value)).toBe(false);
    }
  });
});
