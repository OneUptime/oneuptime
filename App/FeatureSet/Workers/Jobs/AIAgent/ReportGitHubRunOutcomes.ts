import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunService from "Common/Server/Services/AIRunService";
import AIRunType from "Common/Types/AI/AIRunType";
import { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "Common/Types/AI/CodeFixTaskType";
import { GitHubTaskContext } from "Common/Types/AI/CodeFixTaskContext";
import GitHubRunReply from "Common/Server/Utils/CodeRepository/GitHub/GitHubRunReply";
import GitHubInstallationBinding from "Common/Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";

/**
 * Tells a GitHub thread how its run turned out.
 *
 * A run started from GitHub owes the person who asked exactly one answer, and
 * this is the only thing that delivers it. That is on purpose. A run reaches a
 * terminal state from five different places — the worker reporting in, the
 * stale-heartbeat sweeper, the orphaned-queue sweeper, the claim-time
 * executability guard, and an explicit cancel — and posting from each of them
 * would mean the reply is missing in precisely the cases where something went
 * wrong and the user most needs to hear it. Sweeping for terminal-but-unreported
 * runs covers every one of those paths, including any added later.
 *
 * It is also what makes a GitHub outage survivable: `reportedToGitHubAt` is
 * only written after GitHub accepts the write, so a failed post is simply
 * retried on the next tick instead of being lost.
 *
 * The cost is up to a minute of latency on the final comment, against runs
 * that take minutes to tens of minutes. That is not a trade worth complicating
 * five call sites for.
 */

// Batch size per tick. Far above any realistic backlog; a bound, not a target.
const SWEEP_BATCH_SIZE: number = 100;

/*
 * How far back to look. A run whose outcome could not be posted for a whole
 * day is not going to be interesting to post now, and without a horizon this
 * query re-scans every GitHub run this instance has ever finished.
 */
const REPORT_WINDOW_HOURS: number = 24;

RunCron(
  "AIAgent:ReportGitHubRunOutcomes",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    const since: Date = OneUptimeDate.getSomeHoursAgo(REPORT_WINDOW_HOURS);

    const finishedRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        runType: AIRunType.CodeFix,
        codeFixTaskType: QueryHelper.any(
          CodeFixTaskTypeHelper.getGitHubTaskTypes().map(
            (taskType: CodeFixTaskType) => {
              return taskType.toString();
            },
          ),
        ),
        status: QueryHelper.any(AIRunStatusHelper.terminalStatuses()),
        completedAt: QueryHelper.greaterThan(since),
      },
      select: {
        _id: true,
        projectId: true,
        status: true,
        errorMessage: true,
        taskContext: true,
      },
      limit: SWEEP_BATCH_SIZE,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const run of finishedRuns) {
      if (!run.id || !run.projectId) {
        continue;
      }

      const github: GitHubTaskContext | null =
        GitHubRunReply.needsOutcomeReport(run);

      if (!github) {
        /*
         * Either already reported — the common case, and nothing to do — or
         * the context is unusable. The claim guard fails a run with an
         * incomplete context, which leaves it terminal with that same
         * incomplete context, so this is reachable; without a marker the sweep
         * would re-select it and skip it every minute for a day.
         */
        if (!GitHubRunReply.hasReportableContext(run)) {
          logger.warn(
            `GitHub run ${run.id.toString()} has no usable GitHub context to report to. Marking it so the sweep stops retrying.`,
          );

          await GitHubRunReply.markUnreportable({
            aiRunId: run.id,
            taskContext: run.taskContext,
          }).catch((error: unknown) => {
            logger.error(
              `Could not mark GitHub run ${run.id!.toString()} unreportable: ${error}`,
            );
          });
        }

        continue;
      }

      try {
        /*
         * Re-derive the installation binding before writing anything. A run
         * can finish after its GitHub App was uninstalled or moved, and the
         * single app JWT will mint a token for whichever installation it is
         * handed — so "this run says installation N" is not authority to act
         * as installation N. Same rule the repository-token endpoint applies
         * (GHSA-xx95-gmcf-7q86).
         */
        const isBound: boolean =
          await GitHubInstallationBinding.isInstallationBoundToProject({
            projectId: run.projectId,
            installationId: github.installationId,
          });

        if (!isBound) {
          logger.warn(
            `Not reporting run ${run.id.toString()} to GitHub: installation ${github.installationId} is no longer bound to project ${run.projectId.toString()}. Marking it reported so the sweep does not retry forever.`,
          );

          await GitHubRunReply.markReported({
            aiRunId: run.id,
            taskContext: run.taskContext,
            github: github,
          });
          continue;
        }

        const posted: boolean = await GitHubRunReply.reportOutcome({
          run: run,
          github: github,
        });

        if (posted) {
          await GitHubRunReply.markReported({
            aiRunId: run.id,
            taskContext: run.taskContext,
            github: github,
          });
        }
      } catch (error) {
        /*
         * One repository's problem must not stop the rest of the sweep, and
         * an unmarked run is simply retried next tick.
         */
        logger.error(
          `Could not report GitHub run ${run.id.toString()} back to its thread: ${error}`,
        );
      }
    }
  },
);
