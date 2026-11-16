import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import protobuf from "protobufjs";
import OTelIngestAPI from "../../FeatureSet/Telemetry/API/OTelIngest";
import {
  OTLP_PROTO_LOADER_OPTIONS,
  startGrpcServer,
} from "../../FeatureSet/Telemetry/GrpcServer";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import TelemetryIngestionBudget from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

/*
 * ONE RULE FOR "THIS KEY IS IN USE", OVER EVERY OTLP PROTOCOL (issue #8021).
 *
 * An ingestion key's Last Used At is what the Dashboard and the telemetry
 * guides' first-data wait read. The OTLP gRPC server marks the key used once
 * the queue has taken the export (issue #7887). The HTTP ingest middleware
 * marked it the moment a request passed the guard, before its route had
 * queued anything, so an export the queue then refused - answered 503, for
 * the sender to retry - had already marked its key used. Now the middleware
 * marks it when the route answers with a success, and an OTLP route answers
 * 200 only once the queue has taken the export.
 *
 * This suite holds the three ways an OpenTelemetry exporter sends to
 * OneUptime - OTLP/HTTP with a JSON body, OTLP/HTTP with a protobuf body,
 * and OTLP/gRPC - to that one rule, for each of the four signals, through
 * one table of cases:
 *
 *   - an export the queue takes marks the key that sent it, once, and not
 *     before the queue has taken it;
 *   - an export the queue or the body store refuses (answered 503 /
 *     UNAVAILABLE), a refused key (no key, an unknown, switched-off or
 *     expired one) and an export over an ingestion budget mark nothing;
 *   - after a refused export, the retry the queue takes is what marks it.
 *
 * Everything between the socket and the queue is the production code: the
 * App's global body parsers and error handler, the OTLP router on its real
 * routes, the ingest guard, the ingest services and the queue producer, and
 * startGrpcServer's own server on a loopback port with clients built from
 * the same .proto files an exporter compiles. Replaced: the key lookup and
 * the stamp's database write (TelemetryIngestionKeyService), Redis (the body
 * store and Queue.addJob, which is where "the queue took the export" is
 * decided for both protocols) and the refusal counter's batch writer.
 */

const TOKEN: string = "8021a000-0000-4000-8000-000000000001";
const UNKNOWN_TOKEN: string = "8021a000-0000-4000-8000-0000000000ff";

// Generous, but far below the jest timeout, so a hang fails as a status.
const CALL_DEADLINE_MS: number = 10000;

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

const TIME_UNIX_NANO: string = "1758800000123456789";
const END_TIME_UNIX_NANO: string = "1758800000623456789";

const RESOURCE: JSONObject = {
  attributes: [
    { key: "service.name", value: { stringValue: "key-last-used-exporter" } },
  ],
};

interface Signal {
  name: "traces" | "metrics" | "logs" | "profiles";
  protoFile: string;
  requestTypeName: string;
  serviceName: string;
  // A small but real export request, in OTLP's JSON mapping.
  payload: JSONObject;
}

const SIGNALS: Array<Signal> = [
  {
    name: "traces",
    protoFile: "trace_service.proto",
    requestTypeName:
      "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
    serviceName: "opentelemetry.proto.collector.trace.v1.TraceService",
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
                  kind: 2,
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
    name: "metrics",
    protoFile: "metrics_service.proto",
    requestTypeName:
      "opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest",
    serviceName: "opentelemetry.proto.collector.metrics.v1.MetricsService",
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
  },
  {
    name: "logs",
    protoFile: "logs_service.proto",
    requestTypeName:
      "opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest",
    serviceName: "opentelemetry.proto.collector.logs.v1.LogsService",
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
  },
  {
    name: "profiles",
    protoFile: "profiles_service.proto",
    requestTypeName:
      "opentelemetry.proto.collector.profiles.v1development.ExportProfilesServiceRequest",
    serviceName:
      "opentelemetry.proto.collector.profiles.v1development.ProfilesService",
    payload: {
      resourceProfiles: [
        {
          resource: RESOURCE,
          scopeProfiles: [{ profiles: [] }],
        },
      ],
    },
  },
];

/*
 * ---------------------------------------------------------------------------
 * The three protocols, each reduced to "send this signal with this token, and
 * say how it was answered".
 * ---------------------------------------------------------------------------
 */

// How an export was answered, in the protocol's own terms.
type Answer = string;

interface Protocol {
  name: string;
  send: (signal: Signal, token: string | null) => Promise<Answer>;
  // The answer for each way an export can end.
  accepted: Answer;
  queueUnavailable: Answer;
  missingOrUnknownKey: Answer;
  disabledKey: Answer;
  expiredKey: Answer;
  overDailyBudget: Answer;
}

let httpServer: http.Server;
let httpPort: number;
let grpcServer: grpc.Server | null = null;
const grpcClients: Map<string, grpc.Client> = new Map();

/*
 * The server side of the last HTTP request, closed: by then the response's
 * "finish" listeners - the key stamp among them - have run.
 */
let serverResponseClosed: Promise<void> = Promise.resolve();

function requestType(signal: Signal): protobuf.Type {
  return protobuf
    .loadSync(path.join(PROTO_DIR, signal.protoFile))
    .lookupType(signal.requestTypeName);
}

function postHttp(data: {
  signal: Signal;
  token: string | null;
  contentType: string;
  body: Buffer;
}): Promise<Answer> {
  const headers: http.OutgoingHttpHeaders = {
    "content-type": data.contentType,
    "content-length": data.body.length,
  };

  if (data.token !== null) {
    headers["x-oneuptime-token"] = data.token;
  }

  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: httpPort,
          method: "POST",
          path: `/otlp/v1/${data.signal.name}`,
          headers: headers,
        },
        (response: http.IncomingMessage): void => {
          response.resume();
          response.on("end", (): void => {
            // The answer is only final once the server is done with it.
            void serverResponseClosed.then((): void => {
              resolve(`HTTP ${response.statusCode}`);
            });
          });
        },
      );
      request.on("error", reject);
      request.end(data.body);
    },
  );
}

const OTLP_HTTP_JSON: Protocol = {
  name: "OTLP/HTTP, JSON body",
  send: (signal: Signal, token: string | null): Promise<Answer> => {
    return postHttp({
      signal,
      token,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(signal.payload)),
    });
  },
  accepted: "HTTP 200",
  queueUnavailable: "HTTP 503",
  missingOrUnknownKey: "HTTP 401",
  disabledKey: "HTTP 422",
  expiredKey: "HTTP 401",
  overDailyBudget: "HTTP 403",
};

const OTLP_HTTP_PROTOBUF: Protocol = {
  name: "OTLP/HTTP, protobuf body",
  send: (signal: Signal, token: string | null): Promise<Answer> => {
    const type: protobuf.Type = requestType(signal);

    return postHttp({
      signal,
      token,
      contentType: "application/x-protobuf",
      body: Buffer.from(type.encode(type.fromObject(signal.payload)).finish()),
    });
  },
  accepted: "HTTP 200",
  queueUnavailable: "HTTP 503",
  missingOrUnknownKey: "HTTP 401",
  disabledKey: "HTTP 422",
  expiredKey: "HTTP 401",
  overDailyBudget: "HTTP 403",
};

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

const OTLP_GRPC: Protocol = {
  name: "OTLP/gRPC",
  send: (signal: Signal, token: string | null): Promise<Answer> => {
    const client: OtlpExportClient = grpcClients.get(
      signal.name,
    ) as OtlpExportClient;
    const metadata: grpc.Metadata = new grpc.Metadata();

    if (token !== null) {
      metadata.set("x-oneuptime-token", token);
    }

    return new Promise<Answer>((resolve: (answer: Answer) => void): void => {
      client.Export(
        signal.payload as Record<string, unknown>,
        metadata,
        { deadline: Date.now() + CALL_DEADLINE_MS },
        (error: grpc.ServiceError | null): void => {
          resolve(`gRPC ${grpc.status[error ? error.code : grpc.status.OK]}`);
        },
      );
    });
  },
  accepted: "gRPC OK",
  queueUnavailable: "gRPC UNAVAILABLE",
  missingOrUnknownKey: "gRPC UNAUTHENTICATED",
  disabledKey: "gRPC PERMISSION_DENIED",
  expiredKey: "gRPC UNAUTHENTICATED",
  overDailyBudget: "gRPC RESOURCE_EXHAUSTED",
};

const PROTOCOLS: Array<Protocol> = [
  OTLP_HTTP_JSON,
  OTLP_HTTP_PROTOBUF,
  OTLP_GRPC,
];

/*
 * ---------------------------------------------------------------------------
 * The key, the queue and the stamp.
 * ---------------------------------------------------------------------------
 */

let policy: TelemetryIngestionKeyPolicy;

// What Queue.addJob does with the next export: take it, refuse it, or hold it.
type QueueBehaviour =
  | { kind: "take" }
  | { kind: "refuse" }
  | { kind: "hold"; entered: () => void; release: Promise<void> };

let queueBehaviour: QueueBehaviour = { kind: "take" };
let isBodyStoreDown: boolean = false;
let queuedJobs: number = 0;

function buildPolicy(
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
    ...overrides,
  };
}

function markUsed(): jest.SpyInstance {
  return TelemetryIngestionKeyService.markUsed as unknown as jest.SpyInstance;
}

// The ids of the keys marked used since the test began.
function stampedKeyIds(): Array<string> {
  return markUsed().mock.calls.map((args: Array<unknown>): string => {
    return String(args[0]);
  });
}

function dailyBudgetRefusal(): TelemetryIngestionBudgetRefusal {
  return {
    kind: TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
    scope: TelemetryIngestionBudgetScope.Project,
    signal: ProductType.Logs,
    message: "This project's daily ingestion budget is used up.",
    retryAfterSeconds: null,
    resetsAt: new Date("2026-11-17T00:00:00Z"),
  };
}

beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  /*
   * Importing StartServer installed the real global body parsers on this
   * app; the OTLP router is mounted behind them, as the App mounts it.
   */
  const app: ExpressApplication = Express.getExpressApp();
  app.use(["/telemetry", "/"], OTelIngestAPI);
  app.use(expressErrorHandler);

  httpServer = http.createServer(app);
  httpServer.on(
    "request",
    (_req: http.IncomingMessage, res: http.ServerResponse): void => {
      serverResponseClosed = new Promise<void>((resolve: () => void): void => {
        res.once("close", resolve);
      });
    },
  );
  await new Promise<void>((resolve: () => void): void => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  httpPort = (httpServer.address() as AddressInfo).port;

  /*
   * startGrpcServer builds and registers everything as it does in
   * production; only its listen address moves, from 0.0.0.0:4317 to an
   * ephemeral loopback port.
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
        _address: string,
        credentials: grpc.ServerCredentials,
        productionCallback: (error: Error | null, port: number) => void,
      ): void {
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
  const grpcPort: number = await bound;
  grpcServer = bindSpy.mock.contexts[0] as grpc.Server;

  for (const signal of SIGNALS) {
    const definition: protoLoader.PackageDefinition = protoLoader.loadSync(
      path.join(PROTO_DIR, signal.protoFile),
      OTLP_PROTO_LOADER_OPTIONS,
    );
    let node: unknown = grpc.loadPackageDefinition(definition);
    for (const key of signal.serviceName.split(".")) {
      node = (node as Record<string, unknown>)[key];
    }
    const ClientConstructor: grpc.ServiceClientConstructor =
      node as grpc.ServiceClientConstructor;
    grpcClients.set(
      signal.name,
      new ClientConstructor(
        `127.0.0.1:${grpcPort}`,
        grpc.credentials.createInsecure(),
      ),
    );
  }
});

afterAll(async () => {
  for (const client of grpcClients.values()) {
    client.close();
  }
  grpcClients.clear();

  const server: grpc.Server | null = grpcServer;
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

  await new Promise<void>((resolve: () => void): void => {
    httpServer.close((): void => {
      resolve();
    });
  });

  jest.restoreAllMocks();
});

beforeEach(() => {
  policy = buildPolicy();
  queueBehaviour = { kind: "take" };
  isBodyStoreDown = false;
  queuedJobs = 0;

  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockImplementation(
      async (
        secretKey: string,
      ): Promise<TelemetryIngestionKeyPolicy | null> => {
        return secretKey === TOKEN ? policy : null;
      },
    );
  jest
    .spyOn(TelemetryIngestionKeyService, "markUsed")
    .mockResolvedValue(undefined);
  // Refusals are counted against the key; that count has its own suites.
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation((): void => {});
  jest
    .spyOn(TelemetryBodyStore, "storeBody")
    .mockImplementation(async (): Promise<string> => {
      if (isBodyStoreDown) {
        throw new Error("redis is down");
      }
      return `telemetry:body:${ObjectID.generate().toString()}`;
    });
  jest
    .spyOn(Queue, "addJob")
    .mockImplementation(
      async (
        queueName: QueueName,
      ): Promise<Awaited<ReturnType<typeof Queue.addJob>>> => {
        expect(queueName).toBe(QueueName.Telemetry);

        if (queueBehaviour.kind === "refuse") {
          throw new Error("the queue is full");
        }

        if (queueBehaviour.kind === "hold") {
          queueBehaviour.entered();
          await queueBehaviour.release;
        }

        queuedJobs++;
        return {} as Awaited<ReturnType<typeof Queue.addJob>>;
      },
    );
});

afterEach(() => {
  for (const spy of [
    TelemetryIngestionDisabled.isDisabled,
    TelemetryIngestionKeyService.getPolicyFromSecretKey,
    TelemetryIngestionKeyService.markUsed,
    TelemetryIngestRefusalRecorder.record,
    TelemetryBodyStore.storeBody,
    Queue.addJob,
    TelemetryIngestionBudget.admit,
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

/*
 * ---------------------------------------------------------------------------
 * The cases: every way an export can end without its key being marked used,
 * each with the answer every protocol gives it.
 * ---------------------------------------------------------------------------
 */

interface UnstampedCase {
  label: string;
  token: string | null;
  arrange: () => void;
  answer: (protocol: Protocol) => Answer;
  isQueued: boolean;
}

const UNSTAMPED_CASES: Array<UnstampedCase> = [
  {
    label: "an export the queue refuses",
    token: TOKEN,
    arrange: (): void => {
      queueBehaviour = { kind: "refuse" };
    },
    answer: (protocol: Protocol): Answer => {
      return protocol.queueUnavailable;
    },
    isQueued: false,
  },
  {
    label: "an export whose body cannot be stored",
    token: TOKEN,
    arrange: (): void => {
      isBodyStoreDown = true;
    },
    answer: (protocol: Protocol): Answer => {
      return protocol.queueUnavailable;
    },
    isQueued: false,
  },
  {
    label: "an export with no key",
    token: null,
    arrange: (): void => {},
    answer: (protocol: Protocol): Answer => {
      return protocol.missingOrUnknownKey;
    },
    isQueued: false,
  },
  {
    label: "an export with a key no project has",
    token: UNKNOWN_TOKEN,
    arrange: (): void => {},
    answer: (protocol: Protocol): Answer => {
      return protocol.missingOrUnknownKey;
    },
    isQueued: false,
  },
  {
    label: "an export with a key that is switched off",
    token: TOKEN,
    arrange: (): void => {
      policy = buildPolicy({ isEnabled: false });
    },
    answer: (protocol: Protocol): Answer => {
      return protocol.disabledKey;
    },
    isQueued: false,
  },
  {
    label: "an export with a key past its expiry",
    token: TOKEN,
    arrange: (): void => {
      policy = buildPolicy({ expiresAt: new Date(Date.now() - 60 * 1000) });
    },
    answer: (protocol: Protocol): Answer => {
      return protocol.expiredKey;
    },
    isQueued: false,
  },
  {
    label: "an export over the project's daily ingestion budget",
    token: TOKEN,
    arrange: (): void => {
      jest.spyOn(TelemetryIngestionBudget, "admit").mockResolvedValue({
        refusal: dailyBudgetRefusal(),
        charge: null,
      });
    },
    answer: (protocol: Protocol): Answer => {
      return protocol.overDailyBudget;
    },
    isQueued: false,
  },
];

describe.each(PROTOCOLS)("$name", (protocol: Protocol) => {
  describe.each(SIGNALS)("$name", (signal: Signal) => {
    test("an export the queue takes marks the key that sent it, once, and only once the queue has it", async () => {
      let entered!: () => void;
      const hasEntered: Promise<void> = new Promise<void>(
        (resolve: () => void): void => {
          entered = resolve;
        },
      );
      let release!: () => void;
      queueBehaviour = {
        kind: "hold",
        entered: entered,
        release: new Promise<void>((resolve: () => void): void => {
          release = resolve;
        }),
      };

      const answer: Promise<Answer> = protocol.send(signal, TOKEN);

      // Admitted and on its way into the queue, which has not taken it yet.
      await hasEntered;
      expect(stampedKeyIds()).toEqual([]);

      release();

      expect(await answer).toBe(protocol.accepted);
      expect(queuedJobs).toBe(1);
      expect(stampedKeyIds()).toEqual([policy.ingestionKeyId.toString()]);
    });

    test.each(UNSTAMPED_CASES)(
      "$label marks nothing",
      async (unstamped: UnstampedCase) => {
        unstamped.arrange();

        expect(await protocol.send(signal, unstamped.token)).toBe(
          unstamped.answer(protocol),
        );
        expect(queuedJobs).toBe(unstamped.isQueued ? 1 : 0);
        expect(stampedKeyIds()).toEqual([]);
      },
    );

    test("after an export the queue refused, the retry the queue takes is what marks the key", async () => {
      queueBehaviour = { kind: "refuse" };
      expect(await protocol.send(signal, TOKEN)).toBe(
        protocol.queueUnavailable,
      );
      expect(stampedKeyIds()).toEqual([]);

      queueBehaviour = { kind: "take" };
      expect(await protocol.send(signal, TOKEN)).toBe(protocol.accepted);
      expect(stampedKeyIds()).toEqual([policy.ingestionKeyId.toString()]);
    });
  });
});

/*
 * The rule, stated once: for the same export and the same key, whatever the
 * protocol, the same key is marked used, or none is.
 */
describe("the three protocols mark the same key for the same export, case by case", () => {
  interface AgreementCase {
    label: string;
    token: string | null;
    arrange: () => void;
    isAccepted: boolean;
  }

  const AGREEMENT_CASES: Array<AgreementCase> = [
    {
      label: "an export the queue takes",
      token: TOKEN,
      arrange: (): void => {},
      isAccepted: true,
    },
    ...UNSTAMPED_CASES.map((unstamped: UnstampedCase): AgreementCase => {
      return {
        label: unstamped.label,
        token: unstamped.token,
        arrange: unstamped.arrange,
        isAccepted: false,
      };
    }),
  ];

  test.each(AGREEMENT_CASES)("$label", async (agreement: AgreementCase) => {
    const stampedByProtocol: Array<[string, Array<string>]> = [];

    for (const protocol of PROTOCOLS) {
      for (const signal of SIGNALS) {
        markUsed().mockClear();
        queueBehaviour = { kind: "take" };
        isBodyStoreDown = false;
        policy = buildPolicy();
        agreement.arrange();
        const sendingKeyId: string = policy.ingestionKeyId.toString();

        await protocol.send(signal, agreement.token);

        stampedByProtocol.push([
          `${protocol.name} ${signal.name}`,
          // Which key, by its place: this key, or none.
          stampedKeyIds().map((id: string): string => {
            return id === sendingKeyId ? "the sending key" : id;
          }),
        ]);
      }
    }

    const expected: Array<string> = agreement.isAccepted
      ? ["the sending key"]
      : [];

    expect(stampedByProtocol).toEqual(
      stampedByProtocol.map(
        (entry: [string, Array<string>]): [string, Array<string>] => {
          return [entry[0], expected];
        },
      ),
    );
  });
});
