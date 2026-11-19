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
import GcpCloudConnector, {
  GcpAddedMetricAsk,
  GcpResourceBatch,
  capGcpSplitSeries,
  getGcpSplitRead,
  getGcpAddedMetricsToAsk,
  GCP_OPS_AGENT_ASK_EVERY_MS,
  GCP_OPS_AGENT_SEEN_MS,
  GCP_RESOURCE_TYPE_SEEN_MS,
  getGcpMetricTypesToAsk,
  getGcpOpsAgentAsk,
  getGcpSeenResourceTypes,
  hasGcpOpsAgentResources,
  isGcpSeriesOfResources,
  planGcpResourceBatches,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpCloudConnector";
import GcpMonitoring, {
  GCP_MAX_FILTER_URL_LENGTH,
  GCP_MAX_ONE_OF_VALUES,
  GcpTimeSeries,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpMonitoring";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetric,
} from "../../../../Utils/Metrics/RetiredCloudMetricMoves";
import { getRetiredCloudMetricReads } from "../../../../Utils/Metrics/RetiredCloudMetricReads";
import {
  GCP_KEY_METRICS,
  GCP_OPS_AGENT,
  GcpKeyMetric,
  GcpReadMetric,
  GcpTypeKeyMetrics,
  getGcpKeyMetricTypes,
  getGcpStoredMetricName,
} from "../../../../Types/Cloud/CloudKeyMetrics";
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
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
  getCloudAddedMetricSplitAttribute,
} from "../../../../Types/Cloud/CloudAddedMetrics";
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
const CLIENT_EMAIL: string =
  "oneuptime-read-only@acme-prod.iam.gserviceaccount.com";
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
const RECEIVED: string =
  "compute.googleapis.com/instance/network/received_bytes_count";

function vmSeries(
  metricType: string,
  instanceId: string,
  name: string,
  labels: JSONObject = {},
): JSONObject {
  return {
    metric: { type: metricType, labels },
    resource: {
      type: "gce_instance",
      labels: {
        project_id: PROJECT_ID,
        zone: "us-central1-a",
        instance_id: instanceId,
      },
    },
    metadata: { systemLabels: { name } },
    metricKind: "GAUGE",
    valueType: "DOUBLE",
    points: [
      {
        interval: {
          startTime: "2026-10-21T11:59:00Z",
          endTime: "2026-10-21T12:00:00Z",
        },
        value: { doubleValue: 0.42 },
      },
      {
        interval: {
          startTime: "2026-10-21T11:58:00Z",
          endTime: "2026-10-21T11:59:00Z",
        },
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
      labels: {
        project_id: PROJECT_ID,
        database_id: `${PROJECT_ID}:orders`,
        region: "us-central1",
      },
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

const METRIC_TYPE_IN_FILTER: RegExp = /metric\.type="([^"]+)"/;
const METRIC_LABEL_IN_FILTER: RegExp = /metric\.labels\.([a-z_]+)="([^"]*)"/g;
const RESOURCE_TYPE_IN_FILTER: RegExp = /resource\.type="([^"]+)"/;
const RESOURCE_LABEL_IN_FILTER: RegExp =
  /resource\.labels\.([a-z_]+)="([^"]*)"/g;
// resource.labels.<name>=one_of("a","b"): any of the values (#9810).
const RESOURCE_LABEL_ONE_OF_IN_FILTER: RegExp =
  /resource\.labels\.([a-z_]+)=one_of\(((?:"[^"]*",?)+)\)/g;

// The resource labels a call's filter names, each with the values it may have.
function resourceLabelsOf(filter: string): Array<[string, Array<string>]> {
  const labels: Array<[string, Array<string>]> = Array.from(
    filter.matchAll(RESOURCE_LABEL_IN_FILTER),
  ).map((match: RegExpMatchArray): [string, Array<string>] => {
    return [match[1]!, [match[2]!]];
  });

  for (const match of filter.matchAll(RESOURCE_LABEL_ONE_OF_IN_FILTER)) {
    labels.push([
      match[1]!,
      Array.from(match[2]!.matchAll(/"([^"]*)"/g)).map(
        (value: RegExpMatchArray): string => {
          return value[1]!;
        },
      ),
    ]);
  }

  return labels;
}

// The metric type a call's filter names.
function metricTypeOf(filter: string): string {
  return METRIC_TYPE_IN_FILTER.exec(filter)?.[1] || "";
}

// The metric labels a call's filter names: metric.labels.<name>="<value>".
function metricLabelsOf(filter: string): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const match of filter.matchAll(METRIC_LABEL_IN_FILTER)) {
    labels[match[1]!] = match[2]!;
  }

  return labels;
}

function createFakeGcp(
  options: {
    series?: Record<string, Array<JSONObject>>;
    errors?: Record<string, FakeResponse>;
    tokenError?: FakeResponse;
    pages?: number;
    // A call's own answer, before any other: a refusal of one page, say.
    answer?: ((url: URL) => FakeResponse | undefined) | undefined;
  } = {},
): FakeGcp {
  const seriesCalls: Array<URL> = [];

  const routes: Array<FakeRoute> = [
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (): FakeResponse => {
        return (
          options.tokenError ||
          json({ access_token: "ya29.token", expires_in: 3599 })
        );
      },
    },
    {
      host: "monitoring.googleapis.com",
      path: /^\/v3\/projects\/[^/]+\/timeSeries$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        seriesCalls.push(url);
        const filter: string = url.searchParams.get("filter") || "";
        const metricType: string = metricTypeOf(filter);
        const wantedLabels: Record<string, string> = metricLabelsOf(filter);
        const wantedType: string =
          RESOURCE_TYPE_IN_FILTER.exec(filter)?.[1] || "";
        const wantedResourceLabels: Array<[string, Array<string>]> =
          resourceLabelsOf(filter);
        const project: string = url.pathname.split("/")[3]!;
        const own: FakeResponse | undefined = options.answer?.(url);

        if (own) {
          return own;
        }

        if (options.errors?.[metricType]) {
          return options.errors[metricType]!;
        }

        const all: Array<JSONObject> = (
          options.series?.[metricType] || []
        ).filter((series: JSONObject): boolean => {
          const labels: JSONObject = (series["resource"] as JSONObject)[
            "labels"
          ] as JSONObject;
          const metricLabels: JSONObject =
            ((series["metric"] as JSONObject)["labels"] as JSONObject) || {};

          // As Cloud Monitoring does: only the series the filter's labels name.
          return (
            labels["project_id"] === project &&
            Object.entries(wantedLabels).every(
              ([name, value]: [string, string]): boolean => {
                return metricLabels[name] === value;
              },
            ) &&
            (!wantedType ||
              (series["resource"] as JSONObject)["type"] === wantedType) &&
            wantedResourceLabels.every(
              ([name, values]: [string, Array<string>]): boolean => {
                return values.includes(String(labels[name]));
              },
            )
          );
        });
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

// Each resource type's first metric: what every read asks of every project.
function probeMetricTypes(): Array<string> {
  return GCP_KEY_METRICS.map((entry: GcpTypeKeyMetrics): string => {
    return entry.metrics[0]!.metricType;
  });
}

function metricTypesOf(resourceType: string): Array<string> {
  return (
    GCP_KEY_METRICS.find((entry: GcpTypeKeyMetrics): boolean => {
      return entry.resourceType === resourceType;
    })?.metrics || []
  ).map((metric: GcpKeyMetric): string => {
    return metric.metricType;
  });
}

// A VM's metrics Google Cloud reports itself: asked once a project has a VM.
function gceMetricTypes(): Array<string> {
  return (
    GCP_KEY_METRICS.find((entry: GcpTypeKeyMetrics): boolean => {
      return entry.resourceType === "gce_instance";
    })?.metrics || []
  )
    .filter((metric: GcpKeyMetric): boolean => {
      return metric.reportedBy !== GCP_OPS_AGENT;
    })
    .map((metric: GcpKeyMetric): string => {
      return metric.metricType;
    });
}

// Each resource type's first metric, by the name it is stored under.
function probeStoredNames(): Array<string> {
  return GCP_KEY_METRICS.map((entry: GcpTypeKeyMetrics): string => {
    return getGcpStoredMetricName(entry.metrics[0]!);
  });
}

// The metric type of each timeSeries.list call made, in order.
function calledMetricTypes(fake: FakeGcp): Array<string> {
  return fake.seriesCalls.map((url: URL): string => {
    return metricTypeOf(url.searchParams.get("filter") || "");
  });
}

const AGENT_MEMORY: string = "agent.googleapis.com/memory/percent_used";
const AGENT_DISK: string = "agent.googleapis.com/disk/percent_used";

// The Ops Agent's series of a VM: a state's share, or a disk's.
function agentSeries(
  metricType: string,
  instanceId: string,
  labels: JSONObject,
  value: number,
): JSONObject {
  return {
    ...vmSeries(metricType, instanceId, `vm-${instanceId}`, labels),
    points: [
      {
        interval: { endTime: "2026-10-21T12:00:00Z" },
        value: { doubleValue: value },
      },
    ],
  };
}

describe("validateSettings", () => {
  test("a service account key is enough: the project is the key's own", () => {
    expect(() => {
      connector.validateSettings(settings());
    }).not.toThrow();
    expect(connector.getProjects(settings())).toEqual([PROJECT_ID]);
    expect(
      connector.getProjects(
        settings({ projectIds: `${PROJECT_ID}, ${OTHER_PROJECT}` }),
      ),
    ).toEqual([PROJECT_ID, OTHER_PROJECT]);
  });

  test("a key that is not one, a project id that is not one, too many projects are form errors", () => {
    expect(() => {
      connector.validateSettings({ ...settings(), secrets: {} });
    }).toThrow("Service account key (JSON) is required.");
    expect(() => {
      connector.validateSettings({
        ...settings(),
        secrets: { serviceAccountJson: "{}" },
      });
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
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
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

  /*
   * A topic's first metric is the count of its message sizes, a
   * distribution (#9565): the test reads it as a read does, or it would
   * find no topic.
   */
  test("finds a Pub/Sub topic by the count of its message sizes, as a read reads it", async () => {
    const sizes: string = "pubsub.googleapis.com/topic/message_sizes";
    const fake: FakeGcp = createFakeGcp({
      series: {
        [sizes]: [
          {
            metric: { type: sizes, labels: {} },
            resource: {
              type: "pubsub_topic",
              labels: { project_id: PROJECT_ID, topic_id: "orders" },
            },
            points: [
              {
                interval: { endTime: "2026-10-21T12:00:00Z" },
                value: { distributionValue: { count: "12", mean: 300 } },
              },
            ],
          },
        ],
      },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result.resourceTypes).toEqual([{ type: "pubsub_topic", count: 1 }]);

    const call: URL = fake.seriesCalls.find((url: URL): boolean => {
      return metricTypeOf(url.searchParams.get("filter") || "") === sizes;
    })!;

    expect(call.searchParams.get("aggregation.perSeriesAligner")).toBe(
      "ALIGN_SUM",
    );
  });

  test("nothing reporting is a warning", async () => {
    const fake: FakeGcp = createFakeGcp({});

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result.status).toBe("warn");
  });

  test("a revoked key fails as authentication", async () => {
    const fake: FakeGcp = createFakeGcp({
      tokenError: { status: 400, body: '{"error":"invalid_grant"}' },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
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
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Settings);
    expect(result.message).toContain(
      "gcloud services enable monitoring.googleapis.com",
    );
  });
});

describe("read", () => {
  test("asks each project for each key metric since the last read, aligned to a minute", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    /*
     * Each resource type's first metric, then - the project reported a VM -
     * a VM's other metrics, and whether it runs the Ops Agent, in the same
     * read: no other type's.
     */
    expect(fake.seriesCalls).toHaveLength(
      GCP_KEY_METRICS.length + gceMetricTypes().length,
    );
    expect(calledMetricTypes(fake).sort()).toEqual(
      [
        ...probeMetricTypes(),
        ...gceMetricTypes().slice(1),
        AGENT_MEMORY,
      ].sort(),
    );

    const cpuCall: URL = fake.seriesCalls.find((url: URL): boolean => {
      return (url.searchParams.get("filter") || "").includes(CPU);
    })!;

    expect(cpuCall.searchParams.get("filter")).toBe(`metric.type="${CPU}"`);
    expect(cpuCall.searchParams.get("aggregation.alignmentPeriod")).toBe("60s");
    expect(cpuCall.searchParams.get("aggregation.perSeriesAligner")).toBe(
      "ALIGN_MEAN",
    );
    expect(
      cpuCall.searchParams.get("aggregation.crossSeriesReducer"),
    ).toBeNull();
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
        [RECEIVED]: [
          vmSeries(RECEIVED, "1001", "web-1", { loadbalanced: "false" }),
        ],
        [SQL_CPU]: [sqlSeries()],
      },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

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

              expect(resolved && identities.has(resolved.identityKey)).toBe(
                true,
              );
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
      series: {
        [RECEIVED]: [
          vmSeries(RECEIVED, "1001", "web-1", { loadbalanced: "false" }),
        ],
      },
    });

    // A project that reported a VM lately is asked a VM's every metric.
    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {
        gcpResourceTypesSeen: {
          [PROJECT_ID]: {
            gce_instance: new Date(NOW.getTime() - 3600000).toISOString(),
          },
        },
      }),
    );
    const rm: JSONObject = (
      result.payloads[0]!["resourceMetrics"] as JSONArray
    )[0] as JSONObject;
    const metric: JSONObject = (
      ((rm["scopeMetrics"] as JSONArray)[0] as JSONObject)[
        "metrics"
      ] as JSONArray
    )[0] as JSONObject;

    expect(metric["name"]).toBe(RECEIVED);
    expect(metric["unit"]).toBe("By/s");
    expect(
      (
        (
          (metric["gauge"] as JSONObject)["dataPoints"] as JSONArray
        )[0] as JSONObject
      )["attributes"] as JSONArray,
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

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(result.warnings).toEqual([]);
    expect(result.pointsWritten).toBe(2);
  });

  test("a metric that fails otherwise is said; the rest are written", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
      errors: { [SQL_CPU]: { status: 500, body: "backend error" } },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

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
    expect((error as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Settings,
    );
  });

  test("a read out of budget writes nothing and keeps the cursor", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
    });

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
      series: {
        [CPU]: [
          vmSeries(CPU, "1", "a"),
          vmSeries(CPU, "2", "b"),
          vmSeries(CPU, "3", "c"),
        ],
      },
      pages: 3,
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

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
                {
                  interval: { endTime: "2026-10-21T12:01:00Z" },
                  value: { int64Value: "7" },
                },
                {
                  interval: { endTime: "2026-10-21T12:00:00Z" },
                  value: { doubleValue: 1.5 },
                },
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

/*
 * One call per metric type answers it for every resource of a project, so
 * a read asks each resource type's first metric of every project - how a
 * new resource is found - and a type's others only of the projects that
 * have such a resource (getGcpMetricTypesToAsk).
 */
describe("which metrics a read asks a project for", () => {
  test("every type's first metric, and every metric of the types it has", () => {
    const asked: Array<string> = getGcpMetricTypesToAsk({
      seenResourceTypes: new Set<string>(["cloudsql_database"]),
    }).map((metric: GcpKeyMetric): string => {
      return metric.metricType;
    });

    expect(asked.sort()).toEqual(
      Array.from(
        new Set<string>([
          ...probeMetricTypes(),
          ...metricTypesOf("cloudsql_database"),
        ]),
      ).sort(),
    );
  });

  test("a project with nothing yet is asked the first metrics alone", () => {
    expect(
      getGcpMetricTypesToAsk({ seenResourceTypes: new Set<string>() }).map(
        (metric: GcpKeyMetric): string => {
          return metric.metricType;
        },
      ),
    ).toEqual(probeMetricTypes());
  });

  test("a second pass asks the rest of the types found, nothing asked already", () => {
    const first: Set<string> = new Set<string>(probeStoredNames());
    const second: Array<string> = getGcpMetricTypesToAsk({
      seenResourceTypes: new Set<string>(["gce_instance"]),
      asked: first,
    }).map((metric: GcpKeyMetric): string => {
      return metric.metricType;
    });

    expect(second).toEqual(gceMetricTypes().slice(1));
  });

  test("a metric two resource types report is asked once, when either is there", () => {
    const shared: string = "run.googleapis.com/container/cpu/utilizations";

    for (const seen of [
      ["cloud_run_revision"],
      ["cloud_run_job"],
      ["cloud_run_revision", "cloud_run_job"],
    ]) {
      expect(
        getGcpMetricTypesToAsk({
          seenResourceTypes: new Set<string>(seen),
        }).filter((metric: GcpKeyMetric): boolean => {
          return metric.metricType === shared;
        }),
      ).toHaveLength(1);
    }

    expect(
      getGcpMetricTypesToAsk({
        seenResourceTypes: new Set<string>(["gce_instance"]),
      }).some((metric: GcpKeyMetric): boolean => {
        return metric.metricType === shared;
      }),
    ).toBe(false);
    expect(getGcpKeyMetricTypes().length).toBeLessThan(
      GCP_KEY_METRICS.reduce(
        (count: number, entry: GcpTypeKeyMetrics): number => {
          return count + entry.metrics.length;
        },
        0,
      ),
    );
  });

  test("a type counts as there for a day after it last reported", () => {
    const seen: Set<string> = getGcpSeenResourceTypes({
      seen: {
        gce_instance: new Date(NOW.getTime() - 60000).toISOString(),
        cloudsql_database: new Date(
          NOW.getTime() - GCP_RESOURCE_TYPE_SEEN_MS + 60000,
        ).toISOString(),
        redis_instance: new Date(
          NOW.getTime() - GCP_RESOURCE_TYPE_SEEN_MS,
        ).toISOString(),
        gcs_bucket: "not a time",
      },
      now: NOW,
    });

    expect(Array.from(seen).sort()).toEqual([
      "cloudsql_database",
      "gce_instance",
    ]);
    expect(getGcpSeenResourceTypes({ seen: undefined, now: NOW }).size).toBe(0);
  });
});

describe("a read keeps which resource types each project has", () => {
  test("found this read: the type is kept, and its metrics asked in the same read", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: {
        [CPU]: [vmSeries(CPU, "1001", "web-1")],
        [RECEIVED]: [
          vmSeries(RECEIVED, "1001", "web-1", { loadbalanced: "false" }),
        ],
      },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(result.nextState.gcpResourceTypesSeen).toEqual({
      [PROJECT_ID]: { gce_instance: NOW.toISOString() },
    });
    // The VM's network bytes were read in this read's second pass.
    expect(calledMetricTypes(fake)).toContain(RECEIVED);
    expect(result.pointsWritten).toBe(4);
  });

  test("a type the project had lately is asked whole from the first pass: no second pass", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
    });
    const seenAt: string = new Date(NOW.getTime() - 3600000).toISOString();

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {
        gcpResourceTypesSeen: {
          [PROJECT_ID]: { gce_instance: seenAt, cloudsql_database: seenAt },
        },
      }),
    );

    expect(calledMetricTypes(fake).sort()).toEqual(
      Array.from(
        new Set<string>([
          ...probeMetricTypes(),
          ...gceMetricTypes(),
          ...metricTypesOf("cloudsql_database"),
          // A project with VMs is asked whether one runs the Ops Agent.
          AGENT_MEMORY,
        ]),
      ).sort(),
    );
    // The VM reported again; the database, not this read, keeps its time.
    expect(result.nextState.gcpResourceTypesSeen).toEqual({
      [PROJECT_ID]: {
        gce_instance: NOW.toISOString(),
        cloudsql_database: seenAt,
      },
    });
  });

  test("a type quiet for a day is forgotten, and asked its first metric alone", async () => {
    const fake: FakeGcp = createFakeGcp({});
    const longAgo: string = new Date(
      NOW.getTime() - GCP_RESOURCE_TYPE_SEEN_MS - 60000,
    ).toISOString();

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {
        gcpResourceTypesSeen: { [PROJECT_ID]: { gce_instance: longAgo } },
      }),
    );

    expect(calledMetricTypes(fake).sort()).toEqual(probeMetricTypes().sort());
    expect(result.nextState.gcpResourceTypesSeen).toEqual({ [PROJECT_ID]: {} });
  });

  test("each project is asked by what it has: a project with nothing costs the first metrics alone", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
    });

    await connector.read(
      settings({ projectIds: `${PROJECT_ID}, ${OTHER_PROJECT}` }),
      readOptions(fake),
    );

    const byProject: Record<string, number> = {};

    for (const url of fake.seriesCalls) {
      const project: string = url.pathname.split("/")[3]!;
      byProject[project] = (byProject[project] || 0) + 1;
    }

    // The VM's project is also asked whether it runs the Ops Agent.
    expect(byProject).toEqual({
      [PROJECT_ID]: GCP_KEY_METRICS.length + gceMetricTypes().length,
      [OTHER_PROJECT]: GCP_KEY_METRICS.length,
    });
  });
});

/*
 * A distribution read for how many values it holds (#9565): Google counts
 * a topic's published messages as the count of its message sizes, now that
 * it deprecates topic/send_message_operation_count.
 */
describe("a distribution's count", () => {
  const SIZES: string = "pubsub.googleapis.com/topic/message_sizes";
  const OPERATIONS: string =
    "pubsub.googleapis.com/topic/send_message_operation_count";

  function topicSeries(
    metricType: string,
    value: JSONObject,
    topic: string = "orders",
  ): JSONObject {
    return {
      metric: { type: metricType, labels: {} },
      resource: {
        type: "pubsub_topic",
        labels: { project_id: PROJECT_ID, topic_id: topic },
      },
      points: [{ interval: { endTime: "2026-10-21T12:00:00Z" }, value }],
    };
  }

  test("is a point's distribution count, an int64 Google writes as a string, and 0 where it leaves it out", () => {
    expect(
      GcpMonitoring.readSeries(
        {
          timeSeries: [
            {
              metric: { type: SIZES },
              resource: { type: "pubsub_topic", labels: { topic_id: "a" } },
              points: [
                {
                  interval: { endTime: "2026-10-21T12:00:00Z" },
                  value: {
                    distributionValue: {
                      count: "1240",
                      mean: 512.5,
                      bucketCounts: ["1000", "240"],
                    },
                  },
                },
                // A minute with no message: proto3 leaves the count out.
                {
                  interval: { endTime: "2026-10-21T12:01:00Z" },
                  value: { distributionValue: { mean: 0 } },
                },
                // No distribution at all: nothing to count.
                {
                  interval: { endTime: "2026-10-21T12:02:00Z" },
                  value: { doubleValue: 3 },
                },
              ],
            },
          ],
        },
        SIZES,
        "count",
      )[0]!.points,
    ).toEqual([
      { timeMs: Date.parse("2026-10-21T12:00:00Z"), value: 1240 },
      { timeMs: Date.parse("2026-10-21T12:01:00Z"), value: 0 },
    ]);
    expect(GcpMonitoring.readDistributionCount({ doubleValue: 1 })).toBeNaN();
    expect(
      GcpMonitoring.readDistributionCount({ distributionValue: { count: 7 } }),
    ).toBe(7);
  });

  test("a read asks a topic's message sizes twice - their sum for the count, their 95th percentile - and stores the count as its own", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: {
        [SIZES]: [
          topicSeries(SIZES, { distributionValue: { count: "42", mean: 99 } }),
        ],
      },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {
        gcpResourceTypesSeen: {
          [PROJECT_ID]: {
            pubsub_topic: new Date(NOW.getTime() - 60000).toISOString(),
          },
        },
      }),
    );
    const sizeCalls: Array<URL> = fake.seriesCalls.filter(
      (url: URL): boolean => {
        return metricTypeOf(url.searchParams.get("filter") || "") === SIZES;
      },
    );

    expect(
      sizeCalls
        .map((url: URL): string => {
          return url.searchParams.get("aggregation.perSeriesAligner") || "";
        })
        .sort(),
    ).toEqual(["ALIGN_PERCENTILE_95", "ALIGN_SUM"]);

    const metrics: Array<JSONObject> = [];

    for (const payload of result.payloads) {
      for (const rm of payload["resourceMetrics"] as JSONArray) {
        for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
          metrics.push(...((sm as JSONObject)["metrics"] as Array<JSONObject>));
        }
      }
    }

    const count: JSONObject | undefined = metrics.find(
      (metric: JSONObject): boolean => {
        return metric["name"] === `${SIZES}_count`;
      },
    );

    expect(count?.["unit"]).toBe("1");
    expect(
      (
        (
          (count!["gauge"] as JSONObject)["dataPoints"] as JSONArray
        )[0] as JSONObject
      )["asDouble"],
    ).toBe(42);
    /*
     * The fake answers both calls with the same distribution, which the
     * percentile's call reads no number from: it writes nothing.
     */
    expect(
      metrics.some((metric: JSONObject): boolean => {
        return metric["name"] === SIZES;
      }),
    ).toBe(false);
  });

  /*
   * The deprecated publish operations were read for the monitors built on
   * them until those moved to the count of the message sizes (#9739): read
   * no more, of a project with topics or without.
   */
  test("the deprecated publish operations are read no more, even where a project has topics", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: {
        [OPERATIONS]: [topicSeries(OPERATIONS, { doubleValue: 3.5 })],
      },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {
        gcpResourceTypesSeen: {
          [PROJECT_ID]: {
            pubsub_topic: new Date(NOW.getTime() - 60000).toISOString(),
          },
        },
      }),
    );

    expect(calledMetricTypes(fake)).not.toContain(OPERATIONS);
    // A topic's messages are its message sizes' count.
    expect(calledMetricTypes(fake)).toContain(SIZES);
    expect(result.pointsWritten).toBe(0);

    const empty: FakeGcp = createFakeGcp({});

    await connector.read(settings(), readOptions(empty));

    expect(calledMetricTypes(empty)).not.toContain(OPERATIONS);
  });
});

/*
 * A VM's memory and disk use come from the Ops Agent on it (#9568), asked
 * of a project only while one of its VMs reports them, and once an hour
 * otherwise - so VMs without the agent cost no call a read.
 */
describe("the Ops Agent's metrics", () => {
  const SEEN_VMS: CloudConnectionPullState = {
    gcpResourceTypesSeen: {
      [PROJECT_ID]: {
        gce_instance: new Date(NOW.getTime() - 60000).toISOString(),
      },
    },
  };

  function agentCalls(fake: FakeGcp): Array<URL> {
    return fake.seriesCalls.filter((url: URL): boolean => {
      return metricTypeOf(url.searchParams.get("filter") || "").startsWith(
        "agent.googleapis.com/",
      );
    });
  }

  test("are asked all while a VM reports one, the first alone once an hour while it has VMs, else not at all", () => {
    const anHourAgo: string = new Date(
      NOW.getTime() - GCP_OPS_AGENT_ASK_EVERY_MS,
    ).toISOString();
    const lately: string = new Date(NOW.getTime() - 60000).toISOString();

    expect(
      getGcpOpsAgentAsk({ isReporting: true, hasResources: true, now: NOW }),
    ).toBe("all");
    expect(
      getGcpOpsAgentAsk({ isReporting: false, hasResources: true, now: NOW }),
    ).toBe("first");
    expect(
      getGcpOpsAgentAsk({
        isReporting: false,
        askedAt: anHourAgo,
        hasResources: true,
        now: NOW,
      }),
    ).toBe("first");
    expect(
      getGcpOpsAgentAsk({
        isReporting: false,
        askedAt: lately,
        hasResources: true,
        now: NOW,
      }),
    ).toBe("none");
    expect(
      getGcpOpsAgentAsk({ isReporting: false, hasResources: false, now: NOW }),
    ).toBe("none");
    expect(hasGcpOpsAgentResources(new Set<string>(["gce_instance"]))).toBe(
      true,
    );
    expect(hasGcpOpsAgentResources(new Set<string>(["gcs_bucket"]))).toBe(
      false,
    );
    expect(GCP_OPS_AGENT_ASK_EVERY_MS).toBe(3600000);
    expect(GCP_OPS_AGENT_SEEN_MS).toBe(GCP_RESOURCE_TYPE_SEEN_MS);
  });

  test("a VM's metrics never include them by themselves: only as the agent's presence says", () => {
    const storedNames: (
      opsAgent?: "all" | "first" | "none",
    ) => Array<string> = (
      opsAgent?: "all" | "first" | "none",
    ): Array<string> => {
      return getGcpMetricTypesToAsk({
        seenResourceTypes: new Set<string>(["gce_instance"]),
        opsAgent,
      })
        .filter((metric: GcpReadMetric): boolean => {
          return metric.reportedBy === GCP_OPS_AGENT;
        })
        .map((metric: GcpReadMetric): string => {
          return metric.storedName;
        });
    };

    expect(storedNames()).toEqual([]);
    expect(storedNames("none")).toEqual([]);
    expect(storedNames("first")).toEqual([AGENT_MEMORY]);
    expect(storedNames("all")).toEqual([AGENT_MEMORY, AGENT_DISK]);
  });

  test("a project with VMs and no agent is asked the agent's first metric, in its used state, once an hour", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, SEEN_VMS),
    );

    expect(
      agentCalls(fake).map((url: URL): string | null => {
        return url.searchParams.get("filter");
      }),
    ).toEqual([`metric.type="${AGENT_MEMORY}" AND metric.labels.state="used"`]);
    expect(
      agentCalls(fake)[0]!.searchParams.get("aggregation.perSeriesAligner"),
    ).toBe("ALIGN_MEAN");
    expect(result.nextState.gcpOpsAgentAskedAt).toEqual({
      [PROJECT_ID]: NOW.toISOString(),
    });
    expect(result.nextState.gcpOpsAgentSeen).toEqual({});

    // Within the hour, the next read does not ask again.
    const again: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
    });

    await connector.read(
      settings(),
      readOptions(again, {
        ...SEEN_VMS,
        gcpOpsAgentAskedAt: {
          [PROJECT_ID]: new Date(NOW.getTime() - 30 * 60000).toISOString(),
        },
      }),
    );

    expect(agentCalls(again)).toEqual([]);
  });

  test("an agent found asks its other metrics in the same read, and both every read after, a series per disk", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: {
        [CPU]: [vmSeries(CPU, "1001", "web-1")],
        [AGENT_MEMORY]: [
          agentSeries(AGENT_MEMORY, "1001", { state: "used" }, 41.5),
          // Not asked: the filter names the used state alone.
          agentSeries(AGENT_MEMORY, "1001", { state: "cached" }, 30),
        ],
        [AGENT_DISK]: [
          agentSeries(
            AGENT_DISK,
            "1001",
            { device: "/dev/sda1", state: "used" },
            62,
          ),
          agentSeries(
            AGENT_DISK,
            "1001",
            { device: "/dev/sdb", state: "used" },
            91,
          ),
          agentSeries(
            AGENT_DISK,
            "1001",
            { device: "/dev/sda1", state: "free" },
            38,
          ),
        ],
      },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, SEEN_VMS),
    );

    // The first's answer found the agent: its disk was asked next.
    expect(
      agentCalls(fake).map((url: URL): string => {
        return metricTypeOf(url.searchParams.get("filter") || "");
      }),
    ).toEqual([AGENT_MEMORY, AGENT_DISK]);
    expect(result.nextState.gcpOpsAgentSeen).toEqual({
      [PROJECT_ID]: NOW.toISOString(),
    });

    const written: Record<string, Array<string>> = {};

    for (const payload of result.payloads) {
      for (const rm of payload["resourceMetrics"] as JSONArray) {
        for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
          for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
            const name: string = (metric as JSONObject)["name"] as string;

            for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
              "dataPoints"
            ] as JSONArray) {
              written[name] = [
                ...(written[name] || []),
                JSON.stringify((point as JSONObject)["attributes"]),
              ];
            }
          }
        }
      }
    }

    // Memory once, in its used state; each disk once, in its.
    expect(written[AGENT_MEMORY]).toEqual([
      JSON.stringify([{ key: "state", value: { stringValue: "used" } }]),
    ]);
    expect(written[AGENT_DISK]).toEqual([
      JSON.stringify([
        { key: "device", value: { stringValue: "/dev/sda1" } },
        { key: "state", value: { stringValue: "used" } },
      ]),
      JSON.stringify([
        { key: "device", value: { stringValue: "/dev/sdb" } },
        { key: "state", value: { stringValue: "used" } },
      ]),
    ]);

    // The next read, of a window of its own, asks both from its first pass.
    const next: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
    });

    await connector.read(
      settings(),
      readOptions(next, { ...result.nextState, cursors: {} }),
    );

    expect(
      agentCalls(next)
        .map((url: URL): string => {
          return metricTypeOf(url.searchParams.get("filter") || "");
        })
        .sort(),
    ).toEqual([AGENT_DISK, AGENT_MEMORY]);
  });

  test("a new connection finds a VM, asks whether it runs the agent, and reads the agent's disks in a third pass", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: {
        [CPU]: [vmSeries(CPU, "1001", "web-1")],
        [AGENT_MEMORY]: [
          agentSeries(AGENT_MEMORY, "1001", { state: "used" }, 41.5),
        ],
        [AGENT_DISK]: [
          agentSeries(
            AGENT_DISK,
            "1001",
            { device: "/dev/sda1", state: "used" },
            62,
          ),
        ],
      },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(
      agentCalls(fake).map((url: URL): string => {
        return metricTypeOf(url.searchParams.get("filter") || "");
      }),
    ).toEqual([AGENT_MEMORY, AGENT_DISK]);
    // Each metric once: no pass asks again what an earlier one asked.
    const asked: Array<string> = fake.seriesCalls.map((url: URL): string => {
      return `${url.searchParams.get("filter")}|${url.searchParams.get("aggregation.perSeriesAligner")}`;
    });
    expect(new Set(asked).size).toBe(asked.length);
    expect(result.nextState.gcpOpsAgentSeen).toEqual({
      [PROJECT_ID]: NOW.toISOString(),
    });
  });

  test("an agent quiet for a day is asked for once an hour again, and a project without VMs never", async () => {
    const quiet: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(quiet, {
        ...SEEN_VMS,
        gcpOpsAgentSeen: {
          [PROJECT_ID]: new Date(
            NOW.getTime() - GCP_OPS_AGENT_SEEN_MS - 60000,
          ).toISOString(),
        },
      }),
    );

    expect(
      agentCalls(quiet).map((url: URL): string => {
        return metricTypeOf(url.searchParams.get("filter") || "");
      }),
    ).toEqual([AGENT_MEMORY]);
    expect(result.nextState.gcpOpsAgentSeen).toEqual({});

    const noVms: FakeGcp = createFakeGcp({});

    await connector.read(settings(), readOptions(noVms));

    expect(agentCalls(noVms)).toEqual([]);
  });

  test("a read that stops at its limit keeps when the agent was last asked for as it was", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: { [CPU]: [vmSeries(CPU, "1001", "web-1")] },
    });
    const askedAt: string = new Date(
      NOW.getTime() - 2 * GCP_OPS_AGENT_ASK_EVERY_MS,
    ).toISOString();

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(
        fake,
        { ...SEEN_VMS, gcpOpsAgentAskedAt: { [PROJECT_ID]: askedAt } },
        { maxRequests: 3 },
      ),
    );

    expect(result.complete).toBe(false);
    expect(result.nextState.gcpOpsAgentAskedAt).toEqual({
      [PROJECT_ID]: askedAt,
    });
  });
});

describe("a call's filter", () => {
  test("names the metric type, and each label it is read by, in name order", () => {
    expect(GcpMonitoring.buildFilter({ metricType: CPU })).toBe(
      `metric.type="${CPU}"`,
    );
    expect(
      GcpMonitoring.buildFilter({
        metricType: AGENT_DISK,
        metricLabels: { state: "used", device: "/dev/sda1" },
      }),
    ).toBe(
      `metric.type="${AGENT_DISK}" AND metric.labels.device="/dev/sda1" AND metric.labels.state="used"`,
    );
  });

  test("an added metric's narrows it to its resource type, and to one resource by its labels, in name order", () => {
    expect(
      GcpMonitoring.buildFilter({
        metricType: "compute.googleapis.com/instance/uptime",
        resourceType: "gce_instance",
        resourceLabels: { zone: "us-central1-a", instance_id: "1234" },
      }),
    ).toBe(
      'metric.type="compute.googleapis.com/instance/uptime" AND resource.type="gce_instance" AND resource.labels.instance_id="1234" AND resource.labels.zone="us-central1-a"',
    );
  });
});

/*
 * ---- Metrics a person added to the reads (#9563) -------------------------
 *
 * One call per added metric type, as a key metric is, narrowed to the
 * resources it is for: Cloud Monitoring bills a call by the series it
 * returns, so a call narrowed to one resource costs one series.
 */
describe("metrics a person added to the reads", () => {
  const UPTIME: string = "compute.googleapis.com/instance/uptime";

  function added(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
    const metric: CloudAddedMetric = {
      key: "",
      provider: CloudProvider.GCP,
      scope: CloudAddedMetricScope.Type,
      resourceType: "gce_instance",
      name: UPTIME,
      aggregation: "ALIGN_RATE",
      unit: "s/s",
      addedAt: NOW.toISOString(),
      ...overrides,
    };

    return { ...metric, key: getCloudAddedMetricKey(metric) };
  }

  function ownAddition(
    overrides: Partial<CloudAddedMetric> = {},
  ): CloudAddedMetric {
    return added({
      scope: CloudAddedMetricScope.Resource,
      cloudResourceId: "c1d2e3f4-0000-4000-8000-000000000001",
      accountId: PROJECT_ID,
      resourceLabels: {
        project_id: PROJECT_ID,
        zone: "us-central1-a",
        instance_id: "1001",
      },
      ...overrides,
    });
  }

  // A project known to have VMs: its VM metrics are asked every read.
  const WITH_VMS: CloudConnectionPullState = {
    gcpResourceTypesSeen: {
      [PROJECT_ID]: {
        gce_instance: new Date(NOW.getTime() - 60 * 1000).toISOString(),
      },
    },
  };

  function twoVms(): FakeGcp {
    return createFakeGcp({
      series: {
        [CPU]: [vmSeries(CPU, "1001", "web-1"), vmSeries(CPU, "1002", "web-2")],
        [UPTIME]: [
          vmSeries(UPTIME, "1001", "web-1"),
          vmSeries(UPTIME, "1002", "web-2"),
        ],
      },
    });
  }

  function uptimeCalls(fake: FakeGcp): Array<string> {
    return fake.seriesCalls
      .filter((url: URL): boolean => {
        return metricTypeOf(url.searchParams.get("filter") || "") === UPTIME;
      })
      .map((url: URL): string => {
        return `${url.pathname.split("/")[3]} ${url.searchParams.get("filter")} ${url.searchParams.get("aggregation.perSeriesAligner")}`;
      });
  }

  function writtenInstances(result: CloudReadResult): Array<string> {
    const instances: Array<string> = [];

    for (const payload of result.payloads) {
      for (const rm of payload["resourceMetrics"] as JSONArray) {
        const resourceAttributes: JSONArray = (
          (rm as JSONObject)["resource"] as JSONObject
        )["attributes"] as JSONArray;

        for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
          for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
            if ((metric as JSONObject)["name"] !== UPTIME) {
              continue;
            }

            for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
              "dataPoints"
            ] as JSONArray) {
              const stored: JSONObject = storedAttributesOf(
                resourceAttributes as never,
                (point as JSONObject)["attributes"] as never,
              ) as JSONObject;

              instances.push(String(stored["resource.instance_id"]));
            }
          }
        }
      }
    }

    return Array.from(new Set(instances)).sort();
  }

  test("a type's addition is asked of a project with resources of its type, narrowed to them, and written for each", async () => {
    const fake: FakeGcp = twoVms();

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, WITH_VMS, { addedMetrics: [added()] }),
    );

    expect(uptimeCalls(fake)).toEqual([
      `${PROJECT_ID} metric.type="${UPTIME}" AND resource.type="gce_instance" ALIGN_RATE`,
    ]);
    expect(writtenInstances(result)).toEqual(["1001", "1002"]);
  });

  test("a project with no resource of the type is not asked a type's addition", async () => {
    const fake: FakeGcp = twoVms();

    await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, {}, { addedMetrics: [added()] }),
    );

    expect(uptimeCalls(fake)).toEqual([]);
  });

  test("a resource's own addition is asked of its project alone, narrowed to its series", async () => {
    const fake: FakeGcp = twoVms();

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: `${PROJECT_ID},${OTHER_PROJECT}` }),
      readOptions(fake, WITH_VMS, { addedMetrics: [ownAddition()] }),
    );

    expect(uptimeCalls(fake)).toEqual([
      `${PROJECT_ID} metric.type="${UPTIME}" AND resource.type="gce_instance" AND resource.labels.instance_id="1001" AND resource.labels.project_id="${PROJECT_ID}" AND resource.labels.zone="us-central1-a" ALIGN_RATE`,
    ]);
    expect(writtenInstances(result)).toEqual(["1001"]);
  });

  test("which additions a project is asked: a type's where it has the type, a resource's own in its project, none that is a key metric", () => {
    const asks: Array<GcpAddedMetricAsk> = getGcpAddedMetricsToAsk({
      added: [
        added(),
        added({
          resourceType: "cloudsql_database",
          name: "cloudsql.googleapis.com/database/postgresql/num_backends",
        }),
        ownAddition({
          name: "compute.googleapis.com/instance/disk/max_read_ops_count",
        }),
        ownAddition({ accountId: OTHER_PROJECT, cloudResourceId: "other-row" }),
        added({ name: CPU }),
        added({
          provider: CloudProvider.AWS,
          name: "SwapUsage",
          namespace: "AWS/RDS",
        }),
      ],
      projectId: PROJECT_ID,
      seenResourceTypes: new Set<string>(["gce_instance"]),
    });

    expect(
      asks.map((ask: GcpAddedMetricAsk) => {
        return {
          metricType: ask.metric.metricType,
          resourceType: ask.resourceType,
          resourceLabels: ask.resourceLabels,
        };
      }),
    ).toEqual([
      {
        metricType: UPTIME,
        resourceType: "gce_instance",
        resourceLabels: undefined,
      },
      {
        metricType: "compute.googleapis.com/instance/disk/max_read_ops_count",
        resourceType: "gce_instance",
        resourceLabels: {
          project_id: PROJECT_ID,
          zone: "us-central1-a",
          instance_id: "1001",
        },
      },
    ]);
    // Stored under its metric type, read with its aligner.
    expect(asks[0]!.metric.storedName).toBe(UPTIME);
    expect(asks[0]!.metric.aligner).toBe("ALIGN_RATE");
  });

  /*
   * #9810: the resources of a project one metric is added for are asked in
   * one call, not one each - the project's per-minute read quota is spent
   * once - and each series the answer carries is filed under its own VM.
   */
  function vmLabels(
    instanceId: string,
    zone: string = "us-central1-a",
  ): Record<string, string> {
    return { project_id: PROJECT_ID, zone, instance_id: instanceId };
  }

  function ownOf(instanceId: string, zone?: string): CloudAddedMetric {
    return ownAddition({
      cloudResourceId: `row-${instanceId}`,
      resourceLabels: vmLabels(instanceId, zone),
    });
  }

  function vmSeriesIn(
    metricType: string,
    instanceId: string,
    zone: string,
  ): JSONObject {
    const series: JSONObject = vmSeries(
      metricType,
      instanceId,
      `vm-${instanceId}`,
    );

    ((series["resource"] as JSONObject)["labels"] as JSONObject)["zone"] = zone;

    return series;
  }

  // Four VMs report uptime: three of them, in two zones, have it added.
  function fourVms(
    options: Partial<Parameters<typeof createFakeGcp>[0]> = {},
  ): FakeGcp {
    return createFakeGcp({
      series: {
        [CPU]: [vmSeries(CPU, "1001", "web-1")],
        [UPTIME]: [
          vmSeriesIn(UPTIME, "1001", "us-central1-a"),
          vmSeriesIn(UPTIME, "1002", "us-central1-a"),
          vmSeriesIn(UPTIME, "1003", "us-central1-a"),
          vmSeriesIn(UPTIME, "1004", "us-central1-a"),
          vmSeriesIn(UPTIME, "2001", "europe-west1-b"),
        ],
      },
      ...options,
    });
  }

  test("three VMs' own additions of one metric cost one call, and each VM's series is written under it", async () => {
    const fake: FakeGcp = fourVms();

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, WITH_VMS, {
        addedMetrics: [ownOf("1003"), ownOf("1001"), ownOf("1002")],
      }),
    );

    expect(uptimeCalls(fake)).toEqual([
      `${PROJECT_ID} metric.type="${UPTIME}" AND resource.type="gce_instance" AND resource.labels.instance_id=one_of("1001","1002","1003") AND resource.labels.project_id="${PROJECT_ID}" AND resource.labels.zone="us-central1-a" ALIGN_RATE`,
    ]);
    // Not 1004, which reports it and has it added for none.
    expect(writtenInstances(result)).toEqual(["1001", "1002", "1003"]);
    expect(result.warnings).toEqual([]);
  });

  test("VMs of two zones: a call per zone, each VM's series under it", async () => {
    const fake: FakeGcp = fourVms();

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, WITH_VMS, {
        addedMetrics: [
          ownOf("1001"),
          ownOf("1002"),
          ownOf("2001", "europe-west1-b"),
        ],
      }),
    );

    expect(uptimeCalls(fake).sort()).toEqual(
      [
        `${PROJECT_ID} metric.type="${UPTIME}" AND resource.type="gce_instance" AND resource.labels.instance_id="2001" AND resource.labels.project_id="${PROJECT_ID}" AND resource.labels.zone="europe-west1-b" ALIGN_RATE`,
        `${PROJECT_ID} metric.type="${UPTIME}" AND resource.type="gce_instance" AND resource.labels.instance_id=one_of("1001","1002") AND resource.labels.project_id="${PROJECT_ID}" AND resource.labels.zone="us-central1-a" ALIGN_RATE`,
      ].sort(),
    );
    expect(writtenInstances(result)).toEqual(["1001", "1002", "2001"]);
  });

  test("a series of a resource the batch did not ask for is never written, whatever Google answers", async () => {
    // Google answers every VM's series, as if it had read no label of the filter.
    const fake: FakeGcp = fourVms({
      answer: (url: URL): FakeResponse | undefined => {
        if (metricTypeOf(url.searchParams.get("filter") || "") !== UPTIME) {
          return undefined;
        }

        return json({
          timeSeries: [
            vmSeriesIn(UPTIME, "1001", "us-central1-a"),
            vmSeriesIn(UPTIME, "1002", "us-central1-a"),
            vmSeriesIn(UPTIME, "1004", "us-central1-a"),
            // 1002's instance id in another zone: not the 1002 asked for.
            vmSeriesIn(UPTIME, "1002", "europe-west1-b"),
          ],
        });
      },
    });

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, WITH_VMS, {
        addedMetrics: [ownOf("1001"), ownOf("1002")],
      }),
    );

    expect(writtenInstances(result)).toEqual(["1001", "1002"]);

    // 1002's series once: the one of its own zone.
    const zones: Array<string> = [];

    for (const payload of result.payloads) {
      for (const rm of payload["resourceMetrics"] as JSONArray) {
        const attributes: JSONArray = (
          (rm as JSONObject)["resource"] as JSONObject
        )["attributes"] as JSONArray;
        const hasUptime: boolean = (
          (rm as JSONObject)["scopeMetrics"] as JSONArray
        ).some((sm: unknown): boolean => {
          return ((sm as JSONObject)["metrics"] as JSONArray).some(
            (metric: unknown): boolean => {
              return (metric as JSONObject)["name"] === UPTIME;
            },
          );
        });
        const zone: JSONObject | undefined = attributes.find(
          (attribute: unknown): boolean => {
            return (attribute as JSONObject)["key"] === "zone";
          },
        ) as JSONObject | undefined;

        if (hasUptime && zone) {
          zones.push(
            String((zone["value"] as JSONObject)["stringValue"] || ""),
          );
        }
      }
    }

    expect(zones.sort()).toEqual(["us-central1-a", "us-central1-a"]);
  });

  test("a batch's pages are followed, and every page's series written", async () => {
    const fake: FakeGcp = fourVms({ pages: 3 });

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, WITH_VMS, {
        addedMetrics: [ownOf("1001"), ownOf("1002"), ownOf("1003")],
      }),
    );

    const calls: Array<URL> = fake.seriesCalls.filter((url: URL): boolean => {
      return metricTypeOf(url.searchParams.get("filter") || "") === UPTIME;
    });

    // One batch, read over three pages.
    expect(
      calls.map((url: URL): string => {
        return url.searchParams.get("pageToken") || "";
      }),
    ).toEqual(["", "1", "2"]);
    expect(
      new Set(
        calls.map((url: URL): string => {
          return url.searchParams.get("filter") || "";
        }),
      ).size,
    ).toBe(1);
    expect(writtenInstances(result)).toEqual(["1001", "1002", "1003"]);
  });

  test("a batch whose call fails is said, and the other batch and the key metrics are written", async () => {
    const fake: FakeGcp = fourVms({
      answer: (url: URL): FakeResponse | undefined => {
        const filter: string = url.searchParams.get("filter") || "";

        return metricTypeOf(filter) === UPTIME &&
          filter.includes("europe-west1-b")
          ? { status: 500, body: "backend error" }
          : undefined;
      },
    });

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, WITH_VMS, {
        addedMetrics: [
          ownOf("1001"),
          ownOf("1002"),
          ownOf("2001", "europe-west1-b"),
        ],
      }),
    );

    expect(writtenInstances(result)).toEqual(["1001", "1002"]);
    expect(result.warnings.join(" ")).toContain("Could not read 1 metrics");
    // The window still moves on, as for any metric that failed.
    expect(result.nextState.cursors?.["60"]).toBe(WINDOW_END);
  });

  test("a batch refused on its second page writes none of its first, and says so", async () => {
    const fake: FakeGcp = fourVms({
      pages: 2,
      answer: (url: URL): FakeResponse | undefined => {
        return metricTypeOf(url.searchParams.get("filter") || "") === UPTIME &&
          url.searchParams.get("pageToken") === "1"
          ? { status: 500, body: "backend error" }
          : undefined;
      },
    });

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, WITH_VMS, {
        addedMetrics: [ownOf("1001"), ownOf("1002"), ownOf("1003")],
      }),
    );

    expect(writtenInstances(result)).toEqual([]);
    expect(result.warnings.join(" ")).toContain("Could not read 1 metrics");
  });

  test("a type's addition of the same metric reads every VM already: the VMs' own are not asked again", async () => {
    const fake: FakeGcp = fourVms();

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, WITH_VMS, {
        addedMetrics: [ownOf("1001"), added(), ownOf("1002")],
      }),
    );

    expect(uptimeCalls(fake)).toEqual([
      `${PROJECT_ID} metric.type="${UPTIME}" AND resource.type="gce_instance" ALIGN_RATE`,
    ]);
    expect(writtenInstances(result)).toEqual([
      "1001",
      "1002",
      "1003",
      "1004",
      "2001",
    ]);
  });

  /*
   * #9808: an addition split by one of its labels reads its other labels
   * added up - a rate by their sum, a level by their mean - keeping the
   * label and the VM's own, a series per value, the busiest 10 of each VM.
   */
  const READ_OPS: string =
    "compute.googleapis.com/instance/disk/max_read_ops_count";

  function diskSeries(
    instanceId: string,
    device: string,
    value: number,
  ): JSONObject {
    return {
      ...vmSeriesIn(READ_OPS, instanceId, "us-central1-a"),
      metric: {
        type: READ_OPS,
        labels: { device_name: device, storage_type: "pd-ssd" },
      },
      points: [
        {
          interval: { endTime: "2026-10-21T12:00:00Z" },
          value: { doubleValue: value },
        },
      ],
    };
  }

  test("a split addition adds its other labels up by the label and the VM's own, and stores each value under its VM", async () => {
    const fake: FakeGcp = createFakeGcp({
      series: {
        [CPU]: [vmSeries(CPU, "1001", "web-1")],
        [READ_OPS]: [
          diskSeries("1001", "boot", 3),
          diskSeries("1001", "data", 7),
          diskSeries("1002", "boot", 1),
        ],
      },
    });
    const split: CloudAddedMetric = added({
      name: READ_OPS,
      aggregation: "ALIGN_RATE",
      splitBy: "device_name",
      resourceLabelKeys: ["zone", "instance_id", "project_id"],
    });

    const result: CloudReadResult = await connector.read(
      settings({ projectIds: PROJECT_ID }),
      readOptions(fake, WITH_VMS, { addedMetrics: [split] }),
    );
    const call: URL = fake.seriesCalls.find((url: URL): boolean => {
      return metricTypeOf(url.searchParams.get("filter") || "") === READ_OPS;
    })!;

    expect(call.searchParams.get("aggregation.perSeriesAligner")).toBe(
      "ALIGN_RATE",
    );
    expect(call.searchParams.get("aggregation.crossSeriesReducer")).toBe(
      "REDUCE_SUM",
    );
    expect(call.searchParams.getAll("aggregation.groupByFields")).toEqual([
      "metric.label.device_name",
      "resource.label.instance_id",
      "resource.label.project_id",
      "resource.label.zone",
    ]);

    const written: Array<string> = [];

    for (const payload of result.payloads) {
      for (const rm of payload["resourceMetrics"] as JSONArray) {
        const resourceAttributes: JSONArray = (
          (rm as JSONObject)["resource"] as JSONObject
        )["attributes"] as JSONArray;

        for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
          for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
            if ((metric as JSONObject)["name"] !== READ_OPS) {
              continue;
            }

            for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
              "dataPoints"
            ] as JSONArray) {
              const stored: JSONObject = storedAttributesOf(
                resourceAttributes as never,
                (point as JSONObject)["attributes"] as never,
              ) as JSONObject;

              written.push(
                `${stored["resource.instance_id"]}:${
                  stored[
                    getCloudAddedMetricSplitAttribute({
                      provider: CloudProvider.GCP,
                      splitBy: "device_name",
                    })
                  ]
                }`,
              );
            }
          }
        }
      }
    }

    expect(written.sort()).toEqual(["1001:boot", "1001:data", "1002:boot"]);
  });

  test("a split reads a level by its mean, a rate by its sum; one read whole adds nothing up", () => {
    expect(
      getGcpSplitRead({
        splitBy: "state",
        aggregation: "ALIGN_MEAN",
        resourceLabelKeys: ["instance_id"],
      }),
    ).toEqual({
      label: "state",
      reducer: "REDUCE_MEAN",
      resourceLabelKeys: ["instance_id"],
    });
    expect(
      getGcpSplitRead({
        splitBy: "response_code_class",
        aggregation: "ALIGN_RATE",
        resourceLabelKeys: ["topic_id"],
      })?.reducer,
    ).toBe("REDUCE_SUM");
    expect(
      getGcpSplitRead({ aggregation: "ALIGN_RATE", resourceLabelKeys: ["x"] }),
    ).toBeUndefined();
    expect(
      getGcpSplitRead({ splitBy: "state", aggregation: "ALIGN_MEAN" }),
    ).toBeUndefined();
    expect(GcpMonitoring.splitParameters(undefined)).toEqual([]);
  });

  test("a split keeps the busiest 10 values of each resource, each resource apart", () => {
    const series: Array<GcpTimeSeries> = [];

    for (let index: number = 0; index < 12; index++) {
      series.push({
        metricType: READ_OPS,
        metricLabels: { device_name: `disk-${index}` },
        resourceType: "gce_instance",
        resourceLabels: vmLabels("1001"),
        metadataName: "",
        points: [{ timeMs: 1, value: index }],
      });
    }

    series.push({
      metricType: READ_OPS,
      metricLabels: { device_name: "boot" },
      resourceType: "gce_instance",
      resourceLabels: vmLabels("1002"),
      metadataName: "",
      points: [{ timeMs: 1, value: 0 }],
    });

    const kept: Array<GcpTimeSeries> = capGcpSplitSeries(series);

    expect(
      kept
        .filter((entry: GcpTimeSeries): boolean => {
          return entry.resourceLabels["instance_id"] === "1001";
        })
        .map((entry: GcpTimeSeries): string => {
          return entry.metricLabels["device_name"]!;
        }),
    ).toEqual([
      "disk-11",
      "disk-10",
      "disk-9",
      "disk-8",
      "disk-7",
      "disk-6",
      "disk-5",
      "disk-4",
      "disk-3",
      "disk-2",
    ]);
    expect(
      kept.filter((entry: GcpTimeSeries): boolean => {
        return entry.resourceLabels["instance_id"] === "1002";
      }),
    ).toHaveLength(1);
  });

  test("resources' own split additions are batched as unsplit ones are, each batch read split", () => {
    const asks: Array<GcpAddedMetricAsk> = getGcpAddedMetricsToAsk({
      added: [
        ownAddition({
          cloudResourceId: "row-1001",
          name: READ_OPS,
          resourceLabels: vmLabels("1001"),
          splitBy: "device_name",
          resourceLabelKeys: ["instance_id", "project_id", "zone"],
        }),
        ownAddition({
          cloudResourceId: "row-1002",
          name: READ_OPS,
          resourceLabels: vmLabels("1002"),
          splitBy: "device_name",
          resourceLabelKeys: ["instance_id", "project_id", "zone"],
        }),
        // Read whole: its own call.
        ownAddition({
          cloudResourceId: "row-1003",
          name: READ_OPS,
          resourceLabels: vmLabels("1003"),
        }),
      ],
      projectId: PROJECT_ID,
      seenResourceTypes: new Set<string>(),
    });

    expect(
      asks.map((ask: GcpAddedMetricAsk) => {
        return {
          values: ask.resourceLabelIn?.values,
          split: ask.split?.label,
        };
      }),
    ).toEqual([
      { values: ["1001", "1002"], split: "device_name" },
      { values: undefined, split: undefined },
    ]);
  });

  test("which asks a project's own additions make: one per metric, aligner and batch", () => {
    const asks: Array<GcpAddedMetricAsk> = getGcpAddedMetricsToAsk({
      added: [
        ownOf("1001"),
        ownOf("1002"),
        ownAddition({
          cloudResourceId: "row-1001-mean",
          resourceLabels: vmLabels("1001"),
          aggregation: "ALIGN_MEAN",
        }),
        ownAddition({
          cloudResourceId: "row-1003-reads",
          name: "compute.googleapis.com/instance/disk/max_read_ops_count",
          resourceLabels: vmLabels("1003"),
        }),
        // Another project's VM: asked of its own project, never this one.
        ownAddition({
          cloudResourceId: "row-staging",
          accountId: OTHER_PROJECT,
          resourceLabels: {
            project_id: OTHER_PROJECT,
            zone: "us-central1-a",
            instance_id: "9001",
          },
        }),
      ],
      projectId: PROJECT_ID,
      seenResourceTypes: new Set<string>(),
    });

    expect(
      asks.map((ask: GcpAddedMetricAsk) => {
        return {
          metricType: ask.metric.metricType,
          aligner: ask.metric.aligner,
          resourceLabels: ask.resourceLabels,
          resourceLabelIn: ask.resourceLabelIn,
          resources: ask.resources?.length,
        };
      }),
    ).toEqual([
      {
        metricType: UPTIME,
        aligner: "ALIGN_RATE",
        resourceLabels: { project_id: PROJECT_ID, zone: "us-central1-a" },
        resourceLabelIn: { label: "instance_id", values: ["1001", "1002"] },
        resources: 2,
      },
      {
        metricType: UPTIME,
        aligner: "ALIGN_MEAN",
        resourceLabels: vmLabels("1001"),
        resourceLabelIn: undefined,
        resources: 1,
      },
      {
        metricType: "compute.googleapis.com/instance/disk/max_read_ops_count",
        aligner: "ALIGN_RATE",
        resourceLabels: vmLabels("1003"),
        resourceLabelIn: undefined,
        resources: 1,
      },
    ]);
  });
});

/*
 * #9810: how the resources a metric is added for are split into calls.
 * Exact: a call's filter matches its own resources and no other, so each
 * series maps back to the one resource whose labels it carries.
 */
describe("the resources of a project one metric is added for, in as few calls as their labels allow", () => {
  const UPTIME: string = "compute.googleapis.com/instance/uptime";
  const SQL_BACKENDS: string =
    "cloudsql.googleapis.com/database/postgresql/num_backends";

  function vm(
    instanceId: string,
    zone: string = "us-central1-a",
  ): Record<string, string> {
    return { project_id: PROJECT_ID, zone, instance_id: instanceId };
  }

  function plan(
    resources: Array<Record<string, string>>,
    metricType: string = UPTIME,
    resourceType: string = "gce_instance",
  ): Array<GcpResourceBatch> {
    return planGcpResourceBatches({ metricType, resourceType, resources });
  }

  // Every label set a batch's filter matches: its equal labels with each value of its one_of.
  function matchedBy(batch: GcpResourceBatch): Array<string> {
    const values: Array<string | undefined> = batch.labelIn
      ? [...batch.labelIn.values]
      : [undefined];

    return values
      .map((value: string | undefined): string => {
        const labels: Record<string, string> = { ...batch.labels };

        if (batch.labelIn && value !== undefined) {
          labels[batch.labelIn.label] = value;
        }

        return JSON.stringify(Object.entries(labels).sort());
      })
      .sort();
  }

  function keysOf(resources: Array<Record<string, string>>): Array<string> {
    return resources
      .map((labels: Record<string, string>): string => {
        return JSON.stringify(Object.entries(labels).sort());
      })
      .sort();
  }

  test("one resource is asked as before: each of its labels equal", () => {
    expect(plan([vm("1001")])).toEqual([
      { labels: vm("1001"), resources: [vm("1001")] },
    ]);
  });

  test("the VMs of one zone are one call: the labels they share as equal, the instance ids as one_of", () => {
    const batches: Array<GcpResourceBatch> = plan([
      vm("1003"),
      vm("1001"),
      vm("1002"),
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.labels).toEqual({
      project_id: PROJECT_ID,
      zone: "us-central1-a",
    });
    expect(batches[0]!.labelIn).toEqual({
      label: "instance_id",
      values: ["1001", "1002", "1003"],
    });
    expect(keysOf(batches[0]!.resources)).toEqual(
      keysOf([vm("1001"), vm("1002"), vm("1003")]),
    );
    expect(
      GcpMonitoring.buildFilter({
        metricType: UPTIME,
        resourceType: "gce_instance",
        resourceLabels: batches[0]!.labels,
        resourceLabelIn: batches[0]!.labelIn,
      }),
    ).toBe(
      `metric.type="${UPTIME}" AND resource.type="gce_instance" AND resource.labels.instance_id=one_of("1001","1002","1003") AND resource.labels.project_id="${PROJECT_ID}" AND resource.labels.zone="us-central1-a"`,
    );
  });

  test("250 VMs are three calls: one_of takes 100 values at most", () => {
    const vms: Array<Record<string, string>> = [];

    for (let index: number = 0; index < 250; index++) {
      vms.push(vm(String(100000 + index)));
    }

    const batches: Array<GcpResourceBatch> = plan(vms);

    expect(
      batches.map((batch: GcpResourceBatch): number => {
        return batch.labelIn?.values.length || 0;
      }),
    ).toEqual([GCP_MAX_ONE_OF_VALUES, GCP_MAX_ONE_OF_VALUES, 50]);
    expect(
      keysOf(
        batches.flatMap((batch: GcpResourceBatch) => {
          return batch.resources;
        }),
      ),
    ).toEqual(keysOf(vms));
  });

  test("long label values: a call holds no more than keeps its filter within a URL's length", () => {
    // Pub/Sub topic ids run to 255 characters.
    const topics: Array<Record<string, string>> = [];

    for (let index: number = 0; index < 60; index++) {
      topics.push({
        project_id: PROJECT_ID,
        topic_id: `orders-${String(index).padStart(3, "0")}-${"x".repeat(180)}`,
      });
    }

    const batches: Array<GcpResourceBatch> = plan(
      topics,
      "pubsub.googleapis.com/topic/byte_cost",
      "pubsub_topic",
    );

    expect(batches.length).toBeGreaterThan(1);

    for (const batch of batches) {
      expect(
        GcpMonitoring.getFilterUrlLength(
          GcpMonitoring.buildFilter({
            metricType: "pubsub.googleapis.com/topic/byte_cost",
            resourceType: "pubsub_topic",
            resourceLabels: batch.labels,
            resourceLabelIn: batch.labelIn,
          }),
        ),
      ).toBeLessThanOrEqual(GCP_MAX_FILTER_URL_LENGTH);
    }

    expect(
      keysOf(
        batches.flatMap((batch: GcpResourceBatch) => {
          return batch.resources;
        }),
      ),
    ).toEqual(keysOf(topics));
  });

  test("the same resource twice is asked once, and one whose labels a filter cannot quote is asked of none", () => {
    const batches: Array<GcpResourceBatch> = plan([
      vm("1001"),
      vm("1001"),
      vm('10"02'),
      { project_id: PROJECT_ID, "zone-name": "us-central1-a" },
      {},
      vm("1003"),
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.labelIn?.values).toEqual(["1001", "1003"]);
  });

  test("resources known by different labels are asked apart", () => {
    const database: Record<string, string> = {
      project_id: PROJECT_ID,
      database_id: `${PROJECT_ID}:orders`,
      region: "us-central1",
    };
    const batches: Array<GcpResourceBatch> = plan([
      vm("1001"),
      database,
      vm("1002"),
    ]);

    expect(batches.map(matchedBy).flat().sort()).toEqual(
      keysOf([vm("1001"), vm("1002"), database]),
    );
    expect(batches).toHaveLength(2);
  });

  test("containers of several clusters and namespaces: each call matches exactly its own, and every one is in a call", () => {
    const containers: Array<Record<string, string>> = [];

    for (const cluster of ["prod", "staging"]) {
      for (const namespace of ["web", "jobs"]) {
        for (const pod of ["api-0", "api-1", "api-2"]) {
          containers.push({
            project_id: PROJECT_ID,
            location: "us-central1",
            cluster_name: cluster,
            namespace_name: namespace,
            pod_name: pod,
            container_name: "app",
          });
        }
      }
    }

    // A pod name that is in every namespace: no call may match one it was not asked for.
    const batches: Array<GcpResourceBatch> = plan(
      containers,
      "kubernetes.io/container/restart_count",
      "k8s_container",
    );

    for (const batch of batches) {
      expect(matchedBy(batch)).toEqual(keysOf(batch.resources));
    }

    expect(
      keysOf(
        batches.flatMap((batch: GcpResourceBatch) => {
          return batch.resources;
        }),
      ),
    ).toEqual(keysOf(containers));
    // Four clusters-and-namespaces, a call each, not twelve.
    expect(batches).toHaveLength(4);
  });

  test("Cloud SQL databases of a project: one call, by database_id", () => {
    const databases: Array<Record<string, string>> = ["orders", "users"].map(
      (name: string): Record<string, string> => {
        return {
          project_id: PROJECT_ID,
          database_id: `${PROJECT_ID}:${name}`,
          region: "us-central1",
        };
      },
    );

    expect(plan(databases, SQL_BACKENDS, "cloudsql_database")).toEqual([
      {
        labels: { project_id: PROJECT_ID, region: "us-central1" },
        labelIn: {
          label: "database_id",
          values: [`${PROJECT_ID}:orders`, `${PROJECT_ID}:users`],
        },
        resources: databases,
      },
    ]);
  });

  test("a series is a batch's when it carries every label of one of its resources", () => {
    const resources: Array<Record<string, string>> = [vm("1001"), vm("1002")];

    expect(
      isGcpSeriesOfResources({ resourceLabels: vm("1001") }, resources),
    ).toBe(true);
    // Labels the resource was not known by do not matter.
    expect(
      isGcpSeriesOfResources(
        { resourceLabels: { ...vm("1002"), extra: "x" } },
        resources,
      ),
    ).toBe(true);
    expect(
      isGcpSeriesOfResources({ resourceLabels: vm("1003") }, resources),
    ).toBe(false);
    expect(
      isGcpSeriesOfResources(
        { resourceLabels: vm("1001", "europe-west1-b") },
        resources,
      ),
    ).toBe(false);
  });
});

/*
 * #9739's gap: a monitor the move left on a topic's publish operations -
 * one of a response code, which what replaces them does not have - keeps
 * them read until it is moved (RetiredCloudMetricReads): of its topic
 * alone, a series per response code, where they used to cost a series per
 * topic of every project that has topics.
 */
describe("a deprecated metric a monitor still reads", () => {
  const TOPIC: Record<string, string> = {
    "resource.gcp.resource_type": "pubsub_topic",
    "resource.project_id": PROJECT_ID,
    "resource.topic_id": "orders",
  };

  function asksFor(data: {
    attributes: unknown;
    projectId: string;
    seen: Array<string>;
  }): Array<{
    metricType: string;
    aligner: string;
    storedName: string;
    resourceType: string;
    resourceLabels: Record<string, string> | undefined;
  }> {
    return getGcpAddedMetricsToAsk({
      added: getRetiredCloudMetricReads([
        {
          metric: RetiredCloudMetric.PubSubPublishOperations,
          metricVariable: "a",
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          attributes: data.attributes,
        },
        // Another cloud's read is never Google Cloud's to ask.
        {
          metric: RetiredCloudMetric.CosmosServerSideLatency,
          metricVariable: "b",
          metricName: "azure_serversidelatency_average",
          attributes: {},
        },
      ]),
      projectId: data.projectId,
      seenResourceTypes: new Set<string>(data.seen),
    }).map((ask: GcpAddedMetricAsk) => {
      return {
        metricType: ask.metric.metricType,
        aligner: ask.metric.aligner,
        storedName: ask.metric.storedName,
        resourceType: ask.resourceType,
        resourceLabels: ask.resourceLabels,
      };
    });
  }

  test("is asked of its topic's project, narrowed to the topic, as a rate a second under its own name", () => {
    expect(
      asksFor({ attributes: TOPIC, projectId: PROJECT_ID, seen: [] }),
    ).toEqual([
      {
        metricType: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        aligner: "ALIGN_RATE",
        storedName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        resourceType: "pubsub_topic",
        resourceLabels: { project_id: PROJECT_ID, topic_id: "orders" },
      },
    ]);
    expect(
      asksFor({ attributes: TOPIC, projectId: OTHER_PROJECT, seen: [] }),
    ).toEqual([]);
  });

  test("of every topic of a project that has topics, for a monitor of every topic", () => {
    expect(
      asksFor({
        attributes: {},
        projectId: PROJECT_ID,
        seen: ["pubsub_topic"],
      }),
    ).toEqual([
      {
        metricType: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        aligner: "ALIGN_RATE",
        storedName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        resourceType: "pubsub_topic",
        resourceLabels: undefined,
      },
    ]);
    expect(
      asksFor({
        attributes: {},
        projectId: PROJECT_ID,
        seen: ["gce_instance"],
      }),
    ).toEqual([]);
  });
});
