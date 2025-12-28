import { ONEUPTIME_URL } from "../Config";
import AIAgentAPIRequest from "../Utils/AIAgentAPIRequest";
import AIAgentTaskLog from "../Utils/AIAgentTaskLog";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import Sleep from "Common/Types/Sleep";

const SLEEP_WHEN_NO_TASKS_MS: number = 60 * 1000; // 1 minute

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

const startTaskProcessingLoop: () => Promise<void> =
  async (): Promise<void> => {
    logger.info("Starting AI Agent task processing loop...");

    const getPendingTaskUrl: URL = URL.fromString(
      ONEUPTIME_URL.toString(),
    ).addRoute("/api/ai-agent-task/get-pending-task");

    const updateTaskStatusUrl: URL = URL.fromString(
      ONEUPTIME_URL.toString(),
    ).addRoute("/api/ai-agent-task/update-task-status");

    /* Continuous loop to process tasks */
    while (true) {
      try {
        /* Fetch one scheduled task */
        const getPendingTaskResult: HTTPResponse<JSONObject> = await API.post({
          url: getPendingTaskUrl,
          data: AIAgentAPIRequest.getDefaultRequestBody(),
        });

        if (!getPendingTaskResult.isSuccess()) {
          logger.error("Failed to fetch pending task from server");
          logger.debug(
            `Sleeping for ${SLEEP_WHEN_NO_TASKS_MS / 1000} seconds before retrying...`,
          );
          await Sleep.sleep(SLEEP_WHEN_NO_TASKS_MS);
          continue;
        }

        const responseData: JSONObject =
          getPendingTaskResult.data as JSONObject;
        const task: JSONObject | null = responseData["task"] as JSONObject;

        if (!task || !task["_id"]) {
          logger.debug("No pending tasks available");
          logger.debug(
            `Sleeping for ${SLEEP_WHEN_NO_TASKS_MS / 1000} seconds before checking again...`,
          );
          await Sleep.sleep(SLEEP_WHEN_NO_TASKS_MS);
          continue;
        }

        const taskId: string = task["_id"] as string;
        logger.info(`Processing task: ${taskId}`);

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

          /* Send task started log */
          await AIAgentTaskLog.sendTaskStartedLog(taskId);

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
            /* Send task completed log */
            await AIAgentTaskLog.sendTaskCompletedLog(taskId);
            logger.info(`Task completed successfully: ${taskId}`);
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

          /* Send task error log */
          await AIAgentTaskLog.sendTaskErrorLog(taskId, errorMessage);

          logger.error(`Task failed: ${taskId} - ${errorMessage}`);
          logger.error(error);
        }
      } catch (error) {
        logger.error("Error in task processing loop:");
        logger.error(error);
        logger.debug(
          `Sleeping for ${SLEEP_WHEN_NO_TASKS_MS / 1000} seconds before retrying...`,
        );
        await Sleep.sleep(SLEEP_WHEN_NO_TASKS_MS);
      }
    }
  };

export default startTaskProcessingLoop;
