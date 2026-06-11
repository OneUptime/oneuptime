import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import TelemetryQueueService, {
  TelemetryType,
  TelemetryIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { OtelPayloadFormat } from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";

/*
 * The Queue module pulls in BullMQ / bull-board at import time, and the
 * worker-facing contract under test is only "what job data is enqueued",
 * so the whole module is replaced. QueueName values mirror the real enum
 * so the queue-name assertion stays meaningful.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn().mockResolvedValue(undefined),
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
 * TelemetryBodyStore talks to Redis; the contract under test is that the
 * enqueue path stores the body and carries the returned key in the job
 * data. Keys are unique per call so cross-call assertions can't pass by
 * accident.
 */
jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  let keyCounter: number = 0;
  return {
    __esModule: true,
    default: {
      storeBody: jest.fn().mockImplementation(() => {
        keyCounter++;
        return Promise.resolve(`telemetry:body:test-key-${keyCounter}`);
      }),
      readAndDeleteBody: jest.fn(),
    },
  };
});

type MockedFn = jest.Mock;

const getAddJobMock: () => MockedFn = (): MockedFn => {
  return Queue.addJob as unknown as MockedFn;
};

const getStoreBodyMock: () => MockedFn = (): MockedFn => {
  return TelemetryBodyStore.storeBody as unknown as MockedFn;
};

const getEnqueuedJobData: (callIndex?: number) => TelemetryIngestJobData = (
  callIndex: number = 0,
): TelemetryIngestJobData => {
  return getAddJobMock().mock.calls[callIndex]![3] as TelemetryIngestJobData;
};

const getEnqueuedJobId: (callIndex?: number) => string = (
  callIndex: number = 0,
): string => {
  return getAddJobMock().mock.calls[callIndex]![1] as string;
};

const getStoredBodyKey: (callIndex?: number) => Promise<string> = (
  callIndex: number = 0,
): Promise<string> => {
  return getStoreBodyMock().mock.results[callIndex]!.value as Promise<string>;
};

describe("TelemetryQueueService.addTelemetryIngestJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("raw buffer body produces a job carrying bodyKey + bodyFormat(protobuf) + productType", async () => {
    const rawBody: Buffer = Buffer.from([0x0a, 0x03, 0x01, 0x02, 0x03]);
    const projectId: ObjectID = ObjectID.generate();

    const req: TelemetryRequest = {
      projectId,
      productType: ProductType.Profiles,
      headers: {
        "content-type": "application/x-protobuf",
        "content-encoding": "gzip",
      },
      body: rawBody,
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Profiles,
    );

    // The raw bytes must be stored out-of-band, untouched.
    expect(getStoreBodyMock()).toHaveBeenCalledTimes(1);
    expect(getStoreBodyMock()).toHaveBeenCalledWith(rawBody);

    expect(getAddJobMock()).toHaveBeenCalledTimes(1);
    expect(getAddJobMock().mock.calls[0]![0]).toBe("Telemetry");
    expect(getAddJobMock().mock.calls[0]![2]).toBe("ProcessTelemetry");

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();
    const storedKey: string = await getStoredBodyKey();

    expect(jobData.type).toBe(TelemetryType.Profiles);
    expect(jobData.projectId).toBe(projectId.toString());
    expect(jobData.bodyKey).toBe(storedKey);
    expect(jobData.bodyFormat).toBe(OtelPayloadFormat.Protobuf);
    expect(jobData.bodyFormat).toBe("protobuf");
    expect(jobData.bodyEncoding).toBe("gzip");
    expect(jobData.productType).toBe(ProductType.Profiles);
    expect(jobData.requestBody).toBeUndefined();
  });

  test("parsed-object body for an OTel type still carries bodyKey + bodyFormat(json) + productType and no bare requestBody", async () => {
    /*
     * This is the shape the gRPC OTLP entry point and the Pyroscope
     * pprof->OTLP conversion produce: an already-decoded JS object
     * (with binary fields as Buffers / Uint8Arrays), and no
     * req.productType because no HTTP middleware ran.
     */
    const parsedBody: JSONObject = {
      resourceProfiles: [
        {
          profileId: Buffer.from("abc"),
          traceBytes: new Uint8Array([1, 2, 3]),
          scopeProfiles: [],
        },
      ],
    } as unknown as JSONObject;

    const projectId: ObjectID = ObjectID.generate();

    const req: TelemetryRequest = {
      projectId,
      headers: {},
      body: parsedBody,
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Profiles,
    );

    expect(getStoreBodyMock()).toHaveBeenCalledTimes(1);

    /*
     * The stored buffer must be the JSON serialization of the parsed
     * object, with binary fields rewritten to base64 (matching what
     * protobufjs' toJSON emits on the raw-buffer path).
     */
    const storedBuffer: Buffer = getStoreBodyMock().mock.calls[0]![0] as Buffer;
    expect(Buffer.isBuffer(storedBuffer)).toBe(true);
    expect(JSON.parse(storedBuffer.toString("utf8"))).toEqual({
      resourceProfiles: [
        {
          profileId: Buffer.from("abc").toString("base64"),
          traceBytes: Buffer.from([1, 2, 3]).toString("base64"),
          scopeProfiles: [],
        },
      ],
    });

    expect(getAddJobMock()).toHaveBeenCalledTimes(1);

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();
    const storedKey: string = await getStoredBodyKey();

    expect(jobData.bodyKey).toBe(storedKey);
    expect(jobData.bodyFormat).toBe(OtelPayloadFormat.Json);
    expect(jobData.bodyFormat).toBe("json");
    expect(jobData.bodyEncoding).toBe("none");
    // Falls back to the per-signal product type when req.productType is absent.
    expect(jobData.productType).toBe(ProductType.Profiles);

    /*
     * The worker resolves OTel payloads exclusively through bodyKey and
     * throws when it is missing — a bare requestBody would be silently
     * dropped, so the job must not carry one at all.
     */
    expect(jobData.requestBody).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(jobData, "requestBody")).toBe(
      false,
    );
  });

  test("syslog parsed body keeps the requestBody path and never touches the body store", async () => {
    const syslogBody: JSONObject = {
      message: "<134>1 2026-06-11T00:00:00Z host app - - - hello",
      severity: 6,
    };

    const projectId: ObjectID = ObjectID.generate();

    const req: TelemetryRequest = {
      projectId,
      headers: {},
      body: syslogBody,
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Syslog,
    );

    expect(getStoreBodyMock()).not.toHaveBeenCalled();
    expect(getAddJobMock()).toHaveBeenCalledTimes(1);

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    expect(jobData.type).toBe(TelemetryType.Syslog);
    expect(jobData.requestBody).toBe(syslogBody);
    expect(jobData.bodyKey).toBeUndefined();
    expect(jobData.bodyFormat).toBeUndefined();
    expect(getEnqueuedJobId()).toContain(`syslog-${projectId.toString()}-`);
  });

  test("two enqueues in the same millisecond produce different job ids", async () => {
    /*
     * The unix-nano job-id prefix is derived from Date.now() and is only
     * millisecond-precise, so concurrent enqueues collide on it; pin it
     * to prove uniqueness comes from the id itself, not the clock.
     */
    const frozenUnixNano: number = 1234567890123456;
    jest
      .spyOn(OneUptimeDate, "getCurrentDateAsUnixNano")
      .mockReturnValue(frozenUnixNano);

    const projectId: ObjectID = ObjectID.generate();

    const makeRequest: () => TelemetryRequest = (): TelemetryRequest => {
      return {
        projectId,
        headers: {},
        body: { resourceProfiles: [] },
      } as unknown as TelemetryRequest;
    };

    await TelemetryQueueService.addTelemetryIngestJob(
      makeRequest(),
      TelemetryType.Profiles,
    );
    await TelemetryQueueService.addTelemetryIngestJob(
      makeRequest(),
      TelemetryType.Profiles,
    );

    expect(getAddJobMock()).toHaveBeenCalledTimes(2);

    const firstJobId: string = getEnqueuedJobId(0);
    const secondJobId: string = getEnqueuedJobId(1);

    const sharedPrefix: string = `profiles-${projectId.toString()}-${frozenUnixNano}-`;
    expect(firstJobId.startsWith(sharedPrefix)).toBe(true);
    expect(secondJobId.startsWith(sharedPrefix)).toBe(true);

    // Identical clock reading, identical project — ids must still differ.
    expect(firstJobId).not.toBe(secondJobId);
  });
});
