import BadDataException from "../../../../../Types/Exception/BadDataException";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import SlackActionType from "./ActionTypes";
import { SlackAction, SlackRequest } from "./Auth";
import Response from "../../../Response";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class SlackOnCallDutyActions {
  @CaptureSpan()
  public static isOnCallDutyAction(data: {
    actionType: SlackActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case SlackActionType.ViewOnCallPolicy:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async handleOnCallDutyAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // now we should be all set, project is authorized and user is authorized. Lets perform some actions based on the action type.
    const actionType: SlackActionType | undefined = data.action.actionType;

    if (actionType === SlackActionType.ViewOnCallPolicy) {
      // do nothing. This is just a view alert action.
      // clear response.
      return Response.sendJsonObjectResponse(data.req, data.res, {
        response_action: "clear",
      });
    }

    // invalid action type.
    return Response.sendErrorResponse(
      data.req,
      data.res,
      new BadDataException("Invalid Action Type"),
    );
  }
}
