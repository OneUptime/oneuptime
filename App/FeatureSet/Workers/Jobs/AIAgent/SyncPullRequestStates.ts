import RunCron from "../../Utils/Cron";
import { EVERY_THIRTY_MINUTES } from "Common/Utils/CronTime";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import AIAgentTaskPullRequest from "Common/Models/DatabaseModels/AIAgentTaskPullRequest";
import AIAgentTaskPullRequestService from "Common/Server/Services/AIAgentTaskPullRequestService";
import GitHubUtil, {
  GitHubInstallationNotFoundError,
  GitHubInstallationToken,
} from "Common/Server/Utils/CodeRepository/GitHub/GitHub";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import logger from "Common/Server/Utils/Logger";

/**
 * Syncs the state of AI-agent-created pull requests from GitHub
 * (Open -> Merged / Closed).
 *
 * This is the outcome instrumentation for the AI fix path: the merged /
 * closed-unmerged ratio of agent PRs is the precision baseline that gates
 * any future fix automation (roadmap gate G11). Without this job the
 * pullRequestState column stays "Open" forever and per-project fix
 * accuracy is unknowable.
 */

RunCron(
  "AIAgent:SyncPullRequestStates",
  {
    schedule: EVERY_THIRTY_MINUTES,
    runOnStartup: false,
  },
  async () => {
    const openPullRequests: Array<AIAgentTaskPullRequest> =
      await AIAgentTaskPullRequestService.findBy({
        query: {
          pullRequestState: PullRequestState.Open,
        },
        select: {
          _id: true,
          pullRequestNumber: true,
          repoOrganizationName: true,
          repoName: true,
          codeRepository: {
            _id: true,
            organizationName: true,
            repositoryName: true,
            gitHubAppInstallationId: true,
          },
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    if (openPullRequests.length === 0) {
      return;
    }

    logger.debug(
      `Syncing state for ${openPullRequests.length} open AI agent pull request(s)`,
      { service: "workers" },
    );

    // One installation token per installation id, reused across its PRs.
    const tokenByInstallationId: Map<string, GitHubInstallationToken> =
      new Map();
    // Installations that 404ed (app uninstalled) — skip their PRs this run.
    const deadInstallationIds: Set<string> = new Set();

    for (const pullRequest of openPullRequests) {
      const installationId: string | undefined =
        pullRequest.codeRepository?.gitHubAppInstallationId;
      const organizationName: string | undefined =
        pullRequest.repoOrganizationName ||
        pullRequest.codeRepository?.organizationName;
      const repositoryName: string | undefined =
        pullRequest.repoName || pullRequest.codeRepository?.repositoryName;

      if (
        !installationId ||
        !organizationName ||
        !repositoryName ||
        !pullRequest.pullRequestNumber
      ) {
        continue;
      }

      if (deadInstallationIds.has(installationId)) {
        continue;
      }

      try {
        let token: GitHubInstallationToken | undefined =
          tokenByInstallationId.get(installationId);

        if (!token) {
          token = await GitHubUtil.getInstallationAccessToken(installationId, {
            permissions: {
              pull_requests: "read",
              metadata: "read",
            },
          });
          tokenByInstallationId.set(installationId, token);
        }

        const currentState: PullRequestState =
          await GitHubUtil.getPullRequestStateWithToken({
            token: token.token,
            organizationName,
            repositoryName,
            pullRequestNumber: pullRequest.pullRequestNumber,
          });

        if (currentState === PullRequestState.Open) {
          continue;
        }

        await AIAgentTaskPullRequestService.updateOneById({
          id: pullRequest.id!,
          data: {
            pullRequestState: currentState,
          },
          props: {
            isRoot: true,
          },
        });

        logger.info(
          `AI agent PR ${organizationName}/${repositoryName}#${pullRequest.pullRequestNumber} is now ${currentState}`,
          { service: "workers" },
        );
      } catch (error) {
        if (error instanceof GitHubInstallationNotFoundError) {
          deadInstallationIds.add(installationId);
          logger.warn(
            `GitHub App installation ${installationId} not found while syncing AI agent PRs — skipping its pull requests`,
            { service: "workers" },
          );
          continue;
        }

        // One unreachable PR must not stop the sweep.
        logger.error(
          `Failed to sync state for AI agent pull request ${pullRequest.id?.toString()}:`,
          { service: "workers" },
        );
        logger.error(error, { service: "workers" });
      }
    }
  },
);
