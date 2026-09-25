import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import zlib from "zlib";
import {
  OTLP_PROTO_LOADER_OPTIONS,
  startGrpcServer,
} from "../../FeatureSet/Telemetry/GrpcServer";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import ProfilesQueueService from "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService";
import TracesQueueService from "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

/*
 * LIVE gRPC: the OTLP ingest server's auth status, over a real socket
 * ===================================================================
 * GH#3978. An OTel pipeline pointed at OneUptime with a mistyped, revoked or
 * wrong-type ingestion key used to be answered with gRPC OK and have its
 * batch dropped, so the exporter logged nothing and the customer saw a
 * healthy pipeline that never showed data. handleExport now answers every
 * refused credential with UNAUTHENTICATED.
 *
 * GrpcServerEnqueueAck.test.ts pins that by calling the captured Export
 * closure with a hand-made callback. That cannot see what an exporter
 * actually receives: whether the ServiceError survives grpc-js' server-side
 * serialization, what the status code and grpc-message trailer look like on
 * the wire, whether anything leaks into trailing metadata, and whether the
 * client's own retry machinery re-sends the batch. This suite answers those
 * by running the PRODUCTION server — startGrpcServer() itself, with its own
 * proto loading, its own four service registrations and its own
 * signal-to-queue wiring — on an ephemeral 127.0.0.1 port, and calling
 * Export through real @grpc/grpc-js clients built from the same .proto files
 * an exporter compiles against.
 *
 * Only two things are substituted: the key-policy resolver (so each test can
 * hand the server an exact key state without Postgres) and the per-signal
 * queue services (so admission can be observed and failed without Redis).
 */

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return { __esModule: true, default: { getPolicyFromSecretKey: jest.fn() } };
});
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {},
    QueueName: { Telemetry: "Telemetry" },
  };
});
jest.mock("../../FeatureSet/Telemetry/Services/Queue/LogsQueueService", () => {
  return { __esModule: true, default: { addLogIngestJob: jest.fn() } };
});
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService",
  () => {
    return { __esModule: true, default: { addMetricIngestJob: jest.fn() } };
  },
);
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService",
  () => {
    return { __esModule: true, default: { addProfileIngestJob: jest.fn() } };
  },
);
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService",
  () => {
    return { __esModule: true, default: { addTraceIngestJob: jest.fn() } };
  },
);

/*
 * The status codes an OTLP/gRPC exporter RETRIES. From the OpenTelemetry
 * Protocol specification, "OTLP/gRPC Response" -> "Failures"
 * (https://opentelemetry.io/docs/specs/otlp/#failures): the client SHOULD
 * treat CANCELLED, DEADLINE_EXCEEDED, ABORTED, OUT_OF_RANGE, UNAVAILABLE and
 * DATA_LOSS as retryable, and RESOURCE_EXHAUSTED as retryable when the
 * server signals it can recover (a RetryInfo detail) — listed here
 * unconditionally, because a test that must prove "never retried" has to
 * assume the exporter takes the retrying reading. Every other non-OK code
 * is non-retryable: the exporter drops the batch and logs the status.
 *
 * That split is the whole of FIX 3's safety argument. A refused key must be
 * answered with a code OUTSIDE this list, or every misconfigured exporter
 * retries against the auth path forever; a queue failure must be answered
 * with a code INSIDE it, or a transient Redis outage silently loses data.
 */
const OTLP_RETRYABLE_GRPC_STATUS_CODES: ReadonlyArray<grpc.status> = [
  grpc.status.CANCELLED,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.ABORTED,
  grpc.status.OUT_OF_RANGE,
  grpc.status.UNAVAILABLE,
  grpc.status.DATA_LOSS,
  grpc.status.RESOURCE_EXHAUSTED,
];

/*
 * Pinned verbatim, not imported: this is the sentence a customer reads in
 * their collector's log, and the same one for every refusal reason. A change
 * to it should be a deliberate edit to this file too.
 */
const UNAUTHENTICATED_DETAILS: string =
  "Invalid or missing OneUptime ingestion key. Set the x-oneuptime-token header to a valid server ingestion key.";

const QUEUE_UNAVAILABLE_DETAILS: string =
  "Telemetry queue unavailable. Please retry.";

// The three metadata keys authenticateRequest accepts, in precedence order.
const TOKEN_HEADERS: Array<string> = [
  "x-oneuptime-token",
  "x-oneuptime-service-token",
  "x-oneuptime-ingestion-key",
];

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

// Generous, but far below the jest timeout, so a hang fails as a status.
const CALL_DEADLINE_MS: number = 10000;

type MockedFn = jest.Mock;

type ExportCallback = (
  error: grpc.ServiceError | null,
  response?: Record<string, unknown>,
) => void;

interface OtlpExportClient extends grpc.Client {
  Export: (
    request: Record<string, unknown>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: ExportCallback,
  ) => grpc.ClientUnaryCall;
}

interface Signal {
  name: string;
  protoFile: string;
  packagePath: Array<string>;
  product: ProductType;
  getQueue: () => MockedFn;
  // A small but real OTLP export request, as an SDK would build it.
  request: Record<string, unknown>;
  /*
   * What the server must hand the queue for that request, decoded with the
   * production loader options: uint64/fixed64 as exact decimal strings,
   * enums as their names, bytes as Buffers, plus the virtual `oneofs` name.
   */
  expectedBody: Record<string, unknown>;
}

const RESOURCE: Record<string, unknown> = {
  attributes: [
    { key: "service.name", value: { stringValue: "live-grpc-exporter" } },
  ],
};

/*
 * Every timestamp is above Number.MAX_SAFE_INTEGER, so a regression to
 * numeric longs would show up as a changed digit, not a passing test.
 */
const TIME_UNIX_NANO: string = "1758800000123456789";
const END_TIME_UNIX_NANO: string = "1758800000623456789";

const TRACE_ID: Buffer = Buffer.from("0af7651916cd43dd8448eb211c80319c", "hex");
const SPAN_ID: Buffer = Buffer.from("b7ad6b7169203331", "hex");
const PROFILE_ID: Buffer = Buffer.from(
  "5c1b1f9a6e3d4c0b8e2f7a9d1c3b5e7f",
  "hex",
);

const signals: Array<Signal> = [
  {
    name: "traces",
    protoFile: "trace_service.proto",
    packagePath: [
      "opentelemetry",
      "proto",
      "collector",
      "trace",
      "v1",
      "TraceService",
    ],
    product: ProductType.Traces,
    getQueue: (): MockedFn => {
      return TracesQueueService.addTraceIngestJob as unknown as MockedFn;
    },
    request: {
      resourceSpans: [
        {
          resource: RESOURCE,
          scopeSpans: [
            {
              scope: { name: "live-scope" },
              spans: [
                {
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  name: "GET /checkout",
                  kind: "SPAN_KIND_SERVER",
                  startTimeUnixNano: TIME_UNIX_NANO,
                  endTimeUnixNano: END_TIME_UNIX_NANO,
                },
              ],
            },
          ],
        },
      ],
    },
    expectedBody: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: {
                  stringValue: "live-grpc-exporter",
                  value: "stringValue",
                },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "live-scope" },
              spans: [
                {
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  name: "GET /checkout",
                  kind: "SPAN_KIND_SERVER",
                  startTimeUnixNano: TIME_UNIX_NANO,
                  endTimeUnixNano: END_TIME_UNIX_NANO,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "logs",
    protoFile: "logs_service.proto",
    packagePath: [
      "opentelemetry",
      "proto",
      "collector",
      "logs",
      "v1",
      "LogsService",
    ],
    product: ProductType.Logs,
    getQueue: (): MockedFn => {
      return LogsQueueService.addLogIngestJob as unknown as MockedFn;
    },
    request: {
      resourceLogs: [
        {
          resource: RESOURCE,
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: TIME_UNIX_NANO,
                  severityNumber: "SEVERITY_NUMBER_WARN",
                  severityText: "WARN",
                  body: { stringValue: "disk 91% full" },
                },
              ],
            },
          ],
        },
      ],
    },
    expectedBody: {
      resourceLogs: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: {
                  stringValue: "live-grpc-exporter",
                  value: "stringValue",
                },
              },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: TIME_UNIX_NANO,
                  severityNumber: "SEVERITY_NUMBER_WARN",
                  severityText: "WARN",
                  body: { stringValue: "disk 91% full", value: "stringValue" },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "metrics",
    protoFile: "metrics_service.proto",
    packagePath: [
      "opentelemetry",
      "proto",
      "collector",
      "metrics",
      "v1",
      "MetricsService",
    ],
    product: ProductType.Metrics,
    getQueue: (): MockedFn => {
      return MetricsQueueService.addMetricIngestJob as unknown as MockedFn;
    },
    request: {
      resourceMetrics: [
        {
          resource: RESOURCE,
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "http.server.requests",
                  sum: {
                    aggregationTemporality:
                      "AGGREGATION_TEMPORALITY_CUMULATIVE",
                    isMonotonic: true,
                    dataPoints: [{ timeUnixNano: TIME_UNIX_NANO, asInt: "42" }],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    expectedBody: {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: {
                  stringValue: "live-grpc-exporter",
                  value: "stringValue",
                },
              },
            ],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "http.server.requests",
                  data: "sum",
                  sum: {
                    /*
                     * The gRPC producer hands the worker the enum NAME, not
                     * the OTLP/JSON integer 2 — the other half of FIX 1's
                     * "both forms reach ingest" premise.
                     */
                    aggregationTemporality:
                      "AGGREGATION_TEMPORALITY_CUMULATIVE",
                    isMonotonic: true,
                    dataPoints: [
                      {
                        timeUnixNano: TIME_UNIX_NANO,
                        asInt: "42",
                        value: "asInt",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "profiles",
    protoFile: "profiles_service.proto",
    packagePath: [
      "opentelemetry",
      "proto",
      "collector",
      "profiles",
      "v1development",
      "ProfilesService",
    ],
    product: ProductType.Profiles,
    getQueue: (): MockedFn => {
      return ProfilesQueueService.addProfileIngestJob as unknown as MockedFn;
    },
    request: {
      resourceProfiles: [
        {
          resource: RESOURCE,
          scopeProfiles: [
            {
              profiles: [
                {
                  profileId: PROFILE_ID,
                  timeUnixNano: TIME_UNIX_NANO,
                  durationNano: "10000000000",
                },
              ],
            },
          ],
        },
      ],
      dictionary: { stringTable: ["", "cpu", "nanoseconds"] },
    },
    expectedBody: {
      resourceProfiles: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: {
                  stringValue: "live-grpc-exporter",
                  value: "stringValue",
                },
              },
            ],
          },
          scopeProfiles: [
            {
              profiles: [
                {
                  profileId: PROFILE_ID,
                  timeUnixNano: TIME_UNIX_NANO,
                  durationNano: "10000000000",
                },
              ],
            },
          ],
        },
      ],
      dictionary: { stringTable: ["", "cpu", "nanoseconds"] },
    },
  },
];

const getPolicyResolverMock: () => MockedFn = (): MockedFn => {
  return TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockedFn;
};

const assertNothingEnqueued: () => void = (): void => {
  for (const signal of signals) {
    expect(signal.getQueue()).not.toHaveBeenCalled();
  }
};

/*
 * A healthy legacy Server key. Every refusal case below changes exactly one
 * field of this, so a refusal can only be attributed to that field.
 */
type BuildPolicyFunction = (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
) => TelemetryIngestionKeyPolicy;

const buildServerKeyPolicy: BuildPolicyFunction = (
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): TelemetryIngestionKeyPolicy => {
  return {
    ingestionKeyId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ...overrides,
  };
};

type SentinelTokenFunction = (label: string) => string;

const sentinelToken: SentinelTokenFunction = (label: string): string => {
  return `sentinel-live-grpc-${label}-${ObjectID.generate().toString()}`;
};

/*
 * ---------------------------------------------------------------------------
 * The refusal reasons. `policy` is what the resolver answers for the
 * presented token; `token: null` means no credential header is sent at all,
 * in which case the resolver must not even be consulted.
 * ---------------------------------------------------------------------------
 */
interface RefusalCase {
  reason: string;
  token: string | null;
  policy: TelemetryIngestionKeyPolicy | null;
  /*
   * The reply is deliberately the same for every reason, so this server log
   * line is the ONLY place the reason exists. For a resolved-but-refused key
   * it names the key id (what an operator searches the dashboard with) and
   * the guard's closed-vocabulary reason, and never the token.
   */
  expectedLogLine: string;
}

type RefusedPolicyCaseFunction = (data: {
  reason: string;
  label: string;
  overrides: Partial<TelemetryIngestionKeyPolicy>;
  loggedReason: string;
}) => RefusalCase;

const refusedPolicyCase: RefusedPolicyCaseFunction = (data: {
  reason: string;
  label: string;
  overrides: Partial<TelemetryIngestionKeyPolicy>;
  loggedReason: string;
}): RefusalCase => {
  const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy(
    data.overrides,
  );
  return {
    reason: data.reason,
    token: sentinelToken(data.label),
    policy,
    expectedLogLine: `gRPC: Ingestion key ${policy.ingestionKeyId.toString()} refused: ${data.loggedReason}.`,
  };
};

type BuildRefusalCasesFunction = () => Array<RefusalCase>;

const buildRefusalCases: BuildRefusalCasesFunction = (): Array<RefusalCase> => {
  return [
    {
      reason: "missing token",
      token: null,
      policy: null,
      expectedLogLine: "gRPC: Missing metadata: x-oneuptime-token",
    },
    {
      reason: "unknown token",
      token: sentinelToken("unknown"),
      policy: null,
      expectedLogLine: "gRPC: Invalid service token.",
    },
    refusedPolicyCase({
      reason: "disabled key",
      label: "disabled",
      overrides: { isEnabled: false },
      loggedReason: "disabled",
    }),
    refusedPolicyCase({
      reason: "expired key",
      label: "expired",
      overrides: { expiresAt: new Date(Date.now() - 60 * 1000) },
      loggedReason: "expired",
    }),
    /*
     * A correctly configured Browser key — origin allowlist set, service
     * name pinned — so the refusal is about the gRPC surface alone. No
     * browser can speak gRPC, so this key was scraped and replayed.
     */
    refusedPolicyCase({
      reason: "browser key",
      label: "browser",
      overrides: {
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: ["https://shop.example.com"],
        pinnedServiceName: "shop-frontend",
      },
      loggedReason: "surface-not-allowed-for-browser-key",
    }),
  ];
};

const REFUSAL_REASONS: Array<string> = buildRefusalCases().map(
  (refusal: RefusalCase): string => {
    return refusal.reason;
  },
);

/*
 * ---------------------------------------------------------------------------
 * Live-call plumbing.
 * ---------------------------------------------------------------------------
 */
interface ExportOutcome {
  error: grpc.ServiceError | null;
  response: Record<string, unknown> | undefined;
  // The final status event: code, details and trailing metadata.
  status: grpc.StatusObject;
  // Response headers, when the server sent any before the trailers.
  headers: grpc.Metadata | null;
}

let liveServer: grpc.Server | null = null;
let requestedBindAddress: string | null = null;
let boundPort: number = 0;
let startupInfoLines: Array<unknown> = [];
const clients: Map<string, OtlpExportClient> = new Map();
/*
 * Same services, but every message gzip-compressed: the OpenTelemetry
 * Collector's otlp (gRPC) exporter defaults to `compression: gzip`, so this
 * is the wire shape a migrated collector actually sends.
 */
const gzipClients: Map<string, OtlpExportClient> = new Map();

type MakeMetadataFunction = (entries: Array<[string, string]>) => grpc.Metadata;

const makeMetadata: MakeMetadataFunction = (
  entries: Array<[string, string]>,
): grpc.Metadata => {
  const metadata: grpc.Metadata = new grpc.Metadata();
  for (const [key, value] of entries) {
    metadata.set(key, value);
  }
  return metadata;
};

type TokenMetadataFunction = (
  token: string | null,
  header?: string,
) => grpc.Metadata;

/*
 * Every call also carries a non-secret header the worker does consume, so
 * a success test can see the whitelist pass it through while the token is
 * stripped.
 */
const tokenMetadata: TokenMetadataFunction = (
  token: string | null,
  header: string = "x-oneuptime-token",
): grpc.Metadata => {
  const entries: Array<[string, string]> = [
    ["x-oneuptime-service-name", "live-grpc-exporter"],
  ];
  if (token !== null) {
    entries.push([header, token]);
  }
  return makeMetadata(entries);
};

type ExportFunction = (
  signal: Signal,
  metadata: grpc.Metadata,
  clientSet?: Map<string, OtlpExportClient>,
) => Promise<ExportOutcome>;

const callExport: ExportFunction = (
  signal: Signal,
  metadata: grpc.Metadata,
  clientSet: Map<string, OtlpExportClient> = clients,
): Promise<ExportOutcome> => {
  const client: OtlpExportClient = clientSet.get(signal.name)!;

  return new Promise<ExportOutcome>(
    (resolve: (outcome: ExportOutcome) => void): void => {
      let error: grpc.ServiceError | null = null;
      let response: Record<string, unknown> | undefined = undefined;
      let headers: grpc.Metadata | null = null;
      let callbackDone: boolean = false;
      let status: grpc.StatusObject | null = null;

      const settle: () => void = (): void => {
        if (callbackDone && status) {
          resolve({ error, response, status, headers });
        }
      };

      const call: grpc.ClientUnaryCall = client.Export(
        signal.request,
        metadata,
        { deadline: Date.now() + CALL_DEADLINE_MS },
        (
          callError: grpc.ServiceError | null,
          callResponse?: Record<string, unknown>,
        ): void => {
          error = callError;
          response = callResponse;
          callbackDone = true;
          settle();
        },
      );

      call.on("metadata", (received: grpc.Metadata): void => {
        headers = received;
      });

      call.on("status", (received: grpc.StatusObject): void => {
        status = received;
        settle();
      });
    },
  );
};

/*
 * A refusal is a trailers-only response, so grpc-js hands the client the
 * whole HTTP/2 header block as the status metadata — including the two
 * headers the transport writes on its own (content-type, and the `date`
 * Node's http2 stamps on every response). Those are not the application's.
 * Everything else is, and handleExport passes an empty grpc.Metadata, so
 * everything else must be empty.
 */
const TRANSPORT_HEADER_KEYS: ReadonlyArray<string> = ["content-type", "date"];

type ApplicationMetadataFunction = (
  metadata: grpc.Metadata,
) => Record<string, grpc.MetadataValue>;

const applicationMetadata: ApplicationMetadataFunction = (
  metadata: grpc.Metadata,
): Record<string, grpc.MetadataValue> => {
  const map: Record<string, grpc.MetadataValue> = { ...metadata.getMap() };
  for (const key of TRANSPORT_HEADER_KEYS) {
    delete map[key];
  }
  return map;
};

type IsRetryableFunction = (code: grpc.status) => boolean;

const isRetryableForOtlpExporter: IsRetryableFunction = (
  code: grpc.status,
): boolean => {
  return OTLP_RETRYABLE_GRPC_STATUS_CODES.includes(code);
};

/*
 * Everything the client can observe about a call besides the payload, as
 * one string: details, the formatted error message, the status trailers and
 * any response headers. A token anywhere in here reached the exporter.
 */
type ObservableTextFunction = (outcome: ExportOutcome) => string;

const clientObservableText: ObservableTextFunction = (
  outcome: ExportOutcome,
): string => {
  return [
    outcome.status.details,
    outcome.error?.message ?? "",
    outcome.error?.details ?? "",
    JSON.stringify(outcome.status.metadata.toJSON()),
    JSON.stringify(outcome.error?.metadata?.toJSON() ?? {}),
    JSON.stringify(outcome.headers?.toJSON() ?? {}),
  ].join("\n");
};

/*
 * Every logger call at every level, flattened. Errors are expanded by hand
 * because JSON.stringify(new Error("x")) is "{}", which would let a "token is
 * not in the log" assertion pass whatever was logged.
 */
type LogTranscriptFunction = () => string;

const logTranscript: LogTranscriptFunction = (): string => {
  return [logger.error, logger.warn, logger.info, logger.debug]
    .map((fn: unknown): string => {
      return (fn as MockedFn).mock.calls
        .flat()
        .map((arg: unknown): string => {
          if (arg instanceof Error) {
            return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`;
          }
          return typeof arg === "string" ? arg : JSON.stringify(arg);
        })
        .join("\n");
    })
    .join("\n");
};

type ArrangeRefusalFunction = (refusal: RefusalCase) => grpc.Metadata;

const arrangeRefusal: ArrangeRefusalFunction = (
  refusal: RefusalCase,
): grpc.Metadata => {
  getPolicyResolverMock().mockResolvedValue(refusal.policy);
  return tokenMetadata(refusal.token);
};

/*
 * ---------------------------------------------------------------------------
 * Server lifecycle.
 * ---------------------------------------------------------------------------
 */
beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  /*
   * Let startGrpcServer build and register everything exactly as it does in
   * production, then redirect ONLY the listen address: port 4317 on every
   * interface becomes an ephemeral loopback port, so the suite cannot
   * collide with a running collector or a parallel jest worker. The
   * production bind callback still runs, so its logging stays covered.
   */
  const realBindAsync: grpc.Server["bindAsync"] =
    grpc.Server.prototype.bindAsync;
  const bindSpy: jest.SpyInstance = jest.spyOn(
    grpc.Server.prototype,
    "bindAsync",
  );
  const bound: Promise<number> = new Promise<number>(
    (resolve: (port: number) => void, reject: (error: Error) => void): void => {
      bindSpy.mockImplementation(function (
        this: grpc.Server,
        address: string,
        credentials: grpc.ServerCredentials,
        productionCallback: (error: Error | null, port: number) => void,
      ): void {
        requestedBindAddress = address;
        realBindAsync.call(
          this,
          "127.0.0.1:0",
          credentials,
          (error: Error | null, port: number): void => {
            productionCallback(error, port);
            if (error) {
              reject(error);
              return;
            }
            resolve(port);
          },
        );
      });
    },
  );

  startGrpcServer();
  boundPort = await bound;
  // The `this` of the one bindAsync call is the production server instance.
  expect(bindSpy).toHaveBeenCalledTimes(1);
  liveServer = bindSpy.mock.contexts[0] as grpc.Server;
  // Kept before any beforeEach clears the spies' call history.
  startupInfoLines = (logger.info as unknown as MockedFn).mock.calls.map(
    (args: Array<unknown>): unknown => {
      return args[0];
    },
  );

  for (const signal of signals) {
    const definition: protoLoader.PackageDefinition = protoLoader.loadSync(
      path.join(PROTO_DIR, signal.protoFile),
      OTLP_PROTO_LOADER_OPTIONS,
    );
    let node: unknown = grpc.loadPackageDefinition(definition);
    for (const key of signal.packagePath) {
      node = (node as Record<string, unknown>)[key];
    }
    const ClientConstructor: grpc.ServiceClientConstructor =
      node as grpc.ServiceClientConstructor;
    clients.set(
      signal.name,
      new ClientConstructor(
        `127.0.0.1:${boundPort}`,
        grpc.credentials.createInsecure(),
      ) as unknown as OtlpExportClient,
    );
    gzipClients.set(
      signal.name,
      new ClientConstructor(
        `127.0.0.1:${boundPort}`,
        grpc.credentials.createInsecure(),
        {
          "grpc.default_compression_algorithm": grpc.compressionAlgorithms.gzip,
        },
      ) as unknown as OtlpExportClient,
    );
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  getPolicyResolverMock().mockReset();
  for (const signal of signals) {
    signal.getQueue().mockReset();
    signal.getQueue().mockResolvedValue(undefined);
  }
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
});

afterAll(async () => {
  for (const clientSet of [clients, gzipClients]) {
    for (const client of clientSet.values()) {
      client.close();
    }
    clientSet.clear();
  }

  const server: grpc.Server | null = liveServer;
  if (server) {
    await new Promise<void>((resolve: () => void): void => {
      server.tryShutdown((error?: Error): void => {
        if (error) {
          server.forceShutdown();
        }
        resolve();
      });
    });
  }

  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * The harness itself: prove this is the production server on a real port.
 * ---------------------------------------------------------------------------
 */
describe("live gRPC harness", () => {
  test("runs the production server, which asked for 0.0.0.0:4317 and is listening on a loopback port", () => {
    expect(requestedBindAddress).toBe("0.0.0.0:4317");
    expect(liveServer).toBeInstanceOf(grpc.Server);
    expect(boundPort).toBeGreaterThan(0);
    expect(boundPort).not.toBe(4317);
    expect(clients.size).toBe(4);
    expect(gzipClients.size).toBe(4);
    // The production bind callback ran, and reported the port it really got.
    expect(startupInfoLines).toContain(
      `gRPC OTLP server started on port: ${boundPort}`,
    );
  });

  test("the retryable-code list is the spec's, and neither end of FIX 3 sits on the wrong side of it", () => {
    expect(isRetryableForOtlpExporter(grpc.status.UNAUTHENTICATED)).toBe(false);
    expect(isRetryableForOtlpExporter(grpc.status.PERMISSION_DENIED)).toBe(
      false,
    );
    expect(isRetryableForOtlpExporter(grpc.status.UNAVAILABLE)).toBe(true);
    expect(isRetryableForOtlpExporter(grpc.status.OK)).toBe(false);
    expect(new Set(OTLP_RETRYABLE_GRPC_STATUS_CODES).size).toBe(7);
  });
});

describe.each(signals)("live gRPC $name Export", (signal: Signal) => {
  /*
   * -------------------------------------------------------------------------
   * Refused credentials.
   * -------------------------------------------------------------------------
   */
  test.each(REFUSAL_REASONS)(
    "refused credential (%s) is answered UNAUTHENTICATED (non-retryable), leaks nothing and enqueues nothing",
    async (reason: string) => {
      const refusal: RefusalCase = buildRefusalCases().find(
        (candidate: RefusalCase): boolean => {
          return candidate.reason === reason;
        },
      )!;

      const outcome: ExportOutcome = await callExport(
        signal,
        arrangeRefusal(refusal),
      );

      // The exporter receives a status, not a success with an empty body.
      expect(outcome.response).toBeUndefined();
      expect(outcome.error).not.toBeNull();
      expect(outcome.error!.code).toBe(grpc.status.UNAUTHENTICATED);
      expect(outcome.error!.details).toBe(UNAUTHENTICATED_DETAILS);
      expect(outcome.error!.message).toBe(
        `${grpc.status.UNAUTHENTICATED} UNAUTHENTICATED: ${UNAUTHENTICATED_DETAILS}`,
      );
      expect(outcome.status.code).toBe(grpc.status.UNAUTHENTICATED);
      expect(outcome.status.details).toBe(UNAUTHENTICATED_DETAILS);

      /*
       * The server sends empty metadata, so beyond the transport's own
       * headers the trailers carry nothing — no key id, no project, no
       * refusal reason, no echo of the presented header.
       */
      expect(applicationMetadata(outcome.status.metadata)).toEqual({});
      expect(applicationMetadata(outcome.error!.metadata)).toEqual({});
      expect(outcome.status.metadata.get("content-type")).toEqual([
        "application/grpc+proto",
      ]);

      // Non-retryable: the exporter drops the batch and logs the reason.
      expect(isRetryableForOtlpExporter(outcome.error!.code)).toBe(false);

      if (refusal.token !== null) {
        expect(clientObservableText(outcome)).not.toContain(refusal.token);
        expect(logTranscript()).not.toContain(refusal.token);
        expect(getPolicyResolverMock()).toHaveBeenCalledTimes(1);
        expect(getPolicyResolverMock()).toHaveBeenCalledWith(refusal.token);
      } else {
        // No credential header at all: refused before any lookup.
        expect(getPolicyResolverMock()).not.toHaveBeenCalled();
      }

      /*
       * The reply is deliberately uninformative, so the error log is the
       * only place the reason lives.
       */
      expect(logger.error).toHaveBeenCalledWith(refusal.expectedLogLine, {
        service: "telemetry",
      });

      assertNothingEnqueued();
    },
  );

  test("an empty-valued token header is treated as missing: UNAUTHENTICATED without a lookup", async () => {
    const outcome: ExportOutcome = await callExport(
      signal,
      makeMetadata([
        ["x-oneuptime-token", ""],
        ["x-oneuptime-service-token", ""],
        ["x-oneuptime-ingestion-key", ""],
      ]),
    );

    expect(outcome.error?.code).toBe(grpc.status.UNAUTHENTICATED);
    expect(outcome.error?.details).toBe(UNAUTHENTICATED_DETAILS);
    expect(getPolicyResolverMock()).not.toHaveBeenCalled();
    assertNothingEnqueued();
  });

  test.each(TOKEN_HEADERS)(
    "a refused key presented via %s gets the same UNAUTHENTICATED reply",
    async (header: string) => {
      const token: string = sentinelToken("refused-via-header");
      getPolicyResolverMock().mockResolvedValue(
        buildServerKeyPolicy({ isEnabled: false }),
      );

      const outcome: ExportOutcome = await callExport(
        signal,
        tokenMetadata(token, header),
      );

      expect(outcome.error?.code).toBe(grpc.status.UNAUTHENTICATED);
      expect(outcome.error?.details).toBe(UNAUTHENTICATED_DETAILS);
      expect(applicationMetadata(outcome.status.metadata)).toEqual({});
      expect(clientObservableText(outcome)).not.toContain(token);
      expect(getPolicyResolverMock()).toHaveBeenCalledWith(token);
      assertNothingEnqueued();
    },
  );

  /*
   * -------------------------------------------------------------------------
   * Accepted credentials: the fix must not have tightened the happy path.
   * -------------------------------------------------------------------------
   */
  test.each(TOKEN_HEADERS)(
    "a valid Server key via %s is answered OK and enqueued exactly once for its project",
    async (header: string) => {
      const token: string = sentinelToken("valid");
      const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy();
      getPolicyResolverMock().mockResolvedValue(policy);

      const outcome: ExportOutcome = await callExport(
        signal,
        tokenMetadata(token, header),
      );

      expect(outcome.error).toBeNull();
      expect(outcome.response).toEqual({});
      expect(outcome.status.code).toBe(grpc.status.OK);
      expect(clientObservableText(outcome)).not.toContain(token);
      expect(getPolicyResolverMock()).toHaveBeenCalledTimes(1);
      expect(getPolicyResolverMock()).toHaveBeenCalledWith(token);

      const queue: MockedFn = signal.getQueue();
      expect(queue).toHaveBeenCalledTimes(1);
      const queued: TelemetryRequest = queue.mock.calls[0]![0];
      expect(queued.projectId).toBe(policy.projectId);
      expect(queued.productType).toBe(signal.product);
      expect(queued.path).toBe(`/otlp/v1/${signal.product}`);
      expect(queued.body).toMatchObject(signal.expectedBody);
      /*
       * The job payload is serialized into Redis; the ingestion key must not
       * ride along with it, whichever header carried it.
       */
      expect(queued.headers).toEqual({
        "x-oneuptime-service-name": "live-grpc-exporter",
      });
      expect(JSON.stringify(queued.headers)).not.toContain(token);

      // The batch went to this signal's queue and no other.
      for (const other of signals) {
        if (other.name !== signal.name) {
          expect(other.getQueue()).not.toHaveBeenCalled();
        }
      }
    },
  );

  test("a key whose expiry is still in the future is accepted", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy({
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    getPolicyResolverMock().mockResolvedValue(policy);

    const outcome: ExportOutcome = await callExport(
      signal,
      tokenMetadata(sentinelToken("future-expiry")),
    );

    expect(outcome.error).toBeNull();
    expect(outcome.status.code).toBe(grpc.status.OK);
    expect(signal.getQueue()).toHaveBeenCalledTimes(1);
    expect(signal.getQueue().mock.calls[0]![0].projectId).toBe(
      policy.projectId,
    );
  });

  test("a mixed-case header name, as typed into a collector config, still authenticates", async () => {
    const token: string = sentinelToken("mixed-case");
    const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy();
    getPolicyResolverMock().mockResolvedValue(policy);

    const outcome: ExportOutcome = await callExport(
      signal,
      makeMetadata([["X-OneUptime-Token", token]]),
    );

    expect(outcome.error).toBeNull();
    expect(getPolicyResolverMock()).toHaveBeenCalledWith(token);
    expect(signal.getQueue()).toHaveBeenCalledTimes(1);
  });

  type GzipScenarioFunction = () => Promise<void>;

  // A refused then an accepted export, both over the gzip clients.
  const exportGzipRefusedThenAccepted: GzipScenarioFunction =
    async (): Promise<void> => {
      getPolicyResolverMock().mockResolvedValue(null);
      const refusedToken: string = sentinelToken("gzip-refused");
      const refused: ExportOutcome = await callExport(
        signal,
        tokenMetadata(refusedToken),
        gzipClients,
      );
      expect(refused.error?.code).toBe(grpc.status.UNAUTHENTICATED);
      expect(refused.error?.details).toBe(UNAUTHENTICATED_DETAILS);
      expect(applicationMetadata(refused.status.metadata)).toEqual({});
      expect(clientObservableText(refused)).not.toContain(refusedToken);
      assertNothingEnqueued();

      const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy();
      getPolicyResolverMock().mockResolvedValue(policy);
      const accepted: ExportOutcome = await callExport(
        signal,
        tokenMetadata(sentinelToken("gzip-accepted")),
        gzipClients,
      );
      expect(accepted.error).toBeNull();
      expect(accepted.response).toEqual({});
      expect(signal.getQueue()).toHaveBeenCalledTimes(1);
      const queued: TelemetryRequest = signal.getQueue().mock.calls[0]![0];
      expect(queued.projectId).toBe(policy.projectId);
      expect(queued.body).toMatchObject(signal.expectedBody);
    };

  test("a gzip-compressed export (the Collector's default) is refused and accepted exactly like an uncompressed one", async () => {
    /*
     * Count the server's gzip decompressions, so the test proves the
     * messages really arrived compressed rather than trusting the client
     * option. Wrapped by hand: Node defines zlib.createGunzip non-writable
     * (but configurable), which jest.spyOn cannot restore.
     */
    const originalGunzip: PropertyDescriptor = Object.getOwnPropertyDescriptor(
      zlib,
      "createGunzip",
    )!;
    const realCreateGunzip: typeof zlib.createGunzip = zlib.createGunzip;
    let gunzipCalls: number = 0;
    Object.defineProperty(zlib, "createGunzip", {
      ...originalGunzip,
      value: (options?: zlib.ZlibOptions): zlib.Gunzip => {
        gunzipCalls += 1;
        return realCreateGunzip(options);
      },
    });

    try {
      await exportGzipRefusedThenAccepted();
    } finally {
      Object.defineProperty(zlib, "createGunzip", originalGunzip);
    }

    // One decompression per request; responses come back uncompressed.
    expect(gunzipCalls).toBe(2);
  });

  /*
   * -------------------------------------------------------------------------
   * The other non-OK and deliberately-OK branches of handleExport.
   * -------------------------------------------------------------------------
   */
  test.each(["reject", "throw"])(
    "a queue that fails to admit (%s) is answered UNAVAILABLE — retryable — once, without a client-side resend",
    async (mode: string) => {
      getPolicyResolverMock().mockResolvedValue(buildServerKeyPolicy());
      signal.getQueue().mockImplementation(() => {
        const failure: Error = new Error("redis-backend-detail-must-not-leak");
        if (mode === "throw") {
          throw failure;
        }
        return Promise.reject(failure);
      });
      const token: string = sentinelToken("queue-failure");

      const outcome: ExportOutcome = await callExport(
        signal,
        tokenMetadata(token),
      );

      expect(outcome.response).toBeUndefined();
      expect(outcome.error?.code).toBe(grpc.status.UNAVAILABLE);
      expect(outcome.error?.details).toBe(QUEUE_UNAVAILABLE_DETAILS);
      expect(applicationMetadata(outcome.status.metadata)).toEqual({});
      expect(isRetryableForOtlpExporter(outcome.error!.code)).toBe(true);
      expect(clientObservableText(outcome)).not.toContain(
        "redis-backend-detail-must-not-leak",
      );
      expect(clientObservableText(outcome)).not.toContain(token);
      /*
       * Exactly one admission attempt: the retry belongs to the exporter's
       * own backoff, not to a transparent grpc-js resend.
       */
      expect(signal.getQueue()).toHaveBeenCalledTimes(1);
      expect(logTranscript()).toContain("redis-backend-detail-must-not-leak");
    },
  );

  test("DISABLE_TELEMETRY_INGESTION answers OK and enqueues nothing, before any key lookup", async () => {
    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(true);
    getPolicyResolverMock().mockResolvedValue(buildServerKeyPolicy());

    const withKey: ExportOutcome = await callExport(
      signal,
      tokenMetadata(sentinelToken("disabled-ingestion")),
    );
    /*
     * Even a request that would be refused is dropped silently: the switch
     * is checked first, so a paused install never looks like an auth fault.
     */
    const withoutKey: ExportOutcome = await callExport(
      signal,
      tokenMetadata(null),
    );

    for (const outcome of [withKey, withoutKey]) {
      expect(outcome.error).toBeNull();
      expect(outcome.response).toEqual({});
      expect(outcome.status.code).toBe(grpc.status.OK);
    }
    expect(getPolicyResolverMock()).not.toHaveBeenCalled();
    assertNothingEnqueued();
  });

  test("an auth backend that throws is answered OK (documented: no retry storm on a degraded backend) and enqueues nothing", async () => {
    getPolicyResolverMock().mockRejectedValue(
      new Error("postgres-connection-refused"),
    );
    const token: string = sentinelToken("auth-backend-down");

    const outcome: ExportOutcome = await callExport(
      signal,
      tokenMetadata(token),
    );

    expect(outcome.error).toBeNull();
    expect(outcome.response).toEqual({});
    expect(outcome.status.code).toBe(grpc.status.OK);
    expect(outcome.status.details).not.toContain("postgres-connection-refused");
    expect(clientObservableText(outcome)).not.toContain(token);
    expect(getPolicyResolverMock()).toHaveBeenCalledTimes(1);
    assertNothingEnqueued();
    expect(logTranscript()).toContain("postgres-connection-refused");
  });

  test("a PaymentRequiredException from the auth path is answered PERMISSION_DENIED (non-retryable) and enqueues nothing", async () => {
    getPolicyResolverMock().mockRejectedValue(
      new PaymentRequiredException("Upgrade to a paid plan to ingest."),
    );

    const outcome: ExportOutcome = await callExport(
      signal,
      tokenMetadata(sentinelToken("payment-required")),
    );

    expect(outcome.error?.code).toBe(grpc.status.PERMISSION_DENIED);
    expect(outcome.error?.details).toBe("Upgrade to a paid plan to ingest.");
    expect(isRetryableForOtlpExporter(outcome.error!.code)).toBe(false);
    assertNothingEnqueued();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Cross-signal: the reply must not be an oracle.
 * ---------------------------------------------------------------------------
 */
describe("live gRPC refusal reply is identical across reasons, headers and signals", () => {
  test("every refusal reason, via every header, on every signal, yields one byte-identical status", async () => {
    interface ObservedStatus {
      code: grpc.status;
      details: string;
      message: string;
      trailers: string;
    }

    const observed: Array<ObservedStatus> = [];
    const presentedTokens: Array<string> = [];

    for (const signal of signals) {
      for (const refusal of buildRefusalCases()) {
        const headers: Array<string> =
          refusal.token === null ? ["x-oneuptime-token"] : TOKEN_HEADERS;
        for (const header of headers) {
          getPolicyResolverMock().mockResolvedValue(refusal.policy);
          const token: string | null =
            refusal.token === null ? null : `${refusal.token}-${header}`;
          if (token !== null) {
            presentedTokens.push(token);
          }

          const outcome: ExportOutcome = await callExport(
            signal,
            tokenMetadata(token, header),
          );

          observed.push({
            code: outcome.status.code,
            details: outcome.status.details,
            message: outcome.error?.message ?? "",
            /*
             * Transport headers excluded: `date` ticks every second, and
             * would make identical replies look different across a
             * second boundary.
             */
            trailers: JSON.stringify(
              applicationMetadata(outcome.status.metadata),
            ),
          });
        }
      }
    }

    // 4 signals x (1 missing + 4 presented reasons x 3 headers).
    expect(observed).toHaveLength(4 * (1 + 4 * 3));
    const distinct: Set<string> = new Set(
      observed.map((status: ObservedStatus): string => {
        return JSON.stringify(status);
      }),
    );
    expect(distinct.size).toBe(1);
    expect(observed[0]).toEqual({
      code: grpc.status.UNAUTHENTICATED,
      details: UNAUTHENTICATED_DETAILS,
      message: `${grpc.status.UNAUTHENTICATED} UNAUTHENTICATED: ${UNAUTHENTICATED_DETAILS}`,
      trailers: "{}",
    });

    const transcript: string = logTranscript();
    for (const token of presentedTokens) {
      expect(transcript).not.toContain(token);
    }
    assertNothingEnqueued();
  });

  test("the server keeps serving after a burst of refusals: a valid key right after is accepted on every signal", async () => {
    for (const signal of signals) {
      getPolicyResolverMock().mockResolvedValue(null);
      const refused: ExportOutcome = await callExport(
        signal,
        tokenMetadata(sentinelToken("burst-refused")),
      );
      expect(refused.status.code).toBe(grpc.status.UNAUTHENTICATED);

      const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy();
      getPolicyResolverMock().mockResolvedValue(policy);
      const accepted: ExportOutcome = await callExport(
        signal,
        tokenMetadata(sentinelToken("burst-accepted")),
      );
      expect(accepted.status.code).toBe(grpc.status.OK);
      expect(signal.getQueue()).toHaveBeenCalledTimes(1);
      expect(signal.getQueue().mock.calls[0]![0].projectId).toBe(
        policy.projectId,
      );
    }
  });
});
