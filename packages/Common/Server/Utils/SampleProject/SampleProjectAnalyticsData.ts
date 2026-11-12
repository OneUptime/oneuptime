import AnalyticsDatabaseService from "../../Services/AnalyticsDatabaseService";
import AuditLogService from "../../Services/AuditLogService";
import ChangeEventService from "../../Services/ChangeEventService";
import CloudCostService from "../../Services/CloudCostService";
import ExceptionInstanceService from "../../Services/ExceptionInstanceService";
import KubernetesCostAllocationService from "../../Services/KubernetesCostAllocationService";
import LogCountBaselineService from "../../Services/LogCountBaselineService";
import LogService from "../../Services/LogService";
import MetricBaselineService from "../../Services/MetricBaselineService";
import MetricItemAggMV1mByContainerService from "../../Services/MetricItemAggMV1mByContainerService";
import MetricItemAggMV1mByHostV2Service from "../../Services/MetricItemAggMV1mByHostV2Service";
import MetricItemAggMV1mByK8sClusterService from "../../Services/MetricItemAggMV1mByK8sClusterService";
import MetricItemAggMV1mByServiceService from "../../Services/MetricItemAggMV1mByServiceService";
import MetricItemAggMV1mService from "../../Services/MetricItemAggMV1mService";
import MetricService from "../../Services/MetricService";
import MonitorLogService from "../../Services/MonitorLogService";
import MutableMetricService from "../../Services/MutableMetricService";
import NetworkFlowService from "../../Services/NetworkFlowService";
import NetworkTrafficUsageService from "../../Services/NetworkTrafficUsageService";
import ProfileSampleService from "../../Services/ProfileSampleService";
import ProfileService from "../../Services/ProfileService";
import RumProductAnalyticsEventService from "../../Services/RumProductAnalyticsEventService";
import RumProductAnalyticsSessionService from "../../Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "../../Services/RumProductAnalyticsUserService";
import RumSessionChunkService from "../../Services/RumSessionChunkService";
import RumSessionService from "../../Services/RumSessionService";
import SecurityEventService from "../../Services/SecurityEventService";
import SloHistoryService from "../../Services/SloHistoryService";
import SpanCountBaselineService from "../../Services/SpanCountBaselineService";
import SpanService from "../../Services/SpanService";
import ThreatIntelIndicatorService from "../../Services/ThreatIntelIndicatorService";
import logger from "../Logger";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ObjectID from "../../../Types/ObjectID";

/*
 * A SAMPLE PROJECT LEAVES NOTHING IN THE ANALYTICS DATABASE (issue #6808).
 *
 * The sample is filled with logs, spans and metrics, and the materialized
 * views over them fill tables of their own - baselines kept 90 days, the
 * per-minute and per-service aggregates. Rows age out by their retention
 * anyway, but a deleted sample must leave nothing behind: when one is
 * deleted (ProjectService.onDeleteSuccess, whatever deleted it), every
 * table here is asked to delete the project's rows.
 *
 * Every analytics table is listed, not only the ones the seeder writes: a
 * member may have caused an audit log or a change event while looking
 * around. SampleProjectReadersGuard fails when a table is added to
 * Services/Index's AnalyticsServices and not here. (Imported one by one, not
 * from Services/Index: ProjectService reaches this file, and Index imports
 * ProjectService.)
 *
 * Each delete is a mutation (AnalyticsDatabaseService.deleteBy); they run
 * together, and one that fails is logged and leaves the others to finish -
 * the project is gone already, and what one table keeps ages out by its
 * retention.
 */
export const SAMPLE_PROJECT_ANALYTICS_SERVICES: ReadonlyArray<
  AnalyticsDatabaseService<AnalyticsBaseModel>
> = [
  LogService,
  SpanService,
  MetricService,
  MutableMetricService,
  SloHistoryService,
  MetricItemAggMV1mService,
  MetricItemAggMV1mByHostV2Service,
  MetricItemAggMV1mByServiceService,
  MetricItemAggMV1mByK8sClusterService,
  MetricItemAggMV1mByContainerService,
  MetricBaselineService,
  SpanCountBaselineService,
  LogCountBaselineService,
  ExceptionInstanceService,
  KubernetesCostAllocationService,
  CloudCostService,
  MonitorLogService,
  NetworkFlowService,
  NetworkTrafficUsageService,
  ProfileService,
  ProfileSampleService,
  RumSessionService,
  RumSessionChunkService,
  RumProductAnalyticsSessionService,
  RumProductAnalyticsUserService,
  RumProductAnalyticsEventService,
  AuditLogService,
  SecurityEventService,
  ThreatIntelIndicatorService,
  ChangeEventService,
] as ReadonlyArray<AnalyticsDatabaseService<AnalyticsBaseModel>>;

export interface SampleProjectAnalyticsDeletion {
  // The tables whose delete was sent, by table name.
  deletedFrom: Array<string>;
  // The tables whose delete failed, by table name.
  failedFor: Array<string>;
}

export default class SampleProjectAnalyticsData {
  public static async deleteAll(
    projectId: ObjectID,
  ): Promise<SampleProjectAnalyticsDeletion> {
    const result: SampleProjectAnalyticsDeletion = {
      deletedFrom: [],
      failedFor: [],
    };

    await Promise.all(
      SAMPLE_PROJECT_ANALYTICS_SERVICES.map(
        async (
          service: AnalyticsDatabaseService<AnalyticsBaseModel>,
        ): Promise<void> => {
          const tableName: string = service.model.tableName || "";

          try {
            await service.deleteBy({
              query: { projectId: projectId } as never,
              props: { isRoot: true },
            });

            result.deletedFrom.push(tableName);
          } catch (err) {
            result.failedFor.push(tableName);

            logger.error(
              `Could not delete the rows of sample project ${projectId.toString()} from ${tableName}; they age out by their retention.`,
              { projectId: projectId.toString() },
            );
            logger.error(err);
          }
        },
      ),
    );

    return result;
  }
}
