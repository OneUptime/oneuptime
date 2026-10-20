import { describe, expect, test } from "@jest/globals";
import AwsBedrockConnector, {
  BEDROCK_NAMESPACE,
} from "../../../../Server/Utils/LlmObservability/Connectors/AwsBedrock/AwsBedrockConnector";
import CloudWatchClient from "../../../../Server/Utils/LlmObservability/Connectors/AwsBedrock/CloudWatchClient";
import {
  LlmConnectionSettings,
  LlmUsageFetchResult,
} from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "../../../../Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import { LlmUsageRecord } from "../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  FakeProviderApi,
  FakeRoute,
  bodyOf,
  createFakeProviderApi,
  json,
} from "./FakeProviderApi";

/*
 * The Amazon Bedrock connection against a fake CloudWatch: the AWS JSON 1.0
 * protocol (X-Amz-Target, the JSON content type), a SigV4 signature for the
 * "monitoring" service that verifies, ListMetrics keeping the ModelId-only
 * series, GetMetricData's daily Sum queries in batches of 500, the cached
 * tokens added to InputTokenCount, Regions, and the error codes CloudWatch
 * answers a bad key or a missing permission with.
 */

const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const NOW: Date = new Date("2026-10-19T12:00:00Z");

const SETTINGS: LlmConnectionSettings = {
  provider: LlmConnectionProvider.AwsBedrock,
  config: {
    accessKeyId: ACCESS_KEY_ID,
    regions: "us-east-1, eu-west-1 ,us-east-1",
  },
  secrets: { secretAccessKey: SECRET },
};

const WINDOW: { startDay: Date; endDay: Date } = {
  startDay: new Date("2026-10-18T00:00:00Z"),
  endDay: new Date("2026-10-20T00:00:00Z"),
};

const DAY_1: number = Date.UTC(2026, 9, 18) / 1000;
const DAY_2: number = Date.UTC(2026, 9, 19) / 1000;

function metricOf(
  name: string,
  dimensions: Array<[string, string]>,
): JSONObject {
  return {
    Namespace: BEDROCK_NAMESPACE,
    MetricName: name,
    Dimensions: dimensions.map(([Name, Value]: [string, string]) => {
      return { Name, Value };
    }),
  };
}

/*
 * One fake CloudWatch per Region: ListMetrics returns the models, and
 * GetMetricData answers every query from a table of values per metric name.
 */
function cloudWatchRoute(data: {
  models: Array<string>;
  values: Record<string, Array<[number, number]>>;
  failWith?: { status: number; body: JSONObject } | undefined;
}): FakeRoute["respond"] {
  return (request: DataSourceHttpRequest): ReturnType<FakeRoute["respond"]> => {
    if (data.failWith) {
      return json(data.failWith.body, data.failWith.status);
    }

    const target: string = request.headers?.["X-Amz-Target"] || "";
    const body: JSONObject = bodyOf(request);

    if (target.endsWith(".ListMetrics")) {
      return json({
        Metrics: [
          ...data.models.map((model: string) => {
            return metricOf(String(body["MetricName"]), [["ModelId", model]]);
          }),
          // The long-context subset: never read.
          metricOf(String(body["MetricName"]), [
            ["ModelId", data.models[0] || "x"],
            ["ContextWindow", "1M"],
          ]),
        ],
      });
    }

    const queries: JSONArray = (body["MetricDataQueries"] || []) as JSONArray;

    return json({
      MetricDataResults: queries.map((raw: unknown) => {
        const query: JSONObject = raw as JSONObject;
        const stat: JSONObject = query["MetricStat"] as JSONObject;
        const name: string = String(
          (stat["Metric"] as JSONObject)["MetricName"],
        );
        const points: Array<[number, number]> = data.values[name] || [];

        return {
          Id: query["Id"],
          Label: name,
          Timestamps: points.map(([time]: [number, number]) => {
            return time;
          }),
          Values: points.map(([, value]: [number, number]) => {
            return value;
          }),
          StatusCode: "Complete",
        };
      }),
    });
  };
}

function routes(
  regions: Record<string, FakeRoute["respond"]>,
): Array<FakeRoute> {
  return Object.keys(regions).map((region: string): FakeRoute => {
    return {
      host: `monitoring.${region}.amazonaws.com`,
      path: "/",
      method: "POST",
      respond: regions[region]!,
    };
  });
}

const STANDARD: Record<string, FakeRoute["respond"]> = {
  "us-east-1": cloudWatchRoute({
    models: ["anthropic.claude-sonnet-4-5-20250929-v1:0"],
    values: {
      InputTokenCount: [
        [DAY_1, 1000],
        [DAY_2, 2000],
      ],
      OutputTokenCount: [[DAY_1, 300]],
      CacheReadInputTokenCount: [[DAY_1, 5000]],
      CacheWriteInputTokenCount: [[DAY_1, 100]],
      Invocations: [[DAY_1, 12]],
    },
  }),
  "eu-west-1": cloudWatchRoute({
    models: ["amazon.nova-pro-v1:0"],
    values: { InputTokenCount: [[DAY_2, 400]], Invocations: [[DAY_2, 3]] },
  }),
};

describe("AwsBedrockConnector settings", () => {
  test("Regions are read once each, trimmed", () => {
    expect(
      AwsBedrockConnector.readRegions(" us-east-1,eu-west-1 , US-EAST-1,"),
    ).toEqual(["us-east-1", "eu-west-1"]);
  });

  test.each([
    [{ ...SETTINGS.config, regions: "" }, "at least one AWS Region"],
    [{ ...SETTINGS.config, regions: "mars-north-1;drop" }, "Region"],
    [
      {
        ...SETTINGS.config,
        regions: Array(11)
          .fill("us-east-1")
          .map((r: string, i: number) => {
            return `${r.slice(0, -1)}${i + 1}`;
          })
          .join(","),
      },
      "at most 10",
    ],
    [{ ...SETTINGS.config, accessKeyId: "short" }, "Access key ID"],
  ])(
    "bad settings are refused (case %#)",
    (config: JSONObject, words: string) => {
      expect(() => {
        return new AwsBedrockConnector().validateSettings({
          ...SETTINGS,
          config,
        });
      }).toThrow(words);
    },
  );

  test("a missing secret is refused", () => {
    expect(() => {
      return new AwsBedrockConnector().validateSettings({
        ...SETTINGS,
        secrets: {},
      });
    }).toThrow(BadDataException);
  });
});

describe("CloudWatchClient", () => {
  test("calls are AWS JSON 1.0, signed with SigV4 for monitoring, and the signature verifies", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes(STANDARD));
    const client: CloudWatchClient = new CloudWatchClient({
      region: "us-east-1",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      transport: api.transport,
      now: (): Date => {
        return NOW;
      },
    });

    await client.listMetricDimensionValues({
      namespace: BEDROCK_NAMESPACE,
      metricName: "InputTokenCount",
      dimensionName: "ModelId",
    });

    const request: DataSourceHttpRequest = api.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://monitoring.us-east-1.amazonaws.com/");
    expect(request.headers?.["X-Amz-Target"]).toBe(
      "GraniteServiceVersion20100801.ListMetrics",
    );
    expect(request.headers?.["Content-Type"]).toBe(
      "application/x-amz-json-1.0",
    );
    expect(request.headers?.["Authorization"]).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20261019\/us-east-1\/monitoring\/aws4_request, SignedHeaders=accept;content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/,
    );

    // The same request signed independently gives the same signature.
    const expected: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
      method: "POST",
      host: "monitoring.us-east-1.amazonaws.com",
      path: "/",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "X-Amz-Target": "GraniteServiceVersion20100801.ListMetrics",
        Accept: "application/json",
      },
      body: String(request.body),
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      region: "us-east-1",
      service: "monitoring",
      date: NOW,
    });
    expect(request.headers?.["Authorization"]).toBe(
      expected.headers["Authorization"],
    );

    expect(bodyOf(request)).toEqual({
      Namespace: "AWS/Bedrock",
      MetricName: "InputTokenCount",
      Dimensions: [{ Name: "ModelId" }],
    });
    expect(JSON.stringify(request)).not.toContain(SECRET);
  });

  test("only the ModelId-only series are kept", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes(STANDARD));
    const client: CloudWatchClient = new CloudWatchClient({
      region: "us-east-1",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      transport: api.transport,
    });

    expect(
      await client.listMetricDimensionValues({
        namespace: BEDROCK_NAMESPACE,
        metricName: "InputTokenCount",
        dimensionName: "ModelId",
      }),
    ).toEqual(["anthropic.claude-sonnet-4-5-20250929-v1:0"]);
  });

  test("GetMetricData asks for daily sums over the window, 500 queries at most a call", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes(STANDARD));
    const client: CloudWatchClient = new CloudWatchClient({
      region: "us-east-1",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      transport: api.transport,
    });
    const models: Array<string> = Array.from(
      { length: 101 },
      (_value: unknown, index: number) => {
        return `model-${index}`;
      },
    );

    await client.getDailySums({
      namespace: BEDROCK_NAMESPACE,
      queries: AwsBedrockConnector.buildQueries(models),
      startTime: WINDOW.startDay,
      endTime: WINDOW.endDay,
    });

    expect(api.requests).toHaveLength(2);
    const first: JSONObject = bodyOf(api.requests[0]!);
    expect((first["MetricDataQueries"] as JSONArray).length).toBe(500);
    expect(
      (bodyOf(api.requests[1]!)["MetricDataQueries"] as JSONArray).length,
    ).toBe(5);
    expect(first["StartTime"]).toBe(DAY_1);
    expect(first["EndTime"]).toBe(Date.UTC(2026, 9, 20) / 1000);
    expect(
      ((first["MetricDataQueries"] as JSONArray)[0] as JSONObject)[
        "MetricStat"
      ],
    ).toEqual({
      Metric: {
        Namespace: "AWS/Bedrock",
        MetricName: "InputTokenCount",
        Dimensions: [{ Name: "ModelId", Value: "model-0" }],
      },
      Period: 86400,
      Stat: "Sum",
    });
  });

  test.each([
    [
      "UnrecognizedClientException",
      400,
      LlmConnectionFailureKind.Authentication,
    ],
    ["InvalidSignatureException", 400, LlmConnectionFailureKind.Authentication],
    ["AccessDeniedException", 400, LlmConnectionFailureKind.Permission],
    ["Throttling", 400, LlmConnectionFailureKind.RateLimited],
    ["InternalServiceError", 500, LlmConnectionFailureKind.Unavailable],
  ])(
    "%s (HTTP %i) is a %s failure",
    async (code: string, status: number, kind: LlmConnectionFailureKind) => {
      const api: FakeProviderApi = createFakeProviderApi(
        routes({
          "us-east-1": cloudWatchRoute({
            models: [],
            values: {},
            failWith: {
              status,
              body: {
                __type: `com.amazonaws.monitoring#${code}`,
                message: `no ${SECRET}`,
              },
            },
          }),
        }),
      );
      const client: CloudWatchClient = new CloudWatchClient({
        region: "us-east-1",
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET,
        transport: api.transport,
      });

      const error: unknown = await client
        .listMetricDimensionValues({
          namespace: BEDROCK_NAMESPACE,
          metricName: "InputTokenCount",
          dimensionName: "ModelId",
        })
        .catch((caught: unknown) => {
          return caught;
        });

      expect(error).toBeInstanceOf(LlmProviderError);
      expect((error as LlmProviderError).kind).toBe(kind);
      expect((error as LlmProviderError).message).not.toContain(SECRET);
    },
  );

  test("the error code is read from __type", () => {
    expect(
      CloudWatchClient.errorCodeOf(
        '{"__type":"com.amazon.coral.service#AccessDeniedException"}',
      ),
    ).toBe("AccessDeniedException");
    expect(CloudWatchClient.errorCodeOf('{"__type":"Throttling"}')).toBe(
      "Throttling",
    );
    expect(CloudWatchClient.errorCodeOf("not json")).toBe("");
  });
});

describe("AwsBedrockConnector reads", () => {
  test("one record per day, Region and model, cached tokens added to the input", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes(STANDARD));

    const result: LlmUsageFetchResult =
      await new AwsBedrockConnector().fetchUsage(SETTINGS, WINDOW, {
        transport: api.transport,
      });

    const claudeDay1: LlmUsageRecord | undefined = result.records.find(
      (record: LlmUsageRecord) => {
        return (
          record.project === "us-east-1" &&
          record.day.getTime() === DAY_1 * 1000
        );
      },
    );

    expect(claudeDay1).toMatchObject({
      model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      inputTokens: 6100,
      outputTokens: 300,
      cacheReadTokens: 5000,
      cacheWriteTokens: 100,
      requests: 12,
      person: "",
      apiKey: "",
      costUsd: null,
    });

    expect(
      result.records.find((record: LlmUsageRecord) => {
        return record.project === "eu-west-1";
      }),
    ).toMatchObject({
      model: "amazon.nova-pro-v1:0",
      inputTokens: 400,
      requests: 3,
    });

    // Two Regions, each read once though one was named twice.
    expect(
      new Set(
        api.requests.map((request: DataSourceHttpRequest) => {
          return new URL(request.url).host;
        }),
      ),
    ).toEqual(
      new Set([
        "monitoring.us-east-1.amazonaws.com",
        "monitoring.eu-west-1.amazonaws.com",
      ]),
    );
  });

  test("a Region with no Bedrock models makes one request and no records", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        "us-east-1": cloudWatchRoute({ models: [], values: {} }),
        "eu-west-1": cloudWatchRoute({ models: [], values: {} }),
      }),
    );

    const result: LlmUsageFetchResult =
      await new AwsBedrockConnector().fetchUsage(SETTINGS, WINDOW, {
        transport: api.transport,
      });

    expect(result.records).toEqual([]);
    expect(api.requests).toHaveLength(2);
  });

  test("the test reports usage found, and a refused key without the secret", async () => {
    const working: LlmConnectionTestResult =
      await new AwsBedrockConnector().testConnection(SETTINGS, {
        transport: createFakeProviderApi(routes(STANDARD)).transport,
        now: (): Date => {
          return NOW;
        },
      });

    expect(working.status).toBe("pass");
    expect(working.counts?.requests).toBe(15);

    const refused: LlmConnectionTestResult =
      await new AwsBedrockConnector().testConnection(SETTINGS, {
        transport: createFakeProviderApi(
          routes({
            "us-east-1": cloudWatchRoute({
              models: [],
              values: {},
              failWith: {
                status: 400,
                body: {
                  __type: "InvalidClientTokenId",
                  message:
                    "The security token included in the request is invalid.",
                },
              },
            }),
          }),
        ).transport,
      });

    expect(refused.status).toBe("fail");
    expect(refused.failureKind).toBe(LlmConnectionFailureKind.Authentication);
    expect(JSON.stringify(refused)).not.toContain(SECRET);
  });
});
