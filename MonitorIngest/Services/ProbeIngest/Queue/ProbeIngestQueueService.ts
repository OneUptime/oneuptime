import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";
import Dictionary from "Common/Types/Dictionary";

export type ProbeIngestJobType =
  | "probe-response"
  | "monitor-test"
  | "incoming-email";

export interface ProbeIngestJobData {
  jobType: ProbeIngestJobType;
  ingestionTimestamp: Date;
  // For probe-response and monitor-test
  probeMonitorResponse?: JSONObject | undefined;
  testId?: string | undefined;
  // For incoming-email
  incomingEmail?: IncomingEmailJobData | undefined;
}

export interface IncomingEmailJobData {
  secretKey: string;
  emailFrom: string;
  emailTo: string;
  emailSubject: string;
  emailBody: string;
  emailBodyHtml: string | undefined;
  emailHeaders: Dictionary<string> | undefined;
  attachments:
    | Array<{
        filename: string;
        contentType: string;
        size: number;
      }>
    | undefined;
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

  public static async addIncomingEmailJob(data: {
    secretKey: string;
    emailFrom: string;
    emailTo: string;
    emailSubject: string;
    emailBody: string;
    emailBodyHtml?: string | undefined;
    emailHeaders?: Dictionary<string> | undefined;
    attachments?:
      | Array<{
          filename: string;
          contentType: string;
          size: number;
        }>
      | undefined;
  }): Promise<void> {
    try {
      const jobData: ProbeIngestJobData = {
        jobType: "incoming-email",
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        incomingEmail: {
          secretKey: data.secretKey,
          emailFrom: data.emailFrom,
          emailTo: data.emailTo,
          emailSubject: data.emailSubject,
          emailBody: data.emailBody,
          emailBodyHtml: data.emailBodyHtml,
          emailHeaders: data.emailHeaders,
          attachments: data.attachments,
        },
      };

      const jobId: string = `incoming-email-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.ProbeIngest,
        jobId,
        "ProcessProbeIngest",
        jobData as unknown as JSONObject,
      );

      logger.debug(`Added incoming email ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding incoming email ingestion job:`);
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
