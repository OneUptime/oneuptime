import { describe, expect, test, beforeEach } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryQueueService, {
  TelemetryType,
  TelemetryIngestJobData,
  WORKER_CONSUMED_REQUEST_HEADERS,
  pickWorkerConsumedRequestHeaders,
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
 * data, so it is replaced with a deterministic in-memory fake.
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

type MockedFn = jest.Mock;

const getAddJobMock: () => MockedFn = (): MockedFn => {
  return Queue.addJob as unknown as MockedFn;
};

const getEnqueuedJobData: (callIndex?: number) => TelemetryIngestJobData = (
  callIndex: number = 0,
): TelemetryIngestJobData => {
  return getAddJobMock().mock.calls[callIndex]![3] as TelemetryIngestJobData;
};

describe("pickWorkerConsumedRequestHeaders", () => {
  test("whitelist is exactly the set of headers worker code reads from job data", () => {
    /*
     * Guard test: this pins the whitelist to the enumeration documented
     * on WORKER_CONSUMED_REQUEST_HEADERS. If a new worker-side header
     * consumer is added, this test forces the author to update both the
     * whitelist and this assertion together.
     */
    expect(WORKER_CONSUMED_REQUEST_HEADERS).toEqual([
      "x-oneuptime-service-name",
    ]);
  });

  test("keeps exactly the consumed set and drops secrets and noise", () => {
    const projected: Record<string, string> = pickWorkerConsumedRequestHeaders({
      "x-oneuptime-service-name": "checkout-service",
      "x-oneuptime-token": "super-secret-ingestion-token",
      "x-oneuptime-service-token": "another-secret",
      "x-oneuptime-ingestion-key": "yet-another-secret",
      cookie: "session=abc123",
      "user-agent": "OTel-OTLP-Exporter-JavaScript/0.50.0",
      authorization: "Bearer something",
      host: "otlp.example.com",
      accept: "*/*",
    });

    expect(projected).toEqual({
      "x-oneuptime-service-name": "checkout-service",
    });
  });

  test("content-type and content-encoding are NOT in the whitelist (consumed at enqueue time)", () => {
    /*
     * These two are read off req.headers at enqueue time and carried as
     * bodyFormat / bodyEncoding on the job — the worker decodes via
     * those fields, never via headers, so they must not survive the
     * projection.
     */
    const projected: Record<string, string> = pickWorkerConsumedRequestHeaders({
      "content-type": "application/x-protobuf",
      "content-encoding": "gzip",
    });

    expect(projected).toEqual({});
  });

  test("matches header names case-insensitively and emits lowercased keys", () => {
    /*
     * Express and grpc-js both lowercase names already, but internal
     * producers (Pyroscope conversion, tests) build header objects by
     * hand — a mixed-case key must still be recognized and normalized
     * to the exact key the worker reads.
     */
    const projected: Record<string, string> = pickWorkerConsumedRequestHeaders({
      "X-OneUptime-Service-Name": "billing-service",
      "X-OneUptime-Token": "secret",
    });

    expect(projected).toEqual({
      "x-oneuptime-service-name": "billing-service",
    });
  });

  test("empty and missing inputs project to an empty object", () => {
    expect(pickWorkerConsumedRequestHeaders({})).toEqual({});
    expect(
      pickWorkerConsumedRequestHeaders({
        "x-oneuptime-token": "secret-only",
      }),
    ).toEqual({});
  });

  test("drops whitelisted headers whose value is undefined", () => {
    const projected: Record<string, string> = pickWorkerConsumedRequestHeaders({
      "x-oneuptime-service-name": undefined,
    });

    expect(projected).toEqual({});
    expect(
      Object.prototype.hasOwnProperty.call(
        projected,
        "x-oneuptime-service-name",
      ),
    ).toBe(false);
  });

  test("array values pass through unchanged for the worker-side reader", () => {
    /*
     * req.headers can legally hold string arrays and
     * OtelIngestBaseService.getServiceNameFromHeaders accepts both
     * shapes — exactly as it did when the whole header object was
     * carried verbatim, so the projection must not flatten them.
     */
    const arrayValue: Array<string> = ["first-service", "second-service"];
    const projected: Record<string, string> = pickWorkerConsumedRequestHeaders({
      "x-oneuptime-service-name": arrayValue,
    });

    expect(projected["x-oneuptime-service-name"]).toBe(
      arrayValue as unknown as string,
    );
  });
});

describe("addTelemetryIngestJob header projection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("OTel raw-buffer job carries only whitelisted headers — the token never reaches the job payload", async () => {
    const secretToken: string = "super-secret-ingestion-token-value";
    const projectId: ObjectID = ObjectID.generate();

    const req: TelemetryRequest = {
      projectId,
      productType: ProductType.Traces,
      headers: {
        "x-oneuptime-token": secretToken,
        "x-oneuptime-service-name": "checkout-service",
        "content-type": "application/x-protobuf",
        "content-encoding": "gzip",
        "user-agent": "OTel-OTLP-Exporter-JavaScript/0.50.0",
        cookie: "session=abc123",
      },
      body: Buffer.from([0x0a, 0x03, 0x01, 0x02, 0x03]),
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Traces,
    );

    expect(getAddJobMock()).toHaveBeenCalledTimes(1);

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    // Exactly the whitelist — nothing else rides along into Redis.
    expect(jobData.requestHeaders).toEqual({
      "x-oneuptime-service-name": "checkout-service",
    });

    /*
     * The job payload is what BullMQ JSON-serializes into Redis (and
     * surfaces in failed-job listings) — the secret must not appear
     * anywhere in it, under any key.
     */
    expect(JSON.stringify(jobData)).not.toContain(secretToken);

    /*
     * content-type / content-encoding are consumed at enqueue time into
     * bodyFormat / bodyEncoding, so dropping them from requestHeaders
     * must not break the worker's decode path.
     */
    expect(jobData.bodyFormat).toBe(OtelPayloadFormat.Protobuf);
    expect(jobData.bodyEncoding).toBe("gzip");
    expect(jobData.productType).toBe(ProductType.Traces);
  });

  test("parsed-object (gRPC-shaped) job also carries only whitelisted headers", async () => {
    const secretToken: string = "grpc-metadata-secret-token";
    const projectId: ObjectID = ObjectID.generate();

    const req: TelemetryRequest = {
      projectId,
      productType: ProductType.Logs,
      headers: {
        "x-oneuptime-token": secretToken,
        "x-oneuptime-service-name": "grpc-service",
        "grpc-accept-encoding": "identity,deflate,gzip",
      },
      body: { resourceLogs: [] },
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(req, TelemetryType.Logs);

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    expect(jobData.requestHeaders).toEqual({
      "x-oneuptime-service-name": "grpc-service",
    });
    expect(JSON.stringify(jobData)).not.toContain(secretToken);
  });

  test("syslog / fluent jobs (requestBody path) get the same projection", async () => {
    const secretToken: string = "syslog-secret-token";
    const projectId: ObjectID = ObjectID.generate();

    const req: TelemetryRequest = {
      projectId,
      headers: {
        "x-oneuptime-token": secretToken,
        "user-agent": "rsyslog/8.2310",
      },
      body: { message: "<134>1 2026-08-10T00:00:00Z host app - - - hello" },
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Syslog,
    );

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    expect(jobData.requestHeaders).toEqual({});
    expect(JSON.stringify(jobData)).not.toContain(secretToken);
    // The syslog body itself still travels inline, untouched.
    expect(jobData.requestBody).toEqual(req.body);
  });

  test("requests with no service-name header enqueue an empty header map (worker falls back to its default)", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const req: TelemetryRequest = {
      projectId,
      productType: ProductType.Metrics,
      headers: {
        "x-oneuptime-token": "secret",
      },
      body: { resourceMetrics: [] },
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Metrics,
    );

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    expect(jobData.requestHeaders).toEqual({});
    expect(jobData.requestHeaders).not.toBeUndefined();
  });
});
