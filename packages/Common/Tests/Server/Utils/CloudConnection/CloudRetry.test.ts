import { describe, expect, test } from "@jest/globals";
import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import {
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  CLOUD_FIRST_RETRY_WAIT_MS,
  CLOUD_RETRIES,
  isRetryableCloudFailure,
  withCloudRetries,
} from "../../../../Server/Utils/CloudConnection/CloudRetry";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  bodyOf,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * A cloud that says "not now" - a 429, or a gateway's 502, 503 or 504 - is
 * asked again a little later, a few times, each try a request of the
 * read's budget; anything else fails at once. Azure Resource Graph, which
 * allows fifteen queries in five seconds, is read this way page after
 * page.
 */

function failure(
  status: number,
  kind?: CloudConnectionFailureKind,
): LlmProviderError {
  return new LlmProviderError({
    message: `HTTP ${status}`,
    kind:
      kind ||
      (status === 429
        ? CloudConnectionFailureKind.RateLimited
        : status >= 500
          ? CloudConnectionFailureKind.Unavailable
          : CloudConnectionFailureKind.Other),
    statusCode: status,
  });
}

describe("which failures are asked again", () => {
  test("a rate limit, and a gateway that did not get through", () => {
    expect(isRetryableCloudFailure(failure(429))).toBe(true);
    expect(isRetryableCloudFailure(failure(502))).toBe(true);
    expect(isRetryableCloudFailure(failure(503))).toBe(true);
    expect(isRetryableCloudFailure(failure(504))).toBe(true);
  });

  test("never a refusal, a bad request, a timeout or an error that is not the provider's", () => {
    expect(
      isRetryableCloudFailure(
        failure(401, CloudConnectionFailureKind.Authentication),
      ),
    ).toBe(false);
    expect(
      isRetryableCloudFailure(
        failure(403, CloudConnectionFailureKind.Permission),
      ),
    ).toBe(false);
    expect(isRetryableCloudFailure(failure(400))).toBe(false);
    expect(isRetryableCloudFailure(failure(500))).toBe(false);
    // A timeout carries no status: asking again would only wait as long again.
    expect(
      isRetryableCloudFailure(
        new LlmProviderError({
          message: "timed out",
          kind: CloudConnectionFailureKind.Unavailable,
        }),
      ),
    ).toBe(false);
    expect(isRetryableCloudFailure(new Error("boom"))).toBe(false);
    expect(isRetryableCloudFailure(new CloudReadBudgetSpent())).toBe(false);
  });
});

describe("a call asked again", () => {
  test("answers as soon as it can, waiting a second, then two, then four", async () => {
    const waits: Array<number> = [];
    let tries: number = 0;

    const answer: string = await withCloudRetries({
      call: async (): Promise<string> => {
        tries++;

        if (tries <= CLOUD_RETRIES) {
          throw failure(429);
        }

        return "rows";
      },
      sleep: async (milliseconds: number) => {
        waits.push(milliseconds);
      },
    });

    expect(answer).toBe("rows");
    expect(tries).toBe(CLOUD_RETRIES + 1);
    expect(waits).toEqual([
      CLOUD_FIRST_RETRY_WAIT_MS,
      CLOUD_FIRST_RETRY_WAIT_MS * 2,
      CLOUD_FIRST_RETRY_WAIT_MS * 4,
    ]);
  });

  test("gives up after its tries, with the provider's own failure", async () => {
    const throttled: LlmProviderError = failure(429);
    let tries: number = 0;

    await expect(
      withCloudRetries({
        call: async (): Promise<string> => {
          tries++;
          throw throttled;
        },
        sleep: async () => {},
      }),
    ).rejects.toBe(throttled);
    expect(tries).toBe(CLOUD_RETRIES + 1);
  });

  test("waits what the provider asks (Retry-After), never longer than its longest wait", async () => {
    const waits: Array<number> = [];
    let tries: number = 0;

    await withCloudRetries({
      call: async (): Promise<string> => {
        tries++;

        if (tries === 1) {
          throw new LlmProviderError({
            message: "slow down",
            kind: CloudConnectionFailureKind.RateLimited,
            statusCode: 429,
            retryAfterSeconds: 2,
          });
        }

        if (tries === 2) {
          throw new LlmProviderError({
            message: "slow down a lot",
            kind: CloudConnectionFailureKind.RateLimited,
            statusCode: 429,
            retryAfterSeconds: 3600,
          });
        }

        return "ok";
      },
      sleep: async (milliseconds: number) => {
        waits.push(milliseconds);
      },
    });

    expect(waits).toEqual([2000, CLOUD_FIRST_RETRY_WAIT_MS * 4]);
  });

  test("a failure that is not worth asking again fails at once", async () => {
    let tries: number = 0;

    await expect(
      withCloudRetries({
        call: async (): Promise<string> => {
          tries++;
          throw failure(403, CloudConnectionFailureKind.Permission);
        },
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(LlmProviderError);
    expect(tries).toBe(1);
  });
});

describe("Azure Resource Graph, asked page after page", () => {
  function fakeGraph(throttledTries: number): FakeProviderApi & {
    queries: Array<JSONObject>;
  } {
    const queries: Array<JSONObject> = [];
    let throttled: number = 0;

    const api: FakeProviderApi = createFakeProviderApi([
      {
        host: "login.microsoftonline.com",
        path: /\/oauth2\/v2\.0\/token$/,
        method: "POST",
        respond: (): FakeResponse => {
          return json({ access_token: "token", expires_in: 3600 });
        },
      },
      {
        host: "management.azure.com",
        path: "/providers/Microsoft.ResourceGraph/resources",
        method: "POST",
        respond: (request: DataSourceHttpRequest): FakeResponse => {
          queries.push(bodyOf(request));

          if (throttled < throttledTries) {
            throttled++;
            return json(
              {
                error: {
                  code: "RateLimiting",
                  message: "Please provide below info when asking for support",
                },
              },
              429,
            );
          }

          return json({ data: [{ id: "/subscriptions/x/resourceGroups/r" }] });
        },
      },
    ]);

    return { ...api, queries };
  }

  function arm(
    fake: FakeProviderApi,
    budget: CloudReadBudget,
    waits: Array<number>,
  ): AzureArm {
    return new AzureArm({
      tenantId: "00000000-0000-4000-8000-000000000001",
      clientId: "00000000-0000-4000-8000-000000000002",
      clientSecret: "secret-value-123",
      cloud: "public" as never,
      transport: fake.transport,
      budget,
      sleep: async (milliseconds: number) => {
        waits.push(milliseconds);
      },
    });
  }

  test("a query throttled twice is answered on the third try, each try a request of the budget", async () => {
    const fake: FakeProviderApi & { queries: Array<JSONObject> } = fakeGraph(2);
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 10,
      maxDurationMs: 60000,
    });
    const waits: Array<number> = [];

    const result: { rows: Array<JSONObject>; complete: boolean } = await arm(
      fake,
      budget,
      waits,
    ).queryResourceGraph({
      subscriptionIds: ["00000000-0000-4000-8000-000000000003"],
      query: "Resources | project id",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(fake.queries).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
    expect(budget.getUsed()).toBe(3);
  });

  test("a spent budget stops the tries", async () => {
    const fake: FakeProviderApi & { queries: Array<JSONObject> } = fakeGraph(5);
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 2,
      maxDurationMs: 60000,
    });

    await expect(
      arm(fake, budget, []).queryResourceGraph({
        subscriptionIds: ["00000000-0000-4000-8000-000000000003"],
        query: "Resources | project id",
      }),
    ).rejects.toBeInstanceOf(CloudReadBudgetSpent);
    expect(fake.queries).toHaveLength(2);
  });
});
