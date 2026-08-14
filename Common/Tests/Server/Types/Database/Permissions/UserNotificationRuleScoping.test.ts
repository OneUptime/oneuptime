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
 * is row-scoped to its owner by one mechanism:
 *
 *   @TableAccessControl({ ... [Permission.CurrentUser] ... })
 *   @CurrentUserCanAccessRecordBy("userId")
 *
 * TenantPermission.isAccessGrantedOnlyByCurrentUser() returns true whenever
 * Permission.CurrentUser is the ONLY permission the caller holds that also
 * appears in the model's table access control list. When it does,
 * addCurrentUserScopeToQuery() rewrites the query to `userId = me`, and throws
 * NotAuthorizedException outright if the caller had explicitly named somebody
 * else. The FIRST group below is the standing proof that this still holds for a
 * plain member on all eight models.
 *
 * GAP D in Internal/Roadmap/OnCallNotificationReadiness.md was the consequence
 * for everybody else: a Project ADMIN was treated identically to a plain member
 * on these tables, because ProjectAdmin appeared in none of these lists and so
 * never landed in the intersection. There was no query an admin could issue
 * that returned another user's notification configuration - not to audit it,
 * not to repair it, not to see why a page went unanswered.
 *
 * IT WAS CLOSED ON THE RULE TABLE AND ONLY THERE. That boundary is the whole
 * design and this file exists to keep it from being erased in either direction:
 *
 *   - UserNotificationRule widens on ALL FOUR verbs. An administrator may read
 *     a member's rules, repair them, delete them, and provision one for a
 *     member who has none.
 *
 *   - The SEVEN METHOD MODELS widen on NOTHING. All four lists are
 *     [CurrentUser], so an administrator is force-scoped onto their own rows
 *     there and is rejected outright for naming somebody else, on every verb -
 *     indistinguishable from a plain member.
 *
 * The read half of those seven WAS widened at one point, and reverting it is
 * the most load-bearing fact in this file. The table scope is not one gate
 * among several on these models; it is the only one. Every column on them
 * declares `read: [Permission.CurrentUser]`, and that list is intersected by
 * NAME against a permission set that always contains the auto-granted
 * CurrentUser, so on its own it admits every authenticated caller. What made it
 * mean "owner only" was the ownership predicate this file is about. Widening
 * the table read deleted the predicate and with it the only row scope in the
 * path; the column-level guard written to contain that was then walked past by
 * nested relation selects, by `query` filters it never inspected, and by sort
 * columns appended to the select after it had run.
 *
 * The administrator did not lose the diagnosis. OnCallReadinessService answers
 * "can this colleague be paged" as root and returns ReadinessMethod
 * { methodId, methodType, maskedIdentifier, isVerified }, masked server-side by
 * the one code path that holds the raw value. methodId is a foreign key rather
 * than a secret, so a rule can be pointed at a method without the method's row
 * ever being read - which is exactly the capability the widening was reaching
 * for.
 *
 * Row scoping is only half of what the rule-table widening moved, and the half
 * this file does NOT cover. A nested relation select issued against an
 * admin-wide read of UserNotificationRule reaches the method row without
 * passing through the method table's list at all. That path is asserted
 * end-to-end in AdminNotificationRuleAccess.test.ts; the column-list assertions
 * at the bottom of this file are necessary but nowhere near sufficient on their
 * own.
 *
 * Two further groups exist to keep the MECHANISM legible independently of the
 * production decorators, so a future change cannot make the two agree by
 * accident:
 *
 *   - TeamMember carries the very same @CurrentUserCanAccessRecordBy("userId")
 *     decorator and has always listed ProjectOwner/ProjectAdmin in its read
 *     list. It is force-scoped for a member and unscoped for an admin. The
 *     ownership decorator was therefore never the thing scoping admins out -
 *     the absent permission entry was, which is why the rule table's fix is an
 *     entry in a list rather than a new gate, and why the seven methods stay
 *     scoped purely by having no such entry.
 *
 *   - AdminReadableNotificationRuleModel below isolates the same shape on a
 *     throwaway class, with read and update widened and create and delete left
 *     alone. It demonstrates that the lift is granted PER OPERATION on a class
 *     whose lists match no shipping model, so the framework guarantee survives
 *     any future edit to a production one.
 */

/*
 * A throwaway stand-in for a user-scoped model, carrying ProjectAdmin on read
 * and update only: same tenant column and same ownership column as the
 * production models, but a combination of verbs that none of them use.
 *
 * It is deliberately not a copy of any shipping model - not of the rule table,
 * whose four lists are all widened, and not of the seven methods, whose four
 * lists are all closed. Its job is to pin the mechanism - the scope lifts for
 * the operations whose list names a real permission and holds for the ones
 * whose list does not - so that the production assertions above it are testing
 * the models rather than re-testing the framework.
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
 * The seven channels a rule can fire through. They are seven copies of one
 * decorator shape, so every method assertion runs against all seven rather than
 * against a representative one - a widening applied to one of them is exactly
 * the kind of thing that survives review.
 */
const NOTIFICATION_METHOD_MODELS: Array<ModelTypeUnderTest> = [
  UserEmail,
  UserSMS,
  UserCall,
  UserPush,
  UserWhatsApp,
  UserTelegram,
  UserWebhook,
];

/*
 * Every model that makes up a user's on-call notification configuration.
 *
 * All eight behave identically for a plain member, which is what the first
 * group asserts over this list. They diverge only in what an ADMINISTRATOR
 * sees, so the admin-facing groups below name UserNotificationRule separately
 * and iterate NOTIFICATION_METHOD_MODELS for the seven that stay closed.
 */
const NOTIFICATION_CONFIG_MODELS: Array<ModelTypeUnderTest> = [
  UserNotificationRule,
  ...NOTIFICATION_METHOD_MODELS,
];

const ROW_SCOPED_REQUEST_TYPES: Array<DatabaseRequestType> = [
  DatabaseRequestType.Read,
  DatabaseRequestType.Update,
  DatabaseRequestType.Delete,
];

/*
 * The permissions the rule table gained, spelled out here rather than imported
 * from the model. A test that reads the model's own constant would assert that
 * the model equals itself; naming them independently means a change to a
 * shipping list has to be re-stated deliberately in a test.
 *
 * On the seven method models these names appear only inside a `not.toContain`.
 */
const ADMIN_READ_GRANTS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadProjectUserNotificationRule,
];

const ADMIN_WRITE_GRANTS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditProjectUserNotificationRule,
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

/*
 * A fan-out query comes back with its predicates already serialized. Each
 * project is re-checked through BasePermission.checkPermissions, which runs
 * QueryUtil.serializeQuery, and that rewrites an ObjectID-valued predicate into
 * QueryHelper.equalTo() - a TypeORM Raw() FindOperator whose uuid does NOT live
 * on `.value` (that slot holds the SQL-generator function) but in
 * `.objectLiteralParameters` under a per-call random key (QueryUtil.ts:222-230,
 * QueryHelper.ts:501-511). The id is therefore the sole VALUE in that bag
 * rather than a value at a known key.
 */
function boundIdOf(predicate: unknown): string | undefined {
  const rawOperator:
    | {
        type?: string | undefined;
        objectLiteralParameters?: Record<string, unknown> | undefined;
      }
    | undefined = predicate as
    | {
        type?: string | undefined;
        objectLiteralParameters?: Record<string, unknown> | undefined;
      }
    | undefined;

  if (!rawOperator || rawOperator.type !== "raw") {
    return undefined;
  }

  const boundValues: Array<unknown> = Object.values(
    rawOperator.objectLiteralParameters || {},
  );

  if (boundValues.length !== 1) {
    return undefined;
  }

  return String(boundValues[0]);
}

describe("GAP D closed - the rule table opens to a ProjectAdmin on every verb", () => {
  it("lifts the ownership scope on a ProjectAdmin's read, update and delete", async () => {
    /*
     * The inversion of the original GAP D assertion, and the reason the phase
     * exists. Permission.ProjectAdmin now appears in UserNotificationRule's
     * read, update and delete lists, so the intersection between what the admin
     * holds and what the model accepts contains a real role rather than the
     * auto-granted CurrentUser alone. isAccessGrantedOnlyByCurrentUser()
     * returns false, no ownership predicate is stamped on, and the query comes
     * back scoped to the PROJECT rather than to the caller - which is what lets
     * an administrator list every member's rules and notice the member who has
     * none.
     *
     * Delete is in this list on purpose rather than by inheritance. Removing a
     * rule is how an administrator repairs a member whose paging is being
     * swallowed by a stale opt-out row, and it is the only supported way to move
     * a rule between owners now that the ownership column is frozen.
     */
    for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
      const query: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          UserNotificationRule,
          {},
          null,
          makeAdminProps(),
          requestType,
        );

      expect((query as any).userId).toBeUndefined();
      expect((query as any).projectId?.toString()).toBe(projectId.toString());
    }
  });

  it("lets a ProjectAdmin name another user on read, update and delete", async () => {
    /*
     * The other half of the same claim, and the half that used to throw. An
     * unscoped query only proves the predicate is no longer stamped on; a query
     * that NAMES the other user proves addCurrentUserScopeToQuery is no longer
     * rejecting the attempt outright, which is what "there is no API by which an
     * admin can read another user's rules" actually meant.
     */
    for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
      const query: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          UserNotificationRule,
          { userId: otherUserId } as any,
          null,
          makeAdminProps(),
          requestType,
        );

      expect((query as any).userId?.toString()).toBe(otherUserId.toString());
    }
  });

  it("does not stamp a ProjectAdmin's UserNotificationRule create with their own userId", async () => {
    /*
     * Create widened too, which had to be decided rather than inherited. An
     * administrator provisioning a rule for a member who has none is the single
     * repair that matters most, and it is impossible if the framework stamps the
     * administrator's own id onto the row.
     *
     * The framework deliberately says nothing about WHICH user may be named
     * here - it only stops enforcing "you, and nobody else". The membership
     * question (is this userId even in props.tenantId?) is answered in
     * UserNotificationRuleService, not in this layer, and a passing assertion
     * here must not be read as "on-behalf-of creation is safe".
     */
    const query: Query<UserNotificationRule> =
      await TenantPermission.addTenantScopeToQuery(
        UserNotificationRule,
        {},
        null,
        makeAdminProps(),
        DatabaseRequestType.Create,
      );

    expect((query as any).userId).toBeUndefined();
  });

  it("lifts the scope in the project where the caller is an admin and nowhere else", async () => {
    /*
     * When no single tenantId is supplied the permission layer fans the query
     * out across every project the caller can see and re-checks each one
     * independently. That per-project re-entry is the point: the lift follows
     * the grant, so the project where the caller is merely a member still comes
     * back carrying their own userId while the project where they are a full
     * ProjectAdmin comes back with no ownership predicate at all.
     *
     * Asserted per-project rather than uniformly, because a single loop over
     * both queries is how a fan-out bug that widens the WRONG project would go
     * unnoticed.
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

    const queryByProject: Record<string, Record<string, unknown>> = {};

    for (const query of queries) {
      const boundProjectId: string | undefined = boundIdOf(query["projectId"]);

      expect(boundProjectId).toBeDefined();
      queryByProject[boundProjectId as string] = query;
    }

    const memberProjectQuery: Record<string, unknown> | undefined =
      queryByProject[memberProjectId.toString()];
    const adminProjectQuery: Record<string, unknown> | undefined =
      queryByProject[adminProjectId.toString()];

    expect(memberProjectQuery).toBeDefined();
    expect(adminProjectQuery).toBeDefined();

    /*
     * The member project keeps its ownership predicate - and keeps it in the
     * serialized form, which matters beyond shape. TenantPermission
     * .isExactUserScope() accepts only `string | ObjectID`, so a fan-out query
     * fed back into addTenantScopeToQuery would be rejected as a disguised
     * broad filter rather than recognised as the caller's own ownership
     * predicate. The two paths are not round-trippable and no caller may assume
     * they are.
     */
    expect(memberProjectQuery!["userId"]).toBeDefined();
    expect(memberProjectQuery!["userId"]).not.toBeInstanceOf(ObjectID);
    expect(boundIdOf(memberProjectQuery!["userId"])).toBe(
      callerUserId.toString(),
    );

    // The admin project carries no ownership predicate in any form.
    expect(adminProjectQuery!["userId"]).toBeUndefined();
  });
});

describe("GAP D closed on the rule table alone - the seven methods open to nobody", () => {
  /*
   * THE BOUNDARY OF THE PHASE, AND THE PART MOST LIKELY TO BE "TIDIED UP"
   * LATER, because seven models that differ from their sibling in all four
   * lists look like an oversight rather than a decision.
   *
   * Two independent reasons keep them closed, and both have to be understood or
   * one of them will be argued away.
   *
   * READ, because the table scope is the only row scope these models have. Each
   * column on them declares `read: [Permission.CurrentUser]`, which is
   * intersected by NAME against a permission set that always contains the
   * auto-granted CurrentUser - so the column lists admit every authenticated
   * caller on their own, and the ownership predicate stamped by this very
   * mechanism is what makes them mean "owner only". Widen the table read and
   * every column on every member's row in the project becomes readable: the
   * webhook URL and its signing secret, the push device token, the Telegram
   * chat id and its verification code. That shipped once and the column-level
   * guard written to contain it did not hold.
   *
   * WRITE, because a rule is a pair - the ownership column decides whose pages
   * select the row, the method relation decides where those pages are
   * delivered. An administrator who could CREATE or EDIT a method on somebody
   * else's account would hold a one-step paging hijack: register a phone or
   * webhook you control on the victim, point their rules at it, and their pages
   * arrive on your device.
   *
   * Neither restriction costs the administrator anything they actually need. A
   * member with no methods must verify a device THEY own, which nobody can do
   * for them, and "does this colleague have a verified method" is answered by
   * OnCallReadinessService's masked payload without this table being read.
   */

  it.each(NOTIFICATION_METHOD_MODELS)(
    "still stamps the ownership predicate on a ProjectAdmin's %p READ",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * The inversion of the assertion this group used to open with. The read
       * list is [CurrentUser], so a ProjectAdmin's intersection contains
       * nothing but the auto-granted permission and the predicate is written
       * onto their query exactly as onto a plain member's.
       *
       * This is the shape a leak arrives through rather than the named-target
       * one below: an admin listing page asks for a project's methods rather
       * than one member's, so it issues no userId at all and cannot be refused
       * for naming the wrong one. The stamp is what makes that request
       * harmless.
       */
      const query: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          modelType,
          {},
          null,
          makeAdminProps(),
          DatabaseRequestType.Read,
        );

      expect((query as any).userId?.toString()).toBe(callerUserId.toString());
      expect((query as any).projectId?.toString()).toBe(projectId.toString());
    },
  );

  it.each(NOTIFICATION_METHOD_MODELS)(
    "still rejects a ProjectAdmin who names another user's %p rows for read",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * A hard NotAuthorizedException rather than a quiet redirect onto the
       * admin's own rows. The refusal, not the redirect, is what makes "an
       * administrator cannot see a colleague's notification methods" a
       * statement about the API rather than about the UI that happens not to
       * ask.
       */
      await expect(
        TenantPermission.addTenantScopeToQuery(
          modelType,
          { userId: otherUserId } as any,
          null,
          makeAdminProps(),
          DatabaseRequestType.Read,
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(NOTIFICATION_METHOD_MODELS)(
    "leaves a ProjectAdmin's own-userId %p filter intact on every verb",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * The companion every refusal above needs, and the constraint a
       * heavy-handed fix breaks. An administrator is a member too: they own
       * notification methods, they manage them through these same endpoints,
       * and a change that withheld these rows whenever the caller holds an
       * administrator permission would satisfy every refusal in this group and
       * break the administrator's own settings page.
       *
       * The claim is precisely that ProjectAdmin buys nothing here - not that
       * it costs anything either.
       */
      for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
        const query: Query<BaseModel> =
          await TenantPermission.addTenantScopeToQuery(
            modelType,
            { userId: callerUserId } as any,
            null,
            makeAdminProps(),
            requestType,
          );

        expect((query as any).userId?.toString()).toBe(callerUserId.toString());
      }
    },
  );

  it.each(NOTIFICATION_METHOD_MODELS)(
    "still forces a ProjectAdmin's %p create, update and delete onto their own rows",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * These three lists were never widened, and this is the assertion that
       * says so. A ProjectAdmin's intersection here contains nothing but the
       * auto-granted permission and they are scoped exactly like the plain
       * member in the first group. An admin permission arriving in any of these
       * three lists breaks this test, which is the entire point of keeping it.
       */
      for (const requestType of [
        DatabaseRequestType.Create,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
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

  it.each(NOTIFICATION_METHOD_MODELS)(
    "still rejects a ProjectAdmin who explicitly targets another user's %p rows for write",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * A hard NotAuthorizedException rather than a quiet redirect, and here the
       * difference is load-bearing beyond legibility: service hooks run before
       * the final permission check, so silently rewriting the target would let a
       * hook inspect one row while the database operation mutated a different
       * one.
       */
      for (const requestType of [
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
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
});

describe("TeamMember proves the mechanism - a listed admin permission lifts the scope", () => {
  it("does not scope a ProjectAdmin's TeamMember read to their own userId", async () => {
    /*
     * TeamMember carries the identical @CurrentUserCanAccessRecordBy("userId")
     * decorator as the notification models, and yet the admin walks away
     * unscoped. The difference is one entry: ProjectAdmin appears in
     * TeamMember's read list, so the intersection contains a real role and
     * isAccessGrantedOnlyByCurrentUser() returns false.
     *
     * That is the whole of what the rule table gained, on a model that has
     * always shipped it - which is why the fix there was an entry in a list
     * rather than a new gate, and equally why the seven method models stay
     * closed by simply having no such entry. Nothing guards them beyond the
     * absence, so this group stays here as the independent statement of what
     * the absence is doing.
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
     * The exemption is granted per-operation, not per-model, and TeamMember
     * demonstrates it on a shipping model. That is what makes the rule table's
     * asymmetry expressible at all - read widened for one set of permissions,
     * write for another - and what would let a future method model be opened on
     * one verb without being opened on the rest, should anyone ever find a
     * verb that is safe to open.
     *
     * TeamMember's update list is
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

describe("the lift mechanism in isolation, on a throwaway model", () => {
  /*
   * The production groups above assert what UserNotificationRule and the seven
   * methods DO; this group asserts what the framework does with any user-scoped
   * model, on a class whose lists match neither of them - all four widened on
   * the rule table, all four closed on the methods, two-of-four here.
   *
   * That mismatch is the point. If a future change to TenantPermission alters
   * the rule, this group fails on its own terms and says so, instead of the
   * failure arriving disguised as eight models having drifted.
   */

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
     * The exemption is granted per-operation: adding ProjectAdmin to read and
     * update alone leaves delete untouched. Proved here on a class whose lists
     * nothing else depends on, so the guarantee survives any future edit to a
     * production model - including the edit that would widen a notification
     * method on one verb while believing the rest stay closed.
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

  it("grants UserNotificationRule table access to CurrentUser plus the administrator grants, on all four verbs", () => {
    /*
     * Pinned literally rather than with `toContain`, and the direction matters:
     * the failure mode worth catching on a widened list is an entry ARRIVING,
     * not one going missing, and a containment check passes straight through the
     * change it exists to catch.
     *
     * CurrentUser stays FIRST and stays present in every list. It is what keeps
     * a plain member scoped to their own rows; drop it and the first group in
     * this file - the one that proves members are still confined - stops being
     * about anything.
     */
    const model: UserNotificationRule = new UserNotificationRule();

    expect(model.getReadPermissions()).toEqual([
      Permission.CurrentUser,
      ...ADMIN_READ_GRANTS,
    ]);
    expect(model.getCreatePermissions()).toEqual([
      Permission.CurrentUser,
      ...ADMIN_WRITE_GRANTS,
    ]);
    expect(model.getUpdatePermissions()).toEqual([
      Permission.CurrentUser,
      ...ADMIN_WRITE_GRANTS,
    ]);
    expect(model.getDeletePermissions()).toEqual([
      Permission.CurrentUser,
      ...ADMIN_WRITE_GRANTS,
    ]);
  });

  it.each(NOTIFICATION_METHOD_MODELS)(
    "keeps all four of %p's table lists CurrentUser-only",
    (modelType: ModelTypeUnderTest): void => {
      /*
       * The decorator-level statement of what the behavioural group above
       * asserts. Both are needed: the behaviour is what actually protects a
       * member, but a list can be widened by a refactor months before anybody
       * writes a query that notices, and this fails on the commit that does it.
       *
       * READ IS THE ENTRY TO WATCH. It is the one that shipped widened and was
       * reverted, so it is the one a later commit is most likely to re-add
       * while "restoring the admin feature" - and re-adding it silently removes
       * the row scope that every column on the model depends on. Neither
       * ADMIN_READ_GRANTS nor ADMIN_WRITE_GRANTS belongs in any list on these
       * seven; there is no verb on a notification method that an administrator
       * may perform on somebody else's row.
       */
      const model: BaseModel = new modelType();

      for (const list of [
        model.getReadPermissions(),
        model.getCreatePermissions(),
        model.getUpdatePermissions(),
        model.getDeletePermissions(),
      ]) {
        expect(list).toEqual([Permission.CurrentUser]);
      }
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

  it("names no administrator permission on the webhook URL's read list", () => {
    /*
     * A webhook URL frequently carries its own bearer token in the path or
     * query string, so it is the most sensitive column in this group and no
     * admin permission may ever appear on its read list.
     *
     * NECESSARY, NOT SUFFICIENT - and the gap between the two is the trap the
     * reverted widening walked into. `read: [CurrentUser]` does not mean
     * "readable only on my own row": Permission.CurrentUser is auto-granted to
     * every authenticated caller and ColumnPermissions intersects by NAME
     * without ever seeing the query, so this list alone says nothing more than
     * "readable by anyone logged in". It is equivalent to owner-only only
     * because the TABLE list pins the row scope to the caller - which is why the
     * table assertions above are the ones doing the work, and why this one only
     * catches the cruder mistake of pasting the admin grants in here too.
     */
    const model: UserWebhook = new UserWebhook();

    expect(model.getColumnAccessControlFor("webhookUrl")?.read).toEqual([
      Permission.CurrentUser,
    ]);

    for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
      expect(model.getColumnAccessControlFor("webhookUrl")?.read).not.toContain(
        grant,
      );
    }

    expect(model.getColumnAccessControlFor("webhookUrl")?.read).not.toContain(
      Permission.ProjectMember,
    );
  });

  it("keeps UserWebhook's ownership column CurrentUser-only on read and unwritable on update", () => {
    /*
     * Widened on the read side once and reverted, so both halves are pinned
     * here for different reasons.
     *
     * READ went back to CurrentUser because there is no longer any question an
     * administrator can ask of this table. "Whose row is this" is only worth
     * answering to a caller who can reach somebody else's row, and none can;
     * leaving the ownership column widened would be a standing invitation to
     * re-widen the table so that the column meant something again.
     *
     * UPDATE stays empty for everybody, which is the more important half and was
     * never in question. A writable ownership column would let an administrator
     * RE-POINT an existing row at a different owner: take a webhook that already
     * points at an endpoint you control, move its userId to a colleague, and
     * their pages arrive at your endpoint. That is the create-side ownership
     * gate reopened through a different verb, and nothing at the row level
     * distinguishes it from a legitimate edit.
     */
    const model: UserWebhook = new UserWebhook();

    expect(model.getColumnAccessControlFor("userId")?.read).toEqual([
      Permission.CurrentUser,
    ]);
    expect(model.getColumnAccessControlFor("userId")?.update).toEqual([]);
  });
});
