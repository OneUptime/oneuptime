/**
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import Queue, { QueueName } from "../../../Server/Infrastructure/Queue";
import { JSONObject } from "../../../Types/JSON";
import { Job, JobsOptions } from "bullmq";

/*
 * Keep this production-module test independent of application configuration,
 * telemetry initialization, and Redis. No service connections are opened.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return { QueueDashboardSecret: "test-only" };
});
jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    default: { getRedisOptions: jest.fn().mockReturnValue({}) },
    __esModule: true,
  };
});
jest.mock("../../../Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    default: () => {
      return (): void => {};
    },
    __esModule: true,
  };
});
jest.mock("../../../Server/Utils/Telemetry", () => {
  return {
    default: {
      isMetricsEnabled: () => {
        return false;
      },
    },
    __esModule: true,
  };
});
jest.mock("../../../Server/Utils/Logger", () => {
  return { default: { debug: jest.fn(), error: jest.fn() }, __esModule: true };
});
jest.mock("@bull-board/express", () => {
  return {};
});
jest.mock("@bull-board/api", () => {
  return {};
});
jest.mock("@bull-board/api/bullMQAdapter", () => {
  return {};
});

const mockQueue: {
  getJob: jest.Mock;
  add: jest.Mock;
  getRepeatableJobs: jest.Mock;
  removeRepeatableByKey: jest.Mock;
  clean: jest.Mock;
  client: Promise<{ on: jest.Mock }>;
} = {
  getJob: jest.fn(),
  add: jest.fn(),
  getRepeatableJobs: jest.fn(),
  removeRepeatableByKey: jest.fn(),
  clean: jest.fn().mockResolvedValue([]),
  client: Promise.resolve({ on: jest.fn() }),
};

jest.mock("bullmq", () => {
  return {
    Queue: jest.fn().mockImplementation(() => {
      return mockQueue;
    }),
  };
});

describe("Queue.addJob admission", () => {
  const storedJobs: Map<string, JSONObject> = new Map();
  let remove: jest.Mock;

  beforeEach(() => {
    storedJobs.clear();
    remove = jest.fn().mockImplementation(async (): Promise<void> => {
      storedJobs.delete("existing-job");
    });
    mockQueue.getJob.mockReset().mockResolvedValue({ remove });
    mockQueue.getRepeatableJobs.mockReset().mockResolvedValue([]);
    mockQueue.removeRepeatableByKey.mockReset().mockResolvedValue(true);
    mockQueue.add
      .mockReset()
      .mockImplementation(
        async (
          name: string,
          data: JSONObject,
          opts: JobsOptions,
        ): Promise<Job> => {
          const id: string = opts.jobId!;
          if (!storedJobs.has(id)) {
            storedJobs.set(id, data);
          }
          /*
           * BullMQ Job.create returns a local Job with the submitted data, even
           * when the add script returns an existing ID. It does not reload Redis.
           */
          return { id, name, data, opts } as Job;
        },
      );
  });

  it("retains the admitted job when Redis rejects the next add with OOM", async () => {
    const oldData: JSONObject = { version: "admitted" };
    storedJobs.set("existing-job", oldData);
    const oom: Error = new Error(
      "OOM command not allowed when used memory > 'maxmemory'.",
    );
    mockQueue.add.mockRejectedValueOnce(oom);

    await expect(
      Queue.addJob(QueueName.Worker, "existing:job", "Process", {
        version: "new",
      }),
    ).rejects.toBe(oom);

    expect(storedJobs.get("existing-job")).toBe(oldData);
    expect(remove).not.toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, false, true])(
    "uses native duplicate-ID semantics with skipExistenceCheck=%s",
    async (skipExistenceCheck: boolean | undefined) => {
      const oldData: JSONObject = { version: "admitted" };
      const newData: JSONObject = { version: "submitted" };
      storedJobs.set("existing-job", oldData);
      const result: Job = await Queue.addJob(
        QueueName.Worker,
        "existing:job",
        "Process",
        newData,
        {
          skipExistenceCheck,
        },
      );

      expect(storedJobs.get("existing-job")).toBe(oldData);
      expect(mockQueue.getJob).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(result.id).toBe("existing-job");
      // The return value is NOT proof that this payload was persisted.
      expect(result.data).toBe(newData);
      expect(mockQueue.add).toHaveBeenCalledWith("Process", newData, {
        jobId: "existing-job",
      });
    },
  );

  it("returns BullMQ's submitted Job object, not a reload of duplicate stored data", async () => {
    const { Job: BullJob }: { Job: typeof Job } = jest.requireActual(
      "bullmq/dist/cjs/classes/job",
    );
    const bullQueue: Parameters<typeof Job.create>[0] = {
      client: Promise.resolve({}),
      keys: {},
      opts: {},
      toKey: (key: string): string => {
        return `test:${key}`;
      },
    } as unknown as Parameters<typeof Job.create>[0];
    // The duplicate branch of BullMQ's add script returns the existing ID.
    const addJob: jest.SpyInstance = jest
      .spyOn(BullJob.prototype, "addJob")
      .mockResolvedValue("existing-job");
    const oldData: JSONObject = { version: "stored" };
    const newData: JSONObject = { version: "submitted" };
    storedJobs.set("existing-job", oldData);
    mockQueue.add.mockImplementation(
      (name: string, data: JSONObject, opts: JobsOptions) => {
        return BullJob.create(bullQueue, name, data, opts);
      },
    );
    try {
      const result: Job = await Queue.addJob(
        QueueName.Worker,
        "existing-job",
        "Process",
        newData,
      );
      expect(result).toBeInstanceOf(BullJob);
      expect(result.id).toBe("existing-job");
      expect(result.data).toBe(newData);
      expect(storedJobs.get("existing-job")).toBe(oldData);
      expect(mockQueue.getJob).not.toHaveBeenCalled();
    } finally {
      addJob.mockRestore();
    }
  });

  it("does not try to remove a locked active job", async () => {
    storedJobs.set("existing-job", { version: "active" });
    remove.mockRejectedValue(new Error("Job is locked by another worker"));

    await expect(
      Queue.addJob(QueueName.Worker, "existing-job", "Process", {}),
    ).resolves.toHaveProperty("id", "existing-job");
    expect(remove).not.toHaveBeenCalled();
    expect(storedJobs.get("existing-job")).toEqual({ version: "active" });
  });

  it("does not replace retained terminal jobs or restart them implicitly", async () => {
    for (const state of ["completed", "failed"]) {
      storedJobs.set("existing-job", { state });
      await Queue.addJob(QueueName.Worker, "existing-job", "Process", {});
      expect(storedJobs.get("existing-job")).toEqual({ state });
    }
    expect(remove).not.toHaveBeenCalled();
  });

  it("leaves the first stored payload in place under concurrent duplicate adds", async () => {
    const first: JSONObject = { version: "first" };
    const second: JSONObject = { version: "second" };
    await Promise.all([
      Queue.addJob(QueueName.Worker, "existing:job", "Process", first),
      Queue.addJob(QueueName.Worker, "existing-job", "Process", second),
    ]);
    expect(storedJobs.size).toBe(1);
    expect(storedJobs.get("existing-job")).toBe(first);
    expect(mockQueue.getJob).not.toHaveBeenCalled();
  });

  it("propagates admission errors without retrying or deleting the old job", async () => {
    storedJobs.set("existing-job", { version: "delayed" });
    const rejected: Error = new Error("Connection is closed");
    mockQueue.add.mockRejectedValueOnce(rejected);
    await expect(
      Queue.addJob(
        QueueName.Workflow,
        "existing-job",
        "Resume",
        {},
        { delayInMs: 1000 },
      ),
    ).rejects.toBe(rejected);
    expect(storedJobs.get("existing-job")).toEqual({ version: "delayed" });
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("preserves delay, retry, backoff and deduplication options", async () => {
    await Queue.addJob(
      QueueName.Telemetry,
      "unique:id",
      "Process",
      {},
      {
        delayInMs: 1000,
        attempts: 4,
        backoffDelayInMs: 200,
        deduplication: { id: "monitor:id", keepLastIfActive: true },
      },
    );
    expect(mockQueue.add).toHaveBeenLastCalledWith(
      "Process",
      {},
      {
        jobId: "unique-id",
        delay: 1000,
        attempts: 4,
        backoff: { type: "exponential", delay: 200 },
        deduplication: { id: "monitor-id", keepLastIfActive: true },
      },
    );
    await Queue.addJob(QueueName.Telemetry, "another-id", "Process", {});
    expect(mockQueue.add).toHaveBeenLastCalledWith(
      "Process",
      {},
      {
        jobId: "another-id",
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    );
    await Queue.addJob(
      QueueName.Telemetry,
      "no-retry",
      "Process",
      {},
      { attempts: 1 },
    );
    expect(mockQueue.add).toHaveBeenLastCalledWith(
      "Process",
      {},
      { jobId: "no-retry" },
    );
  });

  it.each([false, true])(
    "retains baseline repeatable replacement ordering with skipExistenceCheck=%s",
    async (skipExistenceCheck: boolean) => {
      const scheduleAt: string = "*/5 * * * *";
      mockQueue.getRepeatableJobs.mockResolvedValue([
        { name: "Process", pattern: scheduleAt, key: "matching:key" },
        { name: "Other", pattern: scheduleAt, key: "unrelated:key" },
      ]);
      const rejected: Error = new Error("admission rejected");
      mockQueue.add.mockRejectedValueOnce(rejected);
      await expect(
        Queue.addJob(
          QueueName.Worker,
          "scheduled-job",
          "Process",
          {},
          {
            scheduleAt,
            repeatableKey: "previous:key",
            skipExistenceCheck,
          },
        ),
      ).rejects.toBe(rejected);
      /*
       * Scope guard, NOT a safety claim: baseline removes definitions before
       * adding and remembers the attempted registration even if add rejects.
       */
      expect(mockQueue.removeRepeatableByKey.mock.calls).toEqual([
        ["matching:key"],
        ["previous:key"],
      ]);
      expect(
        mockQueue.removeRepeatableByKey.mock.invocationCallOrder[1],
      ).toBeLessThan(mockQueue.add.mock.invocationCallOrder[0]!);
      expect(mockQueue.getJob).toHaveBeenCalledTimes(
        skipExistenceCheck ? 0 : 1,
      );
      expect(remove).toHaveBeenCalledTimes(skipExistenceCheck ? 0 : 1);
      mockQueue.add.mockClear();
      const client: { on: jest.Mock } = await mockQueue.client;
      const ready: () => Promise<void> = client.on.mock.calls[0]![1];
      await ready();
      expect(mockQueue.add).toHaveBeenCalledWith(
        "Process",
        {},
        {
          jobId: "scheduled-job",
          repeat: { pattern: scheduleAt, jobId: "scheduled-job" },
        },
      );
    },
  );

  it("does not admit a replacement when baseline repeatable cleanup fails", async () => {
    const cleanupError: Error = new Error("cleanup unavailable");
    mockQueue.removeRepeatableByKey.mockRejectedValueOnce(cleanupError);
    await expect(
      Queue.addJob(
        QueueName.Workflow,
        "scheduled-job",
        "Process",
        {},
        {
          scheduleAt: "*/5 * * * *",
          repeatableKey: "previous:key",
        },
      ),
    ).rejects.toBe(cleanupError);
    expect(storedJobs.has("scheduled-job")).toBe(false);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
