import LocalStorage from './LocalStorage';
import { JSONObject } from 'Common/Types/JSON';
import { UserGlobalAccessPermission } from 'Common/Types/Permission';
import { UserProjectAccessPermission } from 'Common/Types/Permission';

export default class PermissionUtil {
    public static getGlobalPermissions(): UserGlobalAccessPermission | null {
        if (!LocalStorage.getItem('global_permissions')) {
            return null;
        }
        const globalPermissions: JSONObject = LocalStorage.getItem(
            'global_permissions'
        ) as JSONObject;

        return globalPermissions as UserGlobalAccessPermission;
    }

    public static getProjectPermissions(): UserProjectAccessPermission | null {
        if (!LocalStorage.getItem('project_permissions')) {
            return null;
        }
        const permissions: JSONObject = LocalStorage.getItem(
            'project_permissions'
        ) as JSONObject;

        return permissions as UserProjectAccessPermission;
    }

    public static setGlobalPermissions(
        permissions: UserGlobalAccessPermission
    ): void {
        LocalStorage.setItem('global_permissions', permissions);
    }

    public static setProjectPermissions(
        permissions: UserProjectAccessPermission
    ): void {
        LocalStorage.setItem('project_permissions', permissions);
    }
}
