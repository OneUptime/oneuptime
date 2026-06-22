import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The retry-safety guarantee of the body-lifecycle fix: the worker must
 * delete the out-of-band OTLP body ONLY after the job succeeds. If a job
 * fails a transient downstream error (e.g. "ClickHouse ingest client is not
 * connected" during a deploy), the body must remain in Redis so the BullMQ
 * retry can re-read it — otherwise the retry decodes {} and fails forever
 * with "Invalid resourceSpans format".
 *
 * We capture the worker handler by mocking QueueWorker.getWorker, stub the
 * trace ingest service to succeed or throw on demand, and assert deleteBody
 * is called on success and NOT on failure.
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

const processTracesFromQueue: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Services/OtelTracesIngestService", () => {
  return {
    __esModule: true,
    default: { processTracesFromQueue },
  };
});

const deleteBody: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: { deleteBody, readBody: jest.fn(), storeBody: jest.fn() },
  };
});

/*
 * Keep the real module (its enums are imported elsewhere in the graph) but
 * stub the decode so no real Redis/protobuf is needed.
 */
jest.mock("../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder",
  );
  return {
    __esModule: true,
    ...actual,
    default: {
      ...(actual["default"] as Record<string, unknown>),
      decodeFromQueue: jest.fn().mockResolvedValue({ resourceSpans: [] }),
    },
  };
});

// Importing the module registers the worker via the mocked QueueWorker.
import "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";

const BODY_KEY: string = "telemetry:body:k1";

function tracesJob(): unknown {
  return {
    id: "traces-11111111-1111-1111-1111-111111111111-1-abc",
    name: "ProcessTelemetry",
    data: {
      type: "traces",
      projectId: "11111111-1111-1111-1111-111111111111",
      bodyKey: BODY_KEY,
      bodyFormat: "json",
      bodyEncoding: "none",
      productType: "Traces",
      requestHeaders: {},
    },
  };
}

describe("ProcessTelemetry worker — body deleted only on success", () => {
  beforeEach(() => {
    deleteBody.mockClear();
    processTracesFromQueue.mockReset();
  });

  test("the worker handler was registered/captured", () => {
    expect(typeof capturedHandler).toBe("function");
  });

  test("deletes the body after a successful job", async () => {
    processTracesFromQueue.mockResolvedValueOnce(undefined);

    await capturedHandler!(tracesJob());

    expect(processTracesFromQueue).toHaveBeenCalledTimes(1);
    expect(deleteBody).toHaveBeenCalledTimes(1);
    expect(deleteBody).toHaveBeenCalledWith(BODY_KEY);
  });

  test("does NOT delete the body when processing fails, so the retry can re-read it", async () => {
    processTracesFromQueue.mockRejectedValueOnce(
      new Error("ClickHouse ingest client is not connected"),
    );

    await expect(capturedHandler!(tracesJob())).rejects.toThrow(
      /ClickHouse ingest client is not connected/,
    );

    // The body must survive for the BullMQ retry.
    expect(deleteBody).not.toHaveBeenCalled();
  });
});
