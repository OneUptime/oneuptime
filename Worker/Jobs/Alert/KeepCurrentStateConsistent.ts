import { EVERY_DAY } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import ProjectService from "Common/Server/Services/ProjectService";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import AlertService from "Common/Server/Services/AlertService";
import Project from "Common/Models/DatabaseModels/Project";
import Alert from "Common/Models/DatabaseModels/Alert";

RunCron(
  "Alert:KeepCurrentStateConsistent",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    try {
      // get all projects, then get all alerts for each project, then refresh the current state of each alert.
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
          if (!project || !project.id) {
            continue;
          }

          const alerts: Array<Alert> = await AlertService.findBy({
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

          for (const alert of alerts) {
            try {
              if (!alert || !alert.id) {
                continue;
              }
              await AlertService.refreshAlertCurrentStatus(alert.id!);
            } catch (err) {
              logger.error("Error in Alert:KeepCurrentStateConsistent job");
              logger.error(err);
              continue;
            }
          }
        } catch (err) {
          logger.error("Error in Alert:KeepCurrentStateConsistent job");
          logger.error(err);
          continue;
        }
      }
    } catch (err) {
      logger.error("Error in Alert:KeepCurrentStateConsistent job");
      logger.error(err);
    }
  },
);
