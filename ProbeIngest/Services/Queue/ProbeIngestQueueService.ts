import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";

export interface ProbeIngestJobData {
  probeMonitorResponse: JSONObject;
  jobType: "probe-response" | "monitor-test";
  testId?: string | undefined;
  ingestionTimestamp: Date;
}

export default class ProbeIngestQueueService {
  public static async addProbeIngestJob(data: {
    probeMonitorResponse: JSONObject;
    jobType: "probe-response" | "monitor-test";
    testId?: string;
  }): Promise<void> {
    try {
      const jobData: ProbeIngestJobData = {
        probeMonitorResponse: data.probeMonitorResponse,
        jobType: data.jobType,
        testId: data.testId,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobId: string = `probe-${data.jobType}-${data.testId || "general"}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.ProbeIngest,
        jobId,
        "ProcessProbeIngest",
        jobData as unknown as JSONObject,
      );

      logger.debug(`Added probe ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding probe ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async getQueueSize(): Promise<number> {
    return Queue.getQueueSize(QueueName.ProbeIngest);
  }

  public static async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  }> {
    return Queue.getQueueStats(QueueName.ProbeIngest);
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
    return Queue.getFailedJobs(QueueName.ProbeIngest, options);
  }
}
