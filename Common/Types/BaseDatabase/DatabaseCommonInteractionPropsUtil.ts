import Permission, { UserPermission } from '../Permission';
import DatabaseCommonInteractionProps from './DatabaseCommonInteractionProps';

export default class DatabaseCommonInteractionPropsUtil {
    public static getUserPermissions(
        props: DatabaseCommonInteractionProps
    ): Array<UserPermission> {
        // Check first if the user has Global Permissions.
        // Global permissions includes all the tenantId user has access to.
        // and it includes all the global permissions that applies to all the tenant, like PUBLIC.
        if (!props.userGlobalAccessPermission) {
            props.userGlobalAccessPermission = {
                globalPermissions: [Permission.Public],
                projectIds: [],
                _type: 'UserGlobalAccessPermission',
            };
        }

        // If the PUBLIC Permission is not found in global permissions, include it.
        if (
            props.userGlobalAccessPermission &&
            !props.userGlobalAccessPermission.globalPermissions.includes(
                Permission.Public
            )
        ) {
            props.userGlobalAccessPermission.globalPermissions.push(
                Permission.Public
            ); // add public permission if not already.
        }

        // If the CurrentUser Permission is not found in global permissions, include it.
        if (
            props.userId &&
            props.userGlobalAccessPermission &&
            !props.userGlobalAccessPermission.globalPermissions.includes(
                Permission.CurrentUser
            )
        ) {
            props.userGlobalAccessPermission.globalPermissions.push(
                Permission.CurrentUser
            );
        }

        let userPermissions: Array<UserPermission> = [];

        // Include global permission in userPermissions.

        if (props.userGlobalAccessPermission) {
            /// take global permissions.
            userPermissions =
                props.userGlobalAccessPermission.globalPermissions.map(
                    (permission: Permission) => {
                        return {
                            permission: permission,
                            labelIds: [],
                            _type: 'UserPermission',
                        };
                    }
                );
        }

        if (props.tenantId && props.userTenantAccessPermission) {
            // Include Tenant Permission in userPermissions.
            userPermissions = [
                ...userPermissions,
                ...(props.userTenantAccessPermission[props.tenantId.toString()]
                    ?.permissions || []),
            ];
        }

        return userPermissions;
    }
}
