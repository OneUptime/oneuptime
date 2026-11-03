import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataPipelineRun from "../../../Models/DatabaseModels/DataPipelineRun";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import {
  DATA_PIPELINE_METRICS,
  DataPipelineAttribute,
  DataPipelineMetricName,
} from "../../../Types/DataObservability/DataPipelineMetric";
import {
  getDurationRatio,
  getExpectedIntervalInSeconds,
  getTypicalDurationInSeconds,
  RUNS_FOR_EXPECTED_INTERVAL,
  RUNS_FOR_TYPICAL_DURATION,
} from "../../../Types/DataObservability/DataPipelineSchedule";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetLineageSource from "../../../Types/DataObservability/DataAssetLineageSource";
import DataAssetService from "../../Services/DataAssetService";
import DataPipelineRunService from "../../Services/DataPipelineRunService";
import DataPipelineService from "../../Services/DataPipelineService";
import DataStoreService from "../../Services/DataStoreService";
import MetricService from "../../Services/MetricService";
import logger from "../Logger";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
import TelemetryUtil from "../Telemetry/Telemetry";
import { matchDataset } from "./DatasetMatching";
import {
  FAILED_RUN_STATES,
  FINAL_RUN_STATES,
  OpenLineageDataset,
  OpenLineageRunEvent,
  OpenLineageRunState,
} from "./OpenLineageEvent";
import { readTableHealthTarget, TableHealthTarget } from "./TableHealthTarget";
import { UsageAsset, UsageStore } from "./TableUsageMatching";
import { DATA_OBSERVABILITY_KINDS } from "./DataObservabilityEngines";

/*
 * WHAT OPENLINEAGE EVENTS SAY, KEPT.
 *
 * Each event updates its pipeline (created at its first event) and its run:
 * a START opens the run, a COMPLETE, FAIL or ABORT ends it - its duration,
 * its error, and the metrics alerts read (run_failed, run_duration, and
 * run_duration_ratio against the pipeline's typical run). A run its tool
 * rescheduled ends too, as neither: it fails nothing and teaches no
 * duration. Each new run relearns how often the pipeline runs, and each
 * completed one how long it usually takes (DataPipelineSchedule).
 * The datasets a run reads and writes are matched to the tables Data
 * Observability watches (DatasetMatching): each table written is noted on
 * the run, and each table read by a run that writes another is an edge of
 * lineage between them.
 */

// The most dataset names kept on a pipeline or a run.
export const MAX_DATASETS_KEPT: number = 50;

const MAX_ASSETS_PER_PROJECT: number = 50_000;
const MAX_ERROR_LENGTH: number = 2000;

export function getPipelineKey(event: OpenLineageRunEvent): string {
  return `${event.jobNamespace}/${event.jobName}`;
}

export function datasetLabel(dataset: OpenLineageDataset): string {
  return `${dataset.namespace}/${dataset.name}`;
}

// The labels a pipeline or run keeps: what it had, then what is new, bounded.
export function mergeDatasetLabels(
  existing: Array<string> | undefined | null,
  datasets: Array<OpenLineageDataset>,
): Array<string> {
  const labels: Array<string> = [...(existing || [])];

  for (const dataset of datasets) {
    const label: string = datasetLabel(dataset);

    if (labels.length >= MAX_DATASETS_KEPT) {
      break;
    }

    if (!labels.includes(label)) {
      labels.push(label);
    }
  }

  return labels;
}

export function isFinalState(state: string | undefined | null): boolean {
  return FINAL_RUN_STATES.includes(state as OpenLineageRunState);
}

export function isFailedState(state: string | undefined | null): boolean {
  return FAILED_RUN_STATES.includes(state as OpenLineageRunState);
}

// How precisely a pipeline's edge keeps its last sighting: a busy pipeline writes it hourly.
export const PIPELINE_EDGE_SEEN_PRECISION_IN_SECONDS: number = 60 * 60;

export function getPipelineEdgeKey(data: {
  upstreamDataAssetId: string | null;
  downstreamDataAssetId: string;
  pipelineId: ObjectID;
}): string {
  return `${data.upstreamDataAssetId || "writes"}:${data.downstreamDataAssetId}:${data.pipelineId.toString()}`;
}

export function isRunningState(state: string | undefined | null): boolean {
  return (
    state === OpenLineageRunState.Start || state === OpenLineageRunState.Running
  );
}

export function buildPipelineMetricRow(data: {
  projectId: ObjectID;
  pipeline: DataPipeline;
  metricName: DataPipelineMetricName;
  value: number;
  at: Date;
  retentionDays: number;
}): JSONObject {
  const time: string = OneUptimeDate.toClickhouseDateTime(data.at);
  const attributes: JSONObject = {
    [DataPipelineAttribute.PipelineId]: data.pipeline.id!.toString(),
    [DataPipelineAttribute.PipelineName]: data.pipeline.jobName || "",
    [DataPipelineAttribute.PipelineNamespace]: data.pipeline.jobNamespace || "",
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: time,
    projectId: data.projectId.toString(),
    primaryEntityId: data.pipeline.id!.toString(),
    primaryEntityType: ServiceType.DataPipeline,
    name: data.metricName,
    aggregationTemporality: null,
    metricPointType: MetricPointType.Gauge,
    time: time,
    startTime: null,
    timeUnixNano: OneUptimeDate.toUnixNano(data.at).toString(),
    startTimeUnixNano: null,
    attributes: attributes,
    attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
    isMonotonic: null,
    count: null,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    value: data.value,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(data.at, data.retentionDays),
    ),
  } as JSONObject;
}

// The stores and tables of a project, read once per request and matched against.
export interface ProjectCatalog {
  stores: Array<UsageStore>;
  assets: Array<UsageAsset>;
  // Each store's name, by its id.
  storeNames: Map<string, string>;
}

export default class OpenLineageIngest {
  public static async ingest(data: {
    projectId: ObjectID;
    events: Array<OpenLineageRunEvent>;
    now: Date;
    // The project's catalog, when the caller has read it already.
    catalog?: ProjectCatalog | undefined;
  }): Promise<number> {
    if (data.events.length === 0) {
      return 0;
    }

    const catalog: ProjectCatalog =
      data.catalog || (await this.readCatalog(data.projectId));
    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    const metricRows: Array<JSONObject> = [];
    // In the order they happened: a START before its COMPLETE.
    const events: Array<OpenLineageRunEvent> = [...data.events].sort(
      (a: OpenLineageRunEvent, b: OpenLineageRunEvent) => {
        return a.eventTime.getTime() - b.eventTime.getTime();
      },
    );
    let recorded: number = 0;

    for (const event of events) {
      try {
        await this.recordEvent({
          projectId: data.projectId,
          event,
          catalog,
          metricRows,
          retentionDays,
        });
        recorded++;
      } catch (error) {
        logger.error(
          `Data Observability: could not record an OpenLineage event of project ${data.projectId.toString()}`,
        );
        logger.error(error);
      }
    }

    await this.writeMetricRows(data.projectId, metricRows);

    return recorded;
  }

  private static async recordEvent(data: {
    projectId: ObjectID;
    event: OpenLineageRunEvent;
    catalog: ProjectCatalog;
    metricRows: Array<JSONObject>;
    retentionDays: number;
  }): Promise<void> {
    const { projectId, event } = data;
    const pipeline: DataPipeline = await this.upsertPipeline(projectId, event);

    const inputAssets: Array<UsageAsset> = this.matchDatasets(
      event.inputs,
      data.catalog,
    );
    const outputAssets: Array<UsageAsset> = this.matchDatasets(
      event.outputs,
      data.catalog,
    );

    // Tables its producer named by id (a Fivetran connector's schema).
    if (event.outputDataAssetIds && event.outputDataAssetIds.length > 0) {
      const named: Set<string> = new Set(event.outputDataAssetIds);
      const matched: Set<string> = new Set(
        outputAssets.map((asset: UsageAsset): string => {
          return asset.dataAssetId;
        }),
      );

      for (const asset of data.catalog.assets) {
        if (named.has(asset.dataAssetId) && !matched.has(asset.dataAssetId)) {
          outputAssets.push(asset);
        }
      }
    }

    if (event.runId) {
      await this.recordRun({
        projectId,
        pipeline,
        event,
        outputAssets,
        metricRows: data.metricRows,
        retentionDays: data.retentionDays,
      });
    }

    const edges: Array<{
      upstreamDataAssetId: string | null;
      downstreamDataAssetId: string;
    }> = [];

    for (const output of outputAssets) {
      // Every table a pipeline writes knows the pipeline, whatever it reads.
      edges.push({
        upstreamDataAssetId: null,
        downstreamDataAssetId: output.dataAssetId,
      });

      for (const input of inputAssets) {
        if (input.dataAssetId !== output.dataAssetId) {
          edges.push({
            upstreamDataAssetId: input.dataAssetId,
            downstreamDataAssetId: output.dataAssetId,
          });
        }
      }
    }

    await this.upsertLineageEdges({
      projectId,
      pipelineId: pipeline.id!,
      edges,
      at: event.eventTime,
    });
  }

  public static async upsertPipeline(
    projectId: ObjectID,
    event: OpenLineageRunEvent,
  ): Promise<DataPipeline> {
    const pipelineKey: string = getPipelineKey(event);
    const existing: DataPipeline | null = await DataPipelineService.findOneBy({
      query: { projectId, pipelineKey },
      select: {
        _id: true,
        jobName: true,
        jobNamespace: true,
        inputs: true,
        outputs: true,
        runCount: true,
        lastRunId: true,
        lastRunStartedAt: true,
        typicalRunDurationInSeconds: true,
        expectedRunIntervalInSeconds: true,
      },
      props: { isRoot: true },
    });

    if (existing?.id) {
      const inputs: Array<string> = mergeDatasetLabels(
        existing.inputs,
        event.inputs,
      );
      const outputs: Array<string> = mergeDatasetLabels(
        existing.outputs,
        event.outputs,
      );

      await DataPipelineService.updateColumnsByIdWithoutHooks({
        id: existing.id,
        data: { inputs, outputs } as never,
      });

      existing.inputs = inputs;
      existing.outputs = outputs;
      return existing;
    }

    const pipeline: DataPipeline = new DataPipeline();
    pipeline.projectId = projectId;
    pipeline.jobNamespace = event.jobNamespace;
    pipeline.jobName = event.jobName;
    pipeline.pipelineKey = pipelineKey;
    pipeline.inputs = mergeDatasetLabels([], event.inputs);
    pipeline.outputs = mergeDatasetLabels([], event.outputs);
    pipeline.runCount = 0;
    pipeline.firstSeenAt = event.eventTime;

    return await DataPipelineService.create({
      data: pipeline,
      props: { isRoot: true },
    });
  }

  private static async recordRun(data: {
    projectId: ObjectID;
    pipeline: DataPipeline;
    event: OpenLineageRunEvent;
    outputAssets: Array<UsageAsset>;
    metricRows: Array<JSONObject>;
    retentionDays: number;
  }): Promise<void> {
    const { event, pipeline } = data;
    const runId: string = event.runId!;
    const isFinal: boolean = isFinalState(event.eventType);
    const run: DataPipelineRun | null = await DataPipelineRunService.findOneBy({
      query: { dataPipelineId: pipeline.id!, runId },
      select: {
        _id: true,
        state: true,
        startedAt: true,
        scheduledAt: true,
        endedAt: true,
        inputs: true,
        outputs: true,
        outputDataAssetIds: true,
      },
      props: { isRoot: true },
    });
    const outputIds: Array<string> = Array.from(
      new Set([
        ...((run?.outputDataAssetIds as Array<string>) || []),
        ...data.outputAssets.map((asset: UsageAsset): string => {
          return asset.dataAssetId;
        }),
      ]),
    ).slice(0, MAX_DATASETS_KEPT);
    const wasFinal: boolean = isFinalState(run?.state);
    // A late RUNNING never reopens a run that ended.
    const state: string = wasFinal && !isFinal ? run!.state! : event.eventType;
    const startedAt: Date =
      run?.startedAt && run.startedAt < event.eventTime
        ? run.startedAt
        : event.eventTime;
    const endedAt: Date | null = isFinal
      ? event.eventTime
      : run?.endedAt || null;
    const durationInSeconds: number | null = endedAt
      ? Math.max(
          0,
          Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
        )
      : null;
    // A failed run's error, or why its tool rescheduled it.
    const errorMessage: string | null =
      isFailedState(event.eventType) ||
      event.eventType === OpenLineageRunState.Rescheduled
        ? (event.errorMessage || "").slice(0, MAX_ERROR_LENGTH) || null
        : null;

    if (run?.id) {
      await DataPipelineRunService.updateColumnsByIdWithoutHooks({
        id: run.id,
        data: {
          state,
          startedAt,
          endedAt,
          durationInSeconds,
          ...(errorMessage ? { errorMessage } : {}),
          ...(event.scheduledAt && !run.scheduledAt
            ? { scheduledAt: event.scheduledAt }
            : {}),
          inputs: mergeDatasetLabels(run.inputs, event.inputs),
          outputs: mergeDatasetLabels(run.outputs, event.outputs),
          outputDataAssetIds: outputIds,
        } as never,
      });
    } else {
      const created: DataPipelineRun = new DataPipelineRun();
      created.projectId = data.projectId;
      created.dataPipelineId = pipeline.id!;
      created.runId = runId;
      created.state = state;
      created.startedAt = startedAt;
      if (event.scheduledAt) {
        created.scheduledAt = event.scheduledAt;
      }

      created.inputs = mergeDatasetLabels([], event.inputs);
      created.outputs = mergeDatasetLabels([], event.outputs);
      created.outputDataAssetIds = outputIds;

      if (endedAt) {
        created.endedAt = endedAt;
      }

      if (durationInSeconds !== null) {
        created.durationInSeconds = durationInSeconds;
      }

      if (errorMessage) {
        created.errorMessage = errorMessage;
      }

      await DataPipelineRunService.create({
        data: created,
        props: { isRoot: true },
      });
    }

    // The pipeline shows its latest run: this one, unless a newer one started.
    const isLatest: boolean =
      !pipeline.lastRunStartedAt ||
      pipeline.lastRunId === runId ||
      startedAt >= pipeline.lastRunStartedAt;
    const endsNow: boolean = isFinal && !wasFinal;
    // A new run is a new start to learn the schedule from.
    const expectedRunIntervalInSeconds: number | null = run?.id
      ? null
      : await this.learnExpectedInterval(pipeline.id!);
    // A completed run is a new duration to learn the typical one from.
    const typicalRunDurationInSeconds: number | null =
      endsNow && event.eventType === OpenLineageRunState.Complete
        ? await this.learnTypicalDuration(pipeline.id!)
        : null;

    await DataPipelineService.updateColumnsByIdWithoutHooks({
      id: pipeline.id!,
      data: {
        ...(run?.id ? {} : { runCount: (pipeline.runCount || 0) + 1 }),
        ...(expectedRunIntervalInSeconds !== null
          ? { expectedRunIntervalInSeconds }
          : {}),
        ...(typicalRunDurationInSeconds !== null
          ? { typicalRunDurationInSeconds }
          : {}),
        ...(isLatest
          ? {
              lastRunId: runId,
              lastRunState: state,
              lastRunStartedAt: startedAt,
              lastRunEndedAt: endedAt,
              lastRunDurationInSeconds: durationInSeconds,
            }
          : {}),
        ...(isFinal &&
        !wasFinal &&
        event.eventType === OpenLineageRunState.Complete
          ? { lastSuccessAt: event.eventTime }
          : {}),
        ...(isFinal && !wasFinal && isFailedState(event.eventType)
          ? {
              lastFailureAt: event.eventTime,
              lastErrorMessage: errorMessage,
            }
          : {}),
      } as never,
    });

    // The metrics are written once, as the run ends.
    if (endsNow) {
      data.metricRows.push(
        buildPipelineMetricRow({
          projectId: data.projectId,
          pipeline,
          metricName: DataPipelineMetricName.RunFailed,
          value: isFailedState(event.eventType) ? 1 : 0,
          at: event.eventTime,
          retentionDays: data.retentionDays,
        }),
      );

      // A rescheduled run stopped part way: its time says nothing of a run's.
      if (
        durationInSeconds !== null &&
        event.eventType !== OpenLineageRunState.Rescheduled
      ) {
        data.metricRows.push(
          buildPipelineMetricRow({
            projectId: data.projectId,
            pipeline,
            metricName: DataPipelineMetricName.RunDuration,
            value: durationInSeconds,
            at: event.eventTime,
            retentionDays: data.retentionDays,
          }),
        );

        // Against the typical run before this one: a slow run does not excuse itself.
        const ratio: number | null = getDurationRatio({
          durationInSeconds,
          typicalDurationInSeconds: pipeline.typicalRunDurationInSeconds,
        });

        if (ratio !== null) {
          data.metricRows.push(
            buildPipelineMetricRow({
              projectId: data.projectId,
              pipeline,
              metricName: DataPipelineMetricName.RunDurationRatio,
              value: ratio,
              at: event.eventTime,
              retentionDays: data.retentionDays,
            }),
          );
        }
      }
    }
  }

  private static async learnExpectedInterval(
    dataPipelineId: ObjectID,
  ): Promise<number | null> {
    const runs: Array<DataPipelineRun> = await DataPipelineRunService.findBy({
      query: { dataPipelineId },
      select: { startedAt: true, scheduledAt: true },
      sort: { startedAt: SortOrder.Descending },
      limit: RUNS_FOR_EXPECTED_INTERVAL,
      skip: 0,
      props: { isRoot: true },
    });

    return getExpectedIntervalInSeconds(
      runs
        .map((run: DataPipelineRun): Date | undefined => {
          return run.scheduledAt || run.startedAt;
        })
        .filter((start: Date | undefined): start is Date => {
          return Boolean(start);
        }),
    );
  }

  private static async learnTypicalDuration(
    dataPipelineId: ObjectID,
  ): Promise<number | null> {
    const runs: Array<DataPipelineRun> = await DataPipelineRunService.findBy({
      query: { dataPipelineId, state: OpenLineageRunState.Complete },
      select: { durationInSeconds: true },
      sort: { startedAt: SortOrder.Descending },
      limit: RUNS_FOR_TYPICAL_DURATION,
      skip: 0,
      props: { isRoot: true },
    });

    return getTypicalDurationInSeconds(
      runs
        .map((run: DataPipelineRun): number | undefined => {
          return run.durationInSeconds;
        })
        .filter((duration: number | undefined): duration is number => {
          return typeof duration === "number";
        }),
    );
  }

  public static async upsertLineage(data: {
    projectId: ObjectID;
    // Null for the pipeline-writes-table edge.
    upstreamDataAssetId: string | null;
    downstreamDataAssetId: string;
    pipelineId: ObjectID;
    at: Date;
  }): Promise<void> {
    await this.upsertLineageEdges({
      projectId: data.projectId,
      pipelineId: data.pipelineId,
      edges: [
        {
          upstreamDataAssetId: data.upstreamDataAssetId,
          downstreamDataAssetId: data.downstreamDataAssetId,
        },
      ],
      at: data.at,
    });
  }

  /*
   * A run's edges, read in one query: each one new is created, and each
   * one kept has its last sighting moved, at most hourly and never back -
   * a connector writing a whole schema does not write every edge on every
   * sync.
   */
  public static async upsertLineageEdges(data: {
    projectId: ObjectID;
    pipelineId: ObjectID;
    edges: Array<{
      // Null for the pipeline-writes-table edge.
      upstreamDataAssetId: string | null;
      downstreamDataAssetId: string;
    }>;
    at: Date;
  }): Promise<void> {
    const byKey: Map<
      string,
      { upstreamDataAssetId: string | null; downstreamDataAssetId: string }
    > = new Map();

    for (const edge of data.edges) {
      byKey.set(
        getPipelineEdgeKey({ ...edge, pipelineId: data.pipelineId }),
        edge,
      );
    }

    if (byKey.size === 0) {
      return;
    }

    const kept: Array<DataAssetLineage> =
      await DataAssetLineageService.findAllBy({
        query: {
          projectId: data.projectId,
          edgeKey: QueryHelper.any(Array.from(byKey.keys())),
        },
        select: { _id: true, edgeKey: true, lastSeenAt: true },
        props: { isRoot: true },
      });
    const keptByKey: Map<string, DataAssetLineage> = new Map();

    for (const edge of kept) {
      if (edge.edgeKey) {
        keptByKey.set(edge.edgeKey, edge);
      }
    }

    for (const [edgeKey, edge] of byKey) {
      const existing: DataAssetLineage | undefined = keptByKey.get(edgeKey);

      if (existing?.id) {
        const lastSeenAt: number = existing.lastSeenAt
          ? new Date(existing.lastSeenAt).getTime()
          : 0;

        if (
          data.at.getTime() - lastSeenAt >=
          PIPELINE_EDGE_SEEN_PRECISION_IN_SECONDS * 1000
        ) {
          await DataAssetLineageService.updateColumnsByIdWithoutHooks({
            id: existing.id,
            data: { lastSeenAt: data.at } as never,
          });
        }

        continue;
      }

      const created: DataAssetLineage = new DataAssetLineage();
      created.projectId = data.projectId;
      if (edge.upstreamDataAssetId) {
        created.upstreamDataAssetId = new ObjectID(edge.upstreamDataAssetId);
      }

      created.downstreamDataAssetId = new ObjectID(edge.downstreamDataAssetId);
      created.dataPipelineId = data.pipelineId;
      created.source = DataAssetLineageSource.Pipeline;
      created.edgeKey = edgeKey;
      created.firstSeenAt = data.at;
      created.lastSeenAt = data.at;

      try {
        await DataAssetLineageService.create({
          data: created,
          props: { isRoot: true },
        });
      } catch (error) {
        // Another event of the run kept it first (the key is unique).
        logger.debug(
          `Data Observability: lineage edge ${edgeKey} was not created: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private static matchDatasets(
    datasets: Array<OpenLineageDataset>,
    catalog: ProjectCatalog,
  ): Array<UsageAsset> {
    const matched: Map<string, UsageAsset> = new Map();

    for (const dataset of datasets) {
      const asset: UsageAsset | null = matchDataset({
        dataset,
        stores: catalog.stores,
        assets: catalog.assets,
      });

      if (asset) {
        matched.set(asset.dataAssetId, asset);
      }
    }

    return Array.from(matched.values());
  }

  public static async readCatalog(
    projectId: ObjectID,
  ): Promise<ProjectCatalog> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId,
        isArchived: false,
        kind: new Includes([...DATA_OBSERVABILITY_KINDS]),
      },
      select: { _id: true, name: true, kind: true, tableHealthTarget: true },
      limit: 1000,
      skip: 0,
      props: { isRoot: true },
    });
    const usageStores: Array<UsageStore> = [];
    const storeNames: Map<string, string> = new Map();

    for (const store of stores) {
      const target: TableHealthTarget | null = readTableHealthTarget(
        store.tableHealthTarget,
      );

      if (store.id && store.kind && target) {
        storeNames.set(store.id.toString(), store.name || "");
        usageStores.push({
          dataStoreId: store.id.toString(),
          kind: store.kind,
          databaseName: target.databaseName,
          serverAddress: target.host,
        });
      }
    }

    if (usageStores.length === 0) {
      return { stores: [], assets: [], storeNames };
    }

    const assets: Array<DataAsset> = await DataAssetService.findBy({
      query: { projectId, isDropped: false },
      select: { _id: true, dataStoreId: true, schemaName: true, name: true },
      limit: MAX_ASSETS_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    return {
      stores: usageStores,
      storeNames,
      assets: assets
        .filter((asset: DataAsset) => {
          return Boolean(asset.id && asset.dataStoreId && asset.name);
        })
        .map((asset: DataAsset): UsageAsset => {
          return {
            dataAssetId: asset.id!.toString(),
            dataStoreId: asset.dataStoreId!.toString(),
            schemaName: asset.schemaName || "",
            name: asset.name!,
          };
        }),
    };
  }

  public static async writeMetricRows(
    projectId: ObjectID,
    rows: Array<JSONObject>,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    for (let start: number = 0; start < rows.length; start += 5_000) {
      await MetricService.insertJsonRows(rows.slice(start, start + 5_000));
    }

    const metricTypes: Dictionary<MetricType> = {};

    for (const definition of DATA_PIPELINE_METRICS) {
      const metricType: MetricType = new MetricType();
      metricType.name = definition.name;
      metricType.description = definition.description;
      metricType.unit = definition.unit;
      metricTypes[definition.name] = metricType;
    }

    TelemetryUtil.indexMetricNameServiceNameMap({
      projectId,
      metricNameServiceNameMap: metricTypes,
    }).catch((error: Error) => {
      logger.error(error);
    });
  }
}
