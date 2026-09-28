import IncidentSubscriberAudienceBuilder from "../../../../Server/Utils/StatusPage/IncidentSubscriberAudienceBuilder";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The gate on POST /incident/subscriber-audience.
 *
 * What is behind it is a look-ahead at who an incident's status page
 * notifications would reach, before anything is sent, so it tells the caller
 * which of the project's status pages list the incident's monitors and how
 * many people subscribe to each. That is worth a gate of its own: the answer
 * is assembled from pages the caller may not be able to read, and the builder
 * only holds back their *names* - the counts are summarised either way.
 *
 * Everything here is pure. The permission list is read through
 * DatabaseCommonInteractionPropsUtil.getUserPermissions(Allow), and the
 * interesting part is what that does and does not count as a grant: the
 * tenant's permission list carries allow and block rows together, and the
 * rows for other projects sit in the same dictionary.
 */

const PROJECT_ID: string = "a0000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "a0000000-0000-4000-8000-000000000002";
const USER_ID: string = "c0000000-0000-4000-8000-000000000001";

function userPermission(
  permission: Permission,
  isBlockPermission: boolean = false,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: isBlockPermission,
  };
}

function tenantAccess(
  projectId: string,
  permissions: Array<UserPermission>,
): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(projectId),
    permissions: permissions,
  };
}

// A signed-in project user holding exactly the permissions given.
function callerWith(
  permissions: Array<UserPermission>,
  projectId: string = PROJECT_ID,
): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID(USER_ID),
    tenantId: new ObjectID(PROJECT_ID),
    userTenantAccessPermission: {
      [projectId]: tenantAccess(projectId, permissions),
    },
  };
}

function refusalFor(props: DatabaseCommonInteractionProps): Error | null {
  try {
    IncidentSubscriberAudienceBuilder.assertCallerMaySeeAudience(props);
  } catch (err) {
    return err as Error;
  }

  return null;
}

describe("IncidentSubscriberAudienceBuilder.assertCallerMaySeeAudience", () => {
  /*
   * The roles the audience is shown to: the ones that can declare an incident,
   * edit one, or post a public note on one. Pinned one by one rather than by
   * looping over PERMISSIONS, so that widening the list is a deliberate edit
   * here and not something a test silently follows.
   */
  const ALLOWED: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.CreateProjectIncident,
    Permission.EditProjectIncident,
    Permission.CreateIncidentPublicNote,
  ];

  test.each(ALLOWED)("%s may see the audience", (permission: Permission) => {
    expect(refusalFor(callerWith([userPermission(permission)]))).toBeNull();
  });

  test("the allowed list is exactly these roles, and nothing has been added to it unnoticed", () => {
    expect([...IncidentSubscriberAudienceBuilder.PERMISSIONS].sort()).toEqual(
      [...ALLOWED].sort(),
    );
  });

  /*
   * The roles that read an incident but cannot declare, edit or comment on
   * one. Reading an incident is not reading who its status pages would tell
   * about it.
   */
  test.each([
    Permission.ProjectUser,
    Permission.ReadProjectIncident,
    Permission.Public,
    Permission.CurrentUser,
    Permission.CreateProjectMonitor,
    Permission.ReadStatusPageSubscriber,
  ])("%s may not see the audience", (permission: Permission) => {
    expect(refusalFor(callerWith([userPermission(permission)]))).toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("a caller with no permissions at all is refused", () => {
    expect(refusalFor({})).toBeInstanceOf(NotAuthorizedException);
  });

  /*
   * The nuance the builder's own comment calls out. A tenant's permission list
   * holds grants and denials in one array, told apart only by
   * isBlockPermission, so a team that *blocks* Incident Admin must not read as
   * a team that grants it. Reading the raw list instead of going through
   * getUserPermissions(Allow) would let a blocked role through.
   */
  test("a blocked permission is not a grant of it", () => {
    const blocked: DatabaseCommonInteractionProps = callerWith([
      userPermission(Permission.IncidentAdmin, true),
    ]);

    expect(refusalFor(blocked)).toBeInstanceOf(NotAuthorizedException);
  });

  test("a block row does not cancel a real grant carried alongside it", () => {
    /*
     * Both rows are for permissions on the list. Only the allow row counts,
     * and one allow row is all the gate asks for - this is a gate on the
     * route, not the label-level filtering the queries underneath still do.
     */
    const mixed: DatabaseCommonInteractionProps = callerWith([
      userPermission(Permission.IncidentMember, true),
      userPermission(Permission.IncidentAdmin),
    ]);

    expect(refusalFor(mixed)).toBeNull();
  });

  /*
   * userTenantAccessPermission is keyed by project, and a user is typically in
   * several. Only the tenant the request is for may answer for it.
   */
  test("a permission held in another project does not open this one", () => {
    const elsewhere: DatabaseCommonInteractionProps = callerWith(
      [userPermission(Permission.ProjectAdmin)],
      OTHER_PROJECT_ID,
    );

    expect(refusalFor(elsewhere)).toBeInstanceOf(NotAuthorizedException);
  });

  test("with no tenant on the request, project permissions are not read at all", () => {
    const noTenant: DatabaseCommonInteractionProps = {
      userId: new ObjectID(USER_ID),
      userTenantAccessPermission: {
        [PROJECT_ID]: tenantAccess(PROJECT_ID, [
          userPermission(Permission.ProjectOwner),
        ]),
      },
    };

    expect(refusalFor(noTenant)).toBeInstanceOf(NotAuthorizedException);
  });

  // The master admin bypass, which is checked before any list is read.
  test("a master admin may see the audience holding nothing else", () => {
    expect(refusalFor({ isMasterAdmin: true })).toBeNull();
  });

  /*
   * isRoot is how the server's own internal calls run, and it is deliberately
   * not the bypass here: this gate is about a request that arrived on the
   * route. The jobs that actually send do not come through it.
   */
  test("isRoot alone is not the bypass", () => {
    expect(refusalFor({ isRoot: true })).toBeInstanceOf(NotAuthorizedException);
  });

  test("a global permission on the allowed list is honoured", () => {
    /*
     * Global permissions apply across every project the user belongs to, and
     * getUserPermissions folds them in for PermissionType.Allow.
     */
    const globallyPermitted: DatabaseCommonInteractionProps = {
      userId: new ObjectID(USER_ID),
      tenantId: new ObjectID(PROJECT_ID),
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [new ObjectID(PROJECT_ID)],
        globalPermissions: [Permission.ProjectMember],
      },
    };

    expect(refusalFor(globallyPermitted)).toBeNull();
  });

  /*
   * getUserPermissions adds Public, and CurrentUser for a signed-in caller, to
   * whatever it was given. Neither is on the list, so the implicit pair must
   * not amount to a grant - otherwise every authenticated caller would pass.
   */
  test("the Public and CurrentUser permissions every caller gets do not amount to a grant", () => {
    const bare: DatabaseCommonInteractionProps = {
      userId: new ObjectID(USER_ID),
      tenantId: new ObjectID(PROJECT_ID),
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [new ObjectID(PROJECT_ID)],
        globalPermissions: [],
      },
    };

    expect(refusalFor(bare)).toBeInstanceOf(NotAuthorizedException);
  });

  /*
   * The refusal is shown to the person who pressed the button, so it has to
   * say what would fix it rather than just "not authorized".
   */
  test("the refusal names the roles that would let the caller in", () => {
    const refusal: Error | null = refusalFor(callerWith([]));

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal!.message).toContain("Incident Admin");
    expect(refusal!.message).toContain("Create Incident Public Note");
  });
});
