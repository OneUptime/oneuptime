import { EVERY_THREE_HOURS, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { Host, IsDevelopment } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import CodeRepositoryUtil from "Common/Server/Utils/CodeRepository/CodeRepository";
import { BlogRootPath } from "../Utils/Config";
import BlogPostUtil from "../Utils/BlogPost";
import { INDEXNOW_HOST, notifyIndexNowOfChangedPosts } from "../Utils/IndexNow";

// The commit the blog's checkout is at, or null when git cannot say.
const getBlogCommit: () => Promise<string | null> = async (): Promise<
  string | null
> => {
  try {
    // git ends its answer with a newline, which no hash has.
    const commit: string = (
      await CodeRepositoryUtil.getCurrentCommitHash({
        repoPath: BlogRootPath,
      })
    ).trim();

    return commit || null;
  } catch (err) {
    logger.debug("UpdateBlog: could not read the blog's commit");
    logger.debug(err);
    return null;
  }
};

/*
 * Tells IndexNow about the posts a pull added, changed or removed: the files
 * under posts/ that differ between the commit the blog was at before the pull
 * and the one it is at after. Only oneuptime.com sends notices
 * (Utils/IndexNow.ts), so nowhere else asks git for any of this.
 */
const notifyIndexNowOfPull: (
  commitBeforePull: string | null,
) => Promise<void> = async (commitBeforePull: string | null): Promise<void> => {
  if (Host !== INDEXNOW_HOST || !commitBeforePull) {
    return;
  }

  const commitAfterPull: string | null = await getBlogCommit();

  if (!commitAfterPull || commitAfterPull === commitBeforePull) {
    return;
  }

  const changedFiles: Array<string> =
    await CodeRepositoryUtil.getFilesChangedBetweenCommits({
      repoPath: BlogRootPath,
      fromCommitHash: commitBeforePull,
      toCommitHash: commitAfterPull,
      path: "posts",
    });

  const accepted: number = await notifyIndexNowOfChangedPosts({
    host: Host,
    changedFiles: changedFiles,
  });

  logger.debug(`UpdateBlog: IndexNow accepted ${accepted} post addresses`, {
    service: "home",
    job: "UpdateBlog",
  });
};

BasicCron({
  jobName: "Home:UpdateBlog",
  options: {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_THREE_HOURS,
    runOnStartup: true,
  },
  runFunction: async () => {
    logger.debug("UpdateBlog: Start", { service: "home", job: "UpdateBlog" });
    // Where the blog was before this pull, to tell IndexNow what the pull changed.
    const commitBeforePull: string | null =
      Host === INDEXNOW_HOST ? await getBlogCommit() : null;
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
    // A notice that fails is not sent again, and never fails the pull.
    try {
      await notifyIndexNowOfPull(commitBeforePull);
    } catch (err) {
      logger.debug("UpdateBlog: IndexNow notice failed");
      logger.debug(err);
    }
    logger.debug("UpdateBlog: End", { service: "home", job: "UpdateBlog" });
  },
});
