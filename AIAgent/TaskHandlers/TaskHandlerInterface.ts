import { JSONObject } from "Common/Types/JSON";
import AIAgentTaskType from "Common/Types/AI/AIAgentTaskType";
import TaskLogger from "../Utils/TaskLogger";
import BackendAPI from "../Utils/BackendAPI";

// Context provided to task handlers
export interface TaskContext {
  // Task identification
  taskId: string;
  projectId: string;
  taskType: AIAgentTaskType;

  // Task metadata (varies by task type)
  metadata: JSONObject;

  // Utilities
  logger: TaskLogger;
  backendAPI: BackendAPI;

  // Task timestamps
  createdAt: Date;
  startedAt: Date;
}

// Result returned by task handlers
export interface TaskResult {
  // Whether the task completed successfully
  success: boolean;

  // Human-readable message describing the result
  message: string;

  // Additional data about the result (optional)
  data?: JSONObject;

  // Number of PRs created (for Fix Exception tasks)
  pullRequestsCreated?: number;

  // List of PR URLs created
  pullRequestUrls?: Array<string>;
}

// Interface that all task handlers must implement
export interface TaskHandler {
  // The type of task this handler processes
  readonly taskType: AIAgentTaskType;

  // Human-readable name for the handler
  readonly name: string;

  // Execute the task and return a result
  execute(context: TaskContext): Promise<TaskResult>;

  // Check if this handler can process a given task
  canHandle(taskType: AIAgentTaskType): boolean;

  // Optional: Validate task metadata before execution
  validateMetadata?(metadata: JSONObject): boolean;

  // Optional: Get a description of what this handler does
  getDescription?(): string;
}

// Abstract base class that provides common functionality for task handlers
export abstract class BaseTaskHandler implements TaskHandler {
  public abstract readonly taskType: AIAgentTaskType;
  public abstract readonly name: string;

  public abstract execute(context: TaskContext): Promise<TaskResult>;

  public canHandle(taskType: AIAgentTaskType): boolean {
    return taskType === this.taskType;
  }

  // Create a success result
  protected createSuccessResult(
    message: string,
    data?: JSONObject,
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
    data?: JSONObject,
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
