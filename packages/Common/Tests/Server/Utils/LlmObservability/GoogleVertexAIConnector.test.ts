import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import GoogleMonitoringClient, {
  GoogleMonitoringPoint,
} from "../../../../Server/Utils/LlmObservability/Connectors/GoogleVertexAI/GoogleMonitoringClient";
import GoogleVertexAIConnector, {
  VERTEX_INVOCATION_COUNT_METRIC,
  VERTEX_TOKEN_COUNT_METRIC,
} from "../../../../Server/Utils/LlmObservability/Connectors/GoogleVertexAI/GoogleVertexAIConnector";
import {
  LlmConnectionSettings,
  LlmUsageFetchResult,
} from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
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
  sequence,
} from "./FakeProviderApi";

/*
 * The Google Vertex AI connection against fake Google OAuth and Cloud
 * Monitoring endpoints: a service-account assertion signed RS256 for the
 * monitoring.read scope and exchanged at the key's token_uri, timeSeries
 * read as hourly sums ending on the hour and never in the future, grouped by
 * model, Region and token type, hours added up into UTC days, and paging.
 */

const PROJECT_ID: string = "acme-ai-prod";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const SERVICE_ACCOUNT: string = JSON.stringify({
  type: "service_account",
  project_id: PROJECT_ID,
  client_email: "oneuptime@acme-ai-prod.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});
const ACCESS_TOKEN: string = "ya29.test-access-token";
const NOW: Date = new Date("2026-10-19T10:25:00Z");

const SETTINGS: LlmConnectionSettings = {
  provider: LlmConnectionProvider.GoogleVertexAI,
  config: { projectId: PROJECT_ID },
  secrets: { serviceAccountJson: SERVICE_ACCOUNT },
};

const WINDOW: { startDay: Date; endDay: Date } = {
  startDay: new Date("2026-10-18T00:00:00Z"),
  endDay: new Date("2026-10-20T00:00:00Z"),
};

function series(data: {
  model: string;
  location: string;
  type?: string | undefined;
  points: Array<[string, number]>;
}): JSONObject {
  return {
    metric: {
      type: VERTEX_TOKEN_COUNT_METRIC,
      labels: data.type ? { type: data.type } : {},
    },
    resource: {
      type: "aiplatform.googleapis.com/PublisherModel",
      labels: {
        resource_container: PROJECT_ID,
        location: data.location,
        publisher: "google",
        model_user_id: data.model,
        model_version_id: "",
      },
    },
    metricKind: "DELTA",
    valueType: "INT64",
    points: data.points.map(([end, value]: [string, number]) => {
      return {
        interval: {
          startTime: new Date(Date.parse(end) - 3600000).toISOString(),
          endTime: end,
        },
        value: { int64Value: String(value) },
      };
    }),
  };
}

function routes(
  overrides: Partial<Record<string, FakeRoute["respond"]>> = {},
): Array<FakeRoute> {
  return [
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond:
        overrides["token"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({
            access_token: ACCESS_TOKEN,
            expires_in: 3599,
            token_type: "Bearer",
          });
        }),
    },
    {
      host: "monitoring.googleapis.com",
      path: `/v3/projects/${PROJECT_ID}/timeSeries`,
      respond:
        overrides["timeSeries"] ||
        ((
          _request: DataSourceHttpRequest,
          url: URL,
        ): ReturnType<FakeRoute["respond"]> => {
          if (
            (url.searchParams.get("filter") || "").includes(
              "model_invocation_count",
            )
          ) {
            return json({
              timeSeries: [
                series({
                  model: "gemini-2.5-pro",
                  location: "us-central1",
                  points: [
                    ["2026-10-18T10:00:00Z", 3],
                    ["2026-10-18T11:00:00Z", 2],
                  ],
                }),
              ],
            });
          }

          return json({
            timeSeries: [
              series({
                model: "gemini-2.5-pro",
                location: "us-central1",
                type: "input",
                points: [
                  ["2026-10-18T10:00:00Z", 1000],
                  ["2026-10-18T11:00:00Z", 500],
                  // The hour that ends at midnight is the day before's.
                  ["2026-10-19T00:00:00Z", 7],
                ],
              }),
              series({
                model: "gemini-2.5-pro",
                location: "us-central1",
                type: "output",
                points: [["2026-10-18T10:00:00Z", 200]],
              }),
              series({
                model: "claude-opus-4-5@20251101",
                location: "europe-west1",
                type: "input",
                points: [["2026-10-19T09:00:00Z", 40]],
              }),
            ],
          });
        }),
    },
  ];
}

describe("GoogleMonitoringClient", () => {
  test.each([["acme-ai-prod"], ["a1b2c3"]])(
    "project %s is accepted",
    (projectId: string) => {
      expect(() => {
        return GoogleMonitoringClient.validateProjectId(projectId);
      }).not.toThrow();
    },
  );

  test.each([["Acme"], ["1abcdef"], ["abc"], ["a/b/c/d/e/f"], ["acme-"]])(
    "project %s is refused",
    (projectId: string) => {
      expect(() => {
        return GoogleMonitoringClient.validateProjectId(projectId);
      }).toThrow(BadDataException);
    },
  );

  test("signs in with a service-account assertion for the monitoring.read scope", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    await new GoogleVertexAIConnector().fetchUsage(SETTINGS, WINDOW, {
      transport: api.transport,
      now: (): Date => {
        return NOW;
      },
    });

    const tokenRequests: Array<DataSourceHttpRequest> =
      api.requestsTo("/token");
    expect(tokenRequests).toHaveLength(1);
    const body: Record<string, string> = tokenRequests[0]!.body as Record<
      string,
      string
    >;
    expect(body["grant_type"]).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );

    const claims: Record<string, unknown> = jwt.decode(
      body["assertion"]!,
    ) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: "oneuptime@acme-ai-prod.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/monitoring.read",
      aud: "https://oauth2.googleapis.com/token",
    });
    expect(
      (
        jwt.decode(body["assertion"]!, { complete: true }) as {
          header: { alg: string };
        }
      ).header.alg,
    ).toBe("RS256");

    // The private key is never sent.
    for (const request of api.requests) {
      expect(JSON.stringify(request)).not.toContain("PRIVATE KEY");
    }
  });

  test("reads hourly sums that end on the hour, grouped by model, Region and type", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    await new GoogleVertexAIConnector().fetchUsage(SETTINGS, WINDOW, {
      transport: api.transport,
      now: (): Date => {
        return NOW;
      },
    });

    const tokenRead: DataSourceHttpRequest = api
      .requestsTo(`/v3/projects/${PROJECT_ID}/timeSeries`)
      .find((request: DataSourceHttpRequest) => {
        return (queryValues(request, "filter")[0] || "").includes(
          "token_count",
        );
      })!;

    expect(queryValues(tokenRead, "filter")).toEqual([
      `metric.type="${VERTEX_TOKEN_COUNT_METRIC}"`,
    ]);
    expect(queryValues(tokenRead, "interval.startTime")).toEqual([
      "2026-10-18T00:00:00.000Z",
    ]);
    // Now is 10:25, so the read ends at 10:00: no partial hour, no future.
    expect(queryValues(tokenRead, "interval.endTime")).toEqual([
      "2026-10-19T10:00:00.000Z",
    ]);
    expect(queryValues(tokenRead, "aggregation.alignmentPeriod")).toEqual([
      "3600s",
    ]);
    expect(queryValues(tokenRead, "aggregation.perSeriesAligner")).toEqual([
      "ALIGN_SUM",
    ]);
    expect(queryValues(tokenRead, "aggregation.crossSeriesReducer")).toEqual([
      "REDUCE_SUM",
    ]);
    expect(queryValues(tokenRead, "aggregation.groupByFields")).toEqual([
      "resource.label.model_user_id",
      "resource.label.location",
      "metric.label.type",
    ]);
    expect(tokenRead.headers?.["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  test("follows nextPageToken", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        timeSeries: sequence([
          json({ timeSeries: [], nextPageToken: "two" }),
          json({ timeSeries: [] }),
        ]),
      }),
    );
    const client: GoogleMonitoringClient = new GoogleMonitoringClient({
      projectId: PROJECT_ID,
      serviceAccountJson: SERVICE_ACCOUNT,
      transport: api.transport,
    });

    const points: Array<GoogleMonitoringPoint> = await client.listHourlySums({
      metricType: VERTEX_INVOCATION_COUNT_METRIC,
      groupByFields: [],
      startTime: WINDOW.startDay,
      endTime: WINDOW.endDay,
    });

    expect(points).toEqual([]);
    const reads: Array<DataSourceHttpRequest> = api.requestsTo(
      `/v3/projects/${PROJECT_ID}/timeSeries`,
    );
    expect(reads).toHaveLength(2);
    expect(queryValues(reads[1]!, "pageToken")).toEqual(["two"]);
  });
});

describe("GoogleVertexAIConnector", () => {
  test("hours add up into UTC days per model and Region", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmUsageFetchResult =
      await new GoogleVertexAIConnector().fetchUsage(SETTINGS, WINDOW, {
        transport: api.transport,
        now: (): Date => {
          return NOW;
        },
      });

    const gemini: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return record.model === "gemini-2.5-pro";
      },
    );

    expect(gemini).toMatchObject({
      day: new Date("2026-10-18T00:00:00Z"),
      project: "us-central1",
      inputTokens: 1507,
      outputTokens: 200,
      requests: 5,
      person: "",
      apiKey: "",
      costUsd: null,
    });

    expect(
      result.records.find((record: LlmUsageRecord) => {
        return record.model === "claude-opus-4-5@20251101";
      }),
    ).toMatchObject({
      day: new Date("2026-10-19T00:00:00Z"),
      project: "europe-west1",
      inputTokens: 40,
    });
  });

  test("a window that has not started yet reads nothing", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmUsageFetchResult =
      await new GoogleVertexAIConnector().fetchUsage(
        SETTINGS,
        {
          startDay: new Date("2026-10-19T00:00:00Z"),
          endDay: new Date("2026-10-20T00:00:00Z"),
        },
        {
          transport: api.transport,
          now: (): Date => {
            return new Date("2026-10-19T00:20:00Z");
          },
        },
      );

    expect(result.records).toEqual([]);
    expect(api.requests).toHaveLength(0);
  });

  test("a key that is not a service account key is refused before anything is sent", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmConnectionTestResult =
      await new GoogleVertexAIConnector().testConnection(
        {
          ...SETTINGS,
          secrets: { serviceAccountJson: '{"client_email": "x"}' },
        },
        { transport: api.transport },
      );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Settings);
    expect(api.requests).toHaveLength(0);
  });

  test("a revoked key is an authentication failure", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        token: (): ReturnType<FakeRoute["respond"]> => {
          return json(
            {
              error: "invalid_grant",
              error_description: "Invalid JWT Signature.",
            },
            400,
          );
        },
      }),
    );

    const result: LlmConnectionTestResult =
      await new GoogleVertexAIConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now: (): Date => {
          return NOW;
        },
      });

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Authentication);
  });

  test("a missing Monitoring Viewer role is a permission failure", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        timeSeries: (): ReturnType<FakeRoute["respond"]> => {
          return json(
            { error: { code: 403, status: "PERMISSION_DENIED" } },
            403,
          );
        },
      }),
    );

    const result: LlmConnectionTestResult =
      await new GoogleVertexAIConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now: (): Date => {
          return NOW;
        },
      });

    expect(result.failureKind).toBe(LlmConnectionFailureKind.Permission);
  });
});
