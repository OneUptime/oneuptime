import { EVERY_DAY } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import ProjectService from "Common/Server/Services/ProjectService";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import MonitorService from "Common/Server/Services/MonitorService";
import Project from "Common/Models/DatabaseModels/Project";
import Monitor from "Common/Models/DatabaseModels/Monitor";

RunCron(
  "Monitor:KeepCurrentStateConsistent",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    try {
      // get all projects, then get all monitors for each project, then get the last status of each monitor and check with the current status of each monitor.
      // if they are different, then update the current status of the monitor.

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

          const monitors: Array<Monitor> = await MonitorService.findBy({
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

          for (const monitor of monitors) {
            try {
              if (!monitor) {
                continue;
              }
              if (!monitor.id) {
                continue;
              }
              await MonitorService.refreshMonitorCurrentStatus(monitor.id!);
            } catch (err) {
              logger.error("Error in KeepCurrentStateConsistent job");
              logger.error(err);
              continue;
            }
          }
        } catch (err) {
          logger.error("Error in KeepCurrentStateConsistent job");
          logger.error(err);
          continue;
        }
      }
    } catch (err) {
      logger.error("Error in KeepCurrentStateConsistent job");
      logger.error(err);
    }
  },
);
