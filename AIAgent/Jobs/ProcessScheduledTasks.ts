import { ONEUPTIME_URL } from "../Config";
import AIAgentAPIRequest from "../Utils/AIAgentAPIRequest";
import AIAgentTaskLog from "../Utils/AIAgentTaskLog";
import TaskLogger from "../Utils/TaskLogger";
import BackendAPI from "../Utils/BackendAPI";
import {
  getTaskHandlerRegistry,
  TaskContext,
  TaskHandler,
  TaskResult,
} from "../TaskHandlers/Index";
import TaskHandlerRegistry from "../TaskHandlers/TaskHandlerRegistry";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import ObjectID from "Common/Types/ObjectID";
import Sleep from "Common/Types/Sleep";

/*
 * Type for a pending task claimed from the API. Tasks are AIRun rows on the
 * server, so `id` is the run id; exception details are fetched separately
 * via /api/ai-agent-data/get-exception-details. `taskType` discriminates
 * which handler runs the task ("FixException", "WriteRegressionTest", ...).
 * `exceptionId` is present only for exception-based recipes —
 * ImproveInstrumentation / FixFromIncident runs have an incident/alert
 * subject instead and fetch their context by run id
 * (get-instrumentation-task-details).
 */
export interface PendingTask {
  id: string;
  projectId: string;
  exceptionId?: string | undefined;
  taskType: string;
}

// Type for API response containing task
interface GetPendingTaskResponse {
  task: PendingTask | null;
  message?: string;
}

const SLEEP_WHEN_NO_TASKS_MS: number = 60 * 1000; // 1 minute

/*
 * How a task finished, for the caller to report. Only the two non-failure
 * outcomes are represented — a task that could not finish throws instead, and
 * the catch block reports Error.
 */
export interface TaskOutcome {
  status: AIAgentTaskStatus.Completed | AIAgentTaskStatus.NoFixFound;
  // Why no fix was proposed. Only set for NoFixFound.
  statusMessage?: string | undefined;
}

type ExecuteTaskFunction = (task: PendingTask) => Promise<TaskOutcome>;

/**
 * Execute an AI Agent task using the registered task handler
 */
export const executeTask: ExecuteTaskFunction = async (
  task: PendingTask,
): Promise<TaskOutcome> => {
  const taskIdString: string = task.id;
  const projectIdString: string = task.projectId;
  const taskId: ObjectID = new ObjectID(taskIdString);
  const projectId: ObjectID = new ObjectID(projectIdString);

  /*
   * Dispatch on the server's taskType discriminator. Older servers predate
   * the field and only ever hand out code-fix runs, so an absent taskType
   * normalizes to FixException — keep this fallback until no pre-taskType
   * servers remain in the field.
   */
  const taskType: string = task.taskType || CodeFixTaskType.FixException;

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
    exceptionId: task.exceptionId,
    logger: taskLogger,
    backendAPI,
    startedAt: new Date(),
  };

  try {
    // Log handler starting
    await taskLogger.info(
      `Starting ${handler.name} for task type: ${taskType}`,
    );

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
     * A task that could not finish throws — the caller's catch block reports
     * Error. A task that ran fine but had no fix to propose is NOT an error:
     * it reports NoFixFound so a negative result never shows up as a failure.
     */
    if (!result.success && result.data?.["isError"]) {
      throw new Error(result.message);
    }

    if (result.data?.["noFixFound"]) {
      return {
        status: AIAgentTaskStatus.NoFixFound,
        statusMessage: result.message,
      };
    }

    return { status: AIAgentTaskStatus.Completed };
  } catch (error) {
    // Ensure logs are flushed even on error
    await taskLogger.flush();
    throw error;
  }
};

const startTaskProcessingLoop: () => Promise<void> =
  async (): Promise<void> => {
    logger.info(
      "Starting AI Agent task processing loop...",
      {} as LogAttributes,
    );

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
          logger.error(
            "Failed to fetch pending task from server",
            {} as LogAttributes,
          );
          logger.debug(
            `Sleeping for ${SLEEP_WHEN_NO_TASKS_MS / 1000} seconds before retrying...`,
            {} as LogAttributes,
          );
          await Sleep.sleep(SLEEP_WHEN_NO_TASKS_MS);
          continue;
        }

        const responseData: GetPendingTaskResponse =
          getPendingTaskResult.data as unknown as GetPendingTaskResponse;
        const task: PendingTask | null = responseData.task;

        if (!task || !task.id) {
          logger.debug("No pending tasks available", {} as LogAttributes);
          logger.debug(
            `Sleeping for ${SLEEP_WHEN_NO_TASKS_MS / 1000} seconds before checking again...`,
            {} as LogAttributes,
          );
          await Sleep.sleep(SLEEP_WHEN_NO_TASKS_MS);
          continue;
        }

        const taskId: string = task.id;
        const taskLogAttrs: LogAttributes = {
          taskId,
          projectId: task.projectId,
          exceptionId: task.exceptionId,
          taskType: task.taskType,
        } as LogAttributes;
        logger.info(
          `Processing task: ${taskId} (type: ${task.taskType || CodeFixTaskType.FixException}${task.exceptionId ? `, exception: ${task.exceptionId}` : ""})`,
          taskLogAttrs,
        );

        try {
          /*
           * get-pending-task already claimed the task (Scheduled ->
           * InProgress) atomically on the server, so this update is a
           * no-op refresh there — but it is load-bearing against older
           * servers that return tasks unclaimed, so keep it until no
           * pre-claim servers remain in the field.
           */
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
              taskLogAttrs,
            );
            continue;
          }

          /* Send task started log */
          await AIAgentTaskLog.sendTaskStartedLog(taskId);

          /* Execute the task using the handler system */
          const outcome: TaskOutcome = await executeTask(task);

          /* Mark task as Completed / NoFixFound */
          let finalResult: HTTPResponse<JSONObject> = await API.post({
            url: updateTaskStatusUrl,
            data: {
              ...AIAgentAPIRequest.getDefaultRequestBody(),
              taskId: taskId,
              status: outcome.status,
              ...(outcome.statusMessage
                ? { statusMessage: outcome.statusMessage }
                : {}),
            },
          });

          /*
           * Servers that predate NoFixFound reject it as an invalid status,
           * which would leave the run Running until the sweeper marked it
           * Stale. Fall back to Completed: the run did finish, and a stale
           * red run would be a worse lie than a green one.
           */
          if (
            !finalResult.isSuccess() &&
            outcome.status === AIAgentTaskStatus.NoFixFound
          ) {
            logger.warn(
              `Server rejected NoFixFound for task ${taskId}; reporting Completed instead`,
              taskLogAttrs,
            );

            finalResult = await API.post({
              url: updateTaskStatusUrl,
              data: {
                ...AIAgentAPIRequest.getDefaultRequestBody(),
                taskId: taskId,
                status: AIAgentTaskStatus.Completed,
              },
            });
          }

          if (!finalResult.isSuccess()) {
            logger.error(
              `Failed to mark task ${taskId} as ${outcome.status}`,
              taskLogAttrs,
            );
          } else if (outcome.status === AIAgentTaskStatus.NoFixFound) {
            await AIAgentTaskLog.sendTaskNoFixFoundLog(
              taskId,
              outcome.statusMessage || "",
            );
            logger.info(
              `Task finished with no fix to propose: ${taskId}`,
              taskLogAttrs,
            );
          } else {
            /* Send task completed log */
            await AIAgentTaskLog.sendTaskCompletedLog(taskId);
            logger.info(`Task completed successfully: ${taskId}`, taskLogAttrs);
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
              taskLogAttrs,
            );
          }

          /* Send task error log */
          await AIAgentTaskLog.sendTaskErrorLog(taskId, errorMessage);

          logger.error(
            `Task failed: ${taskId} - ${errorMessage}`,
            taskLogAttrs,
          );
          logger.error(error, taskLogAttrs);
        }
      } catch (error) {
        logger.error("Error in task processing loop:", {} as LogAttributes);
        logger.error(error, {} as LogAttributes);
        logger.debug(
          `Sleeping for ${SLEEP_WHEN_NO_TASKS_MS / 1000} seconds before retrying...`,
          {} as LogAttributes,
        );
        await Sleep.sleep(SLEEP_WHEN_NO_TASKS_MS);
      }
    }
  };

export default startTaskProcessingLoop;
