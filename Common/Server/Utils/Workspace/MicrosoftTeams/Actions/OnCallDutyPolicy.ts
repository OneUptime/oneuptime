import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsActionType from "./ActionTypes";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import Response from "../../../Response";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLogService from "../../../../Services/OnCallDutyPolicyExecutionLogService";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";

export default class MicrosoftTeamsOnCallDutyActions {
  @CaptureSpan()
  public static isOnCallDutyAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.UPDATE_ON_CALL_DUTY_POLICY:
      case MicrosoftTeamsActionType.VIEW_ON_CALL_DUTY_POLICY:
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
    const { action, req, res } = data;

    switch (action.actionType) {
      case MicrosoftTeamsActionType.UPDATE_ON_CALL_DUTY_POLICY:
        return this.updateOnCallDutyPolicy({
          action: action,
          req: req,
          res: res,
        });

      case MicrosoftTeamsActionType.VIEW_ON_CALL_DUTY_POLICY:
        return this.viewOnCallDutyPolicy({
          action: action,
          req: req,
          res: res,
        });

      default:
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid action type"),
        );
    }
  }

  @CaptureSpan()
  private static async updateOnCallDutyPolicy(data: {
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action, req, res } = data;

    const policyId: ObjectID = new ObjectID(action.policyId as string);

    // Get on-call duty policy
    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: policyId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          name: true,
          description: true,
        },
      });

    if (!policy) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("On-call duty policy not found"),
      );
    }

    // Execute the on-call duty policy
    await OnCallDutyPolicyService.executeOnCallPolicy({
      onCallPolicyId: policyId,
      triggeredByIncidentId: undefined,
      userNotificationEventType:
        UserNotificationEventType.IncidentCreated,
    });

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `On-call duty policy ${policy.name} has been executed.`,
    });
  }

  @CaptureSpan()
  private static async viewOnCallDutyPolicy(data: {
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action, req, res } = data;

    const policyId: ObjectID = new ObjectID(action.policyId as string);

    // Get on-call duty policy with schedules
    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: policyId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          name: true,
          description: true,
          onCallDutyPolicySchedules: {
            name: true,
            description: true,
          },
        },
      });

    if (!policy) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("On-call duty policy not found"),
      );
    }

    // Format policy information
    let responseText: string = `**On-Call Duty Policy: ${policy.name}**\n`;
    
    if (policy.description) {
      responseText += `Description: ${policy.description}\n`;
    }

    if (
      policy.onCallDutyPolicySchedules &&
      policy.onCallDutyPolicySchedules.length > 0
    ) {
      responseText += `\n**Schedules:**\n`;
      for (const schedule of policy.onCallDutyPolicySchedules) {
        responseText += `• ${schedule.name}`;
        if (schedule.description) {
          responseText += ` - ${schedule.description}`;
        }
        responseText += `\n`;
      }
    }

    // Send response with policy information
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: responseText,
    });
  }
}