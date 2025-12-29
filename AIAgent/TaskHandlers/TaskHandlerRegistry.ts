import { TaskHandler } from "./TaskHandlerInterface";
import AIAgentTaskType from "Common/Types/AI/AIAgentTaskType";
import logger from "Common/Server/Utils/Logger";

// Registry for task handlers
// Allows dynamic registration and lookup of handlers by task type
export default class TaskHandlerRegistry {
  private static instance: TaskHandlerRegistry | null = null;
  private handlers: Map<AIAgentTaskType, TaskHandler> = new Map();

  // Private constructor for singleton pattern
  private constructor() {}

  // Get the singleton instance
  public static getInstance(): TaskHandlerRegistry {
    if (!TaskHandlerRegistry.instance) {
      TaskHandlerRegistry.instance = new TaskHandlerRegistry();
    }
    return TaskHandlerRegistry.instance;
  }

  // Reset the singleton (useful for testing)
  public static resetInstance(): void {
    TaskHandlerRegistry.instance = null;
  }

  // Register a task handler
  public register(handler: TaskHandler): void {
    if (this.handlers.has(handler.taskType)) {
      logger.warn(
        `Overwriting existing handler for task type: ${handler.taskType}`,
      );
    }

    this.handlers.set(handler.taskType, handler);
    logger.debug(
      `Registered handler "${handler.name}" for task type: ${handler.taskType}`,
    );
  }

  // Register multiple handlers at once
  public registerAll(handlers: Array<TaskHandler>): void {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  // Unregister a handler
  public unregister(taskType: AIAgentTaskType): void {
    if (this.handlers.has(taskType)) {
      this.handlers.delete(taskType);
      logger.debug(`Unregistered handler for task type: ${taskType}`);
    }
  }

  // Get a handler for a specific task type
  public getHandler(taskType: AIAgentTaskType): TaskHandler | undefined {
    return this.handlers.get(taskType);
  }

  // Check if a handler exists for a task type
  public hasHandler(taskType: AIAgentTaskType): boolean {
    return this.handlers.has(taskType);
  }

  // Get all registered task types
  public getRegisteredTaskTypes(): Array<AIAgentTaskType> {
    return Array.from(this.handlers.keys());
  }

  // Get all registered handlers
  public getAllHandlers(): Array<TaskHandler> {
    return Array.from(this.handlers.values());
  }

  // Get the number of registered handlers
  public getHandlerCount(): number {
    return this.handlers.size;
  }

  // Clear all handlers
  public clear(): void {
    this.handlers.clear();
    logger.debug("Cleared all task handlers");
  }
}

// Export a convenience function to get the registry instance
export function getTaskHandlerRegistry(): TaskHandlerRegistry {
  return TaskHandlerRegistry.getInstance();
}
