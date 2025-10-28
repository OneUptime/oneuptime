import { EVERY_DAY } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import ProjectService from "Common/Server/Services/ProjectService";
import IncidentService from "Common/Server/Services/IncidentService";
import Project from "Common/Models/DatabaseModels/Project";
import Incident from "Common/Models/DatabaseModels/Incident";

const INCIDENT_PROJECT_BATCH_SIZE: number = 100;
const INCIDENT_BATCH_SIZE: number = 100;

RunCron(
  "Incident:KeepCurrentStateConsistent",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    try {
      // get all projects, then get all incidents for each project, then refresh the current state of each incident.
      const projects: Array<Project> = await ProjectService.getAllActiveProjects({
        select: {
          _id: true,
        },
        skip: 0,
        batchSize: INCIDENT_PROJECT_BATCH_SIZE,
      });

      for (const project of projects) {
        try {
          if (!project || !project.id) {
            continue;
          }

          const incidents: Array<Incident> = await IncidentService.findAllBy({
            query: {
              projectId: project.id,
            },
            select: {
              _id: true,
            },
            skip: 0,
            props: {
              isRoot: true,
            },
            batchSize: INCIDENT_BATCH_SIZE,
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
