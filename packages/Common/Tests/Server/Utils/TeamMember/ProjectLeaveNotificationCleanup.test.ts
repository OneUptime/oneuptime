import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import logger from "../../../../Server/Utils/Logger";
import ProjectLeaveNotificationCleanup, {
  FormerMemberCleanupResult,
  HistoryReference,
  PersonalNotificationTable,
  ProjectLeaveNotificationCleanupResult,
} from "../../../../Server/Utils/TeamMember/ProjectLeaveNotificationCleanup";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { FindOperator } from "typeorm";
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
 * What goes when somebody leaves a project: their OWN notification settings
 * for that project - rules, methods, settings, rollup preference and pending
 * rollup mail, routed call number, shift reminders - and nothing else. The
 * database-backed end-to-end run is ProjectMembershipPostgres.test.ts; this
 * file pins the decisions with the reads and writes faked:
 *
 *   - which tables are personal, in which order they go, and a guard that a
 *     new per-project "User*" table is either removed on leave or kept on
 *     purpose (with the reason written down),
 *   - every delete is scoped to (project, person), as root, and one failing
 *     table does not stop the others,
 *   - the on-call history that points at a rule or method is kept: those
 *     references are cleared before anything goes, and if that fails the
 *     rules and methods stay (a guard holds every relation into a personal
 *     table to that list),
 *   - the data migration's walk removes former members' leftovers only,
 *     re-checking each person just before, and keeps going past failures.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("11111111-0000-4000-8000-000000000001");

const ROLLUP_ITEM_TABLE: string = "UserNotificationEmailRollupItem";

/*
 * Per-project tables that name a person and are NOT removed when they leave,
 * each with the reason. Shrink-only: a new per-project "User*" table must be
 * added to getPersonalNotificationTables (it is removed on leave) or here.
 */
const KEPT_WHEN_A_PERSON_LEAVES: Record<string, string> = {
  UserNotificationEmailRollupBatch:
    "A record of rollup mail already sent: history, like the notification logs, and it expires on its own.",
  UserOnCallCalendarFeed:
    "Disabled - not deleted - by the on-call leave cleanup, so their subscribed calendar clears itself; a disabled feed serves nothing.",
  UserOnCallLog: "History of the pages sent to them.",
  UserOnCallLogTimeline: "History of the pages sent to them.",
  UserOnCallShiftReminderLog: "History of the shift reminders sent to them.",
  UserProjectSsoConsent:
    "Their consent to the project's single sign-on, not a notification setting.",
};

function tableNames(): Array<string> {
  return ProjectLeaveNotificationCleanup.getPersonalNotificationTables().map(
    (table: PersonalNotificationTable): string => {
      return table.service.getModel().tableName!;
    },
  );
}

function tableNamed(name: string): PersonalNotificationTable {
  return ProjectLeaveNotificationCleanup.getPersonalNotificationTables().find(
    (table: PersonalNotificationTable): boolean => {
      return table.service.getModel().tableName === name;
    },
  )!;
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
 * Fakes countBy/deleteBy on every personal table's service. `rows` is what
 * each table holds for the person (default 1); `failing` tables throw.
 */
// The history step, faked by fakeTables; failing when told to.
let keepHistory: SpyInstance<
  typeof ProjectLeaveNotificationCleanup.keepHistory
>;

function fakeTables(options?: {
  rows?: Record<string, number>;
  failing?: Array<string>;
  historyFails?: boolean | undefined;
}): Record<string, TableSpies> {
  const spies: Record<string, TableSpies> = {};

  keepHistory = jest
    .spyOn(ProjectLeaveNotificationCleanup, "keepHistory")
    .mockImplementation(async (): Promise<void> => {
      if (options?.historyFails) {
        throw new Error("history unavailable");
      }
    });

  for (const table of ProjectLeaveNotificationCleanup.getPersonalNotificationTables()) {
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

describe("ProjectLeaveNotificationCleanup", () => {
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

  describe("which tables are personal", () => {
    test("rules go first, then every notification method, then the settings", () => {
      expect(tableNames()).toEqual([
        "UserNotificationRule",
        "UserEmail",
        "UserSMS",
        "UserCall",
        "UserWhatsApp",
        "UserTelegram",
        "UserPush",
        "UserWebhook",
        "UserSlack",
        "UserMicrosoftTeams",
        "UserNotificationSetting",
        "UserNotificationEmailRollupSetting",
        "UserNotificationEmailRollupItem",
        "UserIncomingCallNumber",
        "UserOnCallShiftReminder",
      ]);
    });

    test("every per-project table of a person's own is removed on leave, or kept on purpose", () => {
      const listed: Set<string> = new Set<string>(tableNames());

      const perProjectPersonTables: Array<string> = AllModelTypes.map(
        (modelType: { new (): DatabaseBaseModel }): DatabaseBaseModel => {
          return new modelType();
        },
      )
        .filter((model: DatabaseBaseModel): boolean => {
          return (
            Boolean(model.tableName?.startsWith("User")) &&
            model.hasColumn("projectId") &&
            model.hasColumn("userId")
          );
        })
        .map((model: DatabaseBaseModel): string => {
          return model.tableName!;
        })
        .sort();

      const unclassified: Array<string> = perProjectPersonTables.filter(
        (table: string): boolean => {
          return !listed.has(table) && !KEPT_WHEN_A_PERSON_LEAVES[table];
        },
      );

      // A new table: remove it on leave, or say why it stays.
      expect(unclassified).toEqual([]);

      // Kept tables still exist and are not removed at the same time.
      for (const table of Object.keys(KEPT_WHEN_A_PERSON_LEAVES)) {
        expect({
          table,
          exists: perProjectPersonTables.includes(table),
        }).toEqual({ table, exists: true });
        expect({ table, listed: listed.has(table) }).toEqual({
          table,
          listed: false,
        });
      }
    });

    test("every listed table is a registered per-project table of one person", () => {
      for (const table of ProjectLeaveNotificationCleanup.getPersonalNotificationTables()) {
        const model: DatabaseBaseModel = table.service.getModel();

        expect({
          table: model.tableName,
          registered: AllModelTypes.some(
            (modelType: { new (): DatabaseBaseModel }): boolean => {
              return new modelType().tableName === model.tableName;
            },
          ),
          projectId: model.hasColumn("projectId"),
          userId: model.hasColumn("userId"),
        }).toEqual({
          table: model.tableName,
          registered: true,
          projectId: true,
          userId: true,
        });
      }
    });

    test("only rollup mail still waiting goes - sent mail is history", () => {
      const rollupItems: PersonalNotificationTable =
        tableNamed(ROLLUP_ITEM_TABLE);

      expect(rollupItems.sqlCondition).toBe(`"sentAt" IS NULL`);
      expect(rollupItems.query?.["sentAt"]).toBeInstanceOf(FindOperator);

      for (const table of ProjectLeaveNotificationCleanup.getPersonalNotificationTables()) {
        if (table.service.getModel().tableName === ROLLUP_ITEM_TABLE) {
          continue;
        }

        // Everything else of the person's in the project goes.
        expect(table.query).toBeUndefined();
        expect(table.sqlCondition).toBeUndefined();
      }
    });
  });

  describe("removePersonalNotificationSettings", () => {
    test("removes each table's rows of that person in that project, as root, rules first", async () => {
      const spies: Record<string, TableSpies> = fakeTables({
        rows: { UserEmail: 2, UserNotificationRule: 3 },
      });

      const result: ProjectLeaveNotificationCleanupResult =
        await ProjectLeaveNotificationCleanup.removePersonalNotificationSettings(
          { projectId: PROJECT_ID, userId: USER_ID },
        );

      expect(result.failedTables).toEqual([]);
      expect(result.removedRowCounts["UserEmail"]).toBe(2);
      expect(result.removedRowCounts["UserNotificationRule"]).toBe(3);
      expect(Object.keys(result.removedRowCounts).sort()).toEqual(
        tableNames().sort(),
      );

      const deleteOrder: Array<string> = Object.entries(spies)
        .map(([name, spy]: [string, TableSpies]): [string, number] => {
          return [name, spy.deleteBy.mock.invocationCallOrder[0]!];
        })
        .sort((a: [string, number], b: [string, number]): number => {
          return a[1] - b[1];
        })
        .map(([name]: [string, number]): string => {
          return name;
        });

      expect(deleteOrder).toEqual(tableNames());

      for (const [name, spy] of Object.entries(spies)) {
        expect(spy.deleteBy).toHaveBeenCalledTimes(1);

        const call: Parameters<DeleteBy>[0] = spy.deleteBy.mock.calls[0]![0];

        expect(call.props).toEqual({ isRoot: true });
        expect(call.limit).toBe(LIMIT_PER_PROJECT);
        expect(call.skip).toBe(0);
        expect(call.query["projectId"]).toBe(PROJECT_ID);
        expect(call.query["userId"]).toBe(USER_ID);

        // Scoped to (project, person) - and pending mail only for the queue.
        expect(Object.keys(call.query).sort()).toEqual(
          name === ROLLUP_ITEM_TABLE
            ? ["projectId", "sentAt", "userId"]
            : ["projectId", "userId"],
        );

        // The count asks exactly what the delete removes.
        expect(spy.countBy.mock.calls[0]![0].query).toEqual(call.query);
        expect(spy.countBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
      }
    });

    test("a table with nothing of theirs is not written to", async () => {
      const spies: Record<string, TableSpies> = fakeTables({
        rows: { UserWebhook: 0, UserSlack: 0 },
      });

      const result: ProjectLeaveNotificationCleanupResult =
        await ProjectLeaveNotificationCleanup.removePersonalNotificationSettings(
          { projectId: PROJECT_ID, userId: USER_ID },
        );

      expect(spies["UserWebhook"]!.deleteBy).not.toHaveBeenCalled();
      expect(spies["UserSlack"]!.deleteBy).not.toHaveBeenCalled();
      expect(result.removedRowCounts["UserWebhook"]).toBeUndefined();
      expect(result.removedRowCounts["UserSlack"]).toBeUndefined();
      expect(spies["UserEmail"]!.deleteBy).toHaveBeenCalledTimes(1);
    });

    test("the history is kept first, for that person in that project", async () => {
      const spies: Record<string, TableSpies> = fakeTables();

      await ProjectLeaveNotificationCleanup.removePersonalNotificationSettings({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

      expect(keepHistory).toHaveBeenCalledTimes(1);
      expect(keepHistory.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

      for (const spy of Object.values(spies)) {
        expect(keepHistory.mock.invocationCallOrder[0]!).toBeLessThan(
          spy.countBy.mock.invocationCallOrder[0]!,
        );
      }
    });

    test("history that cannot be kept keeps the rules and methods it points at; the rest still go", async () => {
      const spies: Record<string, TableSpies> = fakeTables({
        historyFails: true,
      });

      const result: ProjectLeaveNotificationCleanupResult =
        await ProjectLeaveNotificationCleanup.removePersonalNotificationSettings(
          { projectId: PROJECT_ID, userId: USER_ID },
        );

      const pointedAt: Set<string> = new Set<string>(
        ProjectLeaveNotificationCleanup.getHistoryReferences().map(
          (reference: HistoryReference): string => {
            return reference.references.getModel().tableName!;
          },
        ),
      );

      expect(Array.from(pointedAt).sort()).toEqual(
        [
          "UserCall",
          "UserEmail",
          "UserMicrosoftTeams",
          "UserNotificationRule",
          "UserPush",
          "UserSMS",
          "UserSlack",
          "UserTelegram",
          "UserWebhook",
          "UserWhatsApp",
        ].sort(),
      );

      for (const name of tableNames()) {
        if (pointedAt.has(name)) {
          expect({
            name,
            deleted: spies[name]!.deleteBy.mock.calls.length,
          }).toEqual({ name, deleted: 0 });
        } else {
          expect({
            name,
            deleted: spies[name]!.deleteBy.mock.calls.length,
          }).toEqual({ name, deleted: 1 });
        }
      }

      expect(result.failedTables.sort()).toEqual(Array.from(pointedAt).sort());
      expect(logger.error).toHaveBeenCalled();
    });

    test("a failing table is logged and named; the others still go", async () => {
      const spies: Record<string, TableSpies> = fakeTables({
        failing: ["UserSMS"],
      });

      const result: ProjectLeaveNotificationCleanupResult =
        await ProjectLeaveNotificationCleanup.removePersonalNotificationSettings(
          { projectId: PROJECT_ID, userId: USER_ID },
        );

      expect(result.failedTables).toEqual(["UserSMS"]);
      expect(spies["UserSMS"]!.deleteBy).not.toHaveBeenCalled();

      for (const name of tableNames()) {
        if (name !== "UserSMS") {
          expect(spies[name]!.deleteBy).toHaveBeenCalledTimes(1);
        }
      }

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("keeping the on-call history", () => {
    test("each reference is cleared only where it points at this person's rows in this project", async () => {
      const query: Mock<
        (sql: string, parameters: Array<unknown>) => Promise<unknown>
      > = jest.fn(async (): Promise<unknown> => {
        return [];
      });

      jest
        .spyOn(TeamMemberService, "getRepository")
        .mockReturnValue({ manager: { query } } as never);

      await ProjectLeaveNotificationCleanup.keepHistory({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

      // One statement for the one history table.
      expect(query).toHaveBeenCalledTimes(1);

      const [sql, parameters] = query.mock.calls[0]!;

      expect(
        sql.startsWith(`UPDATE "UserOnCallLogTimeline" history SET `),
      ).toBe(true);
      expect(parameters).toEqual([PROJECT_ID.toString(), USER_ID.toString()]);

      for (const reference of ProjectLeaveNotificationCleanup.getHistoryReferences()) {
        const ownRows: string = `SELECT personal."_id" FROM "${reference.references.getModel().tableName}" personal WHERE personal."projectId" = $1 AND personal."userId" = $2`;

        expect(sql).toContain(
          `"${reference.column}" = CASE WHEN history."${reference.column}" IN (${ownRows}) THEN NULL ELSE history."${reference.column}" END`,
        );
        expect(sql).toContain(`history."${reference.column}" IN (${ownRows})`);
      }

      // Nothing is deleted from the history itself.
      expect(sql).not.toContain("DELETE");
    });

    test("every relation into a personal table is either another personal table or a history reference that is cleared", () => {
      const personal: Set<string> = new Set<string>(tableNames());
      const cleared: Set<string> = new Set<string>(
        ProjectLeaveNotificationCleanup.getHistoryReferences().map(
          (reference: HistoryReference): string => {
            return `${reference.history.getModel().tableName}.${reference.column}`;
          },
        ),
      );

      const unhandled: Array<string> = [];
      const found: Set<string> = new Set<string>();

      for (const modelType of AllModelTypes) {
        const model: DatabaseBaseModel = new modelType();

        if (personal.has(model.tableName || "")) {
          // Removed together, rules first.
          continue;
        }

        for (const column of model.getTableColumns().columns) {
          const metadata: TableColumnMetadata =
            model.getTableColumnMetadata(column);

          if (
            metadata?.type !== TableColumnType.Entity ||
            !metadata.manyToOneRelationColumn ||
            !metadata.modelType
          ) {
            continue;
          }

          const target: string = new metadata.modelType().tableName || "";

          if (!personal.has(target)) {
            continue;
          }

          const reference: string = `${model.tableName}.${metadata.manyToOneRelationColumn}`;

          found.add(reference);

          if (!cleared.has(reference)) {
            unhandled.push(`${reference} -> ${target}`);
          }
        }
      }

      // A new relation into a personal table: clear it first, or remove it with them.
      expect(unhandled).toEqual([]);

      // Every listed reference is a real relation into the table it names.
      expect(Array.from(cleared).sort()).toEqual(Array.from(found).sort());
    });
  });

  describe("former members' leftovers (the data migration)", () => {
    const P1: { projectId: string; userId: string } = {
      projectId: "aaaaaaaa-0000-4000-8000-000000000001",
      userId: "11111111-0000-4000-8000-000000000001",
    };
    const P2: { projectId: string; userId: string } = {
      projectId: "aaaaaaaa-0000-4000-8000-000000000001",
      userId: "22222222-0000-4000-8000-000000000002",
    };
    const P3: { projectId: string; userId: string } = {
      projectId: "bbbbbbbb-0000-4000-8000-000000000002",
      userId: "33333333-0000-4000-8000-000000000003",
    };

    test("finds them in one read, re-checks each person, and keeps going past a failure", async () => {
      const pairs: SpyInstance<
        typeof ProjectLeaveNotificationCleanup.getFormerMemberPairs
      > = jest
        .spyOn(ProjectLeaveNotificationCleanup, "getFormerMemberPairs")
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
        typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettings
      > = jest
        .spyOn(
          ProjectLeaveNotificationCleanup,
          "removePersonalNotificationSettings",
        )
        .mockImplementation(
          async (data: {
            projectId: ObjectID;
            userId: ObjectID;
          }): Promise<ProjectLeaveNotificationCleanupResult> => {
            if (data.userId.toString() === P3.userId) {
              throw new Error("database unavailable");
            }

            return {
              removedRowCounts: { UserEmail: 2, UserNotificationRule: 3 },
              failedTables: [],
            };
          },
        );

      const result: FormerMemberCleanupResult =
        await ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers();

      expect(result).toEqual({
        cleanedPairCount: 1,
        removedRowCount: 5,
        failedPairCount: 1,
      });

      expect(pairs).toHaveBeenCalledTimes(1);
      expect(membership).toHaveBeenCalledTimes(3);
      expect(
        removal.mock.calls.map(
          (
            call: Parameters<
              typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettings
            >,
          ): string => {
            return call[0].userId.toString();
          },
        ),
      ).toEqual([P1.userId, P3.userId]);
      expect(removal.mock.calls[0]![0].projectId.toString()).toBe(P1.projectId);

      expect(logger.error).toHaveBeenCalled();
    });

    test("a pair with a table that failed counts as cleaned and as failed", async () => {
      jest
        .spyOn(ProjectLeaveNotificationCleanup, "getFormerMemberPairs")
        .mockResolvedValueOnce([P1]);
      jest
        .spyOn(TeamMemberService, "isUserMemberOfProject")
        .mockResolvedValue(false);
      jest
        .spyOn(
          ProjectLeaveNotificationCleanup,
          "removePersonalNotificationSettings",
        )
        .mockResolvedValue({
          removedRowCounts: { UserEmail: 1 },
          failedTables: ["UserSMS"],
        });

      await expect(
        ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers(),
      ).resolves.toEqual({
        cleanedPairCount: 1,
        removedRowCount: 1,
        failedPairCount: 1,
      });
    });

    test("nothing left over: nothing removed, one read", async () => {
      const pairs: SpyInstance<
        typeof ProjectLeaveNotificationCleanup.getFormerMemberPairs
      > = jest
        .spyOn(ProjectLeaveNotificationCleanup, "getFormerMemberPairs")
        .mockResolvedValue([]);
      const removal: SpyInstance<
        typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettings
      > = jest.spyOn(
        ProjectLeaveNotificationCleanup,
        "removePersonalNotificationSettings",
      );

      await expect(
        ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers(),
      ).resolves.toEqual({
        cleanedPairCount: 0,
        removedRowCount: 0,
        failedPairCount: 0,
      });

      expect(pairs).toHaveBeenCalledTimes(1);
      expect(removal).not.toHaveBeenCalled();
    });

    test("finding them: one statement over every personal table, only rows not deleted, only people with no accepted membership, in key order", async () => {
      const query: Mock<(sql: string) => Promise<unknown>> = jest.fn(
        async (): Promise<unknown> => {
          return [P1];
        },
      );

      jest
        .spyOn(TeamMemberService, "getRepository")
        .mockReturnValue({ manager: { query } } as never);

      await expect(
        ProjectLeaveNotificationCleanup.getFormerMemberPairs(),
      ).resolves.toEqual([P1]);

      expect(query).toHaveBeenCalledTimes(1);

      const [sql] = query.mock.calls[0]!;

      for (const table of tableNames()) {
        expect(sql).toContain(
          table === ROLLUP_ITEM_TABLE
            ? `FROM "${table}" WHERE "deletedAt" IS NULL AND "sentAt" IS NULL`
            : `FROM "${table}" WHERE "deletedAt" IS NULL`,
        );
      }

      expect(sql).toContain(" UNION ");
      expect(sql).toContain(`AND NOT EXISTS (SELECT 1 FROM "TeamMember"`);
      expect(sql).toContain(`"hasAcceptedInvitation" = true`);
      expect(sql).toContain(
        `ORDER BY personal."projectId" ASC, personal."userId" ASC`,
      );
      expect(sql).not.toContain("LIMIT");
    });
  });
});
