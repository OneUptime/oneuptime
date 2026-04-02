import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AIAgentTaskService from "Common/Server/Services/AIAgentTaskService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import AIAgentTask from "Common/Models/DatabaseModels/AIAgentTask";
import logger from "Common/Server/Utils/Logger";

/**
 * AI Agent tasks that are stuck in "InProgress" status for more than 30 minutes
 * are considered timed out. This can happen when the AI Agent container crashes
 * or is deleted while processing a task.
 *
 * This job resets stuck tasks back to "Scheduled" status so they can be retried.
 */

const TASK_TIMEOUT_MINUTES: number = 30;

RunCron(
  "AIAgent:TimeoutStuckTasks",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    logger.debug("Checking for stuck AI Agent tasks");

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
        );
      } catch (error) {
        logger.error(
          `Failed to reset stuck AI Agent task ${task.id?.toString()}:`,
        );
        logger.error(error);
      }
    }
  },
);
