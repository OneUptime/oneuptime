import { describe, expect, test } from "@jest/globals";
import AzureMonitorClient from "../../../../Server/Utils/LlmObservability/Connectors/AzureOpenAI/AzureMonitorClient";
import AzureOpenAIConnector from "../../../../Server/Utils/LlmObservability/Connectors/AzureOpenAI/AzureOpenAIConnector";
import EntraTokenClient from "../../../../Server/Utils/LlmObservability/Connectors/Microsoft/EntraTokenClient";
import {
  LlmConnectionSettings,
  LlmUsageFetchResult,
} from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import { LlmUsageRecord } from "../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  FakeProviderApi,
  FakeRoute,
  createFakeProviderApi,
  json,
  queryValues,
} from "./FakeProviderApi";

/*
 * The Azure OpenAI / Foundry connection against fake Entra ID and Azure
 * Resource Manager endpoints: the client-credentials sign-in (scope, form
 * body, cached token), the subscription's model resources filtered by kind,
 * nextLink followed only on the management host, the metrics query (daily
 * Totals split by model), the fallback to the older per-deployment metrics
 * named through the deployments list, and failures without the secret.
 */

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SUBSCRIPTION: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const SECRET: string = "client~secret~value~for~tests~1234";
const TOKEN: string = "eyJhbGciOiJub25lIn0.eyJhdWQiOiJhcm0ifQ.c2ln";
const ACCOUNT_NEW: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/ai/providers/Microsoft.CognitiveServices/accounts/foundry-east`;
const ACCOUNT_OLD: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/ai/providers/Microsoft.CognitiveServices/accounts/aoai-legacy`;

const SETTINGS: LlmConnectionSettings = {
  provider: LlmConnectionProvider.AzureOpenAI,
  config: {
    tenantId: TENANT,
    clientId: CLIENT,
    subscriptionId: SUBSCRIPTION,
    cloud: "public",
  },
  secrets: { clientSecret: SECRET },
};

const WINDOW: { startDay: Date; endDay: Date } = {
  startDay: new Date("2026-10-18T00:00:00Z"),
  endDay: new Date("2026-10-20T00:00:00Z"),
};

function metric(
  name: string,
  series: Array<{ dims: JSONObject; data: Array<[string, number]> }>,
): JSONObject {
  return {
    name: { value: name, localizedValue: name },
    unit: "Count",
    timeseries: series.map(
      (entry: { dims: JSONObject; data: Array<[string, number]> }) => {
        return {
          metadatavalues: Object.keys(entry.dims).map((key: string) => {
            return {
              name: { value: key.toLowerCase(), localizedValue: key },
              value: entry.dims[key],
            };
          }),
          data: entry.data.map(([timeStamp, total]: [string, number]) => {
            return { timeStamp, total };
          }),
        };
      },
    ),
  };
}

function routes(
  overrides: Partial<Record<string, FakeRoute["respond"]>> = {},
): Array<FakeRoute> {
  return [
    {
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond:
        overrides["token"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({
            token_type: "Bearer",
            expires_in: 3599,
            access_token: TOKEN,
          });
        }),
    },
    {
      path: `/subscriptions/${SUBSCRIPTION}/providers/Microsoft.CognitiveServices/accounts`,
      respond:
        overrides["accounts"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({
            value: [
              {
                id: ACCOUNT_NEW,
                name: "foundry-east",
                kind: "AIServices",
                location: "eastus",
              },
              {
                id: ACCOUNT_OLD,
                name: "aoai-legacy",
                kind: "OpenAI",
                location: "westeurope",
              },
              {
                id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/ai/providers/Microsoft.CognitiveServices/accounts/speech`,
                name: "speech",
                kind: "SpeechServices",
                location: "eastus",
              },
            ],
          });
        }),
    },
    {
      path: `${ACCOUNT_NEW}/providers/Microsoft.Insights/metrics`,
      respond:
        overrides["newMetrics"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({
            value: [
              metric("InputTokens", [
                {
                  dims: { ModelDeploymentName: "chat", ModelName: "gpt-4o" },
                  data: [
                    ["2026-10-18T00:00:00Z", 1000],
                    ["2026-10-19T00:00:00Z", 2000],
                  ],
                },
                {
                  dims: { ModelDeploymentName: "chat-2", ModelName: "gpt-4o" },
                  data: [["2026-10-18T00:00:00Z", 500]],
                },
              ]),
              metric("OutputTokens", [
                {
                  dims: { ModelDeploymentName: "chat", ModelName: "gpt-4o" },
                  data: [["2026-10-18T00:00:00Z", 100]],
                },
              ]),
              metric("ModelRequests", [
                {
                  dims: { ModelDeploymentName: "chat", ModelName: "gpt-4o" },
                  data: [["2026-10-18T00:00:00Z", 7]],
                },
              ]),
              metric("cacheReadInputTokens", []),
            ],
          });
        }),
    },
    {
      path: `${ACCOUNT_OLD}/providers/Microsoft.Insights/metrics`,
      respond:
        overrides["oldMetrics"] ||
        ((
          _request: DataSourceHttpRequest,
          url: URL,
        ): ReturnType<FakeRoute["respond"]> => {
          // The newer metrics are empty here; the older ones have the usage.
          if (
            (url.searchParams.get("metricnames") || "").startsWith(
              "InputTokens",
            )
          ) {
            return json({ value: [metric("InputTokens", [])] });
          }

          return json({
            value: [
              metric("ProcessedPromptTokens", [
                {
                  dims: { ModelDeploymentName: "prod-gpt" },
                  data: [["2026-10-19T00:00:00Z", 9000]],
                },
              ]),
              metric("GeneratedTokens", [
                {
                  dims: { ModelDeploymentName: "prod-gpt" },
                  data: [["2026-10-19T00:00:00Z", 1000]],
                },
              ]),
              metric("AzureOpenAIRequests", [
                {
                  dims: { ModelDeploymentName: "prod-gpt" },
                  data: [["2026-10-19T00:00:00Z", 30]],
                },
              ]),
            ],
          });
        }),
    },
    {
      path: `${ACCOUNT_OLD}/deployments`,
      respond:
        overrides["deployments"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({
            value: [
              {
                name: "prod-gpt",
                properties: {
                  model: {
                    format: "OpenAI",
                    name: "gpt-4o-mini",
                    version: "2024-07-18",
                  },
                },
              },
            ],
          });
        }),
    },
  ];
}

describe("EntraTokenClient", () => {
  test.each([["contoso.onmicrosoft.com"], [TENANT]])(
    "tenant %s is accepted",
    (tenant: string) => {
      expect(() => {
        return EntraTokenClient.validateTenantId(tenant);
      }).not.toThrow();
    },
  );

  test.each([["not a tenant"], ["a/b"], [""], ["x".repeat(300)]])(
    "a tenant that is neither a GUID nor a domain is refused (case %#)",
    (tenant: string) => {
      expect(() => {
        return EntraTokenClient.validateTenantId(tenant);
      }).toThrow(BadDataException);
    },
  );

  test("Azure Government uses its own sign-in and management hosts", () => {
    expect(EntraTokenClient.getEndpoints("usgov")).toEqual({
      loginBaseUrl: "https://login.microsoftonline.us",
      managementBaseUrl: "https://management.usgovcloudapi.net",
      graphBaseUrl: "https://graph.microsoft.us",
    });
    expect(() => {
      return EntraTokenClient.resolveCloud("china");
    }).toThrow(BadDataException);
  });
});

describe("AzureOpenAIConnector", () => {
  test("signs in once with client credentials for Resource Manager", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    await new AzureOpenAIConnector().fetchUsage(SETTINGS, WINDOW, {
      transport: api.transport,
    });

    const tokenRequests: Array<DataSourceHttpRequest> = api.requestsTo(
      `/${TENANT}/oauth2/v2.0/token`,
    );
    expect(tokenRequests).toHaveLength(1);
    expect(new URL(tokenRequests[0]!.url).host).toBe(
      "login.microsoftonline.com",
    );
    expect(tokenRequests[0]!.formUrlEncoded).toBe(true);
    expect(tokenRequests[0]!.body).toMatchObject({
      grant_type: "client_credentials",
      client_id: CLIENT,
      client_secret: SECRET,
      scope: "https://management.azure.com/.default",
    });

    for (const request of api.requests.filter(
      (request: DataSourceHttpRequest) => {
        return request !== tokenRequests[0];
      },
    )) {
      expect(new URL(request.url).host).toBe("management.azure.com");
      expect(request.headers?.["Authorization"]).toBe(`Bearer ${TOKEN}`);
      expect(JSON.stringify(request)).not.toContain(SECRET);
    }
  });

  test("reads daily totals split by deployment and model", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    await new AzureOpenAIConnector().fetchUsage(SETTINGS, WINDOW, {
      transport: api.transport,
    });

    const request: DataSourceHttpRequest = api.requestsTo(
      `${ACCOUNT_NEW}/providers/Microsoft.Insights/metrics`,
    )[0]!;
    expect(queryValues(request, "metricnames")[0]).toBe(
      "InputTokens,OutputTokens,ModelRequests,cacheReadInputTokens,ephemeral5mInputTokens,ephemeral1hInputTokens",
    );
    expect(queryValues(request, "interval")).toEqual(["P1D"]);
    expect(queryValues(request, "aggregation")).toEqual(["Total"]);
    expect(queryValues(request, "timespan")).toEqual([
      "2026-10-18T00:00:00.000Z/2026-10-20T00:00:00.000Z",
    ]);
    expect(queryValues(request, "$filter")).toEqual([
      "ModelDeploymentName eq '*' and ModelName eq '*'",
    ]);
    expect(queryValues(request, "top")).toEqual(["500"]);
  });

  test("records are per day, resource and model; deployments of one model add up", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmUsageFetchResult =
      await new AzureOpenAIConnector().fetchUsage(SETTINGS, WINDOW, {
        transport: api.transport,
      });

    const day1: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return (
          record.project === "foundry-east" &&
          record.day.toISOString() === "2026-10-18T00:00:00.000Z"
        );
      },
    );

    expect(day1).toMatchObject({
      model: "gpt-4o",
      inputTokens: 1500,
      outputTokens: 100,
      requests: 7,
      person: "",
      apiKey: "",
      costUsd: null,
    });

    // The older resource: deployment names read as the model they serve.
    const legacy: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return record.project === "aoai-legacy";
      },
    );
    expect(legacy).toMatchObject({
      model: "gpt-4o-mini",
      inputTokens: 9000,
      outputTokens: 1000,
      requests: 30,
    });

    // The speech resource is not a model resource: never read.
    expect(
      api.requests.some((request: DataSourceHttpRequest) => {
        return request.url.includes("/accounts/speech/");
      }),
    ).toBe(false);
  });

  test("a nextLink to another host is not followed with the token", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        accounts: (): ReturnType<FakeRoute["respond"]> => {
          return json({
            value: [
              { id: ACCOUNT_NEW, name: "foundry-east", kind: "AIServices" },
            ],
            nextLink: "https://attacker.example.com/steal",
          });
        },
      }),
    );

    await new AzureOpenAIConnector().fetchUsage(SETTINGS, WINDOW, {
      transport: api.transport,
    });

    expect(
      api.requests.some((request: DataSourceHttpRequest) => {
        return new URL(request.url).host === "attacker.example.com";
      }),
    ).toBe(false);
  });

  test("a wrong secret is an authentication failure without the secret", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        token: (): ReturnType<FakeRoute["respond"]> => {
          return json(
            {
              error: "invalid_client",
              error_description: `AADSTS7000215: Invalid client secret provided: ${SECRET}`,
            },
            400,
          );
        },
      }),
    );

    const result: LlmConnectionTestResult =
      await new AzureOpenAIConnector().testConnection(SETTINGS, {
        transport: api.transport,
      });

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Authentication);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("a missing role is a permission failure", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        accounts: (): ReturnType<FakeRoute["respond"]> => {
          return json({ error: { code: "AuthorizationFailed" } }, 403);
        },
      }),
    );

    const error: unknown = await new AzureOpenAIConnector()
      .fetchUsage(SETTINGS, WINDOW, { transport: api.transport })
      .catch((caught: unknown) => {
        return caught;
      });

    expect((error as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.Permission,
    );
  });

  test("settings are checked before anything is sent", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmConnectionTestResult =
      await new AzureOpenAIConnector().testConnection(
        {
          ...SETTINGS,
          config: { ...SETTINGS.config, subscriptionId: "my-subscription" },
        },
        { transport: api.transport },
      );

    expect(result.failureKind).toBe(LlmConnectionFailureKind.Settings);
    expect(result.message).toContain("Subscription ID");
    expect(api.requests).toHaveLength(0);
  });

  test("the test counts the resources with usage", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmConnectionTestResult =
      await new AzureOpenAIConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now: (): Date => {
          return new Date("2026-10-19T08:00:00Z");
        },
      });

    expect(result.status).toBe("pass");
    expect(result.counts?.resources).toBe(2);
  });

  test("a resource id that could leave its path is refused", () => {
    expect(() => {
      return AzureMonitorClient.assertResourceId("/subscriptions/x/../../evil");
    }).toThrow(BadDataException);
    expect(() => {
      return AzureMonitorClient.assertResourceId("https://evil.example.com/x");
    }).toThrow(BadDataException);
    expect(() => {
      return AzureMonitorClient.assertResourceId(ACCOUNT_NEW);
    }).not.toThrow();
  });

  test("metric points of zero or without a time are skipped", () => {
    expect(
      AzureMonitorClient.readMetricPoints({
        value: [
          metric("InputTokens", [
            {
              dims: { ModelName: "gpt-4o" },
              data: [
                ["2026-10-18T00:00:00Z", 0],
                ["not a time", 5],
                ["2026-10-19T00:00:00Z", 4],
              ],
            },
          ]),
        ],
      }),
    ).toEqual([
      {
        metric: "InputTokens",
        day: new Date("2026-10-19T00:00:00Z"),
        total: 4,
        dimensions: { modelname: "gpt-4o" },
      },
    ]);
  });
});
