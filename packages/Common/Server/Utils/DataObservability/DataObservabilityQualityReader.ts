import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataIssueReport from "../../../Models/DatabaseModels/DataIssueReport";
import OneUptimeDate from "../../../Types/Date";
import {
  DataAlertOutcome,
  DataObservabilityQuality,
  summarizeDataQuality,
} from "../../../Types/DataObservability/DataAlertFeedback";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import DataAlertService from "../../Services/DataAlertService";
import DataAssetService from "../../Services/DataAssetService";
import DataIssueReportService from "../../Services/DataIssueReportService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * HOW WELL DATA OBSERVABILITY IS WORKING FOR A PROJECT, over the last 30 days:
 * issues people found useful, the share not called noise, the share of tables
 * read, how often OneUptime raised a problem before someone reported it, how
 * late it saw a late table, and how often its likely cause was the real one.
 */

export const QUALITY_WINDOW_IN_DAYS: number = 30;
const MAX_ALERTS_READ: number = 5_000;
const MAX_REPORTS_READ: number = 1_000;

export default class DataObservabilityQualityReader {
  public static async read(
    projectId: ObjectID,
    now: Date,
  ): Promise<DataObservabilityQuality> {
    const since: Date = OneUptimeDate.addRemoveDays(
      now,
      -QUALITY_WINDOW_IN_DAYS,
    );
    const alerts: Array<DataAlert> = await DataAlertService.findBy({
      query: { projectId, createdAt: QueryHelper.greaterThanEqualTo(since) },
      select: {
        alertId: true,
        causeAlertId: true,
        feedback: true,
        isCauseConfirmed: true,
        detectedAfterInSeconds: true,
      },
      limit: MAX_ALERTS_READ,
      skip: 0,
      props: { isRoot: true },
    });
    const alertIds: Array<ObjectID> = alerts
      .map((alert: DataAlert): ObjectID | undefined => {
        return alert.alertId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });
    const actedOn: Set<string> = new Set();

    if (alertIds.length > 0) {
      const timeline: Array<AlertStateTimeline> =
        await AlertStateTimelineService.findBy({
          query: {
            projectId,
            alertId: QueryHelper.any(alertIds),
            createdByUserId: QueryHelper.notNull(),
          },
          select: { alertId: true },
          limit: MAX_ALERTS_READ,
          skip: 0,
          props: { isRoot: true },
        });

      for (const change of timeline) {
        if (change.alertId) {
          actedOn.add(change.alertId.toString());
        }
      }
    }

    const reports: Array<DataIssueReport> = await DataIssueReportService.findBy(
      {
        query: { projectId, createdAt: QueryHelper.greaterThanEqualTo(since) },
        select: { wasCaughtFirst: true },
        limit: MAX_REPORTS_READ,
        skip: 0,
        props: { isRoot: true },
      },
    );
    const tableCount: PositiveNumber = await DataAssetService.countBy({
      query: { projectId, isDropped: false },
      props: { isRoot: true },
    });
    const collectedTableCount: PositiveNumber = await DataAssetService.countBy({
      query: {
        projectId,
        isDropped: false,
        lastCollectedAt: QueryHelper.greaterThanEqualTo(
          OneUptimeDate.addRemoveDays(now, -1),
        ),
      },
      props: { isRoot: true },
    });

    return summarizeDataQuality({
      windowInDays: QUALITY_WINDOW_IN_DAYS,
      outcomes: alerts.map((alert: DataAlert): DataAlertOutcome => {
        return {
          feedback: alert.feedback || null,
          hadPersonAction: actedOn.has(alert.alertId?.toString() || ""),
          isCauseConfirmed:
            alert.isCauseConfirmed === undefined ||
            alert.isCauseConfirmed === null
              ? null
              : alert.isCauseConfirmed,
          detectedAfterInSeconds: alert.detectedAfterInSeconds ?? null,
          isConsequence: Boolean(alert.causeAlertId),
        };
      }),
      reports: reports.map((report: DataIssueReport) => {
        return { wasCaughtFirst: report.wasCaughtFirst === true };
      }),
      tableCount: tableCount.toNumber(),
      collectedTableCount: collectedTableCount.toNumber(),
    });
  }
}
