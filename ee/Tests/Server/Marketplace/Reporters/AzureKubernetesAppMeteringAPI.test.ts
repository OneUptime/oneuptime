import AzureKubernetesAppMeteringAPI, {
  AZURE_MARKETPLACE_METERING_RESOURCE,
  AzureUsageEvent,
  AzureUsageEventResult,
} from "../../../../Server/Marketplace/Reporters/AzureKubernetesAppMeteringAPI";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import { MarketplaceHttpRequest } from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import {
  FakeAnswer,
  FakeHttpClient,
  createFakeHttpClient,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * A Kubernetes application on AKS bills its custom meter itself: a token from
 * the node's instance metadata service for the extension's managed identity,
 * then one usage event per hour against the extension's ARM resource.
 */

const NOW: Date = new Date("2026-10-17T10:05:00.000Z");
const CLIENT_ID: string = "6f1d1e8c-1111-4a2b-9c3d-123456789abc";
const RESOURCE_URI: string =
  "/subscriptions/00000000-1111-2222-3333-444444444444/resourceGroups/rg-observability/providers/Microsoft.ContainerService/managedClusters/aks-prod/providers/Microsoft.KubernetesConfiguration/extensions/oneuptime";

const tokenAnswer: (expiresOnInSeconds: number) => FakeAnswer = (
  expiresOnInSeconds: number,
): FakeAnswer => {
  return {
    status: 200,
    body: {
      access_token: "imds-access-token",
      expires_in: "3599",
      expires_on: String(expiresOnInSeconds),
      resource: AZURE_MARKETPLACE_METERING_RESOURCE,
      token_type: "Bearer",
    },
  };
};

const batchAnswer: (result: Record<string, unknown>) => FakeAnswer = (
  result: Record<string, unknown>,
): FakeAnswer => {
  return { status: 200, body: { count: 1, result: [result] } };
};

const event: (overrides?: Partial<AzureUsageEvent>) => AzureUsageEvent = (
  overrides?: Partial<AzureUsageEvent>,
): AzureUsageEvent => {
  return {
    resourceUri: RESOURCE_URI,
    planId: "enterprise",
    dimension: "users",
    quantity: 42,
    effectiveStartTime: new Date("2026-10-17T09:00:00.000Z"),
    ...overrides,
  };
};

const createApi: (
  http: FakeHttpClient,
  now?: () => Date,
) => AzureKubernetesAppMeteringAPI = (
  http: FakeHttpClient,
  now?: () => Date,
): AzureKubernetesAppMeteringAPI => {
  return new AzureKubernetesAppMeteringAPI({
    clientId: CLIENT_ID,
    httpClient: http.client,
    now:
      now ||
      ((): Date => {
        return NOW;
      }),
    newRequestId: (): string => {
      return "11111111-2222-4333-8444-555555555555";
    },
  });
};

const expectMarketplaceError: (
  promise: Promise<unknown>,
) => Promise<MarketplaceApiError> = async (
  promise: Promise<unknown>,
): Promise<MarketplaceApiError> => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(MarketplaceApiError);
    return err as MarketplaceApiError;
  }

  throw new Error("Expected a MarketplaceApiError, but nothing was thrown.");
};

const inAnHour: number = Math.floor(NOW.getTime() / 1000) + 3600;

describe("AzureKubernetesAppMeteringAPI.emitUsageEvent", () => {
  it("gets a token for the extension's identity, then sends one event through the batch endpoint", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      tokenAnswer(inAnHour),
      batchAnswer({
        usageEventId: "event-1",
        status: "Accepted",
        messageTime: "2026-10-17T10:05:01Z",
        resourceUri: RESOURCE_URI,
        quantity: 42,
        dimension: "users",
        effectiveStartTime: "2026-10-17T09:00:00Z",
        planId: "enterprise",
      }),
    ]);

    const result: AzureUsageEventResult =
      await createApi(http).emitUsageEvent(event());

    expect(result).toEqual({
      status: "Accepted",
      usageEventId: "event-1",
      keptQuantity: null,
      message: "",
    });

    const tokenRequest: MarketplaceHttpRequest = http.requests[0]!;
    expect(tokenRequest.method).toBe("GET");
    const tokenUrl: URL = new URL(tokenRequest.url);
    expect(`${tokenUrl.origin}${tokenUrl.pathname}`).toBe(
      "http://169.254.169.254/metadata/identity/oauth2/token",
    );
    expect(tokenUrl.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(tokenUrl.searchParams.get("resource")).toBe(
      "20e940b3-4c77-4b0b-9a53-9e16a1b010a7",
    );
    expect(tokenUrl.searchParams.get("api-version")).toBe("2018-02-01");
    expect(tokenRequest.headers).toEqual({ Metadata: "true" });

    const eventRequest: MarketplaceHttpRequest = http.requests[1]!;
    expect(eventRequest.method).toBe("POST");
    expect(eventRequest.url).toBe(
      "https://marketplaceapi.microsoft.com/api/batchUsageEvent?api-version=2018-08-31",
    );
    expect(eventRequest.headers).toMatchObject({
      Authorization: "Bearer imds-access-token",
      "Content-Type": "application/json",
      "x-ms-requestid": "11111111-2222-4333-8444-555555555555",
      "x-ms-correlationid": "11111111-2222-4333-8444-555555555555",
    });
    expect(JSON.parse(eventRequest.body!)).toEqual({
      request: [
        {
          resourceUri: RESOURCE_URI,
          planId: "enterprise",
          dimension: "users",
          quantity: 42,
          effectiveStartTime: "2026-10-17T09:00:00.000Z",
        },
      ],
    });
  });

  it("reuses the token until five minutes before it expires", async () => {
    let now: Date = NOW;
    const http: FakeHttpClient = createFakeHttpClient([
      tokenAnswer(inAnHour),
      batchAnswer({ usageEventId: "a", status: "Accepted" }),
      batchAnswer({ usageEventId: "b", status: "Accepted" }),
      tokenAnswer(inAnHour + 3600),
      batchAnswer({ usageEventId: "c", status: "Accepted" }),
    ]);
    const api: AzureKubernetesAppMeteringAPI = createApi(http, (): Date => {
      return now;
    });

    await api.emitUsageEvent(event());
    now = new Date(NOW.getTime() + 54 * 60 * 1000);
    await api.emitUsageEvent(event());
    // 56 minutes in: four minutes left, so a new token.
    now = new Date(NOW.getTime() + 56 * 60 * 1000);
    await api.emitUsageEvent(event());

    const tokenRequests: Array<MarketplaceHttpRequest> = http.requests.filter(
      (request: MarketplaceHttpRequest): boolean => {
        return request.method === "GET";
      },
    );
    expect(tokenRequests).toHaveLength(2);
  });

  it("reads a duplicate with the quantity Microsoft kept for the hour", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      tokenAnswer(inAnHour),
      batchAnswer({
        status: "Duplicate",
        messageTime: "0001-01-01T00:00:00",
        error: {
          additionalInfo: {
            acceptedMessage: {
              usageEventId: "kept-event",
              status: "Duplicate",
              messageTime: "2026-10-17T09:05:00Z",
              resourceUri: RESOURCE_URI,
              quantity: 40,
              dimension: "users",
              effectiveStartTime: "2026-10-17T09:00:00Z",
              planId: "enterprise",
            },
          },
          message: "This usage event already exist.",
          code: "Conflict",
        },
      }),
    ]);

    const result: AzureUsageEventResult =
      await createApi(http).emitUsageEvent(event());

    expect(result).toEqual({
      status: "Duplicate",
      usageEventId: "kept-event",
      keptQuantity: 40,
      message: "This usage event already exist.",
    });
  });

  it("passes on Microsoft's word for an event it did not take", async () => {
    for (const status of [
      "Expired",
      "ResourceNotActive",
      "ResourceNotFound",
      "ResourceNotAuthorized",
      "InvalidDimension",
      "BadArgument",
      "Error",
    ]) {
      const result: AzureUsageEventResult = await createApi(
        createFakeHttpClient([
          tokenAnswer(inAnHour),
          batchAnswer({
            status: status,
            error: { message: `about ${status}` },
          }),
        ]),
      ).emitUsageEvent(event());

      expect(result.status).toBe(status);
      expect(result.message).toBe(`about ${status}`);
    }
  });

  it("drops a token Microsoft refuses, so the next attempt asks for a new one", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      tokenAnswer(inAnHour),
      { status: 403, body: { message: "Forbidden" } },
      tokenAnswer(inAnHour),
      batchAnswer({ usageEventId: "after", status: "Accepted" }),
    ]);
    const api: AzureKubernetesAppMeteringAPI = createApi(http);

    const error: MarketplaceApiError = await expectMarketplaceError(
      api.emitUsageEvent(event()),
    );
    expect(error.status).toBe(403);
    expect(error.isRetryable).toBe(true);

    const result: AzureUsageEventResult = await api.emitUsageEvent(event());
    expect(result.status).toBe("Accepted");
    expect(
      http.requests.filter((request: MarketplaceHttpRequest): boolean => {
        return request.method === "GET";
      }),
    ).toHaveLength(2);
  });

  it("asks again later when Microsoft fails, throttles or answers without a result", async () => {
    const answers: Array<FakeAnswer> = [
      { status: 503, body: "Service Unavailable" },
      { status: 429, body: { message: "Too many requests" } },
      { status: 200, body: { count: 0, result: [] } },
      new Error("socket hang up"),
    ];

    for (const answer of answers) {
      const error: MarketplaceApiError = await expectMarketplaceError(
        createApi(
          createFakeHttpClient([tokenAnswer(inAnHour), answer]),
        ).emitUsageEvent(event()),
      );

      expect(error.isRetryable).toBe(true);
    }
  });

  it("reports a node without the extension's identity as a setup problem", async () => {
    const error: MarketplaceApiError = await expectMarketplaceError(
      createApi(
        createFakeHttpClient([
          {
            status: 400,
            body: {
              error: "invalid_request",
              error_description: "Identity not found",
            },
          },
        ]),
      ).emitUsageEvent(event()),
    );

    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain("Identity not found");
  });

  it("explains an unreachable metadata service", async () => {
    const error: MarketplaceApiError = await expectMarketplaceError(
      createApi(
        createFakeHttpClient([new Error("connect EHOSTUNREACH")]),
      ).emitUsageEvent(event()),
    );

    expect(error.isRetryable).toBe(true);
    expect(error.message).toContain("instance metadata service");
  });

  it("needs the identity's client ID before asking for a token", async () => {
    const http: FakeHttpClient = createFakeHttpClient([]);

    const error: MarketplaceApiError = await expectMarketplaceError(
      new AzureKubernetesAppMeteringAPI({
        clientId: "  ",
        httpClient: http.client,
      }).emitUsageEvent(event()),
    );

    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain("global.azure.identity.clientId");
    expect(http.requests).toHaveLength(0);
  });

  it("refuses to send an event Microsoft would refuse anyway", async () => {
    const bad: Array<Partial<AzureUsageEvent>> = [
      { quantity: 0 },
      { quantity: -3 },
      { quantity: Number.NaN },
      { resourceUri: "" },
      { resourceUri: "not-an-arm-id" },
      { planId: "" },
      { dimension: "" },
      { effectiveStartTime: new Date("nope") },
    ];

    for (const overrides of bad) {
      const http: FakeHttpClient = createFakeHttpClient([]);

      const error: MarketplaceApiError = await expectMarketplaceError(
        createApi(http).emitUsageEvent(event(overrides)),
      );

      expect(error.isRetryable).toBe(false);
      expect(http.requests).toHaveLength(0);
    }
  });
});

describe("AzureKubernetesAppMeteringAPI statuses", () => {
  it("tells a resource that is not bought apart from a setup mistake", () => {
    expect(
      AzureKubernetesAppMeteringAPI.isNotEntitledStatus("ResourceNotActive"),
    ).toBe(true);
    expect(
      AzureKubernetesAppMeteringAPI.isNotEntitledStatus("ResourceNotFound"),
    ).toBe(true);
    expect(
      AzureKubernetesAppMeteringAPI.isNotEntitledStatus(
        "ResourceNotAuthorized",
      ),
    ).toBe(false);
    expect(
      AzureKubernetesAppMeteringAPI.isSetupStatus("ResourceNotAuthorized"),
    ).toBe(true);
    expect(
      AzureKubernetesAppMeteringAPI.isSetupStatus("InvalidDimension"),
    ).toBe(true);
    expect(AzureKubernetesAppMeteringAPI.isSetupStatus("Accepted")).toBe(false);
  });

  it("finds no result in an answer that has none", () => {
    expect(AzureKubernetesAppMeteringAPI.readBatchResult("")).toBeNull();
    expect(AzureKubernetesAppMeteringAPI.readBatchResult("[]")).toBeNull();
    expect(
      AzureKubernetesAppMeteringAPI.readBatchResult(
        JSON.stringify({ result: [{ usageEventId: "no-status" }] }),
      ),
    ).toBeNull();
  });
});
