import Permission, { UserPermission } from "../Permission";
import DatabaseCommonInteractionProps from "./DatabaseCommonInteractionProps";
import NotAuthenticatedException from "../Exception/NotAuthenticatedException";
import UserType from "../UserType";

export enum PermissionType {
  Allow = "Allow",
  Block = "Block",
}

export default class DatabaseCommonInteractionPropsUtil {
  public static readonly AUTHENTICATION_REQUIRED_MESSAGE: string =
    "Authentication required. Please log in to access this resource.";

  /*
   * No credentials at all: no user, no project API key, no master key.
   *
   * In practice this is almost never a stranger. The dashboard's access-token
   * cookie expires together with the JWT inside it, so once a tab has sat idle
   * past the token lifetime the browser simply stops sending it, and
   * getUserMiddleware lets the request through as Public with no userId. The
   * caller is a signed-in user whose session needs refreshing.
   */
  public static isAnonymous(props: DatabaseCommonInteractionProps): boolean {
    if (props.userId) {
      return false;
    }

    return (
      props.userType !== UserType.API && props.userType !== UserType.MasterAdmin
    );
  }

  /*
   * "Who are you?" comes before "may you?". An anonymous caller has to be
   * refused with 401, never 422 or 400: the browser client refreshes the
   * session and replays the request on a 401 and on nothing else, so any other
   * status leaves a signed-in user looking at a bogus error.
   */
  public static assertCredentialsPresent(
    props: DatabaseCommonInteractionProps,
  ): void {
    if (DatabaseCommonInteractionPropsUtil.isAnonymous(props)) {
      throw new NotAuthenticatedException(
        DatabaseCommonInteractionPropsUtil.AUTHENTICATION_REQUIRED_MESSAGE,
      );
    }
  }

  public static getUserPermissions(
    props: DatabaseCommonInteractionProps,
    permissionType: PermissionType,
  ): Array<UserPermission> {
    /*
     * Check first if the user has Global Permissions.
     * Global permissions includes all the tenantId user has access to.
     * and it includes all the global permissions that applies to all the tenant, like PUBLIC.
     */
    if (!props.userGlobalAccessPermission) {
      props.userGlobalAccessPermission = {
        globalPermissions: [Permission.Public],
        projectIds: [],
        _type: "UserGlobalAccessPermission",
      };
    }

    // If the PUBLIC Permission is not found in global permissions, include it.
    if (
      props.userGlobalAccessPermission &&
      !props.userGlobalAccessPermission.globalPermissions.includes(
        Permission.Public,
      )
    ) {
      props.userGlobalAccessPermission.globalPermissions.push(
        Permission.Public,
      ); // add public permission if not already.
    }

    // If the CurrentUser Permission is not found in global permissions, include it.
    if (
      props.userId &&
      props.userGlobalAccessPermission &&
      !props.userGlobalAccessPermission.globalPermissions.includes(
        Permission.CurrentUser,
      )
    ) {
      props.userGlobalAccessPermission.globalPermissions.push(
        Permission.CurrentUser,
      );
    }

    let userPermissions: Array<UserPermission> = [];

    // Include global permission in userPermissions.

    if (
      props.userGlobalAccessPermission &&
      permissionType === PermissionType.Allow
    ) {
      /// take global permissions.
      userPermissions = props.userGlobalAccessPermission.globalPermissions.map(
        (permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          };
        },
      );
    }

    if (props.tenantId && props.userTenantAccessPermission) {
      // Include Tenant Permission in userPermissions.
      userPermissions = [
        ...userPermissions,
        ...(props.userTenantAccessPermission[
          props.tenantId.toString()
        ]?.permissions.filter((userPermission: UserPermission) => {
          return (
            userPermission.isBlockPermission ===
            (permissionType === PermissionType.Block)
          );
        }) || []),
      ];
    }

    return userPermissions;
  }
}
