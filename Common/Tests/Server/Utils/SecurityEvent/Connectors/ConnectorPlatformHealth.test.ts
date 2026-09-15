import Queue from "../../../../../Server/Infrastructure/Queue";
import ConnectorPlatformHealth, {
  CONNECTOR_OVERDUE_GRACE_IN_MS,
  CONNECTOR_SCHEDULER_JOB_NAMES,
  ConnectorScheduleFacts,
  ConnectorSchedulerEntry,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/ConnectorPlatformHealth";
import {
  ConnectorPlatformStatus,
  SecurityConnectorCheck,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { JSONObject } from "../../../../../Types/JSON";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { createHash } from "crypto";
import type { Mock } from "jest-mock";

/*
 * The platform checks are the half of "Test connection" that looks at
 * OneUptime instead of the source. Their whole value is being right when
 * Redis or the workers are broken, so the probes are exercised with a
 * hand-built queue that can answer, be missing a method, or throw - and
 * every one of those must land as a value or a null, never as a rejected
 * test. The check text is pinned because the docs quote it.
 */

/*
 * One entry of BullMQ's getJobSchedulers() as BullMQ really returns it.
 * Deliberately has no `id`: the old fake handed back
 * { id: "SecurityEvents-PollSecurityEventConnections" }, a shape BullMQ
 * never produces, which is how a scheduler check that failed on every
 * healthy install passed here (review finding
 * scheduler-check-always-fails).
 */
interface FakeScheduler {
  key: string;
  name: string;
  next?: number | undefined;
  pattern?: string | undefined;
}

interface FakeQueue {
  getWorkersCount?: (() => Promise<number>) | undefined;
  getWorkers?: (() => Promise<Array<unknown>>) | undefined;
  getJobSchedulers?:
    | ((
        start?: number,
        end?: number,
        asc?: boolean,
      ) => Promise<Array<FakeScheduler | undefined>>)
    | undefined;
  getWaitingCount: () => Promise<number>;
  getFailedCount: () => Promise<number>;
}

const NOW: Date = new Date("2026-09-10T12:00:00.000Z");
const NEXT_TICK_MS: number = Date.parse("2026-09-10T12:01:00.000Z");
const GENERIC_POLL_JOB: string = "SecurityEvents:PollSecurityEventConnections";
const GOOGLE_POLL_JOB: string = "SecurityEvents:PollGoogleSecOpsConnections";
const EVERY_MINUTE: string = "* * * * *";

/*
 * The concatenated repeat key BullMQ 5.76.2 builds for
 * queue.add(name, data, { jobId, repeat: { pattern, jobId } }), which is
 * what RunCron -> Queue.addJob sends: getRepeatConcatOptions in
 * bullmq/dist/cjs/classes/repeat.js joins name, jobId, endDate, tz and
 * pattern with ":". Queue.addJob passes the job name with ":" replaced by
 * "-" as the jobId.
 */
function legacyRepeatKey(jobName: string): string {
  return `${jobName}:${jobName.replace(/:/g, "-")}:::${EVERY_MINUTE}`;
}

/*
 * What getJobSchedulers() returns for that registration. updateRepeatableJob
 * stores it under md5(legacyRepeatKey); addRepeatableJob-2.lua writes only
 * `name` and `pattern` into repeat:<md5>; JobScheduler.transformSchedulerData
 * turns that hash into { key, name, next, pattern }.
 */
function bullmqRepeatable(jobName: string, next?: number): FakeScheduler {
  return {
    key: createHash("md5").update(legacyRepeatKey(jobName)).digest("hex"),
    name: jobName,
    ...(next !== undefined ? { next } : {}),
    pattern: EVERY_MINUTE,
  };
}

/*
 * The two BullMQ internals that decide what getJobSchedulers() lists for a
 * RunCron registration: Repeat.updateRepeatableJob, which picks the stored
 * key and metadata, and JobScheduler.transformSchedulerData, which turns
 * that metadata back into a listing entry.
 */
interface BullmqRepeatInternals {
  getNextMillis: (millis: number, opts: JSONObject) => number | undefined;
  Repeat: {
    prototype: {
      hash: (value: string) => string;
      updateRepeatableJob: (
        name: string,
        data: JSONObject,
        opts: JSONObject,
        flags: { override: boolean },
      ) => Promise<unknown>;
    };
  };
  JobScheduler: {
    prototype: {
      transformSchedulerData: (
        key: string,
        jobData: Record<string, string>,
        next: number,
      ) => unknown;
    };
  };
}

/*
 * jest.requireActual returns unknown, so each module is checked for the
 * members this suite drives before they are used. A BullMQ upgrade that
 * moves or renames one then fails with a message naming it, not with
 * "cannot read properties of undefined" halfway through a test.
 */
function hasPrototypeMethods(value: unknown, methods: Array<string>): boolean {
  if (typeof value !== "function") {
    return false;
  }

  const prototype: unknown = value.prototype;

  return methods.every((method: string): boolean => {
    return (
      typeof prototype === "object" &&
      prototype !== null &&
      typeof Reflect.get(prototype, method) === "function"
    );
  });
}

function isBullmqRepeatModule(
  value: unknown,
): value is Pick<BullmqRepeatInternals, "getNextMillis" | "Repeat"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getNextMillis" in value &&
    typeof value.getNextMillis === "function" &&
    "Repeat" in value &&
    hasPrototypeMethods(value.Repeat, ["hash", "updateRepeatableJob"])
  );
}

function isBullmqJobSchedulerModule(
  value: unknown,
): value is Pick<BullmqRepeatInternals, "JobScheduler"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "JobScheduler" in value &&
    hasPrototypeMethods(value.JobScheduler, ["transformSchedulerData"])
  );
}

/*
 * Loaded from BullMQ's CommonJS build because the "bullmq" import is mapped
 * to a stub in this suite. This test environment resolves msgpackr, which
 * BullMQ's script runner instantiates at load time, to its ES module build
 * that Jest cannot parse; nothing exercised here packs anything, so a no-op
 * packer stands in for it.
 */
function loadBullmqRepeatInternals(): BullmqRepeatInternals {
  const loaded: Array<BullmqRepeatInternals> = [];

  jest.isolateModules((): void => {
    jest.doMock("msgpackr", (): Record<string, unknown> => {
      return {
        Packr: class {
          public pack(): Buffer {
            return Buffer.alloc(0);
          }
        },
      };
    });
    const repeat: unknown = jest.requireActual(
      "bullmq/dist/cjs/classes/repeat",
    );
    const jobScheduler: unknown = jest.requireActual(
      "bullmq/dist/cjs/classes/job-scheduler",
    );

    if (!isBullmqRepeatModule(repeat)) {
      throw new Error(
        "bullmq/dist/cjs/classes/repeat no longer exports getNextMillis and a Repeat class with hash and updateRepeatableJob.",
      );
    }

    if (!isBullmqJobSchedulerModule(jobScheduler)) {
      throw new Error(
        "bullmq/dist/cjs/classes/job-scheduler no longer exports a JobScheduler class with transformSchedulerData.",
      );
    }

    loaded.push({
      getNextMillis: repeat.getNextMillis,
      Repeat: repeat.Repeat,
      JobScheduler: jobScheduler.JobScheduler,
    });
  });

  if (!loaded[0]) {
    throw new Error("BullMQ's repeat internals did not load.");
  }

  return loaded[0];
}

function makeQueue(overrides: Partial<FakeQueue> = {}): FakeQueue {
  return {
    getWorkersCount: (): Promise<number> => {
      return Promise.resolve(2);
    },
    getJobSchedulers: (): Promise<Array<FakeScheduler | undefined>> => {
      return Promise.resolve([
        bullmqRepeatable("Unrelated:Job", NEXT_TICK_MS - 30_000),
        bullmqRepeatable(GENERIC_POLL_JOB, NEXT_TICK_MS),
      ]);
    },
    getWaitingCount: (): Promise<number> => {
      return Promise.resolve(3);
    },
    getFailedCount: (): Promise<number> => {
      return Promise.resolve(1);
    },
    ...overrides,
  };
}

function storageUp(): Promise<boolean> {
  return Promise.resolve(true);
}

function findCheck(
  checks: Array<SecurityConnectorCheck>,
  key: string,
): SecurityConnectorCheck {
  const check: SecurityConnectorCheck | undefined = checks.find(
    (candidate: SecurityConnectorCheck): boolean => {
      return candidate.key === key;
    },
  );

  expect(check).toBeDefined();

  return check!;
}

function healthyStatus(): ConnectorPlatformStatus {
  return {
    workerConsumers: 1,
    schedulerRegistered: true,
    schedulerNextRunAt: new Date(NEXT_TICK_MS).toISOString(),
    queueWaiting: 0,
    queueFailed: 0,
    storageReachable: true,
  };
}

function facts(
  overrides: Partial<ConnectorScheduleFacts> = {},
): ConnectorScheduleFacts {
  return {
    isEnabled: true,
    pollIntervalInMinutes: 5,
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ConnectorPlatformHealth.getPlatformStatus", () => {
  test("reads every probe off an answering queue and the storage probe", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue(),
        storageProbeOverride: storageUp,
      });

    expect(status).toEqual({
      workerConsumers: 2,
      schedulerRegistered: true,
      schedulerNextRunAt: new Date(NEXT_TICK_MS).toISOString(),
      queueWaiting: 3,
      queueFailed: 1,
      storageReachable: true,
    });
  });

  test("asks for the first thousand schedulers in ascending order", async () => {
    const getJobSchedulers: Mock<
      (
        start?: number,
        end?: number,
        asc?: boolean,
      ) => Promise<Array<FakeScheduler | undefined>>
    > = jest.fn(
      (
        _start?: number,
        _end?: number,
        _asc?: boolean,
      ): Promise<Array<FakeScheduler | undefined>> => {
        return Promise.resolve([]);
      },
    );

    await ConnectorPlatformHealth.getPlatformStatus({
      queueOverride: makeQueue({ getJobSchedulers }),
      storageProbeOverride: storageUp,
    });

    expect(getJobSchedulers).toHaveBeenCalledWith(0, 1000, true);
  });

  test("only the Security Event Connections poll cron counts as the scheduler, by its raw job name", () => {
    /*
     * The raw RunCron name, colon included: BullMQ reports `name` as passed
     * to queue.add, never the sanitized jobId. Google SecOps is polled by
     * this cron now; its retired cron name must not be listed.
     */
    expect(CONNECTOR_SCHEDULER_JOB_NAMES).toEqual([GENERIC_POLL_JOB]);
    expect(CONNECTOR_SCHEDULER_JOB_NAMES).not.toContain(GOOGLE_POLL_JOB);
  });

  test("the retired Google SecOps cron is not a connector scheduler, by name or by key", () => {
    expect(
      ConnectorPlatformHealth.isConnectorScheduler(
        bullmqRepeatable(GOOGLE_POLL_JOB, NEXT_TICK_MS),
      ),
    ).toBe(false);
    expect(
      ConnectorPlatformHealth.isConnectorScheduler({
        key: legacyRepeatKey(GOOGLE_POLL_JOB),
        name: "SecurityEvents",
      }),
    ).toBe(false);
    expect(
      ConnectorPlatformHealth.isConnectorScheduler(
        bullmqRepeatable(GENERIC_POLL_JOB),
      ),
    ).toBe(true);
  });

  test("a healthy registration, in the exact shape BullMQ returns, passes the scheduler check", async () => {
    const entry: FakeScheduler = bullmqRepeatable(
      GENERIC_POLL_JOB,
      NEXT_TICK_MS,
    );

    // Pin the shape itself, so a fake with an invented `id` cannot creep back.
    expect(entry).toEqual({
      key: expect.stringMatching(/^[0-9a-f]{32}$/),
      name: "SecurityEvents:PollSecurityEventConnections",
      next: NEXT_TICK_MS,
      pattern: "* * * * *",
    });
    expect(entry).not.toHaveProperty("id");

    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler | undefined>> => {
            return Promise.resolve([entry]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBe(true);
    expect(status.schedulerNextRunAt).toBe(
      new Date(NEXT_TICK_MS).toISOString(),
    );

    const check: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks(status),
      "scheduler",
    );

    expect(check.status).toBe("pass");
    expect(check.message).toBe(
      `Registered; next tick at ${new Date(NEXT_TICK_MS).toISOString()}.`,
    );
  });

  test("the fixture is what the installed BullMQ stores and lists for a RunCron registration", async () => {
    /*
     * Drives BullMQ's own code with the exact options Queue.addJob sends for
     * RunCron's scheduleAt, then lists the stored metadata back through
     * BullMQ's own transform. A BullMQ upgrade that changes the listing
     * shape fails here instead of silently failing the scheduler check.
     */
    const bullmq: BullmqRepeatInternals = loadBullmqRepeatInternals();
    const storedCalls: Array<{ key: string; opts: JSONObject }> = [];
    const repeatContext: Record<string, unknown> = {
      repeatStrategy: bullmq.getNextMillis,
      repeatKeyHashAlgorithm: "md5",
      hash: bullmq.Repeat.prototype.hash,
      scripts: {
        addRepeatableJob: (
          customKey: string,
          _nextMillis: number,
          opts: JSONObject,
        ): Promise<string> => {
          storedCalls.push({ key: customKey, opts });
          return Promise.resolve(customKey);
        },
      },
      createNextJob: (): Promise<undefined> => {
        return Promise.resolve(undefined);
      },
    };
    const jobId: string = GENERIC_POLL_JOB.replace(/:/g, "-");

    await bullmq.Repeat.prototype.updateRepeatableJob.call(
      repeatContext,
      GENERIC_POLL_JOB,
      {},
      { jobId, repeat: { pattern: EVERY_MINUTE, jobId } },
      { override: true },
    );

    expect(storedCalls).toHaveLength(1);

    /*
     * addRepeatableJob-2.lua: HMSET repeat:<key> with `name` plus only the
     * options that are set (msgpack turns the undefined ones into nil).
     */
    const metadata: Record<string, string> = {};

    for (const [field, value] of Object.entries(storedCalls[0]!.opts)) {
      if (value !== undefined && value !== null) {
        metadata[field] = String(value);
      }
    }

    const listed: unknown =
      bullmq.JobScheduler.prototype.transformSchedulerData.call(
        bullmq.JobScheduler.prototype,
        storedCalls[0]!.key,
        metadata,
        NEXT_TICK_MS,
      );

    expect(listed).toEqual(bullmqRepeatable(GENERIC_POLL_JOB, NEXT_TICK_MS));
    expect(listed).not.toHaveProperty("id");
    expect(
      ConnectorPlatformHealth.isConnectorScheduler(
        listed as ConnectorSchedulerEntry,
      ),
    ).toBe(true);
  });

  test("an entry that only carries the sanitized id is not a registration BullMQ can report", async () => {
    /*
     * The shape the old code matched on. BullMQ never fills `id` for a
     * RunCron registration, so accepting it would only make a fabricated
     * fixture pass again.
     */
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler | undefined>> => {
            return Promise.resolve([
              {
                id: "SecurityEvents-PollSecurityEventConnections",
                next: NEXT_TICK_MS,
              } as unknown as FakeScheduler,
            ]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBe(false);
  });

  test("a repeatable still kept under its concatenated key with no metadata hash is recognised by the key", async () => {
    /*
     * BullMQ rebuilds such an entry by splitting the key on ":", which
     * reports the name as "SecurityEvents" and the rest of the job name
     * as the id (JobScheduler.keyToData).
     */
    const key: string = legacyRepeatKey(GENERIC_POLL_JOB);
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler | undefined>> => {
            return Promise.resolve([
              {
                key,
                name: "SecurityEvents",
                id: "PollSecurityEventConnections",
                endDate: null,
                tz: null,
                pattern: `:${EVERY_MINUTE}`,
                next: NEXT_TICK_MS,
              } as unknown as FakeScheduler,
            ]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBe(true);
    expect(status.schedulerNextRunAt).toBe(
      new Date(NEXT_TICK_MS).toISOString(),
    );
  });

  test("an undefined entry (a repeat key whose metadata is gone) is skipped, not a probe failure", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler | undefined>> => {
            return Promise.resolve([
              undefined,
              bullmqRepeatable(GENERIC_POLL_JOB, NEXT_TICK_MS),
            ]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBe(true);
  });

  test("a job whose name only starts with a poll job name is not the poll scheduler", () => {
    const lookalike: ConnectorSchedulerEntry = bullmqRepeatable(
      `${GENERIC_POLL_JOB}Extra`,
    );

    expect(ConnectorPlatformHealth.isConnectorScheduler(lookalike)).toBe(false);
    expect(
      ConnectorPlatformHealth.isConnectorScheduler({
        key: legacyRepeatKey(`${GENERIC_POLL_JOB}Extra`),
        name: "SecurityEvents",
      }),
    ).toBe(false);
  });

  test("a leftover Google SecOps cron alone does not mark the scheduler registered", async () => {
    /*
     * The retired cron's repeatable can survive an upgrade in Redis. It
     * enqueues nothing any more, so on its own it must read as a missing
     * scheduler (a failed check), never as a healthy one.
     */
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler | undefined>> => {
            return Promise.resolve([
              bullmqRepeatable(GOOGLE_POLL_JOB, NEXT_TICK_MS),
              {
                key: legacyRepeatKey(GOOGLE_POLL_JOB),
                name: "SecurityEvents",
                next: NEXT_TICK_MS,
              },
            ]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBe(false);
    expect(status.schedulerNextRunAt).toBeUndefined();
    expect(
      findCheck(ConnectorPlatformHealth.toPlatformChecks(status), "scheduler")
        .status,
    ).toBe("fail");
  });

  test("a registered cron without a usable next tick invents no next-run timestamp", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler | undefined>> => {
            return Promise.resolve([bullmqRepeatable(GENERIC_POLL_JOB)]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBe(true);
    expect(status.schedulerNextRunAt).toBeUndefined();
  });

  test("reports the earliest next tick of the poll cron's registrations and ignores a leftover Google SecOps cron", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler | undefined>> => {
            return Promise.resolve([
              bullmqRepeatable(GENERIC_POLL_JOB, NEXT_TICK_MS + 5_000),
              {
                key: legacyRepeatKey(GENERIC_POLL_JOB),
                name: "SecurityEvents",
                next: NEXT_TICK_MS + 2_000,
              },
              // Earliest of all, but it enqueues nothing any more.
              bullmqRepeatable(GOOGLE_POLL_JOB, NEXT_TICK_MS),
            ]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBe(true);
    expect(status.schedulerNextRunAt).toBe(
      new Date(NEXT_TICK_MS + 2_000).toISOString(),
    );
  });

  test("no matching scheduler is a definite false, not an unknown", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler | undefined>> => {
            return Promise.resolve([
              bullmqRepeatable("Unrelated:Job", NEXT_TICK_MS),
            ]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBe(false);
    expect(status.schedulerNextRunAt).toBeUndefined();
  });

  test("falls back to getWorkers().length when getWorkersCount is not available", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getWorkersCount: undefined,
          getWorkers: (): Promise<Array<unknown>> => {
            return Promise.resolve([{}, {}, {}]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.workerConsumers).toBe(3);
  });

  test("a queue without any worker accessor leaves the consumer count unknown", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({ getWorkersCount: undefined }),
        storageProbeOverride: storageUp,
      });

    expect(status.workerConsumers).toBeNull();
  });

  test("a queue without getJobSchedulers leaves the scheduler unknown", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({ getJobSchedulers: undefined }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBeNull();
    expect(status.schedulerNextRunAt).toBeUndefined();
  });

  test("every queue probe that throws becomes null without disturbing the others", async () => {
    const boom: () => Promise<never> = (): Promise<never> => {
      return Promise.reject(
        new Error("redis://user:secret@redis:6379 refused"),
      );
    };

    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getWorkersCount: boom,
          getJobSchedulers: boom,
          getWaitingCount: boom,
          getFailedCount: boom,
        }),
        storageProbeOverride: storageUp,
      });

    expect(status).toEqual({
      workerConsumers: null,
      schedulerRegistered: null,
      queueWaiting: null,
      queueFailed: null,
      storageReachable: true,
    });
  });

  test("a single throwing probe does not take the answering ones with it", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getWaitingCount: (): Promise<number> => {
            return Promise.reject(new Error("timeout"));
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.queueWaiting).toBeNull();
    expect(status.workerConsumers).toBe(2);
    expect(status.schedulerRegistered).toBe(true);
    expect(status.queueFailed).toBe(1);
  });

  test("a storage probe that throws reads as unreachable, never as unknown or healthy", async () => {
    /*
     * The other probes answer "unknown" on a throw because the thing being
     * probed (Redis) is not the thing being reported on. Here the probe IS
     * the database that has to accept the imported rows, so an exception
     * from it is the failure itself.
     */
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue(),
        storageProbeOverride: (): Promise<boolean> => {
          return Promise.reject(new Error("ECONNREFUSED"));
        },
      });

    expect(status.storageReachable).toBe(false);
  });

  test("a storage probe answering false is reported as is", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue(),
        storageProbeOverride: (): Promise<boolean> => {
          return Promise.resolve(false);
        },
      });

    expect(status.storageReachable).toBe(false);
  });

  test("a Worker queue that cannot even be opened leaves every queue value unknown", async () => {
    getJestSpyOn(Queue, "getQueue").mockImplementation((): never => {
      throw new Error("Redis is not configured");
    });

    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        storageProbeOverride: storageUp,
      });

    expect(status).toEqual({
      workerConsumers: null,
      schedulerRegistered: null,
      queueWaiting: null,
      queueFailed: null,
      storageReachable: true,
    });
  });

  test("uses the Worker queue when no override is supplied", async () => {
    const getQueue: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Queue,
      "getQueue",
    ).mockReturnValue(makeQueue() as never);

    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        storageProbeOverride: storageUp,
      });

    expect(getQueue).toHaveBeenCalledWith("Worker");
    expect(status.workerConsumers).toBe(2);
  });
});

describe("ConnectorPlatformHealth.toPlatformChecks", () => {
  test("emits the three deployment checks in a stable order", () => {
    const checks: Array<SecurityConnectorCheck> =
      ConnectorPlatformHealth.toPlatformChecks(healthyStatus());

    expect(
      checks.map((check: SecurityConnectorCheck): string => {
        return check.key;
      }),
    ).toEqual(["worker-consumers", "scheduler", "storage"]);
    expect(
      checks.every((check: SecurityConnectorCheck): boolean => {
        return check.status === "pass";
      }),
    ).toBe(true);
  });

  test("zero worker consumers fails with the DISABLE_QUEUE_WORKERS / Helm remediation", () => {
    const check: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks({
        ...healthyStatus(),
        workerConsumers: 0,
      }),
      "worker-consumers",
    );

    expect(check.status).toBe("fail");
    expect(check.message).toContain("No process is consuming the Worker queue");
    expect(check.remediation).toContain("DISABLE_QUEUE_WORKERS=false");
    expect(check.remediation).toContain("worker.enabled: true");
    expect(check.details).toEqual({ workerConsumers: 0 });
  });

  test("an unknown worker count warns instead of failing or passing", () => {
    const check: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks({
        ...healthyStatus(),
        workerConsumers: null,
      }),
      "worker-consumers",
    );

    expect(check.status).toBe("warn");
    expect(check.message).toContain("Could not determine");
    expect(check.remediation).toContain("Redis");
  });

  test("a healthy worker count passes and carries the queue depths as details", () => {
    const check: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks({
        ...healthyStatus(),
        workerConsumers: 2,
        queueWaiting: 4,
        queueFailed: 7,
      }),
      "worker-consumers",
    );

    expect(check.status).toBe("pass");
    expect(check.message).toBe("2 processes consuming the Worker queue.");
    expect(check.details).toEqual({
      workerConsumers: 2,
      queueWaiting: 4,
      queueFailed: 7,
    });
    expect(check.remediation).toBeUndefined();
  });

  test("a single consumer is described in the singular and unknown depths are omitted", () => {
    const check: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks({
        ...healthyStatus(),
        workerConsumers: 1,
        queueWaiting: null,
        queueFailed: null,
      }),
      "worker-consumers",
    );

    expect(check.message).toBe("1 process consuming the Worker queue.");
    expect(check.details).toEqual({ workerConsumers: 1 });
  });

  test("a missing scheduler fails and blames the Workers feature set", () => {
    const check: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks({
        ...healthyStatus(),
        schedulerRegistered: false,
      }),
      "scheduler",
    );

    expect(check.status).toBe("fail");
    expect(check.message).toContain("poll scheduler is not registered");
    expect(check.remediation).toContain("Workers feature set");
  });

  test("an unknown scheduler warns", () => {
    const check: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks({
        ...healthyStatus(),
        schedulerRegistered: null,
      }),
      "scheduler",
    );

    expect(check.status).toBe("warn");
    expect(check.remediation).toContain("Redis");
  });

  test("a registered scheduler passes and shows its next tick when known", () => {
    const withNext: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks(healthyStatus()),
      "scheduler",
    );

    expect(withNext.status).toBe("pass");
    expect(withNext.message).toContain(new Date(NEXT_TICK_MS).toISOString());
    expect(withNext.details).toEqual({
      nextRunAt: new Date(NEXT_TICK_MS).toISOString(),
    });

    const withoutNext: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks({
        ...healthyStatus(),
        schedulerNextRunAt: undefined,
      }),
      "scheduler",
    );

    expect(withoutNext.status).toBe("pass");
    expect(withoutNext.message).toBe("Registered.");
    expect(withoutNext.details).toBeUndefined();
  });

  test("unreachable storage fails and points at the CLICKHOUSE_* settings", () => {
    const check: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks({
        ...healthyStatus(),
        storageReachable: false,
      }),
      "storage",
    );

    expect(check.status).toBe("fail");
    expect(check.message).toContain("did not answer");
    expect(check.remediation).toContain("CLICKHOUSE_");
  });

  test("an unprobed storage warns and reachable storage passes", () => {
    expect(
      findCheck(
        ConnectorPlatformHealth.toPlatformChecks({
          ...healthyStatus(),
          storageReachable: null,
        }),
        "storage",
      ).status,
    ).toBe("warn");

    const pass: SecurityConnectorCheck = findCheck(
      ConnectorPlatformHealth.toPlatformChecks(healthyStatus()),
      "storage",
    );

    expect(pass.status).toBe("pass");
    expect(pass.message).toBe("The analytics database answered.");
  });

  test("every check carries a non-negative duration and a message", () => {
    for (const check of ConnectorPlatformHealth.toPlatformChecks({
      workerConsumers: null,
      schedulerRegistered: null,
      queueWaiting: null,
      queueFailed: null,
      storageReachable: null,
    })) {
      expect(check.durationMs).toBeGreaterThanOrEqual(0);
      expect(check.message.trim()).not.toBe("");
      expect(check.name.trim()).not.toBe("");
    }
  });
});

describe("ConnectorPlatformHealth.toScheduleCheck", () => {
  test("the grace period is two scheduler ticks", () => {
    expect(CONNECTOR_OVERDUE_GRACE_IN_MS).toBe(2 * 60 * 1000);
  });

  test("a disabled connection warns and says on-demand runs still work", () => {
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({ isEnabled: false, lastError: "ignored while disabled" }),
        NOW,
      );

    expect(check.key).toBe("connection-schedule");
    expect(check.status).toBe("warn");
    expect(check.message).toContain("disabled");
    expect(check.remediation).toContain("On-demand runs");
  });

  test("never polled and created moments ago passes as 'not polled yet'", () => {
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({ createdAt: new Date(NOW.getTime() - 60_000) }),
        NOW,
      );

    expect(check.status).toBe("pass");
    expect(check.message).toContain("Not polled yet");
  });

  test("never polled with no creation timestamp is treated as fresh", () => {
    expect(ConnectorPlatformHealth.toScheduleCheck(facts(), NOW).status).toBe(
      "pass",
    );
  });

  test("never polled and older than the grace period fails with the age in minutes", () => {
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({ createdAt: new Date(NOW.getTime() - 45 * 60_000) }),
        NOW,
      );

    expect(check.status).toBe("fail");
    expect(check.message).toContain("created 45 minutes ago");
    expect(check.message).toContain("never been polled");
    expect(check.remediation).toContain("Run now");
  });

  test("exactly at the grace boundary is still fresh", () => {
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({
          createdAt: new Date(NOW.getTime() - CONNECTOR_OVERDUE_GRACE_IN_MS),
        }),
        NOW,
      );

    expect(check.status).toBe("pass");
  });

  test("a poll later than interval plus grace is overdue", () => {
    const lastPolledAt: Date = new Date(NOW.getTime() - 8 * 60_000);
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({ pollIntervalInMinutes: 5, lastPolledAt }),
        NOW,
      );

    expect(check.status).toBe("fail");
    expect(check.message).toContain(lastPolledAt.toISOString());
    expect(check.message).toContain("5 minute interval");
    expect(check.remediation).toContain("Background workers");
    expect(check.details).toEqual({
      lastPolledAt: lastPolledAt.toISOString(),
      intervalMinutes: 5,
    });
  });

  test("a poll inside interval plus grace is not overdue", () => {
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({
          pollIntervalInMinutes: 5,
          lastPolledAt: new Date(NOW.getTime() - 6 * 60_000),
        }),
        NOW,
      );

    expect(check.status).toBe("pass");
  });

  test("a zero interval is read as the five minute default", () => {
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({
          pollIntervalInMinutes: 0,
          lastPolledAt: new Date(NOW.getTime() - 6 * 60_000),
        }),
        NOW,
      );

    expect(check.status).toBe("pass");
  });

  test("a queued run older than the grace period fails and names the stale run", () => {
    const pendingRunCreatedAt: Date = new Date(NOW.getTime() - 3 * 60_000);
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({
          lastPolledAt: new Date(NOW.getTime() - 60_000),
          pendingRunCreatedAt,
        }),
        NOW,
      );

    expect(check.status).toBe("fail");
    expect(check.message).toContain(pendingRunCreatedAt.toISOString());
    expect(check.message).toContain("no worker has picked it up");
    expect(check.remediation).toContain("Background workers");
  });

  test("a recently queued run is not a problem", () => {
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({
          lastPolledAt: new Date(NOW.getTime() - 60_000),
          pendingRunCreatedAt: new Date(NOW.getTime() - 30_000),
        }),
        NOW,
      );

    expect(check.status).toBe("pass");
  });

  test("a stuck queued run outranks a recorded error, because it explains it", () => {
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({
          lastPolledAt: new Date(NOW.getTime() - 60_000),
          lastError: "Okta token exchange failed (HTTP 401)",
          pendingRunCreatedAt: new Date(NOW.getTime() - 10 * 60_000),
        }),
        NOW,
      );

    expect(check.status).toBe("fail");
    expect(check.message).toContain("queued since");
  });

  test("a recent poll that failed surfaces lastError verbatim", () => {
    const lastPolledAt: Date = new Date(NOW.getTime() - 60_000);
    const lastSuccessfulPollAt: Date = new Date(NOW.getTime() - 11 * 60_000);
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({
          lastPolledAt,
          lastSuccessfulPollAt,
          lastError: "Splunk search failed (HTTP 403): insufficient permission",
        }),
        NOW,
      );

    expect(check.status).toBe("fail");
    expect(check.message).toBe(
      "The last poll attempt failed: Splunk search failed (HTTP 403): insufficient permission",
    );
    expect(check.remediation).toContain("error prefix");
    expect(check.details).toEqual({
      lastPolledAt: lastPolledAt.toISOString(),
      lastSuccessfulPollAt: lastSuccessfulPollAt.toISOString(),
    });
  });

  test("healthy with an ingested event names both timestamps", () => {
    const lastPolledAt: Date = new Date(NOW.getTime() - 60_000);
    const lastSuccessfulPollAt: Date = lastPolledAt;
    const lastEventIngestedAt: Date = new Date(NOW.getTime() - 4 * 60_000);
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({ lastPolledAt, lastSuccessfulPollAt, lastEventIngestedAt }),
        NOW,
      );

    expect(check.status).toBe("pass");
    expect(check.message).toContain(`last poll ${lastPolledAt.toISOString()}`);
    expect(check.message).toContain(
      `last event imported ${lastEventIngestedAt.toISOString()}`,
    );
    expect(check.details).toEqual({
      lastPolledAt: lastPolledAt.toISOString(),
      lastSuccessfulPollAt: lastSuccessfulPollAt.toISOString(),
      lastEventIngestedAt: lastEventIngestedAt.toISOString(),
    });
    expect(check.remediation).toBeUndefined();
  });

  test("healthy without any ingested event says so is expected", () => {
    const lastPolledAt: Date = new Date(NOW.getTime() - 60_000);
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(facts({ lastPolledAt }), NOW);

    expect(check.status).toBe("pass");
    expect(check.message).toContain("No event has been imported yet");
    expect(check.details).toEqual({ lastPolledAt: lastPolledAt.toISOString() });
  });

  test("defaults `now` to the current clock", () => {
    const check: SecurityConnectorCheck =
      ConnectorPlatformHealth.toScheduleCheck(
        facts({ lastPolledAt: new Date(Date.now() - 30_000) }),
      );

    expect(check.status).toBe("pass");
  });
});
