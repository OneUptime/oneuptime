import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import { storedAttributesOf } from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudDiscoveredResource,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import GcpCloudConnector from "../../../../Server/Utils/CloudConnection/Gcp/GcpCloudConnector";
import GcpMonitoring from "../../../../Server/Utils/CloudConnection/Gcp/GcpMonitoring";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { getGcpKeyMetricTypes } from "../../../../Types/Cloud/CloudKeyMetrics";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
} from "../../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * Google Cloud against fake Google OAuth and Cloud Monitoring: the service
 * account's assertion for the monitoring.read scope, one timeSeries.list
 * per key metric per project aligned to a minute since the last read, the
 * resource each series is about found with the ingest's own resolver (a VM
 * named by its metadata), the export the googlecloudmonitoring receiver
 * sends, a metric type the project never had, and a project whose Cloud
 * Monitoring API is off.
 */

const PROJECT_ID: string = "acme-prod";
const OTHER_PROJECT: string = "acme-staging";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const CLIENT_EMAIL: string = "oneuptime-read-only@acme-prod.iam.gserviceaccount.com";
const KEY: string = JSON.stringify({
  type: "service_account",
  project_id: PROJECT_ID,
  client_email: CLIENT_EMAIL,
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});
// 12:07: Cloud Monitoring's minute window ends four minutes back: 12:03.
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const WINDOW_END: string = "2026-10-21T12:03:00.000Z";

const connector: GcpCloudConnector = new GcpCloudConnector();

function settings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey,
      ...config,
    },
    secrets: { serviceAccountJson: KEY },
  };
}

const CPU: string = "compute.googleapis.com/instance/cpu/utilization";
const SQL_CPU: string = "cloudsql.googleapis.com/database/cpu/utilization";
const RECEIVED: string = "compute.googleapis.com/instance/network/received_bytes_count";

function vmSeries(metricType: string, instanceId: string, name: string, labels: JSONObject = {}): JSONObject {
  return {
    metric: { type: metricType, labels },
    resource: {
      type: "gce_instance",
      labels: { project_id: PROJECT_ID, zone: "us-central1-a", instance_id: instanceId },
    },
    metadata: { systemLabels: { name } },
    metricKind: "GAUGE",
    valueType: "DOUBLE",
    points: [
      {
        interval: { startTime: "2026-10-21T11:59:00Z", endTime: "2026-10-21T12:00:00Z" },
        value: { doubleValue: 0.42 },
      },
      {
        interval: { startTime: "2026-10-21T11:58:00Z", endTime: "2026-10-21T11:59:00Z" },
        value: { doubleValue: 0.41 },
      },
    ],
  };
}

function sqlSeries(): JSONObject {
  return {
    metric: { type: SQL_CPU, labels: {} },
    resource: {
      type: "cloudsql_database",
      labels: { project_id: PROJECT_ID, database_id: `${PROJECT_ID}:orders`, region: "us-central1" },
    },
    points: [
      {
        interval: { endTime: "2026-10-21T12:00:00Z" },
        value: { doubleValue: 0.3 },
      },
    ],
  };
}

interface FakeGcp extends FakeProviderApi {
  seriesCalls: Array<URL>;
}

function createFakeGcp(options: {
  series?: Record<string, Array<JSONObject>>;
  errors?: Record<string, FakeResponse>;
  tokenError?: FakeResponse;
  pages?: number;
} = {}): FakeGcp {
  const seriesCalls: Array<URL> = [];

  const routes: Array<FakeRoute> = [
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (): FakeResponse => {
        return options.tokenError || json({ access_token: "ya29.token", expires_in: 3599 });
      },
    },
    {
      host: "monitoring.googleapis.com",
      path: /^\/v3\/projects\/[^/]+\/timeSeries$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        seriesCalls.push(url);
        const filter: string = url.searchParams.get("filter") || "";
        const metricType: string = filter.slice('metric.type="'.length, -1);
        const project: string = url.pathname.split("/")[3]!;

        if (options.errors?.[metricType]) {
          return options.errors[metricType]!;
        }

        const all: Array<JSONObject> = (options.series?.[metricType] || []).filter(
          (series: JSONObject): boolean => {
            const labels: JSONObject = (series["resource"] as JSONObject)["labels"] as JSONObject;
            return labels["project_id"] === project;
          },
        );
        const page: number = Number(url.searchParams.get("pageToken") || 0);
        const pages: number = options.pages || 1;
        const per: number = Math.ceil(all.length / pages) || 1;

        return json({
          timeSeries: all.slice(page * per, (page + 1) * per),
          ...(page + 1 < pages && (page + 1) * per < all.length
            ? { nextPageToken: String(page + 1) }
            : {}),
        });
      },
    },
  ];

  return { ...createFakeProviderApi(routes), seriesCalls };
}

function readOptions(
  fake: FakeProviderApi,
  state: CloudConnectionPullState = {},
  extra: Partial<Parameters<GcpCloudConnector["read"]>[1]> = {},
): Parameters<GcpCloudConnector["read"]>[1] {
  return {
    transport: fake.transport,
    now: () => {
      return NOW;
    },
    state,
    serviceName: "Google Cloud",
    connectionId: "33333333-3333-4333-8333-333333333333",
    maxRequests: 3000,
    maxDurationMs: 60000,
    ...extra,
  };
}

describe("validateSettings", () => {
  test("a service account key is enough: the project is the key's own", () => {
    expect(() => {
      connector.validateSettings(settings());
    }).not.toThrow();
    expect(connector.getProjects(settings())).toEqual([PROJECT_ID]);
    expect(connector.getProjects(settings({ projectIds: `${PROJECT_ID}, ${OTHER_PROJECT}` }))).toEqual([
      PROJECT_ID,
      OTHER_PROJECT,
    ]);
  });

  test("a key that is not one, a project id that is not one, too many projects are form errors", () => {
    expect(() => {
      connector.validateSettings({ ...settings(), secrets: {} });
    }).toThrow("Service account key (JSON) is required.");
    expect(() => {
      connector.validateSettings({ ...settings(), secrets: { serviceAccountJson: "{}" } });
    }).toThrow(BadDataException);
    expect(() => {
      connector.validateSettings(settings({ projectIds: "Not_A_Project" }));
    }).toThrow("Project ID must be a Google Cloud project id");

    const many: Array<string> = [];
    for (let index: number = 0; index < 21; index++) {
      many.push(`project-${String(index).padStart(3, "0")}`);
    }
    expect(() => {
      connector.validateSettings(settings({ projectIds: many.join(",") }));
    }).toThrow("at most 20 projects");
  });

  test("a key that names no project needs one named", () => {
    const keyWithoutProject: string = JSON.stringify({
      ...JSON.parse(KEY),
      project_id: undefined,
    });

    expect(() => {
      connector.validateSettings({
        ...settings(),
        secrets: { serviceAccountJson: keyWithoutProject },
      });
    }).toThrow("The key names no project");
  });

  test("the key's own email and project are read off it", () => {
    expect(GcpCloudConnector.readKey(KEY)).toEqual({
      projectId: PROJECT_ID,
      clientEmail: CLIENT_EMAIL,
    });
  });
});

describe("testConnection", () => {
  test("signs in as the service account and counts the resources reporting", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: {
        [CPU]: [vmSeries(CPU, "1001", "web-1"), vmSeries(CPU, "1002", "web-2")],
        [SQL_CPU]: [sqlSeries()],
      },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      { transport: fake.transport, now: () => NOW },
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "pass",
        accounts: [PROJECT_ID],
        resourceCount: 3,
        resourceTypes: [
          { type: "gce_instance", count: 2 },
          { type: "cloudsql_database", count: 1 },
        ],
        regions: [{ region: "us-central1", count: 3 }],
      }),
    );

    // The assertion is the key's, for the monitoring.read scope.
    const token: DataSourceHttpRequest = fake.requests[0]!;
    const claims: JSONObject = jwt.decode(
      (token.body as Record<string, string>)["assertion"]!,
    ) as JSONObject;

    expect(claims["iss"]).toBe(CLIENT_EMAIL);
    expect(claims["scope"]).toBe(
      "https://www.googleapis.com/auth/monitoring.read",
    );
  });

  test("nothing reporting is a warning", async () => {
    const fake: FakeGcp = createFakeGcp({});

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      { transport: fake.transport, now: () => NOW },
    );

    expect(result.status).toBe("warn");
  });

  test("a revoked key fails as authentication", async () => {
    const fake: FakeGcp = createFakeGcp({
      tokenError: { status: 400, body: '{"error":"invalid_grant"}' },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      { transport: fake.transport, now: () => NOW },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Authentication);
  });

  test("a project whose Cloud Monitoring API is off says to turn it on", async () => {
    const off: FakeResponse = {
      status: 403,
      body: '{"error":{"code":403,"message":"Cloud Monitoring API has not been used in project 123 before or it is disabled."}}',
    };
    const errors: Record<string, FakeResponse> = {};
    for (const metric of getGcpKeyMetricTypes()) {
      errors[metric.metricType] = off;
    }
    const fake: FakeGcp = createFakeGcp({ errors });

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      { transport: fake.transport, now: () => NOW },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Settings);
    expect(result.message).toContain("gcloud services enable monitoring.googleapis.com");
  });
});

describe("read", () => {
  test("asks each project for each key metric since the last read, aligned to a minute", async () => {
    const fake: FakeGcp = createFakeGcp({ series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] } });

    const result: CloudReadResult = await connector.read(settings(), readOptions(fake));

    expect(fake.seriesCalls).toHaveLength(getGcpKeyMetricTypes().length);

    const cpuCall: URL = fake.seriesCalls.find((url: URL): boolean => {
      return (url.searchParams.get("filter") || "").includes(CPU);
    })!;

    expect(cpuCall.searchParams.get("filter")).toBe(`metric.type="${CPU}"`);
    expect(cpuCall.searchParams.get("aggregation.alignmentPeriod")).toBe("60s");
    expect(cpuCall.searchParams.get("aggregation.perSeriesAligner")).toBe("ALIGN_MEAN");
    expect(cpuCall.searchParams.get("aggregation.crossSeriesReducer")).toBeNull();
    expect(cpuCall.searchParams.get("interval.endTime")).toBe(WINDOW_END);
    expect(cpuCall.searchParams.get("interval.startTime")).toBe(
      new Date(Date.parse(WINDOW_END) - 3600000).toISOString(),
    );
    expect(result.nextState.cursors).toEqual({ "60": WINDOW_END });
    expect(result.accounts).toEqual([PROJECT_ID]);
  });

  test("each series becomes the receiver's export, filed under the resource the read found", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: {
        [CPU]: [vmSeries(CPU, "1001", "web-1")],
        [RECEIVED]: [vmSeries(RECEIVED, "1001", "web-1", { loadbalanced: "false" })],
        [SQL_CPU]: [sqlSeries()],
      },
    });

    const result: CloudReadResult = await connector.read(settings(), readOptions(fake));

    expect(
      result.resources
        .map((entry: CloudDiscoveredResource): string => {
          return `${entry.resource.resourceType} ${entry.resource.name} ${entry.displayName || ""}`.trim();
        })
        .sort(),
    ).toEqual(["cloudsql_database orders", "gce_instance web-1 web-1"]);

    const identities: Set<string> = new Set(
      result.resources.map((entry: CloudDiscoveredResource): string => {
        return entry.resource.identityKey;
      }),
    );
    let points: number = 0;

    for (const payload of result.payloads) {
      for (const rm of payload["resourceMetrics"] as JSONArray) {
        const resourceAttributes: JSONArray = (
          (rm as JSONObject)["resource"] as JSONObject
        )["attributes"] as JSONArray;

        for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
          for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
            for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
              "dataPoints"
            ] as JSONArray) {
              const stored: JSONObject = storedAttributesOf(
                resourceAttributes as never,
                (point as JSONObject)["attributes"] as never,
              ) as JSONObject;
              const resolved: CloudMonitoredResource | null =
                resolveCloudMonitoredResource({
                  metricName: (metric as JSONObject)["name"],
                  attributes: stored,
                });

              expect(resolved && identities.has(resolved.identityKey)).toBe(true);
              expect(stored["resource.gcp.resource_type"]).toBeDefined();
              expect(stored["resource.service.name"]).toBe("Google Cloud");
              points++;
            }
          }
        }
      }
    }

    // CPU and received bytes: two points each; SQL: one.
    expect(points).toBe(5);
    expect(result.pointsWritten).toBe(5);
  });

  test("the metric's labels are on its datapoints, the resource's on the resource", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [RECEIVED]: [vmSeries(RECEIVED, "1001", "web-1", { loadbalanced: "false" })] },
    });

    const result: CloudReadResult = await connector.read(settings(), readOptions(fake));
    const rm: JSONObject = (result.payloads[0]!["resourceMetrics"] as JSONArray)[0] as JSONObject;
    const metric: JSONObject = (
      ((rm["scopeMetrics"] as JSONArray)[0] as JSONObject)["metrics"] as JSONArray
    )[0] as JSONObject;

    expect(metric["name"]).toBe(RECEIVED);
    expect(metric["unit"]).toBe("By/s");
    expect(
      ((((metric["gauge"] as JSONObject)["dataPoints"] as JSONArray)[0] as JSONObject)[
        "attributes"
      ] as JSONArray),
    ).toEqual([{ key: "loadbalanced", value: { stringValue: "false" } }]);
    expect(
      ((rm["resource"] as JSONObject)["attributes"] as Array<JSONObject>).map(
        (attribute: JSONObject) => {
          return attribute["key"];
        },
      ),
    ).toEqual([
      "service.name",
      "cloud.provider",
      "oneuptime.cloud.connection.id",
      "gcp.resource_type",
      "instance_id",
      "project_id",
      "zone",
      "name",
    ]);
  });

  test("reads every named project", async () => {
    const fake: FakeGcp = createFakeGcp({});

    await connector.read(
      settings({ projectIds: `${PROJECT_ID}, ${OTHER_PROJECT}` }),
      readOptions(fake),
    );

    expect(
      new Set(
        fake.seriesCalls.map((url: URL): string => {
          return url.pathname.split("/")[3]!;
        }),
      ),
    ).toEqual(new Set([PROJECT_ID, OTHER_PROJECT]));
  });

  test("a metric type the project never had is nothing to read, not a failure", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
      errors: { [SQL_CPU]: { status: 404, body: '{"error":{"code":404}}' } },
    });

    const result: CloudReadResult = await connector.read(settings(), readOptions(fake));

    expect(result.warnings).toEqual([]);
    expect(result.pointsWritten).toBe(2);
  });

  test("a metric that fails otherwise is said; the rest are written", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
      errors: { [SQL_CPU]: { status: 500, body: "backend error" } },
    });

    const result: CloudReadResult = await connector.read(settings(), readOptions(fake));

    expect(result.warnings.join(" ")).toContain("Could not read 1 metrics");
    expect(result.pointsWritten).toBe(2);
    expect(result.nextState.cursors?.["60"]).toBe(WINDOW_END);
  });

  test("the Cloud Monitoring API being off fails the read with what to do", async () => {
    const fake: FakeGcp = createFakeGcp({
      errors: {
        [CPU]: {
          status: 403,
          body: '{"error":{"message":"Cloud Monitoring API has not been used in project 123 before or it is disabled."}}',
        },
      },
    });

    const error: unknown = await connector
      .read(settings(), readOptions(fake))
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(CloudConnectionFailureKind.Settings);
  });

  test("a read out of budget writes nothing and keeps the cursor", async () => {
    const fake: FakeGcp = createFakeGcp({ series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] } });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {}, { maxRequests: 2 }),
    );

    expect(result.complete).toBe(false);
    expect(result.payloads).toEqual([]);
    expect(result.nextState.cursors?.["60"]).toBeUndefined();
  });

  test("nothing new yet: no call is made", async () => {
    const fake: FakeGcp = createFakeGcp({});

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, { cursors: { "60": WINDOW_END } }),
    );

    expect(fake.seriesCalls).toHaveLength(0);
    expect(result.payloads).toEqual([]);
  });

  test("pages are followed", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1", "a"), vmSeries(CPU, "2", "b"), vmSeries(CPU, "3", "c")] },
      pages: 3,
    });

    const result: CloudReadResult = await connector.read(settings(), readOptions(fake));

    expect(
      result.resources.filter((entry: CloudDiscoveredResource): boolean => {
        return entry.resource.resourceType === "gce_instance";
      }),
    ).toHaveLength(3);
  });
});

describe("reading Cloud Monitoring's answer", () => {
  test("int64 and double values, the end of each interval, oldest first", () => {
    expect(
      GcpMonitoring.readSeries(
        {
          timeSeries: [
            {
              metric: { type: CPU, labels: { a: "1", b: 2 } },
              resource: { type: "gce_instance", labels: { zone: "z" } },
              points: [
                { interval: { endTime: "2026-10-21T12:01:00Z" }, value: { int64Value: "7" } },
                { interval: { endTime: "2026-10-21T12:00:00Z" }, value: { doubleValue: 1.5 } },
                { interval: { endTime: "nope" }, value: { doubleValue: 1 } },
              ],
            },
            // A series with no type, or no point, is left out.
            { metric: { type: CPU }, resource: {}, points: [] },
          ],
        },
        CPU,
      ),
    ).toEqual([
      {
        metricType: CPU,
        metricLabels: { a: "1", b: "2" },
        resourceType: "gce_instance",
        resourceLabels: { zone: "z" },
        metadataName: "",
        points: [
          { timeMs: Date.parse("2026-10-21T12:00:00Z"), value: 1.5 },
          { timeMs: Date.parse("2026-10-21T12:01:00Z"), value: 7 },
        ],
      },
    ]);
  });
});
