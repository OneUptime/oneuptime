import DiscordBindingService from "../../../Server/Services/DiscordBindingService";
import UserDiscordService from "../../../Server/Services/UserDiscordService";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import UserDiscord from "../../../Models/DatabaseModels/UserDiscord";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceOAuthStateRecord } from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import { EntityManager } from "typeorm";

/*
 * HOM-44, written before the cascade existed. DiscordBindingService moves
 * both binding rows with raw manager writes under one advisory lock, so no
 * service hook fires when an account is unlinked, relinked or a project is
 * disconnected. A UserDiscord method is a pointer at the account link; these
 * cases pin that the pointer goes in the SAME transaction as the link:
 *
 *   - user disconnect: only that user's methods, never widened to the project
 *   - project disconnect: every member's methods in that project
 *   - relink to a DIFFERENT Discord account: the old methods go
 *   - relink to the SAME account: the methods stay
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ROW_ID: string = "55555555-5555-4555-8555-555555555555";
const USER_ROW_ID: string = "66666666-6666-4666-8666-666666666666";
const METHOD_ID: string = "33333333-3333-4333-8333-333333333333";
const GUILD_ID: string = "100000000000000004";
const DISCORD_USER_ID: string = "100000000000000003";

interface Recorder {
  manager: EntityManager;
  steps: Array<string>;
  methodQueries: Array<Record<string, unknown>>;
}

function recorder(rows: {
  project: Partial<WorkspaceProjectAuthToken> | null;
  user: Partial<WorkspaceUserAuthToken> | null;
}): Recorder {
  const steps: Array<string> = [];
  const methodQueries: Array<Record<string, unknown>> = [];
  const repository: (entity: { name: string }) => unknown = (entity: {
    name: string;
  }): unknown => {
    return {
      find: async (options: {
        where: Record<string, unknown>;
      }): Promise<unknown> => {
        if (entity === UserDiscord) {
          methodQueries.push(options.where);
          return [{ _id: METHOD_ID }];
        }
        if (entity === WorkspaceProjectAuthToken) {
          return rows.project ? [rows.project] : [];
        }
        return rows.user ? [rows.user] : [];
      },
      findOne: async (options: {
        where: Record<string, unknown>;
      }): Promise<unknown> => {
        if (entity === WorkspaceProjectAuthToken) {
          return rows.project;
        }
        if (entity === WorkspaceUserAuthToken) {
          // The duplicate-identity probe in link(): nobody else holds it.
          return options.where["workspaceUserId"] ? null : rows.user;
        }
        return null;
      },
      delete: async (): Promise<{ affected: number }> => {
        steps.push(`delete ${entity.name}`);
        return { affected: 1 };
      },
      update: async (): Promise<{ affected: number }> => {
        steps.push(`update ${entity.name}`);
        return { affected: 1 };
      },
      create: (values: unknown): unknown => {
        return values;
      },
      save: async (values: unknown): Promise<unknown> => {
        steps.push(`save ${entity.name}`);
        return values;
      },
    };
  };
  const manager: EntityManager = {
    query: async (sql: string): Promise<unknown> => {
      if (sql.includes("UPDATE")) {
        steps.push("raw update");
      }
      return [];
    },
    getRepository: repository,
  } as unknown as EntityManager;
  return { manager, steps, methodQueries };
}

function useManager(fake: Recorder): void {
  jest
    .spyOn(
      DiscordBindingService as unknown as {
        executeTransaction: (
          action: (manager: EntityManager) => Promise<unknown>,
        ) => Promise<unknown>;
      },
      "executeTransaction",
    )
    .mockImplementation(
      async (
        action: (manager: EntityManager) => Promise<unknown>,
      ): Promise<unknown> => {
        return await action(fake.manager);
      },
    );
}

function projectRow(): Partial<WorkspaceProjectAuthToken> {
  return {
    _id: PROJECT_ROW_ID,
    projectId: PROJECT_ID,
    workspaceType: WorkspaceType.Discord,
    workspaceProjectId: GUILD_ID,
    version: 3,
    miscData: {},
  } as unknown as Partial<WorkspaceProjectAuthToken>;
}

function userRow(
  overrides: Partial<WorkspaceUserAuthToken> = {},
): Partial<WorkspaceUserAuthToken> {
  return {
    _id: USER_ROW_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    workspaceType: WorkspaceType.Discord,
    workspaceUserId: DISCORD_USER_ID,
    version: 2,
    ...overrides,
  } as unknown as Partial<WorkspaceUserAuthToken>;
}

function fingerprintOf(rows: {
  project: Partial<WorkspaceProjectAuthToken> | null;
  user: Partial<WorkspaceUserAuthToken> | null;
}): string {
  return (
    DiscordBindingService as unknown as {
      fingerprint: (value: unknown) => string;
    }
  ).fingerprint(rows);
}

async function linkAs(
  rows: {
    project: Partial<WorkspaceProjectAuthToken> | null;
    user: Partial<WorkspaceUserAuthToken> | null;
  },
  discordUserId: string,
): Promise<void> {
  await DiscordBindingService.link({
    state: {
      projectId: PROJECT_ID,
      userId: USER_ID,
      workspaceProjectId: GUILD_ID,
      bindingSnapshot: fingerprintOf(rows),
    } as unknown as WorkspaceOAuthStateRecord,
    identity: { id: discordUserId, username: "discord-e2e-user" },
  });
}

describe("DiscordBindingService personal-method cascade", () => {
  let cascade: jest.SpyInstance;

  beforeEach(() => {
    cascade = jest.spyOn(UserDiscordService, "deleteMethodsForBinding");
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("user disconnect removes only that user's methods, before the tombstone", async () => {
    const fake: Recorder = recorder({ project: projectRow(), user: userRow() });
    useManager(fake);

    await DiscordBindingService.disconnect({
      projectId: PROJECT_ID,
      id: USER_ROW_ID,
      user: true,
    });

    expect(fake.methodQueries).toHaveLength(1);
    expect(String(fake.methodQueries[0]!["userId"])).toBe(USER_ID.toString());
    expect(String(fake.methodQueries[0]!["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    // On-call history is detached from the doomed rules before they go.
    expect(fake.steps).toEqual([
      "update UserOnCallLogTimeline",
      "delete UserNotificationRule",
      "delete UserDiscord",
      "update WorkspaceUserAuthToken",
    ]);
  });

  test("a user link row with no user id refuses instead of clearing the project", async () => {
    const userWithoutId: Partial<WorkspaceUserAuthToken> = userRow();
    delete userWithoutId.userId;
    const fake: Recorder = recorder({
      project: projectRow(),
      user: userWithoutId,
    });
    useManager(fake);

    await expect(
      DiscordBindingService.disconnect({
        projectId: PROJECT_ID,
        id: USER_ROW_ID,
        user: true,
      }),
    ).rejects.toThrow(BadDataException);
    expect(fake.methodQueries).toHaveLength(0);
    expect(fake.steps).toEqual([]);
  });

  test("project disconnect removes every member's methods in that project", async () => {
    const fake: Recorder = recorder({ project: projectRow(), user: null });
    useManager(fake);

    await DiscordBindingService.disconnect({
      projectId: PROJECT_ID,
      id: PROJECT_ROW_ID,
      user: false,
    });

    expect(fake.methodQueries).toHaveLength(1);
    expect(String(fake.methodQueries[0]!["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(fake.methodQueries[0]!["userId"]).toBeUndefined();
    expect(fake.steps.slice(0, 2)).toEqual([
      "delete UserNotificationRule",
      "delete UserDiscord",
    ]);
  });

  test("relinking a different Discord account removes the old methods first", async () => {
    const rows: {
      project: Partial<WorkspaceProjectAuthToken>;
      user: Partial<WorkspaceUserAuthToken>;
    } = { project: projectRow(), user: userRow() };
    const fake: Recorder = recorder(rows);
    useManager(fake);

    await linkAs(rows, "199999999999999999");

    expect(cascade).toHaveBeenCalledTimes(1);
    expect(fake.steps).toEqual([
      "update UserOnCallLogTimeline",
      "delete UserNotificationRule",
      "delete UserDiscord",
      "raw update",
    ]);
  });

  test("relinking the same Discord account keeps the methods", async () => {
    const rows: {
      project: Partial<WorkspaceProjectAuthToken>;
      user: Partial<WorkspaceUserAuthToken>;
    } = { project: projectRow(), user: userRow() };
    const fake: Recorder = recorder(rows);
    useManager(fake);

    await linkAs(rows, DISCORD_USER_ID);

    expect(cascade).not.toHaveBeenCalled();
    expect(fake.steps).toEqual(["raw update"]);
  });

  test("a first link has nothing to remove", async () => {
    const rows: {
      project: Partial<WorkspaceProjectAuthToken>;
      user: null;
    } = { project: projectRow(), user: null };
    const fake: Recorder = recorder(rows);
    useManager(fake);

    await linkAs(rows, DISCORD_USER_ID);

    expect(cascade).not.toHaveBeenCalled();
  });
});
