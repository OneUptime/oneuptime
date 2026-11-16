import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Redis, { ClientType } from "../../../../Server/Infrastructure/Redis";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHICH TRIGGERS A PROJECT'S WORKFLOWS LISTEN TO, AGAINST A REAL VALKEY
 * (issue #8861).
 *
 * WorkflowListeners keeps each project's listening triggers in Valkey under
 * a generation of the project, which every change of a workflow moves on.
 * Nothing is mocked between it and Valkey here: the read of the generation
 * and the triggers in one MGET, the generation started by SET NX, the
 * lifetimes Valkey gives each key, and a change heard by the very next
 * write - in whichever process it is, since nothing but Valkey holds the
 * generation. The database's answer stands in a variable (the query itself
 * runs against a migrated Postgres in WorkflowListenersPostgres).
 *
 * It needs Valkey or Redis: CI's test-setup.sh starts one on localhost:6310
 * and `npm test` exports its settings from config.env. Locally:
 *
 *   docker run -d --rm -p 16917:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16917 \
 *     npx jest Tests/Server/Utils/Workflow/WorkflowListenersValkey.test.ts
 *
 * Every key it writes is of a random project, and is deleted afterwards.
 */

jest.setTimeout(60_000);

const mockDatabase: {
  triggers: Map<string, Array<string>>;
  reads: number;
  hold: Promise<void> | null;
} = {
  triggers: new Map<string, Array<string>>(),
  reads: 0,
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
            _sql: string,
            params: Array<unknown>,
          ): Promise<Array<{ triggerId: string }>> => {
            mockDatabase.reads++;

            const found: Array<string> = [
              ...(mockDatabase.triggers.get(String(params[0])) || []),
            ];

            if (mockDatabase.hold) {
              await mockDatabase.hold;
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

import WorkflowListeners from "../../../../Server/Utils/Workflow/WorkflowListeners";

const projects: Array<ObjectID> = [];

function newProject(): ObjectID {
  const project: ObjectID = ObjectID.generate();
  projects.push(project);
  return project;
}

function client(): ClientType {
  return Redis.getClient()!;
}

function key(name: string, project: ObjectID): string {
  return `${WorkflowListeners.NAMESPACE}-${name}:${project.toString().toLowerCase()}`;
}

function isListening(project: ObjectID, triggerId: string): Promise<boolean> {
  return WorkflowListeners.isAnyListening({
    projectId: project,
    triggerIds: [triggerId],
  });
}

beforeAll(async () => {
  await Redis.connect();
});

beforeEach(() => {
  mockDatabase.triggers = new Map<string, Array<string>>();
  mockDatabase.reads = 0;
  mockDatabase.hold = null;
  WorkflowListeners.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  for (const project of projects) {
    await client().del(key("generation", project), key("triggers", project));
  }

  await Redis.disconnect();
});

describe("a project's listening triggers, kept in Valkey", () => {
  test("the first write starts the project's generation, and keeps what it read under it for a minute at most", async () => {
    const project: ObjectID = newProject();
    mockDatabase.triggers.set(project.toString(), ["incident-on-create"]);

    expect(await isListening(project, "incident-on-create")).toBe(true);

    const generation: string | null = await client().get(
      key("generation", project),
    );
    const kept: string | null = await client().get(key("triggers", project));

    expect(generation).toBeTruthy();
    expect(JSON.parse(kept!)).toEqual({
      generation: generation,
      triggerIds: ["incident-on-create"],
    });

    const keptFor: number = await client().ttl(key("triggers", project));
    expect(keptFor).toBeGreaterThan(0);
    expect(keptFor).toBeLessThanOrEqual(WorkflowListeners.TRIGGERS_TTL_SECONDS);
    expect(await client().ttl(key("generation", project))).toBeGreaterThan(
      WorkflowListeners.TRIGGERS_TTL_SECONDS,
    );
  });

  test("the writes after it are told from Valkey: the database is read once", async () => {
    const project: ObjectID = newProject();
    mockDatabase.triggers.set(project.toString(), ["incident-on-update"]);

    for (let write: number = 0; write < 25; write++) {
      expect(await isListening(project, "incident-on-update")).toBe(true);
      expect(await isListening(project, "incident-on-delete")).toBe(false);
    }

    expect(mockDatabase.reads).toBe(1);
  });

  test("a workflow turned on is heard by the very next write; turned off, it is posted to no more", async () => {
    const project: ObjectID = newProject();
    mockDatabase.triggers.set(project.toString(), []);

    expect(await isListening(project, "monitor-on-update")).toBe(false);

    mockDatabase.triggers.set(project.toString(), ["monitor-on-update"]);
    await WorkflowListeners.changed([project]);

    expect(await isListening(project, "monitor-on-update")).toBe(true);

    mockDatabase.triggers.set(project.toString(), []);
    await WorkflowListeners.changed([project]);

    expect(await isListening(project, "monitor-on-update")).toBe(false);
    expect(mockDatabase.reads).toBe(3);
  });

  test("a read under way as the workflow changes never answers a write after the change", async () => {
    const project: ObjectID = newProject();
    mockDatabase.triggers.set(project.toString(), []);

    let release: () => void = (): void => {};
    mockDatabase.hold = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    const before: Promise<boolean> = isListening(project, "alert-on-create");

    // Until the read reaches the database.
    for (let turn: number = 0; turn < 200 && mockDatabase.reads === 0; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 5);
      });
    }

    expect(mockDatabase.reads).toBe(1);

    mockDatabase.triggers.set(project.toString(), ["alert-on-create"]);
    await WorkflowListeners.changed([project]);

    mockDatabase.hold = null;
    release();

    expect(await before).toBe(false);
    expect(await isListening(project, "alert-on-create")).toBe(true);
  });

  test("Valkey loses the generation - a restart, an eviction: what was kept is read again, never served", async () => {
    const project: ObjectID = newProject();
    mockDatabase.triggers.set(project.toString(), []);

    expect(await isListening(project, "incident-on-create")).toBe(false);

    mockDatabase.triggers.set(project.toString(), ["incident-on-create"]);
    // No change was heard - the workflow written while Valkey was away - and the generation is gone.
    await client().del(key("generation", project));

    expect(await isListening(project, "incident-on-create")).toBe(true);
    expect(mockDatabase.reads).toBe(2);
  });

  test("Valkey evicts what was kept: the next write reads the database again", async () => {
    const project: ObjectID = newProject();
    mockDatabase.triggers.set(project.toString(), ["incident-on-create"]);

    await isListening(project, "incident-on-create");
    await client().del(key("triggers", project));

    expect(await isListening(project, "incident-on-create")).toBe(true);
    expect(mockDatabase.reads).toBe(2);
  });

  test("many writes of a project at once start one generation, and agree on it", async () => {
    const project: ObjectID = newProject();
    mockDatabase.triggers.set(project.toString(), ["incident-on-create"]);

    const answers: Array<boolean> = await Promise.all(
      Array.from({ length: 30 }, (): Promise<boolean> => {
        return isListening(project, "incident-on-create");
      }),
    );

    expect(answers).toEqual(Array(30).fill(true));

    const generation: string | null = await client().get(
      key("generation", project),
    );
    const kept: { generation: string } = JSON.parse(
      (await client().get(key("triggers", project)))!,
    );

    expect(kept.generation).toBe(generation);
  });
});
