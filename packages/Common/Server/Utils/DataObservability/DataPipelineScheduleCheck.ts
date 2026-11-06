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
import QueryHelper from "../../Types/Database/QueryHelper";
import DataPipelineService from "../../Services/DataPipelineService";
import logger from "../Logger";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
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

export default class DataPipelineScheduleCheck {
  // Returns how many metric rows were written.
  public static async checkAll(now: Date): Promise<number> {
    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    // A pipeline not started in thirty days is retired: nothing to check.
    const startedSince: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -MAX_LATENESS_WATCH_IN_SECONDS,
    );
    let written: number = 0;
    let skip: number = 0;

    while (true) {
      const pipelines: Array<DataPipeline> = await DataPipelineService.findBy({
        query: {
          lastRunStartedAt: QueryHelper.greaterThanEqualTo(startedSince),
        },
        select: {
          _id: true,
          projectId: true,
          jobName: true,
          jobNamespace: true,
          lastRunState: true,
          lastRunStartedAt: true,
          typicalRunDurationInSeconds: true,
          expectedRunIntervalInSeconds: true,
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

        for (const value of getPipelineScheduleValues({ pipeline, now })) {
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
            `Data Observability: could not write the pipeline schedule metrics of project ${project.projectId.toString()}`,
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
