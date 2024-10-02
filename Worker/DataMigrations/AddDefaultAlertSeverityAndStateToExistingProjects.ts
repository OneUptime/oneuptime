import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";

export default class AddDefaultAlertSeverityAndStateToExistingProjects extends DataMigrationBase {
  public constructor() {
    super("AddDefaultAlertSeverityAndStateToExistingProjects");
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
      await ProjectService.addDefaultAlertSeverity(project);
      await ProjectService.addDefaultAlertState(project);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
