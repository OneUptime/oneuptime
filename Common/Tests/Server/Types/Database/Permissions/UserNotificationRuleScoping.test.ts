import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import UserCall from "../../../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../../../Models/DatabaseModels/UserWhatsApp";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TenantPermission from "../../../../../Server/Types/Database/Permissions/TenantPermission";
import Query from "../../../../../Server/Types/Database/Query";
import NotEqual from "../../../../../Types/BaseDatabase/NotEqual";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnAccessControl from "../../../../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../../../../Types/Database/AccessControl/TableAccessControl";
import CurrentUserCanAccessRecordBy from "../../../../../Types/Database/CurrentUserCanAccessRecordBy";
import TableColumn from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import TenantColumn from "../../../../../Types/Database/TenantColumn";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";

/*
 * WHAT THIS FILE PINS
 *
 * On-call notification configuration - the rules themselves plus every channel
 * they can fire through (email, SMS, call, push, WhatsApp, Telegram, webhook) -
 * is guarded by exactly one shape today:
 *
 *   @TableAccessControl({ create/read/update/delete: [Permission.CurrentUser] })
 *   @CurrentUserCanAccessRecordBy("userId")
 *
 * TenantPermission.isAccessGrantedOnlyByCurrentUser() returns true whenever
 * Permission.CurrentUser is the ONLY permission the caller holds that also
 * appears in the model's table access control list. When it does,
 * addCurrentUserScopeToQuery() rewrites the query to `userId = me`, and throws
 * NotAuthorizedException outright if the caller had explicitly named somebody
 * else. That is deliberate and correct for a plain member.
 *
 * The consequence, though, is that a Project ADMIN is treated identically to a
 * plain member on these tables: Permission.ProjectAdmin does not appear in any
 * of these models' lists, so it never lands in the intersection, so the admin's
 * own userId is stamped onto their query too. There is currently NO query an
 * admin can issue that returns another user's notification configuration - not
 * to audit it, not to repair it, not to see why a page went unanswered.
 *
 * That is GAP D in Internal/Roadmap/OnCallNotificationReadiness.md. These tests
 * assert the CURRENT behaviour, including the parts that are the gap. Every
 * assertion that Phase 3 is expected to invert is flagged with a "GAP D" block
 * comment directly above it.
 *
 * Two further groups exist to prove *why* the gap exists, so the fix is not
 * guesswork:
 *
 *   - TeamMember carries the very same @CurrentUserCanAccessRecordBy("userId")
 *     decorator, but ALSO lists ProjectOwner/ProjectAdmin in its read list. It
 *     is force-scoped for a member and unscoped for an admin. The ownership
 *     decorator is therefore not the thing blocking admins - the missing
 *     permission entry is.
 *
 *   - AdminReadableNotificationRuleModel below is UserNotificationRule's
 *     decorator shape with Permission.ProjectAdmin added to read and update.
 *     The scope lifts for an admin and still holds for a member, which
 *     pre-verifies the Phase 3 change in isolation, before a single production
 *     model is touched.
 */

/*
 * A throwaway stand-in for UserNotificationRule carrying the decorators the
 * production model SHOULD have after Phase 3: same tenant column, same
 * ownership column, but with Permission.ProjectAdmin present in read and
 * update. Delete is left CurrentUser-only on purpose, so the tests below can
 * show that the scope lifts per-operation rather than per-model.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser, Permission.ProjectAdmin],
  update: [Permission.CurrentUser, Permission.ProjectAdmin],
  delete: [Permission.CurrentUser],
})
@CurrentUserCanAccessRecordBy("userId")
class AdminReadableNotificationRuleModel extends BaseModel {
  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Project ID",
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
  })
  public userId?: ObjectID = undefined;
}

type ModelTypeUnderTest = { new (): BaseModel };

/*
 * Every model that makes up a user's on-call notification configuration. All
 * eight share one decorator shape, so every behaviour below is asserted against
 * all eight rather than against UserNotificationRule alone - a Phase 3 change
 * that fixes only the rule table would leave the channels unreachable.
 */
const NOTIFICATION_CONFIG_MODELS: Array<ModelTypeUnderTest> = [
  UserNotificationRule,
  UserEmail,
  UserSMS,
  UserCall,
  UserPush,
  UserWhatsApp,
  UserTelegram,
  UserWebhook,
];

const ROW_SCOPED_REQUEST_TYPES: Array<DatabaseRequestType> = [
  DatabaseRequestType.Read,
  DatabaseRequestType.Update,
  DatabaseRequestType.Delete,
];

const projectId: ObjectID = ObjectID.generate();
const callerUserId: ObjectID = ObjectID.generate();
const otherUserId: ObjectID = ObjectID.generate();

/*
 * A plain project member. No tenant role at all - the permission machinery
 * auto-grants Public and CurrentUser to any request that carries a userId.
 */
function makeMemberProps(): DatabaseCommonInteractionProps {
  return {
    userId: callerUserId,
    tenantId: projectId,
  };
}

/*
 * A caller holding Permission.ProjectAdmin for this tenant. This is the highest
 * ordinary role in a project short of ProjectOwner.
 */
function makeAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: callerUserId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
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
  };
}

describe("notification config models are row-scoped to their owner", () => {
  it.each(NOTIFICATION_CONFIG_MODELS)(
    "forces %p reads, updates and deletes onto the member's own rows",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
        const query: Query<BaseModel> =
          await TenantPermission.addTenantScopeToQuery(
            modelType,
            {},
            null,
            makeMemberProps(),
            requestType,
          );

        expect((query as any).userId?.toString()).toBe(callerUserId.toString());
        expect((query as any).projectId?.toString()).toBe(projectId.toString());
      }
    },
  );

  it.each(NOTIFICATION_CONFIG_MODELS)(
    "rejects a member who explicitly names another user in a %p query",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
        await expect(
          TenantPermission.addTenantScopeToQuery(
            modelType,
            { userId: otherUserId } as any,
            null,
            makeMemberProps(),
            requestType,
          ),
        ).rejects.toThrow(NotAuthorizedException);
      }
    },
  );

  it.each(NOTIFICATION_CONFIG_MODELS)(
    "leaves a member's own-userId %p filter intact rather than rejecting it",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
        const query: Query<BaseModel> =
          await TenantPermission.addTenantScopeToQuery(
            modelType,
            { userId: callerUserId } as any,
            null,
            makeMemberProps(),
            requestType,
          );

        expect((query as any).userId?.toString()).toBe(callerUserId.toString());
      }
    },
  );

  it.each(NOTIFICATION_CONFIG_MODELS)(
    "rejects a %p ownership filter disguised as a query operator",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * NotEqual stringifies to the id it wraps, so a string comparison alone
       * would let `userId != me` masquerade as the exact ownership predicate
       * and widen the query to every other row in the project.
       */
      await expect(
        TenantPermission.addTenantScopeToQuery(
          modelType,
          { userId: new NotEqual<string>(callerUserId.toString()) } as any,
          null,
          makeMemberProps(),
          DatabaseRequestType.Read,
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(NOTIFICATION_CONFIG_MODELS)(
    "refuses a %p query when the caller has no user session at all",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * An API key can carry the auto-granted CurrentUser permission without a
       * userId. There is no id to convert into an ownership predicate, so the
       * request must fail closed rather than run unscoped.
       */
      await expect(
        TenantPermission.addTenantScopeToQuery(
          modelType,
          {},
          null,
          {
            tenantId: projectId,
            userGlobalAccessPermission: {
              projectIds: [projectId],
              globalPermissions: [Permission.Public, Permission.CurrentUser],
              _type: "UserGlobalAccessPermission",
            },
          },
          DatabaseRequestType.Read,
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );
});

describe("GAP D - project admins are force-scoped out of other users' notification config", () => {
  it.each(NOTIFICATION_CONFIG_MODELS)(
    "still scopes a ProjectAdmin's %p query to the admin's own rows",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * GAP D - Phase 3 inverts this assertion.
       *
       * Permission.ProjectAdmin is absent from these models' TableAccessControl
       * lists, so the intersection between what the admin holds and what the
       * model accepts contains nothing but the auto-granted CurrentUser. The
       * admin is therefore indistinguishable from a plain member and gets their
       * OWN userId stamped onto the query. After Phase 3 adds ProjectAdmin to
       * read/update, this expectation becomes `toBeUndefined()`.
       */
      for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
        const query: Query<BaseModel> =
          await TenantPermission.addTenantScopeToQuery(
            modelType,
            {},
            null,
            makeAdminProps(),
            requestType,
          );

        expect((query as any).userId?.toString()).toBe(callerUserId.toString());
        expect((query as any).projectId?.toString()).toBe(projectId.toString());
      }
    },
  );

  it.each(NOTIFICATION_CONFIG_MODELS)(
    "rejects a ProjectAdmin who explicitly targets another user's %p rows",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * GAP D - Phase 3 inverts this assertion.
       *
       * This is the concrete "there is no API by which an admin can read
       * another user's rules" claim from the roadmap, expressed as a test: the
       * admin does not get an empty result set, they get a hard
       * NotAuthorizedException on read, update AND delete. After Phase 3, read
       * and update by an admin must resolve to the targeted user's rows.
       */
      for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
        await expect(
          TenantPermission.addTenantScopeToQuery(
            modelType,
            { userId: otherUserId } as any,
            null,
            makeAdminProps(),
            requestType,
          ),
        ).rejects.toThrow(NotAuthorizedException);
      }
    },
  );

  it("scopes a ProjectAdmin's UserNotificationRule create to their own userId", async () => {
    /*
     * GAP D - Phase 3 should decide explicitly what an admin creating a rule
     * ON BEHALF OF another user means. Today create is scoped exactly like the
     * read path, so an admin cannot provision a colleague's rule either.
     */
    const query: Query<UserNotificationRule> =
      await TenantPermission.addTenantScopeToQuery(
        UserNotificationRule,
        {},
        null,
        makeAdminProps(),
        DatabaseRequestType.Create,
      );

    expect((query as any).userId?.toString()).toBe(callerUserId.toString());
  });

  it("scopes a ProjectAdmin to their own rows in every project of a multi-tenant fan-out", async () => {
    /*
     * GAP D - Phase 3 inverts this assertion for the admin project.
     *
     * When no single tenantId is supplied the permission layer fans the query
     * out across every project the caller can see and re-checks each one. Even
     * the project where the caller is a full ProjectAdmin comes back carrying
     * their own userId, because the fan-out re-enters exactly the same
     * table-permission intersection.
     */
    const memberProjectId: ObjectID = ObjectID.generate();
    const adminProjectId: ObjectID = ObjectID.generate();

    const queries: Array<Record<string, unknown>> =
      (await TenantPermission.addTenantScopeToQuery(
        UserNotificationRule,
        {},
        null,
        {
          userId: callerUserId,
          userGlobalAccessPermission: {
            projectIds: [memberProjectId, adminProjectId],
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

    for (const query of queries) {
      /*
       * The fan-out does NOT hand back a raw ObjectID the way the
       * single-tenant path does. Each project is re-checked through
       * BasePermission.checkPermissions, which runs QueryUtil.serializeQuery,
       * and that rewrites an ObjectID-valued predicate into
       * QueryHelper.equalTo() - a TypeORM Raw() FindOperator carrying the uuid
       * in its parameter bag (QueryUtil.ts:222-230, QueryHelper.ts:501-511).
       *
       * This matters beyond shape. TenantPermission.isExactUserScope() accepts
       * only `string | ObjectID`, so a fan-out query fed back into
       * addTenantScopeToQuery would be rejected as a disguised broad filter
       * rather than recognised as the caller's own ownership predicate. The
       * two paths are not round-trippable, and Phase 3 must not assume they
       * are.
       */
      const ownershipPredicate: unknown = query["userId"];

      expect(ownershipPredicate).toBeDefined();
      expect(ownershipPredicate).not.toBeInstanceOf(ObjectID);

      /*
       * QueryHelper.equalTo builds its predicate with TypeORM's Raw(), so the
       * uuid does not live on `.value` - that slot holds the SQL-generator
       * function. The bound parameters hang off `.objectLiteralParameters`
       * under a per-call random key (QueryHelper.ts:501-511), so the caller's
       * id is the sole VALUE in that bag rather than a value at a known key.
       */
      const rawOperator: {
        type: string;
        objectLiteralParameters?: Record<string, unknown> | undefined;
      } = ownershipPredicate as {
        type: string;
        objectLiteralParameters?: Record<string, unknown> | undefined;
      };

      expect(rawOperator.type).toBe("raw");
      expect(Object.values(rawOperator.objectLiteralParameters || {})).toEqual([
        callerUserId.toString(),
      ]);

      expect(query["projectId"]).toBeDefined();
    }
  });
});

describe("TeamMember proves the mechanism - a listed admin permission lifts the scope", () => {
  it("does not scope a ProjectAdmin's TeamMember read to their own userId", async () => {
    /*
     * TeamMember carries the identical @CurrentUserCanAccessRecordBy("userId")
     * decorator as the notification models, and yet the admin walks away
     * unscoped. The difference is one entry: ProjectAdmin appears in
     * TeamMember's read list, so the intersection contains a real role and
     * isAccessGrantedOnlyByCurrentUser() returns false. This is the whole of
     * the Phase 3 fix, demonstrated on a model that already ships it.
     */
    const query: Query<TeamMember> =
      await TenantPermission.addTenantScopeToQuery(
        TeamMember,
        {},
        null,
        makeAdminProps(),
        DatabaseRequestType.Read,
      );

    expect((query as any).userId).toBeUndefined();
    expect((query as any).projectId?.toString()).toBe(projectId.toString());
  });

  it("scopes a plain member's TeamMember read to their own userId", async () => {
    const query: Query<TeamMember> =
      await TenantPermission.addTenantScopeToQuery(
        TeamMember,
        {},
        null,
        makeMemberProps(),
        DatabaseRequestType.Read,
      );

    expect((query as any).userId?.toString()).toBe(callerUserId.toString());
  });

  it("lets a ProjectAdmin read another user's TeamMember rows without throwing", async () => {
    const query: Query<TeamMember> =
      await TenantPermission.addTenantScopeToQuery(
        TeamMember,
        { userId: otherUserId } as any,
        null,
        makeAdminProps(),
        DatabaseRequestType.Read,
      );

    expect((query as any).userId?.toString()).toBe(otherUserId.toString());
  });

  it("rejects a plain member reading another user's TeamMember rows", async () => {
    await expect(
      TenantPermission.addTenantScopeToQuery(
        TeamMember,
        { userId: otherUserId } as any,
        null,
        makeMemberProps(),
        DatabaseRequestType.Read,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("still scopes a ProjectAdmin's TeamMember UPDATE, because ProjectAdmin is not in the update list", async () => {
    /*
     * Worth knowing before Phase 3 copies the TeamMember shape wholesale: the
     * exemption is per-operation, not per-model. TeamMember's update list is
     * [ProjectOwner, InviteProjectTeamMembers, EditProjectTeam, CurrentUser] -
     * ProjectAdmin is absent - so a caller holding ONLY ProjectAdmin is
     * force-scoped on update even though they were unscoped on read.
     */
    const query: Query<TeamMember> =
      await TenantPermission.addTenantScopeToQuery(
        TeamMember,
        {},
        null,
        makeAdminProps(),
        DatabaseRequestType.Update,
      );

    expect((query as any).userId?.toString()).toBe(callerUserId.toString());
  });

  it("does not row-scope a TeamMember delete at all, because CurrentUser is not in the delete list", async () => {
    /*
     * TeamMember's delete list omits CurrentUser entirely, so
     * isAccessGrantedOnlyByCurrentUser() short-circuits to false before any
     * ownership predicate is considered. Nothing is added to the query here -
     * it is the separate table-level permission check that stops a plain
     * member from deleting memberships.
     */
    const query: Query<TeamMember> =
      await TenantPermission.addTenantScopeToQuery(
        TeamMember,
        {},
        null,
        makeMemberProps(),
        DatabaseRequestType.Delete,
      );

    expect((query as any).userId).toBeUndefined();
    expect((query as any).projectId?.toString()).toBe(projectId.toString());
  });
});

describe("Phase 3 shape, pre-verified on a throwaway model", () => {
  it("lifts the ownership scope for a ProjectAdmin on read and update", async () => {
    for (const requestType of [
      DatabaseRequestType.Read,
      DatabaseRequestType.Update,
    ]) {
      const query: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          AdminReadableNotificationRuleModel,
          {},
          null,
          makeAdminProps(),
          requestType,
        );

      expect((query as any).userId).toBeUndefined();
      expect((query as any).projectId?.toString()).toBe(projectId.toString());
    }
  });

  it("lets a ProjectAdmin target another user's rows once the permission is listed", async () => {
    const query: Query<BaseModel> =
      await TenantPermission.addTenantScopeToQuery(
        AdminReadableNotificationRuleModel,
        { userId: otherUserId } as any,
        null,
        makeAdminProps(),
        DatabaseRequestType.Read,
      );

    expect((query as any).userId?.toString()).toBe(otherUserId.toString());
  });

  it("keeps the ownership scope on a plain member for read, update and delete", async () => {
    for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
      const query: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          AdminReadableNotificationRuleModel,
          {},
          null,
          makeMemberProps(),
          requestType,
        );

      expect((query as any).userId?.toString()).toBe(callerUserId.toString());
    }
  });

  it("still rejects a plain member targeting another user once admins are exempt", async () => {
    await expect(
      TenantPermission.addTenantScopeToQuery(
        AdminReadableNotificationRuleModel,
        { userId: otherUserId } as any,
        null,
        makeMemberProps(),
        DatabaseRequestType.Read,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("keeps the delete scope on a ProjectAdmin, since delete was left CurrentUser-only", async () => {
    /*
     * The exemption is granted per-operation. Adding ProjectAdmin to read and
     * update alone leaves delete exactly as it is today, which is a decision
     * Phase 3 has to make deliberately rather than inherit.
     */
    const query: Query<BaseModel> =
      await TenantPermission.addTenantScopeToQuery(
        AdminReadableNotificationRuleModel,
        {},
        null,
        makeAdminProps(),
        DatabaseRequestType.Delete,
      );

    expect((query as any).userId?.toString()).toBe(callerUserId.toString());
  });
});

describe("notification config model decorators", () => {
  it.each(NOTIFICATION_CONFIG_MODELS)(
    "declares userId as %p's ownership column and projectId as its tenant column",
    (modelType: ModelTypeUnderTest): void => {
      const model: BaseModel = new modelType();

      expect(model.getUserColumn()).toBe("userId");
      expect(model.getTenantColumn()).toBe("projectId");
    },
  );

  it.each(NOTIFICATION_CONFIG_MODELS)(
    "grants %p table access to CurrentUser and nobody else",
    (modelType: ModelTypeUnderTest): void => {
      /*
       * GAP D - Phase 3 adds Permission.ProjectAdmin (and probably
       * ProjectOwner) to at least read and update here. Until it does, these
       * lists being exactly [CurrentUser] is the single reason admins are
       * locked out, so pin them literally rather than with `toContain`.
       */
      const model: BaseModel = new modelType();

      expect(model.getCreatePermissions()).toEqual([Permission.CurrentUser]);
      expect(model.getReadPermissions()).toEqual([Permission.CurrentUser]);
      expect(model.getUpdatePermissions()).toEqual([Permission.CurrentUser]);
      expect(model.getDeletePermissions()).toEqual([Permission.CurrentUser]);
    },
  );

  it.each(NOTIFICATION_CONFIG_MODELS)(
    "does not let %p be queried across tenants",
    (modelType: ModelTypeUnderTest): void => {
      /*
       * canQueryMultiTenant() is what would let a caller ask for rows without
       * naming a project. These models say no, so the fan-out path is the only
       * multi-project route and it re-checks permissions per project.
       */
      const model: BaseModel = new modelType();

      expect(model.canQueryMultiTenant()).toBe(false);
    },
  );

  it("keeps the UserNotificationRule ownership column unwritable after creation", () => {
    const model: UserNotificationRule = new UserNotificationRule();

    expect(model.getColumnAccessControlFor("userId")?.update).toEqual([]);
    expect(model.getColumnAccessControlFor("user")?.update).toEqual([]);
    expect(model.getColumnAccessControlFor("projectId")?.update).toEqual([]);
  });

  it("exposes the webhook URL to CurrentUser only", () => {
    /*
     * A webhook URL frequently carries its own bearer token in the path or
     * query string, so it is the most sensitive column in this group. No
     * admin permission may appear on its read list today.
     */
    const model: UserWebhook = new UserWebhook();

    expect(model.getColumnAccessControlFor("webhookUrl")?.read).toEqual([
      Permission.CurrentUser,
    ]);
    expect(model.getColumnAccessControlFor("webhookUrl")?.read).not.toContain(
      Permission.ProjectAdmin,
    );
    expect(model.getColumnAccessControlFor("webhookUrl")?.read).not.toContain(
      Permission.ProjectOwner,
    );
    expect(model.getColumnAccessControlFor("webhookUrl")?.read).not.toContain(
      Permission.ProjectMember,
    );
  });

  it("exposes UserWebhook's ownership column to CurrentUser only", () => {
    const model: UserWebhook = new UserWebhook();

    expect(model.getColumnAccessControlFor("userId")?.read).toEqual([
      Permission.CurrentUser,
    ]);
    expect(model.getColumnAccessControlFor("userId")?.update).toEqual([]);
  });
});
