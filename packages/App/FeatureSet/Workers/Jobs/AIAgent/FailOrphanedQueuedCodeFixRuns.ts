import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import CodeFixRunQueue from "Common/Server/Utils/AI/CodeFix/CodeFixRunQueue";

/*
 * Queued CodeFix AIRuns older than the timeout in projects with no alive
 * agent -> Error with actionable guidance. Without this, the exception page
 * would show "queued" forever and the duplicate guard would block retries.
 * Decision logic lives in CodeFixRunQueue so it is unit-testable.
 *
 * (Heartbeat-stale RUNNING code-fix runs are swept by
 * AIChat:TimeoutStuckRuns — tried again in place only when nothing says
 * the external executor pushed a branch or opened a pull request and the
 * run has attempts left (CodeFixAutoRetry), Error otherwise. A run queued
 * again that way waits here only from its nextAttemptAt. The legacy
 * AIAgentTask sweepers that used to live alongside this job died with the
 * AIAgentTask table.)
 */
RunCron(
  "AIAgent:FailOrphanedQueuedCodeFixRuns",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await CodeFixRunQueue.failOrphanedQueuedRuns();
  },
);
