import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";

export enum TelemetryType {
  Logs = "logs",
  Traces = "traces",
  Metrics = "metrics",
}

export interface TelemetryIngestJobData {
  type: TelemetryType;
  projectId: ObjectID;
  requestBody: JSONObject;
  requestHeaders: Record<string, string>;
  ingestionTimestamp: Date;
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

export default class TelemetryQueueService {
  public static async addTelemetryIngestJob(
    req: TelemetryRequest,
    type: TelemetryType,
  ): Promise<void> {
    try {
      const jobData: TelemetryIngestJobData = {
        type,
        projectId: req.projectId,
        requestBody: req.body,
        requestHeaders: req.headers as Record<string, string>,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobId = `${type}-${req.projectId?.toString()}-${OneUptimeDate.getCurrentDateAsUnixNano()}`;

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
}
