import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import * as grpc from "@grpc/grpc-js";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import logger from "Common/Server/Utils/Logger";
import {
  authenticateRequest,
  buildTelemetryRequest,
} from "../../FeatureSet/Telemetry/GrpcServer";

/*
 * The Queue module (pulled in transitively through the per-signal queue
 * services GrpcServer imports) loads BullMQ / bull-board at import time;
 * nothing queue-side is under test here, so it is replaced with an inert
 * stub.
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
 * The auth contract under test is "the gRPC path resolves tokens through
 * the CACHED resolver and never issues its own findOneBy". Both methods
 * are mocked so the test can count exactly which one the production code
 * reaches for.
 */
jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      getProjectIdFromSecretKey: jest.fn(),
      findOneBy: jest.fn(),
    },
  };
});

/*
 * Minimal structural view of a jest spy — the @jest/globals and
 * @types/jest spy types disagree in this repo, so annotate with just the
 * surface this test reads.
 */
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => SpyLike;
  mockRestore: () => void;
};

type MockedFn = jest.Mock;

const getCachedResolverMock: () => MockedFn = (): MockedFn => {
  return TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockedFn;
};

/*
 * The cached resolver now hands back the whole key policy rather than a bare
 * projectId, because a project id alone cannot answer "may this key still
 * write, and may it write over gRPC?". This helper builds the shape a healthy
 * Server key resolves to, so each test below can keep asserting on the one
 * thing it cares about.
 */
type MakePolicyFunction = (projectId: ObjectID) => TelemetryIngestionKeyPolicy;

const makeServerKeyPolicy: MakePolicyFunction = (
  projectId: ObjectID,
): TelemetryIngestionKeyPolicy => {
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
};

const getFindOneByMock: () => MockedFn = (): MockedFn => {
  return TelemetryIngestionKeyService.findOneBy as unknown as MockedFn;
};

const makeMetadata: (entries: Record<string, string>) => grpc.Metadata = (
  entries: Record<string, string>,
): grpc.Metadata => {
  const metadata: grpc.Metadata = new grpc.Metadata();
  for (const key in entries) {
    metadata.set(key, entries[key]!);
  }
  return metadata;
};

describe("GrpcServer authenticateRequest", () => {
  let loggerErrorSpy: SpyLike;

  beforeEach(() => {
    jest.clearAllMocks();
    // Silence and capture — auth failures log, and we assert on content.
    loggerErrorSpy = (
      jest.spyOn(logger, "error") as unknown as SpyLike
    ).mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  test("valid token resolves projectId through the cached resolver — never through a direct findOneBy", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const token: string = ObjectID.generate().toString();
    getCachedResolverMock().mockResolvedValue(makeServerKeyPolicy(projectId));

    const result: ObjectID | null = await authenticateRequest(
      makeMetadata({ "x-oneuptime-token": token }),
    );

    expect(result).toBe(projectId);
    expect(getCachedResolverMock()).toHaveBeenCalledTimes(1);
    expect(getCachedResolverMock()).toHaveBeenCalledWith(token);
    // The whole point of the change: no per-RPC Postgres query.
    expect(getFindOneByMock()).not.toHaveBeenCalled();
  });

  test("falls back to x-oneuptime-service-token and x-oneuptime-ingestion-key, in that order", async () => {
    const projectId: ObjectID = ObjectID.generate();
    getCachedResolverMock().mockResolvedValue(makeServerKeyPolicy(projectId));

    await authenticateRequest(
      makeMetadata({ "x-oneuptime-service-token": "service-token-value" }),
    );
    expect(getCachedResolverMock()).toHaveBeenLastCalledWith(
      "service-token-value",
    );

    await authenticateRequest(
      makeMetadata({ "x-oneuptime-ingestion-key": "ingestion-key-value" }),
    );
    expect(getCachedResolverMock()).toHaveBeenLastCalledWith(
      "ingestion-key-value",
    );

    // Primary header wins over the fallbacks when both are present.
    await authenticateRequest(
      makeMetadata({
        "x-oneuptime-token": "primary-token-value",
        "x-oneuptime-service-token": "service-token-value",
      }),
    );
    expect(getCachedResolverMock()).toHaveBeenLastCalledWith(
      "primary-token-value",
    );

    expect(getFindOneByMock()).not.toHaveBeenCalled();
  });

  test("missing token returns null without touching the resolver at all", async () => {
    const result: ObjectID | null = await authenticateRequest(makeMetadata({}));

    expect(result).toBeNull();
    expect(getCachedResolverMock()).not.toHaveBeenCalled();
    expect(getFindOneByMock()).not.toHaveBeenCalled();
  });

  test("invalid token returns null and the failure log contains no token substring", async () => {
    const secretToken: string = `secret-${ObjectID.generate().toString()}`;
    getCachedResolverMock().mockResolvedValue(null);

    const result: ObjectID | null = await authenticateRequest(
      makeMetadata({ "x-oneuptime-token": secretToken }),
    );

    expect(result).toBeNull();

    /*
     * The failure must be logged — but the token is a secret and log
     * lines routinely land in third-party sinks, so no logged argument
     * may contain it (previously the log line was
     * "gRPC: Invalid service token: <token>").
     */
    expect(loggerErrorSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of loggerErrorSpy.mock.calls) {
      for (const argument of call) {
        expect(JSON.stringify(argument) ?? "").not.toContain(secretToken);
      }
    }
  });

  test("repeated authentications keep going through the cached resolver, never the DB accessor", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const token: string = ObjectID.generate().toString();
    getCachedResolverMock().mockResolvedValue(makeServerKeyPolicy(projectId));

    for (let i: number = 0; i < 5; i++) {
      const result: ObjectID | null = await authenticateRequest(
        makeMetadata({ "x-oneuptime-token": token }),
      );
      expect(result).toBe(projectId);
    }

    /*
     * The resolver owns the TTL cache internally (see
     * GrpcServerAuthCache.test.ts for the proof that repeated calls
     * reach Postgres only once) — the gRPC path's contract is that it
     * NEVER bypasses it with a direct query.
     */
    expect(getCachedResolverMock()).toHaveBeenCalledTimes(5);
    expect(getFindOneByMock()).not.toHaveBeenCalled();
  });
});

describe("GrpcServer buildTelemetryRequest", () => {
  test("projects gRPC metadata down to worker-consumed headers — the token never reaches req.headers", () => {
    const projectId: ObjectID = ObjectID.generate();
    const secretToken: string = `secret-${ObjectID.generate().toString()}`;

    const metadata: grpc.Metadata = makeMetadata({
      "x-oneuptime-token": secretToken,
      "x-oneuptime-service-name": "checkout-service",
      "user-agent": "grpc-node-js/1.12.5",
      "grpc-accept-encoding": "identity,deflate,gzip",
    });

    const body: Record<string, unknown> = { resourceSpans: [] };

    const req: TelemetryRequest = buildTelemetryRequest(
      body,
      metadata,
      projectId,
      ProductType.Traces,
    );

    /*
     * Everything on req.headers is copied into the BullMQ job payload
     * by TelemetryQueueService and JSON-serialized into Redis per job —
     * only the whitelisted worker-consumed headers may survive.
     */
    expect(req.headers).toEqual({
      "x-oneuptime-service-name": "checkout-service",
    });
    expect(JSON.stringify(req.headers)).not.toContain(secretToken);

    expect(req.body).toBe(body);
    expect(req.projectId).toBe(projectId);
    expect(req.productType).toBe(ProductType.Traces);
    expect(req.path).toBe(`/otlp/v1/${ProductType.Traces}`);
    expect(req.url).toBe(`/otlp/v1/${ProductType.Traces}`);
  });

  test("metadata without a service name yields empty headers, not undefined", () => {
    const req: TelemetryRequest = buildTelemetryRequest(
      {},
      makeMetadata({ "x-oneuptime-token": "secret" }),
      ObjectID.generate(),
      ProductType.Logs,
    );

    expect(req.headers).toEqual({});
  });
});
