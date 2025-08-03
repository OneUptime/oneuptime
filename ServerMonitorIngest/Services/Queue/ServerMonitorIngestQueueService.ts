import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";

export interface ServerMonitorIngestJobData {
  secretKey: string;
  serverMonitorResponse: JSONObject;
  ingestionTimestamp: Date;
}

export default class ServerMonitorIngestQueueService {
  public static async addServerMonitorIngestJob(data: {
    secretKey: string;
    serverMonitorResponse: JSONObject;
  }): Promise<void> {
    try {
      const jobData: ServerMonitorIngestJobData = {
        secretKey: data.secretKey,
        serverMonitorResponse: data.serverMonitorResponse,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobId: string = `server-monitor-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.ServerMonitorIngest,
        jobId,
        "ProcessServerMonitorIngest",
        jobData as unknown as JSONObject,
      );

      logger.debug(`Added server monitor ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding server monitor ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async getQueueSize(): Promise<number> {
    return Queue.getQueueSize(QueueName.ServerMonitorIngest);
  }

  public static async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  }> {
    return Queue.getQueueStats(QueueName.ServerMonitorIngest);
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
    return Queue.getFailedJobs(QueueName.ServerMonitorIngest, options);
  }
}
