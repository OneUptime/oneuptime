import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelProfilesIngestService from "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import ProfilesQueueService from "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService";
import TracesQueueService from "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { ExpressResponse } from "Common/Server/Utils/Express";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ObjectID from "Common/Types/ObjectID";

/*
 * Exercise the actual HTTP handlers and Response helpers, replacing only
 * queue admission (no Redis/worker) and an unrelated import-time dependency.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return { __esModule: true, default: class PasswordHashStub {} };
});
jest.mock("../../FeatureSet/Telemetry/Services/Queue/LogsQueueService", () => {
  return { __esModule: true, default: { addLogIngestJob: jest.fn() } };
});
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService",
  () => {
    return { __esModule: true, default: { addMetricIngestJob: jest.fn() } };
  },
);
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService",
  () => {
    return { __esModule: true, default: { addProfileIngestJob: jest.fn() } };
  },
);
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService",
  () => {
    return { __esModule: true, default: { addTraceIngestJob: jest.fn() } };
  },
);

interface Signal {
  name: string;
  ingest: typeof OtelLogsIngestService.ingestLogs;
  queue: (req: TelemetryRequest) => Promise<void>;
}

const signals: Array<Signal> = [
  {
    name: "logs",
    ingest: OtelLogsIngestService.ingestLogs,
    queue: LogsQueueService.addLogIngestJob,
  },
  {
    name: "metrics",
    ingest: OtelMetricsIngestService.ingestMetrics,
    queue: MetricsQueueService.addMetricIngestJob,
  },
  {
    name: "profiles",
    ingest: OtelProfilesIngestService.ingestProfiles,
    queue: ProfilesQueueService.addProfileIngestJob,
  },
  {
    name: "traces",
    ingest: OtelTracesIngestService.ingestTraces,
    queue: TracesQueueService.addTraceIngestJob,
  },
];

function response(): ExpressResponse {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
}

function request(
  contentType: string = "application/x-protobuf",
): TelemetryRequest {
  return {
    projectId: ObjectID.generate(),
    body: Buffer.from("synthetic-raw-body"),
    headers: { "content-type": contentType, "content-encoding": "gzip" },
  } as unknown as TelemetryRequest;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe.each(signals)(
  "HTTP $name enqueue acknowledgement",
  ({ ingest, queue }: Signal) => {
    test.each([
      "application/x-protobuf",
      "application/protobuf",
      "application/json",
    ])(
      "does not acknowledge pending admission; preserves raw %s request and success shape",
      async (contentType: string) => {
        let admit!: () => void;
        (queue as jest.Mock).mockImplementation(() => {
          return new Promise<void>((resolve: () => void) => {
            admit = resolve;
          });
        });
        const req: TelemetryRequest = request(contentType);
        const body: unknown = req.body;
        const res: ExpressResponse = response();
        const next: jest.Mock = jest.fn();
        const pending: Promise<void> = ingest(req, res, next);

        // Snapshot before settling the promise; always drain it, even on RED.
        const earlyReplies: number = (res.send as jest.Mock).mock.calls.length;
        admit();
        await pending;

        expect(earlyReplies).toBe(0);
        expect(queue).toHaveBeenCalledTimes(1);
        expect(queue).toHaveBeenCalledWith(req);
        expect(req.body).toBe(body);
        expect(req.headers).toEqual({
          "content-type": contentType,
          "content-encoding": "gzip",
        });
        expect(res.status).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledTimes(1);
        expect(res.send).toHaveBeenCalledWith({});
        expect(res.set).not.toHaveBeenCalled();
        expect(res.setHeader).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
      },
    );

    test.each(["reject", "throw"])(
      "returns one sanitized retryable 503 on queue %s",
      async (mode: string) => {
        const failure: Error = new Error("private-payload-and-backend-error");
        (queue as jest.Mock).mockImplementation(() => {
          if (mode === "throw") {
            throw failure;
          }
          return Promise.reject(failure);
        });
        const res: ExpressResponse = response();
        const next: jest.Mock = jest.fn();
        await ingest(request(), res, next);

        expect(res.status).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.send).toHaveBeenCalledTimes(1);
        expect(res.send).toHaveBeenCalledWith({
          message: "Telemetry queue unavailable. Please retry.",
        });
        expect(next).not.toHaveBeenCalled();
      },
    );

    test("keeps project validation on the existing error path without enqueueing", async () => {
      const req: TelemetryRequest = {
        body: {},
        headers: {},
      } as TelemetryRequest;
      const res: ExpressResponse = response();
      const next: jest.Mock = jest.fn();
      await ingest(req, res, next);
      expect(queue).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]![0]).toBeInstanceOf(BadRequestException);
    });
  },
);
