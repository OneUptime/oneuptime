import DataMigrationBase from "./DataMigrationBase";
import { LIMIT_INFINITY } from "Common/Types/Database/LimitMax";
import IncidentRoleService from "Common/Server/Services/IncidentRoleService";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";

export default class UpdateObserverRoleToAllowMultipleUsers extends DataMigrationBase {
  public constructor() {
    super("UpdateObserverRoleToAllowMultipleUsers");
  }

  public override async migrate(): Promise<void> {
    // Get all Observer roles across all projects
    const observerRoles: Array<IncidentRole> = await IncidentRoleService.findBy(
      {
        query: {
          name: "Observer",
        },
        select: {
          _id: true,
          canAssignMultipleUsers: true,
        },
        skip: 0,
        limit: LIMIT_INFINITY,
        props: {
          isRoot: true,
        },
      },
    );

    for (const role of observerRoles) {
      // Update the role to allow multiple users
      if (!role.canAssignMultipleUsers) {
        await IncidentRoleService.updateOneById({
          id: role.id!,
          data: {
            canAssignMultipleUsers: true,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
