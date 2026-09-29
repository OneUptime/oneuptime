import { describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. APIKeyAccessPermission pulls in ApiKeyPermissionService, which reaches
 * it; nothing here touches password hashing, so stub it before that graph is
 * compiled. Same reason and same shape as the stub in
 * Tests/Server/Utils/APIKey/AccessPermission.test.ts.
 */
jest.mock("../../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import TenantPermission from "../../../../../Server/Types/Database/Permissions/TenantPermission";
import APIKeyAccessPermission from "../../../../../Server/Utils/APIKey/AccessPermission";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../../../Models/DatabaseModels/File";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MimeType from "../../../../../Types/File/MimeType";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";

/*
 * Contract under test: an API key is not a logged-in user, and File's gate must
 * not treat it as one.
 *
 * File and FileModel gate on [CurrentUser, AuthenticatedRequest]. CurrentUser is
 * auto-granted to every authenticated caller, so a key that holds nothing else
 * from that list intersects down to CurrentUser alone — and that is exactly the
 * condition TenantPermission.isAccessGrantedOnlyByCurrentUser reports as "this
 * caller is here as nothing more than some logged-in user". A caller in that
 * state is confined to rows they own, which a key can never be: it carries no
 * userId, and both the query-side scope and the create-side ownership check
 * reject it outright rather than run unscoped.
 *
 * Granting Permission.AuthenticatedRequest to API keys is what makes that
 * predicate answer the truth. The permission exists for precisely this - it is a
 * marker for "some authenticated principal made this call", not a capability an
 * administrator grants, and File/FileModel are the only models that name it.
 *
 * Worth being exact about what is and is not broken today, because it decides
 * what this test is for. File declares no user column, so
 * CreatePermission.checkCreateOwnership returns before the userId guard and file
 * creation by API key does NOT currently fail - the third test below pins that
 * it passes both before and after. The predicate is still answering wrongly, and
 * the moment File gains a user column, or a second model adopts the same
 * [CurrentUser, AuthenticatedRequest] pair, the wrong answer stops being
 * harmless. This suite pins the predicate itself rather than the symptom, so
 * that the grant cannot be quietly dropped as unused.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * The tenant half of an API key's permissions. getApiTenantAccessPermission
 * returns the default baseline plus whatever rows the key was configured with;
 * built here rather than called so the suite stays free of the service and its
 * cache. A key with no configured rows is the interesting case - it is the one
 * that has nothing but the auto-granted permissions to intersect with.
 */
function tenantPermissions(): UserTenantAccessPermission {
  const permissions: Array<UserPermission> = [
    Permission.CurrentUser,
    Permission.UnAuthorizedSsoUser,
  ].map((permission: Permission) => {
    return {
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
      _type: "UserPermission",
    };
  });

  return {
    projectId,
    permissions,
    isBlockPermission: false,
    _type: "UserTenantAccessPermission",
  };
}

function apiKeyProps(
  globalPermissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userType: UserType.API,
    userGlobalAccessPermission: {
      projectIds: [projectId],
      globalPermissions: globalPermissions,
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermissions(),
    },
  } as unknown as DatabaseCommonInteractionProps;
}

/*
 * The list as it stood before AuthenticatedRequest was granted. Kept literal
 * rather than derived: it is the negative control, and a control that tracks the
 * production list would silently stop controlling for anything.
 */
const GLOBAL_PERMISSIONS_WITHOUT_MARKER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

function newFile(): File {
  const file: File = new File();
  file.name = "screenshot.png";
  file.fileType = MimeType.png;
  file.file = Buffer.from("not-really-a-png");
  file.isPublic = false;
  return file;
}

/*
 * Every model that names AuthenticatedRequest anywhere in its table or column
 * access control, by model name.
 */
function modelsNamingTheMarker(): Array<string> {
  const naming: Array<string> = [];

  for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
    const model: BaseModel = new modelType();

    const permissions: Array<Permission> = [
      ...(model.createRecordPermissions || []),
      ...(model.readRecordPermissions || []),
      ...(model.updateRecordPermissions || []),
      ...(model.deleteRecordPermissions || []),
    ];

    for (const column of model.getTableColumns().columns) {
      const accessControl: ReturnType<BaseModel["getColumnAccessControlFor"]> =
        model.getColumnAccessControlFor(column);

      if (!accessControl) {
        continue;
      }

      permissions.push(
        ...(accessControl.create || []),
        ...(accessControl.read || []),
        ...(accessControl.update || []),
      );
    }

    if (permissions.includes(Permission.AuthenticatedRequest)) {
      naming.push(modelType.name);
    }
  }

  return naming.sort();
}

describe("API key access to File", () => {
  test("no model other than File gates on the marker", () => {
    /*
     * The grant is unconditional - every API key in every project holds
     * AuthenticatedRequest, and unlike a role permission no administrator can
     * revoke it. What keeps that safe is not the grant but this list: the
     * marker is deliberately absent from
     * TenantPermission.AUTO_GRANTED_TENANT_PERMISSIONS, so any model that
     * starts naming it hands every API key a role-grade way through its gate.
     *
     * Sweeping the models rather than trusting a grep is the point. A new
     * model quietly adopting the [CurrentUser, AuthenticatedRequest] pair is
     * the one change that turns this from bounded to unbounded, and it should
     * fail here and be argued for rather than land unnoticed.
     *
     * This list must only ever shrink. A new entry needs its own review.
     */
    expect(modelsNamingTheMarker()).toEqual(["File"]);
  });

  test("the production global permission list carries the AuthenticatedRequest marker", async () => {
    const permission: UserGlobalAccessPermission =
      await APIKeyAccessPermission.getDefaultApiGlobalPermission(projectId);

    expect(permission.globalPermissions).toContain(
      Permission.AuthenticatedRequest,
    );
  });

  test("a key holding the marker is not mistaken for a bare logged-in user", async () => {
    const permission: UserGlobalAccessPermission =
      await APIKeyAccessPermission.getDefaultApiGlobalPermission(projectId);

    /*
     * Driven off the real list rather than a copy of it: this is the assertion
     * that fails if the grant is ever removed.
     */
    expect(
      TenantPermission.isAccessGrantedOnlyByCurrentUser(
        File,
        apiKeyProps(permission.globalPermissions),
        DatabaseRequestType.Create,
      ),
    ).toBe(false);

    // The negative control: without the marker the predicate answers wrongly.
    expect(
      TenantPermission.isAccessGrantedOnlyByCurrentUser(
        File,
        apiKeyProps(GLOBAL_PERMISSIONS_WITHOUT_MARKER),
        DatabaseRequestType.Create,
      ),
    ).toBe(true);
  });

  test("file creation by API key is allowed either way, because File has no user column", async () => {
    /*
     * Pinned deliberately. The PR that added the grant described this path as
     * broken; it is not, and recording that here keeps the next reader from
     * re-diagnosing a failure that was never happening. What holds it up is
     * File declaring no user column - assert that too, so if File ever gains
     * one this test says which assumption moved.
     */
    expect(new File().getUserColumn()).toBeFalsy();

    const permission: UserGlobalAccessPermission =
      await APIKeyAccessPermission.getDefaultApiGlobalPermission(projectId);

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        File,
        newFile(),
        apiKeyProps(permission.globalPermissions),
      );
    }).not.toThrow();

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        File,
        newFile(),
        apiKeyProps(GLOBAL_PERMISSIONS_WITHOUT_MARKER),
      );
    }).not.toThrow();
  });

  test("a logged-in user still reaches File without the marker", () => {
    /*
     * AccessTokenService hands a user session [Public, User, CurrentUser] and no
     * AuthenticatedRequest, so users continue to arrive through CurrentUser and
     * are unaffected by the grant. Pinned because the asymmetry is deliberate
     * and reads like an oversight otherwise.
     */
    const userProps: DatabaseCommonInteractionProps = {
      tenantId: projectId,
      userId: userId,
      userType: UserType.User,
      userGlobalAccessPermission: {
        projectIds: [projectId],
        globalPermissions: GLOBAL_PERMISSIONS_WITHOUT_MARKER,
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermissions(),
      },
    } as unknown as DatabaseCommonInteractionProps;

    expect(() => {
      return CreatePermission.checkCreatePermissions(
        File,
        newFile(),
        userProps,
      );
    }).not.toThrow();
  });
});
