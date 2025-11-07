import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";

export interface FluentLogsJobData {
  projectId: string;
  requestBody: JSONObject;
  requestHeaders: Record<string, string>;
  ingestionTimestamp: Date;
}

export default class FluentLogsQueueService {
  public static async addFluentLogsJob(req: TelemetryRequest): Promise<void> {
    try {
      const jobData: FluentLogsJobData = {
        projectId: req.projectId.toString(),
        requestBody: req.body,
        requestHeaders: req.headers as Record<string, string>,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobId: string = `fluent-logs-${req.projectId?.toString()}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.FluentLogs,
        jobId,
        "ProcessFluentLogs",
        jobData as unknown as JSONObject,
      );

      logger.debug(`Added fluent logs ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding fluent logs ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async getQueueSize(): Promise<number> {
    return Queue.getQueueSize(QueueName.FluentLogs);
  }

  public static async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  }> {
    return Queue.getQueueStats(QueueName.FluentLogs);
  }

  public static getFailedJobs(options?: {
    start?: number;
    end?: number;
  }): Promise<
    Array<{
      id: string;
      name: string;
      data: JSONObject;
      failedReason: string;
      stackTrace?: string;
      processedOn: Date | null;
      finishedOn: Date | null;
      attemptsMade: number;
    }>
  > {
    return Queue.getFailedJobs(QueueName.FluentLogs, options);
  }
}
