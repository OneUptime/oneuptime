import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsOnCallDutyActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";

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

  @CaptureSpan()
  public static async handleBotOnCallDutyAction(
    actionType: MicrosoftTeamsOnCallDutyActionType,
    turnContext: TurnContext,
    actionPayload: JSONObject,
  ): Promise<void> {
    try {
      const onCallDutyPolicyId: ObjectID = actionPayload[
        "onCallDutyPolicyId"
      ] as ObjectID;

      if (!onCallDutyPolicyId) {
        logger.error("OnCallDutyPolicy ID is required");
        await turnContext.sendActivity("OnCallDutyPolicy ID is required");
        return;
      }

      const onCallDutyPolicy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: onCallDutyPolicyId,
          select: {
            _id: true,
            name: true,
            description: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!onCallDutyPolicy) {
        logger.error("OnCallDutyPolicy not found");
        await turnContext.sendActivity("OnCallDutyPolicy not found");
        return;
      }

      switch (actionType) {
        case MicrosoftTeamsOnCallDutyActionType.ViewOnCallDuty:
          await turnContext.sendActivity(
            `**${onCallDutyPolicy.name}**\n\n${onCallDutyPolicy.description || "No description"}`,
          );
          break;

        case MicrosoftTeamsOnCallDutyActionType.EscalateOnCall:
          // TODO: Implement escalation logic
          await OnCallDutyPolicyService.executePolicy(onCallDutyPolicyId, {
            userNotificationEventType:
              UserNotificationEventType.IncidentCreated, // TODO: Get the correct event type
          });
          await turnContext.sendActivity(
            "On-call policy escalated successfully",
          );
          break;

        default:
          logger.error(`Unknown action type: ${actionType}`);
          await turnContext.sendActivity("Unknown action type");
          break;
      }
    } catch (error) {
      logger.error(`Error handling on-call duty action: ${error}`);
      await turnContext.sendActivity(
        "An error occurred while processing the action",
      );
    }
  }
}
