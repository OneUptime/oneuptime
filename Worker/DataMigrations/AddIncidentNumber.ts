import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentService from "Common/Server/Services/IncidentService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

export default class AddIncidentNumber extends DataMigrationBase {
  public constructor() {
    super("AddIncidentNumber");
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
      const incidents: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: project.id!,
        },
        select: {
          _id: true,
          incidentNumber: true,
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

      const totalIncidentForProject: number = incidents.length;
      let incidentCounter: number = totalIncidentForProject; // start from the last incident number

      for (const incident of incidents) {
        await IncidentService.updateOneById({
          id: incident.id!,
          data: {
            incidentNumber: incidentCounter,
          },
          props: {
            isRoot: true,
          },
        });

        incidentCounter = incidentCounter - 1;
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
