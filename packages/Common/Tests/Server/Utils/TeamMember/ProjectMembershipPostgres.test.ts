import Entities from "../../../../Models/DatabaseModels/Index";
import UserEmail from "../../../../Models/DatabaseModels/UserEmail";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyTimeLogService from "../../../../Server/Services/OnCallDutyPolicyTimeLogService";
import ProjectCallSMSConfigService from "../../../../Server/Services/ProjectCallSMSConfigService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserEmailService from "../../../../Server/Services/UserEmailService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import logger from "../../../../Server/Utils/Logger";
import ProjectLeaveNotificationCleanup, {
  FormerMemberCleanupResult,
  HistoryReference,
  PersonalNotificationTable,
} from "../../../../Server/Utils/TeamMember/ProjectLeaveNotificationCleanup";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import Dictionary from "../../../../Types/Dictionary";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * Leaving a project, end to end, against the real migrated tables.
 *
 * The unit suites pin each decision with the reads and writes faked. What
 * only a database can show is that the SQL says what the code means:
 *
 *   - membership is an accepted, not deleted TeamMember row of THAT project
 *     (ProjectMembership's batched read and the condition that rides on the
 *     notification-setting read agree with each other and with the rule),
 *     and an invitation not accepted yet is told apart from having left,
 *   - nothing is delivered through a setting row of somebody who is not a
 *     member: the real sendUserNotification reads the real row and stops,
 *   - removing somebody's last membership through TeamMemberService removes
 *     their own notification settings for that project - every table - and
 *     nothing of anybody else's, nor of their other projects; joining again
 *     starts clean,
 *   - the on-call history that points at the rules and methods removed stays
 *     (the foreign keys would delete it with them; the references are
 *     cleared first), and every foreign key into a personal table is either
 *     from another personal table or one of those history references,
 *   - the data migration's walk finds exactly the former members' leftovers
 *     (sent rollup mail is history and stays) and removes only those,
 *   - deleting a user account or a project takes these rows with it
 *     (the foreign keys cascade).
 *
 * Opt in with RUN_POSTGRES_PROJECT_MEMBERSHIP_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The STRUCTURE of TeamMember, Team,
 * every personal notification table and the on-call history is cloned into a
 * unique schema (its search_path holds that schema first), with the foreign
 * keys between those tables rebuilt from the migrated definitions; the schema
 * is dropped afterwards and every row is synthetic. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * PROJECT_MEMBERSHIP_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from PROJECT_MEMBERSHIP_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PROJECT_MEMBERSHIP_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_A: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-00000000000a",
);
const PROJECT_B: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-00000000000b",
);

const TEAM_A1: ObjectID = new ObjectID("a1000000-0000-4000-8000-0000000000a1");
const TEAM_A2: ObjectID = new ObjectID("a2000000-0000-4000-8000-0000000000a2");
const TEAM_B1: ObjectID = new ObjectID("b1000000-0000-4000-8000-0000000000b1");

// An accepted member of PROJECT_A.
const MEMBER: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
// Left PROJECT_A (rows still there from before); a member of PROJECT_B.
const LEAVER: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
// Invited to PROJECT_A and has not accepted (rows from an earlier membership).
const PENDING: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000003");
// Their PROJECT_A membership row is soft-deleted.
const SOFT_DELETED: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000004",
);
// A member of two teams of PROJECT_A.
const TWO_TEAMS: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-000000000005",
);
// Never a member; holds only rollup mail already sent to them.
const SENT_ONLY: ObjectID = new ObjectID(
  "60000000-0000-4000-8000-000000000006",
);
// A member of PROJECT_A and PROJECT_B, about to leave PROJECT_A.
const LEAVING: ObjectID = new ObjectID("70000000-0000-4000-8000-000000000007");

const EVENT_TYPE: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;

const ROLLUP_ITEM_TABLE: string = "UserNotificationEmailRollupItem";

function personalTableNames(): Array<string> {
  return ProjectLeaveNotificationCleanup.getPersonalNotificationTables().map(
    (table: PersonalNotificationTable): string => {
      return table.service.getModel().tableName!;
    },
  );
}

function historyTableNames(): Array<string> {
  return Array.from(
    new Set<string>(
      ProjectLeaveNotificationCleanup.getHistoryReferences().map(
        (reference: HistoryReference): string => {
          return reference.history.getModel().tableName!;
        },
      ),
    ),
  );
}

const HISTORY_TABLE: string = "UserOnCallLogTimeline";

describePostgres(
  "leaving a project removes its notification settings, against Postgres",
  () => {
    const schema: string = `project_membership_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    const membershipIds: Dictionary<string> = {};
    // The page history row of each seeded (project, person), by "project:person".
    const historyIds: Dictionary<string> = {};

    async function cloneTable(
      table: string,
      options: { keepNotNull: boolean },
    ): Promise<void> {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      if (options.keepNotNull) {
        return;
      }

      // A fixture names only what the test reads; the key stays NOT NULL.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema, table],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

    async function insertRow(
      table: string,
      values: Dictionary<unknown>,
    ): Promise<void> {
      const columns: Array<string> = Object.keys(values);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        Object.values(values),
      );
    }

    async function insertMembership(data: {
      key: string;
      userId: ObjectID;
      teamId: ObjectID;
      projectId: ObjectID;
      accepted: boolean;
      deleted?: boolean | undefined;
    }): Promise<void> {
      const id: string = ObjectID.generate().toString();

      membershipIds[data.key] = id;

      await insertRow("TeamMember", {
        _id: id,
        version: 1,
        userId: data.userId.toString(),
        teamId: data.teamId.toString(),
        projectId: data.projectId.toString(),
        hasAcceptedInvitation: data.accepted,
        invitationAcceptedAt: data.accepted ? new Date() : null,
        deletedAt: data.deleted ? new Date() : null,
      });
    }

    /*
     * One row in every personal notification table for (project, person):
     * an email-on setting for EVENT_TYPE, and rollup mail still pending.
     */
    async function insertPersonalRows(data: {
      projectId: ObjectID;
      userId: ObjectID;
    }): Promise<Dictionary<string>> {
      const ids: Dictionary<string> = {};

      for (const table of personalTableNames()) {
        const values: Dictionary<unknown> = {
          _id: ObjectID.generate().toString(),
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        };

        ids[table] = values["_id"] as string;

        if (table === "UserNotificationSetting") {
          values["eventType"] = EVENT_TYPE;
          values["alertByEmail"] = true;
        }

        if (table === ROLLUP_ITEM_TABLE) {
          values["sentAt"] = null;
        }

        await insertRow(table, values);
      }

      return ids;
    }

    /*
     * A page that went out to the person through their rule and email
     * address, as the on-call history records it.
     */
    async function insertPageHistory(data: {
      projectId: ObjectID;
      userId: ObjectID;
      personalRowIds: Dictionary<string>;
    }): Promise<string> {
      const id: string = ObjectID.generate().toString();

      await insertRow(HISTORY_TABLE, {
        _id: id,
        projectId: data.projectId.toString(),
        userId: data.userId.toString(),
        userNotificationRuleId: data.personalRowIds["UserNotificationRule"],
        userEmailId: data.personalRowIds["UserEmail"],
        statusMessage: "Email sent",
      });

      return id;
    }

    async function pageHistory(id: string): Promise<
      Array<{
        userNotificationRuleId: string | null;
        userEmailId: string | null;
        statusMessage: string;
      }>
    > {
      return await database.query(
        `SELECT "userNotificationRuleId"::text AS "userNotificationRuleId", "userEmailId"::text AS "userEmailId", "statusMessage"
           FROM "${schema}"."${HISTORY_TABLE}" WHERE "_id" = $1`,
        [id],
      );
    }

    // The seeded page history of (project, person), as it reads now.
    async function pageHistoryOf(
      projectId: ObjectID,
      userId: ObjectID,
    ): Promise<
      Array<{
        userNotificationRuleId: string | null;
        userEmailId: string | null;
        statusMessage: string;
      }>
    > {
      return await pageHistory(
        historyIds[`${projectId.toString()}:${userId.toString()}`]!,
      );
    }

    // History still there, no longer pointing at the rule or method removed.
    const HISTORY_KEPT_WITHOUT_REFERENCES: Array<{
      userNotificationRuleId: string | null;
      userEmailId: string | null;
      statusMessage: string;
    }> = [
      {
        userNotificationRuleId: null,
        userEmailId: null,
        statusMessage: "Email sent",
      },
    ];

    async function expectHistoryStillPointsAtTheirRows(
      projectId: ObjectID,
      userId: ObjectID,
    ): Promise<void> {
      const rows: Array<{
        userNotificationRuleId: string | null;
        userEmailId: string | null;
        statusMessage: string;
      }> = await pageHistoryOf(projectId, userId);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.userNotificationRuleId).not.toBeNull();
      expect(rows[0]!.userEmailId).not.toBeNull();

      // ... at THEIR rule and email address, which are still there.
      const rule: Array<{ userId: string }> = await database.query(
        `SELECT "userId"::text AS "userId" FROM "${schema}"."UserNotificationRule" WHERE "_id" = $1`,
        [rows[0]!.userNotificationRuleId],
      );

      expect(rule).toEqual([{ userId: userId.toString() }]);
    }

    async function insertSentRollupItem(data: {
      projectId: ObjectID;
      userId: ObjectID;
    }): Promise<void> {
      await insertRow(ROLLUP_ITEM_TABLE, {
        _id: ObjectID.generate().toString(),
        projectId: data.projectId.toString(),
        userId: data.userId.toString(),
        sentAt: new Date(),
      });
    }

    // Rows of (project, person) per personal table, sent rollup mail included.
    async function personalRowCounts(data: {
      projectId: ObjectID;
      userId: ObjectID;
    }): Promise<Dictionary<number>> {
      const counts: Dictionary<number> = {};

      for (const table of personalTableNames()) {
        const rows: Array<{ count: string }> = await database.query(
          `SELECT COUNT(*)::text AS count FROM "${schema}"."${table}" WHERE "projectId" = $1 AND "userId" = $2`,
          [data.projectId.toString(), data.userId.toString()],
        );

        counts[table] = Number(rows[0]!.count);
      }

      return counts;
    }

    function everyTable(count: number): Dictionary<number> {
      const counts: Dictionary<number> = {};

      for (const table of personalTableNames()) {
        counts[table] = count;
      }

      return counts;
    }

    // Everything removed - except rollup mail that was already sent.
    function removedExceptSentMail(sentItems: number): Dictionary<number> {
      return { ...everyTable(0), [ROLLUP_ITEM_TABLE]: sentItems };
    }

    async function emailLookupsWhenNotified(data: {
      projectId: ObjectID;
      userId: ObjectID;
    }): Promise<number> {
      const emailLookup: jest.SpyInstance = jest
        .spyOn(UserEmailService, "findBy")
        .mockResolvedValue([] as Array<UserEmail>);
      // Read for the SMS and call channels, which these settings leave off.
      const twilioConfigLookup: jest.SpyInstance = jest
        .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
        .mockResolvedValue(undefined);

      await UserNotificationSettingService.sendUserNotification({
        userId: data.userId,
        projectId: data.projectId,
        eventType: EVENT_TYPE,
        emailEnvelope: { templateType: "x", vars: {}, subject: "x" } as never,
        smsMessage: {} as never,
        callRequestMessage: {} as never,
        pushNotificationMessage: {} as never,
      });

      const calls: number = emailLookup.mock.calls.length;

      emailLookup.mockRestore();
      twilioConfigLookup.mockRestore();

      return calls;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PROJECT_MEMBERSHIP_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["PROJECT_MEMBERSHIP_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PROJECT_MEMBERSHIP_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      // TeamMember keeps its real constraints: every row here is a full one.
      await cloneTable("TeamMember", { keepNotNull: true });
      await cloneTable("Team", { keepNotNull: false });

      for (const table of [...personalTableNames(), ...historyTableNames()]) {
        await cloneTable(table, { keepNotNull: false });
      }

      /*
       * The foreign keys between the cloned tables, as migrated: the history's
       * references to rules and methods, and rules' references to methods,
       * with their ON DELETE CASCADE - the behaviour keepHistory exists for.
       */
      const cloned: Array<string> = [
        ...personalTableNames(),
        ...historyTableNames(),
      ];
      const foreignKeys: Array<{
        owner: string;
        name: string;
        definition: string;
      }> = await database.query(
        `SELECT owner.relname AS owner, constraint_row.conname AS name, pg_get_constraintdef(constraint_row.oid) AS definition
             FROM pg_constraint constraint_row
             JOIN pg_class owner ON owner.oid = constraint_row.conrelid
             JOIN pg_class target ON target.oid = constraint_row.confrelid
             JOIN pg_namespace namespace ON namespace.oid = owner.relnamespace
            WHERE constraint_row.contype = 'f'
              AND namespace.nspname = 'public'
              AND owner.relname = ANY($1)
              AND target.relname = ANY($2)`,
        [cloned, personalTableNames()],
      );

      expect(foreignKeys.length).toBeGreaterThan(0);

      for (const foreignKey of foreignKeys) {
        const definition: string = foreignKey.definition.replace(
          /REFERENCES\s+(?:public\.)?"?([A-Za-z]+)"?/,
          `REFERENCES "${schema}"."$1"`,
        );

        await database.query(
          `ALTER TABLE "${schema}"."${foreignKey.owner}" ADD CONSTRAINT "${foreignKey.name}" ${definition}`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Workflows, realtime events and the permission cache are not what this is about.
      jest
        .spyOn(TeamMemberService, "onTriggerWorkflow")
        .mockResolvedValue(undefined);
      jest
        .spyOn(TeamMemberService, "onTriggerRealtime")
        .mockResolvedValue(undefined);
      jest.spyOn(TeamMemberService, "refreshTokens").mockResolvedValue();
      jest
        .spyOn(
          TeamMemberService as unknown as {
            syncSubscriptionSeatsAfterMembershipChange: () => Promise<void>;
          },
          "syncSubscriptionSeatsAfterMembershipChange",
        )
        .mockResolvedValue(undefined);
      jest
        .spyOn(OnCallDutyPolicyTimeLogService, "endTimeForUser")
        .mockResolvedValue(undefined as never);

      // The other leave cleanups have suites of their own.
      jest
        .spyOn(TeamMemberService, "cleanupOnCallAssignmentsIfUserLeftProject")
        .mockResolvedValue(null as never);
      jest
        .spyOn(TeamMemberService, "cleanupResourceAssignmentsIfUserLeftProject")
        .mockResolvedValue(null as never);
      jest
        .spyOn(
          TeamMemberService,
          "removeWorkspaceAccountLinksIfUserLeftProject",
        )
        .mockResolvedValue(null as never);

      await database.query(
        `TRUNCATE ${[
          "TeamMember",
          "Team",
          ...personalTableNames(),
          ...historyTableNames(),
        ]
          .map((table: string): string => {
            return `"${schema}"."${table}"`;
          })
          .join(", ")} CASCADE`,
      );

      for (const [teamId, projectId] of [
        [TEAM_A1, PROJECT_A],
        [TEAM_A2, PROJECT_A],
        [TEAM_B1, PROJECT_B],
      ] as Array<[ObjectID, ObjectID]>) {
        await insertRow("Team", {
          _id: teamId.toString(),
          version: 1,
          projectId: projectId.toString(),
          name: `Team ${teamId.toString()}`,
          slug: teamId.toString(),
          shouldHaveAtLeastOneMember: false,
        });
      }

      await insertMembership({
        key: "member",
        userId: MEMBER,
        teamId: TEAM_A1,
        projectId: PROJECT_A,
        accepted: true,
      });
      await insertMembership({
        key: "twoTeams-a1",
        userId: TWO_TEAMS,
        teamId: TEAM_A1,
        projectId: PROJECT_A,
        accepted: true,
      });
      await insertMembership({
        key: "twoTeams-a2",
        userId: TWO_TEAMS,
        teamId: TEAM_A2,
        projectId: PROJECT_A,
        accepted: true,
      });
      await insertMembership({
        key: "leaver-b1",
        userId: LEAVER,
        teamId: TEAM_B1,
        projectId: PROJECT_B,
        accepted: true,
      });
      await insertMembership({
        key: "pending",
        userId: PENDING,
        teamId: TEAM_A1,
        projectId: PROJECT_A,
        accepted: false,
      });
      await insertMembership({
        key: "softDeleted",
        userId: SOFT_DELETED,
        teamId: TEAM_A1,
        projectId: PROJECT_A,
        accepted: true,
        deleted: true,
      });
      await insertMembership({
        key: "leaving-a1",
        userId: LEAVING,
        teamId: TEAM_A1,
        projectId: PROJECT_A,
        accepted: true,
      });
      await insertMembership({
        key: "leaving-b1",
        userId: LEAVING,
        teamId: TEAM_B1,
        projectId: PROJECT_B,
        accepted: true,
      });

      for (const [projectId, userId] of [
        [PROJECT_A, MEMBER],
        [PROJECT_A, TWO_TEAMS],
        [PROJECT_A, LEAVER],
        [PROJECT_B, LEAVER],
        [PROJECT_A, PENDING],
        [PROJECT_A, SOFT_DELETED],
        [PROJECT_A, LEAVING],
        [PROJECT_B, LEAVING],
      ] as Array<[ObjectID, ObjectID]>) {
        const ids: Dictionary<string> = await insertPersonalRows({
          projectId,
          userId,
        });

        historyIds[`${projectId.toString()}:${userId.toString()}`] =
          await insertPageHistory({ projectId, userId, personalRowIds: ids });
      }

      await insertSentRollupItem({ projectId: PROJECT_A, userId: LEAVER });
      await insertSentRollupItem({ projectId: PROJECT_A, userId: SENT_ONLY });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("who is a member", () => {
      test("an accepted, not deleted membership of THAT project - in one read for the batch", async () => {
        const keys: Set<string> = await ProjectMembership.getMemberKeys([
          { projectId: PROJECT_A, userId: MEMBER },
          { projectId: PROJECT_A, userId: TWO_TEAMS },
          { projectId: PROJECT_A, userId: LEAVER },
          { projectId: PROJECT_B, userId: LEAVER },
          { projectId: PROJECT_A, userId: PENDING },
          { projectId: PROJECT_A, userId: SOFT_DELETED },
          { projectId: PROJECT_A, userId: SENT_ONLY },
        ]);

        expect(Array.from(keys).sort()).toEqual(
          [
            ProjectMembership.getKey(PROJECT_A, MEMBER),
            ProjectMembership.getKey(PROJECT_A, TWO_TEAMS),
            ProjectMembership.getKey(PROJECT_B, LEAVER),
          ].sort(),
        );

        const memberIds: Set<string> = await ProjectMembership.getMemberUserIds(
          {
            projectId: PROJECT_A,
            userIds: [MEMBER, TWO_TEAMS, LEAVER, PENDING, SOFT_DELETED],
          },
        );

        expect(Array.from(memberIds).sort()).toEqual(
          [MEMBER.toString(), TWO_TEAMS.toString()].sort(),
        );
      });

      test("an invitation not accepted yet is told apart from having left", async () => {
        // A withdrawn (soft-deleted) invitation is not one.
        await insertMembership({
          key: "withdrawnInvitation",
          userId: SENT_ONLY,
          teamId: TEAM_A1,
          projectId: PROJECT_A,
          accepted: false,
          deleted: true,
        });

        const invited: Set<string> = await ProjectMembership.getInvitedUserIds({
          projectId: PROJECT_A,
          userIds: [MEMBER, LEAVER, PENDING, SOFT_DELETED, SENT_ONLY],
        });

        expect(Array.from(invited)).toEqual([PENDING.toString().toLowerCase()]);

        // Invited to PROJECT_A only.
        await expect(
          ProjectMembership.getInvitedUserIds({
            projectId: PROJECT_B,
            userIds: [PENDING, LEAVER],
          }),
        ).resolves.toEqual(new Set<string>());
      });

      test("the condition on the setting read agrees with the batched read, person by person", async () => {
        const pairs: Array<[ObjectID, ObjectID]> = [
          [PROJECT_A, MEMBER],
          [PROJECT_A, TWO_TEAMS],
          [PROJECT_A, LEAVER],
          [PROJECT_B, LEAVER],
          [PROJECT_A, PENDING],
          [PROJECT_A, SOFT_DELETED],
        ];

        const memberKeys: Set<string> = await ProjectMembership.getMemberKeys(
          pairs.map(([projectId, userId]: [ObjectID, ObjectID]) => {
            return { projectId, userId };
          }),
        );

        for (const [projectId, userId] of pairs) {
          const setting: UserNotificationSetting | null =
            await UserNotificationSettingService.findOneBy({
              query: {
                userId: ProjectMembership.userIdWhileMember({
                  projectId,
                  userId,
                }),
                projectId: projectId,
                eventType: EVENT_TYPE,
              },
              select: { _id: true, userId: true },
              props: { isRoot: true },
            });

          // Every pair HAS a setting row; only members' rows are read.
          expect({
            pair: ProjectMembership.getKey(projectId, userId),
            read: Boolean(setting),
          }).toEqual({
            pair: ProjectMembership.getKey(projectId, userId),
            read: memberKeys.has(ProjectMembership.getKey(projectId, userId)),
          });

          if (setting) {
            expect(setting.userId?.toString()).toBe(userId.toString());
          }
        }
      });
    });

    describe("delivery", () => {
      test("a member's setting is acted on; a setting row of somebody who is not a member is not", async () => {
        // Member of the project: the email channel is looked up.
        await expect(
          emailLookupsWhenNotified({ projectId: PROJECT_A, userId: MEMBER }),
        ).resolves.toBe(1);
        await expect(
          emailLookupsWhenNotified({ projectId: PROJECT_B, userId: LEAVER }),
        ).resolves.toBe(1);

        // Same row, same event - not a member of PROJECT_A: nothing is sent.
        await expect(
          emailLookupsWhenNotified({ projectId: PROJECT_A, userId: LEAVER }),
        ).resolves.toBe(0);
        await expect(
          emailLookupsWhenNotified({ projectId: PROJECT_A, userId: PENDING }),
        ).resolves.toBe(0);
        await expect(
          emailLookupsWhenNotified({
            projectId: PROJECT_A,
            userId: SOFT_DELETED,
          }),
        ).resolves.toBe(0);
      });
    });

    describe("leaving", () => {
      test("removing somebody's last membership removes their own settings for that project, and nothing else", async () => {
        await TeamMemberService.deleteOneById({
          id: new ObjectID(membershipIds["leaving-a1"]!),
          props: { isRoot: true },
        });

        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: LEAVING }),
        ).resolves.toEqual(everyTable(0));

        // Their other project, and everybody else, untouched.
        await expect(
          personalRowCounts({ projectId: PROJECT_B, userId: LEAVING }),
        ).resolves.toEqual(everyTable(1));
        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: MEMBER }),
        ).resolves.toEqual(everyTable(1));
        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: TWO_TEAMS }),
        ).resolves.toEqual(everyTable(1));

        // Nothing of PROJECT_A reaches them any more; PROJECT_B still does.
        await expect(
          emailLookupsWhenNotified({ projectId: PROJECT_A, userId: LEAVING }),
        ).resolves.toBe(0);
        await expect(
          emailLookupsWhenNotified({ projectId: PROJECT_B, userId: LEAVING }),
        ).resolves.toBe(1);

        // The pages that went out to them stay on the on-call history.
        await expect(pageHistoryOf(PROJECT_A, LEAVING)).resolves.toEqual(
          HISTORY_KEPT_WITHOUT_REFERENCES,
        );
        await expectHistoryStillPointsAtTheirRows(PROJECT_B, LEAVING);
        await expectHistoryStillPointsAtTheirRows(PROJECT_A, MEMBER);
        await expectHistoryStillPointsAtTheirRows(PROJECT_A, TWO_TEAMS);
      });

      test("if the on-call history cannot be kept, the rules and methods it points at stay and the rest still goes", async () => {
        jest.spyOn(logger, "error").mockImplementation(() => {
          return undefined as never;
        });
        jest
          .spyOn(ProjectLeaveNotificationCleanup, "keepHistory")
          .mockRejectedValue(new Error("history could not be updated"));

        await TeamMemberService.deleteOneById({
          id: new ObjectID(membershipIds["leaving-a1"]!),
          props: { isRoot: true },
        });

        const pointedAt: Set<string> = new Set<string>(
          ProjectLeaveNotificationCleanup.getHistoryReferences().map(
            (reference: HistoryReference): string => {
              return reference.references.getModel().tableName!;
            },
          ),
        );

        const expected: Dictionary<number> = {};

        for (const table of personalTableNames()) {
          expected[table] = pointedAt.has(table) ? 1 : 0;
        }

        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: LEAVING }),
        ).resolves.toEqual(expected);
        await expectHistoryStillPointsAtTheirRows(PROJECT_A, LEAVING);

        // And still nothing of PROJECT_A reaches them.
        await expect(
          emailLookupsWhenNotified({ projectId: PROJECT_A, userId: LEAVING }),
        ).resolves.toBe(0);
      });

      test("leaving one team while still in another of the project's teams removes nothing", async () => {
        await TeamMemberService.deleteOneById({
          id: new ObjectID(membershipIds["twoTeams-a1"]!),
          props: { isRoot: true },
        });

        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: TWO_TEAMS }),
        ).resolves.toEqual(everyTable(1));
        await expect(
          emailLookupsWhenNotified({ projectId: PROJECT_A, userId: TWO_TEAMS }),
        ).resolves.toBe(1);
      });

      test("removing every membership of the person at once (remove from project) cleans once", async () => {
        await insertMembership({
          key: "leaving-a2",
          userId: LEAVING,
          teamId: TEAM_A2,
          projectId: PROJECT_A,
          accepted: true,
        });

        await TeamMemberService.deleteBy({
          query: { projectId: PROJECT_A, userId: LEAVING },
          limit: 100,
          skip: 0,
          props: { isRoot: true },
        });

        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: LEAVING }),
        ).resolves.toEqual(everyTable(0));
        await expect(
          personalRowCounts({ projectId: PROJECT_B, userId: LEAVING }),
        ).resolves.toEqual(everyTable(1));
      });

      test("joining again starts clean: nothing from before comes back", async () => {
        await TeamMemberService.deleteOneById({
          id: new ObjectID(membershipIds["leaving-a1"]!),
          props: { isRoot: true },
        });

        await insertMembership({
          key: "leaving-a2",
          userId: LEAVING,
          teamId: TEAM_A2,
          projectId: PROJECT_A,
          accepted: true,
        });

        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: LEAVING }),
        ).resolves.toEqual(everyTable(0));
        await expect(
          emailLookupsWhenNotified({ projectId: PROJECT_A, userId: LEAVING }),
        ).resolves.toBe(0);

        // What happened before they left is still on the history.
        await expect(pageHistoryOf(PROJECT_A, LEAVING)).resolves.toEqual(
          HISTORY_KEPT_WITHOUT_REFERENCES,
        );
      });
    });

    describe("former members' leftovers (the data migration's walk)", () => {
      test("lists exactly the pairs holding settings without a membership, in key order, in one statement", async () => {
        const statements: jest.SpyInstance = jest.spyOn(database, "query");

        const all: Array<{ projectId: string; userId: string }> =
          await ProjectLeaveNotificationCleanup.getFormerMemberPairs();

        expect(statements).toHaveBeenCalledTimes(1);

        expect(
          all.map((row: { projectId: string; userId: string }) => {
            return { projectId: row.projectId, userId: row.userId };
          }),
        ).toEqual([
          { projectId: PROJECT_A.toString(), userId: LEAVER.toString() },
          { projectId: PROJECT_A.toString(), userId: PENDING.toString() },
          { projectId: PROJECT_A.toString(), userId: SOFT_DELETED.toString() },
        ]);
      });

      test("removes only former members' settings, keeps sent mail and the on-call history, and a second run finds nothing", async () => {
        const result: FormerMemberCleanupResult =
          await ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers();

        const tableCount: number = personalTableNames().length;

        expect(result).toEqual({
          cleanedPairCount: 3,
          removedRowCount: 3 * tableCount,
          failedPairCount: 0,
        });

        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: LEAVER }),
        ).resolves.toEqual(removedExceptSentMail(1));
        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: PENDING }),
        ).resolves.toEqual(everyTable(0));
        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: SOFT_DELETED }),
        ).resolves.toEqual(everyTable(0));

        // Members, and a former member's other project, untouched.
        for (const [projectId, userId] of [
          [PROJECT_A, MEMBER],
          [PROJECT_A, TWO_TEAMS],
          [PROJECT_B, LEAVER],
          [PROJECT_A, LEAVING],
          [PROJECT_B, LEAVING],
        ] as Array<[ObjectID, ObjectID]>) {
          await expect(
            personalRowCounts({ projectId, userId }),
          ).resolves.toEqual(everyTable(1));
        }

        // Mail already sent is history; so are the pages that went out.
        await expect(
          personalRowCounts({ projectId: PROJECT_A, userId: SENT_ONLY }),
        ).resolves.toEqual(removedExceptSentMail(1));

        for (const userId of [LEAVER, PENDING, SOFT_DELETED]) {
          await expect(pageHistoryOf(PROJECT_A, userId)).resolves.toEqual(
            HISTORY_KEPT_WITHOUT_REFERENCES,
          );
        }

        for (const [projectId, userId] of [
          [PROJECT_A, MEMBER],
          [PROJECT_B, LEAVER],
          [PROJECT_A, LEAVING],
        ] as Array<[ObjectID, ObjectID]>) {
          await expectHistoryStillPointsAtTheirRows(projectId, userId);
        }

        await expect(
          ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers(),
        ).resolves.toEqual({
          cleanedPairCount: 0,
          removedRowCount: 0,
          failedPairCount: 0,
        });
      });
    });

    describe("history pointing at personal settings", () => {
      test("every foreign key into a personal table is from another personal table or a history reference the cleanup clears", async () => {
        const rows: Array<{
          owner: string;
          column_name: string;
          target: string;
        }> = await database.query(
          `SELECT owner.relname AS owner, attribute.attname AS column_name, target.relname AS target
             FROM pg_constraint constraint_row
             JOIN pg_class owner ON owner.oid = constraint_row.conrelid
             JOIN pg_class target ON target.oid = constraint_row.confrelid
             JOIN pg_namespace namespace ON namespace.oid = target.relnamespace
             JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = ANY(constraint_row.conkey)
            WHERE constraint_row.contype = 'f'
              AND namespace.nspname = 'public'
              AND target.relname = ANY($1)`,
          [personalTableNames()],
        );

        const personal: Set<string> = new Set<string>(personalTableNames());

        const fromOutside: Array<string> = rows
          .filter((row: { owner: string }) => {
            return !personal.has(row.owner);
          })
          .map(
            (row: { owner: string; column_name: string; target: string }) => {
              return `${row.owner}.${row.column_name} -> ${row.target}`;
            },
          )
          .sort();

        expect(fromOutside).toEqual(
          ProjectLeaveNotificationCleanup.getHistoryReferences()
            .map((reference: HistoryReference): string => {
              return `${reference.history.getModel().tableName}.${
                reference.column
              } -> ${reference.references.getModel().tableName}`;
            })
            .sort(),
        );
      });
    });

    describe("account and project deletion", () => {
      test("every personal notification table goes with its user and its project (foreign keys cascade)", async () => {
        const rows: Array<{
          table_name: string;
          column_name: string;
          on_delete: string;
        }> = await database.query(
          `SELECT owner.relname AS table_name, attribute.attname AS column_name, constraint_row.confdeltype AS on_delete
             FROM pg_constraint constraint_row
             JOIN pg_class owner ON owner.oid = constraint_row.conrelid
             JOIN pg_namespace namespace ON namespace.oid = owner.relnamespace
             JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = ANY(constraint_row.conkey)
            WHERE constraint_row.contype = 'f'
              AND namespace.nspname = 'public'
              AND owner.relname = ANY($1)
              AND attribute.attname IN ('userId', 'projectId')`,
          [personalTableNames()],
        );

        for (const table of personalTableNames()) {
          for (const column of ["userId", "projectId"]) {
            expect({
              table,
              column,
              onDelete: rows
                .filter((row: { table_name: string; column_name: string }) => {
                  return row.table_name === table && row.column_name === column;
                })
                .map((row: { on_delete: string }) => {
                  return row.on_delete;
                }),
            }).toEqual({ table, column, onDelete: ["c"] });
          }
        }
      });
    });
  },
);
