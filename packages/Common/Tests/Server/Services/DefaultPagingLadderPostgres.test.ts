import Entities from "../../../Models/DatabaseModels/Index";
import Project from "../../../Models/DatabaseModels/Project";
import { AddProjectDefaultPagingLadder1809183250000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183250000-AddProjectDefaultPagingLadder";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OnCallReadinessService from "../../../Server/Services/OnCallReadinessService";
import PagingLadderService from "../../../Server/Services/PagingLadderService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserNotificationRuleAdminService from "../../../Server/Services/UserNotificationRuleAdminService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import logger from "../../../Server/Utils/Logger";
import { JSONArray } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import {
  PagingLadderDefaultMemberResult,
  PagingLadderDefaultOutcome,
} from "../../../Types/NotificationRule/PagingLadderDefault";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
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
import { DataSource, QueryRunner } from "typeorm";
import { dropSchemaOneTableAtATime } from "../../Helpers/DropSchemaOneTableAtATime";

/*
 * A PROJECT'S DEFAULT LADDER, HELD BY A REAL, MIGRATED POSTGRES (#7449, #7450).
 *
 * What only Postgres can show:
 *
 *  - the migration's two columns are what the model says: a jsonb with no
 *    default and a boolean false by default, both nullable - and on an
 *    existing project's row it adds them, rewriting nothing: no default
 *    ladder, no phone asked for. down() takes them away and keeps the row;
 *    up() again adds them again;
 *  - a default saved through ProjectService is stored tidied, as jsonb, and
 *    read back the same by everything that reads it: the verify path
 *    (UserNotificationRuleService), the admin's apply (PagingLadderService)
 *    and Readiness (with the phone ask);
 *  - a method verified in a project with a default gets its rules at the
 *    default's waits, in every card, as rows; one the default leaves out
 *    gets none but the shift rules;
 *  - applying the default to members rewrites their rows: one with every
 *    channel gets exactly the default, one with none is skipped and keeps
 *    every row.
 *
 * Opt in with RUN_POSTGRES_DEFAULT_PAGING_LADDER_TESTS=true against a
 * Postgres migrated to the current head (the Postgres Schema Drift
 * workflow's database, right after its drift check). The tables it uses
 * are cloned into a unique schema, first on the search_path, and dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from DEFAULT_PAGING_LADDER_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from DEFAULT_PAGING_LADDER_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DEFAULT_PAGING_LADDER_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "TeamMember",
  "IncidentSeverity",
  "AlertSeverity",
  "UserNotificationRule",
  "UserEmail",
  "UserSMS",
  "UserCall",
  "UserPush",
  "UserWhatsApp",
  "UserTelegram",
  "UserSlack",
  "UserMicrosoftTeams",
  "UserMattermost",
  "UserWebhook",
  "CustomNotificationChannel",
];

const SCHEMA_NAME_DASHES: RegExp = /-/g;

// "Push and SMS at once, then a call after 5 minutes", by channel, as sent.
const DEFAULT_LADDER: JSONArray = [
  { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
  { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
  { channel: OnCallPageChannel.Push, notifyAfterMinutes: 0 },
];

describePostgres("a project's default ladder, on a migrated Postgres", () => {
  const schema: string = `default_paging_ladder_${ObjectID.generate()
    .toString()
    .replace(SCHEMA_NAME_DASHES, "")}`;

  let database: DataSource;

  const insertProject: () => Promise<string> = async (): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "Project" ("_id", "version", "name", "slug", "createdAt", "planName", "createdOwnerEmail") VALUES ($1, 1, $2, $2, now(), 'Growth', 'owner@example.com')`,
      [id, `project-${id}`],
    );

    return id;
  };

  const insertUser: (name: string) => Promise<string> = async (
    name: string,
  ): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "User" ("_id", "version", "name", "email", "slug", "createdAt") VALUES ($1, 1, $2, $3, $4, now())`,
      [id, name, `${name.toLowerCase()}-${id}@example.com`, `${name}-${id}`],
    );

    return id;
  };

  const insertMember: (
    projectId: string,
    userId: string,
  ) => Promise<void> = async (
    projectId: string,
    userId: string,
  ): Promise<void> => {
    await database.query(
      `INSERT INTO "TeamMember" ("_id", "version", "projectId", "userId", "teamId", "hasAcceptedInvitation", "createdAt") VALUES ($1, 1, $2, $3, $4, true, now())`,
      [
        ObjectID.generate().toString(),
        projectId,
        userId,
        ObjectID.generate().toString(),
      ],
    );
  };

  const insertSeverities: (projectId: string) => Promise<void> = async (
    projectId: string,
  ): Promise<void> => {
    for (const [table, names] of [
      ["IncidentSeverity", ["Critical", "Minor"]],
      ["AlertSeverity", ["High"]],
    ] as Array<[string, Array<string>]>) {
      let order: number = 1;

      for (const name of names) {
        await database.query(
          `INSERT INTO "${table}" ("_id", "version", "projectId", "name", "slug", "color", "order", "createdAt") VALUES ($1, 1, $2, $3, $3, '#000000', $4, now())`,
          [ObjectID.generate().toString(), projectId, name, order],
        );
        order++;
      }
    }
  };

  const insertMethod: (data: {
    table: string;
    projectId: string;
    userId: string;
    column: string;
    value: string;
  }) => Promise<string> = async (data: {
    table: string;
    projectId: string;
    userId: string;
    column: string;
    value: string;
  }): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${data.table}" ("_id", "version", "projectId", "userId", "${data.column}", "isVerified", "verificationCode", "createdAt") VALUES ($1, 1, $2, $3, $4, true, '123456', now())`,
      [id, data.projectId, data.userId, data.value],
    );

    return id;
  };

  const rulesOf: (
    projectId: string,
    userId: string,
  ) => Promise<
    Array<{
      ruleType: string;
      notifyAfterMinutes: number;
      method: string;
    }>
  > = async (
    projectId: string,
    userId: string,
  ): Promise<
    Array<{ ruleType: string; notifyAfterMinutes: number; method: string }>
  > => {
    return await database.query(
      `SELECT "ruleType", "notifyAfterMinutes", COALESCE("userEmailId", "userSmsId", "userCallId", "userPushId")::text AS "method" FROM "UserNotificationRule" WHERE "projectId" = $1 AND "userId" = $2 AND "deletedAt" IS NULL ORDER BY "ruleType", "notifyAfterMinutes"`,
      [projectId, userId],
    );
  };

  const adminProps: (projectId: string) => {
    userId: ObjectID;
    tenantId: ObjectID;
    userTenantAccessPermission: Record<string, UserTenantAccessPermission>;
  } = (
    projectId: string,
  ): {
    userId: ObjectID;
    tenantId: ObjectID;
    userTenantAccessPermission: Record<string, UserTenantAccessPermission>;
  } => {
    return {
      userId: ObjectID.generate(),
      tenantId: new ObjectID(projectId),
      userTenantAccessPermission: {
        [projectId]: {
          projectId: new ObjectID(projectId),
          permissions: [
            {
              permission: Permission.ProjectAdmin,
              labelIds: [],
              isBlockPermission: false,
            },
          ],
          isBlockPermission: false,
        } as unknown as UserTenantAccessPermission,
      },
    };
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["DEFAULT_PAGING_LADDER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["DEFAULT_PAGING_LADDER_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DEFAULT_PAGING_LADDER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema},public`,
        max: 20,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  }, 300000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await dropSchemaOneTableAtATime(database, schema);
      await database.destroy();
    }
  });

  beforeEach(() => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    // An admin's change is audited and mailed through its own tested path.
    jest
      .spyOn(UserNotificationRuleAdminService, "recordAdminRuleChange")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the migration's columns", () => {
    test("on the migrated database: a jsonb with no default and a boolean false by default, both nullable", async () => {
      const columns: Array<{
        column_name: string;
        udt_name: string;
        is_nullable: string;
        column_default: string | null;
      }> = await database.query(
        `SELECT column_name, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Project' AND column_name IN ('defaultPagingLadder', 'requirePhoneMethodForOnCall') ORDER BY column_name`,
      );

      expect(columns).toEqual([
        {
          column_name: "defaultPagingLadder",
          udt_name: "jsonb",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "requirePhoneMethodForOnCall",
          udt_name: "bool",
          is_nullable: "YES",
          column_default: "false",
        },
      ]);
    });

    test("on an existing project's row: no default, no phone asked; down() and up() again keep the row", async () => {
      const migrationSchema: string = `${schema}_migration`;
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await queryRunner.query(`CREATE SCHEMA "${migrationSchema}"`);
        await queryRunner.query(
          `CREATE TABLE "${migrationSchema}"."Project" (LIKE public."Project" INCLUDING ALL)`,
        );
        // The table as it was before the migration.
        await queryRunner.query(
          `ALTER TABLE "${migrationSchema}"."Project" DROP COLUMN "defaultPagingLadder", DROP COLUMN "requirePhoneMethodForOnCall"`,
        );
        await queryRunner.query(`SET search_path TO "${migrationSchema}"`);

        const id: string = ObjectID.generate().toString();

        await queryRunner.query(
          `INSERT INTO "Project" ("_id", "version", "name", "slug", "createdAt", "planName", "createdOwnerEmail") VALUES ($1, 1, 'Acme', 'acme', now(), 'Growth', 'owner@example.com')`,
          [id],
        );

        await new AddProjectDefaultPagingLadder1809183250000().up(queryRunner);

        expect(
          await queryRunner.query(
            `SELECT "name", "defaultPagingLadder", "requirePhoneMethodForOnCall" FROM "Project" WHERE "_id" = $1`,
            [id],
          ),
        ).toEqual([
          {
            name: "Acme",
            defaultPagingLadder: null,
            requirePhoneMethodForOnCall: false,
          },
        ]);

        await new AddProjectDefaultPagingLadder1809183250000().down(
          queryRunner,
        );

        expect(
          await queryRunner.query(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'Project' AND column_name IN ('defaultPagingLadder', 'requirePhoneMethodForOnCall')`,
            [migrationSchema],
          ),
        ).toEqual([]);
        expect(
          await queryRunner.query(
            `SELECT "name" FROM "Project" WHERE "_id" = $1`,
            [id],
          ),
        ).toEqual([{ name: "Acme" }]);

        await new AddProjectDefaultPagingLadder1809183250000().up(queryRunner);

        expect(
          (
            await queryRunner.query(
              `SELECT "requirePhoneMethodForOnCall" FROM "Project" WHERE "_id" = $1`,
              [id],
            )
          )[0].requirePhoneMethodForOnCall,
        ).toBe(false);
      } finally {
        // The connection goes back to the pool: on the suite's own schema again.
        await queryRunner.query("RESET search_path");
        await queryRunner.query(
          `DROP SCHEMA IF EXISTS "${migrationSchema}" CASCADE`,
        );
        await queryRunner.release();
      }
    });
  });

  describe("the default, saved and read", () => {
    test("is stored tidied as jsonb, and read back the same by the verify path, the admin's apply and Readiness", async () => {
      const projectId: string = await insertProject();

      await ProjectService.updateOneById({
        id: new ObjectID(projectId),
        data: {
          defaultPagingLadder: DEFAULT_LADDER,
          requirePhoneMethodForOnCall: true,
        } as never,
        props: { isRoot: true },
      });

      const stored: Array<{
        defaultPagingLadder: unknown;
        requirePhoneMethodForOnCall: boolean;
      }> = await database.query(
        `SELECT "defaultPagingLadder", "requirePhoneMethodForOnCall" FROM "Project" WHERE "_id" = $1`,
        [projectId],
      );

      // In paging order, push settings explicit on the push step.
      expect(stored[0]!.defaultPagingLadder).toEqual([
        {
          channel: OnCallPageChannel.Push,
          notifyAfterMinutes: 0,
          pushNotificationLevel: "Critical",
          repeatEveryMinutes: 0,
        },
        { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
        { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
      ]);
      expect(stored[0]!.requirePhoneMethodForOnCall).toBe(true);

      expect(
        await PagingLadderService.getProjectDefault(new ObjectID(projectId)),
      ).toEqual(stored[0]!.defaultPagingLadder);

      expect(
        await UserNotificationRuleService.getProjectDefaultLadderStepsForMethod(
          {
            projectId: new ObjectID(projectId),
            notificationMethod: { userCallId: ObjectID.generate() },
          },
        ),
      ).toEqual([{ channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 }]);

      const settings: { isPhoneMethodRequired: boolean } = await (
        OnCallReadinessService as unknown as {
          loadProjectSettings: (
            projectId: ObjectID,
          ) => Promise<{ isPhoneMethodRequired: boolean }>;
        }
      ).loadProjectSettings(new ObjectID(projectId));

      expect(settings.isPhoneMethodRequired).toBe(true);
    });

    test("no steps turns it off: stored as null, and nobody's verify path reads one", async () => {
      const projectId: string = await insertProject();

      await ProjectService.updateOneById({
        id: new ObjectID(projectId),
        data: { defaultPagingLadder: DEFAULT_LADDER } as never,
        props: { isRoot: true },
      });
      await ProjectService.updateOneById({
        id: new ObjectID(projectId),
        data: { defaultPagingLadder: [] } as never,
        props: { isRoot: true },
      });

      const project: Project | null = await ProjectService.findOneById({
        id: new ObjectID(projectId),
        select: { defaultPagingLadder: true },
        props: { isRoot: true },
      });

      expect(project?.defaultPagingLadder).toBeNull();
      expect(
        await UserNotificationRuleService.getProjectDefaultLadderStepsForMethod(
          {
            projectId: new ObjectID(projectId),
            notificationMethod: { userSmsId: ObjectID.generate() },
          },
        ),
      ).toBeNull();
    });

    test("a default that cannot be read is refused, and the stored one stays", async () => {
      const projectId: string = await insertProject();

      await ProjectService.updateOneById({
        id: new ObjectID(projectId),
        data: { defaultPagingLadder: DEFAULT_LADDER } as never,
        props: { isRoot: true },
      });

      await expect(
        ProjectService.updateOneById({
          id: new ObjectID(projectId),
          data: {
            defaultPagingLadder: [
              {
                channel: OnCallPageChannel.CustomChannel,
                notifyAfterMinutes: 0,
              },
            ],
          } as never,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(/cannot use/);

      expect(
        await PagingLadderService.getProjectDefault(new ObjectID(projectId)),
      ).toHaveLength(3);
    });
  });

  describe("a method verified in a project with a default", () => {
    test("gets its rules at the default's waits, in every card, as rows; a channel left out gets the shift rules alone", async () => {
      const projectId: string = await insertProject();
      await insertSeverities(projectId);
      const ana: string = await insertUser("Ana");
      await insertMember(projectId, ana);

      await ProjectService.updateOneById({
        id: new ObjectID(projectId),
        data: { defaultPagingLadder: DEFAULT_LADDER } as never,
        props: { isRoot: true },
      });

      const call: string = await insertMethod({
        table: "UserCall",
        projectId,
        userId: ana,
        column: "phone",
        value: "+15550100001",
      });
      const email: string = await insertMethod({
        table: "UserEmail",
        projectId,
        userId: ana,
        column: "email",
        value: "ana@example.com",
      });

      await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
        {
          projectId: new ObjectID(projectId),
          userId: new ObjectID(ana),
          notificationMethod: { userCallId: new ObjectID(call) },
        },
      );
      await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
        {
          projectId: new ObjectID(projectId),
          userId: new ObjectID(ana),
          notificationMethod: { userEmailId: new ObjectID(email) },
        },
      );

      const rules: Array<{
        ruleType: string;
        notifyAfterMinutes: number;
        method: string;
      }> = await rulesOf(projectId, ana);

      const onCall: Array<{ notifyAfterMinutes: number; method: string }> =
        rules.filter((rule: { ruleType: string }): boolean => {
          return (
            rule.ruleType !== NotificationRuleType.WHEN_USER_GOES_ON_CALL &&
            rule.ruleType !== NotificationRuleType.WHEN_USER_GOES_OFF_CALL
          );
        });

      // Two incident severities and one alert severity: six cards.
      expect(onCall).toHaveLength(6);

      for (const rule of onCall) {
        expect(rule.method).toBe(call);
        expect(rule.notifyAfterMinutes).toBe(5);
      }

      // The shift rules, for both: the call's and the email's.
      expect(rules.length - onCall.length).toBe(4);
    });
  });

  describe("applying the default to members", () => {
    test("one with SMS and calls gets them at the default's waits, keeping her email in place of push; one with none is skipped and keeps every row", async () => {
      const projectId: string = await insertProject();
      await insertSeverities(projectId);

      await ProjectService.updateOneById({
        id: new ObjectID(projectId),
        data: { defaultPagingLadder: DEFAULT_LADDER } as never,
        props: { isRoot: true },
      });

      const ana: string = await insertUser("Ana");
      const cy: string = await insertUser("Cy");
      await insertMember(projectId, ana);
      await insertMember(projectId, cy);

      const anaEmail: string = await insertMethod({
        table: "UserEmail",
        projectId,
        userId: ana,
        column: "email",
        value: "ana@example.com",
      });
      await insertMethod({
        table: "UserSMS",
        projectId,
        userId: ana,
        column: "phone",
        value: "+15550100002",
      });
      await insertMethod({
        table: "UserCall",
        projectId,
        userId: ana,
        column: "phone",
        value: "+15550100002",
      });
      const cyEmail: string = await insertMethod({
        table: "UserEmail",
        projectId,
        userId: cy,
        column: "email",
        value: "cy@example.com",
      });

      // Before the default, every verified email paged at once.
      await ProjectService.updateOneById({
        id: new ObjectID(projectId),
        data: { defaultPagingLadder: null } as never,
        props: { isRoot: true },
      });

      for (const [userId, emailId] of [
        [ana, anaEmail],
        [cy, cyEmail],
      ] as Array<[string, string]>) {
        await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
          {
            projectId: new ObjectID(projectId),
            userId: new ObjectID(userId),
            notificationMethod: { userEmailId: new ObjectID(emailId) },
          },
        );
      }

      await ProjectService.updateOneById({
        id: new ObjectID(projectId),
        data: { defaultPagingLadder: DEFAULT_LADDER } as never,
        props: { isRoot: true },
      });

      const cyBefore: Array<unknown> = await rulesOf(projectId, cy);

      const results: Array<PagingLadderDefaultMemberResult> =
        await PagingLadderService.applyDefaultLadderToMembers({
          projectId: new ObjectID(projectId),
          userIds: [new ObjectID(ana), new ObjectID(cy)],
          props: adminProps(projectId),
        });

      expect(
        results.map((result: PagingLadderDefaultMemberResult) => {
          return [result.outcome, result.leftOutChannels];
        }),
      ).toEqual([
        [PagingLadderDefaultOutcome.Applied, [OnCallPageChannel.Push]],
        [
          PagingLadderDefaultOutcome.Skipped,
          [
            OnCallPageChannel.Push,
            OnCallPageChannel.SMS,
            OnCallPageChannel.Call,
          ],
        ],
      ]);

      // Ana has no push: she keeps her email in its place, beside SMS at once and a call after 5.
      const anaOnCall: Array<{ notifyAfterMinutes: number }> = (
        await rulesOf(projectId, ana)
      ).filter((rule: { ruleType: string }): boolean => {
        return (
          rule.ruleType !== NotificationRuleType.WHEN_USER_GOES_ON_CALL &&
          rule.ruleType !== NotificationRuleType.WHEN_USER_GOES_OFF_CALL
        );
      });

      expect(anaOnCall).toHaveLength(18);
      expect(
        anaOnCall.filter((rule: { notifyAfterMinutes: number }): boolean => {
          return rule.notifyAfterMinutes === 5;
        }),
      ).toHaveLength(6);

      // Cy's rows are exactly as they were.
      expect(await rulesOf(projectId, cy)).toEqual(cyBefore);
    });
  });
});
