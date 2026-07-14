import RunCron from "../../Utils/Cron";
import { EVERY_THIRTY_MINUTES } from "Common/Utils/CronTime";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import AIAgentTaskPullRequest from "Common/Models/DatabaseModels/AIAgentTaskPullRequest";
import AIAgentTaskPullRequestService from "Common/Server/Services/AIAgentTaskPullRequestService";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunService from "Common/Server/Services/AIRunService";
import AIRunEventService from "Common/Server/Services/AIRunEventService";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "Common/Types/AI/CodeFixTaskType";
import FixPullRequestCiStatus, {
  FixPullRequestCiStatusHelper,
} from "Common/Types/AI/FixPullRequestCiStatus";
import GitHubUtil, {
  GitHubCheckRunsSummary,
  GitHubInstallationNotFoundError,
  GitHubInstallationToken,
} from "Common/Server/Utils/CodeRepository/GitHub/GitHub";
import LogSeverity from "Common/Types/Log/LogSeverity";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";

/**
 * Syncs the state of AI-agent-created pull requests from GitHub
 * (Open -> Merged / Closed), and — B4 Tier 1 — reads each open PR's CI
 * check-run conclusion into ciStatus/ciStatusAt.
 *
 * This is the outcome instrumentation for the AI fix path: the merged /
 * closed-unmerged ratio of agent PRs is the precision baseline that gates
 * any future fix automation (roadmap gate G11), and the CI conclusion is the
 * verified-green half of it — merged is good, merged-and-CI-green is better.
 * We READ the customer's own CI on the draft PRs; we never re-run or gate it.
 */

/*
 * One installation token per installation id, reused across its PRs.
 * supportsChecks is false when the GitHub App lacks the "Checks: Read-only"
 * permission — the token is then minted WITHOUT checks:read so the PR-state
 * sync never regresses on installations whose App predates Tier 1; their CI
 * status simply stays null (unpolled — which per G9 reads as unverified).
 */
interface InstallationTokenBundle {
  token: GitHubInstallationToken;
  supportsChecks: boolean;
}

async function mintInstallationTokenBundle(
  installationId: string,
): Promise<InstallationTokenBundle> {
  try {
    return {
      token: await GitHubUtil.getInstallationAccessToken(installationId, {
        permissions: {
          pull_requests: "read",
          checks: "read",
          metadata: "read",
        },
      }),
      supportsChecks: true,
    };
  } catch (error) {
    // Uninstalled app — the caller skips all of this installation's PRs.
    if (error instanceof GitHubInstallationNotFoundError) {
      throw error;
    }

    /*
     * Most likely a 422 because the App has no checks permission configured.
     * Fall back to the pre-Tier-1 permission set so PR states keep syncing.
     */
    logger.warn(
      `Could not mint a checks-capable token for GitHub App installation ${installationId} — falling back to PR-state-only sync. Grant the App "Checks: Read-only" to enable CI verification on fix PRs.`,
      { service: "workers" },
    );

    return {
      token: await GitHubUtil.getInstallationAccessToken(installationId, {
        permissions: {
          pull_requests: "read",
          metadata: "read",
        },
      }),
      supportsChecks: false,
    };
  }
}

/*
 * The SHOULD-FAIL rule needs the run's recipe: a RED conclusion on a
 * WriteRegressionTest PR is the desired signal (ExpectedFailureObserved).
 * Looked up lazily (only when a conclusion is Red) and cached per run id
 * for the sweep. Null column normalizes to FixException (legacy rows).
 */
async function getTaskTypeForRun(
  aiRunId: ObjectID,
  cache: Map<string, CodeFixTaskType>,
): Promise<CodeFixTaskType> {
  const cached: CodeFixTaskType | undefined = cache.get(aiRunId.toString());

  if (cached) {
    return cached;
  }

  const run: AIRun | null = await AIRunService.findOneById({
    id: aiRunId,
    select: {
      _id: true,
      codeFixTaskType: true,
    },
    props: {
      isRoot: true,
    },
  });

  const taskType: CodeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
    run?.codeFixTaskType,
  );

  cache.set(aiRunId.toString(), taskType);
  return taskType;
}

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
          projectId: true,
          aiRunId: true,
          pullRequestNumber: true,
          repoOrganizationName: true,
          repoName: true,
          headRefName: true,
          ciStatus: true,
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

    const tokenByInstallationId: Map<string, InstallationTokenBundle> =
      new Map();
    // Installations that 404ed (app uninstalled) — skip their PRs this run.
    const deadInstallationIds: Set<string> = new Set();
    const taskTypeByRunId: Map<string, CodeFixTaskType> = new Map();

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
        let tokenBundle: InstallationTokenBundle | undefined =
          tokenByInstallationId.get(installationId);

        if (!tokenBundle) {
          tokenBundle = await mintInstallationTokenBundle(installationId);
          tokenByInstallationId.set(installationId, tokenBundle);
        }

        const currentState: PullRequestState =
          await GitHubUtil.getPullRequestStateWithToken({
            token: tokenBundle.token.token,
            organizationName,
            repositoryName,
            pullRequestNumber: pullRequest.pullRequestNumber,
          });

        // Everything that changed this sweep lands in one update.
        const updateData: {
          pullRequestState?: PullRequestState;
          ciStatus?: FixPullRequestCiStatus;
          ciStatusAt?: Date;
        } = {};

        if (currentState !== PullRequestState.Open) {
          updateData.pullRequestState = currentState;
        }

        /*
         * Tier 1 CI verification: read the check-run conclusion for the
         * PR's head branch. Done even when the PR just left Open — the
         * conclusion recorded on that final sweep is what the
         * verified-green rate counts for merged PRs. CI polling failures
         * must never block the PR-state update, hence the nested try.
         */
        let ciChangeMessage: string | null = null;

        if (tokenBundle.supportsChecks && pullRequest.headRefName) {
          try {
            const summary: GitHubCheckRunsSummary =
              await GitHubUtil.getCheckRunsConclusionWithToken({
                token: tokenBundle.token.token,
                organizationName,
                repositoryName,
                headRefName: pullRequest.headRefName,
              });

            let ciStatus: FixPullRequestCiStatus = summary.conclusion;

            /*
             * SHOULD-FAIL rule: on a WriteRegressionTest run a RED
             * conclusion is the desired signal. Recipe looked up only
             * when it matters (Red) — legacy PRs without a run keep Red.
             */
            if (
              ciStatus === FixPullRequestCiStatus.Red &&
              pullRequest.aiRunId
            ) {
              const taskType: CodeFixTaskType = await getTaskTypeForRun(
                pullRequest.aiRunId,
                taskTypeByRunId,
              );

              ciStatus = FixPullRequestCiStatusHelper.applyTaskType({
                conclusion: ciStatus,
                taskType: taskType,
              });
            }

            if (ciStatus !== pullRequest.ciStatus) {
              updateData.ciStatus = ciStatus;
              updateData.ciStatusAt = OneUptimeDate.getCurrentDate();
              ciChangeMessage =
                FixPullRequestCiStatusHelper.describeForProgressLog({
                  ciStatus: ciStatus,
                  counts: summary,
                });
            }
          } catch (ciError) {
            logger.warn(
              `Failed to read check runs for AI agent PR ${organizationName}/${repositoryName}#${pullRequest.pullRequestNumber} — leaving ciStatus unchanged`,
              { service: "workers" },
            );
            logger.warn(ciError, { service: "workers" });
          }
        }

        if (Object.keys(updateData).length === 0) {
          continue;
        }

        await AIAgentTaskPullRequestService.updateOneById({
          id: pullRequest.id!,
          data: updateData,
          props: {
            isRoot: true,
          },
        });

        if (updateData.pullRequestState) {
          logger.info(
            `AI agent PR ${organizationName}/${repositoryName}#${pullRequest.pullRequestNumber} is now ${currentState}`,
            { service: "workers" },
          );
        }

        /*
         * Annotate the run's glass-box trail with the CI conclusion —
         * best-effort (appendEventToRun swallows its own failures), and
         * only for AIRun-era PRs that carry a run link.
         */
        if (ciChangeMessage && pullRequest.aiRunId && pullRequest.projectId) {
          await AIRunEventService.appendEventToRun({
            projectId: pullRequest.projectId,
            aiRunId: pullRequest.aiRunId,
            eventType: AIRunEventType.ProgressLog,
            resultSummary: {
              message: ciChangeMessage,
              severity: LogSeverity.Information,
            },
          });

          logger.info(
            `AI agent PR ${organizationName}/${repositoryName}#${pullRequest.pullRequestNumber}: ${ciChangeMessage}`,
            { service: "workers" },
          );
        }
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
