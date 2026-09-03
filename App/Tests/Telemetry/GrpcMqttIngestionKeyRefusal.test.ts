import {
  describe,
  expect,
  test,
  beforeAll,
  beforeEach,
  afterAll,
} from "@jest/globals";
import * as grpc from "@grpc/grpc-js";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestionKeyRateLimiter from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import logger from "Common/Server/Utils/Logger";
import { authenticateRequest } from "../../FeatureSet/Telemetry/GrpcServer";
import { startMqttServer } from "../../FeatureSet/Telemetry/MqttServer";

/*
 * THE INVARIANT
 * =============
 * The two NON-HTTP ingest pipes — the gRPC OTLP server on 4317 and the MQTT
 * broker — cannot use the Express TelemetryIngest middleware, so each one
 * makes the key-state decision itself. This suite pins that both of them ask
 * TelemetryIngestionKeyGuard and honour its answer, because the failure mode
 * of forgetting is silent and total: a key the customer switched off in the
 * dashboard, or a key that expired, keeps writing forever on the one transport
 * nobody remembered to update, and the kill switch a leak response depends on
 * is a lie.
 *
 * Four things are pinned per transport:
 *
 *   1. REGRESSION. A plain enabled Server key — including the legacy shape
 *      every pre-existing key reads back as (keyType NULL -> Server, no
 *      expiry, no origin list, no limit) — still authenticates and still
 *      yields the right projectId. These two ports carry real customer
 *      traffic; a refusal that over-fires here drops production telemetry
 *      that is never replayed.
 *
 *   2. REFUSAL. Disabled, expired and Browser keys are turned away. The
 *      Browser case is not merely defensive — see the comments on those tests
 *      for why a browser key arriving on either port has no honest
 *      explanation.
 *
 *   3. THE REFUSAL IS DEBUGGABLE BUT NOT LEAKY. Neither transport can carry a
 *      reason back to the caller (gRPC answers success so the OTel SDK does
 *      not retry; MQTT 3.1.1's CONNACK has no reason field), so the log line
 *      is the ONLY place the "why" exists. It must name the ingestion key id —
 *      that is what an operator searches the dashboard with — and the refusal
 *      reason, and it must never name the presented credential. On MQTT the
 *      password IS the ingestion key, so a token in a log line is a live
 *      secret sitting in whatever third-party sink the logs ship to.
 *
 *   4. THE TRANSPORT'S OWN REFUSAL MECHANICS ARE UNCHANGED. gRPC returns null
 *      from authenticateRequest — byte-identical to the unknown-token path —
 *      so handleExport's existing "reply success, enqueue nothing" behaviour
 *      applies with no new branch. MQTT answers done(err, false) with
 *      returnCode 4 (bad username or password) and leaves the client
 *      unauthenticated and its clientId un-namespaced.
 *
 * WHAT THE SIBLING SUITES ALREADY COVER (deliberately not repeated here):
 *   - GrpcServerAuth.test.ts: which resolver method the gRPC path calls and
 *     that it never issues its own findOneBy; the three metadata header
 *     fallbacks and their precedence; the missing-token short circuit; and
 *     buildTelemetryRequest's header whitelisting.
 *   - GrpcServerAuthCache.test.ts: that the REAL service's TTL cache collapses
 *     repeated authentications for one token down to a single findOneBy, and
 *     that negative results are cached too.
 * Neither of them exercises the guard at all, and neither covers MQTT, which
 * until now had no auth test of any kind.
 */

/*
 * The Queue module (pulled in transitively by the per-signal queue services
 * both servers import) loads BullMQ / bull-board at import time; nothing
 * queue-side is under test here, so it is replaced with an inert stub.
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

/*
 * The policy resolver is the seam. Mocking it lets a test hand each transport
 * an exact key state without a database, and keeps the DatabaseService import
 * closure (and therefore Postgres) out of the suite entirely.
 */
jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      getProjectIdFromSecretKey: jest.fn(),
      findOneBy: jest.fn(),
      markUsed: jest.fn(),
    },
  };
});

/*
 * MQTT's other credential path (per-device username/secret) is not under test;
 * stub it so the broker never reaches for a database, and so every CONNECT in
 * this file falls through to the project-wide ingestion-key branch.
 */
jest.mock("Common/Server/Services/IoTDeviceCredentialService", () => {
  return {
    __esModule: true,
    default: {
      getCredentialContext: jest.fn().mockResolvedValue(null),
      markConnected: jest.fn().mockResolvedValue(undefined),
    },
  };
});

/*
 * Mocked purely so the suite can assert it is NEVER consulted: the per-key
 * rate limit is a Redis round trip, and neither of these transports is
 * supposed to make one. Part of the backwards-compatibility contract — a
 * legacy key must behave exactly as it did before, which includes not paying
 * for a Redis hop it never used to pay for.
 */
jest.mock(
  "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
  () => {
    return {
      __esModule: true,
      default: {
        consume: jest.fn(),
      },
    };
  },
);

/*
 * aedes' real createBroker builds an in-memory persistence layer plus
 * heartbeat and will-sweep timers. The unit under test is the authenticate
 * hook the production code installs on the broker, so the broker itself is a
 * bare object the hook gets attached to and the test can then call directly.
 */
jest.mock("aedes", () => {
  const brokers: Array<Record<string, unknown>> = [];

  return {
    __esModule: true,
    createBroker: (): Record<string, unknown> => {
      const broker: Record<string, unknown> = {
        on: (): void => {
          return undefined;
        },
      };
      brokers.push(broker);
      return broker;
    },
    __brokers: brokers,
  };
});

/*
 * startMqttServer() unconditionally starts a raw TCP listener. Only
 * net.createServer is replaced (everything else in the module passes through,
 * because @grpc/grpc-js and ws both require the real thing) so that starting
 * the broker in this suite binds no port and opens no socket. The
 * MQTT-over-WebSocket listener needs no stub: Express.getHttpServer() is
 * undefined in a unit test, which is the branch where the production code
 * logs a warning and returns without constructing a WebSocketServer.
 */
jest.mock("net", () => {
  const actualNet: Record<string, unknown> = jest.requireActual(
    "net",
  ) as Record<string, unknown>;

  return {
    ...actualNet,
    createServer: (): Record<string, unknown> => {
      return {
        on: (): void => {
          return undefined;
        },
        listen: (): void => {
          return undefined;
        },
      };
    },
  };
});

type MockedFn = jest.Mock;

/*
 * Minimal structural view of a jest spy — the @jest/globals and @types/jest
 * spy types disagree in this repo, so annotate with just the surface this
 * test reads.
 */
type SpyLike = {
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => SpyLike;
  mockRestore: () => void;
};

const getPolicyResolverMock: () => MockedFn = (): MockedFn => {
  return TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockedFn;
};

const getRateLimiterConsumeMock: () => MockedFn = (): MockedFn => {
  return TelemetryIngestionKeyRateLimiter.consume as unknown as MockedFn;
};

/*
 * A key exactly as a row written BEFORE this feature shipped resolves: keyType
 * defaulted to Server, enabled, never expires, no origin binding, no limit.
 * Every test starts from this shape and changes the one field it is about, so
 * a refusal can only ever be attributed to that field.
 */
type BuildPolicyFunction = (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
) => TelemetryIngestionKeyPolicy;

const buildLegacyServerKeyPolicy: BuildPolicyFunction = (
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

/*
 * ---------------------------------------------------------------------------
 * Log capture across EVERY level.
 *
 * The sibling gRPC suite watches logger.error only. A secret that moved from
 * an error line to a warn or debug line is just as leaked, and both files
 * under test log at more than one level (gRPC refuses at error, MQTT refuses
 * at warn and logs successful CONNECTs at debug), so all four are captured
 * and every no-token assertion runs against the whole transcript.
 * ------------------------------------------------------------------------
 */
interface CapturedLogLine {
  level: string;
  args: Array<unknown>;
}

const LOG_LEVELS: Array<"error" | "warn" | "info" | "debug"> = [
  "error",
  "warn",
  "info",
  "debug",
];

/*
 * Truncated in place rather than reassigned: the logger spies installed in
 * beforeAll close over this binding, so swapping in a fresh array would leave
 * them writing into the old one and every log assertion below would silently
 * see nothing.
 */
const capturedLogs: Array<CapturedLogLine> = [];
let loggerSpies: Array<SpyLike> = [];

/*
 * Errors JSON.stringify to "{}", which would silently pass a
 * "the token is not in here" assertion on the one argument shape most likely
 * to carry it. Flatten by hand instead.
 */
type StringifyLogArgumentFunction = (argument: unknown) => string;

const stringifyLogArgument: StringifyLogArgumentFunction = (
  argument: unknown,
): string => {
  if (typeof argument === "string") {
    return argument;
  }

  if (argument instanceof Error) {
    return `${argument.name}: ${argument.message} ${argument.stack || ""}`;
  }

  try {
    return JSON.stringify(argument) ?? String(argument);
  } catch {
    return String(argument);
  }
};

type GetLogTranscriptFunction = () => string;

const getLogTranscript: GetLogTranscriptFunction = (): string => {
  return capturedLogs
    .map((line: CapturedLogLine): string => {
      return `${line.level}: ${line.args
        .map(stringifyLogArgument)
        .join(" | ")}`;
    })
    .join("\n");
};

/* --------------------------------- gRPC ---------------------------------- */

type MakeMetadataFunction = (token: string) => grpc.Metadata;

const makeMetadata: MakeMetadataFunction = (token: string): grpc.Metadata => {
  const metadata: grpc.Metadata = new grpc.Metadata();
  metadata.set("x-oneuptime-token", token);
  return metadata;
};

/* --------------------------------- MQTT ---------------------------------- */

type MqttAuthenticateError = Error & { returnCode?: number };

type MqttDoneCallback = (
  error: MqttAuthenticateError | null,
  success: boolean | null,
) => void;

interface MqttClientStub {
  id: string;
  closed: boolean;
  close: () => void;
}

type MqttAuthenticateFunction = (
  client: MqttClientStub,
  username: string | undefined,
  password: Buffer | undefined,
  done: MqttDoneCallback,
) => void;

interface MqttBrokerStub {
  authenticate: MqttAuthenticateFunction;
}

interface MqttConnectOutcome {
  error: MqttAuthenticateError | null;
  success: boolean | null;
  client: MqttClientStub;
}

// MQTT 3.1.1 CONNACK return code 4 — bad user name or password.
const CONNACK_BAD_USERNAME_OR_PASSWORD: number = 4;

let mqttAuthenticate: MqttAuthenticateFunction;

/*
 * Drive one CONNECT through the broker's authenticate hook. The ingestion key
 * rides the password field (username left empty), which is the shape the
 * production comment documents and the only shape that reaches the
 * project-wide key branch.
 */
type MqttConnectFunction = (data: {
  token: string;
  clientId?: string;
}) => Promise<MqttConnectOutcome>;

const mqttConnect: MqttConnectFunction = (data: {
  token: string;
  clientId?: string;
}): Promise<MqttConnectOutcome> => {
  const client: MqttClientStub = {
    id: data.clientId || "sensor-42",
    closed: false,
    close: (): void => {
      return undefined;
    },
  };

  return new Promise<MqttConnectOutcome>(
    (resolve: (value: MqttConnectOutcome) => void): void => {
      mqttAuthenticate(
        client,
        undefined,
        Buffer.from(data.token, "utf8"),
        (
          error: MqttAuthenticateError | null,
          success: boolean | null,
        ): void => {
          resolve({ error: error, success: success, client: client });
        },
      );
    },
  );
};

beforeAll(() => {
  for (const level of LOG_LEVELS) {
    const spy: SpyLike = (
      jest.spyOn(logger, level) as unknown as SpyLike
    ).mockImplementation((...args: Array<unknown>): unknown => {
      capturedLogs.push({ level: level, args: args });
      return undefined;
    });
    loggerSpies.push(spy);
  }

  /*
   * Start the broker once (net.createServer is stubbed, the WebSocket
   * listener short-circuits) and keep the authenticate hook the production
   * code installed on it.
   */
  startMqttServer();

  const aedesModule: { __brokers: Array<MqttBrokerStub> } = jest.requireMock(
    "aedes",
  ) as { __brokers: Array<MqttBrokerStub> };

  const broker: MqttBrokerStub | undefined =
    aedesModule.__brokers[aedesModule.__brokers.length - 1];

  if (!broker || typeof broker.authenticate !== "function") {
    throw new Error(
      "startMqttServer() did not install an authenticate hook on the broker.",
    );
  }

  mqttAuthenticate = broker.authenticate;
});

afterAll(() => {
  for (const spy of loggerSpies) {
    spy.mockRestore();
  }
  loggerSpies = [];
});

beforeEach(() => {
  jest.clearAllMocks();
  capturedLogs.length = 0;
});

describe("gRPC OTLP ingest — telemetry ingestion key refusals", () => {
  test("an enabled Server key with no expiry still authenticates and yields its own projectId", async () => {
    /*
     * The regression case, in the exact shape every key written before this
     * feature shipped resolves to. This port carries real customer traffic;
     * anything that turns this red is an outage, not a test failure.
     */
    const policy: TelemetryIngestionKeyPolicy = buildLegacyServerKeyPolicy();
    const token: string = ObjectID.generate().toString();
    getPolicyResolverMock().mockResolvedValue(policy);

    const result: ObjectID | null = await authenticateRequest(
      makeMetadata(token),
    );

    expect(result).not.toBeNull();
    expect(result!.toString()).toBe(policy.projectId.toString());
    expect(getPolicyResolverMock()).toHaveBeenCalledWith(token);
    // An accepted key is not a refusal, so nothing may be logged as one.
    expect(getLogTranscript()).not.toContain("refused");
  });

  test("an unknown token is refused, and the presented token appears in no log line at any level", async () => {
    /*
     * Shaped like a real (mistyped) ingestion key so the substring check is
     * meaningful, and unique so nothing else in the transcript can contain it
     * by accident.
     */
    const sentinelToken: string = `sentinel-secret-grpc-${ObjectID.generate().toString()}`;
    getPolicyResolverMock().mockResolvedValue(null);

    const result: ObjectID | null = await authenticateRequest(
      makeMetadata(sentinelToken),
    );

    expect(result).toBeNull();
    // The failure must be visible to an operator...
    expect(capturedLogs.length).toBeGreaterThan(0);
    // ...but the credential must not be.
    expect(getLogTranscript()).not.toContain(sentinelToken);
  });

  test("a disabled key is refused, and the refusal log names the key id and the reason but never the token", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildLegacyServerKeyPolicy({
      isEnabled: false,
    });
    const sentinelToken: string = `sentinel-secret-grpc-disabled-${ObjectID.generate().toString()}`;
    getPolicyResolverMock().mockResolvedValue(policy);

    const result: ObjectID | null = await authenticateRequest(
      makeMetadata(sentinelToken),
    );

    expect(result).toBeNull();

    const transcript: string = getLogTranscript();
    /*
     * The kill switch is what a customer reaches for after a leak. If it
     * fires and leaves no trace naming the key, the operator fielding "why
     * did my telemetry stop" has nothing to search on.
     */
    expect(transcript).toContain(policy.ingestionKeyId.toString());
    expect(transcript).toContain("disabled");
    expect(transcript).not.toContain(sentinelToken);
  });

  test("an expired key is refused, while a key whose expiry is still in the future is not", async () => {
    const expiredPolicy: TelemetryIngestionKeyPolicy =
      buildLegacyServerKeyPolicy({
        expiresAt: new Date(Date.now() - 60 * 1000),
      });
    getPolicyResolverMock().mockResolvedValue(expiredPolicy);

    const expiredResult: ObjectID | null = await authenticateRequest(
      makeMetadata(ObjectID.generate().toString()),
    );

    expect(expiredResult).toBeNull();
    expect(getLogTranscript()).toContain("expired");

    capturedLogs.length = 0;

    const livePolicy: TelemetryIngestionKeyPolicy = buildLegacyServerKeyPolicy({
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    getPolicyResolverMock().mockResolvedValue(livePolicy);

    const liveResult: ObjectID | null = await authenticateRequest(
      makeMetadata(ObjectID.generate().toString()),
    );

    /*
     * The boundary matters in the safe direction too: an expiry that has not
     * arrived yet must not cost the customer a single span.
     */
    expect(liveResult).not.toBeNull();
    expect(liveResult!.toString()).toBe(livePolicy.projectId.toString());
    expect(getLogTranscript()).not.toContain("refused");
  });

  test("a Browser key is refused on the gRPC port", async () => {
    /*
     * This is not merely defensive. No browser can speak OTLP over gRPC: the
     * protocol needs HTTP/2 trailers, which no browser exposes to page
     * JavaScript — that limitation is the entire reason grpc-web exists. So a
     * Browser key presented on 4317 did not come from a page running the
     * customer's site. It was scraped out of that page's public source and
     * replayed by something else, which is exactly the attack the Browser key
     * type exists to bound. Refusing costs no legitimate caller anything,
     * because on this transport there is no legitimate caller.
     */
    const policy: TelemetryIngestionKeyPolicy = buildLegacyServerKeyPolicy({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: ["https://shop.example.com"],
      pinnedServiceName: "shop-frontend",
      requestsPerMinuteLimit: 6000,
    });
    const sentinelToken: string = `sentinel-secret-grpc-browser-${ObjectID.generate().toString()}`;
    getPolicyResolverMock().mockResolvedValue(policy);

    const result: ObjectID | null = await authenticateRequest(
      makeMetadata(sentinelToken),
    );

    expect(result).toBeNull();

    const transcript: string = getLogTranscript();
    expect(transcript).toContain(policy.ingestionKeyId.toString());
    expect(transcript).toContain("surface-not-allowed-for-browser-key");
    expect(transcript).not.toContain(sentinelToken);
    /*
     * A refusal is not permitted to disclose the key's configuration to
     * whoever replayed it; the allowlist and the pinned service name are the
     * customer's, not the caller's.
     */
    expect(transcript).not.toContain("shop.example.com");
  });

  test("every refusal returns exactly null — the same value an unknown token returns — so handleExport needs no new branch", async () => {
    /*
     * authenticateRequest's contract with its only caller is "an ObjectID or
     * null". handleExport answers the RPC with success and enqueues nothing on
     * null (deliberately, so the OTel SDK does not retry a request that will
     * never succeed). Any refusal that returned something else — an exception,
     * undefined, a projectId with a flag — would change that caller's
     * behaviour, so pin that all four rejection paths are indistinguishable.
     */
    const unknownTokenResult: ObjectID | null =
      await (async (): Promise<ObjectID | null> => {
        getPolicyResolverMock().mockResolvedValue(null);
        return authenticateRequest(
          makeMetadata(ObjectID.generate().toString()),
        );
      })();

    const refusedPolicies: Array<TelemetryIngestionKeyPolicy> = [
      buildLegacyServerKeyPolicy({ isEnabled: false }),
      buildLegacyServerKeyPolicy({
        expiresAt: new Date(Date.now() - 1000),
      }),
      buildLegacyServerKeyPolicy({
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: ["https://shop.example.com"],
      }),
    ];

    expect(unknownTokenResult).toBeNull();

    for (const policy of refusedPolicies) {
      getPolicyResolverMock().mockResolvedValue(policy);

      const result: ObjectID | null = await authenticateRequest(
        makeMetadata(ObjectID.generate().toString()),
      );

      expect(result).toBe(unknownTokenResult);
      expect(result).toBeNull();
    }
  });
});

describe("MQTT CONNECT — telemetry ingestion key refusals", () => {
  test("an enabled Server key authenticates and its clientId is namespaced by project", async () => {
    /*
     * The regression case for the IoT pipe. The namespacing assertion is here
     * because it is the last thing the success branch does: if it happened,
     * the whole accept path ran.
     */
    const policy: TelemetryIngestionKeyPolicy = buildLegacyServerKeyPolicy();
    const token: string = ObjectID.generate().toString();
    getPolicyResolverMock().mockResolvedValue(policy);

    const outcome: MqttConnectOutcome = await mqttConnect({
      token: token,
      clientId: "sensor-42",
    });

    expect(outcome.error).toBeNull();
    expect(outcome.success).toBe(true);
    expect(outcome.client.id).toBe(`${policy.projectId.toString()}/sensor-42`);
    expect(getPolicyResolverMock()).toHaveBeenCalledWith(token);
    expect(getLogTranscript()).not.toContain("refused");
  });

  test("an unknown token is refused with CONNACK rc=4, and the presented key appears in no log line at any level", async () => {
    /*
     * UUID-shaped on purpose: a non-UUID credential is rejected by the regex
     * gate before the resolver is ever called, so it would prove nothing about
     * the refusal path. This one has to reach the resolver.
     */
    const sentinelToken: string = ObjectID.generate().toString();
    getPolicyResolverMock().mockResolvedValue(null);

    const outcome: MqttConnectOutcome = await mqttConnect({
      token: sentinelToken,
    });

    expect(getPolicyResolverMock()).toHaveBeenCalledWith(sentinelToken);
    expect(outcome.success).toBe(false);
    expect(outcome.error).not.toBeNull();
    expect(outcome.error!.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);
    expect(capturedLogs.length).toBeGreaterThan(0);
    /*
     * On MQTT the password IS the ingestion key, so a token echoed into a log
     * line is a live project credential in whatever sink the logs ship to —
     * including the CONNACK error message, which is handed back over the wire.
     */
    expect(getLogTranscript()).not.toContain(sentinelToken);
    expect(outcome.error!.message).not.toContain(sentinelToken);
  });

  test("a disabled key is refused with the same CONNACK rc=4 as an unknown token, and the log names the key id and the reason", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildLegacyServerKeyPolicy({
      isEnabled: false,
    });
    const sentinelToken: string = ObjectID.generate().toString();
    getPolicyResolverMock().mockResolvedValue(policy);

    const outcome: MqttConnectOutcome = await mqttConnect({
      token: sentinelToken,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error!.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);

    const transcript: string = getLogTranscript();
    /*
     * CONNACK rc=4 carries no reason string on the wire, so this log line is
     * the only record of WHY a device stopped connecting.
     */
    expect(transcript).toContain(policy.ingestionKeyId.toString());
    expect(transcript).toContain("disabled");
    expect(transcript).not.toContain(sentinelToken);
  });

  test("an expired key is refused, while a key whose expiry is still in the future connects", async () => {
    const expiredPolicy: TelemetryIngestionKeyPolicy =
      buildLegacyServerKeyPolicy({
        expiresAt: new Date(Date.now() - 60 * 1000),
      });
    getPolicyResolverMock().mockResolvedValue(expiredPolicy);

    const expiredOutcome: MqttConnectOutcome = await mqttConnect({
      token: ObjectID.generate().toString(),
    });

    expect(expiredOutcome.success).toBe(false);
    expect(expiredOutcome.error!.returnCode).toBe(
      CONNACK_BAD_USERNAME_OR_PASSWORD,
    );
    expect(getLogTranscript()).toContain("expired");

    capturedLogs.length = 0;

    const livePolicy: TelemetryIngestionKeyPolicy = buildLegacyServerKeyPolicy({
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    getPolicyResolverMock().mockResolvedValue(livePolicy);

    const liveOutcome: MqttConnectOutcome = await mqttConnect({
      token: ObjectID.generate().toString(),
      clientId: "sensor-99",
    });

    expect(liveOutcome.error).toBeNull();
    expect(liveOutcome.success).toBe(true);
    expect(liveOutcome.client.id).toBe(
      `${livePolicy.projectId.toString()}/sensor-99`,
    );
  });

  test("a Browser key presented at CONNECT is refused", async () => {
    /*
     * Not merely defensive here either — and the argument is stronger than on
     * the gRPC port, not weaker. No browser speaks MQTT over TCP, but this
     * broker's WebSocket listener rides the ordinary HTTP ingress, so it IS
     * reachable straight from page JavaScript. A Browser key lifted out of a
     * customer's public page source could therefore be replayed into MQTT
     * ingest by the same script that scraped it, from any origin, with no
     * Origin check to fail — the broker does not inspect the WebSocket
     * handshake's Origin, and the key's allowlist is an HTTP-path control. No
     * OneUptime browser SDK publishes MQTT (browser keys exist for OTLP and
     * session replay), so a Browser key at CONNECT has no honest explanation.
     */
    const policy: TelemetryIngestionKeyPolicy = buildLegacyServerKeyPolicy({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: ["https://shop.example.com"],
      pinnedServiceName: "shop-frontend",
      requestsPerMinuteLimit: 6000,
    });
    const sentinelToken: string = ObjectID.generate().toString();
    getPolicyResolverMock().mockResolvedValue(policy);

    const outcome: MqttConnectOutcome = await mqttConnect({
      token: sentinelToken,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error!.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);

    const transcript: string = getLogTranscript();
    expect(transcript).toContain(policy.ingestionKeyId.toString());
    expect(transcript).toContain("surface-not-allowed-for-browser-key");
    expect(transcript).not.toContain(sentinelToken);
    expect(transcript).not.toContain("shop.example.com");
  });

  test("a refused client is left unauthenticated: its clientId is not namespaced and the failure is reported as a credential failure", async () => {
    /*
     * The refusal must take the broker's EXISTING bad-credential path rather
     * than inventing a new one. Two observable consequences: the client keeps
     * the id it connected with (namespacing happens only after a successful
     * auth, and is what keeps one tenant from evicting another tenant's
     * session), and the reported error is the generic credential error — it
     * names no key, no project and no reason, because a caller holding a dead
     * credential is not entitled to a project's configuration.
     */
    const policy: TelemetryIngestionKeyPolicy = buildLegacyServerKeyPolicy({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: ["https://shop.example.com"],
    });
    getPolicyResolverMock().mockResolvedValue(policy);

    const outcome: MqttConnectOutcome = await mqttConnect({
      token: ObjectID.generate().toString(),
      clientId: "scraped-key-replayer",
    });

    expect(outcome.client.id).toBe("scraped-key-replayer");
    expect(outcome.success).toBe(false);
    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error!.message).toBe(
      "Invalid telemetry ingestion key or device credential.",
    );
    expect(outcome.error!.message).not.toContain(
      policy.ingestionKeyId.toString(),
    );
    expect(outcome.error!.message).not.toContain(policy.projectId.toString());
  });
});

describe("Backwards compatibility on the non-HTTP transports", () => {
  test("a legacy key authenticates on both transports without ever consulting the per-key rate limiter", async () => {
    /*
     * The contract for every key that existed before this shipped: it reads
     * back with keyType NULL, resolves to Server, and must behave EXACTLY as
     * it did before — which includes not paying for a Redis round trip that
     * never used to be on this path. The rate limit is an HTTP-surface control
     * for Browser keys; adding it here would put ingest for these two
     * transports behind Redis availability, and neither of them has a
     * fail-open story written for that.
     */
    const grpcPolicy: TelemetryIngestionKeyPolicy =
      buildLegacyServerKeyPolicy();
    getPolicyResolverMock().mockResolvedValue(grpcPolicy);

    const grpcResult: ObjectID | null = await authenticateRequest(
      makeMetadata(ObjectID.generate().toString()),
    );

    expect(grpcResult).not.toBeNull();

    const mqttPolicy: TelemetryIngestionKeyPolicy =
      buildLegacyServerKeyPolicy();
    getPolicyResolverMock().mockResolvedValue(mqttPolicy);

    const mqttOutcome: MqttConnectOutcome = await mqttConnect({
      token: ObjectID.generate().toString(),
    });

    expect(mqttOutcome.success).toBe(true);
    expect(getRateLimiterConsumeMock()).not.toHaveBeenCalled();
  });
});
