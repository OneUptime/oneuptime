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
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import TenantPermission from "../../../../../Server/Types/Database/Permissions/TenantPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import UserType from "../../../../../Types/UserType";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE GUARDS
 *
 * An administrator has to be able to answer "why did this member's page go
 * unanswered", and until Phase 3 nobody but the member could see the rows that
 * decide it: a member with no matching rule was silently unpageable, and the
 * only person able to notice was the person who was not being notified.
 *
 * PHASE 3 SHIPPED THAT CAPABILITY ON THE RULE TABLE AND ONLY THERE. The seven
 * notification-method models - UserEmail, UserSMS, UserCall, UserPush,
 * UserWhatsApp, UserTelegram, UserWebhook - stay CurrentUser-only on every
 * verb, so an administrator reading one of THEM is refused exactly like any
 * other member. That split is not a leftover; it is the design, and it is the
 * design because the alternative was tried and did not hold.
 *
 * WHY THE METHOD TABLES COULD NOT BE WIDENED. Widening a read on a model that
 * scopes rows by owner is a privilege change rather than a convenience change,
 * and the mechanism is indirect enough to be worth stating:
 * TenantPermission.isAccessGrantedOnlyByCurrentUser intersects what the caller
 * holds with what the model's list accepts, and while the only survivor is the
 * auto-granted Permission.CurrentUser, addCurrentUserScopeToQuery rewrites the
 * query to `userId = me` and rejects outright any attempt to name somebody
 * else. That single stamp is the ONLY thing making the columns underneath
 * owner-only - `read: [Permission.CurrentUser]` on a COLUMN never meant "on my
 * own row", because CurrentUser is auto-granted to every authenticated caller
 * and ColumnPermissions intersects by NAME without ever seeing the query. Add
 * one administrator permission to a method model's table list and the stamp
 * stops being applied for whoever holds it, and the webhook URL and its signing
 * secret, the push device token, and the Telegram chat id and verification code
 * become readable on every member's row in the project. The column-level guard
 * written to contain that was then walked past by nested relation selects, by
 * `query` filters it never inspected, and by sort columns appended to the
 * select after it had run. The widening was reverted rather than patched a
 * fourth time.
 *
 * WHAT AN ADMINISTRATOR USES INSTEAD. OnCallReadinessService answers the
 * diagnosis question as root and returns ReadinessMethod
 * { methodId, methodType, maskedIdentifier, isVerified } - masked server-side
 * by the one code path that holds the raw value. methodId is a foreign key
 * rather than a secret, and it is what lets an administrator POINT A RULE AT a
 * method without the method's row ever being read.
 *
 * So every assertion here is about the exact shape of what did and did not
 * lift:
 *
 *   - the rule table lifts for an administrator and not for a plain member, on
 *     all four verbs;
 *   - the seven method models lift for NOBODY on ANY verb, and the read case is
 *     asserted in both directions because it is the one that shipped widened
 *     once already;
 *   - the rule's method FK id columns are admin-readable while the method
 *     RELATION columns are not, which is what keeps "re-point this rule"
 *     possible without making "read what it points at" possible;
 *   - the ownership and tenant COLUMNS stay frozen, so the capability cannot be
 *     turned into "re-point this rule at a different owner", which is the same
 *     hijack wearing a different verb;
 *   - the two granular permissions are opt-in - held by nobody until an
 *     administrator grants them, and never auto-granted the way CurrentUser is;
 *   - the roles are listed ALONGSIDE the granular permissions on the rule
 *     table, so the feature is not dead on arrival for a project whose teams
 *     predate them;
 *   - the create-side ownership gate added in Phase 2.5 still refuses a plain
 *     member who names another user.
 *
 * The tests are written against the permission layer directly rather than
 * through the API, because the API is not the boundary: POST/PATCH
 * /api/user-notification-rule stays reachable with any member session, and the
 * admin UI is a convenience over these checks rather than a gate in front of
 * them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const CALLER_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const OTHER_USER_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

type ModelConstructor = { new (): BaseModel };

/*
 * The permissions that lift the read scope, and the permissions that lift the
 * write scope, ON THE RULE TABLE. Spelled out here rather than imported from
 * the model, so that a change to the model's private constant has to be
 * reflected deliberately in a test rather than being absorbed silently by a
 * shared reference.
 *
 * They appear in the method-model groups too, but only ever inside a
 * `not.toContain` or a refusal - there is no verb on a notification method that
 * any of them may perform on somebody else's row.
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

/*
 * The two permissions this phase introduces. Kept separate from the lists above
 * because several assertions are about the permissions themselves - their
 * catalogue entry, their opt-in-ness - rather than about any model.
 */
const NEW_GRANULAR_PERMISSIONS: Array<Permission> = [
  Permission.ReadProjectUserNotificationRule,
  Permission.EditProjectUserNotificationRule,
];

/*
 * The seven notification methods a rule can point at. Every method assertion
 * runs against all seven rather than against a representative one: they are
 * seven copies of one decorator shape, and a widening applied to one of them is
 * exactly the kind of thing that survives review.
 */
const METHOD_MODELS: Array<[string, ModelConstructor]> = [
  ["UserEmail", UserEmail],
  ["UserSMS", UserSMS],
  ["UserCall", UserCall],
  ["UserPush", UserPush],
  ["UserWhatsApp", UserWhatsApp],
  ["UserTelegram", UserTelegram],
  ["UserWebhook", UserWebhook],
];

const ROW_SCOPED_REQUEST_TYPES: Array<DatabaseRequestType> = [
  DatabaseRequestType.Read,
  DatabaseRequestType.Update,
  DatabaseRequestType.Delete,
];

/*
 * A plain project member: authenticated, holding nothing but the permissions
 * every logged-in caller is auto-granted. This is the shape an escalation
 * attempt arrives in, and also the ordinary shape of a first-party dashboard
 * request.
 *
 * Rebuilt on every call rather than shared, because
 * DatabaseCommonInteractionPropsUtil.getUserPermissions MUTATES the props it is
 * handed - it pushes Public and CurrentUser into globalPermissions in place - so
 * a shared object would carry state between tests.
 */
function memberProps(): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
  };
}

/*
 * A caller holding specific permissions FOR THIS TENANT. Note that they also
 * receive the auto-granted CurrentUser on top, exactly as a real session would -
 * an administrator is still a user with notification rules and notification
 * methods of their own, and several of the behaviours below only make sense
 * because both are true at once.
 */
function tenantProps(
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function makeRow(
  modelType: ModelConstructor,
  ownerId?: ObjectID | undefined,
): BaseModel {
  const row: BaseModel = new modelType();
  row.setColumnValue("projectId", PROJECT_ID);

  if (ownerId) {
    row.setColumnValue("userId", ownerId);
  }

  return row;
}

function scopedUserIdOf(query: Query<BaseModel>): string | undefined {
  return (query as Record<string, unknown>)["userId"]?.toString();
}

/*
 * The same ownership predicate, read off a query that has been through
 * BasePermission.checkPermissions rather than the tenant scope alone.
 *
 * The two are not interchangeable and the difference is not cosmetic.
 * checkPermissions finishes by running QueryUtil.serializeQuery, which rewrites
 * an ObjectID-valued predicate into QueryHelper.equalTo() - a TypeORM Raw()
 * FindOperator whose uuid does NOT live on `.value` (that slot holds the
 * SQL-generator function) but in `.objectLiteralParameters` under a per-call
 * random key. So the id is the sole VALUE in that bag rather than a value at a
 * known key, and `.toString()` on the operator yields "[object Object]" - which
 * would make a naive assertion pass or fail for reasons unrelated to ownership.
 *
 * Accepts the unserialized form too, so a caller does not have to know which
 * stage produced the query it is holding.
 */
function ownerIdOf(query: Query<BaseModel>): string | undefined {
  const predicate: unknown = (query as Record<string, unknown>)["userId"];

  if (predicate === undefined || predicate === null) {
    return undefined;
  }

  if (predicate instanceof ObjectID || typeof predicate === "string") {
    return predicate.toString();
  }

  const rawOperator: {
    type?: string | undefined;
    objectLiteralParameters?: Record<string, unknown> | undefined;
  } = predicate as {
    type?: string | undefined;
    objectLiteralParameters?: Record<string, unknown> | undefined;
  };

  if (rawOperator.type !== "raw") {
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

describe("the rule table - an administrator's row scope lifts, a member's does not", () => {
  test.each(ADMIN_READ_GRANTS)(
    "%s reads another member's rules without being forced onto their own",
    async (grant: Permission): Promise<void> => {
      /*
       * Two halves of the same claim, and both are needed. An unscoped query
       * proves the ownership predicate is no longer stamped on; a query that
       * NAMES the other user proves addCurrentUserScopeToQuery is no longer
       * rejecting the attempt outright. Before this phase the second half threw
       * NotAuthorizedException, which is why an administrator could not even
       * ask the question.
       */
      const unscoped: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          UserNotificationRule,
          {},
          null,
          tenantProps(grant),
          DatabaseRequestType.Read,
        );

      expect(scopedUserIdOf(unscoped)).toBeUndefined();
      expect(
        (unscoped as Record<string, unknown>)["projectId"]?.toString(),
      ).toBe(PROJECT_ID.toString());

      const targeted: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          UserNotificationRule,
          { userId: OTHER_USER_ID } as Query<BaseModel>,
          null,
          tenantProps(grant),
          DatabaseRequestType.Read,
        );

      expect(scopedUserIdOf(targeted)).toBe(OTHER_USER_ID.toString());
    },
  );

  test.each(ADMIN_WRITE_GRANTS)(
    "%s may update and delete another member's rules",
    async (grant: Permission): Promise<void> => {
      /*
       * Repair, not just diagnosis. Update is what re-points a rule at a method
       * the member actually verified; delete is the supported way to move a
       * rule between owners, since the ownership column itself is frozen.
       */
      for (const requestType of [
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        const query: Query<BaseModel> =
          await TenantPermission.addTenantScopeToQuery(
            UserNotificationRule,
            { userId: OTHER_USER_ID } as Query<BaseModel>,
            null,
            tenantProps(grant),
            requestType,
          );

        expect(scopedUserIdOf(query)).toBe(OTHER_USER_ID.toString());
      }
    },
  );

  test("a plain member is still forced onto their own rules on every verb", async () => {
    for (const requestType of [
      ...ROW_SCOPED_REQUEST_TYPES,
      DatabaseRequestType.Create,
    ]) {
      const query: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          UserNotificationRule,
          {},
          null,
          memberProps(),
          requestType,
        );

      expect(scopedUserIdOf(query)).toBe(CALLER_ID.toString());
    }
  });

  test("a plain member naming another user is rejected, not quietly redirected", async () => {
    /*
     * The distinction matters more than it looks. Service hooks run before the
     * final permission check, so silently rewriting the target would let a hook
     * inspect one row while the database operation mutated a different one.
     * Widening the table list must not have turned this refusal into a rewrite.
     */
    for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
      await expect(
        TenantPermission.addTenantScopeToQuery(
          UserNotificationRule,
          { userId: OTHER_USER_ID } as Query<BaseModel>,
          null,
          memberProps(),
          requestType,
        ),
      ).rejects.toThrow(NotAuthorizedException);
    }
  });

  test("the lift is granted per operation, not per model", async () => {
    /*
     * ReadProjectUserNotificationRule appears only in the read lists and
     * EditProjectUserNotificationRule only in the write lists, so each holder is
     * still force-scoped on the verbs the other one covers. This is worth
     * pinning because the natural refactor - one ADMIN_PERMISSIONS constant
     * spread everywhere - would silently turn a read grant into a write grant.
     */
    const readOnly: Query<BaseModel> =
      await TenantPermission.addTenantScopeToQuery(
        UserNotificationRule,
        {},
        null,
        tenantProps(Permission.ReadProjectUserNotificationRule),
        DatabaseRequestType.Update,
      );

    expect(scopedUserIdOf(readOnly)).toBe(CALLER_ID.toString());

    const writeOnly: Query<BaseModel> =
      await TenantPermission.addTenantScopeToQuery(
        UserNotificationRule,
        {},
        null,
        tenantProps(Permission.EditProjectUserNotificationRule),
        DatabaseRequestType.Read,
      );

    expect(scopedUserIdOf(writeOnly)).toBe(CALLER_ID.toString());
  });

  test("an administrator of a DIFFERENT project gets no lift here", async () => {
    /*
     * userTenantAccessPermission is keyed by project, and getUserPermissions
     * only reads the bucket matching props.tenantId. A ProjectAdmin of some
     * other project therefore arrives holding nothing but CurrentUser and is
     * scoped like any member. This is the tenant half of the isolation the
     * service-layer membership check completes on the create path.
     */
    const foreignProjectId: ObjectID = ObjectID.generate();

    const query: Query<BaseModel> =
      await TenantPermission.addTenantScopeToQuery(
        UserNotificationRule,
        {},
        null,
        {
          userId: CALLER_ID,
          tenantId: PROJECT_ID,
          userType: UserType.User,
          userTenantAccessPermission: {
            [foreignProjectId.toString()]: {
              projectId: foreignProjectId,
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
      );

    expect(scopedUserIdOf(query)).toBe(CALLER_ID.toString());
  });

  test("the rule table's lists carry the roles and the granular permission and nothing else", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    expect(rule.getReadPermissions()).toEqual([
      Permission.CurrentUser,
      ...ADMIN_READ_GRANTS,
    ]);

    for (const list of [
      rule.getCreatePermissions(),
      rule.getUpdatePermissions(),
      rule.getDeletePermissions(),
    ]) {
      expect(list).toEqual([Permission.CurrentUser, ...ADMIN_WRITE_GRANTS]);
    }
  });
});

describe("the seven methods - an administrator may not look either", () => {
  /*
   * THE CORE DECISION OF THIS PHASE AS IT FINALLY SHIPPED, AND THE ONE MOST
   * LIKELY TO BE "TIDIED UP" LATER, because seven models that differ from their
   * sibling in all four lists look like an oversight rather than a decision.
   *
   * The read half of these lists was widened once and then reverted. The reason
   * it could not stay is that the table-level scope is not one gate among
   * several here - it is the ONLY gate. Every column on these models declares
   * `read: [Permission.CurrentUser]`, and that list is intersected by NAME
   * against a permission set that always contains the auto-granted CurrentUser,
   * so it admits every authenticated caller on its own. What made it mean
   * "owner only" was TenantPermission stamping `userId = me` onto the query,
   * which happens exactly while this table list holds nothing but CurrentUser.
   * Widening the table read removed the stamp and with it the only row scope in
   * the path.
   *
   * Write was never widened and never could be, for a second and independent
   * reason. A rule is a pair - the ownership column decides whose pages select
   * the row, the method relation decides where those pages are delivered - so an
   * administrator who could ADD a method to somebody else's account would hold a
   * one-step paging hijack: register a phone or webhook you control on the
   * victim, point their rules at it, and their pages arrive on your device.
   *
   * Neither restriction costs the administrator the diagnosis. A member with no
   * methods needs to verify a device THEY own, which nobody else can do for
   * them, and "does this colleague have a verified method" is answered by
   * OnCallReadinessService's masked payload without this table being read at
   * all.
   */

  test.each(METHOD_MODELS)(
    "an administrator naming another member's %s row for read is refused",
    async (_name: string, modelType: ModelConstructor): Promise<void> => {
      /*
       * The inversion of the assertion this group used to carry, and the reason
       * the group exists at all. The table list is CurrentUser-only, so an
       * administrator's intersection contains nothing but the auto-granted
       * permission; addCurrentUserScopeToQuery therefore refuses the named
       * target outright rather than quietly redirecting it, exactly as it does
       * for a plain member.
       *
       * Both the read grants AND the write grants are exercised, because the
       * claim is that NO permission a project can hand out reaches these rows -
       * not that one particular list was left alone.
       */
      for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
        await expect(
          TenantPermission.addTenantScopeToQuery(
            modelType,
            { userId: OTHER_USER_ID } as Query<BaseModel>,
            null,
            tenantProps(grant),
            DatabaseRequestType.Read,
          ),
        ).rejects.toThrow(NotAuthorizedException);
      }
    },
  );

  test.each(METHOD_MODELS)(
    "an administrator's unscoped %s read comes back pinned to their own rows",
    async (_name: string, modelType: ModelConstructor): Promise<void> => {
      /*
       * The shape a leak would actually arrive through, and the reason refusing
       * a NAMED target is not sufficient on its own. An admin listing page asks
       * for a project's methods rather than one member's, so it issues no userId
       * at all - and a query with no userId cannot be refused for naming the
       * wrong one. What protects it is the stamp: the ownership predicate is
       * written onto the query, and the listing comes back containing the
       * administrator's own rows and nobody else's.
       */
      for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
        const query: Query<BaseModel> =
          await TenantPermission.addTenantScopeToQuery(
            modelType,
            {},
            null,
            tenantProps(grant),
            DatabaseRequestType.Read,
          );

        expect(scopedUserIdOf(query)).toBe(CALLER_ID.toString());
      }
    },
  );

  test.each(METHOD_MODELS)(
    "an administrator reading their OWN %s row still succeeds end to end",
    async (_name: string, modelType: ModelConstructor): Promise<void> => {
      /*
       * The constraint every version of this design has had to respect, and the
       * one a heavy-handed fix breaks. An administrator is a member too, and
       * /api/user-webhook and its siblings are where they manage their own
       * methods; a change that withheld these rows whenever the caller happens
       * to hold an administrator permission would satisfy every refusal above
       * and break the administrator's own notification settings page.
       *
       * Driven through BasePermission.checkPermissions rather than the tenant
       * scope alone so that the table-level check, the query check and the
       * select check all run - the owner's read has to survive the whole path,
       * not just the first stage of it.
       */
      for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
        await expect(
          BasePermission.checkPermissions(
            modelType,
            { userId: CALLER_ID } as Query<BaseModel>,
            { userId: true } as Select<BaseModel>,
            tenantProps(grant),
            DatabaseRequestType.Read,
          ),
        ).resolves.toBeDefined();
      }
    },
  );

  test.each(METHOD_MODELS)(
    "an administrator is still force-scoped when updating or deleting %s",
    async (_name: string, modelType: ModelConstructor): Promise<void> => {
      for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
        for (const requestType of [
          DatabaseRequestType.Update,
          DatabaseRequestType.Delete,
        ]) {
          const query: Query<BaseModel> =
            await TenantPermission.addTenantScopeToQuery(
              modelType,
              {},
              null,
              tenantProps(grant),
              requestType,
            );

          expect(scopedUserIdOf(query)).toBe(CALLER_ID.toString());
        }
      }
    },
  );

  test.each(METHOD_MODELS)(
    "an administrator naming another member's %s row for update or delete is refused",
    async (_name: string, modelType: ModelConstructor): Promise<void> => {
      for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
        for (const requestType of [
          DatabaseRequestType.Update,
          DatabaseRequestType.Delete,
        ]) {
          await expect(
            TenantPermission.addTenantScopeToQuery(
              modelType,
              { userId: OTHER_USER_ID } as Query<BaseModel>,
              null,
              tenantProps(grant),
              requestType,
            ),
          ).rejects.toThrow(NotAuthorizedException);
        }
      }
    },
  );

  test.each(METHOD_MODELS)(
    "an administrator cannot create a %s row on another member's behalf",
    (_name: string, modelType: ModelConstructor): void => {
      /*
       * The create list is [CurrentUser], so an administrator arrives at
       * CreatePermission's ownership gate looking exactly like a member: the
       * intersection contains nothing but the auto-granted permission, the gate
       * does not defer, and a row naming somebody else is refused.
       */
      for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
        expect(() => {
          return CreatePermission.checkCreatePermissions(
            modelType,
            makeRow(modelType, OTHER_USER_ID) as never,
            tenantProps(grant),
          );
        }).toThrow(NotAuthorizedException);
      }
    },
  );

  test.each(METHOD_MODELS)(
    "%s's own notification methods are still fully theirs to manage",
    (_name: string, modelType: ModelConstructor): void => {
      /*
       * The other side of every refusal above: withholding these rows from
       * administrators must not have withheld them from the owner, who is the
       * only person able to verify a device in the first place.
       */
      expect(() => {
        return CreatePermission.checkCreatePermissions(
          modelType,
          makeRow(modelType, CALLER_ID) as never,
          memberProps(),
        );
      }).not.toThrow();
    },
  );

  test.each(METHOD_MODELS)(
    "%s's table lists name CurrentUser and nothing else, on all four verbs",
    (_name: string, modelType: ModelConstructor): void => {
      /*
       * Asserted literally rather than with toContain. The failure mode this
       * guards is an entry ARRIVING, not one going missing, so a containment
       * check would pass straight through the very change it exists to catch.
       *
       * READ IS IN THIS LIST DELIBERATELY. It is the one that shipped widened
       * and was reverted, so it is the one a later commit is most likely to
       * re-add while "restoring the admin feature" - and re-adding it silently
       * removes the row scope that every column on the model depends on.
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
});

describe("R2 - the ownership and tenant columns stay frozen after creation", () => {
  /*
   * The original plan said to mirror the widened lists onto the per-column
   * blocks. Applied literally to userId that would let an administrator
   * RE-POINT an existing rule at a different owner: take a rule that already
   * points at your own verified phone, move its userId to a colleague, and the
   * colleague's pages ring your handset. Nothing distinguishes that from a
   * legitimate edit at the row level. It is the hole the create-side ownership
   * gate closes, reopened through a different verb.
   *
   * Both spellings have to be pinned. `user` and `userId` are two decorated
   * members over one physical join column - an update expressed as
   * `user: { _id }` resolves to the same write - so closing one and leaving the
   * other open closes nothing at all.
   */

  const FROZEN_COLUMNS: Array<string> = [
    "userId",
    "user",
    "projectId",
    "project",
  ];

  test("the rule model's ownership and tenant columns are writable by nobody", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    for (const columnName of FROZEN_COLUMNS) {
      const accessControl: ColumnAccessControl | null =
        rule.getColumnAccessControlFor(columnName);

      expect(accessControl).not.toBeNull();
      expect(accessControl?.update).toEqual([]);
    }
  });

  test.each(METHOD_MODELS)(
    "%s's ownership and tenant columns are writable by nobody",
    (_name: string, modelType: ModelConstructor): void => {
      const model: BaseModel = new modelType();

      for (const columnName of FROZEN_COLUMNS) {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(columnName);

        expect(accessControl).not.toBeNull();
        expect(accessControl?.update).toEqual([]);
      }
    },
  );

  test("no administrator permission has leaked into a frozen column's update list", () => {
    /*
     * The empty-array assertions above already cover this, but they read as
     * "this happens to be empty" rather than "these permissions specifically
     * must never appear". Stating the second form separately means a future
     * mirroring of the widened lists fails against a test that names the reason.
     */
    const models: Array<BaseModel> = [
      new UserNotificationRule(),
      ...METHOD_MODELS.map(([, modelType]: [string, ModelConstructor]) => {
        return new modelType();
      }),
    ];

    for (const model of models) {
      for (const columnName of FROZEN_COLUMNS) {
        const updateList: Array<Permission> =
          model.getColumnAccessControlFor(columnName)?.update || [];

        for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
          expect(updateList).not.toContain(grant);
        }
      }
    }
  });

  test("an administrator sending a new owner in an update body is refused by the column gate", () => {
    /*
     * The behavioural teeth of the assertions above. A frozen column is not a
     * documentation exercise: ColumnPermissions rejects the write because the
     * update list is empty and therefore intersects nothing, no matter what the
     * caller holds.
     */
    const rule: UserNotificationRule = new UserNotificationRule();
    rule.userId = OTHER_USER_ID;

    expect(() => {
      return ColumnPermissions.checkDataColumnPermissions(
        UserNotificationRule,
        rule,
        tenantProps(Permission.EditProjectUserNotificationRule),
        DatabaseRequestType.Update,
      );
    }).toThrow(BadDataException);
  });

  test("an administrator may still rewrite the columns a repair actually needs", () => {
    /*
     * The capability has to survive the freeze or the phase delivers nothing.
     * Re-pointing the method FK is the repair; the delay and the opt-out flag
     * are the two preference columns worth correcting. All three carry no
     * redirect risk on their own, because the service layer separately asserts
     * that a method FK being written belongs to the same user as the rule's
     * persisted owner.
     */
    const rule: UserNotificationRule = new UserNotificationRule();
    rule.userEmailId = ObjectID.generate();
    rule.notifyAfterMinutes = 5;
    rule.isOptOut = false;

    expect(() => {
      return ColumnPermissions.checkDataColumnPermissions(
        UserNotificationRule,
        rule,
        tenantProps(Permission.EditProjectUserNotificationRule),
        DatabaseRequestType.Update,
      );
    }).not.toThrow();
  });

  test("the rule's address columns stay create-only even for an administrator", () => {
    /*
     * ruleType and the two severity relations are the cell in the grid a rule
     * occupies. Moving one reads as an edit and behaves as a delete plus a
     * create, so it stays closed to everybody - an administrator repairing a
     * member's setup adds and removes rules rather than sliding one sideways.
     */
    const rule: UserNotificationRule = new UserNotificationRule();

    for (const columnName of [
      "ruleType",
      "incidentSeverityId",
      "alertSeverityId",
    ]) {
      expect(rule.getColumnAccessControlFor(columnName)?.update).toEqual([]);
    }
  });
});

describe("R4 - the new permissions are opt-in, catalogued, and never auto-granted", () => {
  test.each(NEW_GRANULAR_PERMISSIONS)(
    "%s has a catalogue entry, so getTitle does not throw at runtime",
    (permission: Permission): void => {
      /*
       * A granular permission needs BOTH the enum member and a PermissionProps
       * entry. Without the entry, PermissionHelper.getTitle throws
       * BadDataException - and it is called from TablePermission's failure path,
       * so the missing entry would surface as an exception raised while
       * composing the message for a DIFFERENT exception.
       */
      expect(() => {
        return PermissionHelper.getTitle(permission);
      }).not.toThrow();

      expect(PermissionHelper.getTitle(permission).length).toBeGreaterThan(0);
      expect(
        PermissionHelper.getDescription(permission).length,
      ).toBeGreaterThan(0);
    },
  );

  test.each(NEW_GRANULAR_PERMISSIONS)(
    "%s is assignable to a tenant but is not a role permission",
    (permission: Permission): void => {
      /*
       * isRolePermission true would file it under getRolePermissionProps(), the
       * list every default project role is built from - so the ability to read
       * and rewrite a colleague's paging configuration would arrive silently
       * with an existing role instead of being handed out on purpose. It also
       * breaks the roles/granular partition asserted in Permission.test.ts.
       */
      const props: PermissionProps | undefined =
        PermissionHelper.getAllPermissionProps().find(
          (item: PermissionProps) => {
            return item.permission === permission;
          },
        );

      expect(props).toBeDefined();
      expect(props?.isAssignableToTenant).toBe(true);
      expect(props?.isRolePermission).toBe(false);

      expect(
        PermissionHelper.getRolePermissionProps().map(
          (item: PermissionProps) => {
            return item.permission;
          },
        ),
      ).not.toContain(permission);

      expect(
        PermissionHelper.getTenantPermissionProps().map(
          (item: PermissionProps) => {
            return item.permission;
          },
        ),
      ).toContain(permission);
    },
  );

  test.each(NEW_GRANULAR_PERMISSIONS)(
    "%s is not handed to a member who was never granted it",
    (permission: Permission): void => {
      /*
       * Public and CurrentUser are pushed onto every authenticated caller by
       * getUserPermissions itself. Anything that joined them would be held by
       * the entire project the moment it shipped.
       */
      const resolved: Array<Permission> =
        DatabaseCommonInteractionPropsUtil.getUserPermissions(
          memberProps(),
          PermissionType.Allow,
        ).map((item: UserPermission) => {
          return item.permission;
        });

      expect(resolved).toContain(Permission.CurrentUser);
      expect(resolved).not.toContain(permission);
    },
  );

  test.each(NEW_GRANULAR_PERMISSIONS)(
    "%s counts as a real grant rather than an auto-granted one",
    (permission: Permission): void => {
      /*
       * This is the behavioural statement of "not in
       * AUTO_GRANTED_TENANT_PERMISSIONS", which is module-private to
       * TenantPermission. That list is what the intersection subtracts before
       * deciding whether the caller is here purely as some logged-in user; a new
       * permission added to it would appear to lift the scope while actually
       * lifting it for everybody. Asserting the consequence rather than the
       * constant also survives the constant being renamed.
       */
      expect(
        TenantPermission.isAccessGrantedOnlyByCurrentUser(
          UserNotificationRule,
          tenantProps(permission),
          permission === Permission.ReadProjectUserNotificationRule
            ? DatabaseRequestType.Read
            : DatabaseRequestType.Update,
        ),
      ).toBe(false);
    },
  );

  test("a caller holding neither is still treated as here-by-CurrentUser-alone", () => {
    // The control for the assertion above - without it, `false` proves nothing.
    expect(
      TenantPermission.isAccessGrantedOnlyByCurrentUser(
        UserNotificationRule,
        memberProps(),
        DatabaseRequestType.Read,
      ),
    ).toBe(true);
  });

  test.each(NEW_GRANULAR_PERMISSIONS)(
    "%s does not lift the scope on a notification method, however real a grant it is",
    (permission: Permission): void => {
      /*
       * The same helper, pointed at the models the permission deliberately does
       * NOT reach. isAccessGrantedOnlyByCurrentUser answers per model, and here
       * it answers true for every verb because the permission appears in none of
       * these lists - which is what makes the "real grant" result above a
       * statement about the rule table rather than about the permission being
       * powerful everywhere it is held.
       */
      for (const [, modelType] of METHOD_MODELS) {
        for (const requestType of ROW_SCOPED_REQUEST_TYPES) {
          expect(
            TenantPermission.isAccessGrantedOnlyByCurrentUser(
              modelType,
              tenantProps(permission),
              requestType,
            ),
          ).toBe(true);
        }
      }
    },
  );
});

describe("R5 - a project whose teams predate the granular permissions still gets the feature", () => {
  /*
   * Existing project teams are seeded with ROLES only. A brand-new granular
   * permission is therefore held by literally nobody on the day it ships, so a
   * list containing only ReadProjectUserNotificationRule would leave this
   * capability dead on arrival for every project that already exists. The roles
   * are listed ALONGSIDE the granular permission on the rule table for that
   * reason, and this group asserts the consequence rather than trusting the
   * list.
   */

  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s alone - with no granular grant at all - can read another member's rules",
    async (role: Permission): Promise<void> => {
      const query: Query<BaseModel> =
        await TenantPermission.addTenantScopeToQuery(
          UserNotificationRule,
          { userId: OTHER_USER_ID } as Query<BaseModel>,
          null,
          tenantProps(role),
          DatabaseRequestType.Read,
        );

      expect(scopedUserIdOf(query)).toBe(OTHER_USER_ID.toString());
    },
  );

  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s alone can repair another member's rules",
    async (role: Permission): Promise<void> => {
      for (const requestType of [
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        const query: Query<BaseModel> =
          await TenantPermission.addTenantScopeToQuery(
            UserNotificationRule,
            { userId: OTHER_USER_ID } as Query<BaseModel>,
            null,
            tenantProps(role),
            requestType,
          );

        expect(scopedUserIdOf(query)).toBe(OTHER_USER_ID.toString());
      }
    },
  );

  test.each(METHOD_MODELS)(
    "%s is unreadable by a role holder too, so the reach stops at the rule table",
    async (_name: string, modelType: ModelConstructor): Promise<void> => {
      /*
       * The boundary of the previous two assertions. ProjectOwner is the most
       * powerful role a project has, and it still cannot reach a colleague's
       * notification method - so "an administrator can see a member's paging
       * configuration" means the RULES and their method FK ids, and stops
       * exactly there. Asserted per role rather than only for the granular
       * permission because a role is what an existing project actually holds.
       */
      for (const role of [Permission.ProjectOwner, Permission.ProjectAdmin]) {
        await expect(
          TenantPermission.addTenantScopeToQuery(
            modelType,
            { userId: OTHER_USER_ID } as Query<BaseModel>,
            null,
            tenantProps(role),
            DatabaseRequestType.Read,
          ),
        ).rejects.toThrow(NotAuthorizedException);
      }
    },
  );

  test("both roles sit beside the granular permission in every rule-table list", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    expect(rule.getReadPermissions()).toContain(Permission.ProjectOwner);
    expect(rule.getReadPermissions()).toContain(Permission.ProjectAdmin);
    expect(rule.getReadPermissions()).toContain(
      Permission.ReadProjectUserNotificationRule,
    );

    for (const list of [
      rule.getCreatePermissions(),
      rule.getUpdatePermissions(),
      rule.getDeletePermissions(),
    ]) {
      expect(list).toContain(Permission.ProjectOwner);
      expect(list).toContain(Permission.ProjectAdmin);
      expect(list).toContain(Permission.EditProjectUserNotificationRule);
    }
  });

  test.each(METHOD_MODELS)(
    "neither role nor granular permission appears anywhere in %s's lists",
    (_name: string, modelType: ModelConstructor): void => {
      /*
       * The complement of the assertion above, stated as a prohibition so the
       * reason is legible at the point of failure. The literal-equality test in
       * the methods group already fails if any of these arrive; this one fails
       * with a message that names WHICH permission arrived, which is the
       * difference between a five-second diagnosis and a five-minute one.
       */
      const model: BaseModel = new modelType();

      for (const list of [
        model.getReadPermissions(),
        model.getCreatePermissions(),
        model.getUpdatePermissions(),
        model.getDeletePermissions(),
      ]) {
        for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
          expect(list).not.toContain(grant);
        }
      }
    },
  );
});

describe("the create-side ownership gate survived the widening", () => {
  /*
   * Phase 2.5 closed a hole in which create checked column NAMES but never the
   * ownership VALUE, so a caller could write a row owned by somebody else. That
   * gate is permission-AWARE: CurrentUser alone means "you may create rows for
   * yourself and nobody else", while a real role permission in the create list
   * makes it defer.
   *
   * Widening the rule table's create list is exactly the change that could have
   * weakened it, because a member's intersection now has more candidates to
   * survive. It does not - the member holds none of the added permissions - but
   * that is a fact about the caller, not about the list, so it needs asserting.
   */

  test("a plain member still cannot create a rule owned by another user", () => {
    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        makeRow(UserNotificationRule, OTHER_USER_ID) as never,
        memberProps(),
      );
    }).toThrow(NotAuthorizedException);
  });

  test("the refusal still names the problem", () => {
    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        makeRow(UserNotificationRule, OTHER_USER_ID) as never,
        memberProps(),
      );
    }).toThrow(/another user's/i);
  });

  test("a member creating a rule for themselves is untouched", () => {
    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        makeRow(UserNotificationRule, CALLER_ID) as never,
        memberProps(),
      );
    }).not.toThrow();
  });

  test("a member omitting the owner is stamped rather than refused", () => {
    const row: BaseModel = makeRow(UserNotificationRule, undefined);

    CreatePermission.checkCreatePermissions(
      UserNotificationRule,
      row as never,
      memberProps(),
    );

    expect(row.getColumnValue("userId")?.toString()).toBe(CALLER_ID.toString());
  });

  test("a member cannot plant an opt-out row to silence somebody else", () => {
    /*
     * The denial-of-paging direction of the same hole. An opt-out row is how a
     * user says "do not page me here"; planted on somebody else it suppresses
     * their pages AND suppresses the fallback that would otherwise rescue them,
     * because it is a genuine matching row.
     */
    const optOut: UserNotificationRule = new UserNotificationRule();
    optOut.projectId = PROJECT_ID;
    optOut.userId = OTHER_USER_ID;
    optOut.isOptOut = true;

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        optOut,
        memberProps(),
      );
    }).toThrow(NotAuthorizedException);
  });

  test.each(ADMIN_WRITE_GRANTS)(
    "%s reaches the service layer rather than being refused by the framework gate",
    (grant: Permission): void => {
      /*
       * The second branch of the create gate, and the one this phase walks
       * through: a caller holding a real role permission in the create list is
       * not stamped, so provisioning a rule for a member who has none is
       * possible at all.
       *
       * THE FRAMEWORK GATE IS NOT THE WHOLE CHECK. It deliberately says nothing
       * about WHICH user may be named, which is why UserNotificationRuleService
       * separately verifies that the supplied userId is a member of
       * props.tenantId before the row is written - without that, this branch
       * hands any administrator the ability to write rules for a user id
       * belonging to another project entirely. Do not read a passing test here
       * as "on-behalf-of creation is safe"; read it as "the framework defers,
       * and the service is where the answer lives".
       */
      expect(() => {
        return CreatePermission.checkCreatePermissions(
          UserNotificationRule,
          makeRow(UserNotificationRule, OTHER_USER_ID) as never,
          tenantProps(grant),
        );
      }).not.toThrow();
    },
  );

  test("a read-only grant does not become a create grant by sitting on the same model", () => {
    /*
     * ReadProjectUserNotificationRule appears in no create list anywhere, so its
     * holder's intersection is the auto-granted CurrentUser alone and the gate
     * enforces ownership on them exactly as on a plain member. Worth its own
     * test because the two granular permissions are granted and revoked
     * together in practice, which makes it easy to assume they behave alike.
     */
    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        makeRow(UserNotificationRule, OTHER_USER_ID) as never,
        tenantProps(Permission.ReadProjectUserNotificationRule),
      );
    }).toThrow(NotAuthorizedException);
  });
});

describe("the credentials behind a notification method, guarded by the table scope alone", () => {
  /*
   * REPLACES the group that used to guard these five columns with a per-column
   * decorator. That decorator - @OwnerOnlyColumn - is gone, and so is the
   * widening that made it necessary. The invariant it protected did not go
   * anywhere: an administrator learns THAT a member has a webhook, never where
   * it points.
   *
   * What enforces it now is the table scope itself, which is why this group is
   * a quarter of the size of the one it replaces. There is no longer a
   * column-level decision to verify per column and per query shape, because
   * there is no query on these models that reaches another member's ROW - so
   * every column on that row, credential or label, is out of reach for the same
   * single reason. The five columns are still enumerated rather than reduced to
   * one representative, because they are what a reader comes here looking for
   * and because "the row is unreachable" is a claim worth checking against the
   * things that would actually matter if it were false.
   *
   * The columns: the webhook URL and its signing secret (both bearer
   * credentials - anyone holding them can impersonate OneUptime to the member's
   * endpoint), the push device token, the Telegram chat id an unverified bot
   * message can be addressed to, and the verification code that turns
   * possession of that chat id into a verified method.
   */

  /*
   * Ordered name-then-column so the two %s placeholders in a test title consume
   * the two strings; a model constructor in a substituted position prints its
   * entire transpiled class body as the test name.
   */
  const CREDENTIAL_COLUMNS: Array<[string, string, ModelConstructor]> = [
    ["UserWebhook", "webhookUrl", UserWebhook],
    ["UserWebhook", "secret", UserWebhook],
    ["UserPush", "deviceToken", UserPush],
    ["UserTelegram", "telegramChatId", UserTelegram],
    ["UserTelegram", "verificationCode", UserTelegram],
  ];

  test.each(CREDENTIAL_COLUMNS)(
    "an administrator selecting %s.%s on another member's row never reaches the row",
    async (
      _name: string,
      column: string,
      modelType: ModelConstructor,
    ): Promise<void> => {
      /*
       * Driven through BasePermission.checkPermissions - the entry point
       * ReadPermission.checkReadPermission and therefore every findBy goes
       * through - rather than through the tenant scope alone, so the refusal
       * asserted is the one a real request receives.
       */
      for (const grant of [...ADMIN_READ_GRANTS, ...ADMIN_WRITE_GRANTS]) {
        await expect(
          BasePermission.checkPermissions(
            modelType,
            { userId: OTHER_USER_ID } as Query<BaseModel>,
            { [column]: true } as Select<BaseModel>,
            tenantProps(grant),
            DatabaseRequestType.Read,
          ),
        ).rejects.toThrow(NotAuthorizedException);
      }
    },
  );

  test.each(CREDENTIAL_COLUMNS)(
    "an unscoped listing that selects %s.%s comes back holding only the caller's own rows",
    async (
      _name: string,
      column: string,
      modelType: ModelConstructor,
    ): Promise<void> => {
      /*
       * The shape a leak actually arrives through, and the one the refusal
       * above cannot cover: an admin listing page fetches a project's methods
       * rather than one member's, so it names no user and cannot be refused for
       * naming the wrong one. It is allowed - and comes back stamped with the
       * caller's own id, which is what makes "allowed" harmless.
       */
      const { query } = await BasePermission.checkPermissions(
        modelType,
        {} as Query<BaseModel>,
        { [column]: true } as Select<BaseModel>,
        tenantProps(Permission.ProjectAdmin),
        DatabaseRequestType.Read,
      );

      expect(ownerIdOf(query)).toBe(CALLER_ID.toString());
    },
  );

  test.each(CREDENTIAL_COLUMNS)(
    "%s.%s is still delivered to its owner, so nothing was fixed by emptying a list",
    async (
      _name: string,
      column: string,
      modelType: ModelConstructor,
    ): Promise<void> => {
      /*
       * The owner reads their own credential constantly - the settings page
       * renders it, verification compares it, delivery uses it. A fix that
       * wrote `read: []` on these columns would satisfy every refusal above and
       * break notification setup for every user in every project, so the
       * companion assertion is not optional.
       *
       * Issued as the UNSCOPED query the settings page actually sends, and by a
       * plain member, because that is the overwhelming majority of traffic to
       * these endpoints.
       */
      await expect(
        BasePermission.checkPermissions(
          modelType,
          {} as Query<BaseModel>,
          { [column]: true } as Select<BaseModel>,
          memberProps(),
          DatabaseRequestType.Read,
        ),
      ).resolves.toBeDefined();
    },
  );
});

describe("the rule relation - an administrator reads the FK, never the method behind it", () => {
  /*
   * THE ONE PATH THAT DOES NOT PASS THROUGH THE METHOD TABLE'S SCOPE, and
   * therefore the only place the guarantee above has to be re-established
   * rather than inherited.
   *
   * A read of UserNotificationRule is deliberately NOT row-scoped for an
   * administrator - that is the whole feature. A nested relation select issued
   * against that read (`select: { userEmail: { email: true } }`) resolves the
   * method row through the rule's join, so the only scope anywhere in the path
   * is the one the RULE table decided. Two checks stand between the request and
   * the row, and it is worth knowing exactly what each of them looks at:
   *
   *   - SelectPermission.checkSelectPermission validates the OUTER key
   *     (`userEmail`) against UserNotificationRule's column list, by name.
   *   - QueryPermission.checkRelationQueryPermission validates the INNER key
   *     (`email`) against UserEmail's column list - but only after consulting
   *     that column's `canReadOnRelationQuery` flag, and a column carrying
   *     `true` is waved through with no permission check at all. The related
   *     model's TABLE list is never consulted by either check.
   *
   * Neither check can see the query, so neither can tell whose row this is.
   * That leaves the outer column list as the only place the decision can be
   * made, and it is why the seven method RELATION columns on
   * UserNotificationRule are `read: [Permission.CurrentUser]` while the seven
   * FK ID columns beside them are admin-readable. The pairing is the design in
   * one line: an administrator may learn WHICH method a rule points at, and may
   * re-point it at a different one, without ever learning what the method IS.
   * The id is a foreign key rather than a secret; the identifier behind it is
   * the secret, and OnCallReadinessService is where an administrator gets a
   * masked version of it.
   *
   * Asserted through the real permission entry point rather than by reading the
   * decorators, because the decorator is the mechanism and the refusal is the
   * guarantee - and this is precisely the path on which a plausible-looking
   * decorator has already failed to produce the refusal once.
   */

  const METHOD_FK_COLUMNS: Array<string> = [
    "userEmailId",
    "userSmsId",
    "userCallId",
    "userPushId",
    "userWhatsAppId",
    "userTelegramId",
    "userWebhookId",
  ];

  /*
   * Relation column, the identifier column selected through it, and the model
   * it resolves to. One entry per method, each naming the field that IS the
   * credential or the contact point for that channel.
   */
  const RELATION_SELECT_SHAPES: Array<[string, string]> = [
    ["userEmail", "email"],
    ["userSms", "phone"],
    ["userCall", "phone"],
    ["userPush", "deviceToken"],
    ["userWhatsApp", "phone"],
    ["userTelegram", "telegramChatId"],
    ["userWebhook", "webhookUrl"],
  ];

  test.each(ADMIN_READ_GRANTS)(
    "%s reads another member's rule together with every method FK id",
    async (grant: Permission): Promise<void> => {
      /*
       * The capability half, and it has to pass or the refusal below has taken
       * the feature with it. Selecting all seven ids at once rather than one
       * representative, because the admin surface renders the whole row and a
       * single narrowed column would break the page while six tests still
       * passed.
       */
      const { query } = await BasePermission.checkPermissions(
        UserNotificationRule,
        { userId: OTHER_USER_ID } as Query<BaseModel>,
        {
          ...Object.fromEntries(
            METHOD_FK_COLUMNS.map((column: string) => {
              return [column, true];
            }),
          ),
          userId: true,
          ruleType: true,
        } as Select<BaseModel>,
        tenantProps(grant),
        DatabaseRequestType.Read,
      );

      expect(ownerIdOf(query)).toBe(OTHER_USER_ID.toString());
    },
  );

  test("an administrator selecting a method's fields through the relation is refused", async () => {
    /*
     * The guarantee, run across every method and every permission that opens
     * the rule table, and collected rather than asserted one at a time so a
     * single failure names every combination that leaks instead of stopping at
     * the first.
     *
     * Deliberately agnostic about HOW the framework refuses: throwing is what
     * the select gate does today, but stripping the relation from the select
     * would be equally sound. What must never happen is the nested selection
     * surviving into the read the database is asked to perform, because at that
     * point the join has already been written against a query scoped to
     * somebody else.
     */
    const leaked: Array<string> = [];

    for (const [relation, column] of RELATION_SELECT_SHAPES) {
      for (const grant of ADMIN_READ_GRANTS) {
        const select: Select<BaseModel> = {
          [relation]: { [column]: true },
        } as Select<BaseModel>;

        let refused: boolean = false;

        try {
          await BasePermission.checkPermissions(
            UserNotificationRule,
            { userId: OTHER_USER_ID } as Query<BaseModel>,
            select,
            tenantProps(grant),
            DatabaseRequestType.Read,
          );
        } catch {
          refused = true;
        }

        if (
          !refused &&
          (select as Record<string, unknown>)[relation] !== undefined
        ) {
          leaked.push(`${relation}.${column} to ${grant}`);
        }
      }
    }

    expect(leaked).toEqual([]);
  });

  test("a member selecting a method's fields through the relation on their OWN rules still works", async () => {
    /*
     * The constraint the refusal has to respect, and the reason it cannot be
     * implemented by narrowing the related column or by clearing
     * canReadOnRelationQuery on it. Every notification-rule table in the
     * dashboard renders "which address does this rule page" for its owner, and
     * that render is exactly this select issued by a plain member whose query
     * carries no userId until TenantPermission stamps one on.
     *
     * A fix that inspects the caller's raw query rather than the scoped one
     * sees no userId here, concludes the read is not owner-scoped, and breaks
     * notification setup for every user in every project.
     */
    for (const [relation, column] of RELATION_SELECT_SHAPES) {
      await expect(
        BasePermission.checkPermissions(
          UserNotificationRule,
          {} as Query<BaseModel>,
          { [relation]: { [column]: true } } as Select<BaseModel>,
          memberProps(),
          DatabaseRequestType.Read,
        ),
      ).resolves.toBeDefined();
    }
  });

  test("the FK id columns are admin-readable and the relation columns beside them are not", () => {
    /*
     * The decorator-level statement of the pairing the two behavioural tests
     * above assert from either side. Kept because the behaviour and the
     * declaration can drift in one direction silently: a relation column
     * widened to match its FK sibling "for consistency" is a one-line change
     * that reads as tidying, and this fails on the commit that makes it rather
     * than on the request that exploits it.
     */
    const rule: UserNotificationRule = new UserNotificationRule();

    for (const column of METHOD_FK_COLUMNS) {
      expect(rule.getColumnAccessControlFor(column)?.read).toEqual([
        Permission.CurrentUser,
        ...ADMIN_READ_GRANTS,
      ]);
    }

    for (const [relation] of RELATION_SELECT_SHAPES) {
      expect(rule.getColumnAccessControlFor(relation)?.read).toEqual([
        Permission.CurrentUser,
      ]);
    }
  });
});
