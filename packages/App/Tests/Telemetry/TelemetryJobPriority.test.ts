import { beforeEach, describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryQueueService, {
  TELEMETRY_BULK_JOB_PRIORITY,
  TelemetryIngestJobData,
  TelemetryType,
  getTelemetryJobPriority,
  isBulkTelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import fs from "fs";
import path from "path";

/*
 * MONITORING WORK GOES AHEAD OF BULK TELEMETRY (OneUptime issue #11131).
 *
 * Every telemetry ingest and every piece of monitoring work is one job on the
 * Telemetry queue. Queued in the order they arrived, a probe's monitor result
 * waited behind every log, trace and metric batch ahead of it: an
 * installation whose ingest fell 15 million jobs behind (#11017) saw its
 * monitors trail its probes by hours. Now the bulk telemetry is queued with a
 * priority and the monitoring work without one, so BullMQ takes the
 * monitoring work first (TelemetryMonitoringFirstValkey.test.ts runs it on a
 * real queue). Here: which type is which, and that every path that queues a
 * job queues it with its type's priority.
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

jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: jest.fn().mockResolvedValue("telemetry:body:test-key"),
      readBody: jest.fn(),
      deleteBody: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Utils/SessionReplayChunkStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: jest.fn().mockResolvedValue("session-replay:body:test-key"),
      readBody: jest.fn(),
      deleteBody: jest.fn(),
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore",
  () => {
    return {
      __esModule: true,
      default: {
        push: jest.fn().mockResolvedValue({ waiting: 1, skipped: 0 }),
        getSecretKeyHash: (secretKey: string): string => {
          return `hash-of-${secretKey}`;
        },
      },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Utils/SnmpTrapPendingStore", () => {
  return {
    __esModule: true,
    default: {
      push: jest.fn().mockResolvedValue(undefined),
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Utils/NetworkDevicePollLatestStore",
  () => {
    return {
      __esModule: true,
      default: {
        store: jest.fn().mockResolvedValue(undefined),
      },
    };
  },
);

const BULK_TYPES: Array<TelemetryType> = [
  TelemetryType.Logs,
  TelemetryType.Traces,
  TelemetryType.Metrics,
  TelemetryType.Profiles,
  TelemetryType.Syslog,
  TelemetryType.FluentLogs,
  TelemetryType.SecurityEvents,
  TelemetryType.KubernetesCostIngest,
  TelemetryType.SessionReplay,
  TelemetryType.ProductAnalyticsEvents,
];

const MONITORING_TYPES: Array<TelemetryType> = [
  TelemetryType.ProbeIngest,
  TelemetryType.ServerMonitorIngest,
  TelemetryType.IncomingRequestIngest,
  TelemetryType.IncomingRequestPending,
  TelemetryType.TelemetryMonitorEvaluation,
];

interface QueuedJob {
  data: TelemetryIngestJobData;
  options: JSONObject;
}

function queuedJobs(): Array<QueuedJob> {
  return (Queue.addJob as unknown as jest.Mock).mock.calls.map(
    (call: Array<unknown>): QueuedJob => {
      return {
        data: call[3] as TelemetryIngestJobData,
        options: (call[4] || {}) as JSONObject,
      };
    },
  );
}

function onlyQueuedJob(): QueuedJob {
  const jobs: Array<QueuedJob> = queuedJobs();
  expect(jobs).toHaveLength(1);
  return jobs[0]!;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("which telemetry jobs go first", () => {
  test("every type of telemetry job is either bulk telemetry or monitoring work", () => {
    expect([...BULK_TYPES, ...MONITORING_TYPES].sort()).toEqual(
      Object.values(TelemetryType).sort(),
    );
  });

  test.each(BULK_TYPES)(
    "%s is bulk telemetry, queued with the bulk priority",
    (type: TelemetryType) => {
      expect(isBulkTelemetryType(type)).toBe(true);
      expect(getTelemetryJobPriority(type)).toBe(TELEMETRY_BULK_JOB_PRIORITY);
    },
  );

  test.each(MONITORING_TYPES)(
    "%s is monitoring work, queued with no priority, so it is taken first",
    (type: TelemetryType) => {
      expect(isBulkTelemetryType(type)).toBe(false);
      expect(getTelemetryJobPriority(type)).toBeUndefined();
    },
  );

  test("the bulk priority is one BullMQ takes after every job without one", () => {
    // 0 and no priority are the highest; BullMQ allows up to 2^21.
    expect(Number.isInteger(TELEMETRY_BULK_JOB_PRIORITY)).toBe(true);
    expect(TELEMETRY_BULK_JOB_PRIORITY).toBeGreaterThan(0);
    expect(TELEMETRY_BULK_JOB_PRIORITY).toBeLessThanOrEqual(2 ** 21);
  });

  test("a type this release does not know is never sent behind the telemetry", () => {
    expect(
      getTelemetryJobPriority("a-type-of-a-newer-release" as TelemetryType),
    ).toBeUndefined();
  });
});

describe("each enqueue path queues its job with its type's priority", () => {
  test.each([
    TelemetryType.Logs,
    TelemetryType.Traces,
    TelemetryType.Metrics,
    TelemetryType.Profiles,
  ])(
    "an OTLP %s batch waits behind the monitoring work",
    async (type: TelemetryType) => {
      await TelemetryQueueService.addTelemetryIngestJob(
        {
          projectId: ObjectID.generate(),
          headers: { "content-type": "application/x-protobuf" },
          body: Buffer.from([0x0a, 0x00]),
        } as unknown as TelemetryRequest,
        type,
      );

      const job: QueuedJob = onlyQueuedJob();
      expect(job.data.type).toBe(type);
      expect(job.options["priority"]).toBe(TELEMETRY_BULK_JOB_PRIORITY);
      // What it was queued with before stays as it was.
      expect(job.options["skipExistenceCheck"]).toBe(true);
    },
  );

  test.each([
    TelemetryType.Syslog,
    TelemetryType.FluentLogs,
    TelemetryType.SecurityEvents,
  ])(
    "a %s batch waits behind the monitoring work",
    async (type: TelemetryType) => {
      await TelemetryQueueService.addTelemetryIngestJob(
        {
          projectId: ObjectID.generate(),
          headers: { "content-type": "application/json" },
          body: { message: "a line" },
        } as unknown as TelemetryRequest,
        type,
      );

      const job: QueuedJob = onlyQueuedJob();
      expect(job.data.type).toBe(type);
      expect(job.options["priority"]).toBe(TELEMETRY_BULK_JOB_PRIORITY);
    },
  );

  test.each(["probe-response", "monitor-test"] as const)(
    "a probe's %s is taken first",
    async (jobType: "probe-response" | "monitor-test") => {
      await TelemetryQueueService.addProbeIngestJob({
        probeId: ObjectID.generate(),
        probeMonitorResponse: { monitorId: ObjectID.generate().toString() },
        jobType: jobType,
        testId: jobType === "monitor-test" ? "a-test" : undefined,
      });

      const job: QueuedJob = onlyQueuedJob();
      expect(job.data.type).toBe(TelemetryType.ProbeIngest);
      expect(job.options["priority"]).toBeUndefined();
    },
  );

  test("an SNMP trap is taken first, queued alone or as its sender's batch", async () => {
    await TelemetryQueueService.addSnmpTrapIngestJob({
      probeId: ObjectID.generate(),
      snmpTrap: {},
    });
    await TelemetryQueueService.addSnmpTrapBatchJob({
      probeId: ObjectID.generate().toString(),
      sourceIpAddress: "192.0.2.10",
    });

    const jobs: Array<QueuedJob> = queuedJobs();
    expect(jobs).toHaveLength(2);

    for (const job of jobs) {
      expect(job.data.type).toBe(TelemetryType.ProbeIngest);
      expect(job.options["priority"]).toBeUndefined();
    }
  });

  test("a network device's poll is taken first", async () => {
    await TelemetryQueueService.addNetworkDeviceWalkJob({
      walkRequestBody: {
        probeId: ObjectID.generate().toString(),
        networkDeviceId: ObjectID.generate().toString(),
        isOnline: true,
      },
    });

    const job: QueuedJob = onlyQueuedJob();
    expect(job.data.type).toBe(TelemetryType.ProbeIngest);
    expect(job.options["priority"]).toBeUndefined();
  });

  test("an incoming email is taken first", async () => {
    await TelemetryQueueService.addIncomingEmailJob({
      secretKey: "a-monitor-secret",
      emailFrom: "alerts@example.com",
      emailTo: "monitor-a-monitor-secret@inbound.example.com",
      emailSubject: "Backup finished",
      emailBody: "OK",
    });

    const job: QueuedJob = onlyQueuedJob();
    expect(job.data.type).toBe(TelemetryType.ProbeIngest);
    expect(job.options["priority"]).toBeUndefined();
  });

  test("a server monitor's report is taken first", async () => {
    await TelemetryQueueService.addServerMonitorIngestJob({
      secretKey: "a-server-secret",
      serverMonitorResponse: { hostname: "db-1" },
    });

    const job: QueuedJob = onlyQueuedJob();
    expect(job.data.type).toBe(TelemetryType.ServerMonitorIngest);
    expect(job.options["priority"]).toBeUndefined();
  });

  test("an incoming request - a heartbeat - is taken first", async () => {
    await TelemetryQueueService.addIncomingRequestIngestJob({
      secretKey: "a-heartbeat-secret",
      requestHeaders: {},
      requestBody: { status: "ok" },
      requestMethod: "POST",
    });

    const jobs: Array<QueuedJob> = queuedJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(1);

    for (const job of jobs) {
      expect(MONITORING_TYPES).toContain(job.data.type);
      expect(job.options["priority"]).toBeUndefined();
    }
  });

  test("a monitor's waiting incoming requests are taken first", async () => {
    await TelemetryQueueService.addIncomingRequestPendingJob({
      secretKeyHash: "a-hash",
    });

    const job: QueuedJob = onlyQueuedJob();
    expect(job.data.type).toBe(TelemetryType.IncomingRequestPending);
    expect(job.options["priority"]).toBeUndefined();
  });

  test("a telemetry monitor's evaluation is taken first", async () => {
    await TelemetryQueueService.addTelemetryMonitorEvaluationJob({
      monitorId: ObjectID.generate(),
      projectId: ObjectID.generate(),
    });

    const job: QueuedJob = onlyQueuedJob();
    expect(job.data.type).toBe(TelemetryType.TelemetryMonitorEvaluation);
    expect(job.options["priority"]).toBeUndefined();
    // Its per-monitor coalescing is kept.
    expect(job.options["deduplication"]).toBeDefined();
  });

  test("a Kubernetes cost report waits behind the monitoring work", async () => {
    await TelemetryQueueService.addKubernetesCostIngestJob({
      projectId: ObjectID.generate(),
      costPayload: { clusterName: "prod" },
    });

    const job: QueuedJob = onlyQueuedJob();
    expect(job.data.type).toBe(TelemetryType.KubernetesCostIngest);
    expect(job.options["priority"]).toBe(TELEMETRY_BULK_JOB_PRIORITY);
  });

  test("a session replay chunk waits behind the monitoring work", async () => {
    await TelemetryQueueService.addSessionReplayIngestJob({
      projectId: ObjectID.generate(),
      appIdentifier: "web",
      body: Buffer.from("{}"),
      serverReceiveUnixMs: Date.now(),
      samplePercentageAtCapture: 100,
      countryCode: "US",
      inlineStagingMaxBytes: 1024,
    });

    const job: QueuedJob = onlyQueuedJob();
    expect(job.data.type).toBe(TelemetryType.SessionReplay);
    expect(job.options["priority"]).toBe(TELEMETRY_BULK_JOB_PRIORITY);
  });

  test("a product analytics batch waits behind the monitoring work", async () => {
    await TelemetryQueueService.addProductAnalyticsEventsJob({
      projectId: ObjectID.generate().toString(),
      batchId: "a-batch",
    } as unknown as Parameters<
      typeof TelemetryQueueService.addProductAnalyticsEventsJob
    >[0]);

    const job: QueuedJob = onlyQueuedJob();
    expect(job.data.type).toBe(TelemetryType.ProductAnalyticsEvents);
    expect(job.options["priority"]).toBe(TELEMETRY_BULK_JOB_PRIORITY);
  });
});

/*
 * A path added later that queues a Telemetry job without the priority would
 * put bulk telemetry ahead of the monitoring work again, or monitoring work
 * behind the telemetry. Every job this service queues takes its priority
 * from the one table, by its type.
 */
describe("every Telemetry job the service queues takes its priority from its type", () => {
  const source: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService.ts",
    ),
    "utf8",
  );

  test("each Queue.addJob call on the Telemetry queue passes getTelemetryJobPriority(jobData.type)", () => {
    const calls: Array<string> = source.split("Queue.addJob(").slice(1);

    expect(calls.length).toBeGreaterThanOrEqual(13);

    for (const call of calls) {
      // The call's own arguments, up to the statement's end.
      const args: string = call.slice(0, call.indexOf(");"));

      expect(args).toContain("QueueName.Telemetry");
      expect(args).toContain("priority: getTelemetryJobPriority(jobData.type)");
    }
  });
});
