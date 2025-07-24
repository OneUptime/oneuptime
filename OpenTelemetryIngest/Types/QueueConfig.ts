export interface OtelQueueConfig {
  /**
   * Number of concurrent workers for each telemetry type
   */
  concurrency: {
    traces: number;
    metrics: number;
    logs: number;
  };
  
  /**
   * Enable/disable queue processing for each telemetry type
   * If disabled, falls back to synchronous processing
   */
  enabled: {
    traces: boolean;
    metrics: boolean;
    logs: boolean;
  };
}

export const DEFAULT_OTEL_QUEUE_CONFIG: OtelQueueConfig = {
  concurrency: {
    traces: 10,
    metrics: 10,
    logs: 10,
  },
  enabled: {
    traces: true,
    metrics: true,
    logs: true,
  },
};
