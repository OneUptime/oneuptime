import http from "http";
import { AddressInfo } from "net";
import OTelIngestAPI from "../../FeatureSet/Telemetry/API/OTelIngest";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

/*
 * WHAT AN OTLP/HTTP EXPORT IS COUNTED AS, AND WHETHER IT MARKS ITS KEY USED,
 * WHEN THE ANSWER NEVER REACHES THE SENDER (issue #8021).
 *
 * The OTLP routes count each request in telemetry.ingest.request.count by
 * outcome, read from the status the route answered with, on "finish" or on
 * "close". A request whose client left before any answer was sent reaches
 * "close" holding Node's default status, 200, and was counted as accepted:
 * the sender saw no success and retries, so the accept rate counted it
 * twice. It is an error now. Nor does it mark its key used: the guard marks
 * a key once its route has answered with a success, and this one answered
 * no one - the retry is what marks it.
 *
 * Driven over a real socket through the real OTLP router, the App's global
 * body parsers and error handler, the ingest guard and the queue producer.
 * Replaced: the key lookup and the stamp's write, Redis (the body store and
 * Queue.addJob), the refusal counter's batch writer and the instruments the
 * counts are recorded on.
 */

const TOKEN: string = "8021c000-0000-4000-8000-000000000001";

const LOGS_EXPORT: Buffer = Buffer.from(
  JSON.stringify({
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "checkout" } },
          ],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: "1758800000123456789",
                body: { stringValue: "order placed" },
              },
            ],
          },
        ],
      },
    ],
  }),
);

let server: http.Server;
let port: number;
let policy: TelemetryIngestionKeyPolicy;
let serverResponseClosed: Promise<void> = Promise.resolve();
let outcomes: Array<Record<string, string>> = [];
let queuedJobs: number = 0;

type QueueBehaviour =
  | { kind: "take" }
  | { kind: "refuse" }
  | { kind: "hold"; entered: () => void; release: Promise<void> };

let queueBehaviour: QueueBehaviour = { kind: "take" };

function post(token: string | null): {
  answer: Promise<number>;
  request: http.ClientRequest;
} {
  const headers: http.OutgoingHttpHeaders = {
    "content-type": "application/json",
    "content-length": LOGS_EXPORT.length,
  };

  if (token !== null) {
    headers["x-oneuptime-token"] = token;
  }

  let request!: http.ClientRequest;

  const answer: Promise<number> = new Promise<number>(
    (resolve: (status: number) => void, reject: (err: Error) => void) => {
      request = http.request(
        {
          host: "127.0.0.1",
          port: port,
          method: "POST",
          path: "/otlp/v1/logs",
          headers: headers,
        },
        (response: http.IncomingMessage): void => {
          response.resume();
          response.on("end", (): void => {
            void serverResponseClosed.then((): void => {
              resolve(response.statusCode ?? 0);
            });
          });
        },
      );
      request.on("error", reject);
      request.end(LOGS_EXPORT);
    },
  );

  return { answer, request };
}

function stampedKeyIds(): Array<string> {
  return (
    TelemetryIngestionKeyService.markUsed as unknown as jest.SpyInstance
  ).mock.calls.map((args: Array<unknown>): string => {
    return String(args[0]);
  });
}

// Lets the route's own async work after an answer run out.
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 20);
  });
}

beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  const app: ExpressApplication = Express.getExpressApp();
  app.use(["/telemetry", "/"], OTelIngestAPI);
  app.use(expressErrorHandler);

  server = http.createServer(app);
  server.on(
    "request",
    (_req: http.IncomingMessage, res: http.ServerResponse): void => {
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
  outcomes = [];
  queuedJobs = 0;
  queueBehaviour = { kind: "take" };

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
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation((): void => {});
  jest
    .spyOn(TelemetryBodyStore, "storeBody")
    .mockImplementation(async (): Promise<string> => {
      return `telemetry:body:${ObjectID.generate().toString()}`;
    });
  jest
    .spyOn(Queue, "addJob")
    .mockImplementation(
      async (): Promise<Awaited<ReturnType<typeof Queue.addJob>>> => {
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

  const instrument: { add: jest.Mock; record: jest.Mock } = {
    add: jest.fn((_value: number, attributes: Record<string, string>) => {
      outcomes.push(attributes);
    }),
    record: jest.fn(),
  };
  jest
    .spyOn(AppMetrics, "getIngestCounter")
    .mockReturnValue(
      instrument as unknown as ReturnType<typeof AppMetrics.getIngestCounter>,
    );
  jest
    .spyOn(AppMetrics, "getIngestDuration")
    .mockReturnValue({ record: jest.fn() } as unknown as ReturnType<
      typeof AppMetrics.getIngestDuration
    >);
});

afterEach(() => {
  for (const spy of [
    TelemetryIngestionDisabled.isDisabled,
    TelemetryIngestionKeyService.getPolicyFromSecretKey,
    TelemetryIngestionKeyService.markUsed,
    TelemetryIngestRefusalRecorder.record,
    TelemetryBodyStore.storeBody,
    Queue.addJob,
    AppMetrics.getIngestCounter,
    AppMetrics.getIngestDuration,
  ]) {
    (spy as unknown as jest.SpyInstance).mockRestore();
  }
});

describe("an OTLP/HTTP export's outcome, and its key's Last Used At", () => {
  test("an export the queue takes is counted accepted, and marks its key", async () => {
    expect(await post(TOKEN).answer).toBe(200);

    expect(outcomes).toEqual([
      {
        "telemetry.signal": "logs",
        "telemetry.surface": "otel-logs",
        outcome: "accepted",
      },
    ]);
    expect(stampedKeyIds()).toEqual([policy.ingestionKeyId.toString()]);
  });

  test("an export the queue refuses is answered 503, counted an error, and marks nothing", async () => {
    queueBehaviour = { kind: "refuse" };

    expect(await post(TOKEN).answer).toBe(503);

    expect(outcomes).toEqual([
      {
        "telemetry.signal": "logs",
        "telemetry.surface": "otel-logs",
        outcome: "error",
      },
    ]);
    expect(stampedKeyIds()).toEqual([]);
  });

  test("an export without a key is answered 401, counted rejected, and marks nothing", async () => {
    expect(await post(null).answer).toBe(401);

    expect(outcomes).toEqual([
      {
        "telemetry.signal": "logs",
        "telemetry.surface": "otel-logs",
        outcome: "rejected",
      },
    ]);
    expect(stampedKeyIds()).toEqual([]);
  });

  test("an export whose client leaves before the answer is counted an error, not accepted, and marks nothing - though the queue took it", async () => {
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

    const sent: { answer: Promise<number>; request: http.ClientRequest } =
      post(TOKEN);
    sent.answer.catch((): void => {
      // The client went away: it hears nothing.
    });

    await hasEntered;
    const closed: Promise<void> = serverResponseClosed;

    // The exporter's own deadline passes while the queue is slow.
    sent.request.destroy();
    await closed;

    // The queue then takes it, and the route answers a connection now gone.
    release();
    await settle();

    expect(queuedJobs).toBe(1);
    expect(outcomes).toEqual([
      {
        "telemetry.signal": "logs",
        "telemetry.surface": "otel-logs",
        outcome: "error",
      },
    ]);
    expect(stampedKeyIds()).toEqual([]);
  });
});
