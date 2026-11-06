import Alert from "../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import OneUptimeDate from "../../../Types/Date";
import {
  DATA_ALERT_FEEDBACK_VALUES,
  DataAlertFeedback,
  DataAlertRetune,
  isNoiseFeedback,
  planDataAlertRetune,
} from "../../../Types/DataObservability/DataAlertFeedback";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import DataAlertService from "../../Services/DataAlertService";
import DataAssetService from "../../Services/DataAssetService";
import { getDataAlertMetricName } from "./DataAlertCause";

/*
 * WHAT SOMEONE SAID ABOUT A DATA ALERT, KEPT AND ACTED ON.
 *
 * "Expected" and "not an issue" close the alert: there is nothing left to do.
 * "Not an issue" also retunes what raised it (DataAlertFeedback), so the same
 * thing stays quiet next time. Whether the likely cause was right is only
 * kept, for the measure it feeds.
 */
export default class DataAlertFeedbackRecorder {
  public static async record(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    userId: ObjectID | null;
    feedback?: string | undefined;
    isCauseConfirmed?: boolean | undefined;
  }): Promise<void> {
    if (
      data.feedback !== undefined &&
      !DATA_ALERT_FEEDBACK_VALUES.includes(data.feedback as DataAlertFeedback)
    ) {
      throw new BadDataException(
        "Say the alert was useful, expected, or not an issue.",
      );
    }

    const row: DataAlert | null = await DataAlertService.findOneBy({
      query: { projectId: data.projectId, alertId: data.alertId },
      select: { _id: true, dataAssetId: true },
      props: { isRoot: true },
    });

    if (!row?.id) {
      throw new BadDataException("This is not a data alert.");
    }

    await DataAlertService.updateColumnsByIdWithoutHooks({
      id: row.id,
      data: {
        ...(data.feedback
          ? {
              feedback: data.feedback,
              feedbackAt: OneUptimeDate.getCurrentDate(),
              ...(data.userId ? { feedbackByUserId: data.userId } : {}),
            }
          : {}),
        ...(data.isCauseConfirmed !== undefined
          ? { isCauseConfirmed: data.isCauseConfirmed }
          : {}),
      } as never,
    });

    if (!data.feedback || !isNoiseFeedback(data.feedback)) {
      return;
    }

    const alert: Alert | null = await AlertService.findOneBy({
      query: { projectId: data.projectId, _id: data.alertId },
      select: {
        currentAlertStateId: true,
        monitor: { monitorSteps: true } as never,
      },
      props: { isRoot: true },
    });

    if (row.dataAssetId) {
      await this.retune({
        dataAssetId: row.dataAssetId,
        feedback: data.feedback as DataAlertFeedback,
        metricName: getDataAlertMetricName(alert?.monitor?.monitorSteps),
      });
    }

    const resolved: { id?: ObjectID | null } =
      await AlertStateService.getResolvedAlertState({
        projectId: data.projectId,
        props: { isRoot: true },
      });

    if (
      resolved.id &&
      alert?.currentAlertStateId?.toString() !== resolved.id.toString()
    ) {
      await AlertService.changeAlertState({
        projectId: data.projectId,
        alertId: data.alertId,
        alertStateId: resolved.id,
        notifyOwners: false,
        rootCause: `Marked ${data.feedback.toLowerCase()} in Data Observability.`,
        stateChangeLog: undefined,
        ...(data.userId ? { createdByUserId: data.userId } : {}),
        props: { isRoot: true },
      });
    }
  }

  private static async retune(data: {
    dataAssetId: ObjectID;
    feedback: DataAlertFeedback;
    metricName: string | null;
  }): Promise<void> {
    const asset: DataAsset | null = await DataAssetService.findOneById({
      id: data.dataAssetId,
      select: {
        updateIntervalInSeconds: true,
        rowCountChangeTolerancePercent: true,
      },
      props: { isRoot: true },
    });
    const retune: DataAlertRetune | null = planDataAlertRetune({
      feedback: data.feedback,
      metricName: data.metricName,
      updateIntervalInSeconds: asset?.updateIntervalInSeconds,
      rowCountChangeTolerancePercent: asset?.rowCountChangeTolerancePercent,
    });

    if (retune) {
      await DataAssetService.updateColumnsByIdWithoutHooks({
        id: data.dataAssetId,
        data: retune as never,
      });
    }
  }
}
