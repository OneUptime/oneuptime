import { EVERY_DAY } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import ProjectService from "Common/Server/Services/ProjectService";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import IncidentService from "Common/Server/Services/IncidentService";
import Project from "Common/Models/DatabaseModels/Project";
import Incident from "Common/Models/DatabaseModels/Incident";

RunCron(
  "Incident:KeepCurrentStateConsistent",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    try {
      // get all projects, then get all incidents for each project, then refresh the current state of each incident.
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

          const incidents: Array<Incident> = await IncidentService.findBy({
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

          for (const incident of incidents) {
            try {
              if (!incident || !incident.id) {
                continue;
              }
              await IncidentService.refreshIncidentCurrentStatus(incident.id!);
            } catch (err) {
              logger.error("Error in Incident:KeepCurrentStateConsistent job");
              logger.error(err);
              continue;
            }
          }
        } catch (err) {
          logger.error("Error in Incident:KeepCurrentStateConsistent job");
          logger.error(err);
          continue;
        }
      }
    } catch (err) {
      logger.error("Error in Incident:KeepCurrentStateConsistent job");
      logger.error(err);
    }
  },
);
