import DataMigrationBase from "./DataMigrationBase";
import { LIMIT_INFINITY } from "Common/Types/Database/LimitMax";
import IncidentRoleService from "Common/Server/Services/IncidentRoleService";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import IconProp from "Common/Types/Icon/IconProp";

export default class AddDefaultIconsToIncidentRoles extends DataMigrationBase {
  public constructor() {
    super("AddDefaultIconsToIncidentRoles");
  }

  public override async migrate(): Promise<void> {
    // Get all incident roles without icons
    const roles: Array<IncidentRole> = await IncidentRoleService.findBy({
      query: {},
      select: {
        _id: true,
        name: true,
        roleIcon: true,
      },
      skip: 0,
      limit: LIMIT_INFINITY,
      props: {
        isRoot: true,
      },
    });

    for (const role of roles) {
      // Skip roles that already have an icon
      if (role.roleIcon) {
        continue;
      }

      // Assign default icons based on role name
      let defaultIcon: IconProp | undefined;

      const roleName: string = role.name?.toLowerCase() || "";

      if (roleName.includes("commander")) {
        defaultIcon = IconProp.ShieldCheck;
      } else if (roleName.includes("responder")) {
        defaultIcon = IconProp.Wrench;
      } else if (
        roleName.includes("communication") ||
        roleName.includes("lead")
      ) {
        defaultIcon = IconProp.Announcement;
      } else if (roleName.includes("observer")) {
        defaultIcon = IconProp.Activity;
      } else {
        // Default icon for other roles
        defaultIcon = IconProp.User;
      }

      await IncidentRoleService.updateOneById({
        id: role.id!,
        data: {
          roleIcon: defaultIcon,
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
