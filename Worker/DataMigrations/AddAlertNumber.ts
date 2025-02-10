import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertService from "Common/Server/Services/AlertService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

export default class AddAlertNumber extends DataMigrationBase {
  public constructor() {
    super("AddAlertNumber");
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
      const alerts: Array<Alert> = await AlertService.findBy({
        query: {
          projectId: project.id!,
        },
        select: {
          _id: true,
          alertNumber: true,
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

      const totalAlertForProject: number = alerts.length;
      let alertCounter: number = totalAlertForProject; // start from the last alert number

      for (const alert of alerts) {
        await AlertService.updateOneById({
          id: alert.id!,
          data: {
            alertNumber: alertCounter,
          },
          props: {
            isRoot: true,
          },
        });

        alertCounter = alertCounter - 1;
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
