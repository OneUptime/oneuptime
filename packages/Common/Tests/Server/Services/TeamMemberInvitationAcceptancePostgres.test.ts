import Entities from "../../../Models/DatabaseModels/Index";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import MailService from "../../../Server/Services/MailService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import Errors from "../../../Server/Utils/Errors";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EmailMessage from "../../../Types/Email/EmailMessage";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { DataSource } from "typeorm";

/*
 * Acceptance is per project, not per team - end to end, against a real,
 * migrated TeamMember table.
 *
 * The unit suite (TeamMemberProjectInvitationAcceptance.test.ts) pins each
 * decision with the reads and writes faked. What only a database can show is
 * that the rows come out right when the real create and update pipelines run
 * the real queries: that "is this person in the project" counts accepted
 * memberships of this project and nothing else, that accepting one invitation
 * accepts exactly that person's other invitations in that project - not
 * another project's, not another person's - and that it has done so by the
 * time their permissions are refreshed. The invitations are created by a
 * project admin's request and accepted by the invitee's own request, through
 * the same permission checks the API applies. It also runs the backfill the
 * data migration uses for invitations left over from before.
 *
 * Opt in with RUN_POSTGRES_TEAM_INVITATION_ACCEPTANCE_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The TeamMember, Team and
 * User tables' STRUCTURE is cloned into a unique schema (its search_path
 * holds that schema first) that is dropped afterwards; every row is
 * synthetic. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database
 * from TEAM_INVITATION_ACCEPTANCE_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from TEAM_INVITATION_ACCEPTANCE_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TEAM_INVITATION_ACCEPTANCE_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = new ObjectID(
  "a1111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "a2222222-2222-4222-8222-222222222222",
);

// Teams of PROJECT_ID.
const OPERATIONS_TEAM_ID: ObjectID = new ObjectID(
  "b1111111-1111-4111-8111-111111111111",
);
const DATABASE_TEAM_ID: ObjectID = new ObjectID(
  "b2222222-2222-4222-8222-222222222222",
);
const ON_CALL_TEAM_ID: ObjectID = new ObjectID(
  "b3333333-3333-4333-8333-333333333333",
);
// A team of OTHER_PROJECT_ID.
const OTHER_PROJECT_TEAM_ID: ObjectID = new ObjectID(
  "b4444444-4444-4444-8444-444444444444",
);

const ADMIN_ID: ObjectID = new ObjectID("c0000000-0000-4000-8000-000000000000");
const ALICE_ID: ObjectID = new ObjectID("c1111111-1111-4111-8111-111111111111");
const BOB_ID: ObjectID = new ObjectID("c2222222-2222-4222-8222-222222222222");

const ALICE_EMAIL: string = "alice@acme.test";
const PROJECT_NAME: string = "Acme Production";

// Long before any test runs, so a row the code re-stamped is easy to tell.
const LONG_AGO: Date = new Date("2020-01-01T00:00:00.000Z");

type MembershipRow = {
  _id: string;
  userId: string;
  teamId: string;
  projectId: string;
  hasAcceptedInvitation: boolean;
  invitationAcceptedAt: Date | null;
};

/* A project admin's request from the dashboard of PROJECT_ID. */
function projectAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: ADMIN_ID,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectAdmin,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  } as DatabaseCommonInteractionProps;
}

/*
 * The invitee's own request from the invitations list: not scoped to any one
 * project (they may not be in one yet), so a multi-tenant request carrying
 * only the permissions every signed-in user has.
 */
function inviteeProps(userId: ObjectID): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    isMultiTenantRequest: true,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    },
  } as DatabaseCommonInteractionProps;
}

describePostgres(
  "project invitations are accepted once per project, against Postgres",
  () => {
    const schema: string = `team_invite_accept_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;

    /*
     * Accepted team ids of the person, read at the moment their permissions
     * in the project are refreshed - what that refresh would put in the cache.
     */
    let teamsSeenByRefresh: Array<Array<string>> = [];
    let sendMailSpy: jest.SpyInstance;

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

    async function insertUser(data: {
      id: ObjectID;
      email: string;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."User" ("_id", "version", "email", "name", "password", "isEmailVerified") VALUES ($1, 1, $2, $3, $4, true)`,
        [
          data.id.toString(),
          data.email,
          data.email.split("@")[0],
          "already-registered",
        ],
      );
    }

    async function insertTeam(data: {
      id: ObjectID;
      projectId: ObjectID;
      name: string;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."Team" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, $3, $4)`,
        [
          data.id.toString(),
          data.projectId.toString(),
          data.name,
          `${data.name.toLowerCase().replace(/\s+/g, "-")}-${data.id.toString()}`,
        ],
      );
    }

    // A membership as it exists today, written directly.
    async function insertMembership(data: {
      userId: ObjectID;
      teamId: ObjectID;
      projectId: ObjectID;
      accepted: boolean;
    }): Promise<string> {
      const id: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "${schema}"."TeamMember" ("_id", "version", "userId", "teamId", "projectId", "hasAcceptedInvitation", "invitationAcceptedAt") VALUES ($1, 1, $2, $3, $4, $5, $6)`,
        [
          id,
          data.userId.toString(),
          data.teamId.toString(),
          data.projectId.toString(),
          data.accepted,
          data.accepted ? LONG_AGO : null,
        ],
      );

      return id;
    }

    async function memberships(
      userId: ObjectID,
    ): Promise<Array<MembershipRow>> {
      return await database.query(
        `SELECT "_id"::text AS "_id", "userId"::text AS "userId", "teamId"::text AS "teamId", "projectId"::text AS "projectId", "hasAcceptedInvitation", "invitationAcceptedAt"
           FROM "${schema}"."TeamMember"
          WHERE "userId" = $1
          ORDER BY "projectId", "teamId"`,
        [userId.toString()],
      );
    }

    async function membership(data: {
      userId: ObjectID;
      teamId: ObjectID;
    }): Promise<MembershipRow> {
      const rows: Array<MembershipRow> = (
        await memberships(data.userId)
      ).filter((row: MembershipRow): boolean => {
        return row.teamId === data.teamId.toString();
      });

      expect(rows).toHaveLength(1);

      return rows[0]!;
    }

    async function pendingInvitations(userId: ObjectID): Promise<number> {
      return (await memberships(userId)).filter((row: MembershipRow) => {
        return !row.hasAcceptedInvitation;
      }).length;
    }

    async function countMemberships(): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*)::text AS count FROM "${schema}"."TeamMember"`,
      );

      return Number(rows[0]!.count);
    }

    // A project admin adds somebody to a team, as Team > Members does.
    async function addToTeam(data: {
      teamId: ObjectID;
      userId?: ObjectID | undefined;
      email?: string | undefined;
      props?: DatabaseCommonInteractionProps | undefined;
      hasAcceptedInvitation?: boolean | undefined;
    }): Promise<TeamMember> {
      const member: TeamMember = new TeamMember();
      member.projectId = PROJECT_ID;
      member.teamId = data.teamId;

      if (data.userId) {
        member.userId = data.userId;
      }

      if (data.hasAcceptedInvitation !== undefined) {
        member.hasAcceptedInvitation = data.hasAcceptedInvitation;
      }

      return await TeamMemberService.create({
        data: member,
        props: data.props || projectAdminProps(),
        ...(data.email ? { miscDataProps: { email: data.email } } : {}),
      });
    }

    // The invitee presses Accept on one row of their invitations list.
    async function acceptInvitation(data: {
      membershipId: string;
      userId: ObjectID;
    }): Promise<number> {
      return await TeamMemberService.updateOneById({
        id: new ObjectID(data.membershipId),
        data: {
          hasAcceptedInvitation: true,
          invitationAcceptedAt: new Date(),
        },
        props: inviteeProps(data.userId),
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["TEAM_INVITATION_ACCEPTANCE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["TEAM_INVITATION_ACCEPTANCE_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TEAM_INVITATION_ACCEPTANCE_TEST_DATABASE_NAME"] ||
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
      await cloneTable("User", { keepNotNull: false });

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

      // Workflows and realtime events are not what this is about.
      jest
        .spyOn(TeamMemberService, "onTriggerWorkflow")
        .mockResolvedValue(undefined);
      jest
        .spyOn(TeamMemberService, "onTriggerRealtime")
        .mockResolvedValue(undefined);

      // The delegation ceiling and the SCIM lock have suites of their own.
      jest
        .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
        .mockResolvedValue(undefined);
      jest
        .spyOn(ProjectSCIMService, "countBy")
        .mockResolvedValue(new PositiveNumber(0));

      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue({ name: PROJECT_NAME } as Project);
      sendMailSpy = jest
        .spyOn(MailService, "sendMail")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(
          UserNotificationSettingService,
          "addDefaultNotificationSettingsForUser",
        )
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(UserNotificationRuleService, "addDefaultNotificationRuleForUser")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(
          TeamMemberService,
          "updateSubscriptionSeatsByUniqueTeamMembersInProject",
        )
        .mockResolvedValue(undefined);
      jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);

      /*
       * The permission cache lives in Redis. Record instead what the refresh
       * would read: the person's accepted teams in the project, right then.
       */
      teamsSeenByRefresh = [];
      jest
        .spyOn(AccessTokenService, "refreshUserGlobalAccessPermission")
        .mockResolvedValue({
          _type: "UserGlobalAccessPermission",
          projectIds: [],
          globalPermissions: [],
        });
      jest
        .spyOn(AccessTokenService, "refreshUserTenantAccessPermission")
        .mockImplementation(
          async (userId: ObjectID, projectId: ObjectID): Promise<null> => {
            const rows: Array<{ teamId: string }> = await database.query(
              `SELECT "teamId"::text AS "teamId" FROM "${schema}"."TeamMember"
              WHERE "userId" = $1 AND "projectId" = $2 AND "hasAcceptedInvitation" = true
              ORDER BY "teamId"`,
              [userId.toString(), projectId.toString()],
            );

            teamsSeenByRefresh.push(
              rows.map((row: { teamId: string }): string => {
                return row.teamId;
              }),
            );

            return null;
          },
        );

      await database.query(`DELETE FROM "${schema}"."TeamMember"`);
      await database.query(`DELETE FROM "${schema}"."Team"`);
      await database.query(`DELETE FROM "${schema}"."User"`);

      await insertUser({ id: ALICE_ID, email: ALICE_EMAIL });
      await insertUser({ id: BOB_ID, email: "bob@acme.test" });
      await insertTeam({
        id: OPERATIONS_TEAM_ID,
        projectId: PROJECT_ID,
        name: "Operations",
      });
      await insertTeam({
        id: DATABASE_TEAM_ID,
        projectId: PROJECT_ID,
        name: "Database",
      });
      await insertTeam({
        id: ON_CALL_TEAM_ID,
        projectId: PROJECT_ID,
        name: "On Call",
      });
      await insertTeam({
        id: OTHER_PROJECT_TEAM_ID,
        projectId: OTHER_PROJECT_ID,
        name: "Elsewhere",
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("adding somebody who is already in the project", () => {
      test("a project admin adds a member to another team, and they are on it at once", async () => {
        await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: true,
        });

        const before: Date = new Date();
        await addToTeam({ teamId: DATABASE_TEAM_ID, userId: ALICE_ID });

        const added: MembershipRow = await membership({
          userId: ALICE_ID,
          teamId: DATABASE_TEAM_ID,
        });

        expect(added.hasAcceptedInvitation).toBe(true);
        expect(added.invitationAcceptedAt).not.toBeNull();
        expect(
          new Date(added.invitationAcceptedAt!).getTime(),
        ).toBeGreaterThanOrEqual(before.getTime() - 1000);
        expect(await pendingInvitations(ALICE_ID)).toBe(0);
      });

      test("their permissions are refreshed with the new team in them", async () => {
        await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: true,
        });

        await addToTeam({ teamId: DATABASE_TEAM_ID, userId: ALICE_ID });

        expect(teamsSeenByRefresh[teamsSeenByRefresh.length - 1]).toEqual(
          [OPERATIONS_TEAM_ID.toString(), DATABASE_TEAM_ID.toString()].sort(),
        );
      });

      test("added by email, they are told they were added rather than invited", async () => {
        await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: true,
        });

        await addToTeam({ teamId: ON_CALL_TEAM_ID, email: ALICE_EMAIL });

        const added: MembershipRow = await membership({
          userId: ALICE_ID,
          teamId: ON_CALL_TEAM_ID,
        });
        expect(added.hasAcceptedInvitation).toBe(true);

        expect(sendMailSpy).toHaveBeenCalledTimes(1);
        const mail: EmailMessage = sendMailSpy.mock.calls[0]![0];
        expect(mail.subject).toBe(`You have been added to ${PROJECT_NAME}`);
        expect(mail.vars["isInvitationAccepted"]).toBe("true");
      });

      test("adding them to a team they are already on is refused, and writes and sends nothing", async () => {
        await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: true,
        });

        await expect(
          addToTeam({ teamId: OPERATIONS_TEAM_ID, email: ALICE_EMAIL }),
        ).rejects.toThrow(Errors.TeamMemberService.ALREADY_INVITED);

        expect(await countMemberships()).toBe(1);
        expect(sendMailSpy).not.toHaveBeenCalled();
      });
    });

    describe("somebody who is not in the project yet", () => {
      test("being a member of a different project does not make them one of this", async () => {
        await insertMembership({
          userId: ALICE_ID,
          teamId: OTHER_PROJECT_TEAM_ID,
          projectId: OTHER_PROJECT_ID,
          accepted: true,
        });

        await addToTeam({ teamId: DATABASE_TEAM_ID, userId: ALICE_ID });

        expect(
          (await membership({ userId: ALICE_ID, teamId: DATABASE_TEAM_ID }))
            .hasAcceptedInvitation,
        ).toBe(false);
      });

      test("an invitation to another team of the project is still only an invitation", async () => {
        await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });

        await addToTeam({ teamId: DATABASE_TEAM_ID, userId: ALICE_ID });

        expect(await pendingInvitations(ALICE_ID)).toBe(2);
        expect(
          await TeamMemberService.isUserMemberOfProject({
            projectId: PROJECT_ID,
            userId: ALICE_ID,
          }),
        ).toBe(false);
      });

      test("a project admin who asks for the invitation to be accepted is refused that", async () => {
        await addToTeam({
          teamId: DATABASE_TEAM_ID,
          userId: ALICE_ID,
          hasAcceptedInvitation: true,
        });

        const invited: MembershipRow = await membership({
          userId: ALICE_ID,
          teamId: DATABASE_TEAM_ID,
        });

        expect(invited.hasAcceptedInvitation).toBe(false);
        expect(invited.invitationAcceptedAt).toBeNull();
      });
    });

    describe("accepting an invitation", () => {
      test("accepting one team's invitation accepts the rest of the project's", async () => {
        /*
         * The per-team Project Invitations page: Alice was invited to two
         * teams of the project and presses Accept on one row.
         */
        const operations: string = await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });
        await insertMembership({
          userId: ALICE_ID,
          teamId: DATABASE_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });

        await expect(
          acceptInvitation({ membershipId: operations, userId: ALICE_ID }),
        ).resolves.toBe(1);

        expect(await pendingInvitations(ALICE_ID)).toBe(0);

        const databaseTeam: MembershipRow = await membership({
          userId: ALICE_ID,
          teamId: DATABASE_TEAM_ID,
        });
        expect(databaseTeam.invitationAcceptedAt).not.toBeNull();
      });

      test("by the time their permissions are refreshed, every team of the project is in", async () => {
        const operations: string = await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });
        await insertMembership({
          userId: ALICE_ID,
          teamId: DATABASE_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });

        await acceptInvitation({ membershipId: operations, userId: ALICE_ID });

        expect(teamsSeenByRefresh.length).toBeGreaterThan(0);
        expect(teamsSeenByRefresh[0]).toEqual(
          [OPERATIONS_TEAM_ID.toString(), DATABASE_TEAM_ID.toString()].sort(),
        );
      });

      test("it leaves the person's invitations to other projects, and other people's, alone", async () => {
        const operations: string = await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });
        await insertMembership({
          userId: ALICE_ID,
          teamId: OTHER_PROJECT_TEAM_ID,
          projectId: OTHER_PROJECT_ID,
          accepted: false,
        });
        await insertMembership({
          userId: BOB_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });
        await insertMembership({
          userId: BOB_ID,
          teamId: DATABASE_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });

        await acceptInvitation({ membershipId: operations, userId: ALICE_ID });

        expect(
          (await membership({ userId: ALICE_ID, teamId: OPERATIONS_TEAM_ID }))
            .hasAcceptedInvitation,
        ).toBe(true);
        expect(
          (
            await membership({
              userId: ALICE_ID,
              teamId: OTHER_PROJECT_TEAM_ID,
            })
          ).hasAcceptedInvitation,
        ).toBe(false);
        expect(await pendingInvitations(BOB_ID)).toBe(2);
      });

      test("nobody can accept somebody else's invitation through it", async () => {
        const bobs: string = await insertMembership({
          userId: BOB_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });
        await insertMembership({
          userId: BOB_ID,
          teamId: DATABASE_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });

        /*
         * Alice's own request names Bob's invitation. The current-user scope
         * matches no row, so nothing is accepted - and nothing cascades.
         */
        await expect(
          acceptInvitation({ membershipId: bobs, userId: ALICE_ID }),
        ).resolves.toBe(0);

        expect(await pendingInvitations(BOB_ID)).toBe(2);
      });

      test("a membership created accepted accepts the person's pending invitations in the project", async () => {
        /*
         * SSO, SCIM and a master admin's "accept automatically" create the
         * membership already accepted. The person is in the project from
         * then on, so what they were invited to there is accepted too.
         */
        await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });
        await insertMembership({
          userId: ALICE_ID,
          teamId: DATABASE_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });

        await addToTeam({
          teamId: ON_CALL_TEAM_ID,
          userId: ALICE_ID,
          hasAcceptedInvitation: true,
          props: { isRoot: true },
        });

        expect(await pendingInvitations(ALICE_ID)).toBe(0);
        expect(await memberships(ALICE_ID)).toHaveLength(3);
      });
    });

    describe("TeamMemberService.acceptPendingInvitationsInProject", () => {
      test("accepts each pending invitation once, reports how many, and keeps accepted rows as they were", async () => {
        await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: true,
        });
        await insertMembership({
          userId: ALICE_ID,
          teamId: DATABASE_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });
        await insertMembership({
          userId: ALICE_ID,
          teamId: ON_CALL_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });

        await expect(
          TeamMemberService.acceptPendingInvitationsInProject({
            userId: ALICE_ID,
            projectId: PROJECT_ID,
          }),
        ).resolves.toBe(2);

        await expect(
          TeamMemberService.acceptPendingInvitationsInProject({
            userId: ALICE_ID,
            projectId: PROJECT_ID,
          }),
        ).resolves.toBe(0);

        expect(await pendingInvitations(ALICE_ID)).toBe(0);
        expect(
          new Date(
            (
              await membership({
                userId: ALICE_ID,
                teamId: OPERATIONS_TEAM_ID,
              })
            ).invitationAcceptedAt!,
          ).toISOString(),
        ).toBe(LONG_AGO.toISOString());
      });
    });

    describe("TeamMemberService.acceptPendingInvitationsOfProjectMembers (the data migration)", () => {
      test("accepts the invitations of people already in that project, and only those", async () => {
        // Alice joined the project; her later team invitations were left pending.
        await insertMembership({
          userId: ALICE_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: true,
        });
        await insertMembership({
          userId: ALICE_ID,
          teamId: DATABASE_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });
        await insertMembership({
          userId: ALICE_ID,
          teamId: ON_CALL_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });
        // ...but she never joined the other project she was invited to.
        await insertMembership({
          userId: ALICE_ID,
          teamId: OTHER_PROJECT_TEAM_ID,
          projectId: OTHER_PROJECT_ID,
          accepted: false,
        });
        // Bob has only ever been invited.
        await insertMembership({
          userId: BOB_ID,
          teamId: OPERATIONS_TEAM_ID,
          projectId: PROJECT_ID,
          accepted: false,
        });

        await expect(
          TeamMemberService.acceptPendingInvitationsOfProjectMembers(),
        ).resolves.toBe(2);

        const alice: Array<MembershipRow> = await memberships(ALICE_ID);
        expect(
          alice
            .filter((row: MembershipRow) => {
              return row.projectId === PROJECT_ID.toString();
            })
            .every((row: MembershipRow) => {
              return row.hasAcceptedInvitation;
            }),
        ).toBe(true);
        expect(
          (
            await membership({
              userId: ALICE_ID,
              teamId: OTHER_PROJECT_TEAM_ID,
            })
          ).hasAcceptedInvitation,
        ).toBe(false);
        expect(await pendingInvitations(BOB_ID)).toBe(1);

        // Her permissions in the project are refreshed with every team in.
        expect(teamsSeenByRefresh).toEqual([
          [
            OPERATIONS_TEAM_ID.toString(),
            DATABASE_TEAM_ID.toString(),
            ON_CALL_TEAM_ID.toString(),
          ].sort(),
        ]);
      });

      test("walks every pair however small the batch, and a second run finds nothing", async () => {
        for (const userId of [ALICE_ID, BOB_ID]) {
          await insertMembership({
            userId: userId,
            teamId: OPERATIONS_TEAM_ID,
            projectId: PROJECT_ID,
            accepted: true,
          });
          await insertMembership({
            userId: userId,
            teamId: DATABASE_TEAM_ID,
            projectId: PROJECT_ID,
            accepted: false,
          });
          await insertMembership({
            userId: userId,
            teamId: OTHER_PROJECT_TEAM_ID,
            projectId: OTHER_PROJECT_ID,
            accepted: true,
          });
        }

        // Each project's other team, pending: a second pair per person.
        await insertTeam({
          id: new ObjectID("b5555555-5555-4555-8555-555555555555"),
          projectId: OTHER_PROJECT_ID,
          name: "Elsewhere Too",
        });
        for (const userId of [ALICE_ID, BOB_ID]) {
          await insertMembership({
            userId: userId,
            teamId: new ObjectID("b5555555-5555-4555-8555-555555555555"),
            projectId: OTHER_PROJECT_ID,
            accepted: false,
          });
        }

        await expect(
          TeamMemberService.acceptPendingInvitationsOfProjectMembers({
            batchSize: 1,
          }),
        ).resolves.toBe(4);

        expect(await pendingInvitations(ALICE_ID)).toBe(0);
        expect(await pendingInvitations(BOB_ID)).toBe(0);
        expect(teamsSeenByRefresh).toHaveLength(4);

        await expect(
          TeamMemberService.acceptPendingInvitationsOfProjectMembers({
            batchSize: 1,
          }),
        ).resolves.toBe(0);
      });
    });
  },
);
