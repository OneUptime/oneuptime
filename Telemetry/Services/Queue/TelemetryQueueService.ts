import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";
import Dictionary from "Common/Types/Dictionary";

export enum TelemetryType {
  Logs = "logs",
  Traces = "traces",
  Metrics = "metrics",
  Profiles = "profiles",
  Syslog = "syslog",
  FluentLogs = "fluentlogs",
  ProbeIngest = "probe-ingest",
  ServerMonitorIngest = "server-monitor-ingest",
  IncomingRequestIngest = "incoming-request-ingest",
}

export type ProbeIngestJobType =
  | "probe-response"
  | "monitor-test"
  | "incoming-email";

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

export interface ProbeIngestJobData {
  jobType: ProbeIngestJobType;
  ingestionTimestamp: Date;
  // For probe-response and monitor-test
  probeMonitorResponse?: JSONObject | undefined;
  testId?: string | undefined;
  // For incoming-email
  incomingEmail?: IncomingEmailJobData | undefined;
}

export interface ServerMonitorIngestJobData {
  secretKey: string;
  serverMonitorResponse: JSONObject;
  ingestionTimestamp: Date;
}

export interface IncomingRequestIngestJobData {
  secretKey: string;
  requestHeaders: Dictionary<string>;
  requestBody: string | JSONObject;
  requestMethod: string;
  ingestionTimestamp: Date;
}

export interface TelemetryIngestJobData {
  type: TelemetryType;
  projectId?: string;
  requestBody?: JSONObject;
  requestHeaders?: Record<string, string>;
  ingestionTimestamp: Date;
  // ProbeIngest-specific
  probeIngest?: ProbeIngestJobData;
  // ServerMonitorIngest-specific
  serverMonitorIngest?: ServerMonitorIngestJobData;
  // IncomingRequestIngest-specific
  incomingRequestIngest?: IncomingRequestIngestJobData;
}

// Legacy interfaces for backward compatibility
export interface LogsIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Logs;
}

export interface TracesIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Traces;
}

export interface MetricsIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Metrics;
}

export interface ProfilesIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Profiles;
}

export interface SyslogIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Syslog;
}

export default class TelemetryQueueService {
  public static async addTelemetryIngestJob(
    req: TelemetryRequest,
    type: TelemetryType,
  ): Promise<void> {
    try {
      const jobData: TelemetryIngestJobData = {
        type,
        projectId: req.projectId.toString(),
        requestBody: req.body,
        requestHeaders: req.headers as Record<string, string>,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobId: string = `${type}-${req.projectId?.toString()}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
      );

      logger.debug(`Added ${type} ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding ${type} ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async addLogIngestJob(req: TelemetryRequest): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.Logs);
  }

  public static async addTraceIngestJob(req: TelemetryRequest): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.Traces);
  }

  public static async addMetricIngestJob(req: TelemetryRequest): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.Metrics);
  }

  public static async addProfileIngestJob(
    req: TelemetryRequest,
  ): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.Profiles);
  }

  public static async addFluentLogIngestJob(
    req: TelemetryRequest,
  ): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.FluentLogs);
  }

  public static async addProbeIngestJob(data: {
    probeMonitorResponse: JSONObject;
    jobType: "probe-response" | "monitor-test";
    testId?: string;
  }): Promise<void> {
    try {
      const probeData: ProbeIngestJobData = {
        probeMonitorResponse: data.probeMonitorResponse,
        jobType: data.jobType,
        testId: data.testId,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.ProbeIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        probeIngest: probeData,
      };

      const jobId: string = `probe-${data.jobType}-${data.testId || "general"}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
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
      const probeData: ProbeIngestJobData = {
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

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.ProbeIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        probeIngest: probeData,
      };

      const jobId: string = `incoming-email-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
      );

      logger.debug(`Added incoming email ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding incoming email ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async addServerMonitorIngestJob(data: {
    secretKey: string;
    serverMonitorResponse: JSONObject;
  }): Promise<void> {
    try {
      const serverMonitorData: ServerMonitorIngestJobData = {
        secretKey: data.secretKey,
        serverMonitorResponse: data.serverMonitorResponse,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.ServerMonitorIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        serverMonitorIngest: serverMonitorData,
      };

      const jobId: string = `server-monitor-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
      );

      logger.debug(`Added server monitor ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding server monitor ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async addIncomingRequestIngestJob(data: {
    secretKey: string;
    requestHeaders: Dictionary<string>;
    requestBody: string | JSONObject;
    requestMethod: string;
  }): Promise<void> {
    try {
      const incomingRequestData: IncomingRequestIngestJobData = {
        secretKey: data.secretKey,
        requestHeaders: data.requestHeaders,
        requestBody: data.requestBody,
        requestMethod: data.requestMethod,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.IncomingRequestIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        incomingRequestIngest: incomingRequestData,
      };

      const jobId: string = `incoming-request-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
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
    return Queue.getQueueSize(QueueName.Telemetry);
  }

  public static async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  }> {
    return Queue.getQueueStats(QueueName.Telemetry);
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
    return Queue.getFailedJobs(QueueName.Telemetry, options);
  }
}
