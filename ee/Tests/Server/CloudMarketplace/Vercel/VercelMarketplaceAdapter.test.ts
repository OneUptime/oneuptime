import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import MarketplaceAdapter from "../../../../Server/CloudMarketplace/MarketplaceAdapter";
import MarketplaceAdapters from "../../../../Server/CloudMarketplace/MarketplaceAdapters";
import MarketplaceConfig from "../../../../Server/CloudMarketplace/MarketplaceConfig";
import VercelMarketplaceAdapter from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAdapter";
import { describe, expect, it } from "@jest/globals";

/*
 * Vercel in the marketplace framework: its resources are priced by the
 * hourly usage report like every purchase, and each report is accepted as
 * soon as it is written - Vercel is sent the month's totals and invoice from
 * the reports, not a record per hour.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    IsBillingEnabled: true,
    Host: "oneuptime.com",
    HttpProtocol: "https://",
    VercelMarketplaceClientId: "oac_client",
    VercelMarketplaceClientSecret: "client-secret",
  };
});

describe("VercelMarketplaceAdapter", () => {
  it("is the adapter for Vercel Marketplace, and takes any number of reports an hour", () => {
    const adapter: MarketplaceAdapter = MarketplaceAdapters.get(
      CloudMarketplace.Vercel,
    );

    expect(adapter).toBeInstanceOf(VercelMarketplaceAdapter);
    expect(adapter.marketplace).toBe(CloudMarketplace.Vercel);
    expect(adapter.keepsOneReportPerHour).toBe(false);
    expect(adapter.isConfigured()).toBe(true);
  });

  it("accepts a report as soon as it is written, and has nothing to activate or read back", async () => {
    const adapter: VercelMarketplaceAdapter = new VercelMarketplaceAdapter();
    const purchase: MarketplaceSubscription = new MarketplaceSubscription();

    expect(
      await adapter.reportUsage(purchase, {
        reportId: "report-1",
        quantity: 120,
        periodStart: new Date("2026-10-18T09:00:00Z"),
        periodEnd: new Date("2026-10-18T10:00:00Z"),
        projectId: "p",
      }),
    ).toEqual({ outcome: "accepted", externalReportId: "report-1" });

    expect(await adapter.activate(purchase)).toEqual({
      status: MarketplaceSubscriptionStatus.Active,
    });
    expect(await adapter.fetchStatus(purchase)).toBeNull();
  });
});

describe("Vercel in MarketplaceConfig and CloudMarketplace", () => {
  it("is set up with the integration's client ID and secret", () => {
    expect(MarketplaceConfig.isVercelConfigured()).toBe(true);
    expect(MarketplaceConfig.isConfigured(CloudMarketplace.Vercel)).toBe(true);
  });

  it("names the URLs the Integration Console asks for", () => {
    expect(MarketplaceConfig.getPublicUrls()).toMatchObject({
      vercelRedirectLoginUrl: "https://oneuptime.com/identity/vercel/sso",
      vercelLogDrainUrl: "https://oneuptime.com/telemetry/vercel/v1/logs",
      vercelTraceDrainUrl: "https://oneuptime.com/otlp/v1/traces",
    });
    expect(MarketplaceConfig.getPublicUrls()["vercelBaseUrl"]).toMatch(
      /\/marketplace\/vercel$/,
    );
    expect(MarketplaceConfig.getPublicUrls()["vercelWebhookUrl"]).toMatch(
      /\/marketplace\/vercel\/webhook$/,
    );
  });

  it("is called Vercel Marketplace, and managed from the team's Integrations page", () => {
    expect(CloudMarketplaceUtil.getAll()).toContain(CloudMarketplace.Vercel);
    expect(CloudMarketplaceUtil.isCloudMarketplace("Vercel")).toBe(true);
    expect(CloudMarketplaceUtil.getDisplayName(CloudMarketplace.Vercel)).toBe(
      "Vercel Marketplace",
    );
    expect(
      CloudMarketplaceUtil.getManageSubscriptionUrl(CloudMarketplace.Vercel),
    ).toBe("https://vercel.com/dashboard/integrations");
  });
});
