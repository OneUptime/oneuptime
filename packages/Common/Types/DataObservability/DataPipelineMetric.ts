/*
 * THE METRICS A PIPELINE WRITES.
 *
 * Every OpenLineage run that ends - completes, fails or is aborted - writes
 * whether it failed, how long it took, and how that compares with the
 * pipeline's typical run. Every five minutes, a pipeline whose schedule is
 * known writes how late its next run is, and a run still going writes how
 * its time so far compares (DataPipelineSchedule). Each row is tagged with
 * its pipeline, so a monitor scoped by the pipeline watches it alone.
 */
export enum DataPipelineMetricName {
  // 1 for a run that failed or was aborted, 0 for one that completed.
  RunFailed = "oneuptime.data.pipeline.run_failed",
  // How long the run took, in seconds.
  RunDuration = "oneuptime.data.pipeline.run_duration",
  // The run's duration over the pipeline's typical one: 2 is twice as long.
  RunDurationRatio = "oneuptime.data.pipeline.run_duration_ratio",
  // How long past its schedule the pipeline's next run is, in seconds; 0 while on time.
  OverdueSeconds = "oneuptime.data.pipeline.overdue_seconds",
}

export const DataPipelineAttribute: {
  readonly PipelineId: string;
  readonly PipelineName: string;
  readonly PipelineNamespace: string;
} = {
  PipelineId: "oneuptime.data.pipeline.id",
  PipelineName: "oneuptime.data.pipeline.name",
  PipelineNamespace: "oneuptime.data.pipeline.namespace",
};

export interface DataPipelineMetricDefinition {
  name: DataPipelineMetricName;
  description: string;
  unit: string;
}

export const DATA_PIPELINE_METRICS: ReadonlyArray<DataPipelineMetricDefinition> =
  [
    {
      name: DataPipelineMetricName.RunFailed,
      description:
        "1 for a pipeline run that failed or was aborted, 0 for one that completed.",
      unit: "",
    },
    {
      name: DataPipelineMetricName.RunDuration,
      description: "How long a pipeline run took, in seconds.",
      unit: "s",
    },
    {
      name: DataPipelineMetricName.RunDurationRatio,
      description:
        "How long a pipeline run took, or has taken so far, over its typical run: the median of its last 20 completed runs, counted as at least a minute.",
      unit: "",
    },
    {
      name: DataPipelineMetricName.OverdueSeconds,
      description:
        "How long past its schedule a pipeline's next run is, in seconds: 0 while it is on time.",
      unit: "s",
    },
  ];
