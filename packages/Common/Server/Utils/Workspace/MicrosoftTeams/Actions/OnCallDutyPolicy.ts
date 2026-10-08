import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsOnCallDutyActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import FeedMarkdown, {
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";

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

    logger.debug("Handling Microsoft Teams on-call duty action:", {
      projectId: data.teamsRequest.projectId.toString(),
      actionType: action.actionType,
    });
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsOnCallDutyActionType.ViewOnCallDuty:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug("Unhandled on-call duty action: " + action.actionType, {
            projectId: data.teamsRequest.projectId.toString(),
            actionType: action.actionType,
          });
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams on-call duty action:", {
        projectId: data.teamsRequest.projectId.toString(),
        actionType: action.actionType,
      });
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }

  /*
   * A card's on-call policy actions, run as the member who pressed the button
   * (`databaseProps`, a current member of `projectId`, as
   * handleBotInvokeActivity builds them): the policy is read in their project
   * with their own permissions - one of another project, or outside their
   * read, is answered like one that does not exist - and escalating it needs
   * the permission to execute an on-call policy, as executing one does
   * everywhere else. Both used to read any policy by id as OneUptime.
   */
  @CaptureSpan()
  public static async handleBotOnCallDutyAction(data: {
    actionType: MicrosoftTeamsOnCallDutyActionType;
    turnContext: TurnContext;
    actionPayload: JSONObject;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { actionType, turnContext, actionPayload, projectId, databaseProps } =
      data;

    try {
      const policyIdValue: JSONValue = actionPayload["onCallDutyPolicyId"];

      if (!policyIdValue) {
        logger.error("OnCallDutyPolicy ID is required", {
          actionType: actionType,
        });
        await turnContext.sendActivity("OnCallDutyPolicy ID is required");
        return;
      }

      const onCallDutyPolicyId: ObjectID = new ObjectID(
        policyIdValue.toString(),
      );

      if (actionType === MicrosoftTeamsOnCallDutyActionType.EscalateOnCall) {
        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType: OnCallDutyPolicyExecutionLog,
          action: "execute this on-call policy",
          resources: [
            { service: OnCallDutyPolicyService, id: onCallDutyPolicyId },
          ],
        });
      }

      const onCallDutyPolicy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneBy({
          query: {
            _id: onCallDutyPolicyId.toString(),
            projectId: projectId,
          },
          select: {
            _id: true,
            name: true,
            description: true,
          },
          props: databaseProps,
        });

      if (!onCallDutyPolicy) {
        logger.error("OnCallDutyPolicy not found", {
          onCallDutyPolicyId: onCallDutyPolicyId.toString(),
        });
        await turnContext.sendActivity("OnCallDutyPolicy not found");
        return;
      }

      switch (actionType) {
        case MicrosoftTeamsOnCallDutyActionType.ViewOnCallDuty:
          await turnContext.sendActivity(
            mdText`**${onCallDutyPolicy.name}**\n\n${FeedMarkdown.asChatMarkdown(onCallDutyPolicy.description || "No description")}`.toString(),
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
          logger.error(`Unknown action type: ${actionType}`, {
            onCallDutyPolicyId: onCallDutyPolicyId.toString(),
            actionType: actionType,
          });
          await turnContext.sendActivity("Unknown action type");
          break;
      }
    } catch (error) {
      // A refusal is written for the member: handleBotInvokeActivity tells them.
      if (error instanceof NotAuthorizedException) {
        throw error;
      }

      logger.error(`Error handling on-call duty action: ${error}`, {
        actionType: actionType,
      });
      await turnContext.sendActivity(
        "An error occurred while processing the action",
      );
    }
  }
}
