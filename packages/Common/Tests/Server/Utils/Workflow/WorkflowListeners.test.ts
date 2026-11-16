import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A WRITE POSTS ITS WORKFLOW TRIGGER ONLY WHEN A WORKFLOW OF ITS PROJECT
 * LISTENS - AND A WORKFLOW NEVER MISSES ONE IT LISTENS FOR (issue #8861).
 *
 * WorkflowListeners keeps, in Redis, the triggers each project's enabled
 * workflows that are not archived listen to, under a generation of the
 * project that every create, update and delete of a workflow moves on.
 * Pinned here against Redis held in memory (with the generation, the
 * triggers kept and their lifetimes) and the database's answer held in a
 * variable: what a write is told, when the database is read, what a change
 * does, and that whenever it cannot tell, the trigger is posted.
 */

// Redis, as GlobalCache reads and writes it: values and their lifetimes.
const mockRedis: {
  connected: boolean;
  values: Map<string, string>;
  ttls: Map<string, number>;
  failReads: boolean;
  failWrites: boolean;
} = {
  connected: true,
  values: new Map<string, string>(),
  ttls: new Map<string, number>(),
  failReads: false,
  failWrites: false,
};

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedis.connected ? {} : null;
      },
      isConnected: (): boolean => {
        return mockRedis.connected;
      },
    },
  };
});

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  const key: (namespace: string, name: string) => string = (
    namespace: string,
    name: string,
  ): string => {
    return `${namespace}-${name}`;
  };

  return {
    __esModule: true,
    default: {
      getStrings: jest.fn(async (namespace: string, names: Array<string>) => {
        if (mockRedis.failReads) {
          throw new Error("ECONNRESET");
        }

        return names.map((name: string): string | null => {
          return mockRedis.values.get(key(namespace, name)) ?? null;
        });
      }),
      getString: jest.fn(async (namespace: string, name: string) => {
        if (mockRedis.failReads) {
          throw new Error("ECONNRESET");
        }

        return mockRedis.values.get(key(namespace, name)) ?? null;
      }),
      setString: jest.fn(
        async (
          namespace: string,
          name: string,
          value: string,
          options?: { expiresInSeconds: number },
        ) => {
          if (mockRedis.failWrites) {
            throw new Error("READONLY");
          }

          mockRedis.values.set(key(namespace, name), value);
          mockRedis.ttls.set(key(namespace, name), options!.expiresInSeconds);
        },
      ),
      setStringIfNotExists: jest.fn(
        async (
          namespace: string,
          name: string,
          value: string,
          options?: { expiresInSeconds: number },
        ) => {
          if (mockRedis.failWrites) {
            throw new Error("READONLY");
          }

          if (mockRedis.values.has(key(namespace, name))) {
            return false;
          }

          mockRedis.values.set(key(namespace, name), value);
          mockRedis.ttls.set(key(namespace, name), options!.expiresInSeconds);
          return true;
        },
      ),
    },
  };
});

// The database: the triggers of each project's listening workflows.
const mockDatabase: {
  triggers: Map<string, Array<string>>;
  queries: Array<{ sql: string; params: Array<unknown> }>;
  fail: boolean;
  // A read that waits until it is let go: one under way while a change is made.
  hold: Promise<void> | null;
} = {
  triggers: new Map<string, Array<string>>(),
  queries: [],
  fail: false,
  hold: null,
};

jest.mock("../../../../Server/Infrastructure/PostgresDatabase", () => {
  return {
    __esModule: true,
    default: {
      isConnected: (): boolean => {
        return true;
      },
      getDataSource: (): unknown => {
        return {
          query: async (
            sql: string,
            params: Array<unknown>,
          ): Promise<Array<{ triggerId: string }>> => {
            mockDatabase.queries.push({ sql, params });

            // What the read finds is what the workflows were as it began.
            const found: Array<string> = [
              ...(mockDatabase.triggers.get(String(params[0])) || []),
            ];

            if (mockDatabase.hold) {
              await mockDatabase.hold;
            }

            if (mockDatabase.fail) {
              throw new Error("connection terminated");
            }

            return found.map((triggerId: string) => {
              return { triggerId };
            });
          },
        };
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import WorkflowListeners, {
  WORKFLOW_LISTENER_TRIGGERS_SQL,
} from "../../../../Server/Utils/Workflow/WorkflowListeners";
import logger from "../../../../Server/Utils/Logger";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";

const PROJECT: ObjectID = new ObjectID("6ba7b810-9dad-41d1-80b4-00c04fd4b0a1");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "6ba7b810-9dad-41d1-80b4-00c04fd4b0a2",
);

const ON_CREATE: Array<string> = WorkflowListeners.triggerIdsOf({
  tableName: "Incident",
  triggerType: "on-create",
  enableWorkflowOn: { create: true, update: true, delete: true },
});
const ON_UPDATE: Array<string> = WorkflowListeners.triggerIdsOf({
  tableName: "Incident",
  triggerType: "on-update",
  enableWorkflowOn: { create: true, update: true, delete: true },
});
const ON_DELETE: Array<string> = WorkflowListeners.triggerIdsOf({
  tableName: "Incident",
  triggerType: "on-delete",
  enableWorkflowOn: { create: true, update: true, delete: true },
});

function listenTo(project: ObjectID, triggerIds: Array<string>): void {
  mockDatabase.triggers.set(project.toString(), triggerIds);
}

function isListening(
  triggerIds: Array<string>,
  project: ObjectID = PROJECT,
): Promise<boolean> {
  return WorkflowListeners.isAnyListening({
    projectId: project,
    triggerIds: triggerIds,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  WorkflowListeners.clear();
  mockRedis.connected = true;
  mockRedis.values = new Map<string, string>();
  mockRedis.ttls = new Map<string, number>();
  mockRedis.failReads = false;
  mockRedis.failWrites = false;
  mockDatabase.triggers = new Map<string, Array<string>>();
  mockDatabase.queries = [];
  mockDatabase.fail = false;
  mockDatabase.hold = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the triggers a write posts for", () => {
  test("a create: the model's On Create, and its On Create or Update", () => {
    expect(ON_CREATE).toEqual([
      "incident-on-create",
      "incident-on-create-or-update",
    ]);
  });

  test("an update: the model's On Update, and its On Create or Update", () => {
    expect(ON_UPDATE).toEqual([
      "incident-on-update",
      "incident-on-create-or-update",
    ]);
  });

  test("a delete: the model's On Delete alone", () => {
    expect(ON_DELETE).toEqual(["incident-on-delete"]);
  });

  test("a model with no On Create or Update - no update trigger - has its own alone", () => {
    expect(
      WorkflowListeners.triggerIdsOf({
        tableName: "IncidentStateTimeline",
        triggerType: "on-create",
        enableWorkflowOn: { create: true, delete: true },
      }),
    ).toEqual(["incident-state-timeline-on-create"]);
  });
});

describe("whether a workflow listens", () => {
  test("no workflow of the project listens: the write posts nothing", async () => {
    listenTo(PROJECT, []);

    expect(await isListening(ON_CREATE)).toBe(false);
    expect(await isListening(ON_UPDATE)).toBe(false);
    expect(await isListening(ON_DELETE)).toBe(false);
  });

  test("a workflow listens to the model's own trigger: that write posts, the others do not", async () => {
    listenTo(PROJECT, ["incident-on-update"]);

    expect(await isListening(ON_UPDATE)).toBe(true);
    expect(await isListening(ON_CREATE)).toBe(false);
    expect(await isListening(ON_DELETE)).toBe(false);
  });

  test("On Create or Update is heard by creates and updates, not deletes", async () => {
    listenTo(PROJECT, ["incident-on-create-or-update"]);

    expect(await isListening(ON_CREATE)).toBe(true);
    expect(await isListening(ON_UPDATE)).toBe(true);
    expect(await isListening(ON_DELETE)).toBe(false);
  });

  test("a workflow of another project is not this project's", async () => {
    listenTo(OTHER_PROJECT, ["incident-on-create"]);

    expect(await isListening(ON_CREATE)).toBe(false);
    expect(await isListening(ON_CREATE, OTHER_PROJECT)).toBe(true);
  });

  test("the database is read with the query the workflow service's handler reads by: enabled, not archived, not deleted, of the project", async () => {
    listenTo(PROJECT, []);

    await isListening(ON_CREATE);

    expect(mockDatabase.queries).toEqual([
      {
        sql: WORKFLOW_LISTENER_TRIGGERS_SQL,
        params: [PROJECT.toString(), LIMIT_MAX + 1],
      },
    ]);
    expect(WORKFLOW_LISTENER_TRIGGERS_SQL).toContain('"isEnabled" = true');
    expect(WORKFLOW_LISTENER_TRIGGERS_SQL).toContain('"isArchived" = false');
    expect(WORKFLOW_LISTENER_TRIGGERS_SQL).toContain('"deletedAt" IS NULL');
    expect(WORKFLOW_LISTENER_TRIGGERS_SQL).toContain('"projectId" = $1');
  });

  test("the database is read once, then the writes are told from Redis", async () => {
    listenTo(PROJECT, ["incident-on-update"]);

    for (let write: number = 0; write < 50; write++) {
      await isListening(write % 2 === 0 ? ON_UPDATE : ON_CREATE);
    }

    expect(mockDatabase.queries).toHaveLength(1);
  });

  test("what is kept lasts a minute at most: a change Redis did not hear is heard within it", async () => {
    listenTo(PROJECT, []);

    await isListening(ON_CREATE);

    const triggersKey: string = `${WorkflowListeners.NAMESPACE}-triggers:${PROJECT.toString().toLowerCase()}`;

    expect(mockRedis.ttls.get(triggersKey)).toBe(
      WorkflowListeners.TRIGGERS_TTL_SECONDS,
    );
    expect(WorkflowListeners.TRIGGERS_TTL_SECONDS).toBeLessThanOrEqual(60);

    // It runs out: the next write reads the workflows again.
    mockRedis.values.delete(triggersKey);
    listenTo(PROJECT, ["incident-on-create"]);

    expect(await isListening(ON_CREATE)).toBe(true);
  });

  test("a project's first write starts its generation, and keeps what it read under it", async () => {
    listenTo(PROJECT, ["incident-on-create"]);

    await isListening(ON_CREATE);

    const generation: string | undefined = mockRedis.values.get(
      `${WorkflowListeners.NAMESPACE}-generation:${PROJECT.toString().toLowerCase()}`,
    );

    expect(generation).toBeTruthy();
    expect(
      JSON.parse(
        mockRedis.values.get(
          `${WorkflowListeners.NAMESPACE}-triggers:${PROJECT.toString().toLowerCase()}`,
        )!,
      ),
    ).toEqual({
      generation: generation,
      triggerIds: ["incident-on-create"],
    });
  });

  test("many writes of one project at once read the database once", async () => {
    listenTo(PROJECT, ["incident-on-create"]);

    let release: () => void = (): void => {};
    mockDatabase.hold = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    const writes: Array<Promise<boolean>> = Array.from(
      { length: 20 },
      (): Promise<boolean> => {
        return isListening(ON_CREATE);
      },
    );

    // Let every write reach its read before the database answers.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
    release();

    expect(await Promise.all(writes)).toEqual(Array(20).fill(true));
    expect(mockDatabase.queries).toHaveLength(1);
  });
});

describe("a workflow changed: heard by the very next write", () => {
  test("one created, or turned on, or brought back from the archive, is heard by the next write", async () => {
    listenTo(PROJECT, []);
    expect(await isListening(ON_CREATE)).toBe(false);

    // The workflow is saved: its write is done, then its project changes generation.
    listenTo(PROJECT, ["incident-on-create"]);
    await WorkflowListeners.changed([PROJECT]);

    expect(await isListening(ON_CREATE)).toBe(true);
  });

  test("one turned off, archived or deleted is posted to no more", async () => {
    listenTo(PROJECT, ["incident-on-create"]);
    expect(await isListening(ON_CREATE)).toBe(true);

    listenTo(PROJECT, []);
    await WorkflowListeners.changed([PROJECT]);

    expect(await isListening(ON_CREATE)).toBe(false);
  });

  test("a change of one project leaves what another's writes are told", async () => {
    listenTo(PROJECT, []);
    listenTo(OTHER_PROJECT, []);
    await isListening(ON_CREATE);
    await isListening(ON_CREATE, OTHER_PROJECT);

    listenTo(PROJECT, ["incident-on-create"]);
    listenTo(OTHER_PROJECT, ["incident-on-create"]);
    await WorkflowListeners.changed([PROJECT]);

    expect(await isListening(ON_CREATE)).toBe(true);
    // Not changed, so still told from what was kept (until it runs out).
    expect(await isListening(ON_CREATE, OTHER_PROJECT)).toBe(false);
  });

  /*
   * The race a plain delete-on-change loses: a read that began before the
   * workflow was saved finds it as it was, and writes that down after the
   * change. Kept under the generation from before the change, which no
   * write reads again, it never answers a write after it.
   */
  test("a read that began before the change never answers a write after it", async () => {
    listenTo(PROJECT, []);

    let release: () => void = (): void => {};
    mockDatabase.hold = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    // A write begins reading: it finds no workflow listening.
    const before: Promise<boolean> = isListening(ON_CREATE);
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    // Meanwhile the workflow is turned on, and its project changes generation.
    listenTo(PROJECT, ["incident-on-create"]);
    await WorkflowListeners.changed([PROJECT]);

    mockDatabase.hold = null;
    release();

    // The write that began before is told what it read: it was before the change.
    expect(await before).toBe(false);
    // Every write after the change hears the workflow.
    expect(await isListening(ON_CREATE)).toBe(true);
    expect(await isListening(ON_CREATE)).toBe(true);
  });

  test("changed() names each project once, and starts a new generation of each", async () => {
    listenTo(PROJECT, []);
    await isListening(ON_CREATE);

    const generationKey: string = `${WorkflowListeners.NAMESPACE}-generation:${PROJECT.toString().toLowerCase()}`;
    const before: string | undefined = mockRedis.values.get(generationKey);

    await WorkflowListeners.changed([
      PROJECT,
      PROJECT.toString(),
      null,
      undefined,
    ]);

    expect(mockRedis.values.get(generationKey)).not.toBe(before);
    expect(mockRedis.ttls.get(generationKey)).toBe(
      WorkflowListeners.GENERATION_TTL_SECONDS,
    );
  });
});

describe("whenever it cannot tell, the trigger is posted", () => {
  test("Redis is not connected", async () => {
    mockRedis.connected = false;
    listenTo(PROJECT, []);

    expect(await isListening(ON_CREATE)).toBe(true);
    // And the database is not asked: there is nowhere to keep its answer.
    expect(mockDatabase.queries).toEqual([]);
  });

  test("Redis cannot be read", async () => {
    mockRedis.failReads = true;
    listenTo(PROJECT, []);

    expect(await isListening(ON_CREATE)).toBe(true);
  });

  test("the database cannot be read - and nothing is kept, so the next write reads again", async () => {
    mockDatabase.fail = true;
    listenTo(PROJECT, []);

    expect(await isListening(ON_CREATE)).toBe(true);
    expect(logger.error).toHaveBeenCalled();

    mockDatabase.fail = false;

    expect(await isListening(ON_CREATE)).toBe(false);
    expect(mockDatabase.queries).toHaveLength(2);
  });

  test("a project whose workflows listen to more triggers than one read holds", async () => {
    listenTo(
      PROJECT,
      Array.from({ length: LIMIT_MAX + 1 }, (_: unknown, index: number) => {
        return `trigger-${index}`;
      }),
    );

    expect(await isListening(ON_CREATE)).toBe(true);
  });

  test("what was read cannot be kept: this write is told what was read, the next reads again", async () => {
    listenTo(PROJECT, ["incident-on-create"]);
    mockRedis.failWrites = true;

    // The generation could not be started either: it cannot tell.
    expect(await isListening(ON_CREATE)).toBe(true);
    expect(await isListening(ON_DELETE)).toBe(true);
  });

  test("kept triggers that are not what they should be are read again", async () => {
    listenTo(PROJECT, ["incident-on-create"]);
    await isListening(ON_CREATE);

    mockRedis.values.set(
      `${WorkflowListeners.NAMESPACE}-triggers:${PROJECT.toString().toLowerCase()}`,
      "not json",
    );

    expect(await isListening(ON_CREATE)).toBe(true);
    expect(await isListening(ON_DELETE)).toBe(false);
    expect(mockDatabase.queries).toHaveLength(2);
  });

  test("a change Redis did not take is logged, and never throws", async () => {
    mockRedis.failWrites = true;

    await expect(WorkflowListeners.changed([PROJECT])).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();

    mockRedis.connected = false;

    await expect(WorkflowListeners.changed([PROJECT])).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("the writes of workflows that start a new generation", () => {
  test("a create, an update or a delete of a workflow starts one for each of its projects", async () => {
    const changed: SpyInstance<typeof WorkflowListeners.changed> = jest.spyOn(
      WorkflowListeners,
      "changed",
    );

    await WorkflowListeners.afterCreate({
      tableName: "Workflow",
      row: { projectId: PROJECT },
    });
    await WorkflowListeners.afterUpdate({
      tableName: "Workflow",
      rows: [{ projectId: PROJECT }, { projectId: OTHER_PROJECT }],
    });
    await WorkflowListeners.afterDelete({
      tableName: "Workflow",
      rows: [{ projectId: OTHER_PROJECT.toString() }],
    });

    expect(changed.mock.calls).toEqual([
      [[PROJECT]],
      [[PROJECT, OTHER_PROJECT]],
      [[OTHER_PROJECT.toString()]],
    ]);
  });

  test("a write of any other table starts none", async () => {
    const changed: SpyInstance<typeof WorkflowListeners.changed> = jest.spyOn(
      WorkflowListeners,
      "changed",
    );

    await WorkflowListeners.afterCreate({
      tableName: "Incident",
      row: { projectId: PROJECT },
    });
    await WorkflowListeners.afterUpdate({
      tableName: "WorkflowLog",
      rows: [{ projectId: PROJECT }],
    });
    await WorkflowListeners.afterDelete({
      tableName: "Monitor",
      rows: [{ projectId: PROJECT }],
    });
    // An update that wrote no workflow.
    await WorkflowListeners.afterUpdate({ tableName: "Workflow", rows: [] });

    expect(changed).not.toHaveBeenCalled();
  });
});
