import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE ONE PLACE AN INGEST PATH STAMPS ITS KEY AS USED (issue #7887).
 *
 * The HTTP ingest middleware and the OTLP gRPC server both call
 * TelemetryIngestionKeyLastUsed.stamp once they have accepted telemetry
 * (TelemetryIngestKeyLastUsed.test.ts and GrpcServerKeyLastUsed.test.ts drive
 * them). Here, the helper itself: it writes through the key service's
 * throttled markUsed with the admitting key's id, it hands its caller nothing
 * to wait on, and a failed write is logged and goes no further.
 */

jest.mock("../../../../Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      markUsed: jest.fn(),
    },
  };
});

import TelemetryIngestionKeyService from "../../../../Server/Services/TelemetryIngestionKeyService";
import logger from "../../../../Server/Utils/Logger";
import TelemetryIngestionKeyLastUsed from "../../../../Server/Utils/Telemetry/TelemetryIngestionKeyLastUsed";
import ObjectID from "../../../../Types/ObjectID";
import TelemetryIngestionKeyPolicy from "../../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../../Types/Telemetry/TelemetryIngestionKeyType";

type MockFn = jest.Mock;

const KEY_ID: string = "7887a000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "7887a000-0000-4000-8000-000000000002";

function buildPolicy(): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: new ObjectID(KEY_ID),
    projectId: new ObjectID(PROJECT_ID),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
  };
}

function markUsed(): MockFn {
  return TelemetryIngestionKeyService.markUsed as unknown as MockFn;
}

// Lets a rejected write and its .catch run out.
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe("TelemetryIngestionKeyLastUsed.stamp", () => {
  let warn: jest.SpiedFunction<typeof logger.warn>;

  beforeEach(() => {
    jest.clearAllMocks();
    markUsed().mockResolvedValue(undefined as never);
    warn = jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes the admitting key's id through the key service's throttled markUsed, before it returns", () => {
    const policy: TelemetryIngestionKeyPolicy = buildPolicy();

    TelemetryIngestionKeyLastUsed.stamp(policy);

    // The key's own id, and nothing else.
    expect(markUsed()).toHaveBeenCalledTimes(1);
    expect(markUsed().mock.calls[0]).toEqual([policy.ingestionKeyId]);
    expect(markUsed().mock.calls[0]![0]).toBe(policy.ingestionKeyId);
  });

  test("gives its caller nothing to wait on, so a slow write never holds an accepted request", () => {
    markUsed().mockReturnValue(new Promise<void>((): void => {}) as never);

    const returned: unknown = (
      TelemetryIngestionKeyLastUsed.stamp as (
        policy: TelemetryIngestionKeyPolicy,
      ) => unknown
    )(buildPolicy());

    expect(returned).toBeUndefined();
    expect(markUsed()).toHaveBeenCalledTimes(1);
  });

  test("a write that fails is caught and logged with the key's id, never thrown to the caller", async () => {
    const failure: Error = new Error("database is having a bad day");
    markUsed().mockRejectedValue(failure as never);

    expect(() => {
      TelemetryIngestionKeyLastUsed.stamp(buildPolicy());
    }).not.toThrow();
    await settle();

    // Only the .catch the helper attaches writes these two lines.
    expect(warn).toHaveBeenCalledWith(
      `TelemetryIngest: failed to record last used for ingestion key ${KEY_ID}`,
    );
    expect(warn).toHaveBeenCalledWith(failure);
  });
});
