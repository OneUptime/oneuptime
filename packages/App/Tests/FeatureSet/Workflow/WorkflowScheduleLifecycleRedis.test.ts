/*
 * Real Valkey + real BullMQ (see IncomingRequestCoalescingRedis.test.ts for
 * the local setup). The Workflow queue is renamed so parallel Jest workers
 * sharing one Valkey cannot touch each other's jobs. Only the database is
 * faked: an in-memory "workflow table" behind WorkflowService.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  const actual: {
    default: unknown;
    QueueName: Record<string, string>;
  } = jest.requireActual("Common/Server/Infrastructure/Queue");
  actual.QueueName["Workflow"] =
    `WorkflowScheduleLifecycleTest-${process.pid}-${Date.now()}`;
  return {
    __esModule: true,
    default: actual.default,
    QueueName: actual.QueueName,
  };
});

import ObjectID from "Common/Types/ObjectID";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import Components from "Common/Server/Types/Workflow/Components/Index";
import TriggerCode from "Common/Server/Types/Workflow/TriggerCode";

type Row = Record<string, any>;
const table: Map<string, Row> = new Map();

jest.mock("Common/Server/Services/WorkflowService", () => {
  const pick: (row: Row | undefined) => Row | null = (row?: Row) => {
    return row ? { ...row, id: new ObjectID(row["_id"]) } : null;
  };
  const service: Record<string, unknown> = {
    findOneById: async (a: { id: ObjectID }) => {
      return pick(table.get(a.id.toString()));
    },
    findOneBy: async (a: { query: Row }) => {
      const row: Row | undefined = table.get(a.query["_id"]);
      return row && row["triggerId"] === a.query["triggerId"]
        ? pick(row)
        : null;
    },
    findBy: async () => {
      return [...table.values()].map((r: Row) => {
        return pick(r);
      });
    },
    updateOneById: async (a: { id: ObjectID; data: Row }) => {
      const row: Row | undefined = table.get(a.id.toString());
      if (row) {
        Object.assign(row, a.data);
      }
    },
  };
  return { __esModule: true, default: service };
});
jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      },
    },
  };
});
jest.mock("Common/Server/Services/WorkflowLogService", () => {
  return {
    __esModule: true,
    default: {
      create: async () => {
        return { _id: new ObjectID("11111111-1111-4111-8111-111111111111") };
      },
      countBy: async () => {
        return {
          toNumber: () => {
            return 0;
          },
        };
      },
    },
  };
});
jest.mock("Common/Server/Services/WorkflowVariableService", () => {
  return {
    __esModule: true,
    default: {
      findBy: async () => {
        return [];
      },
    },
  };
});

const sent: Array<unknown> = [];
jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: (_q: unknown, _r: unknown, o: unknown) => {
        sent.push(o);
      },
      sendErrorResponse: (_q: unknown, _r: unknown, e: unknown) => {
        sent.push(e);
      },
    },
  };
});

import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import WorkflowAPI from "../../../FeatureSet/Workflow/API/Workflow";

const EVERY_SECOND: string = "* * * * * *";
const sleep: (ms: number) => Promise<void> = (ms: number) => {
  return new Promise((r: () => void) => {
    setTimeout(r, ms);
  });
};

const repeatableNames: () => Promise<Array<string>> = async () => {
  return (await Queue.getQueue(QueueName.Workflow).getRepeatableJobs()).map(
    (j: { name: string }) => {
      return j.name;
    },
  );
};

const delayedFor: (id: string) => Promise<number> = async (id: string) => {
  const jobs: Array<{ name: string }> = await Queue.getQueue(
    QueueName.Workflow,
  ).getDelayed();
  return jobs.filter((j: { name: string }) => {
    return j.name === id;
  }).length;
};

const addRow: (id: string, over?: Row) => Row = (id: string, over?: Row) => {
  const row: Row = {
    _id: id,
    projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    isEnabled: true,
    isArchived: false,
    triggerId: ComponentID.Schedule,
    triggerArguments: { schedule: EVERY_SECOND },
    ...over,
  };
  table.set(id, row);
  return row;
};

// What the database service does after a save or a delete.
const notify: (id: string) => Promise<void> = async (id: string) => {
  await new WorkflowAPI().updateWorkflow(
    { params: { workflowId: id } } as any,
    {} as any,
  );
};

const id1: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id2: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("Workflow schedule lifecycle (real Valkey)", () => {
  const runs: Record<string, number> = {};

  beforeAll(async () => {
    const trigger: TriggerCode = Components[
      ComponentID.Schedule
    ] as TriggerCode;
    trigger.scheduleWorkflow = QueueWorkflow.addWorkflowToQueue;
    trigger.removeWorkflow = QueueWorkflow.removeWorkflow;

    QueueWorker.getWorker(
      QueueName.Workflow,
      async (job: { name: string }) => {
        runs[job.name] = (runs[job.name] || 0) + 1;
      },
      { concurrency: 5 },
    );
    await Queue.getQueue(QueueName.Workflow).obliterate({ force: true });
  });

  beforeEach(async () => {
    table.clear();
    sent.length = 0;
    for (const k of Object.keys(runs)) {
      delete runs[k];
    }
    await Queue.getQueue(QueueName.Workflow).obliterate({ force: true });
  });

  afterAll(async () => {
    await Queue.getQueue(QueueName.Workflow).obliterate({ force: true });
  });

  test("A: schedule -> manual removes the repeatable; no run after the next boundary", async () => {
    addRow(id1);
    await notify(id1);
    expect(await repeatableNames()).toContain(id1);

    table.get(id1)!["triggerId"] = ComponentID.Manual;
    table.get(id1)!["triggerArguments"] = {};
    await notify(id1);

    expect(await repeatableNames()).not.toContain(id1);
    expect(await delayedFor(id1)).toBe(0);
    await sleep(500);
    delete runs[id1];
    await sleep(2500);
    expect(runs[id1]).toBeUndefined();
  });

  test("C: deleting a scheduled workflow removes repeatable and next delayed job", async () => {
    addRow(id1);
    await notify(id1);
    expect(await repeatableNames()).toContain(id1);

    table.delete(id1); // the hard delete, then onDeleteSuccess -> notify
    await notify(id1);

    expect(table.has(id1)).toBe(false);
    expect(await repeatableNames()).not.toContain(id1);
    expect(await delayedFor(id1)).toBe(0);
    expect(sent[sent.length - 1]).toEqual({ status: "Workflow not found" });
    await sleep(2500);
    expect(runs[id1]).toBeUndefined();
  });

  test("D: startup sweep removes orphans, keeps valid and unrelated repeatables", async () => {
    addRow(id1); // valid
    await notify(id1);

    // orphan from an older version: repeatable whose workflow is gone
    await Queue.addJob(
      QueueName.Workflow,
      id2,
      id2,
      { workflowId: id2 },
      { scheduleAt: EVERY_SECOND },
    );
    // unrelated, non-workflow-id repeatable
    await Queue.addJob(
      QueueName.Workflow,
      "unrelated-housekeeping",
      "unrelated-housekeeping",
      {},
      { scheduleAt: EVERY_SECOND },
    );
    // a one-off delayed job for the orphan must survive
    await Queue.getQueue(QueueName.Workflow).add(
      id2,
      { workflowId: id2 },
      { delay: 60000 },
    );

    const before: Array<string> = await repeatableNames();
    expect(before).toEqual(
      expect.arrayContaining([id1, id2, "unrelated-housekeeping"]),
    );

    const removed: number = await QueueWorkflow.reconcileAllSchedules();
    expect(removed).toBe(1);

    const after: Array<string> = await repeatableNames();
    expect(after).toContain(id1);
    expect(after).toContain("unrelated-housekeeping");
    expect(after).not.toContain(id2);

    // the orphan's one-off delayed job (Sleep/resume style) is not a schedule
    expect(await delayedFor(id2)).toBeGreaterThanOrEqual(1);
  });

  test("F: a workflow changed to Manual while its schedule is being registered ends with no repeatable and no stored key", async () => {
    addRow(id1);
    const realAddJob: typeof Queue.addJob = Queue.addJob.bind(Queue);
    const spy: jest.SpyInstance = jest
      .spyOn(Queue, "addJob")
      .mockImplementationOnce(
        async (...args: Parameters<typeof Queue.addJob>) => {
          const job: Awaited<ReturnType<typeof Queue.addJob>> =
            await realAddJob(...args);
          // the save lands after the queue add, before the final check
          table.get(id1)!["triggerId"] = ComponentID.Manual;
          table.get(id1)!["triggerArguments"] = {};
          return job;
        },
      );

    await QueueWorkflow.addWorkflowToQueue(
      { workflowId: new ObjectID(id1), returnValues: {}, callChain: [] } as any,
      EVERY_SECOND,
    );
    spy.mockRestore();

    expect(await repeatableNames()).not.toContain(id1);
    expect(table.get(id1)!["repeatableJobKey"] ?? null).toBeNull();
  });

  test("G: a registration of an old cron is not current once the workflow has another", async () => {
    addRow(id1);
    const id: ObjectID = new ObjectID(id1);
    expect(await QueueWorkflow.isScheduleCurrent(id, EVERY_SECOND)).toBe(true);

    table.get(id1)!["triggerArguments"] = { schedule: "*/5 * * * * *" };
    expect(await QueueWorkflow.isScheduleCurrent(id, EVERY_SECOND)).toBe(false);
    expect(await QueueWorkflow.isScheduleCurrent(id, "*/5 * * * * *")).toBe(
      true,
    );
    expect(await QueueWorkflow.isScheduleCurrent(id)).toBe(true);
  });

  /*
   * Kill the connection server-side; ioredis reconnects and the Queue's
   * "ready" handler replays its registry (through the guard).
   */
  const reconnect: () => Promise<void> = async () => {
    const client: any = await Queue.getQueue(QueueName.Workflow).client;
    const ready: Promise<void> = new Promise((r: () => void) => {
      client.once("ready", r);
    });
    client.disconnect(true);
    await ready;
    await sleep(500);
  };

  const guardWithDatabase: () => void = () => {
    Queue.setReconnectGuard(
      QueueName.Workflow,
      async (name: string, cron?: string) => {
        return await QueueWorkflow.isScheduleCurrent(new ObjectID(name), cron);
      },
    );
  };

  test("H: a schedule removed by a delete is not resurrected on reconnect", async () => {
    guardWithDatabase();
    addRow(id1);
    await notify(id1);
    table.delete(id1);
    await notify(id1);
    await reconnect();
    expect(await repeatableNames()).not.toContain(id1);
  });

  test("I: a registry entry for a schedule another pod removed is not re-added", async () => {
    guardWithDatabase();
    addRow(id1);
    await notify(id1);
    /*
     * another pod: persisted state changes and the repeatable goes, this
     * process's registry still holds it
     */
    table.get(id1)!["triggerId"] = ComponentID.Manual;
    const q: any = Queue.getQueue(QueueName.Workflow);
    for (const r of await q.getRepeatableJobs()) {
      await q.removeRepeatableByKey(r.key);
    }
    await reconnect();
    expect(await repeatableNames()).not.toContain(id1);
  });

  test("J: a stale cron is not restored when the workflow now has another", async () => {
    guardWithDatabase();
    addRow(id1);
    await notify(id1); // this process registers EVERY_SECOND
    table.get(id1)!["triggerArguments"] = { schedule: "0 0 1 1 *" };
    const q: any = Queue.getQueue(QueueName.Workflow);
    for (const r of await q.getRepeatableJobs()) {
      await q.removeRepeatableByKey(r.key);
    }
    // another pod registered the new cron
    await q.add(id1, {}, { repeat: { pattern: "0 0 1 1 *", jobId: id1 } });
    await reconnect();
    const patterns: Array<string | null> = (await q.getRepeatableJobs())
      .filter((r: any) => {
        return r.name === id1;
      })
      .map((r: any) => {
        return r.pattern;
      });
    expect(patterns).toEqual(["0 0 1 1 *"]);
  });

  test("K: a schedule that is still wanted is re-added after Valkey lost it", async () => {
    guardWithDatabase();
    addRow(id1);
    await notify(id1);
    const q: any = Queue.getQueue(QueueName.Workflow);
    for (const r of await q.getRepeatableJobs()) {
      await q.removeRepeatableByKey(r.key);
    }
    await reconnect();
    expect(await repeatableNames()).toContain(id1);
  });
});
