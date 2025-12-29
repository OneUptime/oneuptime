import { ONEUPTIME_URL } from "../Config";
import AIAgentAPIRequest from "../Utils/AIAgentAPIRequest";
import AIAgentTaskLog from "../Utils/AIAgentTaskLog";
import TaskLogger from "../Utils/TaskLogger";
import BackendAPI from "../Utils/BackendAPI";
import {
  getTaskHandlerRegistry,
  TaskContext,
  TaskMetadata,
  TaskHandler,
  TaskResult,
} from "../TaskHandlers/Index";
import TaskHandlerRegistry from "../TaskHandlers/TaskHandlerRegistry";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import AIAgentTaskType from "Common/Types/AI/AIAgentTaskType";
import ObjectID from "Common/Types/ObjectID";
import Sleep from "Common/Types/Sleep";

// Type for task data from the API
interface AIAgentTaskData {
  _id: string;
  projectId: string;
  taskType: AIAgentTaskType;
  metadata: TaskMetadata;
  createdAt: string;
  status?: AIAgentTaskStatus;
}

// Type for API response containing task
interface GetPendingTaskResponse {
  task: AIAgentTaskData | null;
}

const SLEEP_WHEN_NO_TASKS_MS: number = 60 * 1000; // 1 minute

type ExecuteTaskFunction = (task: AIAgentTaskData) => Promise<void>;

/**
 * Execute an AI Agent task using the registered task handler
 */
const executeTask: ExecuteTaskFunction = async (
  task: AIAgentTaskData,
): Promise<void> => {
  const taskIdString: string = task._id;
  const projectIdString: string = task.projectId;
  const taskId: ObjectID = new ObjectID(taskIdString);
  const projectId: ObjectID = new ObjectID(projectIdString);
  const taskType: AIAgentTaskType = task.taskType;
  const metadata: TaskMetadata = task.metadata || {};
  const createdAt: Date = new Date(task.createdAt);

  // Get the task handler from the registry
  const registry: TaskHandlerRegistry = getTaskHandlerRegistry();
  const handler: TaskHandler | undefined = registry.getHandler(taskType);

  if (!handler) {
    throw new Error(`No handler registered for task type: ${taskType}`);
  }

  // Create task logger
  const taskLogger: TaskLogger = new TaskLogger({
    taskId: taskIdString,
    context: `${handler.name}`,
  });

  // Create backend API client
  const backendAPI: BackendAPI = new BackendAPI();

  // Build task context
  const context: TaskContext = {
    taskId,
    projectId,
    taskType,
    metadata,
    logger: taskLogger,
    backendAPI,
    createdAt,
    startedAt: new Date(),
  };

  try {
    // Log handler starting
    await taskLogger.info(
      `Starting ${handler.name} for task type: ${taskType}`,
    );

    // Validate metadata if the handler supports it
    if (handler.validateMetadata && !handler.validateMetadata(metadata)) {
      throw new Error(`Invalid metadata for task type: ${taskType}`);
    }

    // Execute the task handler
    const result: TaskResult = await handler.execute(context);

    // Log result
    if (result.success) {
      await taskLogger.info(`Task completed: ${result.message}`);

      if (result.pullRequestsCreated && result.pullRequestsCreated > 0) {
        await taskLogger.info(
          `Created ${result.pullRequestsCreated} pull request(s): ${result.pullRequestUrls?.join(", ") || ""}`,
        );
      }
    } else {
      await taskLogger.warning(`Task did not succeed: ${result.message}`);
    }

    // Flush all pending logs
    await taskLogger.flush();

    /*
     * If the task was not successful and we want to report it as an error
     * Note: Based on user requirements, "no fix found" should be Completed, not Error
     * Only throw if there was an actual error (not just "no action taken")
     */
    if (!result.success && result.data?.["isError"]) {
      throw new Error(result.message);
    }
  } catch (error) {
    // Ensure logs are flushed even on error
    await taskLogger.flush();
    throw error;
  }
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

        const responseData: GetPendingTaskResponse =
          getPendingTaskResult.data as unknown as GetPendingTaskResponse;
        const task: AIAgentTaskData | null = responseData.task;

        if (!task || !task._id) {
          logger.debug("No pending tasks available");
          logger.debug(
            `Sleeping for ${SLEEP_WHEN_NO_TASKS_MS / 1000} seconds before checking again...`,
          );
          await Sleep.sleep(SLEEP_WHEN_NO_TASKS_MS);
          continue;
        }

        const taskId: string = task._id;
        const taskType: string = task.taskType || "Unknown";
        logger.info(`Processing task: ${taskId} (type: ${taskType})`);

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

          /* Execute the task using the handler system */
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
