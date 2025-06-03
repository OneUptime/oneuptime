import { EVERY_DAY } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import ProjectService from "Common/Server/Services/ProjectService";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";

RunCron(
  "ScheduledMaintenance:KeepCurrentStateConsistent",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    try {
      // get all projects, then get all scheduled maintenances for each project, then get the last state of each scheduled maintenance and check with the current state of each scheduled maintenance.
      // if they are different, then update the current state of the scheduled maintenance.

      const projects: Array<Project> = await ProjectService.findBy({
        query: {
          ...ProjectService.getActiveProjectStatusQuery(),
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

      for (const project of projects) {
        try {
          if (!project) {
            continue;
          }

          if (!project.id) {
            continue;
          }

          const scheduledMaintenances: Array<ScheduledMaintenance> =
            await ScheduledMaintenanceService.findBy({
              query: {
                projectId: project.id,
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

          for (const scheduledMaintenance of scheduledMaintenances) {
            try {
              if (!scheduledMaintenance) {
                continue;
              }
              if (!scheduledMaintenance.id) {
                continue;
              }
              await ScheduledMaintenanceService.refreshScheduledMaintenanceCurrentStatus(
                scheduledMaintenance.id!,
              );
            } catch (err) {
              logger.error(
                "Error in ScheduledMaintenance:KeepCurrentStateConsistent job",
              );
              logger.error(err);
              continue;
            }
          }
        } catch (err) {
          logger.error(
            "Error in ScheduledMaintenance:KeepCurrentStateConsistent job",
          );
          logger.error(err);
          continue;
        }
      }
    } catch (err) {
      logger.error(
        "Error in ScheduledMaintenance:KeepCurrentStateConsistent job",
      );
      logger.error(err);
    }
  },
);
