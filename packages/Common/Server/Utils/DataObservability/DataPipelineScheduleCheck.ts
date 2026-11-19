import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import { DataPipelineMetricName } from "../../../Types/DataObservability/DataPipelineMetric";
import {
  DataPipelineLateness,
  DataPipelineTimeliness,
  getDataPipelineLateness,
  getDurationRatio,
  MAX_LATENESS_WATCH_IN_SECONDS,
  MAX_RUNNING_WATCH_IN_SECONDS,
} from "../../../Types/DataObservability/DataPipelineSchedule";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataPipelineService from "../../Services/DataPipelineService";
import logger from "../Logger";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
import ServerProducts from "../ServerProducts/ServerProducts";
import OpenLineageIngest, {
  buildPipelineMetricRow,
  isRunningState,
} from "./OpenLineageIngest";

/*
 * EVERY PIPELINE'S SCHEDULE, CHECKED EVERY FIVE MINUTES.
 *
 * A run that never comes sends no event, so no event can say a pipeline is
 * late. Every five minutes, each pipeline whose schedule is known writes how
 * late its next run is - 0 while it is on time - and each run still going
 * writes how its time so far compares with the typical run. So "Pipeline Is
 * Late" fires when the pipeline's page says Late, and "Pipeline Run
 * Unusually Long" fires on a run that hangs, before it ever ends.
 *
 * And each pipeline whose circuit breaker was asked writes the answer it
 * keeps (#9683): 1 while a stop is kept, 0 once it is not. The circuit
 * breaker writes its answer as it gives it, but a pipeline stopped at
 * midnight asks again only at its next run, so "Pipeline Stopped by
 * Circuit Breaker" stays open while the pipeline's page says it is
 * stopped, and clears once it does not. Not while Data Observability is
 * switched off on the server: the circuit breaker answers go then and
 * keeps nothing, so a stop it kept before is not the pipeline's answer.
 */

const PIPELINES_PER_PAGE: number = 1000;

export interface PipelineScheduleValue {
  metricName: DataPipelineMetricName;
  value: number;
}

// What one pipeline writes now: its lateness, and its running run's ratio.
export function getPipelineScheduleValues(data: {
  pipeline: DataPipeline;
  now: Date;
}): Array<PipelineScheduleValue> {
  const { pipeline, now } = data;
  const values: Array<PipelineScheduleValue> = [];
  const lateness: DataPipelineLateness = getDataPipelineLateness({
    lastRunStartedAt: pipeline.lastRunStartedAt,
    expectedRunIntervalInSeconds: pipeline.expectedRunIntervalInSeconds,
    now,
  });

  if (lateness.timeliness !== DataPipelineTimeliness.Unknown) {
    values.push({
      metricName: DataPipelineMetricName.OverdueSeconds,
      value: lateness.overdueBySeconds,
    });
  }

  if (isRunningState(pipeline.lastRunState) && pipeline.lastRunStartedAt) {
    const elapsedInSeconds: number = Math.floor(
      (now.getTime() - new Date(pipeline.lastRunStartedAt).getTime()) / 1000,
    );
    const ratio: number | null =
      elapsedInSeconds >= 0 && elapsedInSeconds <= MAX_RUNNING_WATCH_IN_SECONDS
        ? getDurationRatio({
            durationInSeconds: elapsedInSeconds,
            typicalDurationInSeconds: pipeline.typicalRunDurationInSeconds,
          })
        : null;

    if (ratio !== null) {
      values.push({
        metricName: DataPipelineMetricName.RunDurationRatio,
        value: ratio,
      });
    }
  }

  return values;
}

/*
 * What a pipeline's circuit breaker keeps, as its metric (#9683): 1 while a
 * stop is kept, 0 once the circuit breaker said go or a run started, for a
 * pipeline whose circuit breaker was asked in the last thirty days. Nothing
 * for one never asked, or not asked for thirty days: retired, as a stop
 * that old is retired from Needs Attention.
 */
export function getCircuitBreakerValue(data: {
  pipeline: DataPipeline;
  now: Date;
}): PipelineScheduleValue | null {
  const { pipeline, now } = data;
  const watchedSince: number =
    now.getTime() - MAX_LATENESS_WATCH_IN_SECONDS * 1000;
  const checkedAt: Date | null = pipeline.circuitBreakerCheckedAt
    ? OneUptimeDate.fromString(pipeline.circuitBreakerCheckedAt)
    : null;

  if (
    !checkedAt ||
    !Number.isFinite(checkedAt.getTime()) ||
    checkedAt.getTime() < watchedSince
  ) {
    return null;
  }

  const stoppedAt: Date | null = pipeline.circuitBreakerStoppedAt
    ? OneUptimeDate.fromString(pipeline.circuitBreakerStoppedAt)
    : null;
  const isStopped: boolean = Boolean(
    stoppedAt &&
      Number.isFinite(stoppedAt.getTime()) &&
      stoppedAt.getTime() >= watchedSince,
  );

  return {
    metricName: DataPipelineMetricName.CircuitBreakerStopped,
    value: isStopped ? 1 : 0,
  };
}

// Which pipelines a pass reads, what it writes for each, and what it is called in the log.
interface SchedulePass {
  query: Query<DataPipeline>;
  valuesOf: (data: {
    pipeline: DataPipeline;
    now: Date;
  }) => Array<PipelineScheduleValue>;
  what: string;
}

export default class DataPipelineScheduleCheck {
  // Returns how many metric rows were written.
  public static async checkAll(now: Date): Promise<number> {
    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    /*
     * A pipeline not started in thirty days is retired: nothing to check.
     * So is a circuit breaker not asked in thirty days.
     */
    const watchedSince: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -MAX_LATENESS_WATCH_IN_SECONDS,
    );
    const passes: Array<SchedulePass> = [
      {
        query: {
          lastRunStartedAt: QueryHelper.greaterThanEqualTo(watchedSince),
        },
        valuesOf: getPipelineScheduleValues,
        what: "pipeline schedule metrics",
      },
    ];

    if (
      !(await ServerProducts.getOffReasonOfServerWork(
        ProductKey.DataObservability,
      ))
    ) {
      passes.push({
        query: {
          circuitBreakerCheckedAt: QueryHelper.greaterThanEqualTo(watchedSince),
        },
        valuesOf: (data: {
          pipeline: DataPipeline;
          now: Date;
        }): Array<PipelineScheduleValue> => {
          const value: PipelineScheduleValue | null =
            getCircuitBreakerValue(data);

          return value ? [value] : [];
        },
        what: "pipeline circuit breaker metrics",
      });
    }

    let written: number = 0;

    for (const pass of passes) {
      written += await this.writePass({ pass, now, retentionDays });
    }

    return written;
  }

  // One pass over the pipelines it reads, a page at a time; returns the rows written.
  private static async writePass(data: {
    pass: SchedulePass;
    now: Date;
    retentionDays: number;
  }): Promise<number> {
    const { pass, now, retentionDays } = data;
    let written: number = 0;
    let skip: number = 0;

    while (true) {
      const pipelines: Array<DataPipeline> = await DataPipelineService.findBy({
        query: pass.query,
        select: {
          _id: true,
          projectId: true,
          jobName: true,
          jobNamespace: true,
          lastRunState: true,
          lastRunStartedAt: true,
          typicalRunDurationInSeconds: true,
          expectedRunIntervalInSeconds: true,
          circuitBreakerCheckedAt: true,
          circuitBreakerStoppedAt: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: PIPELINES_PER_PAGE,
        skip,
        props: { isRoot: true },
      });
      const byProject: Map<
        string,
        { projectId: ObjectID; rows: Array<JSONObject> }
      > = new Map();

      for (const pipeline of pipelines) {
        if (!pipeline.id || !pipeline.projectId) {
          continue;
        }

        for (const value of pass.valuesOf({ pipeline, now })) {
          const projectKey: string = pipeline.projectId.toString();
          const project: { projectId: ObjectID; rows: Array<JSONObject> } =
            byProject.get(projectKey) || {
              projectId: pipeline.projectId,
              rows: [],
            };

          project.rows.push(
            buildPipelineMetricRow({
              projectId: pipeline.projectId,
              pipeline,
              metricName: value.metricName,
              value: value.value,
              at: now,
              retentionDays,
            }),
          );
          byProject.set(projectKey, project);
        }
      }

      for (const project of byProject.values()) {
        try {
          await OpenLineageIngest.writeMetricRows(
            project.projectId,
            project.rows,
          );
          written += project.rows.length;
        } catch (error) {
          logger.error(
            `Data Observability: could not write the ${pass.what} of project ${project.projectId.toString()}`,
          );
          logger.error(error);
        }
      }

      if (pipelines.length < PIPELINES_PER_PAGE) {
        break;
      }

      skip += pipelines.length;
    }

    return written;
  }
}
