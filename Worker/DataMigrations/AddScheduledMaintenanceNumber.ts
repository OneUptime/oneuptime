import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

export default class AddScheduledMaintenanceNumber extends DataMigrationBase {
  public constructor() {
    super("AddScheduledMaintenanceNumber");
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
      // add ended scheduled maintenance state for each of these projects.
      // first fetch resolved state. Ended state order is -1 of resolved state.

      // get all incicents for this project
      const scheduledMaintenances: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findBy({
          query: {
            projectId: project.id!,
          },
          select: {
            _id: true,
            scheduledMaintenanceNumber: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          sort: {
            createdAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        });

      const totalScheduledMaintenanceForProject: number =
        scheduledMaintenances.length;
      let scheduledMaintenanceCounter: number =
        totalScheduledMaintenanceForProject; // start from the last scheduledMaintenance number

      for (const scheduledMaintenance of scheduledMaintenances) {
        await ScheduledMaintenanceService.updateOneById({
          id: scheduledMaintenance.id!,
          data: {
            scheduledMaintenanceNumber: scheduledMaintenanceCounter,
          },
          props: {
            isRoot: true,
          },
        });

        scheduledMaintenanceCounter = scheduledMaintenanceCounter - 1;
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
