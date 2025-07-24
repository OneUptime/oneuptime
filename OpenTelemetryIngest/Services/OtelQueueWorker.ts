import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import OtelIngestService from "./OtelIngest";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ObjectID from "Common/Types/ObjectID";
import { OtelQueueConfig, DEFAULT_OTEL_QUEUE_CONFIG } from "../Types/QueueConfig";

export interface OtelIngestJobData extends JSONObject {
  body: JSONObject;
  projectId: string;
  headers?: JSONObject;
}

export default class OtelQueueWorker {
  private static isInitialized: boolean = false;
  private static config: OtelQueueConfig = DEFAULT_OTEL_QUEUE_CONFIG;
  private static workers: any[] = [];

  public static async init(config?: Partial<OtelQueueConfig>): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Merge provided config with defaults
    if (config) {
      this.config = {
        concurrency: { ...DEFAULT_OTEL_QUEUE_CONFIG.concurrency, ...config.concurrency },
        enabled: { ...DEFAULT_OTEL_QUEUE_CONFIG.enabled, ...config.enabled },
      };
    }

    logger.info("Initializing OpenTelemetry Queue Workers...");
    logger.info(`Queue config: ${JSON.stringify(this.config)}`);

    // Initialize Traces Queue Worker
    if (this.config.enabled.traces) {
      const tracesWorker = QueueWorker.getWorker(
        QueueName.OtelIngestTraces,
        async (job: QueueJob) => {
          logger.debug(`Processing traces job: ${job.id}`);
          const data = job.data as OtelIngestJobData;
          await this.processTracesJob(data);
        },
        { concurrency: this.config.concurrency.traces }
      );
      this.workers.push(tracesWorker);
      logger.info(`Traces queue worker initialized with concurrency: ${this.config.concurrency.traces}`);
    }

    // Initialize Metrics Queue Worker
    if (this.config.enabled.metrics) {
      const metricsWorker = QueueWorker.getWorker(
        QueueName.OtelIngestMetrics,
        async (job: QueueJob) => {
          logger.debug(`Processing metrics job: ${job.id}`);
          const data = job.data as OtelIngestJobData;
          await this.processMetricsJob(data);
        },
        { concurrency: this.config.concurrency.metrics }
      );
      this.workers.push(metricsWorker);
      logger.info(`Metrics queue worker initialized with concurrency: ${this.config.concurrency.metrics}`);
    }

    // Initialize Logs Queue Worker
    if (this.config.enabled.logs) {
      const logsWorker = QueueWorker.getWorker(
        QueueName.OtelIngestLogs,
        async (job: QueueJob) => {
          logger.debug(`Processing logs job: ${job.id}`);
          const data = job.data as OtelIngestJobData;
          await this.processLogsJob(data);
        },
        { concurrency: this.config.concurrency.logs }
      );
      this.workers.push(logsWorker);
      logger.info(`Logs queue worker initialized with concurrency: ${this.config.concurrency.logs}`);
    }

    // Setup graceful shutdown
    this.setupGracefulShutdown();

    this.isInitialized = true;
    logger.info("OpenTelemetry Queue Workers initialized successfully");
  }

  public static isQueueEnabled(type: 'traces' | 'metrics' | 'logs'): boolean {
    return this.config.enabled[type];
  }

  public static async shutdown(): Promise<void> {
    logger.info("Shutting down OpenTelemetry Queue Workers...");
    
    for (const worker of this.workers) {
      try {
        await worker.close();
      } catch (error) {
        logger.error("Error closing worker:");
        logger.error(error);
      }
    }
    
    this.workers = [];
    this.isInitialized = false;
    logger.info("OpenTelemetry Queue Workers shut down successfully");
  }

  private static setupGracefulShutdown(): void {
    const shutdownHandler = async () => {
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);
  }

  public static async addTracesJob(data: OtelIngestJobData): Promise<void> {
    const jobId = `traces-${Date.now()}-${Math.random()}`;
    await Queue.addJob(
      QueueName.OtelIngestTraces,
      jobId,
      "process-traces",
      data
    );
    logger.debug(`Added traces job to queue: ${jobId}`);
  }

  public static async addMetricsJob(data: OtelIngestJobData): Promise<void> {
    const jobId = `metrics-${Date.now()}-${Math.random()}`;
    await Queue.addJob(
      QueueName.OtelIngestMetrics,
      jobId,
      "process-metrics",
      data
    );
    logger.debug(`Added metrics job to queue: ${jobId}`);
  }

  public static async addLogsJob(data: OtelIngestJobData): Promise<void> {
    const jobId = `logs-${Date.now()}-${Math.random()}`;
    await Queue.addJob(
      QueueName.OtelIngestLogs,
      jobId,
      "process-logs",
      data
    );
    logger.debug(`Added logs job to queue: ${jobId}`);
  }

  private static async processTracesJob(data: OtelIngestJobData): Promise<void> {
    try {
      // Create a mock request object with the data
      const mockReq = this.createMockRequest(data);
      await OtelIngestService.processTracesAsync(mockReq);
      logger.debug("Traces job processed successfully");
    } catch (error) {
      logger.error("Error processing traces job:");
      logger.error(error);
      throw error;
    }
  }

  private static async processMetricsJob(data: OtelIngestJobData): Promise<void> {
    try {
      // Create a mock request object with the data
      const mockReq = this.createMockRequest(data);
      await OtelIngestService.processMetricsAsync(mockReq);
      logger.debug("Metrics job processed successfully");
    } catch (error) {
      logger.error("Error processing metrics job:");
      logger.error(error);
      throw error;
    }
  }

  private static async processLogsJob(data: OtelIngestJobData): Promise<void> {
    try {
      // Create a mock request object with the data
      const mockReq = this.createMockRequest(data);
      await OtelIngestService.processLogsAsync(mockReq);
      logger.debug("Logs job processed successfully");
    } catch (error) {
      logger.error("Error processing logs job:");
      logger.error(error);
      throw error;
    }
  }

  private static createMockRequest(data: OtelIngestJobData): TelemetryRequest {
    return {
      body: data.body,
      projectId: new ObjectID(data.projectId),
      headers: data.headers || {},
    } as TelemetryRequest;
  }
}
