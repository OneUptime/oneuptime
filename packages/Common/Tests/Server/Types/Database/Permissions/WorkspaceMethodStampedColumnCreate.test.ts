import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import UserSlack from "../../../../../Models/DatabaseModels/UserSlack";
import UserMicrosoftTeams from "../../../../../Models/DatabaseModels/UserMicrosoftTeams";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * REGRESSION PIN for the defect that made the whole feature dead on arrival.
 *
 * UserSlackService / UserMicrosoftTeamsService stamp the workspace identifier,
 * the display name and isVerified onto createBy.data inside onBeforeCreate.
 * DatabaseService.create runs that hook FIRST and only then calls
 * ModelPermission.checkCreatePermissions on the STAMPED data — so the column
 * ACLs are evaluated against values the SERVER wrote, with the CALLER's
 * permissions. When those three columns carried `create: []`, every non-root
 * create was refused with "User is not allowed to create on slackUserId
 * column of Slack Account": no user could ever add Slack or Microsoft Teams
 * as a notification method through the API or the dashboard, and no test
 * noticed because the service suites call the hook directly rather than
 * DatabaseService.create.
 *
 * The columns therefore carry `create: [Permission.CurrentUser]` — the same
 * shape UserWebAuthn uses for its server-stamped isVerified — and the thing
 * that keeps the values out of the CLIENT's hands is the hook itself, which
 * refuses any non-root payload carrying them BEFORE it stamps. These tests
 * pin both halves: the stamped shape passes the column check, and the check
 * itself is really being evaluated (the harness guard).
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

/* Exactly what UserSlackService.onBeforeCreate leaves on createBy.data. */
function stampedUserSlack(): UserSlack {
  const model: UserSlack = new UserSlack();
  model.projectId = projectId;
  model.userId = userId;
  model.slackUserId = "U0123ABCD";
  model.slackUserName = "alice";
  model.isVerified = true;
  return model;
}

/* Exactly what UserMicrosoftTeamsService.onBeforeCreate leaves behind. */
function stampedUserMicrosoftTeams(): UserMicrosoftTeams {
  const model: UserMicrosoftTeams = new UserMicrosoftTeams();
  model.projectId = projectId;
  model.userId = userId;
  model.microsoftTeamsUserId = "e6f1c1f7-aad0-4b6c-9c11-2f5b7c8d9e0f";
  model.microsoftTeamsUserName = "Alice Example";
  model.isVerified = true;
  return model;
}

describe("server-stamped workspace method columns survive the create column check", () => {
  /*
   * Harness guard: a caller with NO permissions at all must still be refused,
   * or every "does not throw" below would pass because the permission set was
   * mis-built rather than because the columns are actually creatable.
   * CurrentUser is auto-granted to authenticated callers by
   * getUserPermissions, so the guard uses a column no list opens: userId's
   * create list contains CurrentUser, but a props object with no userId is
   * unauthenticated and gets nothing.
   */
  it("harness guard: an unauthenticated caller is still refused", () => {
    const props: DatabaseCommonInteractionProps = makeProps([]);
    delete (props as { userId?: ObjectID }).userId;

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        UserSlack,
        stampedUserSlack(),
        props,
        DatabaseRequestType.Create,
      );
    }).toThrow();
  });

  it("a stamped UserSlack passes for a plain authenticated member", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        UserSlack,
        stampedUserSlack(),
        makeProps([Permission.CurrentUser]),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  it("a stamped UserMicrosoftTeams passes for a plain authenticated member", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        UserMicrosoftTeams,
        stampedUserMicrosoftTeams(),
        makeProps([Permission.CurrentUser]),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  /*
   * The other half of the design: opening the column ACL did NOT hand the
   * value to the client — the SERVICE hook refuses any non-root payload that
   * arrives carrying these columns, before anything is stamped. That refusal
   * is pinned in UserSlackService.test.ts / UserMicrosoftTeamsService.test.ts
   * ("cannot be set directly" / "cannot be set to true"); this file exists so
   * that the two halves cannot drift apart unnoticed: if someone reverts the
   * ACL to create: [], the two "passes" tests above fail; if someone removes
   * the hook guards, the service suites fail.
   */
  it("update stays closed: even the owner cannot rewrite the stamped identifier", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        UserSlack,
        { slackUserId: "U-ATTACKER" } as UserSlack,
        makeProps([Permission.CurrentUser]),
        DatabaseRequestType.Update,
      );
    }).toThrow();
  });

  it("update stays closed on the Teams identifier too", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        UserMicrosoftTeams,
        { microsoftTeamsUserId: "spoofed" } as UserMicrosoftTeams,
        makeProps([Permission.CurrentUser]),
        DatabaseRequestType.Update,
      );
    }).toThrow();
  });

  it("update stays closed on isVerified for both models", () => {
    for (const [modelType, data] of [
      [UserSlack, { isVerified: true } as UserSlack],
      [UserMicrosoftTeams, { isVerified: true } as UserMicrosoftTeams],
    ] as Array<[{ new (): UserSlack | UserMicrosoftTeams }, UserSlack]>) {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          modelType,
          data,
          makeProps([Permission.CurrentUser]),
          DatabaseRequestType.Update,
        );
      }).toThrow();
    }
  });
});
