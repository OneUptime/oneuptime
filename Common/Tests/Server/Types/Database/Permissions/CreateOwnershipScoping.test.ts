import ProjectUserProfile from "../../../../../Models/DatabaseModels/ProjectUserProfile";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import UserCall from "../../../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../../../Models/DatabaseModels/UserEmail";
import UserIncomingCallNumber from "../../../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserNotificationRule from "../../../../../Models/DatabaseModels/UserNotificationRule";
import UserNotificationSetting from "../../../../../Models/DatabaseModels/UserNotificationSetting";
import UserOnCallLog from "../../../../../Models/DatabaseModels/UserOnCallLog";
import UserPush from "../../../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../../../Models/DatabaseModels/UserSMS";
import UserSession from "../../../../../Models/DatabaseModels/UserSession";
import UserTelegram from "../../../../../Models/DatabaseModels/UserTelegram";
import UserTotpAuth from "../../../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../../../Models/DatabaseModels/UserWebAuthn";
import UserWebhook from "../../../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../../../Models/DatabaseModels/UserWhatsApp";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE GUARDS
 *
 * Read, update and delete each convert Permission.CurrentUser into a ROW
 * PREDICATE: TenantPermission.addCurrentUserScopeToQuery rewrites the query to
 * `userId = me`, and throws outright if the caller named somebody else. Create
 * had no equivalent, and the omission was explicit rather than accidental — the
 * misconfiguration guard in TenantPermission reads
 * `isAccessGrantedOnlyByCurrentUser && type !== DatabaseRequestType.Create`.
 *
 * CreatePermission.checkCreatePermissions asks three questions: is the caller
 * blocked, may they write to this TABLE, and may they write to these COLUMNS.
 * None of them looks at the ownership VALUE — checkTableLevelPermissions is not
 * even handed the data object, and checkDataColumnPermissions is a pure
 * allow-list intersection over column names. So on any model whose create list
 * is CurrentUser-only, a caller could write a row owned by somebody else.
 *
 * Fourteen models have that shape, and every one of them is a "my own X"
 * resource: notification rules, all seven notification methods behind them,
 * sessions, TOTP and WebAuthn credentials, workspace tokens. On the
 * notification models the ownership column is not bookkeeping — it decides
 * whose on-call pages select the row, while the address actually messaged is
 * read from the method relation the row points at. A row owned by one person
 * pointing at another person's method sends the first person's pages to the
 * second person's address.
 *
 * Some services compound it. UserWebhookService.onCreateSuccess seeds a full set
 * of default notification rules for whatever userId the new webhook carries, and
 * UserWebhook has no isVerified column at all ("Webhooks skip verification"), so
 * a single create can propagate the mistake into rules the requester never
 * touched — and those rules are internally consistent, so a check that merely
 * compared a rule against its own method would pass them.
 *
 * The fix constrains the ownership VALUE at the framework layer, and is
 * permission-AWARE rather than a blanket stamp: a caller who genuinely holds a
 * role permission in the model's create list is left alone, so administrative
 * on-behalf-of creation stays possible. These tests pin both halves — that the
 * hole is closed, and that the four behaviours which must NOT change did not.
 */

const CALLER_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

/*
 * A plain project member: authenticated, holding only the permissions every
 * logged-in caller is auto-granted. This is the attacker's session in the
 * scenario above, and also the ordinary shape of a first-party dashboard
 * request.
 */
function memberProps(): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
  };
}

/*
 * A caller who additionally holds a real role permission FOR THE TENANT. Used to
 * prove the check defers rather than blanket-stamping - the property Phase 3's
 * admin-on-behalf-of editing depends on.
 */
function adminProps(
  permission: Permission = Permission.ProjectAdmin,
): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          {
            permission: permission,
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

type ModelConstructor = { new (): BaseModel };

/*
 * Every model whose create list is exactly [Permission.CurrentUser]. These are
 * the ones the fix protects, and the ones an attacker could previously write on
 * another user's behalf. Enumerated rather than discovered so that adding a
 * fifteenth model with this shape is a deliberate act that shows up in review.
 */
const CURRENT_USER_ONLY_MODELS: Array<[string, ModelConstructor]> = [
  ["UserNotificationRule", UserNotificationRule],
  ["UserWebhook", UserWebhook],
  ["UserEmail", UserEmail],
  ["UserSMS", UserSMS],
  ["UserCall", UserCall],
  ["UserPush", UserPush],
  ["UserWhatsApp", UserWhatsApp],
  ["UserTelegram", UserTelegram],
  ["UserNotificationSetting", UserNotificationSetting],
  ["UserIncomingCallNumber", UserIncomingCallNumber],
  ["UserSession", UserSession],
  ["UserTotpAuth", UserTotpAuth],
  ["UserWebAuthn", UserWebAuthn],
  ["WorkspaceUserAuthToken", WorkspaceUserAuthToken],
];

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

describe("create-time ownership scoping — the hole", () => {
  test.each(CURRENT_USER_ONLY_MODELS)(
    "%s: a member cannot create a row owned by another user",
    (_name: string, modelType: ModelConstructor) => {
      expect(() => {
        return CreatePermission.checkCreatePermissions(
          modelType,
          makeRow(modelType, OTHER_USER_ID) as never,
          memberProps(),
        );
      }).toThrow(NotAuthorizedException);
    },
  );

  test.each(CURRENT_USER_ONLY_MODELS)(
    "%s: the refusal names the problem rather than failing obscurely",
    (_name: string, modelType: ModelConstructor) => {
      expect(() => {
        return CreatePermission.checkCreatePermissions(
          modelType,
          makeRow(modelType, OTHER_USER_ID) as never,
          memberProps(),
        );
      }).toThrow(/another user's/i);
    },
  );

  test("UserNotificationRule: the rule cannot be planted even when it carries a method", () => {
    /*
     * The full shape of the paging hijack: a rule OWNED by the victim, pointing
     * at a notification method the requester controls. Delivery reads the
     * address off the method relation, so the victim's pages would have gone to
     * the requester's address.
     */
    const rule: UserNotificationRule = new UserNotificationRule();
    rule.projectId = PROJECT_ID;
    rule.userId = OTHER_USER_ID;
    rule.userEmailId = new ObjectID("44444444-4444-4444-8444-444444444444");
    rule.notifyAfterMinutes = 0;

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        rule,
        memberProps(),
      );
    }).toThrow(NotAuthorizedException);
  });

  test("UserWebhook: the auto-seeding variant is refused at the same gate", () => {
    /*
     * UserWebhookService.onCreateSuccess seeds default notification rules for
     * whatever userId the webhook carries, and UserWebhook has no isVerified
     * column, so this create alone would have planted a full set of rules for
     * another user pointing at this URL. The rules it seeds are internally
     * consistent - the method and the rule agree on their owner - so nothing
     * downstream would have found them suspicious. It has to be stopped here.
     */
    const webhook: UserWebhook = new UserWebhook();
    webhook.projectId = PROJECT_ID;
    webhook.userId = OTHER_USER_ID;
    webhook.name = "innocuous";

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserWebhook,
        webhook,
        memberProps(),
      );
    }).toThrow(NotAuthorizedException);
  });

  test("an opt-out row cannot be planted on someone else to silence their pages", () => {
    /*
     * The denial-of-paging direction. An opt-out row is how a user says "do not
     * page me here"; planted on somebody else it suppresses their pages, and
     * because it is a real matching row it also suppresses the fallback that
     * would otherwise rescue them.
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

  test("the RELATION spelling of the owner cannot smuggle a row past the scalar check", () => {
    /*
     * `user` and `userId` are two decorated columns that write the same join
     * column. A payload that sets only the relation reaches the gate with the
     * scalar absent, so a check that looked only at `userId` would stamp the
     * caller's own id and then leave the persistence layer holding two
     * disagreeing instructions about who owns the row.
     */
    const rule: UserNotificationRule = new UserNotificationRule();
    rule.setColumnValue("projectId", PROJECT_ID);
    rule.setColumnValue("user", { _id: OTHER_USER_ID.toString() });

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        rule,
        memberProps(),
      );
    }).toThrow(NotAuthorizedException);
  });

  test("a matching relation is cleared, so only one spelling survives to the database", () => {
    /*
     * Even when the relation names the caller themselves it is removed rather
     * than left alongside the scalar. Two spellings of one column is an
     * ambiguity resolved by TypeORM precedence rules; one spelling is not.
     */
    const rule: UserNotificationRule = new UserNotificationRule();
    rule.setColumnValue("projectId", PROJECT_ID);
    rule.setColumnValue("user", { _id: CALLER_ID.toString() });

    CreatePermission.checkCreatePermissions(
      UserNotificationRule,
      rule,
      memberProps(),
    );

    /*
     * Cleared reads back as null rather than undefined - setColumnValue
     * normalises. What matters is that nothing is left carrying an id, so the
     * assertion is on that rather than on the exact empty representation.
     */
    const clearedRelation: unknown = rule.getColumnValue("user");

    expect(clearedRelation).toBeFalsy();
    expect(
      (clearedRelation as Record<string, unknown> | null)?.["_id"],
    ).toBeUndefined();
    expect(rule.getColumnValue("userId")?.toString()).toBe(
      CALLER_ID.toString(),
    );
  });

  test("both spellings disagreeing is refused rather than silently resolved", () => {
    const rule: UserNotificationRule = new UserNotificationRule();
    rule.setColumnValue("projectId", PROJECT_ID);
    rule.setColumnValue("userId", CALLER_ID);
    rule.setColumnValue("user", { _id: OTHER_USER_ID.toString() });

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        rule,
        memberProps(),
      );
    }).toThrow(NotAuthorizedException);
  });

  test("a string-valued ownership column is compared by value, not by identity", () => {
    /*
     * fromJSON may leave the column as a raw string rather than an ObjectID
     * instance. Comparing references, or trusting instanceof, would let the
     * string form straight through.
     */
    const row: UserNotificationRule = new UserNotificationRule();
    row.setColumnValue("projectId", PROJECT_ID);
    (row as unknown as Record<string, unknown>)["userId"] =
      OTHER_USER_ID.toString();

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        row,
        memberProps(),
      );
    }).toThrow(NotAuthorizedException);
  });
});

describe("create-time ownership scoping — what must NOT change", () => {
  test.each(CURRENT_USER_ONLY_MODELS)(
    "%s: creating a row for yourself still works",
    (_name: string, modelType: ModelConstructor) => {
      expect(() => {
        return CreatePermission.checkCreatePermissions(
          modelType,
          makeRow(modelType, CALLER_ID) as never,
          memberProps(),
        );
      }).not.toThrow();
    },
  );

  test.each(CURRENT_USER_ONLY_MODELS)(
    "%s: omitting the owner stamps the caller rather than refusing",
    (_name: string, modelType: ModelConstructor) => {
      /*
       * A first-party client has no reason to echo its own id back, so omission
       * is the common case and must not be an error. Stamping also stops the row
       * being written unowned, which would make it invisible to every scoped
       * read - and therefore undeletable through the same API that created it.
       */
      const row: BaseModel = makeRow(modelType, undefined);

      CreatePermission.checkCreatePermissions(
        modelType,
        row as never,
        memberProps(),
      );

      expect(row.getColumnValue("userId")?.toString()).toBe(
        CALLER_ID.toString(),
      );
    },
  );

  test.each(CURRENT_USER_ONLY_MODELS)(
    "%s: isRoot short-circuits, so internal seeding is untouched",
    (_name: string, modelType: ModelConstructor) => {
      /*
       * addDefaultNotificationRulesForVerifiedMethod, invitation acceptance and
       * the data migrations all create rows for OTHER users with isRoot. If this
       * gate applied to them, every one of those paths would start throwing.
       */
      expect(() => {
        return CreatePermission.checkCreatePermissions(
          modelType,
          makeRow(modelType, OTHER_USER_ID) as never,
          { isRoot: true },
        );
      }).not.toThrow();
    },
  );

  test("a caller holding a role permission in the create list is not blanket-stamped", () => {
    /*
     * The property Phase 3 depends on. ProjectUserProfile's create list contains
     * ProjectOwner/ProjectAdmin/ProjectMember ALONGSIDE CurrentUser, so an admin
     * is not here merely as "some logged-in user" and this check must defer to
     * that permission instead of forcing the row onto them.
     *
     * If this ever starts throwing, the gate has become a blanket stamp and
     * administrative on-behalf-of creation is impossible.
     */
    const profile: ProjectUserProfile = new ProjectUserProfile();
    profile.setColumnValue("projectId", PROJECT_ID);
    profile.setColumnValue("userId", OTHER_USER_ID);

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        ProjectUserProfile,
        profile,
        adminProps(Permission.ProjectMember),
      );
    }).not.toThrow();
  });

  test("User creation is unaffected, so signup cannot regress", () => {
    /*
     * User scopes by _id rather than userId, and its create list is empty, so
     * isAccessGrantedOnlyByCurrentUser is false and this check returns before
     * touching anything. Worth pinning explicitly: a version of this gate that
     * stamped props.userId onto _id would corrupt every account created.
     */
    const user: User = new User();

    expect(() => {
      return CreatePermission.checkCreatePermissions(User, user, {
        isRoot: true,
      });
    }).not.toThrow();

    // BaseModel's _id accessor reports an unset primary key as null, not undefined.
    expect(user.getColumnValue("_id")).toBeNull();
  });

  test("TeamMember is unaffected — its create list is admin permissions, not CurrentUser", () => {
    const member: TeamMember = new TeamMember();
    member.setColumnValue("projectId", PROJECT_ID);
    member.setColumnValue("userId", OTHER_USER_ID);

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        TeamMember,
        member,
        adminProps(Permission.InviteProjectTeamMembers),
      );
    }).not.toThrow();
  });

  test("a model with no ownership column is left alone", () => {
    /*
     * UserOnCallLog carries a userId column but create: [], so nothing may
     * create it through the API at all. The gate must not be what reports that -
     * the table-level check should already have refused.
     */
    const log: UserOnCallLog = new UserOnCallLog();
    log.setColumnValue("projectId", PROJECT_ID);
    log.setColumnValue("userId", OTHER_USER_ID);

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserOnCallLog,
        log,
        memberProps(),
      );
    }).toThrow();
  });
});

describe("create-time ownership scoping — callers with no user identity", () => {
  /*
   * Permission.CurrentUser is auto-granted only when props.userId is set
   * (DatabaseCommonInteractionPropsUtil:39-50), so an ordinary API key never
   * acquires it and is refused one layer earlier, at the table check. The
   * dangerous shape is a non-user caller that carries CurrentUser EXPLICITLY in
   * its global permissions — it clears the table check and arrives here with no
   * identity to own the row. The query side guards exactly this shape; so must
   * create, or the row is written belonging to nobody.
   */
  function identitylessCurrentUserProps(): DatabaseCommonInteractionProps {
    return {
      userType: UserType.API,
      tenantId: PROJECT_ID,
      userGlobalAccessPermission: {
        projectIds: [PROJECT_ID],
        globalPermissions: [Permission.Public, Permission.CurrentUser],
        _type: "UserGlobalAccessPermission",
      },
    };
  }

  test("an ordinary API key is refused before it ever reaches the ownership gate", () => {
    const apiKeyProps: DatabaseCommonInteractionProps = {
      userType: UserType.API,
      tenantId: PROJECT_ID,
    };

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        makeRow(UserNotificationRule, undefined) as never,
        apiKeyProps,
      );
    }).toThrow(NotAuthorizedException);
  });

  test("a caller carrying CurrentUser with no identity is refused by the ownership gate", () => {
    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        makeRow(UserNotificationRule, undefined) as never,
        identitylessCurrentUserProps(),
      );
    }).toThrow(/user session is required/i);
  });

  test("...and cannot smuggle a row in by naming an owner explicitly either", () => {
    expect(() => {
      return CreatePermission.checkCreatePermissions(
        UserWebhook,
        makeRow(UserWebhook, OTHER_USER_ID) as never,
        identitylessCurrentUserProps(),
      );
    }).toThrow(NotAuthorizedException);
  });
});
