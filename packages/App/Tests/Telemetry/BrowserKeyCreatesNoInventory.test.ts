/*
 * A COPIED BROWSER KEY CREATES NO HOST, CLUSTER, CLOUD RESOURCE OR DATABASE,
 * OVER EVERY PATH THAT TAKES ONE (issue #10539).
 *
 * A Browser ingestion key sits in a web page's JavaScript, so anyone can
 * copy it, and a script outside a browser sends any Origin header it likes:
 * the key's allowed origins stop a page, not a copy. What a copy sends used
 * to be filed by the resource attributes it chose, so a resource naming
 * `host.name`, `k8s.cluster.name`, `cloud.platform` or a database had its
 * telemetry filed under a host, a cluster, a cloud resource or a database,
 * and auto-discovery added them to the project.
 *
 * Every path a Browser key is accepted on is driven here end to end:
 *
 *   - OTLP/HTTP traces, logs and metrics, with a JSON body and with a
 *     protobuf body;
 *   - a Sentry browser SDK's envelope and store event, whose server_name
 *     Sentry's translation files as host.name.
 *
 * Each request is sent over real HTTP to the production routers, through
 * the ingest guard (the key's allowed origin, forged as a script would),
 * the body reader and the queue producer; the job it queues is then handed
 * to the production telemetry worker, which decodes the stored body and
 * applies the key's rules, as it does in production. What the worker hands
 * the ingest services is then asked of every auto-discovery OneUptime runs
 * on a resource - the same methods, for real, with every row id cached so
 * a discovery that matches resolves without a database: not one discovers
 * anything but the page's own browser RUM application, and none of it is a
 * backend Service. The forged resource, sent as it is, makes each of them
 * discover what it names, so the suite cannot pass by sending nothing.
 *
 * Session replay, the last surface a Browser key may use, carries no
 * resource at all: its chunks and events are filed under the RUM
 * application the request names, and only when that application already
 * exists (SessionReplayGateCache refuses an unknown one).
 *
 * What a span's or a datapoint's own attributes name is the discovery that
 * reads rows: RumClientRows (databases and queues) and
 * CloudMonitoredResourcesIngest (cloud resources a datapoint names) hold it
 * for a Browser key's rows.
 */

let capturedHandler: ((job: unknown) => Promise<void>) | null = null;

jest.mock("Common/Server/Infrastructure/QueueWorker", () => {
  return {
    __esModule: true,
    default: {
      getWorker: (
        _name: unknown,
        handler: (job: unknown) => Promise<void>,
      ): void => {
        capturedHandler = handler;
      },
    },
  };
});

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
  };
});

jest.mock(
  "isolated-vm",
  () => {
    const Isolate: jest.Mock = jest.fn();
    const Reference: jest.Mock = jest.fn();
    const Callback: jest.Mock = jest.fn();
    const ExternalCopy: jest.Mock = jest
      .fn()
      .mockImplementation((value: unknown) => {
        return {
          copyInto: jest.fn(() => {
            return value;
          }),
        };
      });

    return {
      __esModule: true,
      default: { Isolate, Reference, Callback, ExternalCopy },
      Isolate,
      Reference,
      Callback,
      ExternalCopy,
    };
  },
  { virtual: true },
);

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService imports it).
 * Nothing password-related is under test, so it is replaced WITH A FACTORY.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      markUsed: jest.fn(async () => {
        return undefined;
      }),
    },
  };
});

import path from "path";
import protobuf from "protobufjs";
// Importing the worker module registers its handler with the mocked QueueWorker.
import "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";
import OTelIngestAPI from "../../FeatureSet/Telemetry/API/OTelIngest";
import SentryAPI from "../../FeatureSet/Telemetry/API/Sentry";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import { TelemetryIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import {
  RouteResponse,
  RouteServer,
  send,
  startRouteServer,
} from "./Compatible/CompatibleIngestRouteHarness";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import logger from "Common/Server/Utils/Logger";
import TelemetryIngestionBudget from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  COMPATIBLE_INGEST_URL_PREFIX,
  SENTRY_BASE_PATH,
} from "Common/Types/Telemetry/CompatibleIngest";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import {
  RUM_CLIENT_KIND_BROWSER,
  RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
} from "Common/Types/Rum/RumClientKind";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

const BROWSER_KEY: string = "10539a00-7d4e-4b8a-a1c2-3e4f5a6b7c8d";
const SHOP_ORIGIN: string = "https://shop.example.com";
const PROJECT_ID: string = "10539b00-0000-4000-8000-000000000001";
// What a discovery that matches resolves to: every row id is cached.
const RESOURCE_ID: string = "55555555-5555-4555-8555-555555555555";
const FENCE_NAMESPACE: string = "otel-maintenance-fence";

const TIME_UNIX_NANO: string = "1758800000123456789";
const END_TIME_UNIX_NANO: string = "1758800000623456789";

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
  "OTel",
  "v1",
);

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

/*
 * What each auto-discovery a resource is asked about finds from, as
 * AutoDiscoverSpans pins them: one forged resource carries all of it.
 */
const DISCOVERY_TRIGGERS: Array<{ method: string; attributes: JSONArray }> = [
  {
    method: "autoDiscoverKubernetesCluster",
    attributes: [stringAttribute("k8s.cluster.name", "prod-east")],
  },
  {
    method: "autoDiscoverProxmoxCluster",
    attributes: [stringAttribute("proxmox.cluster.name", "pve-1")],
  },
  {
    method: "autoDiscoverVMwareVCenter",
    attributes: [stringAttribute("vmware.vcenter.name", "vcsa-prod")],
  },
  {
    method: "autoDiscoverIoTFleet",
    attributes: [stringAttribute("iot.fleet.name", "sensors-eu")],
  },
  {
    method: "autoDiscoverDockerSwarmCluster",
    attributes: [stringAttribute("docker.swarm.cluster.name", "swarm-1")],
  },
  {
    method: "autoDiscoverCephCluster",
    attributes: [stringAttribute("ceph.cluster.name", "ceph-1")],
  },
  {
    method: "autoDiscoverStorageArray",
    attributes: [stringAttribute("storage.array.name", "pure-prod-01")],
  },
  {
    method: "autoDiscoverServerless",
    attributes: [stringAttribute("faas.name", "checkout-handler")],
  },
  {
    method: "autoDiscoverCloudResource",
    attributes: [
      stringAttribute("cloud.platform", "aws_ecs"),
      stringAttribute("service.name", "payments-api"),
    ],
  },
  {
    method: "autoDiscoverDatabaseServer",
    attributes: [
      stringAttribute("db.system.name", "postgresql"),
      stringAttribute("server.address", "orders-db.example.com"),
    ],
  },
  {
    method: "autoDiscoverDockerHost",
    attributes: [
      stringAttribute("container.runtime", "docker"),
      stringAttribute("host.name", "docker-host-1"),
    ],
  },
  {
    method: "autoDiscoverPodmanHost",
    attributes: [
      stringAttribute("container.runtime", "podman"),
      stringAttribute("host.name", "podman-host-1"),
    ],
  },
  {
    method: "autoDiscoverHost",
    attributes: [
      stringAttribute("host.name", "vm-1"),
      stringAttribute("os.type", "linux"),
    ],
  },
];

// Every discovery but the RUM application's.
const INVENTORY_DISCOVERIES: Array<string> = DISCOVERY_TRIGGERS.map(
  (trigger: { method: string }): string => {
    return trigger.method;
  },
);

// What a copy sends: a page's own attributes, and every forged identity.
const FORGED_RESOURCE_ATTRIBUTES: JSONArray = [
  stringAttribute("service.name", "payments-api"),
  stringAttribute("browser.language", "en-US"),
  stringAttribute("user_agent.original", "Mozilla/5.0"),
  ...DISCOVERY_TRIGGERS.flatMap(
    (trigger: { attributes: JSONArray }): JSONArray => {
      return trigger.attributes.filter((attribute: unknown): boolean => {
        return (attribute as JSONObject)["key"] !== "service.name";
      });
    },
  ),
  stringAttribute("cloud.resource_id", "arn:aws:rds:us-east-1:1:db:orders"),
  stringAttribute("oneuptime.database.server.id", RESOURCE_ID),
];

// Values that must never reach a resource the ingest services read.
const FORGED_VALUES: Array<string> = [
  "prod-east",
  "pve-1",
  "vcsa-prod",
  "sensors-eu",
  "swarm-1",
  "ceph-1",
  "pure-prod-01",
  "checkout-handler",
  "aws_ecs",
  "orders-db.example.com",
  "docker-host-1",
  "podman-host-1",
  "vm-1",
  "arn:aws:rds",
];

const RESOURCE: JSONObject = { attributes: FORGED_RESOURCE_ATTRIBUTES };

interface OtlpSignal {
  name: "traces" | "logs" | "metrics";
  protoFile: string;
  requestTypeName: string;
  containerKey: string;
  payload: JSONObject;
  processed: () => jest.SpyInstance;
}

let tracesSpy: jest.SpyInstance;
let logsSpy: jest.SpyInstance;
let metricsSpy: jest.SpyInstance;

const SIGNALS: Array<OtlpSignal> = [
  {
    name: "traces",
    protoFile: "trace_service.proto",
    requestTypeName:
      "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
    containerKey: "resourceSpans",
    payload: {
      resourceSpans: [
        {
          resource: RESOURCE,
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "W6jl5bW3/U0gq9xiQwq6Bw==",
                  spanId: "Hv3qsIK2yh0=",
                  name: "GET /checkout",
                  kind: 3,
                  startTimeUnixNano: TIME_UNIX_NANO,
                  endTimeUnixNano: END_TIME_UNIX_NANO,
                },
              ],
            },
          ],
        },
      ],
    },
    processed: (): jest.SpyInstance => {
      return tracesSpy;
    },
  },
  {
    name: "logs",
    protoFile: "logs_service.proto",
    requestTypeName:
      "opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest",
    containerKey: "resourceLogs",
    payload: {
      resourceLogs: [
        {
          resource: RESOURCE,
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: TIME_UNIX_NANO,
                  severityText: "INFO",
                  body: { stringValue: "checkout complete" },
                },
              ],
            },
          ],
        },
      ],
    },
    processed: (): jest.SpyInstance => {
      return logsSpy;
    },
  },
  {
    name: "metrics",
    protoFile: "metrics_service.proto",
    requestTypeName:
      "opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest",
    containerKey: "resourceMetrics",
    payload: {
      resourceMetrics: [
        {
          resource: RESOURCE,
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "checkout.duration",
                  gauge: {
                    dataPoints: [
                      { timeUnixNano: TIME_UNIX_NANO, asDouble: 0.25 },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    processed: (): jest.SpyInstance => {
      return metricsSpy;
    },
  },
];

function encodeProtobuf(signal: OtlpSignal): Buffer {
  const type: protobuf.Type = protobuf
    .loadSync(path.join(PROTO_DIR, signal.protoFile))
    .lookupType(signal.requestTypeName);

  return Buffer.from(type.encode(type.fromObject(signal.payload)).finish());
}

let server: RouteServer;
const storedBodies: Map<string, Buffer> = new Map<string, Buffer>();

function browserPolicy(): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: new ObjectID("10539b00-0000-4000-8000-000000000002"),
    projectId: new ObjectID(PROJECT_ID),
    keyType: TelemetryIngestionKeyType.Browser,
    allowedOrigins: [SHOP_ORIGIN],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
  };
}

// The jobs the routes queued, as the worker is handed them.
function queuedJobs(): Array<TelemetryIngestJobData> {
  return (Queue.addJob as unknown as jest.Mock).mock.calls.map(
    (call: Array<unknown>): TelemetryIngestJobData => {
      return call[3] as TelemetryIngestJobData;
    },
  );
}

// Run one queued job through the production worker; what it hands on.
async function runWorker(
  jobData: TelemetryIngestJobData,
  processed: jest.SpyInstance,
): Promise<JSONObject> {
  expect(typeof capturedHandler).toBe("function");

  processed.mockClear();

  await capturedHandler!({
    id: `${jobData.type}-${PROJECT_ID}-1-abc`,
    name: "ProcessTelemetry",
    data: JSON.parse(JSON.stringify(jobData)),
  });

  expect(processed).toHaveBeenCalledTimes(1);

  return (processed.mock.calls[0]![0] as { body: JSONObject }).body;
}

function resourcesOf(body: JSONObject, containerKey: string): Array<JSONArray> {
  return ((body[containerKey] as Array<JSONObject>) || []).map(
    (block: JSONObject): JSONArray => {
      return ((block["resource"] as JSONObject)["attributes"] ||
        []) as JSONArray;
    },
  );
}

// Every discovery a resource is asked about, for real: what each found.
async function discover(
  attributes: JSONArray,
): Promise<Record<string, string | null>> {
  const found: Record<string, string | null> = {};

  for (const method of [...INVENTORY_DISCOVERIES, "autoDiscoverRum"]) {
    const result: unknown = await baseService[method]({
      projectId: new ObjectID(PROJECT_ID),
      attributes: attributes,
    });
    found[method] = result ? String(result) : null;
  }

  return found;
}

async function expectOnlyTheBrowserApp(attributes: JSONArray): Promise<void> {
  const keys: Array<string> = attributes.map((attribute: unknown): string => {
    return (attribute as JSONObject)["key"] as string;
  });

  for (const value of FORGED_VALUES) {
    expect({ value, kept: JSON.stringify(attributes).includes(value) }).toEqual(
      { value, kept: false },
    );
  }
  expect(keys).toContain(RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE);
  expect(baseService["getRumClientType"](attributes)).toBe(
    RUM_CLIENT_KIND_BROWSER,
  );
  // Never a backend Service, whatever service.name it names.
  await expect(
    baseService["getServiceNameFromAttributes"]({ headers: {} }, attributes),
  ).resolves.toBeNull();

  const found: Record<string, string | null> = await discover(attributes);

  for (const method of INVENTORY_DISCOVERIES) {
    expect({ method, discovered: found[method] }).toEqual({
      method,
      discovered: null,
    });
  }
  // The page's own browser RUM application is all it is filed under.
  expect(found["autoDiscoverRum"]).toBe(RESOURCE_ID);
}

beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  // The App's global body parsers, as production mounts the routers behind them.
  expect(typeof expressErrorHandler).toBe("function");

  server = await startRouteServer([OTelIngestAPI, SentryAPI]);
});

afterAll(async () => {
  await server.close();
  jest.restoreAllMocks();
});

beforeEach(() => {
  storedBodies.clear();
  (Queue.addJob as unknown as jest.Mock).mockReset().mockResolvedValue({});
  OtelIngestBaseService.clearInProcessMemos();

  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as jest.Mock
  ).mockResolvedValue(browserPolicy() as never);

  jest.spyOn(TelemetryIngestionKeyRateLimiter, "consume").mockResolvedValue({
    outcome: TelemetryIngestionKeyLimitOutcome.Allowed,
  } as never);
  jest
    .spyOn(TelemetryIngestionBudget, "admit")
    .mockResolvedValue({ refusal: null, charge: null } as never);
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation((): void => {});

  // Redis's part, in memory: what the routes stored is what the worker reads.
  jest
    .spyOn(TelemetryBodyStore, "storeBody")
    .mockImplementation(async (buffer: Buffer): Promise<string> => {
      const key: string = `telemetry:body:${ObjectID.generate().toString()}`;
      storedBodies.set(key, Buffer.from(buffer));
      return key;
    });
  jest
    .spyOn(TelemetryBodyStore, "readBody")
    .mockImplementation(async (key: string): Promise<Buffer | null> => {
      return storedBodies.get(key) || null;
    });
  jest
    .spyOn(TelemetryBodyStore, "deleteBody")
    .mockResolvedValue(undefined as never);

  tracesSpy = jest
    .spyOn(OtelTracesIngestService, "processTracesFromQueue")
    .mockResolvedValue(undefined as never);
  logsSpy = jest
    .spyOn(OtelLogsIngestService, "processLogsFromQueue")
    .mockResolvedValue(undefined as never);
  metricsSpy = jest
    .spyOn(OtelMetricsIngestService, "processMetricsFromQueue")
    .mockResolvedValue(undefined as never);

  // Every row id is cached, and every maintenance fence is another worker's.
  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string): Promise<string | null> => {
      return namespace === FENCE_NAMESPACE ? null : RESOURCE_ID;
    });
  jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
  jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(false);
  jest.spyOn(IoTFleetService, "findOneById").mockResolvedValue(null);
});

afterEach(() => {
  for (const spy of [
    TelemetryIngestionKeyRateLimiter.consume,
    TelemetryIngestionBudget.admit,
    TelemetryIngestRefusalRecorder.record,
    TelemetryBodyStore.storeBody,
    TelemetryBodyStore.readBody,
    TelemetryBodyStore.deleteBody,
    OtelTracesIngestService.processTracesFromQueue,
    OtelLogsIngestService.processLogsFromQueue,
    OtelMetricsIngestService.processMetricsFromQueue,
    GlobalCache.getString,
    GlobalCache.setString,
    GlobalCache.setStringIfNotExists,
    IoTFleetService.findOneById,
  ]) {
    const mocked: jest.MockInstance<
      unknown,
      Array<unknown>
    > = spy as unknown as jest.MockInstance<unknown, Array<unknown>>;
    if (typeof mocked.mockRestore === "function") {
      mocked.mockRestore();
    }
  }
});

describe("the forged resource, as a copy sends it, names inventory to every discovery", () => {
  test("each discovery finds what it names in the resource as sent", async () => {
    for (const trigger of DISCOVERY_TRIGGERS) {
      const result: unknown = await baseService[trigger.method]({
        projectId: new ObjectID(PROJECT_ID),
        attributes: trigger.attributes,
      });

      expect({ method: trigger.method, discovered: String(result) }).toEqual({
        method: trigger.method,
        discovered: RESOURCE_ID,
      });
    }
  });
});

describe.each([
  ["JSON", "application/json"],
  ["protobuf", "application/x-protobuf"],
])(
  "OTLP/HTTP with a %s body, sent with a copied Browser key",
  (format: string, contentType: string) => {
    test.each(SIGNALS)(
      "$name: the job says a Browser key sent it, and the worker files nothing but the page's browser RUM",
      async (signal: OtlpSignal) => {
        const response: RouteResponse = await send(
          `${server.url}/otlp/v1/${signal.name}`,
          {
            headers: {
              "content-type": contentType,
              "x-oneuptime-token": BROWSER_KEY,
              // A script sends any Origin it likes: the key's own.
              origin: SHOP_ORIGIN,
            },
            body:
              format === "JSON"
                ? JSON.stringify(signal.payload)
                : encodeProtobuf(signal),
          },
        );

        expect(response.status).toBe(200);

        const jobs: Array<TelemetryIngestJobData> = queuedJobs();
        expect(jobs).toHaveLength(1);
        expect(jobs[0]!.isBrowserKey).toBe(true);

        // The forged identities did arrive, stored as they were sent...
        const stored: string = Array.from(storedBodies.values())
          .map((buffer: Buffer): string => {
            return buffer.toString("latin1");
          })
          .join("");
        expect(stored).toContain("prod-east");

        // ...and the worker hands on none of them.
        const body: JSONObject = await runWorker(jobs[0]!, signal.processed());
        const resources: Array<JSONArray> = resourcesOf(
          body,
          signal.containerKey,
        );

        expect(resources).toHaveLength(1);
        await expectOnlyTheBrowserApp(resources[0]!);
      },
    );
  },
);

describe("a Sentry browser SDK's report, sent with a copied Browser key", () => {
  const EVENT_ID: string = "fc6d8c0c43fc4630ad850ee518f1b9d0";

  // A browser SDK's error, with a server name a copy made up.
  const FORGED_EVENT: JSONObject = {
    event_id: EVENT_ID,
    timestamp: 1700000000.5,
    platform: "javascript",
    level: "error",
    release: "payments-api@2.0.0",
    environment: "production",
    server_name: "vm-1",
    exception: {
      values: [{ type: "TypeError", value: "x is undefined" }],
    },
  };

  const sentryUrl: (endpoint: string) => string = (
    endpoint: string,
  ): string => {
    return `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${SENTRY_BASE_PATH}/api/1/${endpoint}/?sentry_key=${BROWSER_KEY.replace(/-/g, "")}&sentry_version=7&sentry_client=sentry.javascript.browser%2F8.40.0`;
  };

  test.each([
    [
      "an envelope",
      "envelope",
      `${[
        JSON.stringify({ event_id: EVENT_ID, sent_at: "2023-11-14T22:13:20Z" }),
        JSON.stringify({ type: "event" }),
        JSON.stringify(FORGED_EVENT),
      ].join("\n")}\n`,
    ],
    ["a store event", "store", JSON.stringify(FORGED_EVENT)],
  ])(
    "%s: its server_name names no host, and it is filed as the page's browser RUM",
    async (_name: string, endpoint: string, body: string) => {
      const response: RouteResponse = await send(sentryUrl(endpoint), {
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          origin: SHOP_ORIGIN,
        },
        body: body,
      });

      expect(response.status).toBe(200);

      const jobs: Array<TelemetryIngestJobData> = queuedJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.isBrowserKey).toBe(true);

      // Sentry's translation filed server_name as host.name...
      expect(
        Array.from(storedBodies.values())
          .map((buffer: Buffer): string => {
            return buffer.toString("utf8");
          })
          .join(""),
      ).toContain('"host.name"');

      // ...and the worker hands on no host.
      const handedOn: JSONObject = await runWorker(jobs[0]!, tracesSpy);
      const resources: Array<JSONArray> = resourcesOf(
        handedOn,
        "resourceSpans",
      );

      expect(resources.length).toBeGreaterThan(0);
      for (const resource of resources) {
        expect(JSON.stringify(resource)).not.toContain("host.name");
        await expectOnlyTheBrowserApp(resource);
      }
    },
  );
});
