import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";
import Dictionary from "Common/Types/Dictionary";

export interface IncomingRequestIngestJobData {
  secretKey: string;
  requestHeaders: Dictionary<string>;
  requestBody: string | JSONObject;
  requestMethod: string;
  ingestionTimestamp: Date;
}

export default class IncomingRequestIngestQueueService {
  public static async addIncomingRequestIngestJob(data: {
    secretKey: string;
    requestHeaders: Dictionary<string>;
    requestBody: string | JSONObject;
    requestMethod: string;
  }): Promise<void> {
    try {
      const jobData: IncomingRequestIngestJobData = {
        secretKey: data.secretKey,
        requestHeaders: data.requestHeaders,
        requestBody: data.requestBody,
        requestMethod: data.requestMethod,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobId: string = `incoming-request-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.IncomingRequestIngest,
        jobId,
        "ProcessIncomingRequestIngest",
        jobData as unknown as JSONObject,
      );

      logger.debug(`Added incoming request ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding incoming request ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async getQueueSize(): Promise<number> {
    return Queue.getQueueSize(QueueName.IncomingRequestIngest);
  }

  public static async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  }> {
    return Queue.getQueueStats(QueueName.IncomingRequestIngest);
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
    return Queue.getFailedJobs(QueueName.IncomingRequestIngest, options);
  }
}
