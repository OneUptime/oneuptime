import AzureMarketplaceAPI, {
  AZURE_MARKETPLACE_API_RESOURCE_ID,
  AzureOperation,
  AzureSaasSubscription,
  AzureUsageEventResult,
} from "../../../../Server/CloudMarketplace/Azure/AzureMarketplaceAPI";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import { MarketplaceHttpRequest } from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import {
  FakeHttpClient,
  createFakeHttpClient,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * Microsoft Marketplace's SaaS fulfillment and metering APIs (v2,
 * api-version 2018-08-31), called with a client-credentials token for the
 * marketplace API's own resource ID.
 */

const TENANT_ID: string = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID: string = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CLIENT_SECRET: string = "client-secret-value-for-tests";
const SUBSCRIPTION_ID: string = "37f9dea2-4345-438f-b0bd-03d40d28c7e0";

const TOKEN_ANSWER: { status: number; body: Record<string, unknown> } = {
  status: 200,
  body: { token_type: "Bearer", expires_in: 3599, access_token: "entra-token" },
};

// Microsoft's documented subscription shape, status padded as in their examples.
const SUBSCRIPTION: Record<string, unknown> = {
  id: SUBSCRIPTION_ID,
  publisherId: "hackerbay",
  offerId: "oneuptime-cloud",
  name: "OneUptime for Contoso",
  saasSubscriptionStatus: " PendingFulfillmentStart ",
  beneficiary: {
    emailId: "admin@contoso.com",
    objectId: "o-1",
    tenantId: "t-beneficiary",
    puid: "p-1",
  },
  purchaser: {
    emailId: "buyer@contoso.com",
    objectId: "o-2",
    tenantId: "t-purchaser",
    puid: "p-2",
  },
  planId: "pay-as-you-go",
  term: {
    termUnit: "P1M",
    startDate: "2026-10-16T00:00:00Z",
    endDate: "2026-11-15T00:00:00Z",
  },
  autoRenew: true,
  isTest: false,
  isFreeTrial: false,
  allowedCustomerOperations: ["Delete", "Update", "Read"],
  sandboxType: "None",
  sessionMode: "None",
};

const createApi: (http: FakeHttpClient) => AzureMarketplaceAPI = (
  http: FakeHttpClient,
): AzureMarketplaceAPI => {
  return new AzureMarketplaceAPI({
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    httpClient: http.client,
  });
};

describe("AzureMarketplaceAPI", () => {
  it("gets a client-credentials token for the marketplace API, once", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 200, body: SUBSCRIPTION },
      { status: 200, body: SUBSCRIPTION },
    ]);
    const api: AzureMarketplaceAPI = createApi(http);

    await api.getSubscription(SUBSCRIPTION_ID);
    await api.getSubscription(SUBSCRIPTION_ID);

    expect(http.requests).toHaveLength(3);

    const tokenRequest: MarketplaceHttpRequest = http.requests[0]!;
    expect(tokenRequest.url).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    );

    const form: URLSearchParams = new URLSearchParams(tokenRequest.body);
    expect(Object.fromEntries(form.entries())).toEqual({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: `${AZURE_MARKETPLACE_API_RESOURCE_ID}/.default`,
    });
    expect(AZURE_MARKETPLACE_API_RESOURCE_ID).toBe(
      "20e940b3-4c77-4b0b-9a53-9e16a1b010a7",
    );

    expect(http.requests[1]!.headers!["Authorization"]).toBe(
      "Bearer entra-token",
    );
  });

  it("does not put the client secret in the error when Entra refuses it", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 401,
        body: {
          error: "invalid_client",
          error_description: "AADSTS7000215: Invalid client secret provided.",
        },
      },
    ]);

    const error: unknown = await createApi(http)
      .getSubscription(SUBSCRIPTION_ID)
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(MarketplaceApiError);
    expect((error as Error).message).toContain("invalid_client");
    expect((error as Error).message).not.toContain(CLIENT_SECRET);
  });

  it("resolves a landing-page token to its subscription", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      {
        status: 200,
        body: {
          id: SUBSCRIPTION_ID,
          subscriptionName: "OneUptime for Contoso",
          offerId: "oneuptime-cloud",
          planId: "pay-as-you-go",
          quantity: 1,
          subscription: SUBSCRIPTION,
        },
      },
    ]);

    const subscription: AzureSaasSubscription = await createApi(http).resolve(
      "purchase-token/with+chars==",
    );

    expect(subscription).toEqual({
      id: SUBSCRIPTION_ID,
      name: "OneUptime for Contoso",
      offerId: "oneuptime-cloud",
      planId: "pay-as-you-go",
      quantity: 1,
      status: "PendingFulfillmentStart",
      beneficiary: {
        emailId: "admin@contoso.com",
        tenantId: "t-beneficiary",
        objectId: "o-1",
      },
      purchaser: {
        emailId: "buyer@contoso.com",
        tenantId: "t-purchaser",
        objectId: "o-2",
      },
      isFreeTrial: false,
      isTest: false,
      termStartDate: "2026-10-16T00:00:00Z",
      termEndDate: "2026-11-15T00:00:00Z",
      termUnit: "P1M",
      autoRenew: true,
    });

    const request: MarketplaceHttpRequest = http.requests[1]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve?api-version=2018-08-31",
    );
    // The token goes in its header exactly as the buyer's browser brought it.
    expect(request.headers!["x-ms-marketplace-token"]).toBe(
      "purchase-token/with+chars==",
    );
    expect(request.headers!["x-ms-requestid"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("says when Microsoft refuses a landing-page token, and when it names no subscription", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 400, body: { error: { code: "BadArgument" } } },
      { status: 200, body: { subscriptionName: "x" } },
    ]);
    const api: AzureMarketplaceAPI = createApi(http);

    const refused: unknown = await api
      .resolve("expired")
      .catch((err: unknown) => {
        return err;
      });
    expect((refused as MarketplaceApiError).status).toBe(400);
    expect((refused as MarketplaceApiError).isRetryable).toBe(false);

    await expect(api.resolve("odd")).rejects.toThrow(/no subscription ID/);
  });

  it("reads a subscription, and null for one Microsoft does not have", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      {
        status: 200,
        body: { ...SUBSCRIPTION, saasSubscriptionStatus: "Subscribed" },
      },
      { status: 404, body: "" },
    ]);
    const api: AzureMarketplaceAPI = createApi(http);

    await expect(api.getSubscription(SUBSCRIPTION_ID)).resolves.toMatchObject({
      id: SUBSCRIPTION_ID,
      status: "Subscribed",
    });
    expect(http.requests[1]!.url).toBe(
      `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${SUBSCRIPTION_ID}?api-version=2018-08-31`,
    );

    await expect(api.getSubscription("gone")).resolves.toBeNull();
  });

  it("activates a subscription on its plan and quantity", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 200, body: "" },
      { status: 200, body: "" },
    ]);
    const api: AzureMarketplaceAPI = createApi(http);

    await api.activate({
      subscriptionId: SUBSCRIPTION_ID,
      planId: "pay-as-you-go",
      quantity: 5,
    });
    await api.activate({
      subscriptionId: SUBSCRIPTION_ID,
      planId: "pay-as-you-go",
      quantity: null,
    });

    expect(http.requests[1]!.url).toBe(
      `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${SUBSCRIPTION_ID}/activate?api-version=2018-08-31`,
    );
    expect(JSON.parse(http.requests[1]!.body!)).toEqual({
      planId: "pay-as-you-go",
      quantity: 5,
    });
    expect(JSON.parse(http.requests[2]!.body!)).toEqual({
      planId: "pay-as-you-go",
    });
  });

  it("reads an operation, whatever spacing Microsoft puts in its id key", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      {
        status: 200,
        body: {
          "id  ": "op-1",
          activityId: "a-1",
          subscriptionId: SUBSCRIPTION_ID,
          offerId: "oneuptime-cloud",
          publisherId: "hackerbay",
          planId: "pay-as-you-go-annual",
          quantity: "20",
          action: "ChangePlan",
          timeStamp: "2026-10-16T09:00:00Z",
          status: "InProgress",
          errorStatusCode: "",
          errorMessage: "",
        },
      },
      { status: 404, body: "" },
    ]);
    const api: AzureMarketplaceAPI = createApi(http);

    const operation: AzureOperation | null = await api.getOperation(
      SUBSCRIPTION_ID,
      "op-1",
    );

    expect(operation).toEqual({
      id: "op-1",
      subscriptionId: SUBSCRIPTION_ID,
      action: "ChangePlan",
      status: "InProgress",
      planId: "pay-as-you-go-annual",
      quantity: 20,
    });
    expect(http.requests[1]!.url).toBe(
      `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${SUBSCRIPTION_ID}/operations/op-1?api-version=2018-08-31`,
    );

    await expect(api.getOperation(SUBSCRIPTION_ID, "gone")).resolves.toBeNull();
  });

  it("accepts an operation with a PATCH", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 200, body: "" },
    ]);

    await createApi(http).updateOperation({
      subscriptionId: SUBSCRIPTION_ID,
      operationId: "op-1",
      status: "Success",
    });

    expect(http.requests[1]).toMatchObject({
      method: "PATCH",
      url: `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${SUBSCRIPTION_ID}/operations/op-1?api-version=2018-08-31`,
    });
    expect(JSON.parse(http.requests[1]!.body!)).toEqual({ status: "Success" });
  });

  it("sends usage events in a batch, and reads each event's own result", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      {
        status: 200,
        body: {
          count: 2,
          result: [
            {
              usageEventId: "ue-1",
              status: "Accepted",
              messageTime: "2026-10-16T10:00:05Z",
              resourceId: SUBSCRIPTION_ID,
              quantity: 2200,
              dimension: "usage_units",
              effectiveStartTime: "2026-10-16T09:00:00Z",
              planId: "pay-as-you-go",
            },
            {
              status: "Duplicate",
              messageTime: "2026-10-16T10:00:05Z",
              error: { code: "Conflict", message: "duplicate" },
              resourceId: SUBSCRIPTION_ID,
              quantity: 3,
              dimension: "usage_units",
              effectiveStartTime: "2026-10-16T08:00:00Z",
              planId: "pay-as-you-go",
            },
          ],
        },
      },
    ]);

    const results: Array<AzureUsageEventResult> = await createApi(
      http,
    ).reportUsageEvents([
      {
        resourceId: SUBSCRIPTION_ID,
        quantity: 2200,
        dimension: "usage_units",
        effectiveStartTime: new Date("2026-10-16T09:00:00.000Z"),
        planId: "pay-as-you-go",
      },
      {
        resourceId: SUBSCRIPTION_ID,
        quantity: 3,
        dimension: "usage_units",
        effectiveStartTime: new Date("2026-10-16T08:00:00.000Z"),
        planId: "pay-as-you-go",
      },
    ]);

    expect(results).toEqual([
      { status: "Accepted", usageEventId: "ue-1", errorCode: null },
      { status: "Duplicate", usageEventId: null, errorCode: "Conflict" },
    ]);

    expect(http.requests[1]!.url).toBe(
      "https://marketplaceapi.microsoft.com/api/batchUsageEvent?api-version=2018-08-31",
    );
    expect(JSON.parse(http.requests[1]!.body!)).toEqual({
      request: [
        {
          resourceId: SUBSCRIPTION_ID,
          quantity: 2200,
          dimension: "usage_units",
          effectiveStartTime: "2026-10-16T09:00:00Z",
          planId: "pay-as-you-go",
        },
        {
          resourceId: SUBSCRIPTION_ID,
          quantity: 3,
          dimension: "usage_units",
          effectiveStartTime: "2026-10-16T08:00:00Z",
          planId: "pay-as-you-go",
        },
      ],
    });
  });

  /*
   * A Duplicate comes back with the event Microsoft kept for that hour
   * (error.additionalInfo.acceptedMessage), as in Microsoft's own example of
   * the batch API: its ID and quantity tell this report, sent again, from
   * another report filed in the same hour.
   */
  it("reads the event Microsoft kept when it answers Duplicate", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      {
        status: 200,
        body: {
          count: 3,
          result: [
            {
              status: "Duplicate",
              messageTime: "0001-01-01T00:00:00",
              error: {
                additionalInfo: {
                  acceptedMessage: {
                    usageEventId: "ue-kept",
                    status: "Duplicate",
                    messageTime: "2026-10-16T09:01:05.3458658Z",
                    resourceId: SUBSCRIPTION_ID,
                    quantity: 2200.0,
                    dimension: "usage_units",
                    effectiveStartTime: "2026-10-16T09:00:00Z",
                    planId: "pay-as-you-go",
                  },
                },
                message: "This usage event already exist.",
                code: "Conflict",
              },
              resourceId: SUBSCRIPTION_ID,
              quantity: 640,
              dimension: "usage_units",
              effectiveStartTime: "2026-10-16T09:00:00Z",
              planId: "pay-as-you-go",
            },
            {
              status: "Duplicate",
              error: {
                additionalInfo: {
                  acceptedMessage: { quantity: "not a number" },
                },
                code: "Conflict",
              },
            },
            {
              status: "Duplicate",
              error: { additionalInfo: "unexpected", code: "Conflict" },
            },
          ],
        },
      },
    ]);

    const results: Array<AzureUsageEventResult> = await createApi(
      http,
    ).reportUsageEvents([
      {
        resourceId: SUBSCRIPTION_ID,
        quantity: 640,
        dimension: "usage_units",
        effectiveStartTime: new Date("2026-10-16T09:00:00.000Z"),
        planId: "pay-as-you-go",
      },
    ]);

    expect(results).toEqual([
      {
        status: "Duplicate",
        usageEventId: null,
        errorCode: "Conflict",
        acceptedEvent: { usageEventId: "ue-kept", quantity: 2200 },
      },
      // What cannot be read is left unknown, never guessed.
      {
        status: "Duplicate",
        usageEventId: null,
        errorCode: "Conflict",
        acceptedEvent: { usageEventId: null, quantity: null },
      },
      { status: "Duplicate", usageEventId: null, errorCode: "Conflict" },
    ]);
  });

  it("writes usage times the way Microsoft's examples do", () => {
    expect(
      AzureMarketplaceAPI.toUsageTime(new Date("2026-10-16T09:00:00.123Z")),
    ).toBe("2026-10-16T09:00:00Z");
  });

  it("reads only what a subscription has", () => {
    expect(AzureMarketplaceAPI.parseSubscription({ name: "x" })).toBeNull();

    expect(
      AzureMarketplaceAPI.parseSubscription({
        id: SUBSCRIPTION_ID,
        quantity: 0,
        beneficiary: "not-an-object",
        isFreeTrial: "true",
      }),
    ).toMatchObject({
      quantity: null,
      status: "",
      beneficiary: { emailId: null, tenantId: null, objectId: null },
      isFreeTrial: false,
      autoRenew: null,
    });
  });
});
