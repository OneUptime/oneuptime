import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import BaseAPI from "../../../Server/API/BaseAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Select from "../../../Server/Types/Database/Select";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * The handler receives an already-authenticated request and uses a dedicated
 * DataSource below. Avoid loading unrelated login, billing, and boot-migration
 * services; no permission check, repository operation, or serializer is mocked.
 */
jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return { getUserMiddleware: jest.fn() };
});
jest.mock("../../../Server/Services/ProjectService", () => {
  return { getCurrentPlan: jest.fn() };
});
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

/*
 * Opt in with RUN_POSTGRES_TEAM_MEMBER_PERMISSION_TESTS=true and config.env.
 * Only table definitions are copied from public. Every row is synthetic and
 * every read/write is directed to an isolated schema that is removed below.
 * The permission pipeline, request-header translation, TypeORM joins, and
 * response serialization run unchanged.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TEAM_MEMBER_PERMISSION_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres(
  "multi-tenant team-member read authorization against Postgres",
  () => {
    const schema: string = `team_member_permission_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
    const userId: ObjectID = ObjectID.generate();
    const otherUserId: ObjectID = ObjectID.generate();
    const inviterId: ObjectID = ObjectID.generate();
    const firstProjectId: ObjectID = ObjectID.generate();
    const secondProjectId: ObjectID = ObjectID.generate();
    const firstTeamId: ObjectID = ObjectID.generate();
    const secondTeamId: ObjectID = ObjectID.generate();
    const firstInvitationId: ObjectID = ObjectID.generate();
    const secondInvitationId: ObjectID = ObjectID.generate();
    const otherInvitationId: ObjectID = ObjectID.generate();
    const acceptedMembershipId: ObjectID = ObjectID.generate();
    const passwordHash: string = "synthetic-inviter-password-hash";
    const resetToken: string = "synthetic-inviter-reset-token";
    const privateTeamDescription: string = "Synthetic private team description";
    const service: DatabaseService<TeamMember> = new DatabaseService(
      TeamMember,
    );
    const api: BaseAPI<TeamMember, DatabaseService<TeamMember>> = new BaseAPI(
      TeamMember,
      service,
    );
    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["TEAM_MEMBER_PERMISSION_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["TEAM_MEMBER_PERMISSION_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database: process.env["DATABASE_NAME"] || "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      for (const table of ["User", "Project", "Team", "TeamMember"]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const id of [userId, otherUserId, inviterId]) {
        await database.query(
          `INSERT INTO "${schema}"."User"
         ("_id", "name", "email", "slug", "password", "resetPasswordToken", "version")
         VALUES ($1, 'Synthetic User', $2, $3, $4, $5, 1)`,
          [
            id.toString(),
            `${id.toString()}@example.com`,
            id.toString(),
            passwordHash,
            resetToken,
          ],
        );
      }
      for (const [projectId, teamId, projectName, teamName] of [
        [
          firstProjectId,
          firstTeamId,
          "First invitation project",
          "First invitation team",
        ],
        [
          secondProjectId,
          secondTeamId,
          "Second invitation project",
          "Second invitation team",
        ],
      ] as Array<[ObjectID, ObjectID, string, string]>) {
        await database.query(
          `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version") VALUES ($1, $2, $3, 1)`,
          [projectId.toString(), projectName, projectId.toString()],
        );
        await database.query(
          `INSERT INTO "${schema}"."Team" ("_id", "projectId", "name", "slug", "description", "version")
         VALUES ($1, $2, $3, $4, $5, 1)`,
          [
            teamId.toString(),
            projectId.toString(),
            teamName,
            teamId.toString(),
            privateTeamDescription,
          ],
        );
      }
      for (const [id, memberId, projectId, teamId, accepted] of [
        [firstInvitationId, userId, firstProjectId, firstTeamId, false],
        [secondInvitationId, userId, secondProjectId, secondTeamId, false],
        [otherInvitationId, otherUserId, firstProjectId, firstTeamId, false],
        [acceptedMembershipId, userId, firstProjectId, firstTeamId, true],
      ] as Array<[ObjectID, ObjectID, ObjectID, ObjectID, boolean]>) {
        await database.query(
          `INSERT INTO "${schema}"."TeamMember"
         ("_id", "userId", "projectId", "teamId", "createdByUserId", "hasAcceptedInvitation", "version")
         VALUES ($1, $2, $3, $4, $5, $6, 1)`,
          [
            id.toString(),
            memberId.toString(),
            projectId.toString(),
            teamId.toString(),
            inviterId.toString(),
            accepted,
          ],
        );
      }
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    function props(
      isMultiTenantRequest: boolean = true,
    ): DatabaseCommonInteractionProps {
      return {
        userId,
        userType: UserType.User,
        isMultiTenantRequest,
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          globalPermissions: [Permission.User, Permission.CurrentUser],
          // An invited user may not belong to any project yet.
          projectIds: [],
        },
      };
    }

    function safeSelect(): Select<TeamMember> {
      return {
        _id: true,
        userId: true,
        hasAcceptedInvitation: true,
        team: { name: true },
        project: { name: true },
      };
    }

    async function getList(data: {
      select: Select<TeamMember>;
      query?: JSONObject;
      isMultiTenantRequest?: boolean;
    }): Promise<JSONObject> {
      const requestProps: DatabaseCommonInteractionProps = props();
      const req: OneUptimeRequest = {
        headers:
          data.isMultiTenantRequest === false
            ? {}
            : { "is-multi-tenant-query": "true" },
        query: {},
        body: JSONFunctions.serialize({
          query: data.query || {},
          select: data.select,
          limit: 20,
        }),
        userAuthorization: { userId },
        userGlobalAccessPermission: requestProps.userGlobalAccessPermission,
        userType: UserType.User,
      } as unknown as OneUptimeRequest;
      let body: JSONObject | undefined;
      const res: ExpressResponse = {
        status: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        send: jest.fn((responseBody: JSONObject) => {
          // Express serializes ListData and its database property wrappers.
          body = JSON.parse(JSON.stringify(responseBody)) as JSONObject;
        }),
      } as unknown as ExpressResponse;
      await api.getList(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(body).toBeDefined();
      return body as JSONObject;
    }

    test("the privileged control reaches synthetic inviter secrets through the real join and serializer", async () => {
      const records: Array<TeamMember> = await service.findBy({
        query: { _id: firstInvitationId.toString() },
        select: { createdByUser: { password: true, resetPasswordToken: true } },
        skip: 0,
        limit: 1,
        props: { isRoot: true },
      });
      expect(records).toHaveLength(1);
      const serialized: string = JSON.stringify(
        BaseModel.toJSONArray(records, TeamMember),
      );
      expect(serialized).toContain(passwordHash);
      expect(serialized).toContain(resetToken);
    });

    test.each([
      [
        "inviter password hash",
        { createdByUser: { password: true } },
        "permissions to select on - createdByUser",
      ],
      [
        "inviter password reset token",
        { createdByUser: { resetPasswordToken: true } },
        "permissions to select on - createdByUser",
      ],
      [
        "restricted team field",
        { team: { description: true } },
        "Column description on Team does not support read on relation query",
      ],
      [
        "restricted user relation",
        { user: { password: true } },
        "permissions to select on - user",
      ],
      [
        "deep relation",
        { team: { createdByUser: { password: true } } },
        "You cannot query deep relations",
      ],
    ] as Array<[string, Select<TeamMember>, string]>)(
      "rejects a multi-tenant API selection of %s",
      async (
        _label: string,
        select: Select<TeamMember>,
        expectedError: string,
      ) => {
        await expect(getList({ select })).rejects.toThrow(expectedError);
      },
    );

    test("the same nested credential projection is already denied without the multi-tenant header", async () => {
      await expect(
        getList({
          select: {
            createdByUser: { password: true, resetPasswordToken: true },
          },
          isMultiTenantRequest: false,
        }),
      ).rejects.toThrow("permissions to select on - createdByUser");
    });

    test.each([true, false])(
      "lists pending invitations and their safe labels with no project memberships (multi-tenant=%s)",
      async (isMultiTenantRequest: boolean) => {
        const response: JSONObject = await getList({
          select: safeSelect(),
          query: { hasAcceptedInvitation: false },
          isMultiTenantRequest,
        });
        expect(response["count"]).toBe(2);
        const rows: Array<JSONObject> = response["data"] as Array<JSONObject>;
        expect(rows).toHaveLength(2);
        expect(
          rows
            .map((row: JSONObject) => {
              return row["_id"];
            })
            .sort(),
        ).toEqual(
          [firstInvitationId.toString(), secondInvitationId.toString()].sort(),
        );
        const serialized: string = JSON.stringify(response);
        expect(serialized).toContain("First invitation project");
        expect(serialized).toContain("Second invitation project");
        expect(serialized).toContain("First invitation team");
        expect(serialized).toContain("Second invitation team");
        expect(serialized).not.toContain(otherInvitationId.toString());
        expect(serialized).not.toContain(passwordHash);
        expect(serialized).not.toContain(resetToken);
        expect(serialized).not.toContain(privateTeamDescription);
      },
    );

    test("caller filters remain effective for both list and count", async () => {
      const response: JSONObject = await getList({
        select: safeSelect(),
        query: { projectId: secondProjectId, hasAcceptedInvitation: false },
      });
      expect(response["count"]).toBe(1);
      expect(response["data"]).toHaveLength(1);
      expect(JSON.stringify(response)).toContain(secondInvitationId.toString());
      expect(JSON.stringify(response)).not.toContain(
        firstInvitationId.toString(),
      );
    });

    test("count authorization rejects predicates on forbidden columns", async () => {
      await expect(
        service.countBy({
          query: { createdByUserId: inviterId },
          props: props(),
        }),
      ).rejects.toThrow("permissions to query on - createdByUserId");
    });

    test("safe counts are restricted to the current user's rows", async () => {
      expect(
        (await service.countBy({ query: {}, props: props() })).toNumber(),
      ).toBe(3);
      expect(
        (
          await service.countBy({
            query: { hasAcceptedInvitation: false },
            props: props(),
          })
        ).toNumber(),
      ).toBe(2);
      expect(
        (
          await service.countBy({ query: {}, props: { isRoot: true } })
        ).toNumber(),
      ).toBe(4);
    });

    test("a caller cannot redirect the current-user scope to another member", async () => {
      await expect(
        getList({ select: safeSelect(), query: { userId: otherUserId } }),
      ).rejects.toThrow("permission to access another user's Team Member");
      await expect(
        service.countBy({ query: { userId: otherUserId }, props: props() }),
      ).rejects.toThrow("permission to access another user's Team Member");
    });

    test("an explicit foreign membership ID returns no row and a zero count", async () => {
      const response: JSONObject = await getList({
        select: safeSelect(),
        query: { _id: otherInvitationId.toString() },
      });
      expect(response["data"]).toEqual([]);
      expect(response["count"]).toBe(0);
    });
  },
);
