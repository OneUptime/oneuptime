import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAction,
  MicrosoftTeamsRequest,
} from "./Auth";
import { MicrosoftTeamsAlertActionType } from "./ActionTypes";
import logger from "../../../Logger";
import ObjectID from "../../../../../Types/ObjectID";
import AlertService from "../../../../Services/AlertService";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsAlertActions {
  @CaptureSpan()
  public static isAlertAction(data: { actionType: string }): boolean {
    return (
      data.actionType.includes("alert") ||
      data.actionType === MicrosoftTeamsAlertActionType.AckAlert ||
      data.actionType === MicrosoftTeamsAlertActionType.ResolveAlert ||
      data.actionType === MicrosoftTeamsAlertActionType.ViewAlert ||
      data.actionType === MicrosoftTeamsAlertActionType.AlertCreated ||
      data.actionType === MicrosoftTeamsAlertActionType.AlertStateChanged
    );
  }

  @CaptureSpan()
  public static async handleAlertAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action } = data;

    logger.debug("Handling Microsoft Teams alert action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsAlertActionType.AckAlert:
          await this.acknowledgeAlert({
            teamsRequest,
            action,
          });
          break;

        case MicrosoftTeamsAlertActionType.ResolveAlert:
          await this.resolveAlert({
            teamsRequest,
            action,
          });
          break;

        case MicrosoftTeamsAlertActionType.ViewAlert:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug("Unhandled alert action: " + action.actionType);
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams alert action:");
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }

  @CaptureSpan()
  private static async acknowledgeAlert(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const alertId: string = data.action.actionValue || "";

    if (!alertId) {
      logger.error("No alert ID provided for acknowledge action");
      return;
    }

    logger.debug("Acknowledging alert: " + alertId);

    try {
      const alert: Alert | null = await AlertService.findOneBy({
        query: {
          _id: alertId,
          projectId: data.teamsRequest.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          currentAlertState: {
            _id: true,
            name: true,
            isAcknowledgedState: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        logger.error("Alert not found: " + alertId);
        return;
      }

      if (alert.currentAlertState?.isAcknowledgedState) {
        logger.debug("Alert is already acknowledged");
        return;
      }

      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await AlertService.acknowledgeAlert(
        new ObjectID(alertId),
        oneUptimeUserId,
      );

      logger.debug("Alert acknowledged successfully");
    } catch (error) {
      logger.error("Error acknowledging alert:");
      logger.error(error);
    }
  }

  @CaptureSpan()
  private static async resolveAlert(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const alertId: string = data.action.actionValue || "";

    if (!alertId) {
      logger.error("No alert ID provided for resolve action");
      return;
    }

    logger.debug("Resolving alert: " + alertId);

    try {
      const alert: Alert | null = await AlertService.findOneBy({
        query: {
          _id: alertId,
          projectId: data.teamsRequest.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          currentAlertState: {
            _id: true,
            name: true,
            isResolvedState: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        logger.error("Alert not found: " + alertId);
        return;
      }

      if (alert.currentAlertState?.isResolvedState) {
        logger.debug("Alert is already resolved");
        return;
      }

      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await AlertService.resolveAlert(new ObjectID(alertId), oneUptimeUserId);

      logger.debug("Alert resolved successfully");
    } catch (error) {
      logger.error("Error resolving alert:");
      logger.error(error);
    }
  }
}
