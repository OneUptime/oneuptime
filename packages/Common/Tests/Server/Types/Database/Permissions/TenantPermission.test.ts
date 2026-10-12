import Incident from "../../../../../Models/DatabaseModels/Incident";
import User from "../../../../../Models/DatabaseModels/User";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import UserNotificationRule from "../../../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "../../../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserSession from "../../../../../Models/DatabaseModels/UserSession";
import UserTotpAuth from "../../../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../../../Models/DatabaseModels/UserWebAuthn";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserService from "../../../../../Server/Services/UserService";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import DeleteBy from "../../../../../Server/Types/Database/DeleteBy";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import TenantPermission from "../../../../../Server/Types/Database/Permissions/TenantPermission";
import Query from "../../../../../Server/Types/Database/Query";
import UpdateBy from "../../../../../Server/Types/Database/UpdateBy";
import NotEqual from "../../../../../Types/BaseDatabase/NotEqual";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnAccessControl from "../../../../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../../../../Types/Database/AccessControl/TableAccessControl";
import CurrentUserCanAccessRecordBy from "../../../../../Types/Database/CurrentUserCanAccessRecordBy";
import TableColumn from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import TenantColumn from "../../../../../Types/Database/TenantColumn";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";

@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
})
@CurrentUserCanAccessRecordBy("userId")
class MisconfiguredCurrentUserModel extends BaseModel {}

@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
})
class MissingCurrentUserScopeModel extends BaseModel {}

@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser, Permission.ProjectAdmin],
  update: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
})
@CurrentUserCanAccessRecordBy("userId")
@TenantColumn("projectId")
class TenantScopedCurrentUserModel extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Project ID",
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
  })
  public userId?: ObjectID = undefined;
}

describe("TenantPermission current-user ownership scope", () => {
  const userId: ObjectID = ObjectID.generate();
  const victimUserId: ObjectID = ObjectID.generate();

  function makeUserProps(): DatabaseCommonInteractionProps {
    return {
      userId,
    };
  }

  it.each([UserTotpAuth, UserWebAuthn, UserSession])(
    "scopes %p queries to the authenticated user's records",
    async (modelType: { new (): BaseModel }) => {
      for (const requestType of [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        const query: Query<BaseModel> =
          await TenantPermission.addTenantScopeToQuery(
            modelType,
            {},
            null,
            makeUserProps(),
            requestType,
          );

        expect((query as any).userId?.toString()).toBe(userId.toString());
      }
    },
  );

  it.each([UserTotpAuth, UserWebAuthn, UserSession])(
    "rejects %p operations that explicitly target another user",
    async (modelType: { new (): BaseModel }) => {
      for (const requestType of [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        await expect(
          TenantPermission.addTenantScopeToQuery(
            modelType,
            { userId: victimUserId } as any,
            null,
            makeUserProps(),
            requestType,
          ),
        ).rejects.toThrow(NotAuthorizedException);
      }
    },
  );

  it("rejects CurrentUser access when a non-user caller has no user identity", async () => {
    const apiKeyProps: DatabaseCommonInteractionProps = {
      userType: UserType.API,
      userGlobalAccessPermission: {
        projectIds: [ObjectID.generate()],
        globalPermissions: [
          Permission.Public,
          Permission.User,
          Permission.CurrentUser,
        ],
        _type: "UserGlobalAccessPermission",
      },
    };

    await expect(
      BasePermission.checkPermissions(
        UserTotpAuth,
        {},
        null,
        apiKeyProps,
        DatabaseRequestType.Read,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("fails closed when a CurrentUser model resolves no ownership filter", async () => {
    await expect(
      TenantPermission.addTenantScopeToQuery(
        MisconfiguredCurrentUserModel,
        {},
        null,
        makeUserProps(),
        DatabaseRequestType.Read,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("fails closed when CurrentUser ownership metadata is missing", async () => {
    await expect(
      TenantPermission.addTenantScopeToQuery(
        MissingCurrentUserScopeModel,
        {},
        null,
        makeUserProps(),
        DatabaseRequestType.Read,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("keeps User reads scoped to the authenticated user's primary key", async () => {
    const query: Query<User> = await TenantPermission.addTenantScopeToQuery(
      User,
      {},
      null,
      makeUserProps(),
      DatabaseRequestType.Read,
    );

    expect((query as any)._id?.toString()).toBe(userId.toString());
  });

  it("rejects query operators that disguise a broad ownership filter", async () => {
    await expect(
      TenantPermission.addTenantScopeToQuery(
        User,
        { _id: new NotEqual<string>(userId.toString()) },
        null,
        makeUserProps(),
        DatabaseRequestType.Update,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("rejects deleting another User instead of redirecting the delete", async () => {
    await expect(
      TenantPermission.addTenantScopeToQuery(
        User,
        { _id: victimUserId },
        null,
        makeUserProps(),
        DatabaseRequestType.Delete,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("allows deleting the authenticated User's own record", async () => {
    const deleteQuery: Query<User> =
      await TenantPermission.addTenantScopeToQuery(
        User,
        { _id: userId },
        null,
        makeUserProps(),
        DatabaseRequestType.Delete,
      );

    expect((deleteQuery as any)._id?.toString()).toBe(userId.toString());
  });

  it.each([UserOnCallLog, UserOnCallLogTimeline])(
    "scopes %p reads to the current user within the tenant",
    async (modelType: { new (): BaseModel }) => {
      const projectId: ObjectID = ObjectID.generate();
      const query: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          modelType,
          {},
          null,
          { ...makeUserProps(), tenantId: projectId },
          DatabaseRequestType.Read,
        );

      expect((query as any).projectId?.toString()).toBe(projectId.toString());
      expect((query as any).userId?.toString()).toBe(userId.toString());
    },
  );

  it("does not mutate a query reused for list and count permission checks", async () => {
    const reusedQuery: Query<UserTotpAuth> = {};

    await BasePermission.checkPermissions(
      UserTotpAuth,
      reusedQuery,
      null,
      makeUserProps(),
      DatabaseRequestType.Read,
    );
    await expect(
      BasePermission.checkPermissions(
        UserTotpAuth,
        reusedQuery,
        null,
        makeUserProps(),
        DatabaseRequestType.Read,
      ),
    ).resolves.toBeDefined();

    expect(reusedQuery).toEqual({});
  });

  it("isolates CurrentUser scope for every project in a multi-tenant query", async () => {
    const currentUserProjectId: ObjectID = ObjectID.generate();
    const adminProjectId: ObjectID = ObjectID.generate();

    for (const projectIds of [
      [currentUserProjectId, adminProjectId],
      [adminProjectId, currentUserProjectId],
    ]) {
      const queries: Array<Record<string, unknown>> =
        (await TenantPermission.addTenantScopeToQuery(
          TenantScopedCurrentUserModel,
          {},
          null,
          {
            userId,
            userGlobalAccessPermission: {
              projectIds,
              globalPermissions: [Permission.Public, Permission.CurrentUser],
              _type: "UserGlobalAccessPermission",
            },
            userTenantAccessPermission: {
              [adminProjectId.toString()]: {
                projectId: adminProjectId,
                permissions: [
                  {
                    permission: Permission.ProjectAdmin,
                    labelIds: [],
                    isBlockPermission: false,
                    _type: "UserPermission",
                  },
                ],
                _type: "UserTenantAccessPermission",
              },
            },
          },
          DatabaseRequestType.Read,
        )) as unknown as Array<Record<string, unknown>>;

      expect(queries).toHaveLength(2);
      expect(
        queries[projectIds.indexOf(currentUserProjectId)]?.["userId"],
      ).toBeDefined();
      expect(
        queries[projectIds.indexOf(adminProjectId)]?.["userId"],
      ).toBeUndefined();
    }
  });

  /*
   * A CHANGE IS MADE IN ONE PROJECT AT A TIME. A read that names no project,
   * or asks across projects (a model that may be read so), is answered with
   * a query per project (above). An update or a delete would have to read
   * its rows by such a query before it writes them, and no read takes one,
   * so it is refused before anything is read - with a 400 that says what to
   * do, where it once failed in the database. A model a person reads
   * without a project (AllowUserQueryWithoutTenant: their own team
   * memberships, which they accept and decline from the invitations list)
   * is kept to their own rows instead, as before.
   */
  describe("a change that names no project, or asks across projects", () => {
    const projectId: ObjectID = ObjectID.generate();

    const withoutProject: DatabaseCommonInteractionProps = {
      userId,
      userGlobalAccessPermission: {
        projectIds: [projectId, ObjectID.generate()],
        globalPermissions: [
          Permission.Public,
          Permission.User,
          Permission.CurrentUser,
        ],
        _type: "UserGlobalAccessPermission",
      },
    };

    const acrossProjects: DatabaseCommonInteractionProps = {
      ...withoutProject,
      tenantId: projectId,
      isMultiTenantRequest: true,
    };

    it.each([DatabaseRequestType.Update, DatabaseRequestType.Delete])(
      "is refused (%s) with words that say to name the project",
      async (requestType: DatabaseRequestType) => {
        const noProject: Promise<unknown> =
          TenantPermission.addTenantScopeToQuery(
            TenantScopedCurrentUserModel,
            {},
            null,
            withoutProject,
            requestType,
          );

        await expect(noProject).rejects.toThrow(BadDataException);
        await expect(noProject).rejects.toThrow(
          "Changes to records are made in one project at a time. Please pass the project ID in the 'tenantid' header.",
        );

        // A model that may be read across projects is changed in one too.
        const everyProject: Promise<unknown> =
          TenantPermission.addTenantScopeToQuery(
            Incident,
            {},
            null,
            acrossProjects,
            requestType,
          );

        await expect(everyProject).rejects.toThrow(BadDataException);
        await expect(everyProject).rejects.toThrow(
          "Changes to incidents are made in one project at a time. Please pass the project ID in the 'tenantid' header.",
        );
      },
    );

    it("is refused through each permission check DatabaseService asks of an update or a delete", async () => {
      const ruleQuery: Query<UserNotificationRule> = {
        _id: ObjectID.generate().toString(),
      };
      const message: string = TenantPermission.getWriteAcrossProjectsMessage(
        new UserNotificationRule(),
      );

      // The rows a teammate may update, read before an update's hooks.
      await expect(
        ModelPermission.getUpdatableQuery(
          UserNotificationRule,
          ruleQuery,
          withoutProject,
        ),
      ).rejects.toThrow(message);

      // The rows a teammate may delete, read before a delete's hooks.
      await expect(
        ModelPermission.checkDeleteQueryPermission(
          UserNotificationRule,
          ruleQuery,
          withoutProject,
        ),
      ).rejects.toThrow(message);
    });

    it("still answers a read across projects with a query per project", async () => {
      const queries: unknown = await TenantPermission.addTenantScopeToQuery(
        TenantScopedCurrentUserModel,
        {},
        null,
        withoutProject,
        DatabaseRequestType.Read,
      );

      expect(Array.isArray(queries)).toBe(true);
      expect(queries as Array<unknown>).toHaveLength(2);
    });

    it("keeps a person's own team memberships to their rows, with or without a project", async () => {
      for (const props of [withoutProject, acrossProjects]) {
        const query: Query<BaseModel> =
          await TenantPermission.addTenantScopeToQuery(
            TeamMember,
            { _id: ObjectID.generate().toString() } as Query<BaseModel>,
            null,
            props,
            DatabaseRequestType.Update,
          );

        expect(Array.isArray(query)).toBe(false);
        expect((query as any).userId?.toString()).toBe(userId.toString());
      }
    });

    it("names the records the change was for", () => {
      expect(
        TenantPermission.getWriteAcrossProjectsMessage(
          new UserNotificationRule(),
        ),
      ).toBe(
        "Changes to notification rules are made in one project at a time. Please pass the project ID in the 'tenantid' header.",
      );
    });

    it("leaves a change in the project the request names as it was", async () => {
      const query: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          TenantScopedCurrentUserModel,
          {},
          null,
          { ...withoutProject, tenantId: projectId },
          DatabaseRequestType.Update,
        );

      expect(Array.isArray(query)).toBe(false);
      expect((query as any).projectId?.toString()).toBe(projectId.toString());
    });
  });

  it("rejects a cross-user delete before UserService inspects memberships", async () => {
    await expect(
      (UserService as any).onBeforeDelete({
        query: { _id: victimUserId },
        props: makeUserProps(),
        limit: 1,
        skip: 0,
      } as DeleteBy<User>),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("rejects broad update operators before UserService runs user hooks", async () => {
    await expect(
      (UserService as any).onBeforeUpdate({
        query: { _id: new NotEqual<string>(userId.toString()) },
        data: { password: "new-password" },
        props: makeUserProps(),
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<User>),
    ).rejects.toThrow(NotAuthorizedException);
  });
});

describe("two-factor credential ownership columns", () => {
  it("prevents TOTP ownership and verification from being changed via CRUD", () => {
    const model: UserTotpAuth = new UserTotpAuth();

    expect(model.getColumnAccessControlFor("user")?.update).toEqual([]);
    expect(model.getColumnAccessControlFor("user")?.create).toEqual([]);
    expect(model.getColumnAccessControlFor("userId")?.update).toEqual([]);
    expect(model.getColumnAccessControlFor("isVerified")?.update).toEqual([]);
  });

  it("prevents WebAuthn ownership from being changed via CRUD", () => {
    const model: UserWebAuthn = new UserWebAuthn();

    expect(model.getColumnAccessControlFor("user")?.update).toEqual([]);
    expect(model.getColumnAccessControlFor("user")?.create).toEqual([]);
    expect(model.getColumnAccessControlFor("userId")?.update).toEqual([]);
  });
});
