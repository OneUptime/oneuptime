export interface OtelQueueConfig {
  /**
   * Number of concurrent workers for each telemetry type
   */
  concurrency: {
    traces: number;
    metrics: number;
    logs: number;
  };
}

export const DEFAULT_OTEL_QUEUE_CONFIG: OtelQueueConfig = {
  concurrency: {
    traces: 10,
    metrics: 10,
    logs: 10,
  },
};
