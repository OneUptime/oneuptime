import ProjectService, {
  ACCESS_RULES_READ_BATCH_SIZE,
} from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ONE READ OF A PROJECT'S ROW ANSWERS WHETHER IT IS BLOCKED AND ITS SIGN-IN
 * RULE - AND ONE STATEMENT ANSWERS THEM FOR ALL OF SOMEONE'S PROJECTS.
 *
 * Every request in a project asks ProjectService whether the project is
 * blocked (isProjectBlocked) and what it asks of a sign-in
 * (getRequireSsoForLogin, getRequireSsoWithSsoProviderId), each kept a
 * minute per server. They used to be read by two statements of the same
 * row, and a request across someone's projects asked them of every project
 * at once: once the minute ran out, someone in 300 projects sent 600 reads
 * of the project table together, for each such request.
 *
 * Now a read of the row answers both, and loadAccessRules reads the rows of
 * every project not kept in one statement (per ACCESS_RULES_READ_BATCH_SIZE
 * projects), keeping each answer as the getters keep it - and as carefully:
 * a question asked while the read is on the wire shares it, an answer read
 * before a block or a rule change written meanwhile is not kept, a read
 * that fails throws and keeps nothing, and a project that does not exist is
 * not blocked and has no rule kept.
 *
 * No database: findOneById and findBy are jest.spyOn stubs answering from
 * rows kept here.
 */

interface StoredRule {
  isBlocked?: boolean;
  requireSsoForLogin?: boolean;
  requireSsoWithSsoProviderId?: string | null;
}

let projectNumber: number = 0;

type NewProjectIdFunction = () => ObjectID;

const newProjectId: NewProjectIdFunction = (): ObjectID => {
  projectNumber++;
  return new ObjectID(
    `ac000000-0000-4000-8000-${projectNumber.toString(16).padStart(12, "0")}`,
  );
};

const rows: Map<string, StoredRule> = new Map<string, StoredRule>();
const askedProjectIds: Array<ObjectID> = [];

let findOneById: jest.SpyInstance;
let findBy: jest.SpyInstance;

type RowOfFunction = (id: string) => Project | null;

const rowOf: RowOfFunction = (id: string): Project | null => {
  const stored: StoredRule | undefined = rows.get(id.toLowerCase());

  if (!stored) {
    return null;
  }

  const project: Project = new Project();
  project.id = new ObjectID(id.toLowerCase());
  project.isBlocked = stored.isBlocked || false;
  project.requireSsoForLogin = stored.requireSsoForLogin || false;
  project.requireSsoWithSsoProviderId = stored.requireSsoWithSsoProviderId
    ? new ObjectID(stored.requireSsoWithSsoProviderId)
    : (undefined as unknown as ObjectID);
  return project;
};

type IdsOfFunction = (query: Record<string, unknown>) => Array<string>;

// The ids a findBy asks for: QueryHelper.any(...) carries them as a parameter.
const idsOf: IdsOfFunction = (
  query: Record<string, unknown>,
): Array<string> => {
  const parameters: Record<string, unknown> =
    (query["_id"] as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};

  const ids: Array<unknown> =
    (Object.values(parameters).find((value: unknown) => {
      return Array.isArray(value);
    }) as Array<unknown> | undefined) || [];

  return ids.map((id: unknown) => {
    return String(id);
  });
};

type StoreFunction = (projectId: ObjectID, rule?: StoredRule) => ObjectID;

const store: StoreFunction = (
  projectId: ObjectID,
  rule: StoredRule = {},
): ObjectID => {
  rows.set(projectId.toString().toLowerCase(), rule);
  askedProjectIds.push(projectId);
  return projectId;
};

type ProjectsFunction = (count: number, rule?: StoredRule) => Array<ObjectID>;

const projects: ProjectsFunction = (
  count: number,
  rule: StoredRule = {},
): Array<ObjectID> => {
  const ids: Array<ObjectID> = [];

  for (let i: number = 0; i < count; i++) {
    ids.push(store(newProjectId(), rule));
  }

  return ids;
};

type ReadCountFunction = () => number;

const readCount: ReadCountFunction = (): number => {
  return findOneById.mock.calls.length + findBy.mock.calls.length;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;

  const promise: Promise<T> = new Promise<T>((res: (value: T) => void) => {
    resolve = res;
  });

  return { promise, resolve };
}

type AskAllFunction = (projectId: ObjectID) => Promise<{
  isBlocked: boolean;
  requireSsoForLogin: boolean;
  requiredProviderId: string | null;
}>;

const askAll: AskAllFunction = async (
  projectId: ObjectID,
): Promise<{
  isBlocked: boolean;
  requireSsoForLogin: boolean;
  requiredProviderId: string | null;
}> => {
  const [isBlocked, requireSsoForLogin, requiredProviderId] = await Promise.all(
    [
      ProjectService.isProjectBlocked(projectId),
      ProjectService.getRequireSsoForLogin(projectId),
      ProjectService.getRequireSsoWithSsoProviderId(projectId),
    ],
  );

  return {
    isBlocked,
    requireSsoForLogin,
    requiredProviderId: requiredProviderId
      ? requiredProviderId.toString()
      : null,
  };
};

beforeEach(() => {
  rows.clear();

  findOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      return rowOf(data.id.toString());
    }) as never);

  findBy = jest
    .spyOn(ProjectService, "findBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      return idsOf(data.query)
        .map((id: string) => {
          return rowOf(id);
        })
        .filter((project: Project | null): project is Project => {
          return Boolean(project);
        });
    }) as never);
});

afterEach(() => {
  for (const projectId of askedProjectIds) {
    ProjectService.forgetBlockedStatus(projectId);
  }

  askedProjectIds.length = 0;
  ProjectService.forgetSignInRules();
  jest.restoreAllMocks();
});

describe("a project's row is read once for both questions", () => {
  test("whether it is blocked brings its sign-in rule with it: one read, by its id, as root, of the three columns", async () => {
    const providerId: string = "ac100000-0000-4000-8000-000000000001";
    const projectId: ObjectID = store(newProjectId(), {
      isBlocked: true,
      requireSsoForLogin: true,
      requireSsoWithSsoProviderId: providerId,
    });

    await expect(ProjectService.isProjectBlocked(projectId)).resolves.toBe(
      true,
    );
    await expect(ProjectService.getRequireSsoForLogin(projectId)).resolves.toBe(
      true,
    );
    expect(
      (
        await ProjectService.getRequireSsoWithSsoProviderId(projectId)
      )?.toString(),
    ).toBe(providerId);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledWith({
      id: projectId,
      select: {
        isBlocked: true,
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: true,
      },
      props: { isRoot: true, ignoreHooks: true },
    });
    expect(findBy).not.toHaveBeenCalled();
  });

  test("asked for its sign-in rule first, whether it is blocked comes with it", async () => {
    const projectId: ObjectID = store(newProjectId(), { isBlocked: false });

    await ProjectService.getRequireSsoForLogin(projectId);
    await expect(ProjectService.isProjectBlocked(projectId)).resolves.toBe(
      false,
    );

    expect(readCount()).toBe(1);
  });

  test("the questions a request asks together share one read", async () => {
    const [projectId] = projects(1, { requireSsoForLogin: true });

    await expect(askAll(projectId!)).resolves.toEqual({
      isBlocked: false,
      requireSsoForLogin: true,
      requiredProviderId: null,
    });
    expect(readCount()).toBe(1);
  });

  test("forgetting whether it is blocked reads its row again for that, and keeps the rule it holds", async () => {
    const [projectId] = projects(1);

    await askAll(projectId!);
    ProjectService.forgetBlockedStatus(projectId!);

    rows.set(projectId!.toString(), { isBlocked: true });

    await expect(ProjectService.isProjectBlocked(projectId!)).resolves.toBe(
      true,
    );
    await expect(
      ProjectService.getRequireSsoForLogin(projectId!),
    ).resolves.toBe(false);
    expect(readCount()).toBe(2);
  });

  test("forgetting its rule reads its row again for that, and keeps whether it is blocked", async () => {
    const [projectId] = projects(1);

    await askAll(projectId!);
    ProjectService.forgetSignInRules(projectId!);

    rows.set(projectId!.toString(), {
      isBlocked: true,
      requireSsoForLogin: true,
    });

    await expect(
      ProjectService.getRequireSsoForLogin(projectId!),
    ).resolves.toBe(true);
    // Still the answer kept before: the block is told by forgetBlockedStatus.
    await expect(ProjectService.isProjectBlocked(projectId!)).resolves.toBe(
      false,
    );
    expect(readCount()).toBe(2);
  });
});

describe("loadAccessRules reads every project not kept in one statement", () => {
  test("300 projects: one read, and every question about them answered from memory after", async () => {
    const ids: Array<ObjectID> = projects(300);
    rows.set(ids[7]!.toString(), { isBlocked: true });
    rows.set(ids[11]!.toString(), {
      requireSsoForLogin: true,
      requireSsoWithSsoProviderId: "ac100000-0000-4000-8000-000000000002",
    });

    await ProjectService.loadAccessRules(ids);

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findOneById).not.toHaveBeenCalled();

    const read: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: Record<string, unknown>;
    } = findBy.mock.calls[0]![0];

    expect(new Set(idsOf(read.query))).toEqual(
      new Set(
        ids.map((id: ObjectID) => {
          return id.toString();
        }),
      ),
    );
    expect(read.select).toEqual({
      _id: true,
      isBlocked: true,
      requireSsoForLogin: true,
      requireSsoWithSsoProviderId: true,
    });
    expect(read.limit).toBe(300);
    expect(read.skip).toBe(0);
    expect(read.props).toEqual({ isRoot: true, ignoreHooks: true });

    for (const projectId of ids) {
      await askAll(projectId);
    }

    expect(readCount()).toBe(1);
    await expect(askAll(ids[7]!)).resolves.toMatchObject({ isBlocked: true });
    await expect(askAll(ids[11]!)).resolves.toEqual({
      isBlocked: false,
      requireSsoForLogin: true,
      requiredProviderId: "ac100000-0000-4000-8000-000000000002",
    });
  });

  test("only the projects whose answers are not kept are read", async () => {
    const ids: Array<ObjectID> = projects(10);

    await askAll(ids[0]!);
    await askAll(ids[1]!);
    findOneById.mockClear();

    await ProjectService.loadAccessRules(ids);

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(idsOf(findBy.mock.calls[0]![0].query)).toHaveLength(8);
    expect(idsOf(findBy.mock.calls[0]![0].query)).not.toContain(
      ids[0]!.toString(),
    );
  });

  test("with every answer kept, nothing is read", async () => {
    const ids: Array<ObjectID> = projects(3);

    await ProjectService.loadAccessRules(ids);
    await ProjectService.loadAccessRules(ids);

    expect(readCount()).toBe(1);
  });

  test("a project of the list is read once, however its id is written", async () => {
    const [projectId] = projects(1);
    const [other] = projects(1);

    await ProjectService.loadAccessRules([
      projectId!,
      new ObjectID(projectId!.toString().toUpperCase()),
      other!,
    ]);

    expect(idsOf(findBy.mock.calls[0]![0].query)).toHaveLength(2);
    await askAll(new ObjectID(projectId!.toString().toUpperCase()));
    expect(readCount()).toBe(1);
  });

  test("one project not kept is read by its id", async () => {
    const ids: Array<ObjectID> = projects(3);

    await askAll(ids[0]!);
    await askAll(ids[1]!);
    findOneById.mockClear();

    await ProjectService.loadAccessRules(ids);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById.mock.calls[0]![0].id).toBe(ids[2]);
    expect(findBy).not.toHaveBeenCalled();
  });

  test(`more than ${ACCESS_RULES_READ_BATCH_SIZE} projects: one statement per ${ACCESS_RULES_READ_BATCH_SIZE}`, async () => {
    const ids: Array<ObjectID> = projects(ACCESS_RULES_READ_BATCH_SIZE * 2 + 5);

    await ProjectService.loadAccessRules(ids);

    expect(findBy).toHaveBeenCalledTimes(3);
    expect(
      findBy.mock.calls.map(
        (call: Array<{ query: Record<string, unknown> }>) => {
          return idsOf(call[0]!.query).length;
        },
      ),
    ).toEqual([ACCESS_RULES_READ_BATCH_SIZE, ACCESS_RULES_READ_BATCH_SIZE, 5]);

    for (const projectId of [ids[0]!, ids[1500]!, ids[ids.length - 1]!]) {
      await askAll(projectId);
    }

    expect(readCount()).toBe(3);
  });

  test("a project that does not exist is not blocked, and its rule is not kept: asked for, it is looked for again", async () => {
    const ids: Array<ObjectID> = projects(2);
    const gone: ObjectID = newProjectId();
    askedProjectIds.push(gone);

    await ProjectService.loadAccessRules([...ids, gone]);

    await expect(ProjectService.isProjectBlocked(gone)).resolves.toBe(false);
    expect(readCount()).toBe(1);

    await expect(ProjectService.getRequireSsoForLogin(gone)).rejects.toThrow(
      "Project not found",
    );
    await expect(ProjectService.getRequireSsoForLogin(gone)).rejects.toThrow(
      "Project not found",
    );

    // Every question about it after the batch is a read of its own.
    expect(readCount()).toBeGreaterThanOrEqual(2);
    expect(findOneById).toHaveBeenCalledWith(
      expect.objectContaining({ id: gone }),
    );
  });

  test("a read that fails throws, keeps nothing, and the next question reads again", async () => {
    const ids: Array<ObjectID> = projects(4);

    findBy.mockRejectedValueOnce(new Error("pool exhausted"));

    await expect(ProjectService.loadAccessRules(ids)).rejects.toThrow(
      "pool exhausted",
    );

    await expect(ProjectService.isProjectBlocked(ids[0]!)).resolves.toBe(false);
    await expect(ProjectService.getRequireSsoForLogin(ids[1]!)).resolves.toBe(
      false,
    );
    expect(readCount()).toBe(3);
  });

  test("a question asked while the read is on the wire shares it, and is told when it fails", async () => {
    const ids: Array<ObjectID> = projects(5);
    const wire: Deferred<Array<Project>> = deferred<Array<Project>>();

    findBy.mockReturnValueOnce(wire.promise as never);

    const load: Promise<void> = ProjectService.loadAccessRules(ids);
    const asked: Promise<boolean> = ProjectService.isProjectBlocked(ids[2]!);
    const askedRule: Promise<boolean> = ProjectService.getRequireSsoForLogin(
      ids[3]!,
    );

    wire.resolve([rowOf(ids[2]!.toString())!, rowOf(ids[3]!.toString())!]);

    await load;
    await expect(asked).resolves.toBe(false);
    await expect(askedRule).resolves.toBe(false);
    expect(readCount()).toBe(1);

    // And a read that fails fails whoever waited on it.
    const others: Array<ObjectID> = projects(3);
    const failing: Deferred<Array<Project>> = deferred<Array<Project>>();
    findBy.mockReturnValueOnce(
      failing.promise.then(() => {
        throw new Error("statement timeout");
      }) as never,
    );

    const failedLoad: Promise<void> = ProjectService.loadAccessRules(others);
    const failedQuestion: Promise<boolean> = ProjectService.isProjectBlocked(
      others[0]!,
    );

    failing.resolve([]);

    await expect(failedLoad).rejects.toThrow("statement timeout");
    await expect(failedQuestion).rejects.toThrow("statement timeout");
  });

  test("a project already being read for its answers is not read again", async () => {
    const ids: Array<ObjectID> = projects(3);
    const single: Deferred<Project | null> = deferred<Project | null>();

    findOneById.mockReturnValueOnce(single.promise as never);

    const blocked: Promise<boolean> = ProjectService.isProjectBlocked(ids[0]!);
    const load: Promise<void> = ProjectService.loadAccessRules(ids);

    expect(idsOf(findBy.mock.calls[0]![0].query)).toEqual([
      ids[1]!.toString(),
      ids[2]!.toString(),
    ]);

    single.resolve(rowOf(ids[0]!.toString()));
    await load;
    await blocked;

    await askAll(ids[0]!);
    expect(readCount()).toBe(2);
  });

  test("an answer read before a block was written is not kept after it; the others are", async () => {
    const ids: Array<ObjectID> = projects(3);
    const wire: Deferred<Array<Project>> = deferred<Array<Project>>();

    findBy.mockReturnValueOnce(wire.promise as never);

    const load: Promise<void> = ProjectService.loadAccessRules(ids);

    // Blocked while the read was on the wire, which saw it unblocked.
    const staleRows: Array<Project> = ids.map((id: ObjectID) => {
      return rowOf(id.toString())!;
    });
    rows.set(ids[0]!.toString(), { isBlocked: true });
    ProjectService.forgetBlockedStatus(ids[0]!);

    wire.resolve(staleRows);
    await load;

    await expect(ProjectService.isProjectBlocked(ids[0]!)).resolves.toBe(true);
    await expect(ProjectService.isProjectBlocked(ids[1]!)).resolves.toBe(false);
    // The rule read with it is kept: only the block was told.
    await expect(ProjectService.getRequireSsoForLogin(ids[0]!)).resolves.toBe(
      false,
    );
    expect(readCount()).toBe(2);
  });

  test("a rule read before it changed is not kept after it; forgetting every project's keeps none", async () => {
    const ids: Array<ObjectID> = projects(3);
    const wire: Deferred<Array<Project>> = deferred<Array<Project>>();

    findBy.mockReturnValueOnce(wire.promise as never);

    const load: Promise<void> = ProjectService.loadAccessRules(ids);
    const staleRows: Array<Project> = ids.map((id: ObjectID) => {
      return rowOf(id.toString())!;
    });

    rows.set(ids[1]!.toString(), { requireSsoForLogin: true });
    ProjectService.forgetSignInRules(ids[1]!);

    wire.resolve(staleRows);
    await load;

    await expect(ProjectService.getRequireSsoForLogin(ids[1]!)).resolves.toBe(
      true,
    );
    await expect(ProjectService.getRequireSsoForLogin(ids[2]!)).resolves.toBe(
      false,
    );
    expect(readCount()).toBe(2);

    // Every project's rules forgotten while a read is on the wire: none is kept.
    const more: Array<ObjectID> = projects(2);
    const second: Deferred<Array<Project>> = deferred<Array<Project>>();
    findBy.mockReturnValueOnce(second.promise as never);

    const secondLoad: Promise<void> = ProjectService.loadAccessRules(more);
    ProjectService.forgetSignInRules();
    second.resolve(
      more.map((id: ObjectID) => {
        return rowOf(id.toString())!;
      }),
    );
    await secondLoad;

    await ProjectService.getRequireSsoForLogin(more[0]!);
    await ProjectService.getRequireSsoForLogin(more[1]!);
    expect(readCount()).toBe(5);
  });

  test("leaves no unanswered lookup behind: a failed read asked by nobody raises nothing", async () => {
    const ids: Array<ObjectID> = projects(3);
    const unhandled: Array<unknown> = [];
    const onUnhandled: (reason: unknown) => void = (reason: unknown): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    try {
      findBy.mockRejectedValueOnce(new Error("connection reset"));
      await expect(ProjectService.loadAccessRules(ids)).rejects.toThrow(
        "connection reset",
      );

      // A batch with a project that does not exist, whose rule nobody asks.
      const gone: ObjectID = newProjectId();
      askedProjectIds.push(gone);
      await ProjectService.loadAccessRules([...projects(2), gone]);

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
