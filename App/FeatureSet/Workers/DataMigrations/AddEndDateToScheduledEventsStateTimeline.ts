import DataMigrationBase from "./DataMigrationBase";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ProjectService from "CommonServer/Services/ProjectService";
import ScheduledMaintenanceService from "CommonServer/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "CommonServer/Services/ScheduledMaintenanceStateTimelineService";
import QueryHelper from "CommonServer/Types/Database/QueryHelper";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";

export default class AddEndDateToScheduledEventsStateTimeline extends DataMigrationBase {
  public constructor() {
    super("AddEndDateToScheduledEventsStateTimeline");
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

      const scheduledEvents: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findBy({
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

      for (const scheduledEvent of scheduledEvents) {
        const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
          await ScheduledMaintenanceStateTimelineService.findBy({
            query: {
              scheduledMaintenanceId: scheduledEvent.id!,
              endsAt: QueryHelper.isNull(),
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

        for (
          let i: number = 0;
          i < scheduledMaintenanceStateTimelines.length;
          i++
        ) {
          const statusTimeline: ScheduledMaintenanceStateTimeline | undefined =
            scheduledMaintenanceStateTimelines[i];

          if (!statusTimeline) {
            continue;
          }

          let endDate: Date | null = null;

          if (
            scheduledMaintenanceStateTimelines[i + 1] &&
            scheduledMaintenanceStateTimelines[i + 1]?.createdAt
          ) {
            endDate = scheduledMaintenanceStateTimelines[i + 1]!.createdAt!;
          }

          if (endDate) {
            await ScheduledMaintenanceStateTimelineService.updateOneById({
              id: statusTimeline!.id!,
              data: {
                endsAt: endDate,
              },
              props: {
                isRoot: true,
              },
            });
          }
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
