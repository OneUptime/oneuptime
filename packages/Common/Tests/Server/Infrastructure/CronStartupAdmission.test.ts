/**
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import RunCron from "../../../../App/FeatureSet/Workers/Utils/Cron";
import JobDictionary from "../../../../App/FeatureSet/Workers/Utils/JobDictionary";
import Queue, { QueueName } from "../../../Server/Infrastructure/Queue";
import { JSONObject } from "../../../Types/JSON";
import { Job, JobsOptions } from "bullmq";

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
      startActiveSpan: ({ fn }: { fn: (span: unknown) => void }): void => {
        fn({ end: jest.fn(), recordException: jest.fn(), setStatus: jest.fn() });
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
  removeRepeatableByKey: jest.fn().mockResolvedValue(true),
  // The fire-and-forget startup sweep has not removed any terminal jobs yet.
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

type StoredJob = {
  name: string;
  state: "waiting" | "active" | "completed" | "failed";
  options: JobsOptions;
};

describe("RunCron startup admission through the production Queue wrapper", () => {
  const jobName: string = "Maintenance:Reconcile";
  const storedJobs: Map<string, StoredJob> = new Map();
  const deduplication: Map<string, string> = new Map();
  let finishRegistration: () => void;
  let admission: jest.SpyInstance;
  const run: jest.Mock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    storedJobs.clear();
    deduplication.clear();
    run.mockClear();
    admission = jest.spyOn(Queue, "addJob");
    /*
     * Repeat registration is asynchronous and must not be a prerequisite for
     * startup admission. Hold it until after assertions, as with slow Redis.
     */
    const registration: Promise<void> = new Promise((resolve: () => void) => {
      finishRegistration = resolve;
    });
    mockQueue.getRepeatableJobs.mockImplementation(async () => {
      await registration;
      return [];
    });
    mockQueue.getJob.mockReset().mockImplementation(async (id: string) => {
      return storedJobs.has(id)
        ? {
            remove: async (): Promise<void> => {
              storedJobs.delete(id);
            },
          }
        : undefined;
    });
    mockQueue.add
      .mockReset()
      .mockImplementation(async (name: string, _data: JSONObject, options: JobsOptions): Promise<Job> => {
        if (options.repeat) {
          return { repeatJobKey: "schedule-key" } as Job;
        }
        const id: string = options.jobId!;
        const key: string | undefined = options.deduplication?.id;
        const existingId: string | undefined = key ? deduplication.get(key) : undefined;
        if (existingId) {
          return { id: existingId } as Job;
        }
        if (!storedJobs.has(id)) {
          storedJobs.set(id, { name, state: "waiting", options });
          if (key) {
            deduplication.set(key, id);
          }
        }
        return { id } as Job;
      });
  });

  afterEach(async () => {
    finishRegistration();
    await Promise.all(
      admission.mock.results.map((result: jest.MockResult<Promise<Job>>) => {
        return result.value;
      }),
    );
    admission.mockRestore();
  });

  const start: (runOnStartup?: boolean) => Promise<void> = async (
    runOnStartup: boolean = true,
  ): Promise<void> => {
    RunCron(jobName, { schedule: "0 * * * *", runOnStartup }, run);
    // Await the real startup add, not the independent repeat registration.
    if (runOnStartup) {
      await admission.mock.results[admission.mock.results.length - 1]!.value;
    }
  };

  const waitingIds: () => string[] = (): string[] => {
    return [...storedJobs]
      .filter(([, job]: [string, StoredJob]) => {
        return job.state === "waiting";
      })
      .map(([id]: [string, StoredJob]) => {
        return id;
      });
  };

  it.each(["completed", "failed"] as const)(
    "admits a later startup after %s without removing the retained startup job",
    async (state: "completed" | "failed") => {
      await start();
      const firstId: string = waitingIds()[0]!;
      const first: StoredJob = storedJobs.get(firstId)!;
      first.state = state;
      /*
       * BullMQ simple-mode dedup keys are released on terminal transition,
       * independently of job retention. Model only that Redis boundary here.
       */
      deduplication.delete(first.options.deduplication!.id);
      await start();
      expect(waitingIds()).toHaveLength(1);
      expect(waitingIds()[0]).not.toBe(firstId);
      expect(storedJobs.get(firstId)?.state).toBe(state);
      expect(mockQueue.getJob).not.toHaveBeenCalled();
    },
  );

  it.each(["waiting", "active"] as const)(
    "coalesces startup requests while one is %s",
    async (state: "waiting" | "active") => {
      await start();
      const firstId: string = waitingIds()[0]!;
      storedJobs.get(firstId)!.state = state;
      await Promise.all([start(), start()]);
      expect(storedJobs.size).toBe(1);
      expect(storedJobs.get(firstId)?.state).toBe(state);
      const submittedIds: string[] = mockQueue.add.mock.calls.map(
        (call: [string, JSONObject, JobsOptions]) => {
          return call[2].jobId!;
        },
      );
      // Fresh custom IDs, but the stable deduplication key coalesces them.
      expect(new Set(submittedIds).size).toBe(3);
      expect(mockQueue.getJob).not.toHaveBeenCalled();
    },
  );

  it("registers only the schedule when runOnStartup is false", async () => {
    await start(false);
    expect(admission).toHaveBeenCalledTimes(1);
    expect(waitingIds()).toEqual([]);
  });

  it.each(["completed", "failed"] as const)(
    "enqueues startup work despite a retained %s legacy job ID",
    async (state: "completed" | "failed") => {
      const legacyId: string = "Maintenance-Reconcile";
      storedJobs.set(legacyId, { name: jobName, state, options: {} });
      await start();
      expect(waitingIds()).toHaveLength(1);
      expect(waitingIds()[0]).not.toBe(legacyId);
      expect(storedJobs.get(legacyId)?.state).toBe(state);
      const startup: StoredJob = storedJobs.get(waitingIds()[0]!)!;
      expect(startup.name).toBe(jobName);
      expect(startup.options.deduplication).toEqual({
        id: "startup-Maintenance-Reconcile",
        keepLastIfActive: false,
      });
      await JobDictionary.getJobFunction(startup.name)();
      expect(run).toHaveBeenCalledTimes(1);
      expect(admission).toHaveBeenCalledWith(
        QueueName.Worker,
        jobName,
        jobName,
        {},
        { scheduleAt: "0 * * * *" },
      );
    },
  );
});
