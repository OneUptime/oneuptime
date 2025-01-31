import { EVERY_THREE_HOURS, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import CodeRepositoryUtil from "Common/Server/Utils/CodeRepository/CodeRepository";
import { BlogRootPath } from "../Utils/Config";

BasicCron({
  jobName: "Home:UpdateBlog",
  options: {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_THREE_HOURS,
    runOnStartup: true,
  },
  runFunction: async () => {
    logger.debug("UpdateBlog: Start");
    // Pull latest changes from the repository
    await CodeRepositoryUtil.pullChanges({
      repoPath: BlogRootPath,
    });
    logger.debug("UpdateBlog: End");
  },
});
