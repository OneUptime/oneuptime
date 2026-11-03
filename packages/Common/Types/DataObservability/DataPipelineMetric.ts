/*
 * THE METRICS A PIPELINE RUN WRITES WHEN IT ENDS.
 *
 * Every OpenLineage run that ends - completes, fails or is aborted - writes
 * one row of each, tagged with its pipeline, so a Metrics monitor grouped by
 * pipeline alerts once per pipeline: a run that failed, or one that took
 * far longer than that pipeline usually does.
 */
export enum DataPipelineMetricName {
  // 1 for a run that failed or was aborted, 0 for one that completed.
  RunFailed = "oneuptime.data.pipeline.run_failed",
  // How long the run took, in seconds.
  RunDuration = "oneuptime.data.pipeline.run_duration",
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
  ];
