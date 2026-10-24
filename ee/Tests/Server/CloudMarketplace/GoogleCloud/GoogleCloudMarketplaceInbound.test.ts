import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "Common/Types/ObjectID";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import MarketplacePurchases from "../../../../Server/CloudMarketplace/MarketplacePurchases";
import GoogleCloudMarketplaceAdapter from "../../../../Server/CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceAdapter";
import GoogleCloudMarketplaceAPI, {
  GoogleCloudEntitlement,
} from "../../../../Server/CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceAPI";
import GoogleCloudMarketplaceInbound, {
  GOOGLE_CLOUD_SIGNUP_TOKEN_ISSUER,
  GoogleCloudInboundError,
  GoogleCloudMarketplaceEvent,
} from "../../../../Server/CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceInbound";
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
  x509Document,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * What Google Cloud Marketplace sends: the buyer, with a sign-up JWT signed
 * by Google's commerce service account, and Pub/Sub push deliveries signed
 * with an OIDC token. Each event is acted on by reading the entitlement from
 * the Procurement API, never by trusting the event's own fields.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    GoogleCloudMarketplaceProviderId: "oneuptime-public",
  };
});

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return {
    __esModule: true,
    default: {
      findPurchase: jest.fn(),
      findPurchaseByEntitlementId: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/CloudMarketplace/MarketplacePurchases", () => {
  return {
    __esModule: true,
    default: {
      recordPurchase: jest.fn(),
      updatePurchase: jest.fn(),
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

const SIGNUP_AUDIENCE: string = "oneuptime.com";
const PUSH_AUDIENCE: string =
  "https://oneuptime.com/api/marketplace/google-cloud/events";
const PUSH_SERVICE_ACCOUNT: string =
  "marketplace-push@oneuptime-marketplace.iam.gserviceaccount.com";

const googleKey: TestSigningKey = createSigningKey("google-1");
const strangerKey: TestSigningKey = createSigningKey("google-1");

const findPurchase: jest.Mock =
  MarketplaceSubscriptionService.findPurchase as unknown as jest.Mock;
const findPurchaseByEntitlementId: jest.Mock =
  MarketplaceSubscriptionService.findPurchaseByEntitlementId as unknown as jest.Mock;
const recordPurchase: jest.Mock =
  MarketplacePurchases.recordPurchase as unknown as jest.Mock;
const updatePurchase: jest.Mock =
  MarketplacePurchases.updatePurchase as unknown as jest.Mock;
const reportFinalUsage: jest.Mock =
  MarketplaceUsageReporter.reportFinalUsage as unknown as jest.Mock;

const entitlement: (
  overrides: Partial<GoogleCloudEntitlement>,
) => GoogleCloudEntitlement = (
  overrides: Partial<GoogleCloudEntitlement>,
): GoogleCloudEntitlement => {
  const id: string = overrides.id || "ent-1";

  return {
    name: `providers/oneuptime-public/entitlements/${id}`,
    id: id,
    accountId: "acct-1",
    state: "ENTITLEMENT_ACTIVE",
    plan: "pay-as-you-go",
    newPendingPlan: null,
    product: "oneuptime.endpoints.oneuptime-public.cloud.goog",
    usageReportingId: "project_number:123456789",
    createTime: "2026-10-16T09:00:00Z",
    updateTime: "2026-10-16T09:00:00Z",
    ...overrides,
  };
};

const linkedPurchase: (
  overrides?: Partial<MarketplaceSubscription>,
) => MarketplaceSubscription = (
  overrides?: Partial<MarketplaceSubscription>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.GoogleCloud,
    externalSubscriptionId: "acct-1",
    externalEntitlementId: "ent-1",
    status: MarketplaceSubscriptionStatus.Active,
    projectId: ObjectID.generate(),
    ...overrides,
  });
};

const event: (
  overrides: Partial<GoogleCloudMarketplaceEvent>,
) => GoogleCloudMarketplaceEvent = (
  overrides: Partial<GoogleCloudMarketplaceEvent>,
): GoogleCloudMarketplaceEvent => {
  return {
    eventId: "event-1",
    eventType: "ENTITLEMENT_ACTIVE",
    providerId: "oneuptime-public",
    entitlementId: "ent-1",
    accountId: null,
    ...overrides,
  };
};

const pushBody: (payload: unknown) => Record<string, unknown> = (
  payload: unknown,
): Record<string, unknown> => {
  return {
    message: {
      data: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
      messageId: "1234567890",
      publishTime: "2026-10-16T09:00:00Z",
    },
    subscription: "projects/oneuptime-marketplace/subscriptions/oneuptime-push",
  };
};

describe("GoogleCloudMarketplaceInbound.verifySignupToken", () => {
  const verifyWith: (token: string) => Promise<unknown> = (
    token: string,
  ): Promise<unknown> => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: x509Document([googleKey]) },
    ]);

    return new GoogleCloudMarketplaceInbound({
      verifier: new RemoteJwtVerifier({ httpClient: http.client }),
    }).verifySignupToken(token, SIGNUP_AUDIENCE);
  };

  it("reads the buyer's account from a token Google signed for this domain", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: x509Document([googleKey]) },
    ]);
    const inbound: GoogleCloudMarketplaceInbound =
      new GoogleCloudMarketplaceInbound({
        verifier: new RemoteJwtVerifier({ httpClient: http.client }),
      });

    await expect(
      inbound.verifySignupToken(
        signToken({
          key: googleKey,
          claims: {
            iss: GOOGLE_CLOUD_SIGNUP_TOKEN_ISSUER,
            aud: SIGNUP_AUDIENCE,
            sub: "acct-1",
            google: { roles: ["account_admin"] },
          },
          expiresInSeconds: 300,
        }),
        SIGNUP_AUDIENCE,
      ),
    ).resolves.toEqual({ accountId: "acct-1" });

    // The keys come from the issuer's own certificate list.
    expect(http.requests[0]!.url).toBe(GOOGLE_CLOUD_SIGNUP_TOKEN_ISSUER);
  });

  it("refuses a token for another domain, from another issuer, or signed by anyone else", async () => {
    const claims: Record<string, unknown> = {
      iss: GOOGLE_CLOUD_SIGNUP_TOKEN_ISSUER,
      aud: SIGNUP_AUDIENCE,
      sub: "acct-1",
    };

    for (const token of [
      signToken({
        key: googleKey,
        claims: { ...claims, aud: "someone-else.example.com" },
        expiresInSeconds: 300,
      }),
      signToken({
        key: googleKey,
        claims: { ...claims, iss: "https://accounts.google.com" },
        expiresInSeconds: 300,
      }),
      signToken({ key: strangerKey, claims: claims, expiresInSeconds: 300 }),
      signToken({
        key: googleKey,
        claims: { ...claims, exp: Math.floor(Date.now() / 1000) - 600 },
      }),
    ]) {
      await expect(verifyWith(token)).rejects.toBeInstanceOf(
        JwtVerificationError,
      );
    }
  });

  it("refuses a token that names no account", async () => {
    for (const sub of [undefined, "", "   ", 42]) {
      await expect(
        verifyWith(
          signToken({
            key: googleKey,
            claims: {
              iss: GOOGLE_CLOUD_SIGNUP_TOKEN_ISSUER,
              aud: SIGNUP_AUDIENCE,
              ...(sub !== undefined ? { sub: sub } : {}),
            },
            expiresInSeconds: 300,
          }),
        ),
      ).rejects.toBeInstanceOf(GoogleCloudInboundError);
    }
  });
});

describe("GoogleCloudMarketplaceInbound.verifyPushToken", () => {
  const pushClaims: Record<string, unknown> = {
    iss: "https://accounts.google.com",
    aud: PUSH_AUDIENCE,
    email: PUSH_SERVICE_ACCOUNT,
    email_verified: true,
    sub: "1234567890",
  };

  const verifyPush: (authorizationHeader: string | undefined) => {
    result: Promise<void>;
    http: FakeHttpClient;
  } = (
    authorizationHeader: string | undefined,
  ): { result: Promise<void>; http: FakeHttpClient } => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: jwksDocument([googleKey]) },
    ]);

    return {
      http: http,
      result: new GoogleCloudMarketplaceInbound({
        verifier: new RemoteJwtVerifier({ httpClient: http.client }),
      }).verifyPushToken({
        authorizationHeader: authorizationHeader,
        audience: PUSH_AUDIENCE,
        serviceAccountEmail: PUSH_SERVICE_ACCOUNT,
      }),
    };
  };

  it("accepts a delivery signed by Google for this endpoint and the push service account", async () => {
    for (const issuer of [
      "https://accounts.google.com",
      "accounts.google.com",
    ]) {
      const { result, http } = verifyPush(
        `Bearer ${signToken({
          key: googleKey,
          claims: { ...pushClaims, iss: issuer },
          expiresInSeconds: 300,
        })}`,
      );

      await expect(result).resolves.toBeUndefined();
      expect(http.requests[0]!.url).toBe(
        "https://www.googleapis.com/oauth2/v3/certs",
      );
    }
  });

  it("refuses an unsigned delivery without fetching any key", async () => {
    for (const header of [undefined, "", "Basic dXNlcjpwYXNz", "bearer x"]) {
      const { result, http } = verifyPush(header);

      await expect(result).rejects.toBeInstanceOf(GoogleCloudInboundError);
      expect(http.requests).toHaveLength(0);
    }
  });

  it("refuses a token for another service account, or an unverified one", async () => {
    for (const claims of [
      { ...pushClaims, email: "someone@else.iam.gserviceaccount.com" },
      { ...pushClaims, email_verified: false },
      { ...pushClaims, email_verified: "true" },
    ]) {
      const { result } = verifyPush(
        `Bearer ${signToken({ key: googleKey, claims: claims, expiresInSeconds: 300 })}`,
      );

      await expect(result).rejects.toBeInstanceOf(GoogleCloudInboundError);
    }
  });

  it("refuses a token for another endpoint, issuer or key", async () => {
    for (const token of [
      signToken({
        key: googleKey,
        claims: { ...pushClaims, aud: "https://elsewhere.example.com/push" },
        expiresInSeconds: 300,
      }),
      signToken({
        key: googleKey,
        claims: { ...pushClaims, iss: "https://evil.example.com" },
        expiresInSeconds: 300,
      }),
      signToken({
        key: strangerKey,
        claims: pushClaims,
        expiresInSeconds: 300,
      }),
    ]) {
      const { result } = verifyPush(`Bearer ${token}`);

      await expect(result).rejects.toBeInstanceOf(JwtVerificationError);
    }
  });
});

describe("GoogleCloudMarketplaceInbound.parsePushBody", () => {
  it("reads an entitlement event out of the push envelope", () => {
    expect(
      GoogleCloudMarketplaceInbound.parsePushBody(
        pushBody({
          eventId: "event-1",
          eventType: "ENTITLEMENT_CREATION_REQUESTED",
          providerId: "oneuptime-public",
          entitlement: { id: "ent-1", updateTime: "2026-10-16T09:00:00Z" },
        }),
      ),
    ).toEqual({
      eventId: "event-1",
      eventType: "ENTITLEMENT_CREATION_REQUESTED",
      providerId: "oneuptime-public",
      entitlementId: "ent-1",
      accountId: null,
    });
  });

  it("reads an account event", () => {
    expect(
      GoogleCloudMarketplaceInbound.parsePushBody(
        pushBody({
          eventId: "event-2",
          eventType: "ACCOUNT_DELETED",
          providerId: "oneuptime-public",
          account: { id: "acct-1", updateTime: "2026-10-16T09:00:00Z" },
        }),
      ),
    ).toMatchObject({
      eventType: "ACCOUNT_DELETED",
      entitlementId: null,
      accountId: "acct-1",
    });
  });

  it("is null for anything that is not a push envelope with a JSON object inside", () => {
    for (const body of [
      null,
      undefined,
      "message",
      42,
      {},
      { message: null },
      { message: {} },
      { message: { data: "" } },
      { message: { data: 42 } },
      { message: { data: "%%%" } },
      pushBody([1, 2, 3]),
      pushBody("just a string"),
      { message: { data: Buffer.from("{not json").toString("base64") } },
    ]) {
      expect(GoogleCloudMarketplaceInbound.parsePushBody(body)).toBeNull();
    }
  });
});

describe("GoogleCloudMarketplaceInbound.handleEvent", () => {
  let api: {
    getEntitlement: jest.Mock;
    approveEntitlement: jest.Mock;
    approvePlanChange: jest.Mock;
  };
  let inbound: GoogleCloudMarketplaceInbound;

  beforeEach(() => {
    jest.clearAllMocks();

    api = {
      getEntitlement: jest.fn(),
      approveEntitlement: jest.fn(),
      approvePlanChange: jest.fn(),
    };

    inbound = new GoogleCloudMarketplaceInbound({
      verifier: new RemoteJwtVerifier({
        httpClient: createFakeHttpClient([]).client,
      }),
      adapter: new GoogleCloudMarketplaceAdapter(
        api as unknown as GoogleCloudMarketplaceAPI,
      ),
    });

    recordPurchase.mockImplementation(
      async (data: unknown): Promise<MarketplaceSubscription> => {
        return Object.assign(new MarketplaceSubscription(), data);
      },
    );
  });

  it("ignores an event for another provider", async () => {
    await inbound.handleEvent(event({ providerId: "someone-else" }));

    expect(api.getEntitlement).not.toHaveBeenCalled();
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("does nothing for account events other than a deletion", async () => {
    await inbound.handleEvent(
      event({
        eventType: "ACCOUNT_ACTIVE",
        entitlementId: null,
        accountId: "acct-1",
      }),
    );

    expect(api.getEntitlement).not.toHaveBeenCalled();
    expect(findPurchase).not.toHaveBeenCalled();
  });

  it("records the entitlement as Google has it, not as the event says", async () => {
    api.getEntitlement.mockResolvedValue(
      entitlement({ state: "ENTITLEMENT_SUSPENDED" }),
    );
    findPurchase.mockResolvedValue(linkedPurchase());

    await inbound.handleEvent(event({ eventType: "ENTITLEMENT_ACTIVE" }));

    expect(api.getEntitlement).toHaveBeenCalledWith("ent-1");
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        marketplace: CloudMarketplace.GoogleCloud,
        externalSubscriptionId: "acct-1",
        externalEntitlementId: "ent-1",
        status: MarketplaceSubscriptionStatus.Suspended,
        externalState: "ENTITLEMENT_SUSPENDED",
        usageReportingId: "project_number:123456789",
      }),
    );
  });

  it("leaves a new order from a buyer who has not signed up for the purchase page to approve", async () => {
    api.getEntitlement.mockResolvedValue(
      entitlement({ state: "ENTITLEMENT_ACTIVATION_REQUESTED" }),
    );
    findPurchase.mockResolvedValue(null);

    await inbound.handleEvent(
      event({ eventType: "ENTITLEMENT_CREATION_REQUESTED" }),
    );

    expect(api.approveEntitlement).not.toHaveBeenCalled();
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSubscriptionId: "acct-1",
        status: MarketplaceSubscriptionStatus.Pending,
      }),
    );
  });

  it("approves a new order at once for a buyer whose purchase already bills a project", async () => {
    api.getEntitlement.mockResolvedValue(
      entitlement({ id: "ent-2", state: "ENTITLEMENT_ACTIVATION_REQUESTED" }),
    );
    findPurchase.mockResolvedValue(
      linkedPurchase({
        externalEntitlementId: "ent-1",
        status: MarketplaceSubscriptionStatus.Cancelled,
      }),
    );

    await inbound.handleEvent(
      event({
        eventType: "ENTITLEMENT_CREATION_REQUESTED",
        entitlementId: "ent-2",
      }),
    );

    expect(api.approveEntitlement).toHaveBeenCalledWith("ent-2");
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        externalEntitlementId: "ent-2",
        status: MarketplaceSubscriptionStatus.Active,
      }),
    );
  });

  it("approves a plan change as asked", async () => {
    api.getEntitlement.mockResolvedValue(
      entitlement({
        state: "ENTITLEMENT_PENDING_PLAN_CHANGE_APPROVAL",
        newPendingPlan: "pay-as-you-go-annual",
      }),
    );
    findPurchase.mockResolvedValue(linkedPurchase());

    await inbound.handleEvent(
      event({ eventType: "ENTITLEMENT_PLAN_CHANGE_REQUESTED" }),
    );

    expect(api.approvePlanChange).toHaveBeenCalledWith(
      "ent-1",
      "pay-as-you-go-annual",
    );
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ status: MarketplaceSubscriptionStatus.Active }),
    );
  });

  it("bills the usage up to a cancellation before recording it", async () => {
    const purchase: MarketplaceSubscription = linkedPurchase();

    api.getEntitlement.mockResolvedValue(
      entitlement({ state: "ENTITLEMENT_CANCELLED" }),
    );
    findPurchase.mockResolvedValue(purchase);

    await inbound.handleEvent(event({ eventType: "ENTITLEMENT_CANCELLED" }));

    expect(reportFinalUsage).toHaveBeenCalledWith(purchase);
    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        status: MarketplaceSubscriptionStatus.Cancelled,
      }),
    );
    expect(reportFinalUsage.mock.invocationCallOrder[0]!).toBeLessThan(
      recordPurchase.mock.invocationCallOrder[0]!,
    );
  });

  it("does not bill final usage twice for a purchase already cancelled", async () => {
    api.getEntitlement.mockResolvedValue(
      entitlement({ state: "ENTITLEMENT_CANCELLED" }),
    );
    findPurchase.mockResolvedValue(
      linkedPurchase({ status: MarketplaceSubscriptionStatus.Cancelled }),
    );

    await inbound.handleEvent(event({ eventType: "ENTITLEMENT_CANCELLED" }));

    expect(reportFinalUsage).not.toHaveBeenCalled();
  });

  it("ignores an old order of the account ending, while a newer one bills", async () => {
    api.getEntitlement.mockResolvedValue(
      entitlement({ id: "ent-old", state: "ENTITLEMENT_CANCELLED" }),
    );
    findPurchase.mockResolvedValue(
      linkedPurchase({ externalEntitlementId: "ent-new" }),
    );

    await inbound.handleEvent(
      event({ eventType: "ENTITLEMENT_CANCELLED", entitlementId: "ent-old" }),
    );

    expect(reportFinalUsage).not.toHaveBeenCalled();
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("ends the purchase an entitlement Google has deleted was billing", async () => {
    const purchase: MarketplaceSubscription = linkedPurchase();

    api.getEntitlement.mockResolvedValue(null);
    findPurchaseByEntitlementId.mockResolvedValue(purchase);

    await inbound.handleEvent(event({ eventType: "ENTITLEMENT_DELETED" }));

    expect(findPurchaseByEntitlementId).toHaveBeenCalledWith({
      marketplace: CloudMarketplace.GoogleCloud,
      externalEntitlementId: "ent-1",
    });
    expect(reportFinalUsage).toHaveBeenCalledWith(purchase);
    expect(updatePurchase).toHaveBeenCalledWith(purchase, {
      status: MarketplaceSubscriptionStatus.Cancelled,
      externalState: "ENTITLEMENT_DELETED",
    });
  });

  it("ends the purchase of a deleted account, and leaves an unknown one alone", async () => {
    const purchase: MarketplaceSubscription = linkedPurchase();

    findPurchase.mockResolvedValueOnce(purchase);
    await inbound.handleEvent(
      event({
        eventType: "ACCOUNT_DELETED",
        entitlementId: null,
        accountId: "acct-1",
      }),
    );

    expect(updatePurchase).toHaveBeenCalledWith(purchase, {
      status: MarketplaceSubscriptionStatus.Cancelled,
      externalState: "ACCOUNT_DELETED",
    });

    updatePurchase.mockClear();
    findPurchase.mockResolvedValueOnce(null);
    await inbound.handleEvent(
      event({
        eventType: "ACCOUNT_DELETED",
        entitlementId: null,
        accountId: "acct-unknown",
      }),
    );

    expect(updatePurchase).not.toHaveBeenCalled();
  });

  it("throws when the Procurement API cannot be reached, so Pub/Sub delivers again", async () => {
    api.getEntitlement.mockRejectedValue(
      new MarketplaceApiError({
        message: "unavailable",
        status: 503,
        isRetryable: true,
      }),
    );

    await expect(inbound.handleEvent(event({}))).rejects.toBeInstanceOf(
      MarketplaceApiError,
    );
    expect(recordPurchase).not.toHaveBeenCalled();
  });
});
