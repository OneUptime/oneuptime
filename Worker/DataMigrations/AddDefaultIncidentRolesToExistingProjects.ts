import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX, { LIMIT_INFINITY } from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import IncidentRoleService from "Common/Server/Services/IncidentRoleService";
import Project from "Common/Models/DatabaseModels/Project";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";

export default class AddDefaultIncidentRolesToExistingProjects extends DataMigrationBase {
  public constructor() {
    super("AddDefaultIncidentRolesToExistingProjects");
  }

  public override async migrate(): Promise<void> {
    // Get all projects
    const projects: Array<Project> = await ProjectService.findBy({
      query: {},
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_INFINITY,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      // Check if this project already has incident roles
      const existingRoles: Array<IncidentRole> =
        await IncidentRoleService.findBy({
          query: {
            projectId: project.id!,
          },
          select: {
            _id: true,
          },
          skip: 0,
          limit: 1,
          props: {
            isRoot: true,
          },
        });

      // Only add default roles if none exist
      if (existingRoles.length === 0) {
        await ProjectService.addDefaultIncidentRoles(project);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
