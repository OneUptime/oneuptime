import { EVERY_THREE_HOURS, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import CodeRepositoryUtil from "Common/Server/Utils/CodeRepository/CodeRepository";
import {
  BlogCloneFilter,
  BlogRepositoryUrl,
  BlogRootPath,
  BlogSkipDownload,
} from "../Utils/Config";
import BlogPostUtil from "../Utils/BlogPost";

BasicCron({
  jobName: "Home:UpdateBlog",
  options: {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_THREE_HOURS,
    runOnStartup: true,
  },
  runFunction: async () => {
    logger.debug("UpdateBlog: Start", { service: "home", job: "UpdateBlog" });

    if (BlogSkipDownload) {
      // Emergency kill-switch: do nothing (no clone, no pull). Home serves with
      // whatever is on the volume (typically empty), and blog pages degrade
      // gracefully. See BLOG_SKIP_DOWNLOAD in Config.
      logger.debug("UpdateBlog: skipped (BLOG_SKIP_DOWNLOAD=true)", {
        service: "home",
        job: "UpdateBlog",
      });
      return;
    }

    /*
     * The blog now lives on a mounted volume rather than inside the image. On
     * Kubernetes an initContainer clones it before Home starts, but this cron is
     * the self-healing fallback for the cases the initContainer does not cover: a
     * freshly-provisioned/empty volume, local docker-compose dev, or a wiped
     * volume. Clone-if-missing, otherwise pull. Uses the same blob:none partial
     * filter so we never fetch the ~7GB of historical blobs.
     */
    const isRepo: boolean = await CodeRepositoryUtil.isGitRepository({
      repoPath: BlogRootPath,
    });

    if (!isRepo) {
      logger.debug("UpdateBlog: blog repo missing, cloning", {
        service: "home",
        job: "UpdateBlog",
        repoPath: BlogRootPath,
      });
      try {
        await CodeRepositoryUtil.cloneRepositoryToDirectory({
          repoUrl: BlogRepositoryUrl,
          directoryPath: BlogRootPath,
          filter: BlogCloneFilter || undefined,
        });
      } catch (err: unknown) {
        // Leave the repo absent; the next run retries. Blog pages degrade
        // gracefully (empty recent-posts) until the clone succeeds.
        logger.debug("UpdateBlog: clone failed");
        logger.debug(err);
      }
    } else {
      /*
       * Sync the existing clone to the latest upstream with a hard reset rather
       * than a plain `git pull`. A persistent per-pod volume (pvc / statefulset
       * modes) never re-clones on restart, so if the blog history is
       * force-pushed / rewritten upstream (e.g. large-media purge via BFG /
       * git-filter-repo) a plain pull aborts on divergent branches and the cache
       * stays wedged on stale content forever. A hard reset to the upstream
       * adopts a rewritten history and is safe here because the clone is a
       * read-only mirror with no local commits. Wrapped so a transient network
       * failure does not skip the cache-clear / contributor warm below; the next
       * run retries.
       */
      try {
        await CodeRepositoryUtil.resetHardToRemote({
          repoPath: BlogRootPath,
        });
      } catch (err: unknown) {
        logger.debug("UpdateBlog: sync failed");
        logger.debug(err);
      }
    }

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
