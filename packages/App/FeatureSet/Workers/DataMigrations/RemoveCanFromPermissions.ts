import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Permission from "Common/Types/Permission";
import ApiKeyPermissionService from "Common/Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "Common/Server/Services/TeamPermissionService";
import APIKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";

export default class RemoveCanFromPermissions extends DataMigrationBase {
  public constructor() {
    super("RemoveCanFromPermissions");
  }

  public override async migrate(): Promise<void> {
    await this.removeCanFromTeamPermissions();
    await this.removeCanFromAPIPermissions();
  }

  public async removeCanFromTeamPermissions(): Promise<void> {
    const teamPermissions: Array<TeamPermission> =
      await TeamPermissionService.findBy({
        query: {},
        select: {
          permission: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    // check the permission that starts with "Can" and remove  the "Can" prefix and save it.

    for (const teamPermission of teamPermissions) {
      if (!teamPermission.permission) {
        continue;
      }

      if (!teamPermission.permission.startsWith("Can")) {
        continue;
      }

      if (!teamPermission.id) {
        continue;
      }

      teamPermission.permission = teamPermission.permission.substring(
        3,
      ) as Permission;
      // update this permission in the database

      await TeamPermissionService.updateOneById({
        id: teamPermission.id,
        data: {
          permission: teamPermission.permission,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  public async removeCanFromAPIPermissions(): Promise<void> {
    const apiPermissions: Array<APIKeyPermission> =
      await ApiKeyPermissionService.findBy({
        query: {},
        select: {
          permission: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    // check the permission that starts with "Can" and remove  the "Can" prefix and save it.

    for (const apiPermission of apiPermissions) {
      if (!apiPermission.permission) {
        continue;
      }

      if (!apiPermission.permission.startsWith("Can")) {
        continue;
      }

      if (!apiPermission.id) {
        continue;
      }

      apiPermission.permission = apiPermission.permission.substring(
        3,
      ) as Permission;
      // update this permission in the database

      await ApiKeyPermissionService.updateOneById({
        id: apiPermission.id,
        data: {
          permission: apiPermission.permission,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
