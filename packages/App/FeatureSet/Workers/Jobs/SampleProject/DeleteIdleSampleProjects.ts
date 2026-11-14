import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { isSampleProjectIdle } from "Common/Types/SampleProject/SampleProject";

/*
 * ON ONEUPTIME CLOUD, A SAMPLE NOBODY VISITS GOES AWAY (issue #6808).
 *
 * A sample project is made in one click to look around in, and its story
 * is told as of the moment it was made, so it reads as stale after a few
 * weeks. Once a day, every sample nobody has opened for
 * SAMPLE_PROJECT_IDLE_DAYS (Project.lastActive, which every signed-in
 * request moves on, or when it was made) is deleted - with its records, its
 * sample people and its analytics rows (ProjectService.onDeleteSuccess),
 * as Delete Sample Project would.
 *
 * Cloud only: on a self-hosted server a sample stays until somebody deletes
 * it, as every other project does. One sample that fails to delete is
 * logged and tried again the next day; the others go ahead.
 */
export async function deleteIdleSampleProjects(
  now: Date = OneUptimeDate.getCurrentDate(),
): Promise<number> {
  if (!IsBillingEnabled) {
    return 0;
  }

  const samples: Array<Project> = await ProjectService.findBy({
    query: {
      isSampleProject: true,
    },
    select: {
      _id: true,
      lastActive: true,
      createdAt: true,
    },
    skip: 0,
    limit: LIMIT_MAX,
    props: {
      isRoot: true,
    },
  });

  let deletedCount: number = 0;

  for (const sample of samples) {
    if (
      !sample.id ||
      !isSampleProjectIdle({
        lastActive: sample.lastActive,
        createdAt: sample.createdAt,
        now: now,
      })
    ) {
      continue;
    }

    try {
      await ProjectService.deleteOneById({
        id: sample.id,
        props: {
          isRoot: true,
        },
      });

      deletedCount++;
    } catch (err) {
      logger.error(
        `SampleProject:DeleteIdleSampleProjects: could not delete idle sample project ${sample.id.toString()}; tomorrow's run tries again.`,
      );
      logger.error(err);
    }
  }

  if (deletedCount > 0) {
    logger.debug(
      `SampleProject:DeleteIdleSampleProjects: deleted ${deletedCount} idle sample projects.`,
    );
  }

  return deletedCount;
}

RunCron(
  "SampleProject:DeleteIdleSampleProjects",
  {
    schedule: EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: 30 * 60 * 1000,
  },
  async (): Promise<void> => {
    await deleteIdleSampleProjects();
  },
);
