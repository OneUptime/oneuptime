import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AIRunType from "Common/Types/AI/AIRunType";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AIRunService from "Common/Server/Services/AIRunService";
import AIConversationMessageService from "Common/Server/Services/AIConversationMessageService";
import AIInvestigationQueue from "Common/Server/Utils/AI/SRE/InvestigationQueue";
import CodeFixRunQueue from "Common/Server/Utils/AI/CodeFix/CodeFixRunQueue";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import logger from "Common/Server/Utils/Logger";

/**
 * AI runs heartbeat while executing. A run whose heartbeat is older than the
 * threshold is stale — the pod running it died mid-turn. Investigation runs
 * are requeued while retry attempts remain (the durable-queue poller picks
 * them up); chat runs — and investigations out of attempts — are marked
 * stale so the UI never shows an eternal spinner.
 */

/*
 * Must comfortably exceed the runner's 5-minute wall-clock budget plus the
 * longest single un-heartbeated gap (one LLM call, up to 5 minutes on slow
 * self-hosted providers) so healthy runs are never falsely marked stale.
 */
const RUN_HEARTBEAT_TIMEOUT_MINUTES: number = 12;

RunCron(
  "AIChat:TimeoutStuckRuns",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    const timeoutThreshold: Date = OneUptimeDate.getSomeMinutesAgo(
      RUN_HEARTBEAT_TIMEOUT_MINUTES,
    );

    const staleRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        status: AIRunStatus.Running,
        lastHeartbeatAt: QueryHelper.lessThan(timeoutThreshold),
      },
      select: {
        _id: true,
        conversationId: true,
        runType: true,
        attemptCount: true,
      },
      limit: 100,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (staleRuns.length === 0) {
      return;
    }

    logger.info(
      `Found ${staleRuns.length} stale AI run(s). Requeueing or marking as stale.`,
      { service: "workers" },
    );

    for (const run of staleRuns) {
      try {
        /*
         * Investigations are durable-queue runs: requeue while attempts
         * remain so a pod restart costs a retry, not the investigation.
         */
        if (run.runType === AIRunType.Investigation) {
          const outcome: "requeued" | "stale" =
            await AIInvestigationQueue.requeueOrMarkStale({
              id: run.id!,
              attemptCount: run.attemptCount || 0,
            });

          logger.info(
            `Stale investigation run ${run.id?.toString()}: ${outcome}.`,
            { service: "workers" },
          );
          continue;
        }

        /*
         * Code-fix runs execute in an EXTERNAL agent container. A silent
         * heartbeat means that executor died — and it may already have
         * pushed a partial fix branch, so auto-retrying is not safe. They
         * are finalized as Error (CAS-guarded), never requeued.
         */
        if (run.runType === AIRunType.CodeFix) {
          await CodeFixRunQueue.markStaleRunAsError({ id: run.id! });

          logger.info(
            `Stale code-fix run ${run.id?.toString()}: marked as Error (external agent died; not auto-retried).`,
            { service: "workers" },
          );
          continue;
        }

        await AIRunService.updateOneById({
          id: run.id!,
          data: {
            status: AIRunStatus.Stale,
            completedAt: OneUptimeDate.getCurrentDate(),
            errorMessage:
              "The run stopped reporting progress and was marked as stale. The server processing it may have restarted.",
          },
          props: {
            isRoot: true,
          },
        });

        // Fail the in-progress assistant messages of this run.
        const inProgressMessages: Array<AIConversationMessage> =
          await AIConversationMessageService.findBy({
            query: {
              aiRunId: run.id!,
              status: AIChatMessageStatus.InProgress,
            },
            select: {
              _id: true,
            },
            limit: 10,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        for (const message of inProgressMessages) {
          await AIConversationMessageService.updateOneById({
            id: message.id!,
            data: {
              status: AIChatMessageStatus.Error,
              errorMessage:
                "This response was interrupted because the server processing it restarted. Please ask again.",
            },
            props: {
              isRoot: true,
            },
          });
        }
      } catch (error) {
        logger.error(`Failed to mark stale AI run ${run.id?.toString()}:`, {
          service: "workers",
        });
        logger.error(error, { service: "workers" });
      }
    }
  },
);
