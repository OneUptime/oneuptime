import {
  DATA_SECURITY_DISCOVER_PROJECT_JOB,
  DATA_SECURITY_EVALUATE_PROJECT_JOB,
  DATA_SECURITY_READ_CONNECTION_JOB,
  DATA_SECURITY_SCAN_STORE_JOB,
  DATA_SECURITY_SCAN_TELEMETRY_JOB,
  queueDataSecurityConnectionRead,
  queueDataSecurityDiscovery,
  queueDataSecurityEvaluation,
  queueDataSecurityTelemetryScan,
  queueDataStoreScan,
} from "../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import Queue, { QueueName } from "../../../../Server/Infrastructure/Queue";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Data Security's work is split into queue jobs (DataSecurityJobs): one
 * per project, store or connection, each deduplicated by what it is
 * about - so five settings saved in a row queue one evaluation - and
 * queued best effort. The queue is stood in for and its calls read back.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

interface QueuedJob {
  queueName: QueueName;
  jobId: string;
  jobName: string;
  payload: Record<string, string>;
  options: {
    deduplication: { id: string; keepLastIfActive: boolean };
    removeWhenDone: boolean;
  };
}

let queueSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  queueSpy = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function queued(): Array<QueuedJob> {
  return queueSpy.mock.calls.map((call: Array<unknown>): QueuedJob => {
    return {
      queueName: call[0] as QueueName,
      jobId: call[1] as string,
      jobName: call[2] as string,
      payload: call[3] as Record<string, string>,
      options: call[4] as QueuedJob["options"],
    };
  });
}

const UUID_SUFFIX: RegExp =
  /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CASES: Array<{
  what: string;
  queue: () => Promise<void>;
  jobName: string;
  key: string;
  payload: Record<string, string>;
}> = [
  {
    what: "a project's discovery",
    queue: () => {
      return queueDataSecurityDiscovery(PROJECT_ID);
    },
    jobName: "DataSecurity:DiscoverProject",
    key: `data-security-discover-${PROJECT_ID.toString()}`,
    payload: { projectId: PROJECT_ID.toString() },
  },
  {
    what: "a project's telemetry scan",
    queue: () => {
      return queueDataSecurityTelemetryScan(PROJECT_ID);
    },
    jobName: "DataSecurity:ScanProjectTelemetry",
    key: `data-security-telemetry-${PROJECT_ID.toString()}`,
    payload: { projectId: PROJECT_ID.toString() },
  },
  {
    what: "a project's evaluation",
    queue: () => {
      return queueDataSecurityEvaluation(PROJECT_ID);
    },
    jobName: "DataSecurity:EvaluateProject",
    key: `data-security-evaluate-${PROJECT_ID.toString()}`,
    payload: { projectId: PROJECT_ID.toString() },
  },
  {
    what: "a store's content scan",
    queue: () => {
      return queueDataStoreScan({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
      });
    },
    jobName: "DataSecurity:ScanStore",
    key: `data-security-scan-${STORE_ID.toString()}`,
    payload: {
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID.toString(),
    },
  },
  {
    what: "a connection's configuration read",
    queue: () => {
      return queueDataSecurityConnectionRead({
        projectId: PROJECT_ID,
        cloudConnectionId: CONNECTION_ID,
      });
    },
    jobName: "DataSecurity:ReadConnection",
    key: `data-security-read-${CONNECTION_ID.toString()}`,
    payload: {
      projectId: PROJECT_ID.toString(),
      cloudConnectionId: CONNECTION_ID.toString(),
    },
  },
];

describe("the Data Security job names", () => {
  test("are the names the Workers register their functions under", () => {
    expect(DATA_SECURITY_DISCOVER_PROJECT_JOB).toBe(
      "DataSecurity:DiscoverProject",
    );
    // Not the hourly cron's "DataSecurity:ScanTelemetry": the Workers find a job's function by name.
    expect(DATA_SECURITY_SCAN_TELEMETRY_JOB).toBe(
      "DataSecurity:ScanProjectTelemetry",
    );
    expect(DATA_SECURITY_EVALUATE_PROJECT_JOB).toBe(
      "DataSecurity:EvaluateProject",
    );
    expect(DATA_SECURITY_SCAN_STORE_JOB).toBe("DataSecurity:ScanStore");
    expect(DATA_SECURITY_READ_CONNECTION_JOB).toBe(
      "DataSecurity:ReadConnection",
    );
  });
});

describe("queueing Data Security's work", () => {
  for (const item of CASES) {
    test(`${item.what} is one Worker job, deduplicated by what it is about`, async () => {
      await item.queue();

      expect(queued()).toHaveLength(1);

      const job: QueuedJob = queued()[0]!;

      expect(job.queueName).toBe(QueueName.Worker);
      expect(job.jobName).toBe(item.jobName);
      expect(job.payload).toEqual(item.payload);
      expect(job.options).toEqual({
        deduplication: { id: item.key, keepLastIfActive: true },
        removeWhenDone: true,
      });
      expect(job.jobId.startsWith(`${item.key}-`)).toBe(true);
      expect(job.jobId).toMatch(UUID_SUFFIX);
    });

    test(`${item.what} asked for twice is two jobs with one deduplication id`, async () => {
      await item.queue();
      await item.queue();

      const [first, second] = queued();

      expect(first!.jobId).not.toBe(second!.jobId);
      expect(first!.options.deduplication.id).toBe(
        second!.options.deduplication.id,
      );
    });

    test(`${item.what} that cannot be queued is logged, never thrown`, async () => {
      queueSpy.mockRejectedValue(new Error("Valkey went away"));

      await expect(item.queue()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(String(errorSpy.mock.calls[0]![0])).toMatch(
        /^DataSecurity: could not queue the .+:$/,
      );
    });
  }

  test("each kind of work has its own deduplication id, so one never holds another back", async () => {
    for (const item of CASES) {
      await item.queue();
    }

    expect(
      new Set(
        queued().map((job: QueuedJob): string => {
          return job.options.deduplication.id;
        }),
      ).size,
    ).toBe(CASES.length);
  });
});
