import { createHash } from "crypto";
import { EntityManager } from "typeorm";
import ProjectToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import UserToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DiscordBindingService, {
  DiscordBindingSnapshot,
} from "../../../Server/Services/DiscordBindingService";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * Failure inventory before extraction: recursive lock/transaction deadlock,
 * reads from another manager, changed fingerprint, ignored tombstone or version,
 * and ambiguous duplicate rows becoming silently usable.
 */
const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const project: ProjectToken = new ProjectToken();
project.id = ObjectID.generate();
project.version = 2;
project.workspaceProjectId = "123456789012345678";
const user: UserToken = new UserToken();
user.id = ObjectID.generate();
user.version = 3;
const findProjects: jest.Mock = jest.fn();
const findUsers: jest.Mock = jest.fn();
const query: jest.Mock = jest.fn();
const manager: EntityManager = {
  getRepository: (
    model: typeof ProjectToken | typeof UserToken,
  ): { find: jest.Mock } => {
    return { find: model === ProjectToken ? findProjects : findUsers };
  },
  query,
} as unknown as EntityManager;

beforeEach((): void => {
  delete project.deletedAt;
  delete user.deletedAt;
  project.version = 2;
  user.version = 3;
  findProjects.mockResolvedValue([project]);
  findUsers.mockResolvedValue([user]);
  query.mockResolvedValue([]);
  jest
    .spyOn(DiscordBindingService, "executeTransaction")
    .mockImplementation(
      async <TResult>(
        action: (manager: EntityManager) => Promise<TResult>,
      ): Promise<TResult> => {
        return action(manager);
      },
    );
});
afterEach((): void => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test("snapshot preserves its existing fingerprint and lock", async (): Promise<void> => {
  const result: DiscordBindingSnapshot = await DiscordBindingService.snapshot(
    projectId,
    userId,
  );
  expect(result).toEqual({
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify([
          [project._id, 2, null],
          [user._id, 3, null],
        ]),
      )
      .digest("hex"),
    workspaceProjectId: project.workspaceProjectId,
  });
  expect(query).toHaveBeenCalledWith(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`discord-binding:${projectId}`],
  );
});

test("manager snapshot uses the supplied repositories without another transaction or lock", async (): Promise<void> => {
  const result: DiscordBindingSnapshot =
    await DiscordBindingService.snapshotWithManager(projectId, userId, manager);
  expect(result.workspaceProjectId).toBe(project.workspaceProjectId);
  expect(DiscordBindingService.executeTransaction).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  expect(findProjects).toHaveBeenCalledWith({
    where: { projectId, workspaceType: WorkspaceType.Discord },
    withDeleted: true,
  });
  expect(findUsers).toHaveBeenCalledWith({
    where: { projectId, userId, workspaceType: WorkspaceType.Discord },
    withDeleted: true,
  });
});

test("manager snapshot and locked snapshot use the same fingerprint", async (): Promise<void> => {
  expect(
    await DiscordBindingService.snapshotWithManager(projectId, userId, manager),
  ).toEqual(await DiscordBindingService.snapshot(projectId, userId));
});

test("disconnect tombstone changes the generation and hides the guild", async (): Promise<void> => {
  const before: DiscordBindingSnapshot = await DiscordBindingService.snapshot(
    projectId,
    userId,
  );
  project.deletedAt = new Date("2026-01-01T00:00:00Z");
  const after: DiscordBindingSnapshot = await DiscordBindingService.snapshot(
    projectId,
    userId,
  );
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(after.workspaceProjectId).toBeUndefined();
});

test("relink version changes the fingerprint even within the same guild", async (): Promise<void> => {
  const before: DiscordBindingSnapshot = await DiscordBindingService.snapshot(
    projectId,
    userId,
  );
  user.version = 4;
  expect(
    (await DiscordBindingService.snapshot(projectId, userId)).fingerprint,
  ).not.toBe(before.fingerprint);
});

test("ambiguous binding rows are refused in the manager path", async (): Promise<void> => {
  findProjects.mockResolvedValue([project, project]);
  await expect(
    DiscordBindingService.snapshotWithManager(projectId, userId, manager),
  ).rejects.toThrow("ambiguous");
});
