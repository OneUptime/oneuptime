import Incident from "../../../../../Models/DatabaseModels/Incident";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import { CheckReadPermissionType } from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotEqual from "../../../../../Types/BaseDatabase/NotEqual";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { FindOperator } from "typeorm";

/*
 * These permission checks never connect to Postgres. Avoid loading the app's
 * entire startup migration registry while retaining the real permission code.
 */
jest.mock(
  "../../../../../Server/Infrastructure/Postgres/DataSourceOptions",
  () => {
    return { __esModule: true, default: {} };
  },
);

const userId: ObjectID = ObjectID.generate();
const otherUserId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

function makeProps(
  isMultiTenantRequest: boolean,
  withProject: boolean = false,
): DatabaseCommonInteractionProps {
  return {
    userId,
    isMultiTenantRequest,
    userGlobalAccessPermission: {
      projectIds: withProject ? [projectId] : [],
      globalPermissions: [Permission.Public, Permission.CurrentUser],
      _type: "UserGlobalAccessPermission",
    },
    ...(withProject
      ? {
          tenantId: projectId,
          userTenantAccessPermission: {
            [projectId.toString()]: {
              projectId,
              permissions: [
                {
                  permission: Permission.ProjectMember,
                  labelIds: [],
                  isBlockPermission: false,
                  _type: "UserPermission" as const,
                },
              ],
              _type: "UserTenantAccessPermission" as const,
            },
          },
        }
      : {}),
  };
}

/*
 * Assert the effective SQL predicate, including its bound value. An own-row
 * query must remain an equality after the permission pipeline serializes it.
 */
function expectExactScope(value: unknown, id: ObjectID): void {
  expect(value).toBeInstanceOf(FindOperator);
  const predicate: FindOperator<unknown> = value as FindOperator<unknown>;
  const parameters: Record<string, unknown> =
    predicate.objectLiteralParameters || {};
  expect(Object.values(parameters)).toEqual([id.toString()]);
  expect(predicate.getSql?.("scope_column")).toBe(
    `(scope_column = :${Object.keys(parameters)[0]})`,
  );
}

function invitationSelect(): Select<TeamMember> {
  // The actual pending-invitation UI must work before a user joins a project.
  return {
    _id: true,
    createdAt: true,
    projectId: true,
    project: { _id: true, name: true },
    teamId: true,
    team: { _id: true, name: true },
  };
}

describe.each([false, true])(
  "TeamMember read authorization with isMultiTenantRequest=%s",
  (isMultiTenantRequest: boolean) => {
    it.each(["password", "passwordSalt", "resetPasswordToken"])(
      "rejects a creator relation exposing %s for a user with no projects",
      async (secretColumn: string) => {
        await expect(
          ModelPermission.checkReadQueryPermission(
            TeamMember,
            {},
            { createdByUser: { [secretColumn]: true } },
            makeProps(isMultiTenantRequest),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      },
    );

    it.each(["createdByUserId", "deletedByUserId", "invitationAcceptedAt"])(
      "rejects the forbidden top-level select %s",
      async (column: string) => {
        await expect(
          ModelPermission.checkReadQueryPermission(
            TeamMember,
            {},
            { [column]: true },
            makeProps(isMultiTenantRequest),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      },
    );

    it.each(["createdByUserId", "deletedByUserId"])(
      "rejects count queries using the forbidden %s predicate without a select",
      async (column: string) => {
        await expect(
          ModelPermission.checkReadQueryPermission(
            TeamMember,
            { [column]: otherUserId },
            null,
            makeProps(isMultiTenantRequest),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      },
    );

    it("rejects forbidden query fields even when selecting only the record ID", async () => {
      await expect(
        ModelPermission.checkReadQueryPermission(
          TeamMember,
          { createdByUserId: otherUserId },
          { _id: true },
          makeProps(isMultiTenantRequest),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it.each(["password", "passwordSalt", "resetPasswordToken"])(
      "rejects %s inside a relation the project member may otherwise read",
      async (secretColumn: string) => {
        await expect(
          ModelPermission.checkReadQueryPermission(
            TeamMember,
            {},
            { user: { [secretColumn]: true } },
            makeProps(isMultiTenantRequest, true),
          ),
        ).rejects.toThrow(BadDataException);
      },
    );

    it("allows safe labels on an authorized user relation", async () => {
      const result: CheckReadPermissionType<TeamMember> =
        await ModelPermission.checkReadQueryPermission(
          TeamMember,
          {},
          { _id: true, user: { _id: true, name: true, email: true } },
          makeProps(isMultiTenantRequest, true),
        );

      expect(result.relationSelect).toEqual({ user: true });
      expect(result.select).toMatchObject({
        user: { _id: true, name: true, email: true },
      });
      if (isMultiTenantRequest) {
        expectExactScope(result.query.userId, userId);
      } else {
        expectExactScope(result.query.projectId, projectId);
      }
    });

    it.each([false, true])(
      "allows invitation labels without any project membership (explicit user filter=%s)",
      async (withUserFilter: boolean) => {
        const query: Query<TeamMember> = {
          hasAcceptedInvitation: false,
          ...(withUserFilter ? { userId } : {}),
        };
        const result: CheckReadPermissionType<TeamMember> =
          await ModelPermission.checkReadQueryPermission(
            TeamMember,
            query,
            invitationSelect(),
            makeProps(isMultiTenantRequest),
          );

        expectExactScope(result.query.userId, userId);
        expect(result.query.projectId).toBeUndefined();
        expect(result.query.hasAcceptedInvitation).toBe(false);
        expect(result.relationSelect).toEqual({ project: true, team: true });
        expect(result.select).toMatchObject({
          project: { _id: true, name: true },
          team: { _id: true, name: true },
        });
        expect(query).toEqual({
          hasAcceptedInvitation: false,
          ...(withUserFilter ? { userId } : {}),
        });
      },
    );

    it("keeps a safe count scoped to the authenticated user's invitations", async () => {
      const result: CheckReadPermissionType<TeamMember> =
        await ModelPermission.checkReadQueryPermission(
          TeamMember,
          { hasAcceptedInvitation: false },
          null,
          makeProps(isMultiTenantRequest),
        );

      expectExactScope(result.query.userId, userId);
      expect(result.select).toBeNull();
    });

    it("does not trust a caller-supplied array as an authorized multi-project query", async () => {
      await expect(
        ModelPermission.checkReadQueryPermission(
          TeamMember,
          [{ userId: otherUserId }] as unknown as Query<TeamMember>,
          { _id: true },
          makeProps(isMultiTenantRequest),
        ),
      ).rejects.toThrow(BadDataException);
    });

    it.each([
      otherUserId,
      otherUserId.toString(),
      new NotEqual<string>(userId.toString()),
    ])(
      "rejects an ownership filter targeting other users: %p",
      async (filter: string | ObjectID | NotEqual<string>) => {
        await expect(
          ModelPermission.checkReadQueryPermission(
            TeamMember,
            { userId: filter } as Query<TeamMember>,
            invitationSelect(),
            makeProps(isMultiTenantRequest),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      },
    );
  },
);

describe("multi-tenant project permission checks", () => {
  const firstProjectId: ObjectID = ObjectID.generate();
  const secondProjectId: ObjectID = ObjectID.generate();
  const deniedProjectId: ObjectID = ObjectID.generate();

  function makeMultiProjectProps(
    isMultiTenantRequest: boolean = true,
  ): DatabaseCommonInteractionProps {
    return {
      userId,
      isMultiTenantRequest,
      userGlobalAccessPermission: {
        projectIds: [firstProjectId, deniedProjectId, secondProjectId],
        globalPermissions: [Permission.Public, Permission.CurrentUser],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: Object.fromEntries(
        [firstProjectId, secondProjectId].map((id: ObjectID) => {
          return [
            id.toString(),
            {
              projectId: id,
              permissions: [
                {
                  permission: Permission.ReadProjectIncident,
                  labelIds: [],
                  isBlockPermission: false,
                  _type: "UserPermission" as const,
                },
              ],
              _type: "UserTenantAccessPermission" as const,
            },
          ];
        }),
      ),
    };
  }

  it.each([false, true])(
    "keeps reads authorized separately for each project (multi-tenant header=%s)",
    async (isMultiTenantRequest: boolean) => {
      const result: CheckReadPermissionType<Incident> =
        await ModelPermission.checkReadQueryPermission(
          Incident,
          {},
          { _id: true, title: true },
          makeMultiProjectProps(isMultiTenantRequest),
        );
      const queries: Array<Query<Incident>> = result.query as unknown as Array<
        Query<Incident>
      >;

      expect(queries).toHaveLength(2);
      expectExactScope(queries[0]?.projectId, firstProjectId);
      expectExactScope(queries[1]?.projectId, secondProjectId);
      expect(result.select).toMatchObject({ _id: true, title: true });
    },
  );

  it("rejects unsafe relation selects in every project", async () => {
    await expect(
      ModelPermission.checkReadQueryPermission(
        Incident,
        {},
        { createdByUser: { password: true } },
        makeMultiProjectProps(),
      ),
    ).rejects.toThrow(/password/);
  });

  it("rejects a read when no project grants table access", async () => {
    const props: DatabaseCommonInteractionProps = makeMultiProjectProps();
    props.userTenantAccessPermission = {};

    await expect(
      ModelPermission.checkReadQueryPermission(
        Incident,
        {},
        { _id: true, title: true },
        props,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("rejects a multi-tenant header on a model that does not allow it", async () => {
    await expect(
      ModelPermission.checkReadQueryPermission(
        User,
        {},
        { name: true },
        makeProps(true),
      ),
    ).rejects.toThrow(BadDataException);
  });
});
