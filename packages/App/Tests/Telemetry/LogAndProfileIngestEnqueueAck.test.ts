import http from "http";
import { AddressInfo } from "net";
import path from "path";
import protobuf from "protobufjs";
import zlib from "zlib";
import FluentAPI from "../../FeatureSet/Telemetry/API/Fluent";
import PyroscopeAPI from "../../FeatureSet/Telemetry/API/Pyroscope";
import SyslogAPI from "../../FeatureSet/Telemetry/API/Syslog";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

/*
 * THE FLUENTD, SYSLOG AND PYROSCOPE ENDPOINTS ANSWER ONLY ONCE THE QUEUE HAS
 * THE DATA, AND MARK THE KEY USED ONLY THEN (issue #8021).
 *
 * The OTLP endpoints acknowledge a batch only after the queue accepts it, so
 * a batch the queue refuses is answered 503 and the sender retries it. These
 * four did it the other way round: they answered 200 and queued after, so
 * what the queue refused was lost behind a success - Fluentd drops a chunk it
 * was answered 200 for, a syslog relay its messages, a Pyroscope client its
 * profile. And since the ingest guard now marks a key used when its route
 * answers with a success (TelemetryIngestionKeyLastUsed.stampWhenAccepted),
 * answering before the queue would have marked the key for data the queue
 * never took.
 *
 * Each endpoint is driven over a real socket, through its real router, the
 * App's global body parsers and error handler, the real ingest guard and the
 * real queue producer. Replaced: the key lookup and the stamp's write
 * (TelemetryIngestionKeyService), Redis (the body store and Queue.addJob) and
 * the refusal counter's batch writer.
 */

const KEY: string = "8021b000-0000-4000-8000-000000000001";

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
);

const PprofProfile: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "pprof", "profile.proto"))
  .lookupType("perftools.profiles.Profile");

const PushRequestType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "pyroscope", "push.proto"))
  .lookupType("push.v1.PushRequest");

const QUEUE_UNAVAILABLE: string = "Telemetry queue unavailable. Please retry.";

// One CPU sample in one function: the smallest pprof the push path keeps.
function minimalPprof(): Buffer {
  return Buffer.from(
    PprofProfile.encode(
      PprofProfile.fromObject({
        sampleType: [{ type: 1, unit: 2 }],
        sample: [{ locationId: [1], value: [10_000_000] }],
        location: [{ id: 1, line: [{ functionId: 1 }] }],
        function: [{ id: 1, name: 3 }],
        stringTable: ["", "cpu", "nanoseconds", "main"],
        period: 1,
        periodType: { type: 1, unit: 2 },
        timeNanos: Date.now() * 1_000_000,
        durationNanos: 10_000_000_000,
      }),
    ).finish(),
  );
}

function pushRequestBody(): Buffer {
  return Buffer.from(
    PushRequestType.encode(
      PushRequestType.create({
        series: [
          {
            labels: [
              { name: "__name__", value: "process_cpu" },
              { name: "service_name", value: "checkout" },
            ],
            samples: [
              {
                rawProfile: new Uint8Array(
                  zlib.gzipSync(minimalPprof() as unknown as Uint8Array),
                ),
              },
            ],
          },
        ],
      }),
    ).finish(),
  );
}

interface Endpoint {
  name: string;
  path: string;
  headers: Dictionary<string>;
  body: () => Buffer;
  // What it answers once the queue has the data.
  successStatus: number;
}

const ENDPOINTS: Array<Endpoint> = [
  {
    name: "Fluentd logs (/fluentd/v1/logs)",
    path: "/fluentd/v1/logs",
    headers: { "content-type": "application/json", "x-oneuptime-token": KEY },
    body: (): Buffer => {
      return Buffer.from(
        JSON.stringify([{ message: "checkout complete", level: "info" }]),
      );
    },
    successStatus: 200,
  },
  {
    name: "Syslog (/syslog/v1/logs)",
    path: "/syslog/v1/logs",
    headers: { "content-type": "application/json", "x-oneuptime-token": KEY },
    body: (): Buffer => {
      return Buffer.from(
        JSON.stringify({
          messages: [
            "<13>1 2026-11-16T10:00:00Z web-01 checkout 2419 - - order placed",
          ],
        }),
      );
    },
    successStatus: 200,
  },
  {
    name: "Pyroscope ingest (/pyroscope/ingest)",
    path: "/pyroscope/ingest?name=checkout&format=folded",
    headers: {
      "content-type": "application/octet-stream",
      authorization: `Bearer ${KEY}`,
    },
    body: (): Buffer => {
      return Buffer.from("main;work;inner 12\nmain;idle 3\n");
    },
    successStatus: 200,
  },
  {
    name: "Pyroscope push (/pyroscope/push.v1.PusherService/Push)",
    path: "/pyroscope/push.v1.PusherService/Push",
    headers: {
      "content-type": "application/proto",
      "connect-protocol-version": "1",
      authorization: `Bearer ${KEY}`,
    },
    body: pushRequestBody,
    successStatus: 200,
  },
];

interface HttpAnswer {
  status: number;
  body: string;
}

let server: http.Server;
let port: number;
let policy: TelemetryIngestionKeyPolicy;

// The server's side of the last request, and when it is done with it.
let serverResponse: http.ServerResponse | null = null;
let serverResponseClosed: Promise<void> = Promise.resolve();

type QueueBehaviour =
  | { kind: "take" }
  | { kind: "refuse" }
  | { kind: "hold"; entered: () => void; release: Promise<void> };

let queueBehaviour: QueueBehaviour = { kind: "take" };
let isBodyStoreDown: boolean = false;
let queuedJobs: number = 0;

function send(endpoint: Endpoint): Promise<HttpAnswer> {
  const body: Buffer = endpoint.body();

  return new Promise<HttpAnswer>(
    (resolve: (answer: HttpAnswer) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          method: "POST",
          path: endpoint.path,
          headers: {
            ...endpoint.headers,
            "content-length": String(body.length),
          },
        },
        (response: http.IncomingMessage): void => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer): void => {
            chunks.push(chunk);
          });
          response.on("end", (): void => {
            void serverResponseClosed.then((): void => {
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(
                  chunks as unknown as Array<Uint8Array>,
                ).toString("utf-8"),
              });
            });
          });
        },
      );
      request.on("error", reject);
      request.end(body);
    },
  );
}

function stampedKeyIds(): Array<string> {
  return (
    TelemetryIngestionKeyService.markUsed as unknown as jest.SpyInstance
  ).mock.calls.map((args: Array<unknown>): string => {
    return String(args[0]);
  });
}

beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  // Behind the App's global body parsers, on the prefix the App mounts.
  const app: ExpressApplication = Express.getExpressApp();
  app.use(["/telemetry", "/"], FluentAPI);
  app.use(["/telemetry", "/"], SyslogAPI);
  app.use(["/telemetry", "/"], PyroscopeAPI);
  app.use(expressErrorHandler);

  server = http.createServer(app);
  server.on(
    "request",
    (_req: http.IncomingMessage, res: http.ServerResponse): void => {
      serverResponse = res;
      serverResponseClosed = new Promise<void>((resolve: () => void): void => {
        res.once("close", resolve);
      });
    },
  );
  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
  jest.restoreAllMocks();
});

beforeEach(() => {
  policy = {
    ingestionKeyId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
  };
  queueBehaviour = { kind: "take" };
  isBodyStoreDown = false;
  queuedJobs = 0;
  serverResponse = null;

  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockImplementation(
      async (
        secretKey: string,
      ): Promise<TelemetryIngestionKeyPolicy | null> => {
        return secretKey === KEY ? policy : null;
      },
    );
  jest
    .spyOn(TelemetryIngestionKeyService, "markUsed")
    .mockResolvedValue(undefined);
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
  ]) {
    (spy as unknown as jest.SpyInstance).mockRestore();
  }
});

describe.each(ENDPOINTS)("$name", (endpoint: Endpoint) => {
  test("answers only once the queue has the data, and only then marks the key used", async () => {
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

    const answer: Promise<HttpAnswer> = send(endpoint);

    // On its way into the queue: nothing answered, nothing marked.
    await hasEntered;
    expect(serverResponse).not.toBeNull();
    expect(serverResponse!.headersSent).toBe(false);
    expect(serverResponse!.writableEnded).toBe(false);
    expect(stampedKeyIds()).toEqual([]);

    release();

    expect((await answer).status).toBe(endpoint.successStatus);
    expect(queuedJobs).toBe(1);
    expect(stampedKeyIds()).toEqual([policy.ingestionKeyId.toString()]);
  });

  test("a queue that cannot take the data is answered 503, for the sender to retry, and marks nothing", async () => {
    queueBehaviour = { kind: "refuse" };

    const answer: HttpAnswer = await send(endpoint);

    expect(answer.status).toBe(503);
    expect(JSON.parse(answer.body)).toEqual({ message: QUEUE_UNAVAILABLE });
    // Nothing of the backend's failure reaches the sender.
    expect(answer.body).not.toContain("the queue is full");
    expect(queuedJobs).toBe(0);
    expect(stampedKeyIds()).toEqual([]);
  });

  test("after a 503, the retry the queue takes is answered and marks the key", async () => {
    queueBehaviour = { kind: "refuse" };
    expect((await send(endpoint)).status).toBe(503);

    queueBehaviour = { kind: "take" };
    expect((await send(endpoint)).status).toBe(endpoint.successStatus);

    expect(queuedJobs).toBe(1);
    expect(stampedKeyIds()).toEqual([policy.ingestionKeyId.toString()]);
  });

  test("a key that is switched off is refused before anything is queued, and marks nothing", async () => {
    policy = { ...policy, isEnabled: false };

    expect((await send(endpoint)).status).toBe(422);
    expect(queuedJobs).toBe(0);
    expect(stampedKeyIds()).toEqual([]);
  });
});

/*
 * A Pyroscope profile is queued as OTLP, its body stored apart from the job,
 * as an OTLP export's is. The store failing is the queue failing.
 */
describe.each(
  ENDPOINTS.filter((endpoint: Endpoint): boolean => {
    return endpoint.path.startsWith("/pyroscope/");
  }),
)("$name, its body store down", (endpoint: Endpoint) => {
  test("is answered 503 and marks nothing", async () => {
    isBodyStoreDown = true;

    const answer: HttpAnswer = await send(endpoint);

    expect(answer.status).toBe(503);
    expect(JSON.parse(answer.body)).toEqual({ message: QUEUE_UNAVAILABLE });
    expect(queuedJobs).toBe(0);
    expect(stampedKeyIds()).toEqual([]);
  });
});
