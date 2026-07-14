import ObjectID from "Common/Types/ObjectID";
import TaskLogger from "../Utils/TaskLogger";
import BackendAPI from "../Utils/BackendAPI";

// Base interface for task result data
export interface TaskResultData {
  // Pull requests created (for Fix Exception tasks)
  pullRequests?: Array<string>;
  // Errors encountered during processing
  errors?: Array<string>;
  // Flag to indicate if this is an error result (not just "no action taken")
  isError?: boolean;
  // Additional data fields
  [key: string]: unknown;
}

// Context provided to task handlers
export interface TaskContext {
  // Task identification (the id of the AIRun row on the server)
  taskId: ObjectID;
  projectId: ObjectID;
  /*
   * The wire discriminator from get-pending-task (e.g. "FixException",
   * "WriteRegressionTest"). Plain string — see Common/Types/AI/
   * CodeFixTaskType for the wire values.
   */
  taskType: string;

  /*
   * The exception this run should fix — present only for exception-based
   * recipes. ImproveInstrumentation / FixFromIncident runs have an
   * incident/alert subject instead and fetch their context by run id
   * (get-instrumentation-task-details).
   */
  exceptionId?: string | undefined;

  // Utilities
  logger: TaskLogger;
  backendAPI: BackendAPI;

  // Task timestamps
  startedAt: Date;
}

// Result returned by task handlers
export interface TaskResult {
  // Whether the task completed successfully
  success: boolean;

  // Human-readable message describing the result
  message: string;

  // Additional data about the result (optional)
  data?: TaskResultData;

  // Number of PRs created (for Fix Exception tasks)
  pullRequestsCreated?: number;

  // List of PR URLs created
  pullRequestUrls?: Array<string>;
}

// Interface that all task handlers must implement
export interface TaskHandler {
  // The task-type string this handler processes (registry key)
  readonly taskType: string;

  // Human-readable name for the handler
  readonly name: string;

  // Execute the task and return a result
  execute(context: TaskContext): Promise<TaskResult>;

  // Check if this handler can process a given task
  canHandle(taskType: string): boolean;

  // Optional: Get a description of what this handler does
  getDescription?(): string;
}

// Abstract base class that provides common functionality for task handlers
export abstract class BaseTaskHandler implements TaskHandler {
  public abstract readonly taskType: string;
  public abstract readonly name: string;

  public abstract execute(context: TaskContext): Promise<TaskResult>;

  public canHandle(taskType: string): boolean {
    return taskType === this.taskType;
  }

  // Create a success result
  protected createSuccessResult(
    message: string,
    data?: TaskResultData,
  ): TaskResult {
    const result: TaskResult = {
      success: true,
      message,
    };

    if (data) {
      result.data = data;
    }

    return result;
  }

  // Create a failure result
  protected createFailureResult(
    message: string,
    data?: TaskResultData,
  ): TaskResult {
    const result: TaskResult = {
      success: false,
      message,
    };

    if (data) {
      result.data = data;
    }

    return result;
  }

  // Create a result for when no action was taken
  protected createNoActionResult(message: string): TaskResult {
    return {
      success: true,
      message,
      pullRequestsCreated: 0,
    };
  }

  // Log to the task logger
  protected async log(
    context: TaskContext,
    message: string,
    level: "info" | "debug" | "warning" | "error" = "info",
  ): Promise<void> {
    switch (level) {
      case "debug":
        await context.logger.debug(message);
        break;
      case "warning":
        await context.logger.warning(message);
        break;
      case "error":
        await context.logger.error(message);
        break;
      case "info":
      default:
        await context.logger.info(message);
        break;
    }
  }
}
