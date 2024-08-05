import DataMigrationBase from "./DataMigrationBase";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import IncidentService from "CommonServer/Services/IncidentService";
import IncidentStateTimelineService from "CommonServer/Services/IncidentStateTimelineService";
import ProjectService from "CommonServer/Services/ProjectService";
import QueryHelper from "CommonServer/Types/Database/QueryHelper";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Project from "Common/Models/DatabaseModels/Project";

export default class AddStartDateToIncidentStateTimeline extends DataMigrationBase {
  public constructor() {
    super("AddStartDateToIncidentStateTimeline");
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

      const incidents: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: project.id!,
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      for (const incident of incidents) {
        const incidentStateTimelines: Array<IncidentStateTimeline> =
          await IncidentStateTimelineService.findBy({
            query: {
              incidentId: incident.id!,
              startsAt: QueryHelper.isNull(),
            },
            select: {
              _id: true,
              createdAt: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
              isRoot: true,
            },
            sort: {
              createdAt: SortOrder.Ascending,
            },
          });

        for (let i: number = 0; i < incidentStateTimelines.length; i++) {
          await IncidentStateTimelineService.updateOneById({
            id: incidentStateTimelines[i]!.id!,
            data: {
              startsAt: incidentStateTimelines[i]!.createdAt!,
            },
            props: {
              isRoot: true,
            },
          });
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
