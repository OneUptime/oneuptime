import { ONEUPTIME_URL } from "../Config";
import AIAgentAPIRequest from "./AIAgentAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import logger from "Common/Server/Utils/Logger";

export interface SendLogOptions {
  taskId: string;
  severity: LogSeverity;
  message: string;
}

export default class AIAgentTaskLog {
  private static createLogUrl: URL | null = null;

  private static getCreateLogUrl(): URL {
    if (!this.createLogUrl) {
      this.createLogUrl = URL.fromString(ONEUPTIME_URL.toString()).addRoute(
        "/api/ai-agent-task-log/create-log",
      );
    }
    return this.createLogUrl;
  }

  public static async sendLog(options: SendLogOptions): Promise<boolean> {
    try {
      const result: HTTPResponse<JSONObject> = await API.post({
        url: this.getCreateLogUrl(),
        data: {
          ...AIAgentAPIRequest.getDefaultRequestBody(),
          taskId: options.taskId,
          severity: options.severity,
          message: options.message,
        },
      });

      if (!result.isSuccess()) {
        logger.error(`Failed to send log for task ${options.taskId}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`Error sending log for task ${options.taskId}:`);
      logger.error(error);
      return false;
    }
  }

  public static async sendTaskStartedLog(taskId: string): Promise<boolean> {
    return this.sendLog({
      taskId,
      severity: LogSeverity.Information,
      message: "Task execution started",
    });
  }

  public static async sendTaskCompletedLog(taskId: string): Promise<boolean> {
    return this.sendLog({
      taskId,
      severity: LogSeverity.Information,
      message: "Task execution completed successfully",
    });
  }

  public static async sendTaskErrorLog(
    taskId: string,
    errorMessage: string,
  ): Promise<boolean> {
    return this.sendLog({
      taskId,
      severity: LogSeverity.Error,
      message: `Task execution failed: ${errorMessage}`,
    });
  }
}
