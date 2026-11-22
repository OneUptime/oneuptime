import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import IncomingRequestPendingStore from "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore";
import TelemetryQueueService, {
  TelemetryType,
  TelemetryIngestJobData,
  IncomingRequestIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { OtelPayloadFormat } from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import { createHash } from "crypto";

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
 * The waiting-request store talks to Redis (its Lua is
 * IncomingRequestPendingStore.test.ts's); the contract under test is that
 * a request is kept, before its monitor's job is added, and the job names
 * the monitor's list. The key's hash is the real one, so a test can check
 * the job never spells out the key.
 */
jest.mock(
  "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore",
  () => {
    return {
      __esModule: true,
      default: {
        push: jest.fn().mockResolvedValue({ waiting: 1, skipped: 0 }),
        getSecretKeyHash: (secretKey: string): string => {
          return (jest.requireActual("crypto") as typeof import("crypto"))
            .createHash("sha256")
            .update(secretKey)
            .digest("hex");
        },
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

const getPushMock: () => MockedFn = (): MockedFn => {
  return IncomingRequestPendingStore.push as unknown as MockedFn;
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

  /*
   * Every request is kept in its monitor's list of waiting requests
   * (IncomingRequestPendingStore), and the monitor has one job that works
   * through the list (#10582): every request of a monitor whose criteria
   * group by a payload field, in the order they arrived, the newest of any
   * other.
   */
  describe("with coalescing on", () => {
    test("keeps the request in its monitor's waiting list before the job is added", async () => {
      const secretKey: string = ObjectID.generate().toString();
      const receivedAt: Date = new Date("2026-11-21T09:27:30.000Z");

      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey,
        requestHeaders: { "content-type": "application/json" },
        requestBody: { status: "resolved", alertActiveID: "48214" },
        requestMethod: "POST",
        receivedViaProbeId: "probe-1",
        receivedAt: receivedAt,
      });

      expect(getPushMock()).toHaveBeenCalledTimes(1);
      expect(getAddJobMock()).toHaveBeenCalledTimes(1);

      /*
       * Kept first: a worker can pick the job up as soon as it is added,
       * and the request it will evaluate has to be there by then.
       */
      expect(getPushMock().mock.invocationCallOrder[0]).toBeLessThan(
        getAddJobMock().mock.invocationCallOrder[0]!,
      );

      const pushInput: {
        secretKey: string;
        requestId: string;
        payload: IncomingRequestIngestJobData;
      } = getPushMock().mock.calls[0]![0];

      expect(pushInput.secretKey).toBe(secretKey);
      expect(ObjectID.isValidUUID(pushInput.requestId)).toBe(true);
      // The request as a job of its own would carry it, and nothing more.
      expect(pushInput.payload).toEqual({
        secretKey,
        requestHeaders: { "content-type": "application/json" },
        requestBody: { status: "resolved", alertActiveID: "48214" },
        requestMethod: "POST",
        ingestionTimestamp: receivedAt,
        receivedViaProbeId: "probe-1",
      });
      expect(
        Object.prototype.hasOwnProperty.call(
          pushInput.payload,
          "coalescedPayloadId",
        ),
      ).toBe(false);
    });

    test("queues the monitor's job, which names its list by the key's hash and carries no request", async () => {
      const secretKey: string = ObjectID.generate().toString();
      const secretKeyHash: string = createHash("sha256")
        .update(secretKey)
        .digest("hex");

      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey,
        requestHeaders: { "x-test": "1" },
        requestBody: { hello: "world" },
        requestMethod: "POST",
      });

      expect(getAddJobMock().mock.calls[0]![0]).toBe("Telemetry");
      expect(getAddJobMock().mock.calls[0]![2]).toBe("ProcessTelemetry");

      const jobData: TelemetryIngestJobData = getEnqueuedJobData();

      expect(jobData.type).toBe(TelemetryType.IncomingRequestPending);
      expect(jobData.incomingRequestPending).toEqual({
        secretKeyHash: secretKeyHash,
      });
      expect(jobData.incomingRequestIngest).toBeUndefined();

      const options: JSONObject = getEnqueuedJobOptions();

      // Unique job id => existence check skipped.
      expect(options["skipExistenceCheck"]).toBe(true);
      /*
       * One job at a time per monitor: one running, and one BullMQ keeps
       * to run after it.
       */
      expect(options["deduplication"]).toEqual({
        id: `incoming-request-pending-${secretKeyHash}`,
        keepLastIfActive: true,
      });
      expect(options["delayInMs"]).toBeUndefined();

      // The monitor's credential is in neither id nor the job.
      expect(getEnqueuedJobId()).not.toContain(secretKey);
      expect(JSON.stringify(options)).not.toContain(secretKey);
      expect(JSON.stringify(jobData)).not.toContain(secretKey);
    });

    test("every request gets an id of its own, while the monitor keeps one job and one list", async () => {
      const frozenUnixNano: number = 1234567890123456;
      jest
        .spyOn(OneUptimeDate, "getCurrentDateAsUnixNano")
        .mockReturnValue(frozenUnixNano);

      const secretKey: string = ObjectID.generate().toString();

      for (let i: number = 0; i < 3; i++) {
        await TelemetryQueueService.addIncomingRequestIngestJob({
          secretKey,
          requestHeaders: {},
          requestBody: { sequence: i },
          requestMethod: "POST",
        });
      }

      const requestIds: Array<string> = getPushMock().mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { requestId: string }).requestId;
        },
      );

      expect(new Set(requestIds).size).toBe(3);

      // Distinct job ids (random suffix) even with the clock pinned...
      expect(
        new Set([getEnqueuedJobId(0), getEnqueuedJobId(1), getEnqueuedJobId(2)])
          .size,
      ).toBe(3);

      // ...but one deduplication id, so BullMQ keeps one job per monitor.
      const deduplicationIds: Array<unknown> = [0, 1, 2].map(
        (index: number) => {
          return (getEnqueuedJobOptions(index)["deduplication"] as JSONObject)[
            "id"
          ];
        },
      );

      expect(new Set(deduplicationIds).size).toBe(1);
    });

    test("two monitors have two jobs and two lists", async () => {
      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey: ObjectID.generate().toString(),
        requestHeaders: {},
        requestBody: {},
        requestMethod: "POST",
      });
      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey: ObjectID.generate().toString(),
        requestHeaders: {},
        requestBody: {},
        requestMethod: "POST",
      });

      expect(
        (getEnqueuedJobOptions(0)["deduplication"] as JSONObject)["id"],
      ).not.toBe(
        (getEnqueuedJobOptions(1)["deduplication"] as JSONObject)["id"],
      );
    });

    /*
     * The worker records the heartbeat at this time, not at the time the
     * queue gets around to the request - under a backlog those are minutes
     * apart, and the heartbeat cron judges "received in the last N minutes"
     * from it.
     */
    test("keeps the endpoint's arrival time as the request's ingestion timestamp", async () => {
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

      const kept: IncomingRequestIngestJobData = (
        getPushMock().mock.calls[0]![0] as {
          payload: IncomingRequestIngestJobData;
        }
      ).payload;

      expect(new Date(kept.ingestionTimestamp).getTime()).toBe(
        receivedAt.getTime(),
      );
    });

    test("without an arrival time the request is stamped with the enqueue time", async () => {
      const enqueuedAt: Date = new Date("2026-10-05T12:19:00.250Z");

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(enqueuedAt);

      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey: ObjectID.generate().toString(),
        requestHeaders: {},
        requestBody: {},
        requestMethod: "POST",
      });

      const kept: IncomingRequestIngestJobData = (
        getPushMock().mock.calls[0]![0] as {
          payload: IncomingRequestIngestJobData;
        }
      ).payload;

      expect(new Date(kept.ingestionTimestamp).getTime()).toBe(
        enqueuedAt.getTime(),
      );
    });

    /*
     * A job for a request that is not kept would evaluate nothing of it.
     * The enqueue fails instead, and the endpoint answers 503 for the
     * sender to send it again.
     */
    test("does not queue a job for a request it could not keep, and says so", async () => {
      getPushMock().mockRejectedValueOnce(
        new Error(
          "Redis is not connected, so waiting incoming requests cannot be kept or read.",
        ),
      );

      await expect(
        TelemetryQueueService.addIncomingRequestIngestJob({
          secretKey: ObjectID.generate().toString(),
          requestHeaders: {},
          requestBody: {},
          requestMethod: "POST",
        }),
      ).rejects.toThrow("Redis is not connected");

      expect(getAddJobMock()).not.toHaveBeenCalled();
    });

    test("a job that cannot be queued fails the enqueue too", async () => {
      getAddJobMock().mockRejectedValueOnce(new Error("Queue unavailable"));

      await expect(
        TelemetryQueueService.addIncomingRequestIngestJob({
          secretKey: ObjectID.generate().toString(),
          requestHeaders: {},
          requestBody: {},
          requestMethod: "POST",
        }),
      ).rejects.toThrow("Queue unavailable");
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

    test("queues each request as its own job, carrying it, and keeps nothing", async () => {
      const secretKey: string = ObjectID.generate().toString();
      const receivedAt: Date = new Date("2026-10-05T12:19:00.000Z");

      await TelemetryQueueService.addIncomingRequestIngestJob({
        secretKey,
        requestHeaders: { "x-test": "1" },
        requestBody: { status: "firing" },
        requestMethod: "POST",
        receivedAt: receivedAt,
      });

      expect(getPushMock()).not.toHaveBeenCalled();
      expect(getAddJobMock()).toHaveBeenCalledTimes(1);

      const jobData: TelemetryIngestJobData = getEnqueuedJobData();
      expect(jobData.type).toBe(TelemetryType.IncomingRequestIngest);

      const jobRequest: IncomingRequestIngestJobData =
        jobData.incomingRequestIngest!;

      expect(jobRequest.secretKey).toBe(secretKey);
      expect(jobRequest.requestBody).toEqual({ status: "firing" });
      expect(new Date(jobRequest.ingestionTimestamp).getTime()).toBe(
        receivedAt.getTime(),
      );
      expect(
        Object.prototype.hasOwnProperty.call(jobRequest, "coalescedPayloadId"),
      ).toBe(false);

      const options: JSONObject = getEnqueuedJobOptions();
      expect(options["skipExistenceCheck"]).toBe(true);
      expect(options["deduplication"]).toBeUndefined();
    });
  });
});

describe("TelemetryQueueService.addIncomingRequestPendingJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("a job whose last attempt failed queues the next one later, for the same monitor", async () => {
    await TelemetryQueueService.addIncomingRequestPendingJob({
      secretKeyHash: "abc123",
      delayInMs: 60000,
    });

    const options: JSONObject = getEnqueuedJobOptions();

    expect(options["delayInMs"]).toBe(60000);
    expect(options["deduplication"]).toEqual({
      id: "incoming-request-pending-abc123",
      keepLastIfActive: true,
    });
    expect(getEnqueuedJobData().incomingRequestPending).toEqual({
      secretKeyHash: "abc123",
    });
  });

  /*
   * During an upgrade a monitor may have a job of each kind queued; the
   * earlier release's deduplication id must not swallow this one's adds.
   */
  test("is not deduplicated with the jobs an earlier release queued", () => {
    const secretKey: string = ObjectID.generate().toString();
    const secretKeyHash: string = createHash("sha256")
      .update(secretKey)
      .digest("hex");

    expect(
      TelemetryQueueService.getIncomingRequestPendingDeduplicationId(
        secretKeyHash,
      ),
    ).not.toBe(`incoming-request-${secretKey}`);
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
