import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsOnCallDutyActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsOnCallDutyActions {
  @CaptureSpan()
  public static isOnCallDutyAction(data: { actionType: string }): boolean {
    return (
      data.actionType === MicrosoftTeamsOnCallDutyActionType.ViewOnCallDuty ||
      data.actionType === MicrosoftTeamsOnCallDutyActionType.EscalateOnCall
    );
  }

  @CaptureSpan()
  public static async handleOnCallDutyAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action } = data;

    logger.debug("Handling Microsoft Teams on-call duty action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsOnCallDutyActionType.ViewOnCallDuty:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug("Unhandled on-call duty action: " + action.actionType);
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams on-call duty action:");
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }
}