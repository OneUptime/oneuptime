import BadDataException from "../../../../../Types/Exception/BadDataException";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsActionType from "./ActionTypes";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import Response from "../../../Response";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsOnCallDutyActions {
  @CaptureSpan()
  public static isOnCallDutyAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.ViewOnCallPolicy:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async handleOnCallDutyAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Project is authorized and user is authorized. Perform actions based on action type.
    const actionType: MicrosoftTeamsActionType | undefined = data.action.actionType;

    if (actionType === MicrosoftTeamsActionType.ViewOnCallPolicy) {
      // Do nothing. This is just a view on-call policy action.
      // Clear response.
      return Response.sendJsonObjectResponse(data.req, data.res, {
        response_action: "clear",
      });
    }

    // Invalid action type.
    return Response.sendErrorResponse(
      data.req,
      data.res,
      new BadDataException("Invalid Action Type"),
    );
  }
}
