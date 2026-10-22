import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProductionReviewRunner from "Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewRunner";
import logger from "Common/Server/Utils/Logger";

/**
 * Reviews pull requests against production: the production reviews that
 * are due (Common/Server/Utils/CodeRepository/ProductionReview). A pull
 * request that opens or is pushed to, in a repository with Production
 * Review on, or that someone asks about, gets its review here - on the
 * server, never on a Runner: nothing is cloned and nothing the pull request
 * holds is run.
 *
 * A review waits a minute after the latest push, so a burst of pushes is
 * reviewed once, and each is claimed by one conditional update, so two
 * workers never review one at once. The repository-wide reads a review
 * matches its change against are shared by all of a repository's pull
 * requests for half an hour, so a busy repository costs little more than
 * a quiet one.
 */
RunCron(
  "AIAgent:ReviewPullRequestsInProduction",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    const reviewed: number = await ProductionReviewRunner.runDueReviews();

    if (reviewed > 0) {
      logger.debug(`Reviewed ${reviewed} pull request(s) against production.`);
    }
  },
);
