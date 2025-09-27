import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsScheduledMaintenanceActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsScheduledMaintenanceActions {
  @CaptureSpan()
  public static isScheduledMaintenanceAction(data: {
    actionType: string;
  }): boolean {
    return (
      data.actionType.includes("scheduled-maintenance") ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete
    );
  }

  @CaptureSpan()
  public static async handleScheduledMaintenanceAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action } = data;

    logger.debug("Handling Microsoft Teams scheduled maintenance action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug(
            `Unhandled scheduled maintenance action: ${action.actionType}`,
          );
          break;
      }
    } catch (error) {
      logger.error(
        "Error handling Microsoft Teams scheduled maintenance action:",
      );
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }
}
