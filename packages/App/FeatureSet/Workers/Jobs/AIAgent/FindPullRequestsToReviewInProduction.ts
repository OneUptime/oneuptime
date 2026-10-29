import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProductionReviewPoller, {
  POLL_TICK_BUDGET_MS,
  ProductionReviewPollResult,
} from "Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewPoller";
import logger from "Common/Server/Utils/Logger";

/**
 * Finds the merge requests of GitLab, and the pull requests of Forgejo and
 * Gitea, to review against production. GitHub tells OneUptime of a pull
 * request through the App's webhooks; a repository on those hosts is
 * connected with an access token and sends nothing, so every minute each
 * one with Production Review on is read for the pull requests that changed
 * since its last read, and a review is asked for each that needs one, under
 * the rules GitHub's pull requests are reviewed by
 * (Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewPoller).
 *
 * It only asks: the reviews themselves run in
 * AIAgent:ReviewPullRequestsInProduction, as GitHub's do. A tick starts no
 * new read after a few minutes, so a slow server never holds the next one
 * back.
 */
RunCron(
  "AIAgent:FindPullRequestsToReviewInProduction",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: POLL_TICK_BUDGET_MS + 2 * 60 * 1000,
  },
  async () => {
    const result: ProductionReviewPollResult =
      await ProductionReviewPoller.pollAll();

    if (result.asked > 0) {
      logger.debug(
        `Asked for ${result.asked} production review(s) in ${result.repositories} repository(ies) on GitLab, Forgejo or Gitea.`,
      );
    }
  },
);
