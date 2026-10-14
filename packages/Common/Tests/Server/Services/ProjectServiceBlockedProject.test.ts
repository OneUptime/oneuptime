import ProjectService, {
  BLOCKED_PROJECT_CACHE_TTL_MS,
} from "../../../Server/Services/ProjectService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * "HAS A MASTER ADMIN BLOCKED THIS PROJECT?", ASKED ON EVERY PUBLIC REQUEST.
 *
 * A blocked project's status pages and public dashboards answer as if they
 * did not exist (BlockedProjectStatusPages, DashboardService). Status pages
 * are the busiest public surface there is, so the question is answered from
 * a per-server cache: one query per project per BLOCKED_PROJECT_CACHE_TTL_MS,
 * one query for a burst that arrives together, and a block written on this
 * server drops the answer at once (onUpdateSuccess).
 *
 * No database: findOneById is a jest.spyOn stub, and the protected hook is
 * reached through a structural cast.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "b10c0000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "b10c0000-0000-4000-8000-000000000002",
);

interface ProjectServiceInternals {
  onUpdateSuccess: (
    onUpdate: OnUpdate<Project>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<Project>>;
}

function projectService(): ProjectServiceInternals {
  return ProjectService as unknown as ProjectServiceInternals;
}

function storedProject(data: { isBlocked: boolean }): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.isBlocked = data.isBlocked;
  return project;
}

function updateOf(patch: Record<string, unknown>): OnUpdate<Project> {
  return {
    updateBy: {
      data: patch,
      props: { isRoot: true },
    },
    carryForward: null,
  } as unknown as OnUpdate<Project>;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: Error) => void) => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
}

let findOneById: jest.SpyInstance;

beforeEach(() => {
  ProjectService.forgetBlockedStatus(PROJECT_ID);
  ProjectService.forgetBlockedStatus(OTHER_PROJECT_ID);

  findOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(storedProject({ isBlocked: false }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("ProjectService.isProjectBlocked", () => {
  test("reads isBlocked from the project row as root, and only that column", async () => {
    findOneById.mockResolvedValue(storedProject({ isBlocked: true }) as never);

    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      true,
    );

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: { isBlocked: true },
      props: { isRoot: true, ignoreHooks: true },
    });
  });

  test("reports a project that is not blocked as not blocked", async () => {
    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      false,
    );
  });

  test("reports a project that does not exist as not blocked", async () => {
    findOneById.mockResolvedValue(null as never);

    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      false,
    );
  });

  test("answers repeat requests from the cache, a cached 'not blocked' included", async () => {
    for (let request: number = 0; request < 5; request++) {
      await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
        false,
      );
    }

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("answers repeat requests for a blocked project from the cache too", async () => {
    findOneById.mockResolvedValue(storedProject({ isBlocked: true }) as never);

    for (let request: number = 0; request < 5; request++) {
      await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
        true,
      );
    }

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("keeps one answer per project, however the id is written", async () => {
    findOneById.mockResolvedValue(storedProject({ isBlocked: true }) as never);

    await ProjectService.isProjectBlocked(PROJECT_ID);

    await expect(
      ProjectService.isProjectBlocked(
        new ObjectID(PROJECT_ID.toString().toUpperCase()),
      ),
    ).resolves.toBe(true);

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("keeps each project's answer apart", async () => {
    findOneById.mockImplementation((async (data: { id: ObjectID }) => {
      const project: Project = new Project();
      project.id = data.id;
      project.isBlocked = data.id.toString() === PROJECT_ID.toString();
      return project;
    }) as never);

    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      true,
    );
    await expect(
      ProjectService.isProjectBlocked(OTHER_PROJECT_ID),
    ).resolves.toBe(false);
    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      true,
    );

    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("shares one query between concurrent requests for the same project", async () => {
    const row: Deferred<Project> = deferred<Project>();
    findOneById.mockReturnValue(row.promise as never);

    const answers: Promise<Array<boolean>> = Promise.all([
      ProjectService.isProjectBlocked(PROJECT_ID),
      ProjectService.isProjectBlocked(PROJECT_ID),
      ProjectService.isProjectBlocked(PROJECT_ID),
    ]);

    row.resolve(storedProject({ isBlocked: true }));

    await expect(answers).resolves.toEqual([true, true, true]);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("asks again once the answer is older than BLOCKED_PROJECT_CACHE_TTL_MS", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-13T10:00:00.000Z") });

    await ProjectService.isProjectBlocked(PROJECT_ID);

    jest.setSystemTime(
      new Date(
        new Date("2026-10-13T10:00:00.000Z").getTime() +
          BLOCKED_PROJECT_CACHE_TTL_MS -
          1,
      ),
    );
    await ProjectService.isProjectBlocked(PROJECT_ID);
    expect(findOneById).toHaveBeenCalledTimes(1);

    // Blocked on another server: this one sees it once its answer runs out.
    findOneById.mockResolvedValue(storedProject({ isBlocked: true }) as never);

    jest.setSystemTime(
      new Date(
        new Date("2026-10-13T10:00:00.000Z").getTime() +
          BLOCKED_PROJECT_CACHE_TTL_MS +
          1,
      ),
    );
    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      true,
    );
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("is a minute, as long as a user's block takes to reach another server", () => {
    expect(BLOCKED_PROJECT_CACHE_TTL_MS).toBe(60_000);
  });

  test("does not keep a failed lookup: the next request asks again", async () => {
    findOneById.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).rejects.toThrow(
      "database unavailable",
    );

    findOneById.mockResolvedValue(storedProject({ isBlocked: true }) as never);

    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      true,
    );
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("forgetBlockedStatus drops the answer, so the next request reads the row", async () => {
    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      false,
    );

    findOneById.mockResolvedValue(storedProject({ isBlocked: true }) as never);
    ProjectService.forgetBlockedStatus(PROJECT_ID);

    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      true,
    );
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("an answer read before a block was written is not kept after it", async () => {
    // The lookup reads the row while it is not blocked yet...
    const staleRow: Deferred<Project> = deferred<Project>();
    findOneById.mockReturnValueOnce(staleRow.promise as never);

    const stale: Promise<boolean> = ProjectService.isProjectBlocked(PROJECT_ID);

    // ...the block is written meanwhile, and this server forgets...
    ProjectService.forgetBlockedStatus(PROJECT_ID);

    // ...and only then does the stale answer arrive.
    staleRow.resolve(storedProject({ isBlocked: false }));
    await expect(stale).resolves.toBe(false);

    findOneById.mockResolvedValue(storedProject({ isBlocked: true }) as never);

    // The stale "not blocked" was not cached: the block is seen at once.
    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      true,
    );
  });
});

describe("ProjectService.onUpdateSuccess — blocking and unblocking a project", () => {
  test.each([
    ["blocking", true],
    ["unblocking", false],
  ])(
    "%s drops this server's answer for every project the write matched",
    async (_label: string, isBlocked: boolean) => {
      await ProjectService.isProjectBlocked(PROJECT_ID);
      await ProjectService.isProjectBlocked(OTHER_PROJECT_ID);
      expect(findOneById).toHaveBeenCalledTimes(2);

      await projectService().onUpdateSuccess(updateOf({ isBlocked }), [
        PROJECT_ID,
        OTHER_PROJECT_ID,
      ]);

      await ProjectService.isProjectBlocked(PROJECT_ID);
      await ProjectService.isProjectBlocked(OTHER_PROJECT_ID);
      expect(findOneById).toHaveBeenCalledTimes(4);
    },
  );

  test("a block takes effect on the very next request on this server", async () => {
    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      false,
    );

    findOneById.mockResolvedValue(storedProject({ isBlocked: true }) as never);

    await projectService().onUpdateSuccess(updateOf({ isBlocked: true }), [
      PROJECT_ID,
    ]);

    await expect(ProjectService.isProjectBlocked(PROJECT_ID)).resolves.toBe(
      true,
    );
  });

  test("a write that does not touch isBlocked keeps the answer", async () => {
    await ProjectService.isProjectBlocked(PROJECT_ID);

    await projectService().onUpdateSuccess(updateOf({ name: "Renamed" }), [
      PROJECT_ID,
    ]);

    await ProjectService.isProjectBlocked(PROJECT_ID);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("a write that matched no project forgets nothing", async () => {
    await ProjectService.isProjectBlocked(PROJECT_ID);

    await projectService().onUpdateSuccess(updateOf({ isBlocked: true }), []);

    await ProjectService.isProjectBlocked(PROJECT_ID);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  /*
   * Every other server is told too (RealtimeAccessChanges), so it forgets
   * its own answer and asks the live-update sockets it holds in the project
   * again: a block refuses the project's API requests everywhere at once,
   * not when each server's answer runs out.
   */
  test.each([
    ["blocking", true],
    ["unblocking", false],
  ])(
    "%s is announced to every server, once per project",
    async (_label: string, isBlocked: boolean) => {
      const announce: jest.SpyInstance = jest
        .spyOn(RealtimeAccessChanges, "announce")
        .mockImplementation(() => {
          return undefined;
        });

      await projectService().onUpdateSuccess(updateOf({ isBlocked }), [
        PROJECT_ID,
        OTHER_PROJECT_ID,
      ]);

      expect(announce.mock.calls).toEqual([
        [
          {
            kind: RealtimeAccessChangeKind.ProjectBlockChanged,
            projectId: PROJECT_ID.toString(),
          },
        ],
        [
          {
            kind: RealtimeAccessChangeKind.ProjectBlockChanged,
            projectId: OTHER_PROJECT_ID.toString(),
          },
        ],
      ]);
    },
  );

  test("a write that does not touch isBlocked announces nothing", async () => {
    const announce: jest.SpyInstance = jest
      .spyOn(RealtimeAccessChanges, "announce")
      .mockImplementation(() => {
        return undefined;
      });

    await projectService().onUpdateSuccess(updateOf({ name: "Renamed" }), [
      PROJECT_ID,
    ]);

    expect(
      announce.mock.calls.filter((call: Array<unknown>): boolean => {
        return (
          (call[0] as { kind?: string }).kind ===
          RealtimeAccessChangeKind.ProjectBlockChanged
        );
      }),
    ).toEqual([]);
  });
});
