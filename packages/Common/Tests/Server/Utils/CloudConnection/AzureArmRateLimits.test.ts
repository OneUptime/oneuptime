import AzureArm, {
  AZURE_COST_CLIENT_TYPE,
  AzureArmAnswer,
  AzureArmError,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import { CloudConnectorTransport } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
  sequence,
} from "../LlmObservability/FakeProviderApi";
import { describe, expect, test } from "@jest/globals";

/*
 * Azure Resource Manager's requests read their answer's status and headers
 * themselves (acceptAnyStatus), so a throttle's wait reaches whoever asks
 * again - the transport threw the headers away with any answer outside 2xx.
 * An answer outside 2xx is still thrown as the very error the transport's
 * became, and a transport that throws for the status (an older test's) is
 * answered as before.
 */

const TENANT: string = "00000000-0000-4000-8000-0000000000aa";
const SUBSCRIPTION: string = "11111111-2222-4333-8444-555555555555";
const QUERY_URL: string = `https://management.azure.com/subscriptions/${SUBSCRIPTION}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
const QUERY_PATH: string = `/subscriptions/${SUBSCRIPTION}/providers/Microsoft.CostManagement/query`;
const THROTTLED_BODY: string =
  '{"error":{"code":"429","message":"Too many requests. Please retry."}}';

function apiOf(respond: () => FakeResponse): FakeProviderApi {
  return createFakeProviderApi([
    {
      host: "login.microsoftonline.com",
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "azure-access-token", expires_in: 3599 });
      },
    },
    {
      host: "management.azure.com",
      path: QUERY_PATH,
      method: "POST",
      respond,
    },
    {
      host: "management.azure.com",
      path: "/subscriptions",
      respond,
    },
  ]);
}

function armOf(
  transport: CloudConnectorTransport,
  sleeps: Array<number> = [],
): AzureArm {
  return new AzureArm({
    tenantId: TENANT,
    clientId: "22222222-3333-4444-8555-666666666666",
    clientSecret: "client-secret-value-0000",
    cloud: "public",
    transport,
    sleep: async (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
    },
  });
}

// The same API through a transport that throws for any status, as before.
function throwingTransport(api: FakeProviderApi): CloudConnectorTransport {
  return async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    return await api.transport({ ...request, acceptAnyStatus: false });
  };
}

async function failureOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the request to fail.");
}

describe("a throttled Cost Management query", () => {
  test("carries the wait its headers asked for, and what they said", async () => {
    const api: FakeProviderApi = apiOf((): FakeResponse => {
      return {
        status: 429,
        body: THROTTLED_BODY,
        headers: {
          "x-ms-ratelimit-microsoft.costmanagement-entity-retry-after": "37",
          "x-ms-ratelimit-remaining-microsoft.costmanagement-entity-requests":
            "DefaultQuota:0",
          "x-ms-ratelimit-remaining-microsoft.costmanagement-tenant-requests":
            "DefaultQuota:15",
        },
      };
    });

    const error: unknown = await failureOf(async () => {
      await armOf(api.transport).queryCostManagement(
        QUERY_URL,
        { type: "ActualCost" },
        "cost query",
      );
    });

    expect(error).toBeInstanceOf(AzureArmError);
    expect(error).toBeInstanceOf(LlmProviderError);

    const failure: AzureArmError = error as AzureArmError;

    expect(failure.statusCode).toBe(429);
    expect(failure.kind).toBe(CloudConnectionFailureKind.RateLimited);
    expect(failure.retryAfterSeconds).toBe(37);
    expect(failure.rateLimit).toEqual({
      retryAfterMs: 37_000,
      isScopeOnly: true,
      entityRequestsRemaining: 0,
      tenantRequestsRemaining: 15,
    });
    expect(failure.message).toContain("Azure cost query failed with HTTP 429:");
    // Asked once: the caller paces it and asks again.
    expect(api.requestsTo(QUERY_PATH)).toHaveLength(1);
  });

  test("is the same error the transport's throw became, word for word", async () => {
    const answer: () => FakeResponse = (): FakeResponse => {
      return {
        status: 403,
        body: '{"error":{"code":"AuthorizationFailed","message":"The client does not have authorization to perform action Microsoft.CostManagement/query/action."}}',
      };
    };
    const read: AzureArmError = (await failureOf(async () => {
      await armOf(apiOf(answer).transport).queryCostManagement(
        QUERY_URL,
        {},
        "cost query",
      );
    })) as AzureArmError;
    const thrown: LlmProviderError = (await failureOf(async () => {
      await armOf(throwingTransport(apiOf(answer))).queryCostManagement(
        QUERY_URL,
        {},
        "cost query",
      );
    })) as LlmProviderError;

    expect(read.message).toBe(thrown.message);
    expect(read.kind).toBe(CloudConnectionFailureKind.Permission);
    expect(read.kind).toBe(thrown.kind);
    expect(read.statusCode).toBe(thrown.statusCode);
    expect(read.responseBody).toBe(thrown.responseBody);
    // The transport that throws keeps no headers: nothing to say of the limits.
    expect(thrown).not.toBeInstanceOf(AzureArmError);
  });

  test("names OneUptime as its client type, and asks for every status", async () => {
    const api: FakeProviderApi = apiOf((): FakeResponse => {
      return json({ properties: { rows: [] } });
    });

    const answer: AzureArmAnswer = await armOf(
      api.transport,
    ).queryCostManagement(QUERY_URL, {}, "cost query");

    expect(answer.body).toEqual({ properties: { rows: [] } });

    const sent: DataSourceHttpRequest = api.requestsTo(QUERY_PATH)[0]!;

    expect(AZURE_COST_CLIENT_TYPE).toBe("OneUptime");
    expect((sent.headers || {})["ClientType"]).toBe("OneUptime");
    expect(sent.acceptAnyStatus).toBe(true);
  });

  test("an answer's quotas come back with it", async () => {
    const api: FakeProviderApi = apiOf((): FakeResponse => {
      return {
        status: 200,
        body: { properties: { rows: [] } },
        headers: {
          "x-ms-ratelimit-microsoft.costmanagement-qpu-consumed": "3",
          "x-ms-ratelimit-microsoft.costmanagement-qpu-remaining":
            "QueryQuota10s:9,QueryQuota1min:57,QueryQuota1hour:597",
        },
      };
    });

    const answer: AzureArmAnswer = await armOf(
      api.transport,
    ).queryCostManagement(QUERY_URL, {}, "cost query");

    expect(answer.rateLimit).toEqual({ qpuConsumed: 3, qpuRemaining: 9 });
  });
});

describe("Resource Manager's other requests", () => {
  test("a 429 is asked again after its Retry-After, not a second", async () => {
    const sleeps: Array<number> = [];
    const api: FakeProviderApi = apiOf(
      sequence([
        {
          status: 429,
          body: '{"error":{"code":"TooManyRequests","message":"The request is throttled."}}',
          headers: { "retry-after": "3" },
        },
        json({
          value: [
            {
              subscriptionId: SUBSCRIPTION,
              displayName: "Production",
              state: "Enabled",
            },
          ],
        }),
      ]),
    );

    const subscriptions: Array<{ subscriptionId: string }> = await armOf(
      api.transport,
      sleeps,
    ).listSubscriptions();

    expect(subscriptions).toHaveLength(1);
    expect(sleeps).toEqual([3000]);
    // Never a Cost Management client type on a request that is not one of its queries.
    expect(
      (api.requestsTo("/subscriptions")[0]!.headers || {})["ClientType"],
    ).toBeUndefined();
  });

  test("an answer that names no wait backs off as before: a second, then two", async () => {
    const sleeps: Array<number> = [];
    const api: FakeProviderApi = apiOf(
      sequence([
        { status: 503, body: '{"error":{"code":"ServiceUnavailable"}}' },
        { status: 503, body: '{"error":{"code":"ServiceUnavailable"}}' },
        json({ value: [] }),
      ]),
    );

    await armOf(api.transport, sleeps).listSubscriptions();

    expect(sleeps).toEqual([1000, 2000]);
  });

  test("a transport that throws for the status is retried as before", async () => {
    const sleeps: Array<number> = [];
    const api: FakeProviderApi = apiOf(
      sequence([
        {
          status: 429,
          body: '{"error":{"code":"TooManyRequests"}}',
          headers: { "retry-after": "3" },
        },
        json({ value: [] }),
      ]),
    );

    await armOf(throwingTransport(api), sleeps).listSubscriptions();

    // No headers reach it: its own backoff.
    expect(sleeps).toEqual([1000]);
  });
});
