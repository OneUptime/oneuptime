import { EVERY_THREE_HOURS, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import CodeRepositoryUtil from "Common/Server/Utils/CodeRepository/CodeRepository";
import { BlogRootPath } from "../Utils/Config";
import BlogPostUtil from "../Utils/BlogPost";

BasicCron({
  jobName: "Home:UpdateBlog",
  options: {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_THREE_HOURS,
    runOnStartup: true,
  },
  runFunction: async () => {
    logger.debug("UpdateBlog: Start", { service: "home", job: "UpdateBlog" });
    // Pull latest changes from the repository
    await CodeRepositoryUtil.pullChanges({
      repoPath: BlogRootPath,
    });
    BlogPostUtil.clearAllCaches();
    /*
     * Warm git-history contributors in the background (off the request path) so
     * the first /blog hit doesn't pay the ~60s+ full-history `git log`. Bounded
     * internally; fire-and-forget so the pull/cache-clear stays snappy.
     */
    BlogPostUtil.warmContributors().catch((err: unknown) => {
      logger.debug("UpdateBlog: contributor warm failed");
      logger.debug(err);
    });
    logger.debug("UpdateBlog: End", { service: "home", job: "UpdateBlog" });
  },
});
