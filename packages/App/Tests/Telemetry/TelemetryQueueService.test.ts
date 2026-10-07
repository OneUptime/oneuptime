import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import IncomingRequestLatestPayloadStore from "../../FeatureSet/Telemetry/Utils/IncomingRequestLatestPayloadStore";
import TelemetryQueueService, {
  TelemetryType,
  TelemetryIngestJobData,
  IncomingRequestIngestJobData,
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
      readBody: jest.fn(),
      deleteBody: jest.fn(),
    },
  };
});

/*
 * The latest-payload store talks to Redis; the contract under test is that
 * a coalesced request is stored, before its job is added, under the id the
 * job carries.
 */
jest.mock(
  "../../FeatureSet/Telemetry/Utils/IncomingRequestLatestPayloadStore",
  () => {
    return {
      __esModule: true,
      default: {
        store: jest.fn().mockResolvedValue(undefined),
      },
    };
  },
);

/*
 * INCOMING_REQUEST_INGEST_COALESCE_ENABLED is read from the environment when
 * the module loads; a getter lets each test choose. On, as in production,
 * unless a test turns it off.
 */
let mockCoalesceEnabled: boolean = true;

jest.mock("../../FeatureSet/Telemetry/Config", () => {
  const config: Record<string, unknown> = {
    ...jest.requireActual("../../FeatureSet/Telemetry/Config"),
  };

  /*
   * Defined, not spread: a spread getter would be read right here, while
   * this hoisted factory runs ahead of the variable it returns.
   */
  Object.defineProperty(config, "__esModule", { value: true });
  Object.defineProperty(config, "INCOMING_REQUEST_INGEST_COALESCE_ENABLED", {
    enumerable: true,
    get: (): boolean => {
      return mockCoalesceEnabled;
    },
  });

  return config;
});

type MockedFn = jest.Mock;

const getStoreLatestMock: () => MockedFn = (): MockedFn => {
  return IncomingRequestLatestPayloadStore.store as unknown as MockedFn;
};

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

const getEnqueuedJobOptions: (callIndex?: number) => JSONObject = (
  callIndex: number = 0,
): JSONObject => {
  return getAddJobMock().mock.calls[callIndex]![4] as JSONObject;
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

describe("TelemetryQueueService.addIncomingRequestIngestJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("coalesces same-monitor incoming requests via per-secret-key deduplication", async () => {
    const secretKey: string = ObjectID.generate().toString();

    await TelemetryQueueService.addIncomingRequestIngestJob({
      secretKey,
      requestHeaders: { "x-test": "1" },
      requestBody: { hello: "world" },
      requestMethod: "POST",
    });

    expect(getAddJobMock()).toHaveBeenCalledTimes(1);
    expect(getAddJobMock().mock.calls[0]![0]).toBe("Telemetry");
    expect(getAddJobMock().mock.calls[0]![2]).toBe("ProcessTelemetry");

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();
    expect(jobData.type).toBe(TelemetryType.IncomingRequestIngest);
    expect(jobData.incomingRequestIngest?.secretKey).toBe(secretKey);

    const options: JSONObject = getEnqueuedJobOptions();
    // Unique job id => existence check skipped.
    expect(options["skipExistenceCheck"]).toBe(true);
    /*
     * keepLastIfActive coalescing keyed by the monitor's secret key: BullMQ
     * keeps at most one active + one waiting job per monitor so an external
     * sender cannot fan out into concurrent same-monitor monitorResource()
     * calls contending on the per-monitor lock.
     */
    expect(options["deduplication"]).toEqual({
      id: `incoming-request-${secretKey}`,
      keepLastIfActive: true,
    });
  });

  test("job id is unique per call but the dedup id is stable per secret key", async () => {
    const frozenUnixNano: number = 1234567890123456;
    jest
      .spyOn(OneUptimeDate, "getCurrentDateAsUnixNano")
      .mockReturnValue(frozenUnixNano);

    const secretKey: string = ObjectID.generate().toString();

    await TelemetryQueueService.addIncomingRequestIngestJob({
      secretKey,
      requestHeaders: {},
      requestBody: {},
      requestMethod: "GET",
    });
    await TelemetryQueueService.addIncomingRequestIngestJob({
      secretKey,
      requestHeaders: {},
      requestBody: {},
      requestMethod: "GET",
    });

    expect(getAddJobMock()).toHaveBeenCalledTimes(2);

    // Distinct job ids (random suffix) even with the clock pinned...
    expect(getEnqueuedJobId(0)).not.toBe(getEnqueuedJobId(1));

    // ...but the dedup id is stable so BullMQ coalesces them onto one monitor.
    const firstDedupId: string = (
      getEnqueuedJobOptions(0)["deduplication"] as JSONObject
    )["id"] as string;
    const secondDedupId: string = (
      getEnqueuedJobOptions(1)["deduplication"] as JSONObject
    )["id"] as string;
    expect(firstDedupId).toBe(`incoming-request-${secretKey}`);
    expect(secondDedupId).toBe(firstDedupId);
  });

  /*
   * The worker records the heartbeat at this time, not at the time the queue
   * gets around to the job - under a backlog those are minutes apart, and the
   * heartbeat cron judges "received in the last N minutes" from it.
   */
  test("carries the endpoint's arrival time as the job's ingestion timestamp", async () => {
    const receivedAt: Date = new Date("2026-10-05T12:19:00.000Z");

    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-05T12:19:00.250Z"));

    await TelemetryQueueService.addIncomingRequestIngestJob({
      secretKey: ObjectID.generate().toString(),
      requestHeaders: {},
      requestBody: {},
      requestMethod: "POST",
      receivedAt: receivedAt,
    });

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    expect(
      new Date(
        jobData.incomingRequestIngest!.ingestionTimestamp as Date,
      ).getTime(),
    ).toBe(receivedAt.getTime());
  });

  test("without an arrival time the job is stamped with the enqueue time", async () => {
    const enqueuedAt: Date = new Date("2026-10-05T12:19:00.250Z");

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(enqueuedAt);

    await TelemetryQueueService.addIncomingRequestIngestJob({
      secretKey: ObjectID.generate().toString(),
      requestHeaders: {},
      requestBody: {},
      requestMethod: "POST",
    });

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    expect(
      new Date(
        jobData.incomingRequestIngest!.ingestionTimestamp as Date,
      ).getTime(),
    ).toBe(enqueuedAt.getTime());
  });

  /*
   * BullMQ keeps the newest payload only for a request that arrives while the
   * monitor's job is ACTIVE; one that arrives while the job is still WAITING
   * is discarded in favour of the older waiting job. So each request is also
   * stored as its monitor's newest, and the job - whichever request created
   * it - evaluates that when it runs.
   */
  describe("with coalescing on", () => {
    test("stores the request as its monitor's newest before the job is added", async () => {
      const secretKey: string = ObjectID.generate().toString();
      const receivedAt: Date = new Date("2026-10-05T12:27:30.000Z");

      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey,
        requestHeaders: { "content-type": "application/json" },
        requestBody: { status: "resolved" },
        requestMethod: "POST",
        receivedViaProbeId: "probe-1",
        receivedAt: receivedAt,
      });

      expect(getStoreLatestMock()).toHaveBeenCalledTimes(1);
      expect(getAddJobMock()).toHaveBeenCalledTimes(1);

      /*
       * Stored first: a worker can pick the job up as soon as it is added,
       * and the request it will evaluate has to be there by then.
       */
      expect(getStoreLatestMock().mock.invocationCallOrder[0]).toBeLessThan(
        getAddJobMock().mock.invocationCallOrder[0]!,
      );

      const storeInput: {
        secretKey: string;
        payloadId: string;
        payload: IncomingRequestIngestJobData;
      } = getStoreLatestMock().mock.calls[0]![0];

      expect(storeInput.secretKey).toBe(secretKey);
      expect(ObjectID.isValidUUID(storeInput.payloadId)).toBe(true);
      expect(storeInput.payload).toEqual({
        secretKey,
        requestHeaders: { "content-type": "application/json" },
        requestBody: { status: "resolved" },
        requestMethod: "POST",
        ingestionTimestamp: receivedAt,
        receivedViaProbeId: "probe-1",
        coalescedPayloadId: storeInput.payloadId,
      });
    });

    test("marks the job with the stored request's id", async () => {
      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey: ObjectID.generate().toString(),
        requestHeaders: {},
        requestBody: {},
        requestMethod: "POST",
      });

      const payloadId: string = (
        getStoreLatestMock().mock.calls[0]![0] as { payloadId: string }
      ).payloadId;

      expect(
        getEnqueuedJobData().incomingRequestIngest?.coalescedPayloadId,
      ).toBe(payloadId);
    });

    /*
     * A worker that predates the store (API and worker pods roll separately)
     * evaluates the job's own copy, as it always has.
     */
    test("still carries the whole request on the job", async () => {
      const secretKey: string = ObjectID.generate().toString();

      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey,
        requestHeaders: { "x-test": "1" },
        requestBody: "plain text",
        requestMethod: "GET",
      });

      const jobRequest: IncomingRequestIngestJobData =
        getEnqueuedJobData().incomingRequestIngest!;

      expect(jobRequest.secretKey).toBe(secretKey);
      expect(jobRequest.requestHeaders).toEqual({ "x-test": "1" });
      expect(jobRequest.requestBody).toBe("plain text");
      expect(jobRequest.requestMethod).toBe("GET");
      expect(jobRequest).toEqual(
        (
          getStoreLatestMock().mock.calls[0]![0] as {
            payload: IncomingRequestIngestJobData;
          }
        ).payload,
      );
    });

    test("gives every request its own id, while the monitor keeps one coalescing group", async () => {
      const secretKey: string = ObjectID.generate().toString();

      for (let i: number = 0; i < 3; i++) {
        await TelemetryQueueService.addIncomingRequestIngestJob({
          secretKey,
          requestHeaders: {},
          requestBody: { sequence: i },
          requestMethod: "POST",
        });
      }

      const payloadIds: Array<string> = getStoreLatestMock().mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { payloadId: string }).payloadId;
        },
      );

      expect(new Set(payloadIds).size).toBe(3);

      for (let i: number = 0; i < 3; i++) {
        expect(
          (getStoreLatestMock().mock.calls[i]![0] as { secretKey: string })
            .secretKey,
        ).toBe(secretKey);
        expect(
          getEnqueuedJobData(i).incomingRequestIngest?.coalescedPayloadId,
        ).toBe(payloadIds[i]);
        expect(getEnqueuedJobOptions(i)["deduplication"]).toEqual({
          id: `incoming-request-${secretKey}`,
          keepLastIfActive: true,
        });
      }
    });

    /*
     * A job whose request is not stored would evaluate whatever older
     * request the store holds, or nothing. Better to fail the enqueue, as a
     * failed queue add already does.
     */
    test("does not queue a request it could not store", async () => {
      getStoreLatestMock().mockRejectedValueOnce(
        new Error(
          "Redis not connected; cannot reach the incoming request store",
        ),
      );

      await expect(
        TelemetryQueueService.addIncomingRequestIngestJob({
          secretKey: ObjectID.generate().toString(),
          requestHeaders: {},
          requestBody: {},
          requestMethod: "POST",
        }),
      ).rejects.toThrow("Redis not connected");

      expect(getAddJobMock()).not.toHaveBeenCalled();
    });
  });

  /*
   * INCOMING_REQUEST_INGEST_COALESCE_ENABLED=false: every request is its own
   * job carrying its own request, as before coalescing existed.
   */
  describe("with coalescing off", () => {
    beforeEach(() => {
      mockCoalesceEnabled = false;
    });

    afterEach(() => {
      mockCoalesceEnabled = true;
    });

    test("queues each request as its own job, unmarked and not stored", async () => {
      const secretKey: string = ObjectID.generate().toString();

      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey,
        requestHeaders: { "x-test": "1" },
        requestBody: { status: "firing" },
        requestMethod: "POST",
      });

      expect(getStoreLatestMock()).not.toHaveBeenCalled();
      expect(getAddJobMock()).toHaveBeenCalledTimes(1);

      const jobRequest: IncomingRequestIngestJobData =
        getEnqueuedJobData().incomingRequestIngest!;

      expect(jobRequest.coalescedPayloadId).toBeUndefined();
      expect(
        Object.prototype.hasOwnProperty.call(jobRequest, "coalescedPayloadId"),
      ).toBe(false);
      expect(jobRequest.requestBody).toEqual({ status: "firing" });

      const options: JSONObject = getEnqueuedJobOptions();
      expect(options["skipExistenceCheck"]).toBe(true);
      expect(options["deduplication"]).toBeUndefined();
    });
  });
});

describe("TelemetryQueueService.addTelemetryMonitorEvaluationJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("enqueues monitor evaluation jobs with stable per-monitor deduplication", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    await TelemetryQueueService.addTelemetryMonitorEvaluationJob({
      monitorId,
      projectId,
    });

    expect(getAddJobMock()).toHaveBeenCalledTimes(1);
    expect(getAddJobMock().mock.calls[0]![0]).toBe("Telemetry");
    expect(getAddJobMock().mock.calls[0]![2]).toBe("ProcessTelemetry");

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();
    expect(jobData.type).toBe(TelemetryType.TelemetryMonitorEvaluation);
    expect(jobData.projectId).toBe(projectId.toString());
    expect(jobData.telemetryMonitorEvaluation?.monitorId).toBe(
      monitorId.toString(),
    );
    expect(jobData.telemetryMonitorEvaluation?.projectId).toBe(
      projectId.toString(),
    );

    const options: JSONObject = getEnqueuedJobOptions();
    expect(options["skipExistenceCheck"]).toBe(true);
    expect(options["deduplication"]).toEqual({
      id: `telemetry-monitor-evaluation-${monitorId.toString()}`,
      keepLastIfActive: true,
    });
  });
});
