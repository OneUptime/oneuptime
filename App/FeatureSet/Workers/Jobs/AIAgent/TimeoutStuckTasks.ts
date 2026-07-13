import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AIAgentService from "Common/Server/Services/AIAgentService";
import AIAgentTaskService from "Common/Server/Services/AIAgentTaskService";
import CodeFixRunQueue from "Common/Server/Utils/AI/CodeFix/CodeFixRunQueue";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import AIAgentTask from "Common/Models/DatabaseModels/AIAgentTask";
import logger from "Common/Server/Utils/Logger";

/**
 * AI Agent tasks that are stuck in "InProgress" status for more than 30 minutes
 * are considered timed out. This can happen when the AI Agent container crashes
 * or is deleted while processing a task.
 *
 * This job resets stuck tasks back to "Scheduled" status so they can be retried.
 *
 * It also fails Scheduled tasks that have waited longer than the timeout while
 * their project has no alive agent to pick them up — previously such tasks sat
 * "Scheduled" forever and the exception page showed "AI agent is working"
 * indefinitely, blocking retries.
 *
 * The two AIAgentTask jobs below only maintain LEGACY rows — new code-fix
 * work lives on the AIRun substrate, swept by AIAgent:FailOrphanedQueuedCodeFixRuns
 * (orphaned Queued runs, same semantics as FailOrphanedScheduledTasks) and by
 * AIChat:TimeoutStuckRuns (heartbeat-stale Running runs).
 */

const TASK_TIMEOUT_MINUTES: number = 30;

RunCron(
  "AIAgent:TimeoutStuckTasks",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    logger.debug("Checking for stuck AI Agent tasks", { service: "workers" });

    const timeoutThreshold: Date =
      OneUptimeDate.getSomeMinutesAgo(TASK_TIMEOUT_MINUTES);

    // Find tasks that have been InProgress for longer than the timeout threshold
    const stuckTasks: Array<AIAgentTask> = await AIAgentTaskService.findAllBy({
      query: {
        status: AIAgentTaskStatus.InProgress,
        startedAt: QueryHelper.lessThan(timeoutThreshold),
      },
      select: {
        _id: true,
        startedAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (stuckTasks.length === 0) {
      return;
    }

    logger.info(
      `Found ${stuckTasks.length} stuck AI Agent task(s). Resetting to Scheduled status.`,
      { service: "workers" },
    );

    for (const task of stuckTasks) {
      try {
        await AIAgentTaskService.updateOneById({
          id: task.id!,
          data: {
            status: AIAgentTaskStatus.Scheduled,
            statusMessage:
              "Task was reset due to timeout. The AI Agent processing this task may have crashed or been terminated.",
            startedAt: null,
          },
          props: {
            isRoot: true,
          },
        });

        logger.info(
          `Reset stuck AI Agent task ${task.id?.toString()} to Scheduled status`,
          { service: "workers" },
        );
      } catch (error) {
        logger.error(
          `Failed to reset stuck AI Agent task ${task.id?.toString()}:`,
          { service: "workers" },
        );
        logger.error(error, { service: "workers" });
      }
    }
  },
);

RunCron(
  "AIAgent:FailOrphanedScheduledTasks",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    const waitThreshold: Date =
      OneUptimeDate.getSomeMinutesAgo(TASK_TIMEOUT_MINUTES);

    const waitingTasks: Array<AIAgentTask> = await AIAgentTaskService.findAllBy(
      {
        query: {
          status: AIAgentTaskStatus.Scheduled,
          createdAt: QueryHelper.lessThan(waitThreshold),
        },
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      },
    );

    if (waitingTasks.length === 0) {
      return;
    }

    /*
     * One alive-agent lookup per project, not per task. A project with an
     * alive agent just has a deep queue — leave its tasks alone; the agent
     * will get to them.
     */
    const projectHasAliveAgent: Map<string, boolean> = new Map();

    for (const task of waitingTasks) {
      if (!task.projectId) {
        continue;
      }

      const projectIdStr: string = task.projectId.toString();

      if (!projectHasAliveAgent.has(projectIdStr)) {
        const aliveAgent: AIAgent | null =
          await AIAgentService.getConnectedAIAgentForProject(task.projectId);
        projectHasAliveAgent.set(projectIdStr, Boolean(aliveAgent));
      }

      if (projectHasAliveAgent.get(projectIdStr)) {
        continue;
      }

      try {
        await AIAgentTaskService.updateOneById({
          id: task.id!,
          data: {
            status: AIAgentTaskStatus.Error,
            statusMessage: `No AI agent picked this task up within ${TASK_TIMEOUT_MINUTES} minutes and none is currently online. Check that your agent container is running (Settings > AI > AI Agents), then retry the fix from the exception page.`,
          },
          props: {
            isRoot: true,
          },
        });

        logger.info(
          `Failed orphaned Scheduled AI Agent task ${task.id?.toString()} (no alive agent for project ${projectIdStr})`,
          { service: "workers" },
        );
      } catch (error) {
        logger.error(
          `Failed to mark orphaned AI Agent task ${task.id?.toString()} as Error:`,
          { service: "workers" },
        );
        logger.error(error, { service: "workers" });
      }
    }
  },
);

/*
 * The AIRun-substrate port of FailOrphanedScheduledTasks: Queued CodeFix
 * runs older than the timeout in projects with no alive agent -> Error with
 * the same actionable message. Decision logic lives in CodeFixRunQueue so
 * it is unit-testable.
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
