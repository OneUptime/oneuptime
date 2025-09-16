import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsMonitorActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsMonitorActions {
  @CaptureSpan()
  public static isMonitorAction(data: { actionType: string }): boolean {
    return (
      data.actionType === MicrosoftTeamsMonitorActionType.ViewMonitor ||
      data.actionType === MicrosoftTeamsMonitorActionType.EnableMonitor ||
      data.actionType === MicrosoftTeamsMonitorActionType.DisableMonitor
    );
  }

  @CaptureSpan()
  public static async handleMonitorAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action } = data;

    logger.debug("Handling Microsoft Teams monitor action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsMonitorActionType.ViewMonitor:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug("Unhandled monitor action: " + action.actionType);
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams monitor action:");
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }
}