import { ONEUPTIME_URL } from "../Config";
import AIAgentAPIRequest from "../Utils/AIAgentAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";

type ExecuteTaskFunction = (_task: JSONObject) => Promise<void>;

/*
 * Placeholder function for executing AI Agent tasks
 * This will be implemented later with actual task execution logic
 */
const executeTask: ExecuteTaskFunction = async (
  _task: JSONObject,
): Promise<void> => {
  /* Empty async function for now - TODO: Implement actual task execution logic here */
};

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "AIAgent:ProcessScheduledTasks",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    },
    runFunction: async () => {
      logger.debug("Checking AIAgent:ProcessScheduledTasks");

      const getPendingTaskUrl: URL = URL.fromString(
        ONEUPTIME_URL.toString(),
      ).addRoute("/api/ai-agent-task/get-pending-task");

      const updateTaskStatusUrl: URL = URL.fromString(
        ONEUPTIME_URL.toString(),
      ).addRoute("/api/ai-agent-task/update-task-status");

      /* Keep processing tasks until there are no more scheduled tasks */
      let hasMoreTasks: boolean = true;

      while (hasMoreTasks) {
        try {
          /* Fetch one scheduled task */
          const getPendingTaskResult: HTTPResponse<JSONObject> = await API.post(
            {
              url: getPendingTaskUrl,
              data: AIAgentAPIRequest.getDefaultRequestBody(),
            },
          );

          if (!getPendingTaskResult.isSuccess()) {
            logger.error("Failed to fetch pending task from server");
            hasMoreTasks = false;
            break;
          }

          const responseData: JSONObject =
            getPendingTaskResult.data as JSONObject;
          const task: JSONObject | null = responseData["task"] as JSONObject;

          if (!task || !task["_id"]) {
            logger.debug("No more scheduled tasks to process");
            hasMoreTasks = false;
            break;
          }

          const taskId: string = task["_id"] as string;
          logger.debug(`Processing task: ${taskId}`);

          try {
            /* Mark task as InProgress */
            const inProgressResult: HTTPResponse<JSONObject> = await API.post({
              url: updateTaskStatusUrl,
              data: {
                ...AIAgentAPIRequest.getDefaultRequestBody(),
                taskId: taskId,
                status: AIAgentTaskStatus.InProgress,
              },
            });

            if (!inProgressResult.isSuccess()) {
              logger.error(
                `Failed to mark task ${taskId} as InProgress. Skipping.`,
              );
              continue;
            }

            /* Execute the task (empty function for now) */
            await executeTask(task);

            /* Mark task as Completed */
            const completedResult: HTTPResponse<JSONObject> = await API.post({
              url: updateTaskStatusUrl,
              data: {
                ...AIAgentAPIRequest.getDefaultRequestBody(),
                taskId: taskId,
                status: AIAgentTaskStatus.Completed,
              },
            });

            if (!completedResult.isSuccess()) {
              logger.error(`Failed to mark task ${taskId} as Completed`);
            } else {
              logger.debug(`Task completed successfully: ${taskId}`);
            }
          } catch (error) {
            /* Mark task as Error with error message */
            const errorMessage: string =
              error instanceof Error ? error.message : "Unknown error occurred";

            const errorResult: HTTPResponse<JSONObject> = await API.post({
              url: updateTaskStatusUrl,
              data: {
                ...AIAgentAPIRequest.getDefaultRequestBody(),
                taskId: taskId,
                status: AIAgentTaskStatus.Error,
                statusMessage: errorMessage,
              },
            });

            if (!errorResult.isSuccess()) {
              logger.error(
                `Failed to mark task ${taskId} as Error: ${errorMessage}`,
              );
            }

            logger.error(`Task failed: ${taskId} - ${errorMessage}`);
            logger.error(error);
          }
        } catch (error) {
          logger.error("Error in task processing loop:");
          logger.error(error);
          hasMoreTasks = false;
        }
      }
    },
  });
};

export default InitJob;
