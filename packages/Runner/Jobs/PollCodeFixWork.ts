import { ONEUPTIME_BASE_URL } from "../Config";
import RunnerAPIRequest from "../Utils/RunnerAPIRequest";
import RunnerCapabilities from "../Utils/RunnerCapabilities";
import AIAgentTaskLog from "../Utils/CodeFixTaskLog";
import TaskLogger from "../Utils/TaskLogger";
import BackendAPI, {
  RecordPullRequestOptions,
  UnrecordedPullRequest,
} from "../Utils/BackendAPI";
import SecretRedactor from "../Utils/SecretRedactor";
import RepositoryTokenRevocation from "../Utils/RepositoryTokenRevocation";
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
import { JSONArray, JSONObject } from "Common/Types/JSON";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import { CodeTaskOutcomeReport } from "Common/Types/AI/CodeTask";
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
 * The report that closes a task is retried when the request never got an
 * answer, or got one that says the server broke rather than the request — a
 * deploy, a dropped connection. Lost, it leaves the run Running until the
 * stale-run sweeper fails it, and takes the pull requests a Completed report
 * carries with it. The server closes a run once and records a pull request
 * once, so a retry of a report that did land changes nothing.
 */
const FINAL_STATUS_REPORT_RETRIES: number = 3;

/*
 * How a task finished, for the caller to report. Only the two non-failure
 * outcomes are represented — a task that could not finish throws instead, and
 * the catch block reports Error.
 */
export interface TaskOutcome {
  status: AIAgentTaskStatus.Completed | AIAgentTaskStatus.NoFixFound;
  // Why no fix was proposed. Only set for NoFixFound.
  statusMessage?: string | undefined;
  /*
   * The pull requests the task opened. Only set for Completed, and reported
   * with it: recording a pull request can fail after GitHub has opened it
   * (BaseTaskHandler.recordOpenedPullRequest), and the status report is then
   * the only way the server learns where the pull request is.
   */
  pullRequestUrls?: Array<string> | undefined;
  /*
   * The pull requests the task opened but could not record, each with the
   * record it failed to make. Only set for Completed, whose report carries
   * them for the server to record.
   */
  unrecordedPullRequests?: Array<UnrecordedPullRequest> | undefined;
  /*
   * What a request from Code ended with (TaskResult.outcome): sent with the
   * Completed status, which the server keeps on the run for the task's
   * conversation. A server that predates it ignores it.
   */
  outcome?: CodeTaskOutcomeReport | undefined;
}

type ExecuteTaskFunction = (task: PendingTask) => Promise<TaskOutcome>;

type ToUnrecordedPullRequestFunction = (
  record: RecordPullRequestOptions,
) => UnrecordedPullRequest;

/*
 * A record that failed, as the status report carries it: every field it had,
 * without the task (the report names it).
 */
const toUnrecordedPullRequest: ToUnrecordedPullRequestFunction = (
  record: RecordPullRequestOptions,
): UnrecordedPullRequest => {
  const unrecorded: Partial<RecordPullRequestOptions> = { ...record };

  delete unrecorded.taskId;

  return unrecorded as UnrecordedPullRequest;
};

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
    unrecordedPullRequests: [],
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

    const unrecordedPullRequests: Array<RecordPullRequestOptions> =
      context.unrecordedPullRequests || [];

    return {
      status: AIAgentTaskStatus.Completed,
      ...(result.outcome ? { outcome: result.outcome } : {}),
      ...(result.pullRequestUrls && result.pullRequestUrls.length > 0
        ? { pullRequestUrls: result.pullRequestUrls }
        : {}),
      ...(unrecordedPullRequests.length > 0
        ? {
            unrecordedPullRequests: unrecordedPullRequests.map(
              toUnrecordedPullRequest,
            ),
          }
        : {}),
    };
  } finally {
    /*
     * The GitHub tokens this run was handed end with it, however it ended:
     * revoked rather than left good for the rest of their hour
     * (RepositoryTokenRevocation). First, so nothing below can keep it
     * from happening (it never throws), and before the redactor forgets
     * them, so nothing said about the revocation can carry one.
     */
    await RepositoryTokenRevocation.revokeAll();

    /*
     * dispose(), not flush(): a TaskLogger starts a repeating flush timer in
     * its constructor, and only dispose() stops it. One logger is created
     * per task and this loop runs for the life of the container, so flushing
     * without disposing left a live interval behind for every task the
     * Runner had ever processed — each waking every five seconds and POSTing
     * to the server forever, against a task that finished hours ago.
     * dispose() flushes as well, so nothing is lost on either path.
     */
    await taskLogger.dispose();

    /*
     * The repository access token was registered with the redactor while
     * this run held it. Forget it now: this Runner is long-lived and
     * processes runs for other repositories, and a stale registration keeps
     * a dead credential in memory for the life of the process.
     */
    SecretRedactor.clearRegistered();
  }
};

type BuildTaskOutcomeReportFunction = (data: {
  taskId: string;
  outcome: TaskOutcome;
}) => JSONObject;

/*
 * The status report that closes a task that finished. A field is only sent
 * when it has a value, so a task that opened no pull request reports exactly
 * what it always did — and a server that predates pullRequestUrls or
 * unrecordedPullRequests never reads them, which is all an older server
 * needs.
 */
export const buildTaskOutcomeReport: BuildTaskOutcomeReportFunction = (data: {
  taskId: string;
  outcome: TaskOutcome;
}): JSONObject => {
  return {
    ...RunnerAPIRequest.getDefaultRequestBody(),
    taskId: data.taskId,
    status: data.outcome.status,
    ...(data.outcome.statusMessage
      ? { statusMessage: data.outcome.statusMessage }
      : {}),
    ...(data.outcome.pullRequestUrls && data.outcome.pullRequestUrls.length > 0
      ? { pullRequestUrls: data.outcome.pullRequestUrls }
      : {}),
    ...(data.outcome.unrecordedPullRequests &&
    data.outcome.unrecordedPullRequests.length > 0
      ? {
          unrecordedPullRequests: data.outcome
            .unrecordedPullRequests as unknown as JSONArray,
        }
      : {}),
    ...(data.outcome.outcome
      ? { outcome: data.outcome.outcome as unknown as JSONObject }
      : {}),
  };
};

type BuildPendingTaskRequestFunction = () => JSONObject;

/*
 * The request that asks for work: this Runner's credentials, and the
 * recipes it has a handler for. A server hands it only those - so a
 * request from Code is never given to a Runner that cannot do it - and a
 * server that predates the list ignores it.
 */
export const buildPendingTaskRequest: BuildPendingTaskRequestFunction =
  (): JSONObject => {
    return {
      ...RunnerAPIRequest.getDefaultRequestBody(),
      supportedTaskTypes: getTaskHandlerRegistry().getRegisteredTaskTypes(),
    };
  };

type SendFinalStatusReportFunction = (data: {
  url: URL;
  report: JSONObject;
  logAttributes: LogAttributes;
}) => Promise<HTTPResponse<JSONObject> | null>;

/*
 * Send the report that closes a task — Completed, NoFixFound or Error — with
 * retries. Null when no answer came back, retries included. API.post throws
 * then, and a Completed or NoFixFound report's throw must not reach the catch
 * that reports Error: the task finished, and an Error report that got
 * through once the server was back would say it failed.
 */
const sendFinalStatusReport: SendFinalStatusReportFunction = async (data: {
  url: URL;
  report: JSONObject;
  logAttributes: LogAttributes;
}): Promise<HTTPResponse<JSONObject> | null> => {
  try {
    return await API.post({
      url: data.url,
      data: data.report,
      options: RunnerAPIRequest.getDefaultRequestOptions({
        retries: FINAL_STATUS_REPORT_RETRIES,
        exponentialBackoff: true,
        retryOnlyOnRetryableErrors: true,
      }),
    });
  } catch (error) {
    logger.error(error, data.logAttributes);
    return null;
  }
};

const startTaskProcessingLoop: () => Promise<void> =
  async (): Promise<void> => {
    logger.info(
      "Starting AI Agent task processing loop...",
      {} as LogAttributes,
    );

    const getPendingTaskUrl: URL = URL.fromString(
      ONEUPTIME_BASE_URL.toString(),
    ).addRoute("/api/ai-agent-task/get-pending-task");

    const updateTaskStatusUrl: URL = URL.fromString(
      ONEUPTIME_BASE_URL.toString(),
    ).addRoute("/api/ai-agent-task/update-task-status");

    /* Continuous loop to process tasks */
    while (true) {
      try {
        /*
         * Read on every pass, not once at boot: the dashboard is the control
         * plane for capabilities and the heartbeat adopts changes as they
         * happen. Revoking code fixes stops this loop claiming within a
         * heartbeat — which also keeps it from hammering an endpoint that
         * would now reject it — and granting them starts claiming without a
         * restart.
         */
        if (!RunnerCapabilities.resolve().canRunCodeFixTasks) {
          await Sleep.sleep(SLEEP_WHEN_NO_TASKS_MS);
          continue;
        }

        /* Fetch one scheduled task */
        const getPendingTaskResult: HTTPResponse<JSONObject> = await API.post({
          url: getPendingTaskUrl,
          data: buildPendingTaskRequest(),
          options: RunnerAPIRequest.getDefaultRequestOptions(),
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
              ...RunnerAPIRequest.getDefaultRequestBody(),
              taskId: taskId,
              status: AIAgentTaskStatus.InProgress,
            },
            options: RunnerAPIRequest.getDefaultRequestOptions(),
          });

          if (!inProgressResult.isSuccess()) {
            logger.error(
              `Failed to mark task ${taskId} as InProgress. Skipping.`,
              taskLogAttrs,
            );
            /*
             * Back off before asking for more work. get-pending-task has
             * ALREADY claimed this run server-side, so skipping abandons it
             * — and if the cause is a server-side problem (the endpoint is
             * down, this Runner's credential was revoked), the next pass
             * claims and abandons the next queued run just as fast. Without
             * this sleep that is an unthrottled loop that burns through
             * every queued run in the project in seconds and leaves them all
             * stranded InProgress for the stale-run sweeper.
             */
            await Sleep.sleep(SLEEP_WHEN_NO_TASKS_MS);
            continue;
          }

          /* Send task started log */
          await AIAgentTaskLog.sendTaskStartedLog(taskId);

          /* Execute the task using the handler system */
          const outcome: TaskOutcome = await executeTask(task);

          /* Mark task as Completed / NoFixFound */
          let finalResult: HTTPResponse<JSONObject> | null =
            await sendFinalStatusReport({
              url: updateTaskStatusUrl,
              report: buildTaskOutcomeReport({
                taskId: taskId,
                outcome: outcome,
              }),
              logAttributes: taskLogAttrs,
            });

          /*
           * Servers that predate NoFixFound refuse it as an invalid status (a
           * 400), which would leave the run Running until the sweeper marked
           * it Stale. Fall back to Completed: the run did finish, and a stale
           * red run would be a worse lie than a green one. Only on that
           * refusal: no answer, or a server error that outlasted the retries,
           * says nothing about what the server supports, and a Completed that
           * got through once it was back would hide why no fix was found.
           */
          if (
            outcome.status === AIAgentTaskStatus.NoFixFound &&
            finalResult?.statusCode === 400
          ) {
            logger.warn(
              `Server rejected NoFixFound for task ${taskId}; reporting Completed instead`,
              taskLogAttrs,
            );

            finalResult = await sendFinalStatusReport({
              url: updateTaskStatusUrl,
              report: {
                ...RunnerAPIRequest.getDefaultRequestBody(),
                taskId: taskId,
                status: AIAgentTaskStatus.Completed,
              },
              logAttributes: taskLogAttrs,
            });
          }

          if (!finalResult || !finalResult.isSuccess()) {
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

          const errorResult: HTTPResponse<JSONObject> | null =
            await sendFinalStatusReport({
              url: updateTaskStatusUrl,
              report: {
                ...RunnerAPIRequest.getDefaultRequestBody(),
                taskId: taskId,
                status: AIAgentTaskStatus.Error,
                statusMessage: errorMessage,
              },
              logAttributes: taskLogAttrs,
            });

          if (!errorResult || !errorResult.isSuccess()) {
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
