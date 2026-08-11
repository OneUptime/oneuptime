import {
  describe,
  expect,
  test,
  beforeEach,
  beforeAll,
  afterAll,
} from "@jest/globals";
import * as grpc from "@grpc/grpc-js";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import logger from "Common/Server/Utils/Logger";
import { authenticateRequest } from "../../FeatureSet/Telemetry/GrpcServer";

/*
 * This suite proves the END-TO-END property behind the gRPC auth change:
 * repeated authenticateRequest calls for the same token reach the
 * database exactly ONCE, because the REAL
 * TelemetryIngestionKeyService.getProjectIdFromSecretKey (with its
 * in-process TTL cache) sits between the gRPC path and findOneBy. The
 * sibling GrpcServerAuth.test.ts mocks the whole service to pin which
 * method the gRPC path calls; here the real service runs and only the
 * database accessor underneath it is stubbed.
 *
 * DatabaseService (the base class) is replaced because its import
 * closure pulls in PasswordHash.ts, which has a pre-existing TS 5.9
 * compile failure under ts-jest — and because the only thing this suite
 * needs from it is an overridable findOneBy. The real
 * TelemetryIngestionKeyService module (cache, TTLs, hashing of cache
 * keys) is fully exercised.
 */
jest.mock("Common/Server/Services/DatabaseService", () => {
  class FakeDatabaseService {
    public modelType: unknown;

    public constructor(modelType: unknown) {
      this.modelType = modelType;
    }

    // Base-class configuration helpers subclass constructors may call.
    public hardDeleteItemsOlderThanInDays(): void {
      // no-op
    }

    public setDoNotAllowDelete(): void {
      // no-op
    }

    public async findOneBy(_findOneBy: unknown): Promise<unknown> {
      throw new Error(
        "findOneBy stub was not replaced — the test must install its own implementation.",
      );
    }
  }

  return {
    __esModule: true,
    default: FakeDatabaseService,
  };
});

/*
 * CaptureSpan wraps decorated methods in OpenTelemetry spans; replace it
 * with a pass-through decorator so the suite does not stand up tracing
 * infrastructure.
 */
jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});

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

type MockedFn = jest.Mock;

const makeMetadata: (token: string) => grpc.Metadata = (
  token: string,
): grpc.Metadata => {
  const metadata: grpc.Metadata = new grpc.Metadata();
  metadata.set("x-oneuptime-token", token);
  return metadata;
};

/*
 * Install a counting findOneBy on the real service instance that
 * resolves the given token to the given project — any other token
 * resolves to "no row", matching the real accessor's behavior for
 * unknown keys.
 */
const installFindOneBy: (
  knownToken: string,
  projectId: ObjectID,
) => MockedFn = (knownToken: string, projectId: ObjectID): MockedFn => {
  const findOneByMock: MockedFn = jest
    .fn()
    .mockImplementation((findOneBy: unknown): Promise<unknown> => {
      const query: Record<string, unknown> = (
        findOneBy as { query: Record<string, unknown> }
      ).query;
      const queriedKey: string | undefined = (
        query["secretKey"] as ObjectID | undefined
      )?.toString();

      if (queriedKey === knownToken) {
        return Promise.resolve({ projectId } as TelemetryIngestionKey);
      }

      return Promise.resolve(null);
    });

  (
    TelemetryIngestionKeyService as unknown as {
      findOneBy: MockedFn;
    }
  ).findOneBy = findOneByMock;

  return findOneByMock;
};

/*
 * Minimal structural view of a jest spy — the @jest/globals and
 * @types/jest spy types disagree in this repo, so annotate with just the
 * surface this test reads.
 */
type SpyLike = {
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => SpyLike;
  mockRestore: () => void;
};

describe("GrpcServer auth caching through the real TelemetryIngestionKeyService", () => {
  let loggerErrorSpy: SpyLike;

  beforeAll(() => {
    // The unknown-token path logs; silence the real logger for the suite.
    loggerErrorSpy = (
      jest.spyOn(logger, "error") as unknown as SpyLike
    ).mockImplementation(() => {
      return undefined;
    });
  });

  afterAll(() => {
    loggerErrorSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("repeated authenticate calls for the same token hit the database exactly once", async () => {
    /*
     * Tokens are unique per test because the service's TTL cache is a
     * module-level singleton that persists across tests in this file.
     */
    const token: string = ObjectID.generate().toString();
    const projectId: ObjectID = ObjectID.generate();
    const findOneByMock: MockedFn = installFindOneBy(token, projectId);

    for (let i: number = 0; i < 10; i++) {
      const result: ObjectID | null = await authenticateRequest(
        makeMetadata(token),
      );
      expect(result).not.toBeNull();
      expect(result!.toString()).toBe(projectId.toString());
    }

    /*
     * One cold lookup, nine cache hits — this is the entire point of
     * switching the gRPC path off its per-RPC findOneBy.
     */
    expect(findOneByMock).toHaveBeenCalledTimes(1);
  });

  test("distinct tokens each get their own single database lookup", async () => {
    const firstToken: string = ObjectID.generate().toString();
    const projectId: ObjectID = ObjectID.generate();
    const findOneByMock: MockedFn = installFindOneBy(firstToken, projectId);

    await authenticateRequest(makeMetadata(firstToken));
    await authenticateRequest(makeMetadata(firstToken));
    expect(findOneByMock).toHaveBeenCalledTimes(1);

    /*
     * A different (unknown) token is a cache miss: it triggers exactly
     * one more lookup, resolves to null, and the negative result is
     * cached too — the repeat does not touch the database again.
     */
    const unknownToken: string = ObjectID.generate().toString();
    const firstUnknownResult: ObjectID | null = await authenticateRequest(
      makeMetadata(unknownToken),
    );
    const secondUnknownResult: ObjectID | null = await authenticateRequest(
      makeMetadata(unknownToken),
    );

    expect(firstUnknownResult).toBeNull();
    expect(secondUnknownResult).toBeNull();
    expect(findOneByMock).toHaveBeenCalledTimes(2);
  });
});
