import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUserService from "Common/Server/Services/ProjectUserService";

export default class RefreshProjectUsers extends DataMigrationBase {
  public constructor() {
    super("RefreshProjectUsers");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    const projects: Array<Project> = await ProjectService.findBy({
      query: {},
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      await ProjectUserService.refreshProjectUsersByProject({
        projectId: project.id!,
      });
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
