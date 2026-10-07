import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import McpOAuthGrantService from "../../../../Server/Services/McpOAuthGrantService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserProjectSsoConsentService from "../../../../Server/Services/UserProjectSsoConsentService";
import logger from "../../../../Server/Utils/Logger";
import ProjectLeaveAccessCleanup from "../../../../Server/Utils/TeamMember/ProjectLeaveAccessCleanup";
import ProjectLeaveNotificationCleanup, {
  FormerMemberCleanupResult,
  PersonalTable,
  ProjectLeaveNotificationCleanupResult,
  ProjectUserRow,
} from "../../../../Server/Utils/TeamMember/ProjectLeaveNotificationCleanup";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * What a person holds that lets them, or a client acting for them, into a
 * project on their own goes when they leave it: the MCP clients they
 * connected (every token issued under a grant goes with it) and their
 * consent to the project's single sign-on. Pinned here with the reads and
 * writes faked:
 *
 *   - which tables those are, and a guard that every per-project table of a
 *     person's own is accounted for when they leave - removed with their
 *     notification settings, removed as access, handled where it lives, or
 *     kept on purpose (with the reason written down),
 *   - every delete is scoped to (project, person), as root, and one failing
 *     table does not stop the other,
 *   - the data migration's walk finds former members' leftovers in one
 *     statement over both tables, re-checks each person just before
 *     removing, and keeps going past failures.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("11111111-0000-4000-8000-000000000001");

/*
 * Every per-project table that holds rows of one person and that the person
 * can read as their own (@CurrentUserCanAccessRecordBy("userId")), and how
 * each follows them out of the project when it is neither a notification
 * setting nor an access table. Shrink-only: a new one has to say.
 */
const HANDLED_ELSEWHERE_OR_KEPT: Record<string, string> = {
  TeamMember: "The membership itself: removing it is what leaving is.",
  UserOnCallCalendarFeed:
    "Turned off on leave (cleanupOnCallAssignmentsForUserLeavingProject), and the feed shows nothing to somebody who is not a member when it is fetched (OnCallCalendarAPI).",
  WorkspaceUserAuthToken:
    "Their Slack / Microsoft Teams account link: removed on leave (removeWorkspaceAccountLinksIfUserLeftProject).",
  UserOnCallLog: "History of the pages sent to them.",
  UserOnCallLogTimeline: "History of the pages sent to them.",
  ProjectUserProfile:
    "Custom field values the project's admins keep about the person; grants nothing.",
};

function accessTableNames(): Array<string> {
  return ProjectLeaveAccessCleanup.getPersonalAccessTables().map(
    (table: PersonalTable): string => {
      return table.service.getModel().tableName!;
    },
  );
}

function notificationTableNames(): Array<string> {
  return ProjectLeaveNotificationCleanup.getPersonalNotificationTables().map(
    (table: PersonalTable): string => {
      return table.service.getModel().tableName!;
    },
  );
}

type CountBy = (data: {
  query: Record<string, unknown>;
  props: Record<string, unknown>;
}) => Promise<PositiveNumber>;

type DeleteBy = (data: {
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  props: Record<string, unknown>;
}) => Promise<number>;

interface TableSpies {
  countBy: Mock<CountBy>;
  deleteBy: Mock<DeleteBy>;
}

/*
 * Fakes countBy/deleteBy on both access tables. `rows` is what each holds
 * for the person (default 1); `failing` tables throw.
 */
function fakeAccessTables(options?: {
  rows?: Record<string, number>;
  failing?: Array<string>;
}): Record<string, TableSpies> {
  const spies: Record<string, TableSpies> = {};

  for (const table of ProjectLeaveAccessCleanup.getPersonalAccessTables()) {
    const name: string = table.service.getModel().tableName!;
    const rows: number = options?.rows?.[name] ?? 1;
    const failing: boolean = (options?.failing || []).includes(name);

    const countBy: Mock<CountBy> = jest.fn<CountBy>(
      async (): Promise<PositiveNumber> => {
        if (failing) {
          throw new Error(`${name} unavailable`);
        }

        return new PositiveNumber(rows);
      },
    );
    const deleteBy: Mock<DeleteBy> = jest.fn<DeleteBy>(
      async (): Promise<number> => {
        return rows;
      },
    );

    jest.spyOn(table.service, "countBy").mockImplementation(countBy as never);
    jest.spyOn(table.service, "deleteBy").mockImplementation(deleteBy as never);

    spies[name] = { countBy, deleteBy };
  }

  return spies;
}

describe("ProjectLeaveAccessCleanup", () => {
  beforeEach(() => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("which tables let a person into a project", () => {
    test("the MCP clients they connected, then their consent to the project's single sign-on", () => {
      expect(accessTableNames()).toEqual([
        "McpOAuthGrant",
        "UserProjectSsoConsent",
      ]);

      expect(ProjectLeaveAccessCleanup.getPersonalAccessTables()[0]!.service).toBe(
        McpOAuthGrantService,
      );
      expect(ProjectLeaveAccessCleanup.getPersonalAccessTables()[1]!.service).toBe(
        UserProjectSsoConsentService,
      );
    });

    test("every access table is a per-project table of one person, removed whole", () => {
      for (const table of ProjectLeaveAccessCleanup.getPersonalAccessTables()) {
        const model: DatabaseBaseModel = table.service.getModel();

        expect({
          table: model.tableName,
          projectId: model.hasColumn("projectId"),
          userId: model.hasColumn("userId"),
          // Nothing of theirs is kept back: no extra condition.
          query: table.query,
          sqlCondition: table.sqlCondition,
        }).toEqual({
          table: model.tableName,
          projectId: true,
          userId: true,
          query: undefined,
          sqlCondition: undefined,
        });
      }
    });

    test("no table is removed both as access and as a notification setting", () => {
      const notification: Set<string> = new Set<string>(
        notificationTableNames(),
      );

      expect(
        accessTableNames().filter((table: string): boolean => {
          return notification.has(table);
        }),
      ).toEqual([]);
    });

    test("every per-project table a person holds as their own is accounted for when they leave", () => {
      const removed: Set<string> = new Set<string>([
        ...notificationTableNames(),
        ...accessTableNames(),
      ]);

      const ownPerProjectTables: Array<string> = AllModelTypes.map(
        (modelType: { new (): DatabaseBaseModel }): DatabaseBaseModel => {
          return new modelType();
        },
      )
        .filter((model: DatabaseBaseModel): boolean => {
          return (
            model.currentUserCanAccessColumnBy === "userId" &&
            model.hasColumn("projectId") &&
            model.hasColumn("userId")
          );
        })
        .map((model: DatabaseBaseModel): string => {
          return model.tableName!;
        })
        .sort();

      const unaccounted: Array<string> = ownPerProjectTables.filter(
        (table: string): boolean => {
          return !removed.has(table) && !HANDLED_ELSEWHERE_OR_KEPT[table];
        },
      );

      // A new table of a person's own: remove it on leave, or say why not.
      expect(unaccounted).toEqual([]);

      // Every entry with a reason still names such a table, and is not removed twice.
      for (const table of Object.keys(HANDLED_ELSEWHERE_OR_KEPT)) {
        expect({
          table,
          exists: ownPerProjectTables.includes(table),
          removed: removed.has(table),
        }).toEqual({ table, exists: true, removed: false });
        expect(HANDLED_ELSEWHERE_OR_KEPT[table]!.trim()).not.toBe("");
      }

      // The two this cleanup exists for are among the person's own tables.
      expect(ownPerProjectTables).toContain("McpOAuthGrant");
    });
  });

  describe("removeProjectAccess", () => {
    test("removes each table's rows of that person in that project, as root, clients first", async () => {
      const spies: Record<string, TableSpies> = fakeAccessTables({
        rows: { McpOAuthGrant: 2, UserProjectSsoConsent: 1 },
      });

      const result: ProjectLeaveNotificationCleanupResult =
        await ProjectLeaveAccessCleanup.removeProjectAccess({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result).toEqual({
        removedRowCounts: { McpOAuthGrant: 2, UserProjectSsoConsent: 1 },
        failedTables: [],
      });

      expect(
        spies["McpOAuthGrant"]!.deleteBy.mock.invocationCallOrder[0]!,
      ).toBeLessThan(
        spies["UserProjectSsoConsent"]!.deleteBy.mock.invocationCallOrder[0]!,
      );

      for (const spy of Object.values(spies)) {
        expect(spy.deleteBy).toHaveBeenCalledTimes(1);

        const call: Parameters<DeleteBy>[0] = spy.deleteBy.mock.calls[0]![0];

        expect(call.query).toEqual({ projectId: PROJECT_ID, userId: USER_ID });
        expect(call.props).toEqual({ isRoot: true });
        expect(call.limit).toBe(LIMIT_PER_PROJECT);
        expect(call.skip).toBe(0);

        // The count asks exactly what the delete removes.
        expect(spy.countBy.mock.calls[0]![0].query).toEqual(call.query);
        expect(spy.countBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
      }
    });

    test("a table with nothing of theirs is not written to", async () => {
      const spies: Record<string, TableSpies> = fakeAccessTables({
        rows: { McpOAuthGrant: 0 },
      });

      const result: ProjectLeaveNotificationCleanupResult =
        await ProjectLeaveAccessCleanup.removeProjectAccess({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(spies["McpOAuthGrant"]!.deleteBy).not.toHaveBeenCalled();
      expect(spies["UserProjectSsoConsent"]!.deleteBy).toHaveBeenCalledTimes(1);
      expect(result.removedRowCounts).toEqual({ UserProjectSsoConsent: 1 });
    });

    test("a failing table is logged and named; the other still goes", async () => {
      const spies: Record<string, TableSpies> = fakeAccessTables({
        failing: ["McpOAuthGrant"],
      });

      const result: ProjectLeaveNotificationCleanupResult =
        await ProjectLeaveAccessCleanup.removeProjectAccess({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result.failedTables).toEqual(["McpOAuthGrant"]);
      expect(spies["McpOAuthGrant"]!.deleteBy).not.toHaveBeenCalled();
      expect(spies["UserProjectSsoConsent"]!.deleteBy).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalled();
    });

    test("nothing of another person or another project is asked for", async () => {
      const spies: Record<string, TableSpies> = fakeAccessTables();

      await ProjectLeaveAccessCleanup.removeProjectAccess({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

      for (const spy of Object.values(spies)) {
        for (const call of [
          ...spy.countBy.mock.calls,
          ...spy.deleteBy.mock.calls,
        ]) {
          expect(Object.keys(call[0].query).sort()).toEqual([
            "projectId",
            "userId",
          ]);
        }
      }
    });
  });

  describe("former members' leftovers (the data migration)", () => {
    const P1: ProjectUserRow = {
      projectId: "aaaaaaaa-0000-4000-8000-000000000001",
      userId: "11111111-0000-4000-8000-000000000001",
    };
    const P2: ProjectUserRow = {
      projectId: "aaaaaaaa-0000-4000-8000-000000000001",
      userId: "22222222-0000-4000-8000-000000000002",
    };
    const P3: ProjectUserRow = {
      projectId: "bbbbbbbb-0000-4000-8000-000000000002",
      userId: "33333333-0000-4000-8000-000000000003",
    };

    test("finding them: one statement over both access tables, only rows not deleted, only people with no accepted membership", async () => {
      const query: Mock<(sql: string) => Promise<unknown>> = jest.fn(
        async (): Promise<unknown> => {
          return [P1];
        },
      );

      jest
        .spyOn(TeamMemberService, "getRepository")
        .mockReturnValue({ manager: { query } } as never);

      await expect(
        ProjectLeaveAccessCleanup.getFormerMemberPairs(),
      ).resolves.toEqual([P1]);

      expect(query).toHaveBeenCalledTimes(1);

      const [sql] = query.mock.calls[0]!;

      expect(sql).toContain(
        `FROM "McpOAuthGrant" WHERE "deletedAt" IS NULL`,
      );
      expect(sql).toContain(
        `FROM "UserProjectSsoConsent" WHERE "deletedAt" IS NULL`,
      );
      expect(sql).toContain(" UNION ");
      expect(sql).toContain(`AND NOT EXISTS (SELECT 1 FROM "TeamMember"`);
      expect(sql).toContain(`"hasAcceptedInvitation" = true`);
      expect(sql).toContain(
        `ORDER BY personal."projectId" ASC, personal."userId" ASC`,
      );

      // Not the notification tables: those have their own walk.
      expect(sql).not.toContain(`"UserEmail"`);
    });

    test("re-checks each person, removes only former members' access, and keeps going past a failure", async () => {
      jest
        .spyOn(ProjectLeaveAccessCleanup, "getFormerMemberPairs")
        .mockResolvedValue([P1, P2, P3]);

      // P2 joined again after the read: they keep everything.
      const membership: SpyInstance<
        typeof TeamMemberService.isUserMemberOfProject
      > = jest
        .spyOn(TeamMemberService, "isUserMemberOfProject")
        .mockImplementation(
          async (data: {
            projectId: ObjectID;
            userId: ObjectID;
          }): Promise<boolean> => {
            return data.userId.toString() === P2.userId;
          },
        );

      const removal: SpyInstance<
        typeof ProjectLeaveAccessCleanup.removeProjectAccess
      > = jest
        .spyOn(ProjectLeaveAccessCleanup, "removeProjectAccess")
        .mockImplementation(
          async (data: {
            projectId: ObjectID;
            userId: ObjectID;
          }): Promise<ProjectLeaveNotificationCleanupResult> => {
            if (data.userId.toString() === P3.userId) {
              throw new Error("database unavailable");
            }

            return {
              removedRowCounts: { McpOAuthGrant: 2, UserProjectSsoConsent: 1 },
              failedTables: [],
            };
          },
        );

      const result: FormerMemberCleanupResult =
        await ProjectLeaveAccessCleanup.removeProjectAccessOfFormerMembers();

      expect(result).toEqual({
        cleanedPairCount: 1,
        removedRowCount: 3,
        failedPairCount: 1,
      });

      expect(membership).toHaveBeenCalledTimes(3);
      expect(
        removal.mock.calls.map(
          (
            call: Parameters<
              typeof ProjectLeaveAccessCleanup.removeProjectAccess
            >,
          ): string => {
            return call[0].userId.toString();
          },
        ),
      ).toEqual([P1.userId, P3.userId]);
      expect(logger.error).toHaveBeenCalled();
    });

    test("nothing left over: nothing removed", async () => {
      jest
        .spyOn(ProjectLeaveAccessCleanup, "getFormerMemberPairs")
        .mockResolvedValue([]);
      const removal: SpyInstance<
        typeof ProjectLeaveAccessCleanup.removeProjectAccess
      > = jest.spyOn(ProjectLeaveAccessCleanup, "removeProjectAccess");

      await expect(
        ProjectLeaveAccessCleanup.removeProjectAccessOfFormerMembers(),
      ).resolves.toEqual({
        cleanedPairCount: 0,
        removedRowCount: 0,
        failedPairCount: 0,
      });

      expect(removal).not.toHaveBeenCalled();
    });

    test("an empty list of tables reads nothing", async () => {
      const query: Mock<(sql: string) => Promise<unknown>> = jest.fn(
        async (): Promise<unknown> => {
          return [];
        },
      );

      jest
        .spyOn(TeamMemberService, "getRepository")
        .mockReturnValue({ manager: { query } } as never);

      await expect(
        ProjectLeaveNotificationCleanup.getFormerMemberPairsIn([]),
      ).resolves.toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });
  });
});
