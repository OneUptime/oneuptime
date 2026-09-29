/*
 * GH#4037: "Cannot configure .NET SDK for Continuous Profiling setup".
 *
 * pyroscope-dotnet uploads were accepted and then lost, with no error on
 * either side. Every SDK generation hit a different wall:
 *
 *   - v0.13 and older post multipart /ingest with from/until in
 *     MILLISECONDS and a pprof carrying no time_nanos. OneUptime read them
 *     as seconds: the profile started in the year 58000, its timestamps
 *     were written as "1.7e+21", and ClickHouse rejected the rows at
 *     async-insert flush - after the SDK had been answered 200.
 *   - v0.14+ post a push.v1 PushRequest as Content-Type application/proto,
 *     which the global body parser never read: every push got a 400.
 *   - once parsed, the push handler named the service after `__name__`,
 *     which is the PROFILE TYPE (process_cpu, wall, memory, ...).
 *   - v1.5+ dropped PYROSCOPE_AUTH_TOKEN for Basic auth, which was
 *     answered 401 "missing ingestion token".
 *   - Alloy (a Connect client) needs an application/proto success body, or
 *     it retries - and re-ingests - every accepted push up to ten times.
 *
 * These tests post byte-shaped SDK requests over a real socket through the
 * real global body parsers (StartServer), the real Pyroscope router and the
 * real TelemetryIngest auth, then run the enqueued job through the real
 * profiles worker down to the ClickHouse rows it would write. Only the key
 * lookup, the queue, entity discovery and the fan-in writer are stubbed.
 */

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
    },
  };
});

interface MockCapturedJob {
  body: JSONObject;
  projectId: ObjectID;
  productType: ProductType;
}

const mockCapturedJobs: Array<MockCapturedJob> = [];

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addProfileIngestJob: jest.fn(
          async (req: {
            body: JSONObject;
            projectId: ObjectID;
            productType: ProductType;
          }): Promise<void> => {
            mockCapturedJobs.push({
              body: JSON.parse(JSON.stringify(req.body)) as JSONObject,
              projectId: req.projectId,
              productType: req.productType,
            });
          },
        ),
      },
    };
  },
);

import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import PyroscopeAPI from "../../FeatureSet/Telemetry/API/Pyroscope";
import OtelProfilesIngestService from "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import ProfileService from "Common/Server/Services/ProfileService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import protobuf from "protobufjs";
import zlib from "zlib";

/*
 * ---------------------------------------------------------------------------
 * Keys and projects
 * ---------------------------------------------------------------------------
 */

const KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_KEY: string = "3f1d4b8e-2a6c-4e0f-9b7d-5c8a1e2f3d4b";
const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

function policyFor(projectId: ObjectID): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: ObjectID.generate(),
    projectId: projectId,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Time: a fixed, 15s-aligned window in the past, like the .NET SDK sends.
 * 1790208000 s = 2026-09-24T00:00:00Z.
 * ---------------------------------------------------------------------------
 */

const WINDOW_START_SECONDS: number = 1_790_208_000;
const WINDOW_START_MS: number = WINDOW_START_SECONDS * 1000;
const WINDOW_END_MS: number = WINDOW_START_MS + 15_000;
const WINDOW_START_NANO: string = "1790208000000000000";
const WINDOW_END_NANO: string = "1790208015000000000";
const WINDOW_START_CLICKHOUSE: string = "2026-09-24 00:00:00";
const WINDOW_END_CLICKHOUSE: string = "2026-09-24 00:00:15";

/*
 * ---------------------------------------------------------------------------
 * pprof, built the way pyroscope-dotnet's PprofBuilder builds it
 * ---------------------------------------------------------------------------
 */

const PprofRoot: protobuf.Root = protobuf.loadSync(
  path.resolve(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Telemetry",
    "ProtoFiles",
    "pprof",
    "profile.proto",
  ),
);
const PprofProfile: protobuf.Type = PprofRoot.lookupType(
  "perftools.profiles.Profile",
);

const PushRoot: protobuf.Root = protobuf.loadSync(
  path.resolve(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Telemetry",
    "ProtoFiles",
    "pyroscope",
    "push.proto",
  ),
);
const PushRequestType: protobuf.Type = PushRoot.lookupType(
  "push.v1.PushRequest",
);

interface DotnetFrame {
  module: string;
  frame: string;
}

interface DotnetSample {
  // Leaf first, as pprof stores it.
  stack: Array<DotnetFrame>;
  values: Array<number>;
  labels?: Dictionary<string>;
}

const REQUEST_STACK: Array<DotnetFrame> = [
  { module: "App", frame: "App.Services!PricingService.Compute" },
  { module: "App", frame: "App.Controllers!OrdersController.Get" },
  {
    module: "Microsoft.AspNetCore.Server.Kestrel.Core",
    frame:
      "Microsoft.AspNetCore.Server.Kestrel.Core.Internal.Http!HttpProtocol.ProcessRequests",
  },
  {
    module: "System.Private.CoreLib",
    frame: "System.Threading!Thread.StartCallback",
  },
];

const SERIALIZER_STACK: Array<DotnetFrame> = [
  {
    module: "System.Text.Json",
    frame: "System.Text.Json!JsonSerializer.Serialize",
  },
  {
    module: "System.Private.CoreLib",
    frame: "System.Threading!PortableThreadPool+WorkerThread.WorkerThreadStart",
  },
  {
    module: "System.Private.CoreLib",
    frame: "System.Threading!Thread.StartCallback",
  },
];

/* Default .NET configuration: CPU only, ~10ms per sample. */
function cpuSamples(count: number): Array<DotnetSample> {
  const samples: Array<DotnetSample> = [];

  for (let i: number = 0; i < count; i++) {
    samples.push({
      stack: i % 2 === 0 ? REQUEST_STACK : SERIALIZER_STACK,
      values: [10_000_000],
      labels: {
        "thread id": `<0> [#${1000 + (i % 3)}]`,
        "thread name": ".NET TP Worker",
        "appdomain name": "clrhost",
      },
    });
  }

  return samples;
}

function buildDotnetPprof(data: {
  sampleTypes: Array<{ name: string; unit: string }>;
  samples: Array<DotnetSample>;
  timeNanos?: number;
  durationNanos?: number;
}): Buffer {
  const stringTable: Array<string> = [];
  const stringIndex: Map<string, number> = new Map<string, number>();

  const addString: (value: string) => number = (value: string): number => {
    const existing: number | undefined = stringIndex.get(value);
    if (existing !== undefined) {
      return existing;
    }
    stringTable.push(value);
    stringIndex.set(value, stringTable.length - 1);
    return stringTable.length - 1;
  };

  const functions: Array<JSONObject> = [];
  const locations: Array<JSONObject> = [];
  const locationIdByFrame: Map<string, number> = new Map<string, number>();

  // PprofBuilder::AddLocation - function.id == location.id, module as filename.
  const addLocation: (frame: DotnetFrame) => number = (
    frame: DotnetFrame,
  ): number => {
    const moduleIndex: number = addString(frame.module);
    const nameIndex: number = addString(frame.frame);
    const key: string = `${moduleIndex}:${nameIndex}`;
    const existing: number | undefined = locationIdByFrame.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const id: number = locations.length + 1;
    functions.push({ id: id, name: nameIndex, filename: moduleIndex });
    locations.push({ id: id, line: [{ functionId: id }] });
    locationIdByFrame.set(key, id);
    return id;
  };

  // PprofBuilder::Reset - "" first, then unit before type per sample type.
  addString("");
  const sampleType: Array<JSONObject> = data.sampleTypes.map(
    (definition: { name: string; unit: string }): JSONObject => {
      const unit: number = addString(definition.unit);
      const type: number = addString(definition.name);
      return { type: type, unit: unit };
    },
  );
  const periodType: JSONObject = {
    type: addString("cpu"),
    unit: addString("nanoseconds"),
  };

  const sample: Array<JSONObject> = data.samples.map(
    (entry: DotnetSample): JSONObject => {
      return {
        locationId: entry.stack.map(addLocation),
        value: entry.values,
        label: Object.keys(entry.labels || {}).map((key: string) => {
          return {
            key: addString(key),
            str: addString(entry.labels![key]!),
          };
        }),
      };
    },
  );

  const message: JSONObject = {
    sampleType: sampleType,
    sample: sample,
    location: locations,
    function: functions,
    stringTable: stringTable,
    period: 1,
    periodType: periodType,
  };

  if (data.timeNanos) {
    message["timeNanos"] = data.timeNanos;
  }
  if (data.durationNanos) {
    message["durationNanos"] = data.durationNanos;
  }

  return Buffer.from(
    PprofProfile.encode(PprofProfile.fromObject(message)).finish(),
  );
}

function defaultDotnetCpuPprof(): Buffer {
  return buildDotnetPprof({
    sampleTypes: [{ name: "cpu", unit: "nanoseconds" }],
    samples: cpuSamples(40),
  });
}

/*
 * ---------------------------------------------------------------------------
 * pyroscope-dotnet <= 0.13: multipart /ingest, exactly as cpp-httplib frames it
 * ---------------------------------------------------------------------------
 */

/* CxxUrl's query encoding: `{` and `}` are escaped, `=` and `,` are not. */
function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%3D/g, "=").replace(/%2C/g, ",");
}

const SAMPLE_TYPE_CONFIG: string = JSON.stringify(
  {
    alloc_samples: { units: "objects", "display-name": "alloc_objects" },
    alloc_size: { units: "bytes", "display-name": "alloc_space" },
    cpu: { units: "samples", sampled: true },
    wall: { units: "samples", sampled: true },
  },
  null,
  2,
);

interface HttpRequestSpec {
  urlPath: string;
  headers: Dictionary<string>;
  body: Buffer;
}

function legacyIngestRequest(data: {
  pprof: Buffer;
  from: string;
  until: string;
  authorization?: string;
  appName?: string;
  staticTags?: Array<[string, string]>;
  prefix?: string;
}): HttpRequestSpec {
  const appNameWithLabels: string = `${data.appName || "app-name"}{${(
    data.staticTags || []
  )
    .map(([key, value]: [string, string]) => {
      return `${key}=${value}`;
    })
    .join(",")}}`;

  const query: string = [
    ["name", appNameWithLabels],
    ["from", data.from],
    ["until", data.until],
    ["spyName", "dotnetspy"],
    ["spyVersion", "0.13.0"],
  ]
    .map(([key, value]: Array<string>) => {
      return `${key}=${encodeQueryValue(value!)}`;
    })
    .join("&");

  const boundary: string = "--cpp-httplib-multipart-data-AbCdEfGh12345678";
  const parts: Array<{ name: string; filename: string; content: Buffer }> = [
    { name: "profile", filename: "profile.pprof", content: data.pprof },
    {
      name: "sample_type_config",
      filename: "sample_type_config.json",
      content: Buffer.from(SAMPLE_TYPE_CONFIG),
    },
  ];

  const chunks: Array<Buffer> = [];
  for (const part of parts) {
    // No part Content-Type: the SDK never sets one.
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n\r\n`,
      ),
      part.content,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  const headers: Dictionary<string> = {
    Accept: "*/*",
    "User-Agent": "cpp-httplib/0.14.0",
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  };

  if (data.authorization) {
    headers["Authorization"] = data.authorization;
  }

  return {
    urlPath: `${data.prefix || ""}/pyroscope/ingest?${query}`,
    headers: headers,
    body: Buffer.concat(chunks),
  };
}

/*
 * ---------------------------------------------------------------------------
 * push.v1: pyroscope-dotnet 0.14+, Grafana Alloy, pyroscope-rs
 * ---------------------------------------------------------------------------
 */

type Labels = Array<[string, string]>;

/* PyroscopePprofSink::upload's label order (0.15+ / 1.x). */
function dotnetPushLabels(profileType: string): Labels {
  return [
    ["__name__", profileType],
    ["service_name", "app-name"],
    ["spy_name", "dotnetspy"],
    ["otel.scope.name", "com.grafana.pyroscope/dotnet"],
    ["otel.scope.version", "1.5.1"],
    ["process.runtime.name", ".NET"],
    ["process.runtime.version", "10.0.0"],
    ["env", "e2e"],
  ];
}

function encodePush(series: Array<{ labels: Labels; pprof: Buffer }>): Buffer {
  return Buffer.from(
    PushRequestType.encode(
      PushRequestType.create({
        series: series.map((entry: { labels: Labels; pprof: Buffer }) => {
          return {
            labels: entry.labels.map(([name, value]: [string, string]) => {
              return { name: name, value: value };
            }),
            samples: [{ rawProfile: entry.pprof }],
          };
        }),
      }),
    ).finish(),
  );
}

function recentPprof(): Buffer {
  const nowNanos: number = Date.now() * 1_000_000;

  return buildDotnetPprof({
    sampleTypes: [
      { name: "cpu", unit: "nanoseconds" },
      { name: "cpu_samples", unit: "count" },
    ],
    samples: cpuSamples(10).map((sample: DotnetSample) => {
      return { ...sample, values: [10_000_000, 1] };
    }),
    timeNanos: nowNanos - 15_000_000_000,
    durationNanos: 15_000_000_000,
  });
}

const PUSH_PATH: string = "/pyroscope/push.v1.PusherService/Push";

/*
 * ---------------------------------------------------------------------------
 * HTTP plumbing
 * ---------------------------------------------------------------------------
 */

let server: http.Server;
let port: number;

interface HttpResult {
  status: number;
  contentType: string | undefined;
  body: Buffer;
}

function send(request: HttpRequestSpec): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (value: HttpResult) => void, reject: (err: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          method: "POST",
          path: request.urlPath,
          headers: {
            ...request.headers,
            "Content-Length": String(request.body.length),
          },
        },
        (res: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          res.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on("end", () => {
            resolve({
              status: res.statusCode || 0,
              contentType: res.headers["content-type"],
              body: Buffer.concat(chunks),
            });
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.end(request.body);
    },
  );
}

function push(
  body: Buffer,
  headers: Dictionary<string>,
  prefix: string = "",
): Promise<HttpResult> {
  return send({ urlPath: `${prefix}${PUSH_PATH}`, headers: headers, body });
}

/*
 * ---------------------------------------------------------------------------
 * Reading the enqueued OTLP body
 * ---------------------------------------------------------------------------
 */

function resourceProfilesOf(job: MockCapturedJob): JSONArray {
  return job.body["resourceProfiles"] as JSONArray;
}

function serviceNameOf(resourceProfile: JSONObject): string {
  const attributes: JSONArray = (resourceProfile["resource"] as JSONObject)[
    "attributes"
  ] as JSONArray;
  const serviceName: JSONObject | undefined = (
    attributes as Array<JSONObject>
  ).find((attribute: JSONObject) => {
    return attribute["key"] === "service.name";
  });
  return (serviceName!["value"] as JSONObject)["stringValue"] as string;
}

function firstProfileOf(job: MockCapturedJob): JSONObject {
  const scopeProfiles: JSONArray = (resourceProfilesOf(job)[0] as JSONObject)[
    "scopeProfiles"
  ] as JSONArray;
  return (
    (scopeProfiles[0] as JSONObject)["profiles"] as JSONArray
  )[0] as JSONObject;
}

function onlyJob(): MockCapturedJob {
  expect(mockCapturedJobs).toHaveLength(1);
  return mockCapturedJobs[0]!;
}

/*
 * ---------------------------------------------------------------------------
 * Running the real profiles worker down to row construction
 * ---------------------------------------------------------------------------
 */

interface WorkerRows {
  profiles: Array<JSONObject>;
  samples: Array<JSONObject>;
}

let capturedRows: WorkerRows = { profiles: [], samples: [] };

type AnyAsyncFunction = (...args: Array<unknown>) => Promise<unknown>;

async function runWorker(job: MockCapturedJob): Promise<WorkerRows> {
  capturedRows = { profiles: [], samples: [] };

  await OtelProfilesIngestService.processProfilesFromQueue({
    body: job.body,
    projectId: job.projectId,
    productType: job.productType,
    headers: {},
  } as unknown as TelemetryRequest);

  return capturedRows;
}

/*
 * Every nanosecond value must be a plain integer string: UInt64 and
 * DateTime64 columns reject "1.790208e+21", and they reject it at async
 * insert flush, where nobody hears about it.
 */
const INTEGER_STRING: RegExp = /^\d+$/;
const CLICKHOUSE_DATETIME: RegExp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function expectIntegerNanoStrings(job: MockCapturedJob): void {
  for (const resourceProfile of resourceProfilesOf(job) as Array<JSONObject>) {
    for (const scopeProfile of resourceProfile[
      "scopeProfiles"
    ] as Array<JSONObject>) {
      for (const profile of scopeProfile["profiles"] as Array<JSONObject>) {
        expect(profile["startTimeUnixNano"]).toMatch(INTEGER_STRING);
        expect(profile["endTimeUnixNano"]).toMatch(INTEGER_STRING);

        for (const sample of (profile["profile"] as JSONObject)[
          "sample"
        ] as Array<JSONObject>) {
          for (const timestamp of sample[
            "timestampsUnixNano"
          ] as Array<string>) {
            expect(timestamp).toMatch(INTEGER_STRING);
          }
        }
      }
    }
  }
}

function expectStorableRows(rows: WorkerRows): void {
  for (const profileRow of rows.profiles) {
    expect(profileRow["startTimeUnixNano"]).toMatch(INTEGER_STRING);
    expect(profileRow["endTimeUnixNano"]).toMatch(INTEGER_STRING);
    expect(profileRow["durationNano"]).toMatch(INTEGER_STRING);
    expect(profileRow["startTime"]).toMatch(CLICKHOUSE_DATETIME);
    expect(profileRow["endTime"]).toMatch(CLICKHOUSE_DATETIME);
  }

  for (const sampleRow of rows.samples) {
    expect(sampleRow["timeUnixNano"]).toMatch(INTEGER_STRING);
    expect(sampleRow["time"]).toMatch(CLICKHOUSE_DATETIME);
    expect(sampleRow["value"]).toMatch(INTEGER_STRING);
  }
}

/*
 * ---------------------------------------------------------------------------
 * Setup
 * ---------------------------------------------------------------------------
 */

beforeAll(async () => {
  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockImplementation(
      async (
        secretKey: string,
      ): Promise<TelemetryIngestionKeyPolicy | null> => {
        if (secretKey === KEY) {
          return policyFor(PROJECT_ID);
        }
        if (secretKey === OTHER_KEY) {
          return policyFor(OTHER_PROJECT_ID);
        }
        return null;
      },
    );
  jest
    .spyOn(TelemetryIngestionKeyService, "markUsed")
    .mockImplementation(async (): Promise<void> => {
      return undefined;
    });

  const workerAsAny: Dictionary<AnyAsyncFunction> =
    OtelProfilesIngestService as unknown as Dictionary<AnyAsyncFunction>;

  for (const method of [
    "autoDiscoverKubernetesCluster",
    "autoDiscoverDockerHost",
    "autoDiscoverPodmanHost",
    "autoDiscoverHost",
    "autoDiscoverServerless",
    "autoDiscoverCloudResource",
    "autoDiscoverRum",
  ]) {
    jest.spyOn(workerAsAny, method).mockImplementation(async () => {
      return null;
    });
  }

  const serviceEntityId: ObjectID = ObjectID.generate();
  jest
    .spyOn(workerAsAny, "resolveTelemetryResource")
    .mockImplementation(async (...args: Array<unknown>) => {
      const attributes: Array<JSONObject> = (
        args[0] as { attributes: Array<JSONObject> }
      ).attributes;
      const serviceName: JSONObject | undefined = attributes.find(
        (attribute: JSONObject) => {
          return attribute["key"] === "service.name";
        },
      );
      return {
        serviceName: serviceName
          ? ((serviceName["value"] as JSONObject)["stringValue"] as string)
          : "unknown",
        primaryEntityId: serviceEntityId,
        primaryEntityType: ServiceType.OpenTelemetry,
        entityKeys: [],
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    });

  jest
    .spyOn(
      TelemetryFanInWriter as unknown as Dictionary<AnyAsyncFunction>,
      "submit",
    )
    .mockImplementation(async (...args: Array<unknown>) => {
      const rows: Array<JSONObject> = args[1] as Array<JSONObject>;
      if (args[0] === ProfileService) {
        capturedRows.profiles.push(...rows);
      } else {
        capturedRows.samples.push(...rows);
      }
      return { flushed: Promise.resolve() };
    });

  /*
   * Importing StartServer installed the real global body parsers on this
   * app. The Pyroscope router is mounted on the same prefixes the App
   * uses.
   */
  const app: ExpressApplication = Express.getExpressApp();
  app.use(["/telemetry", "/"], PyroscopeAPI);
  app.use(expressErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  mockCapturedJobs.length = 0;
});

/*
 * ---------------------------------------------------------------------------
 * pyroscope-dotnet <= 0.13: the customer's setup
 * ---------------------------------------------------------------------------
 */

describe("pyroscope-dotnet 0.13: multipart /ingest with millisecond from/until", () => {
  test("is accepted and enqueued under the application name", async () => {
    const result: HttpResult = await send(
      legacyIngestRequest({
        pprof: defaultDotnetCpuPprof(),
        from: String(WINDOW_START_MS),
        until: String(WINDOW_END_MS),
        authorization: `Bearer ${KEY}`,
        staticTags: [["env", "e2e"]],
      }),
    );

    expect(result.status).toBe(200);

    const job: MockCapturedJob = onlyJob();
    expect(job.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(job.productType).toBe(ProductType.Profiles);
    expect(serviceNameOf(resourceProfilesOf(job)[0] as JSONObject)).toBe(
      "app-name",
    );
  });

  test("reads the millisecond window as milliseconds, as integer nanosecond strings", async () => {
    await send(
      legacyIngestRequest({
        pprof: defaultDotnetCpuPprof(),
        from: String(WINDOW_START_MS),
        until: String(WINDOW_END_MS),
        authorization: `Bearer ${KEY}`,
      }),
    );

    const job: MockCapturedJob = onlyJob();
    const profile: JSONObject = firstProfileOf(job);

    // Before the fix: "1.790208e+21" / "1.790208015e+21".
    expect(profile["startTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(profile["endTimeUnixNano"]).toBe(WINDOW_END_NANO);

    const samples: Array<JSONObject> = (profile["profile"] as JSONObject)[
      "sample"
    ] as Array<JSONObject>;
    expect(samples).toHaveLength(40);
    for (const sample of samples) {
      expect(sample["timestampsUnixNano"]).toEqual([WINDOW_START_NANO]);
    }

    expectIntegerNanoStrings(job);
  });

  test("becomes storable ClickHouse rows in the capture window", async () => {
    await send(
      legacyIngestRequest({
        pprof: defaultDotnetCpuPprof(),
        from: String(WINDOW_START_MS),
        until: String(WINDOW_END_MS),
        authorization: `Bearer ${KEY}`,
      }),
    );

    const rows: WorkerRows = await runWorker(onlyJob());

    expect(rows.profiles).toHaveLength(1);
    const profileRow: JSONObject = rows.profiles[0]!;

    // Before the fix: "58704-11-29 00:00:00" and a 4h10m duration.
    expect(profileRow["startTime"]).toBe(WINDOW_START_CLICKHOUSE);
    expect(profileRow["endTime"]).toBe(WINDOW_END_CLICKHOUSE);
    expect(profileRow["startTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(profileRow["endTimeUnixNano"]).toBe(WINDOW_END_NANO);
    expect(profileRow["durationNano"]).toBe("15000000000");
    expect(profileRow["profileType"]).toBe("cpu");
    expect(profileRow["unit"]).toBe("nanoseconds");
    expect(profileRow["projectId"]).toBe(PROJECT_ID.toString());

    expect(rows.samples).toHaveLength(40);
    for (const sampleRow of rows.samples) {
      expect(sampleRow["time"]).toBe(WINDOW_START_CLICKHOUSE);
      expect(sampleRow["timeUnixNano"]).toBe(WINDOW_START_NANO);
      expect(sampleRow["value"]).toBe("10000000");
      expect(sampleRow["profileType"]).toBe("cpu");
    }

    // .NET frames resolve through the string table, leaf first.
    const stacks: Array<string> = rows.samples.map((sampleRow: JSONObject) => {
      return (sampleRow["stacktrace"] as Array<string>).join(" <- ");
    });
    expect(stacks.join("\n")).toContain("App.Services!PricingService.Compute");
    expect(stacks.join("\n")).toContain(
      "System.Text.Json!JsonSerializer.Serialize",
    );

    expectStorableRows(rows);
  });

  test("works on the /telemetry prefix too", async () => {
    const result: HttpResult = await send(
      legacyIngestRequest({
        pprof: defaultDotnetCpuPprof(),
        from: String(WINDOW_START_MS),
        until: String(WINDOW_END_MS),
        authorization: `Bearer ${KEY}`,
        prefix: "/telemetry",
      }),
    );

    expect(result.status).toBe(200);
    expect(firstProfileOf(onlyJob())["startTimeUnixNano"]).toBe(
      WINDOW_START_NANO,
    );
  });

  test("an empty PYROSCOPE_AUTH_TOKEN is refused, not silently dropped", async () => {
    const result: HttpResult = await send(
      legacyIngestRequest({
        pprof: defaultDotnetCpuPprof(),
        from: String(WINDOW_START_MS),
        until: String(WINDOW_END_MS),
      }),
    );

    expect(result.status).toBe(401);
    expect(mockCapturedJobs).toHaveLength(0);
  });

  test("a wrong token is refused", async () => {
    const result: HttpResult = await send(
      legacyIngestRequest({
        pprof: defaultDotnetCpuPprof(),
        from: String(WINDOW_START_MS),
        until: String(WINDOW_END_MS),
        authorization: "Bearer 00000000-0000-4000-8000-000000000000",
      }),
    );

    expect(result.status).toBe(401);
    expect(mockCapturedJobs).toHaveLength(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Other /ingest senders: the unit fix must not move them
 * ---------------------------------------------------------------------------
 */

describe("/ingest senders with other time units", () => {
  test("seconds (pyroscope-java, older pyroscope-nodejs) are unchanged", async () => {
    await send(
      legacyIngestRequest({
        pprof: defaultDotnetCpuPprof(),
        from: String(WINDOW_START_SECONDS),
        until: String(WINDOW_START_SECONDS + 15),
        authorization: `Bearer ${KEY}`,
      }),
    );

    const profile: JSONObject = firstProfileOf(onlyJob());
    expect(profile["startTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(profile["endTimeUnixNano"]).toBe(WINDOW_END_NANO);
  });

  test("nanoseconds with a pprof start but no duration (pyroscope-go heap) end at `until`", async () => {
    /*
     * Before the fix this profile's end became until * 1e9 =
     * "1.790208015e+27", and the worker threw RangeError on it and dropped
     * the whole profile.
     */
    const goHeap: Buffer = zlib.gzipSync(
      buildDotnetPprof({
        sampleTypes: [
          { name: "inuse_objects", unit: "count" },
          { name: "inuse_space", unit: "bytes" },
        ],
        samples: [{ stack: REQUEST_STACK, values: [3, 4096] }],
        timeNanos: 1_790_208_000_000_000_000,
      }) as unknown as Uint8Array,
    );

    await send(
      legacyIngestRequest({
        pprof: goHeap,
        from: WINDOW_START_NANO,
        until: WINDOW_END_NANO,
        authorization: `Bearer ${KEY}`,
      }),
    );

    const job: MockCapturedJob = onlyJob();
    const profile: JSONObject = firstProfileOf(job);
    expect(profile["startTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(profile["endTimeUnixNano"]).toBe(WINDOW_END_NANO);

    const rows: WorkerRows = await runWorker(job);
    expect(rows.profiles).toHaveLength(1);
    expect(rows.profiles[0]!["durationNano"]).toBe("15000000000");
    expect(rows.profiles[0]!["profileType"]).toBe("inuse_space");
  });

  test("a relative `from` (now-10s) falls back to ingestion time", async () => {
    const before: number = Date.now();

    await send(
      legacyIngestRequest({
        pprof: defaultDotnetCpuPprof(),
        from: "now-10s",
        until: "now",
        authorization: `Bearer ${KEY}`,
      }),
    );

    const startMs: number = Number(
      BigInt(firstProfileOf(onlyJob())["startTimeUnixNano"] as string) /
        BigInt(1_000_000),
    );
    expect(startMs).toBeGreaterThanOrEqual(before);
    expect(startMs).toBeLessThanOrEqual(Date.now());
  });

  test("folded text takes its window from from/until too", async () => {
    // Folded text carries no capture time of its own.
    const request: HttpRequestSpec = legacyIngestRequest({
      pprof: Buffer.from("main;work;inner 12\nmain;idle 3\n"),
      from: String(WINDOW_START_SECONDS),
      until: String(WINDOW_START_SECONDS + 15),
      authorization: `Bearer ${KEY}`,
    });
    request.urlPath += "&format=folded";

    expect((await send(request)).status).toBe(200);

    const profile: JSONObject = firstProfileOf(onlyJob());
    expect(profile["startTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(profile["endTimeUnixNano"]).toBe(WINDOW_END_NANO);
  });

  test("unlabelled folded text (the pprof-parse fallback) keeps a millisecond window", async () => {
    await send(
      legacyIngestRequest({
        pprof: Buffer.from("main;work 7\n"),
        from: String(WINDOW_START_MS),
        until: String(WINDOW_END_MS),
        authorization: `Bearer ${KEY}`,
      }),
    );

    const profile: JSONObject = firstProfileOf(onlyJob());
    expect(profile["startTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(profile["endTimeUnixNano"]).toBe(WINDOW_END_NANO);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Raw-body /ingest: pyroscope-nodejs 0.6.2+ and pyroscope-rs 0.5
 * ---------------------------------------------------------------------------
 */

function rawIngestRequest(data: {
  body: Buffer;
  contentType: string;
  query: string;
  headers?: Dictionary<string>;
}): HttpRequestSpec {
  return {
    urlPath: `/pyroscope/ingest?${data.query}`,
    headers: {
      "Content-Type": data.contentType,
      ...(data.headers || {}),
    },
    body: data.body,
  };
}

describe("raw-body /ingest uploads", () => {
  const NODE_QUERY: string = `name=node-app&from=${WINDOW_START_SECONDS}&until=${
    WINDOW_START_SECONDS + 15
  }&format=pprof`;

  test("pyroscope-nodejs 0.6.2+: gzipped pprof as the raw application/octet-stream body", async () => {
    const result: HttpResult = await send(
      rawIngestRequest({
        body: zlib.gzipSync(defaultDotnetCpuPprof() as unknown as Uint8Array),
        contentType: "application/octet-stream",
        query: NODE_QUERY,
        headers: { Authorization: `Bearer ${KEY}` },
      }),
    );

    // Before: 400 "No profile data found in request body."
    expect(result.status).toBe(200);

    const job: MockCapturedJob = onlyJob();
    expect(serviceNameOf(resourceProfilesOf(job)[0] as JSONObject)).toBe(
      "node-app",
    );
    expect(firstProfileOf(job)["startTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(firstProfileOf(job)["endTimeUnixNano"]).toBe(WINDOW_END_NANO);
  });

  test("a raw body with Content-Encoding: gzip still works (the global reader already consumed it)", async () => {
    const result: HttpResult = await send(
      rawIngestRequest({
        body: zlib.gzipSync(defaultDotnetCpuPprof() as unknown as Uint8Array),
        contentType: "application/octet-stream",
        query: NODE_QUERY,
        headers: {
          Authorization: `Bearer ${KEY}`,
          "Content-Encoding": "gzip",
        },
      }),
    );

    expect(result.status).toBe(200);
    expect(firstProfileOf(onlyJob())["startTimeUnixNano"]).toBe(
      WINDOW_START_NANO,
    );
  });

  test("pyroscope-rs 0.5: folded text as a binary/octet-stream body", async () => {
    const result: HttpResult = await send(
      rawIngestRequest({
        body: Buffer.from("main;work 12\n"),
        contentType: "binary/octet-stream",
        query: `name=${encodeURIComponent("ruby-app.cpu{env=prod}")}&from=${WINDOW_START_SECONDS}&until=${
          WINDOW_START_SECONDS + 15
        }&format=folded`,
        headers: { Authorization: `Bearer ${KEY}` },
      }),
    );

    expect(result.status).toBe(200);
    expect(serviceNameOf(resourceProfilesOf(onlyJob())[0] as JSONObject)).toBe(
      "ruby-app",
    );
  });

  test("a raw body without a valid key is refused before it is read", async () => {
    const result: HttpResult = await send(
      rawIngestRequest({
        body: zlib.gzipSync(defaultDotnetCpuPprof() as unknown as Uint8Array),
        contentType: "application/octet-stream",
        query: NODE_QUERY,
      }),
    );

    expect(result.status).toBe(401);
    expect(mockCapturedJobs).toHaveLength(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * push.v1
 * ---------------------------------------------------------------------------
 */

describe("push.v1 from pyroscope-dotnet 0.14+ (application/proto, uncompressed)", () => {
  test("is parsed, accepted and answered in the Connect shape", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      {
        "Content-Type": "application/proto",
        Authorization: `Bearer ${KEY}`,
        "User-Agent": "pyroscope-dotnet/0.15.0 cpp-httplib",
      },
    );

    // Before the fix: 400 "No push data found in request body."
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/proto");
    expect(result.body.length).toBe(0);

    const job: MockCapturedJob = onlyJob();
    expect(job.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  test.each([["process_cpu"], ["wall"], ["memory"], ["exception"], ["lock"]])(
    "a %s series is filed under service_name, not the profile type",
    async (profileType: string) => {
      await push(
        encodePush([
          { labels: dotnetPushLabels(profileType), pprof: recentPprof() },
        ]),
        { "Content-Type": "application/proto", Authorization: `Bearer ${KEY}` },
      );

      expect(
        serviceNameOf(resourceProfilesOf(onlyJob())[0] as JSONObject),
      ).toBe("app-name");
    },
  );

  test("the pprof's own window is kept, and the rows land in it", async () => {
    const startNanos: number = 1_790_208_000_000_000_000;
    const pprof: Buffer = buildDotnetPprof({
      sampleTypes: [{ name: "cpu", unit: "nanoseconds" }],
      samples: cpuSamples(4),
      timeNanos: startNanos,
      durationNanos: 15_000_000_000,
    });

    await push(
      encodePush([{ labels: dotnetPushLabels("process_cpu"), pprof }]),
      {
        "Content-Type": "application/proto",
        Authorization: `Bearer ${KEY}`,
      },
    );

    const job: MockCapturedJob = onlyJob();
    expect(firstProfileOf(job)["startTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(firstProfileOf(job)["endTimeUnixNano"]).toBe(WINDOW_END_NANO);

    const rows: WorkerRows = await runWorker(job);
    expect(rows.profiles[0]!["startTime"]).toBe(WINDOW_START_CLICKHOUSE);
    expect(rows.profiles[0]!["endTime"]).toBe(WINDOW_END_CLICKHOUSE);
    expect(rows.samples).toHaveLength(4);
    expectStorableRows(rows);
  });

  test("works on the /telemetry prefix too", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      { "Content-Type": "application/proto", Authorization: `Bearer ${KEY}` },
      "/telemetry",
    );

    expect(result.status).toBe(200);
    expect(mockCapturedJobs).toHaveLength(1);
  });

  test("a media type spelled in upper case is parsed too", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      { "Content-Type": "Application/Proto", Authorization: `Bearer ${KEY}` },
    );

    expect(result.status).toBe(200);
    expect(mockCapturedJobs).toHaveLength(1);
  });

  test("0.14.0 / 0.14.1 pprofs carry no time at all: stamped with push time, zero length", async () => {
    // Their PprofBuilder::Build() never sets time_nanos or duration_nanos.
    const before: number = Date.now();

    await push(
      encodePush([
        {
          labels: dotnetPushLabels("process_cpu"),
          pprof: defaultDotnetCpuPprof(),
        },
      ]),
      { "Content-Type": "application/proto", Authorization: `Bearer ${KEY}` },
    );

    const profile: JSONObject = firstProfileOf(onlyJob());
    const startMs: number = Number(
      BigInt(profile["startTimeUnixNano"] as string) / BigInt(1_000_000),
    );
    expect(startMs).toBeGreaterThanOrEqual(before);
    expect(startMs).toBeLessThanOrEqual(Date.now());

    // Never an end before the start, however the two clocks are read.
    expect(profile["endTimeUnixNano"]).toBe(profile["startTimeUnixNano"]);
    expectIntegerNanoStrings(onlyJob());
  });

  test("a pprof with a start but no duration (Go heap via Alloy) runs until it was pushed", async () => {
    const before: number = Date.now();

    await push(
      encodePush([
        {
          labels: [
            ["__name__", "memory"],
            ["service_name", "go-app"],
          ],
          pprof: buildDotnetPprof({
            sampleTypes: [
              { name: "inuse_objects", unit: "count" },
              { name: "inuse_space", unit: "bytes" },
            ],
            samples: [{ stack: REQUEST_STACK, values: [3, 4096] }],
            timeNanos: 1_790_208_000_000_000_000,
          }),
        },
      ]),
      {
        "Content-Type": "application/proto",
        "Connect-Protocol-Version": "1",
        "x-oneuptime-token": KEY,
      },
    );

    const profile: JSONObject = firstProfileOf(onlyJob());
    expect(profile["startTimeUnixNano"]).toBe(WINDOW_START_NANO);

    const endMs: number = Number(
      BigInt(profile["endTimeUnixNano"] as string) / BigInt(1_000_000),
    );
    expect(endMs).toBeGreaterThanOrEqual(before);
    expect(endMs).toBeLessThanOrEqual(Date.now());
  });
});

describe("push.v1 with telemetry ingestion switched off", () => {
  beforeEach(() => {
    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(true);
  });

  afterEach(() => {
    // Only this spy: the key-lookup and worker spies must survive.
    jest.mocked(TelemetryIngestionDisabled.isDisabled).mockRestore();
  });

  test("a Connect client is still answered in the Connect shape, so it does not retry", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      {
        "Content-Type": "application/proto",
        "Connect-Protocol-Version": "1",
        "x-oneuptime-token": KEY,
      },
    );

    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/proto");
    expect(result.body.length).toBe(0);
    expect(mockCapturedJobs).toHaveLength(0);
  });

  test("other callers keep the JSON success body", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      { "Content-Type": "application/x-protobuf", "x-oneuptime-token": KEY },
    );

    expect(result.status).toBe(200);
    expect(result.contentType).toMatch(/^application\/json/);
    expect(mockCapturedJobs).toHaveLength(0);
  });
});

describe("push.v1 from pyroscope-dotnet 1.5+ (no PYROSCOPE_AUTH_TOKEN)", () => {
  test("PYROSCOPE_BASIC_AUTH_USER / _PASSWORD carry the key in the password", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      {
        "Content-Type": "application/proto",
        Authorization: `Basic ${Buffer.from(`oneuptime:${KEY}`).toString("base64")}`,
      },
    );

    // Before the fix: 401 "Missing ingestion token".
    expect(result.status).toBe(200);
    expect(onlyJob().projectId.toString()).toBe(PROJECT_ID.toString());
  });

  test("PYROSCOPE_HTTP_HEADERS with x-oneuptime-token works without Authorization", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      { "Content-Type": "application/proto", "x-oneuptime-token": KEY },
    );

    expect(result.status).toBe(200);
    expect(mockCapturedJobs).toHaveLength(1);
  });

  test("a wrong Basic password is refused", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      {
        "Content-Type": "application/proto",
        Authorization: `Basic ${Buffer.from("oneuptime:wrong").toString("base64")}`,
      },
    );

    expect(result.status).toBe(401);
    expect(mockCapturedJobs).toHaveLength(0);
  });

  test("an explicit ingestion-key header is never shadowed by an Authorization header", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      {
        "Content-Type": "application/proto",
        "x-oneuptime-ingestion-key": OTHER_KEY,
        Authorization: `Basic ${Buffer.from(`proxy:${KEY}`).toString("base64")}`,
      },
    );

    expect(result.status).toBe(200);
    expect(onlyJob().projectId.toString()).toBe(OTHER_PROJECT_ID.toString());
  });
});

describe("push.v1 from other clients", () => {
  test("Grafana Alloy: Connect request, sorted labels", async () => {
    const result: HttpResult = await push(
      encodePush([
        {
          labels: [
            ["__delta__", "false"],
            ["__name__", "process_cpu"],
            ["namespace", "default"],
            ["pod", "checkout-7d9f"],
            ["service_name", "checkout"],
          ],
          pprof: recentPprof(),
        },
      ]),
      {
        "Content-Type": "application/proto",
        "Connect-Protocol-Version": "1",
        "User-Agent": "connect-go/1.20.0 (go1.25)",
        "x-oneuptime-token": KEY,
      },
    );

    /*
     * connect-go demands the request's codec back on a 200 - exactly
     * "application/proto", no charset - and retries CodeInternal, so a JSON
     * {} made Alloy push (and OneUptime ingest) every profile ten times.
     */
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/proto");
    expect(result.body.length).toBe(0);

    expect(serviceNameOf(resourceProfilesOf(onlyJob())[0] as JSONObject)).toBe(
      "checkout",
    );
  });

  test("pyroscope-rs 2.1 (Python / Ruby / Rust): gzip body, tags between the name labels", async () => {
    const result: HttpResult = await push(
      zlib.gzipSync(
        encodePush([
          {
            labels: [
              ["__name__", "process_cpu"],
              ["region", "eu"],
              ["service_name", "ruby-app"],
            ],
            pprof: zlib.gzipSync(recentPprof() as unknown as Uint8Array),
          },
        ]) as unknown as Uint8Array,
      ),
      {
        "Content-Type": "application/proto",
        "Content-Encoding": "gzip",
        Authorization: `Bearer ${KEY}`,
      },
    );

    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/proto");
    expect(serviceNameOf(resourceProfilesOf(onlyJob())[0] as JSONObject)).toBe(
      "ruby-app",
    );
  });

  test("application/x-protobuf callers keep the JSON success body", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
      ]),
      {
        "Content-Type": "application/x-protobuf",
        Authorization: `Bearer ${KEY}`,
      },
    );

    expect(result.status).toBe(200);
    expect(result.contentType).toMatch(/^application\/json/);
    expect(JSON.parse(result.body.toString())).toEqual({});
  });

  test("a push with no usable profile is still answered in the Connect shape", async () => {
    const result: HttpResult = await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: Buffer.alloc(0) },
      ]),
      {
        "Content-Type": "application/proto",
        "Connect-Protocol-Version": "1",
        "x-oneuptime-token": KEY,
      },
    );

    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/proto");
    expect(result.body.length).toBe(0);
    expect(mockCapturedJobs).toHaveLength(0);
  });

  test("series with different services in one push stay apart", async () => {
    await push(
      encodePush([
        { labels: dotnetPushLabels("process_cpu"), pprof: recentPprof() },
        {
          labels: [
            ["__name__", "process_cpu"],
            ["service_name", "billing"],
          ],
          pprof: recentPprof(),
        },
      ]),
      { "Content-Type": "application/proto", Authorization: `Bearer ${KEY}` },
    );

    expect(
      (resourceProfilesOf(onlyJob()) as Array<JSONObject>).map(serviceNameOf),
    ).toEqual(["app-name", "billing"]);
  });

  test.each([
    [
      "legacy __name__ spelling with no service_name",
      [["__name__", "myapp.cpu{env=prod}"]],
      "myapp",
    ],
    [
      "legacy __name__ with labels only",
      [["__name__", "myapp{env=prod}"]],
      "myapp",
    ],
    [
      "legacy __name__ with a type suffix and no labels",
      [["__name__", "myapp.cpu"]],
      "myapp",
    ],
    [
      "bare profile type and no service_name",
      [["__name__", "process_cpu"]],
      "unknown",
    ],
    [
      "empty service_name",
      [
        ["__name__", "wall"],
        ["service_name", "  "],
      ],
      "unknown",
    ],
    [
      "dotted service_name kept verbatim",
      [
        ["__name__", "wall"],
        ["service_name", "billing.cpu"],
      ],
      "billing.cpu",
    ],
    ["no name labels at all", [["env", "prod"]], "unknown"],
  ] as Array<[string, Labels, string]>)(
    "%s",
    async (_label: string, labels: Labels, expected: string) => {
      await push(encodePush([{ labels: labels, pprof: recentPprof() }]), {
        "Content-Type": "application/proto",
        Authorization: `Bearer ${KEY}`,
      });

      expect(
        serviceNameOf(resourceProfilesOf(onlyJob())[0] as JSONObject),
      ).toBe(expected);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The worker's last line of defence
 * ---------------------------------------------------------------------------
 */

describe("the profiles worker never writes a timestamp the tables cannot store", () => {
  function otlpBody(profile: JSONObject): JSONObject {
    return {
      resourceProfiles: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "app-name" } },
            ],
          },
          scopeProfiles: [
            {
              scope: { name: "test" },
              profiles: [profile],
            },
          ],
        },
      ],
    };
  }

  function profileWith(times: {
    start: string;
    end: string;
    sample: string;
  }): JSONObject {
    return {
      profileId: Buffer.from(ObjectID.generate().toString(), "hex").toString(
        "base64",
      ),
      startTimeUnixNano: times.start,
      endTimeUnixNano: times.end,
      attributes: [],
      profile: {
        stringTable: ["", "cpu", "nanoseconds", "main"],
        sampleType: [{ type: 1, unit: 2 }],
        sample: [
          {
            stackIndex: 0,
            value: ["5"],
            timestampsUnixNano: [times.sample],
          },
        ],
        locationTable: [{ line: [{ functionIndex: 0, line: 1 }] }],
        functionTable: [{ name: 3, filename: 0 }],
        stackTable: [{ locationIndices: [0] }],
        linkTable: [],
        attributeTable: [],
        periodType: { type: 1, unit: 2 },
        period: "1",
      },
    };
  }

  function job(profile: JSONObject): MockCapturedJob {
    return {
      body: otlpBody(profile),
      projectId: PROJECT_ID,
      productType: ProductType.Profiles,
    };
  }

  test("a year-58000 start (what 0.13 used to produce) lands at ingestion time instead of vanishing", async () => {
    const before: number = Date.now();

    const rows: WorkerRows = await runWorker(
      job(
        profileWith({
          start: "1.790208e+21",
          end: "1.790208015e+21",
          sample: "1.790208e+21",
        }),
      ),
    );

    expect(rows.profiles).toHaveLength(1);
    const startMs: number = Number(
      BigInt(rows.profiles[0]!["startTimeUnixNano"] as string) /
        BigInt(1_000_000),
    );
    expect(startMs).toBeGreaterThanOrEqual(before - 1000);
    expect(startMs).toBeLessThanOrEqual(Date.now());

    /*
     * End and sample time are unusable too, so the whole profile collapses
     * onto that instant. (That they fall back to the START rather than to
     * "now" is pinned by the two tests below, where the start is valid.)
     */
    expect(rows.profiles[0]!["endTimeUnixNano"]).toBe(
      rows.profiles[0]!["startTimeUnixNano"],
    );
    expect(rows.profiles[0]!["durationNano"]).toBe("0");
    expect(rows.samples[0]!["timeUnixNano"]).toBe(
      rows.profiles[0]!["startTimeUnixNano"],
    );
    expectStorableRows(rows);
  });

  test("an end past the JS Date range no longer drops the whole profile", async () => {
    const rows: WorkerRows = await runWorker(
      job(
        profileWith({
          start: WINDOW_START_NANO,
          end: "1.790208015e+27",
          sample: WINDOW_START_NANO,
        }),
      ),
    );

    expect(rows.profiles).toHaveLength(1);
    expect(rows.profiles[0]!["startTime"]).toBe(WINDOW_START_CLICKHOUSE);
    expect(rows.profiles[0]!["endTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(rows.samples).toHaveLength(1);
  });

  test("a negative sample time falls back to the profile start", async () => {
    const rows: WorkerRows = await runWorker(
      job(
        profileWith({
          start: WINDOW_START_NANO,
          end: WINDOW_END_NANO,
          sample: "-5",
        }),
      ),
    );

    expect(rows.samples[0]!["timeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(rows.samples[0]!["time"]).toBe(WINDOW_START_CLICKHOUSE);
  });

  test("valid timestamps pass through untouched", async () => {
    const rows: WorkerRows = await runWorker(
      job(
        profileWith({
          start: WINDOW_START_NANO,
          end: WINDOW_END_NANO,
          sample: "1790208007000000000",
        }),
      ),
    );

    expect(rows.profiles[0]!["startTimeUnixNano"]).toBe(WINDOW_START_NANO);
    expect(rows.profiles[0]!["endTimeUnixNano"]).toBe(WINDOW_END_NANO);
    expect(rows.profiles[0]!["durationNano"]).toBe("15000000000");
    expect(rows.samples[0]!["timeUnixNano"]).toBe("1790208007000000000");
  });

  test("the epoch itself is still storable and kept", async () => {
    const rows: WorkerRows = await runWorker(
      job(profileWith({ start: "0", end: "0", sample: "0" })),
    );

    expect(rows.profiles[0]!["startTimeUnixNano"]).toBe("0");
  });

  /*
   * The ceiling is int64 nanoseconds (2262-04-11), what DateTime64(9) and
   * the UInt64 columns hold - not the 1e21 at which Number switches to
   * exponent notation. A value in between is an integer string ClickHouse
   * still rejects at flush.
   */
  test("the last storable instant is kept", async () => {
    const rows: WorkerRows = await runWorker(
      job(
        profileWith({
          start: WINDOW_START_NANO,
          end: "9223372036854774784",
          sample: WINDOW_START_NANO,
        }),
      ),
    );

    /*
     * The worker carries nanoseconds as Numbers, which print in their
     * shortest round-trip form ("9223372036854775000") - the same double,
     * still an integer string, still below int64 max.
     */
    const end: string = rows.profiles[0]!["endTimeUnixNano"] as string;
    expect(end).toMatch(INTEGER_STRING);
    expect(Number(end)).toBe(9_223_372_036_854_774_784);
    expect(BigInt(end) <= BigInt("9223372036854775807")).toBe(true);
    expect(rows.profiles[0]!["endTime"]).toMatch(/^2262-04-11 /);
  });

  test.each([["9223372036854775808"], ["20000000000000000000"]])(
    "%s, past int64 nanoseconds, falls back to the start",
    async (end: string) => {
      const rows: WorkerRows = await runWorker(
        job(
          profileWith({
            start: WINDOW_START_NANO,
            end: end,
            sample: WINDOW_START_NANO,
          }),
        ),
      );

      expect(rows.profiles[0]!["endTimeUnixNano"]).toBe(WINDOW_START_NANO);
      expect(rows.profiles[0]!["durationNano"]).toBe("0");
    },
  );
});
