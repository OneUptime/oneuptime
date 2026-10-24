import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import { VercelSecret } from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAPI";
import VercelResource, {
  VERCEL_METADATA_KEYS,
  VERCEL_SECRET_NAMES,
  VercelResourceDetails,
  VercelResourceResponse,
} from "../../../../Server/CloudMarketplace/Vercel/VercelResource";
import { describe, expect, it } from "@jest/globals";

/*
 * A Vercel resource is a MarketplaceSubscription; what Vercel shows of it
 * lives in its details. Its secrets are the environment variables of the
 * Vercel projects connected to it.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    Host: "oneuptime.com",
    HttpProtocol: "https://",
    getAllEnvVars: (): Record<string, string> => {
      return {
        SUBSCRIPTION_PLAN_FREE: "Free,free_monthly,free_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,growth_monthly,growth_yearly,22,240,2,14",
      };
    },
  };
});

const purchase: (
  details: Record<string, unknown>,
  status?: MarketplaceSubscriptionStatus,
) => MarketplaceSubscription = (
  details: Record<string, unknown>,
  status?: MarketplaceSubscriptionStatus,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    marketplace: CloudMarketplace.Vercel,
    externalSubscriptionId: "res_1",
    externalCustomerId: "icfg_1",
    externalOfferId: "oneuptime",
    externalPlanId: "growth",
    status: status || MarketplaceSubscriptionStatus.Active,
    details: details,
  });
};

describe("VercelResource", () => {
  it("keeps what Vercel shows of the resource, and the records it was given", () => {
    const details: VercelResourceDetails = {
      name: "Storefront",
      productId: "oneuptime",
      metadata: { monitorProductionDomains: false },
      telemetryIngestionKeyId: "key-1",
      statusPageId: "page-1",
      provisionedByVercelUserId: "user_ada",
    };

    expect(
      VercelResource.readDetails(
        purchase(VercelResource.toDetailsJson(details)),
      ),
    ).toEqual(details);
  });

  it("reads a resource with no details as Vercel's defaults", () => {
    expect(VercelResource.readDetails(purchase({}))).toEqual({
      name: "OneUptime",
      productId: "oneuptime",
      metadata: {},
      telemetryIngestionKeyId: undefined,
      statusPageId: undefined,
      provisionedByVercelUserId: undefined,
    });
  });

  it("keeps only the settings OneUptime knows, as booleans", () => {
    expect(
      VercelResource.readMetadata({
        monitorProductionDomains: "false",
        createStatusPage: true,
        region: "iad1",
        __proto__: { polluted: true },
      }),
    ).toEqual({ monitorProductionDomains: false, createStatusPage: true });

    expect(VercelResource.readMetadata("nope")).toEqual({});
    expect(VercelResource.readMetadata(["a"])).toEqual({});
    expect(VercelResource.readMetadata(null)).toEqual({});
  });

  it("has every setting on unless it was turned off", () => {
    expect(
      VercelResource.isSettingOn({}, VERCEL_METADATA_KEYS.createStatusPage),
    ).toBe(true);
    expect(
      VercelResource.isSettingOn(
        { createStatusPage: false },
        VERCEL_METADATA_KEYS.createStatusPage,
      ),
    ).toBe(false);
    expect(
      VercelResource.isSettingOn(
        { createStatusPage: "false" },
        VERCEL_METADATA_KEYS.createStatusPage,
      ),
    ).toBe(false);
  });

  it("gives connected projects the OpenTelemetry exporter settings @vercel/otel reads", () => {
    const secrets: Array<VercelSecret> = VercelResource.getSecrets("key-value");

    expect(secrets).toEqual([
      {
        name: "OTEL_EXPORTER_OTLP_ENDPOINT",
        value: "https://oneuptime.com/otlp",
      },
      {
        name: "OTEL_EXPORTER_OTLP_HEADERS",
        value: "x-oneuptime-token=key-value",
      },
      { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
      { name: "ONEUPTIME_TELEMETRY_INGESTION_KEY", value: "key-value" },
    ]);

    expect(Object.values(VERCEL_SECRET_NAMES)).toEqual(
      secrets.map((secret: VercelSecret) => {
        return secret.name;
      }),
    );
  });

  it("says where a resource stands in Vercel's words", () => {
    expect(
      VercelResource.toVercelStatus(MarketplaceSubscriptionStatus.Active),
    ).toBe("ready");
    expect(
      VercelResource.toVercelStatus(MarketplaceSubscriptionStatus.Suspended),
    ).toBe("suspended");
    expect(
      VercelResource.toVercelStatus(MarketplaceSubscriptionStatus.Cancelled),
    ).toBe("uninstalled");
    expect(
      VercelResource.toVercelStatus(MarketplaceSubscriptionStatus.Pending),
    ).toBe("pending");
  });

  it("answers Get Resource with the resource, its status and its plan, never its secrets", () => {
    const response: VercelResourceResponse = VercelResource.toResponse(
      purchase(
        {
          name: "Storefront",
          productId: "oneuptime",
          metadata: { createStatusPage: true },
          telemetryIngestionKeyId: "key-1",
        },
        MarketplaceSubscriptionStatus.Suspended,
      ),
    );

    expect(response).toMatchObject({
      id: "res_1",
      productId: "oneuptime",
      name: "Storefront",
      metadata: { createStatusPage: true },
      status: "suspended",
      billingPlan: { id: "growth", name: "Growth" },
    });
    expect(JSON.stringify(response)).not.toContain("key-1");
    expect(response).not.toHaveProperty("secrets");
  });
});
