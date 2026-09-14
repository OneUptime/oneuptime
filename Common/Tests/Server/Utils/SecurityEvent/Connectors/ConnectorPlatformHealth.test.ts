import Queue from "../../../../../Server/Infrastructure/Queue";
import ConnectorPlatformHealth, {
  CONNECTOR_OVERDUE_GRACE_IN_MS,
  CONNECTOR_SCHEDULER_JOB_IDS,
  ConnectorScheduleFacts,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/ConnectorPlatformHealth";
import {
  ConnectorPlatformStatus,
  SecurityConnectorCheck,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The platform checks are the half of "Test connection" that looks at
 * OneUptime instead of the source. Their whole value is being right when
 * Redis or the workers are broken, so the probes are exercised with a
 * hand-built queue that can answer, be missing a method, or throw - and
 * every one of those must land as a value or a null, never as a rejected
 * test. The check text is pinned because the docs quote it.
 */

interface FakeScheduler {
  id?: string | undefined;
  next?: number | undefined;
}

interface FakeQueue {
  getWorkersCount?: (() => Promise<number>) | undefined;
  getWorkers?: (() => Promise<Array<unknown>>) | undefined;
  getJobSchedulers?:
    | ((
        start?: number,
        end?: number,
        asc?: boolean,
      ) => Promise<Array<FakeScheduler>>)
    | undefined;
  getWaitingCount: () => Promise<number>;
  getFailedCount: () => Promise<number>;
}

const NOW: Date = new Date("2026-09-10T12:00:00.000Z");
const NEXT_TICK_MS: number = Date.parse("2026-09-10T12:01:00.000Z");

function makeQueue(overrides: Partial<FakeQueue> = {}): FakeQueue {
  return {
    getWorkersCount: (): Promise<number> => {
      return Promise.resolve(2);
    },
    getJobSchedulers: (): Promise<Array<FakeScheduler>> => {
      return Promise.resolve([
        { id: "Unrelated-Job", next: NEXT_TICK_MS - 30_000 },
        {
          id: "SecurityEvents-PollSecurityEventConnections",
          next: NEXT_TICK_MS,
        },
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
    const getJobSchedulers: jest.Mock<
      (
        start?: number,
        end?: number,
        asc?: boolean,
      ) => Promise<Array<FakeScheduler>>
    > = jest.fn(
      (
        _start?: number,
        _end?: number,
        _asc?: boolean,
      ): Promise<Array<FakeScheduler>> => {
        return Promise.resolve([]);
      },
    );

    await ConnectorPlatformHealth.getPlatformStatus({
      queueOverride: makeQueue({ getJobSchedulers }),
      storageProbeOverride: storageUp,
    });

    expect(getJobSchedulers).toHaveBeenCalledWith(0, 1000, true);
  });

  test("either connector family's scheduler counts as registered", () => {
    expect(CONNECTOR_SCHEDULER_JOB_IDS).toEqual([
      "SecurityEvents-PollGoogleSecOpsConnections",
      "SecurityEvents-PollSecurityEventConnections",
    ]);
  });

  test("the Google scheduler alone marks the scheduler registered", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler>> => {
            return Promise.resolve([
              { id: "SecurityEvents-PollGoogleSecOpsConnections" },
            ]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerRegistered).toBe(true);
    // No usable `next` on the entry, so no next-run timestamp is invented.
    expect(status.schedulerNextRunAt).toBeUndefined();
  });

  test("reports the earliest next tick when both schedulers are registered", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler>> => {
            return Promise.resolve([
              {
                id: "SecurityEvents-PollSecurityEventConnections",
                next: NEXT_TICK_MS + 5_000,
              },
              {
                id: "SecurityEvents-PollGoogleSecOpsConnections",
                next: NEXT_TICK_MS,
              },
            ]);
          },
        }),
        storageProbeOverride: storageUp,
      });

    expect(status.schedulerNextRunAt).toBe(
      new Date(NEXT_TICK_MS).toISOString(),
    );
  });

  test("no matching scheduler is a definite false, not an unknown", async () => {
    const status: ConnectorPlatformStatus =
      await ConnectorPlatformHealth.getPlatformStatus({
        queueOverride: makeQueue({
          getJobSchedulers: (): Promise<Array<FakeScheduler>> => {
            return Promise.resolve([
              { id: "Unrelated-Job", next: NEXT_TICK_MS },
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
