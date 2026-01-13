import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";
import Dictionary from "Common/Types/Dictionary";

export interface IncomingEmailIngestJobData {
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
  ingestionTimestamp: Date;
}

export default class IncomingEmailIngestQueueService {
  public static async addIncomingEmailIngestJob(data: {
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
      const jobData: IncomingEmailIngestJobData = {
        secretKey: data.secretKey,
        emailFrom: data.emailFrom,
        emailTo: data.emailTo,
        emailSubject: data.emailSubject,
        emailBody: data.emailBody,
        emailBodyHtml: data.emailBodyHtml,
        emailHeaders: data.emailHeaders,
        attachments: data.attachments,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobId: string = `incoming-email-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.IncomingEmailIngest,
        jobId,
        "ProcessIncomingEmailIngest",
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
    return Queue.getQueueSize(QueueName.IncomingEmailIngest);
  }

  public static async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  }> {
    return Queue.getQueueStats(QueueName.IncomingEmailIngest);
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
    return Queue.getFailedJobs(QueueName.IncomingEmailIngest, options);
  }
}
