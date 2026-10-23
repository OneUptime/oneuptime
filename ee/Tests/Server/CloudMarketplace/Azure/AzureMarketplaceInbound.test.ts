import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "Common/Types/ObjectID";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import MarketplacePurchases from "../../../../Server/CloudMarketplace/MarketplacePurchases";
import AzureMarketplaceAdapter from "../../../../Server/CloudMarketplace/Azure/AzureMarketplaceAdapter";
import AzureMarketplaceAPI, {
  AZURE_MARKETPLACE_API_RESOURCE_ID,
  AzureOperation,
  AzureSaasSubscription,
} from "../../../../Server/CloudMarketplace/Azure/AzureMarketplaceAPI";
import AzureMarketplaceInbound, {
  AzureInboundError,
  AzureWebhookCall,
} from "../../../../Server/CloudMarketplace/Azure/AzureMarketplaceInbound";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import MarketplaceUsageReporter from "../../../../Server/CloudMarketplace/MarketplaceUsageReporter";
import RemoteJwtVerifier, {
  JwtVerificationError,
} from "Common/Server/Utils/Marketplace/RemoteJwtVerifier";
import {
  FakeHttpClient,
  TestSigningKey,
  createFakeHttpClient,
  createSigningKey,
  jwksDocument,
  signToken,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * What Microsoft Marketplace sends: the buyer, with a purchase token for the
 * landing page, and webhook calls with an Entra bearer token. A webhook is
 * acted on only once its token checks out and the operation and subscription
 * have been read back from the fulfillment API.
 */

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return {
    __esModule: true,
    default: {
      findPurchase: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/CloudMarketplace/MarketplacePurchases", () => {
  return {
    __esModule: true,
    default: {
      recordPurchase: jest.fn(),
    },
  };
});

jest.mock(
  "../../../../Server/CloudMarketplace/MarketplaceUsageReporter",
  () => {
    return {
      __esModule: true,
      default: { reportFinalUsage: jest.fn() },
    };
  },
);

const TENANT_ID: string = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID: string = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SUBSCRIPTION_ID: string = "37f9dea2-4345-438f-b0bd-03d40d28c7e0";

const microsoftKey: TestSigningKey = createSigningKey("entra-1");
const strangerKey: TestSigningKey = createSigningKey("entra-1");

const findPurchase: jest.Mock =
  MarketplaceSubscriptionService.findPurchase as unknown as jest.Mock;
const recordPurchase: jest.Mock =
  MarketplacePurchases.recordPurchase as unknown as jest.Mock;
const reportFinalUsage: jest.Mock =
  MarketplaceUsageReporter.reportFinalUsage as unknown as jest.Mock;

const subscription: (
  overrides?: Partial<AzureSaasSubscription>,
) => AzureSaasSubscription = (
  overrides?: Partial<AzureSaasSubscription>,
): AzureSaasSubscription => {
  return {
    id: SUBSCRIPTION_ID,
    name: "OneUptime for Contoso",
    offerId: "oneuptime-cloud",
    planId: "pay-as-you-go",
    quantity: null,
    status: "Subscribed",
    beneficiary: {
      emailId: "admin@contoso.com",
      tenantId: "t-1",
      objectId: null,
    },
    purchaser: {
      emailId: "buyer@contoso.com",
      tenantId: "t-1",
      objectId: null,
    },
    isFreeTrial: false,
    isTest: false,
    termStartDate: null,
    termEndDate: null,
    termUnit: null,
    autoRenew: true,
    ...overrides,
  };
};

const operation: (overrides?: Partial<AzureOperation>) => AzureOperation = (
  overrides?: Partial<AzureOperation>,
): AzureOperation => {
  return {
    id: "op-1",
    subscriptionId: SUBSCRIPTION_ID,
    action: "ChangePlan",
    status: "InProgress",
    planId: "pay-as-you-go-annual",
    quantity: null,
    ...overrides,
  };
};

const webhook: (overrides?: Partial<AzureWebhookCall>) => AzureWebhookCall = (
  overrides?: Partial<AzureWebhookCall>,
): AzureWebhookCall => {
  return {
    operationId: "op-1",
    subscriptionId: SUBSCRIPTION_ID,
    action: "ChangePlan",
    status: "InProgress",
    ...overrides,
  };
};

describe("AzureMarketplaceInbound.verifyWebhookToken", () => {
  const v1Claims: Record<string, unknown> = {
    iss: `https://sts.windows.net/${TENANT_ID}/`,
    aud: CLIENT_ID,
    tid: TENANT_ID,
    appid: AZURE_MARKETPLACE_API_RESOURCE_ID,
    ver: "1.0",
  };

  const verify: (authorizationHeader: string | undefined) => {
    result: Promise<void>;
    http: FakeHttpClient;
  } = (
    authorizationHeader: string | undefined,
  ): { result: Promise<void>; http: FakeHttpClient } => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: jwksDocument([microsoftKey]) },
    ]);

    return {
      http: http,
      result: new AzureMarketplaceInbound({
        verifier: new RemoteJwtVerifier({ httpClient: http.client }),
      }).verifyWebhookToken({
        authorizationHeader: authorizationHeader,
        tenantId: TENANT_ID,
        clientId: CLIENT_ID,
      }),
    };
  };

  const bearer: (
    claims: Record<string, unknown>,
    key?: TestSigningKey,
  ) => string = (
    claims: Record<string, unknown>,
    key?: TestSigningKey,
  ): string => {
    return `Bearer ${signToken({
      key: key || microsoftKey,
      claims: claims,
      expiresInSeconds: 300,
    })}`;
  };

  it("accepts a v1 token issued in the offer's tenant, for its app, to the marketplace", async () => {
    const { result, http } = verify(bearer(v1Claims));

    await expect(result).resolves.toBeUndefined();
    expect(http.requests[0]!.url).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
    );
  });

  it("accepts the v2 form of the same token", async () => {
    const { result } = verify(
      bearer({
        iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
        aud: `api://${CLIENT_ID}`,
        tid: TENANT_ID,
        azp: AZURE_MARKETPLACE_API_RESOURCE_ID,
        ver: "2.0",
      }),
    );

    await expect(result).resolves.toBeUndefined();
  });

  it("refuses a token issued to anyone but Microsoft Marketplace", async () => {
    for (const claims of [
      { ...v1Claims, appid: "00000000-0000-0000-0000-000000000000" },
      { ...v1Claims, appid: undefined },
    ]) {
      const { result } = verify(bearer(claims));

      await expect(result).rejects.toThrow(
        /not issued to Microsoft Marketplace/,
      );
    }
  });

  it("refuses a token for another tenant", async () => {
    const { result } = verify(
      bearer({ ...v1Claims, tid: "99999999-9999-9999-9999-999999999999" }),
    );

    await expect(result).rejects.toBeInstanceOf(AzureInboundError);
  });

  it("refuses a token for another app, from another issuer, or signed by anyone else", async () => {
    for (const header of [
      bearer({ ...v1Claims, aud: "some-other-app" }),
      bearer({ ...v1Claims, iss: "https://sts.windows.net/someone-else/" }),
      bearer(v1Claims, strangerKey),
    ]) {
      const { result } = verify(header);

      await expect(result).rejects.toBeInstanceOf(JwtVerificationError);
    }
  });

  it("refuses a call without a bearer token, or while Microsoft Marketplace is not configured", async () => {
    for (const header of [undefined, "", "Basic abc"]) {
      const { result, http } = verify(header);

      await expect(result).rejects.toBeInstanceOf(AzureInboundError);
      expect(http.requests).toHaveLength(0);
    }

    await expect(
      new AzureMarketplaceInbound({
        verifier: new RemoteJwtVerifier({
          httpClient: createFakeHttpClient([]).client,
        }),
      }).verifyWebhookToken({
        authorizationHeader: bearer(v1Claims),
        tenantId: null,
        clientId: CLIENT_ID,
      }),
    ).rejects.toThrow(/not configured/);
  });
});

describe("AzureMarketplaceInbound.parseWebhookBody", () => {
  it("reads Microsoft's webhook payload", () => {
    expect(
      AzureMarketplaceInbound.parseWebhookBody({
        id: "op-1",
        activityId: "a-1",
        publisherId: "hackerbay",
        offerId: "oneuptime-cloud",
        planId: "pay-as-you-go",
        quantity: 1,
        subscriptionId: SUBSCRIPTION_ID,
        timeStamp: "2026-10-16T09:00:00.0000000Z",
        action: "ChangePlan",
        status: "InProgress",
        operationRequestSource: "Azure",
        subscription: { id: SUBSCRIPTION_ID },
        purchaseToken: null,
      }),
    ).toEqual({
      operationId: "op-1",
      subscriptionId: SUBSCRIPTION_ID,
      action: "ChangePlan",
      status: "InProgress",
    });
  });

  it("is null without an operation, subscription and action", () => {
    for (const body of [
      null,
      "x",
      [],
      {},
      { id: "op-1", subscriptionId: SUBSCRIPTION_ID },
      { id: "op-1", action: "Suspend" },
      { subscriptionId: SUBSCRIPTION_ID, action: "Suspend" },
      { id: 1, subscriptionId: SUBSCRIPTION_ID, action: "Suspend" },
    ]) {
      expect(AzureMarketplaceInbound.parseWebhookBody(body)).toBeNull();
    }
  });
});

describe("AzureMarketplaceInbound", () => {
  let api: {
    resolve: jest.Mock;
    getOperation: jest.Mock;
    updateOperation: jest.Mock;
    getSubscription: jest.Mock;
  };
  let inbound: AzureMarketplaceInbound;

  beforeEach(() => {
    jest.clearAllMocks();

    api = {
      resolve: jest.fn(),
      getOperation: jest.fn(),
      updateOperation: jest.fn(),
      getSubscription: jest.fn(),
    };
    inbound = new AzureMarketplaceInbound({
      verifier: new RemoteJwtVerifier({
        httpClient: createFakeHttpClient([]).client,
      }),
      adapter: new AzureMarketplaceAdapter(
        api as unknown as AzureMarketplaceAPI,
      ),
    });

    recordPurchase.mockImplementation(
      async (data: unknown): Promise<MarketplaceSubscription> => {
        return Object.assign(new MarketplaceSubscription(), data);
      },
    );
  });

  it("records the subscription a landing-page token resolves to", async () => {
    api.resolve.mockResolvedValue(
      subscription({ status: "PendingFulfillmentStart" }),
    );

    await inbound.resolveLandingToken("purchase-token");

    expect(api.resolve).toHaveBeenCalledWith("purchase-token");
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        marketplace: CloudMarketplace.Azure,
        externalSubscriptionId: SUBSCRIPTION_ID,
        status: MarketplaceSubscriptionStatus.Pending,
        externalPlanId: "pay-as-you-go",
        purchaserEmail: "buyer@contoso.com",
      }),
    );
  });

  it("accepts a plan change and records the new plan", async () => {
    api.getOperation.mockResolvedValue(operation());
    // Microsoft's read may still show the old plan until the change lands.
    api.getSubscription.mockResolvedValue(subscription());

    await inbound.handleWebhook(webhook());

    expect(api.getOperation).toHaveBeenCalledWith(SUBSCRIPTION_ID, "op-1");
    expect(api.updateOperation).toHaveBeenCalledWith({
      subscriptionId: SUBSCRIPTION_ID,
      operationId: "op-1",
      status: "Success",
    });
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSubscriptionId: SUBSCRIPTION_ID,
        externalPlanId: "pay-as-you-go-annual",
        status: MarketplaceSubscriptionStatus.Active,
      }),
    );
  });

  it("accepts a quantity change and records the new quantity", async () => {
    api.getOperation.mockResolvedValue(
      operation({ action: "ChangeQuantity", planId: null, quantity: 25 }),
    );
    api.getSubscription.mockResolvedValue(subscription({ quantity: 20 }));

    await inbound.handleWebhook(webhook({ action: "ChangeQuantity" }));

    expect(api.updateOperation).toHaveBeenCalled();
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 25 }),
    );
  });

  it("reinstates a suspended subscription by accepting the reinstatement", async () => {
    api.getOperation.mockResolvedValue(
      operation({ action: "Reinstate", planId: null }),
    );
    api.getSubscription.mockResolvedValue(
      subscription({ status: "Suspended" }),
    );

    await inbound.handleWebhook(webhook({ action: "Reinstate" }));

    expect(api.updateOperation).toHaveBeenCalled();
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ status: MarketplaceSubscriptionStatus.Active }),
    );
  });

  it("only records what has already happened, without accepting anything", async () => {
    api.getOperation.mockResolvedValue(
      operation({ action: "ChangePlan", status: "Succeeded" }),
    );
    api.getSubscription.mockResolvedValue(
      subscription({ planId: "pay-as-you-go-annual" }),
    );

    await inbound.handleWebhook(webhook({ status: "Succeeded" }));

    expect(api.updateOperation).not.toHaveBeenCalled();
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ externalPlanId: "pay-as-you-go-annual" }),
    );
  });

  it("records a suspension as Microsoft has it", async () => {
    api.getOperation.mockResolvedValue(
      operation({ action: "Suspend", status: "Succeeded", planId: null }),
    );
    api.getSubscription.mockResolvedValue(
      subscription({ status: "Suspended" }),
    );

    await inbound.handleWebhook(
      webhook({ action: "Suspend", status: "Succeeded" }),
    );

    expect(api.updateOperation).not.toHaveBeenCalled();
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        status: MarketplaceSubscriptionStatus.Suspended,
      }),
    );
  });

  it("bills the usage up to an unsubscription before recording it", async () => {
    const linked: MarketplaceSubscription = Object.assign(
      new MarketplaceSubscription(),
      {
        _id: ObjectID.generate().toString(),
        marketplace: CloudMarketplace.Azure,
        externalSubscriptionId: SUBSCRIPTION_ID,
        status: MarketplaceSubscriptionStatus.Active,
        projectId: ObjectID.generate(),
      },
    );

    api.getOperation.mockResolvedValue(
      operation({ action: "Unsubscribe", status: "Succeeded", planId: null }),
    );
    api.getSubscription.mockResolvedValue(
      subscription({ status: "Unsubscribed" }),
    );
    findPurchase.mockResolvedValue(linked);

    await inbound.handleWebhook(
      webhook({ action: "Unsubscribe", status: "Succeeded" }),
    );

    expect(reportFinalUsage).toHaveBeenCalledWith(linked);
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        status: MarketplaceSubscriptionStatus.Cancelled,
      }),
    );
    expect(reportFinalUsage.mock.invocationCallOrder[0]!).toBeLessThan(
      recordPurchase.mock.invocationCallOrder[0]!,
    );
  });

  it("does not bill final usage for a purchase already cancelled, or never recorded", async () => {
    api.getOperation.mockResolvedValue(
      operation({ action: "Unsubscribe", status: "Succeeded", planId: null }),
    );
    api.getSubscription.mockResolvedValue(
      subscription({ status: "Unsubscribed" }),
    );

    findPurchase.mockResolvedValueOnce(
      Object.assign(new MarketplaceSubscription(), {
        status: MarketplaceSubscriptionStatus.Cancelled,
      }),
    );
    await inbound.handleWebhook(
      webhook({ action: "Unsubscribe", status: "Succeeded" }),
    );

    findPurchase.mockResolvedValueOnce(null);
    await inbound.handleWebhook(
      webhook({ action: "Unsubscribe", status: "Succeeded" }),
    );

    expect(reportFinalUsage).not.toHaveBeenCalled();
    expect(recordPurchase).toHaveBeenCalledTimes(2);
  });

  it("refuses a webhook describing an operation Microsoft does not have", async () => {
    api.getOperation.mockResolvedValue(operation({ action: "Unsubscribe" }));

    await expect(
      inbound.handleWebhook(webhook({ action: "Reinstate" })),
    ).rejects.toBeInstanceOf(AzureInboundError);
    expect(api.updateOperation).not.toHaveBeenCalled();
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("records nothing for a subscription Microsoft does not have", async () => {
    api.getOperation.mockResolvedValue(null);
    api.getSubscription.mockResolvedValue(null);

    await inbound.handleWebhook(webhook({ action: "Suspend" }));

    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("throws when Microsoft cannot be reached, so the webhook is delivered again", async () => {
    api.getOperation.mockRejectedValue(
      new MarketplaceApiError({
        message: "unavailable",
        status: 503,
        isRetryable: true,
      }),
    );

    await expect(inbound.handleWebhook(webhook())).rejects.toBeInstanceOf(
      MarketplaceApiError,
    );
    expect(recordPurchase).not.toHaveBeenCalled();
  });
});
