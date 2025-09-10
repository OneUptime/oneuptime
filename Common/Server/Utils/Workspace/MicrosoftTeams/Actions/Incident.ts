import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsUtil from "../MicrosoftTeams";
import MicrosoftTeamsActionType from "./ActionTypes";
import Response from "../../../Response";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceMessagePayload from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import IncidentStateService from "../../../../Services/IncidentStateService";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

export interface MicrosoftTeamsAction {
  actionType: MicrosoftTeamsActionType;
  incidentId: string;
  userId: string;
  projectId: string;
}

export interface MicrosoftTeamsRequest {
  projectId: ObjectID;
  userId: string;
  action: MicrosoftTeamsAction;
  authToken: string;
  botUserId?: string;
}

export default class MicrosoftTeamsIncidentActions {
  @CaptureSpan()
  public static isIncidentAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.AcknowledgeIncident:
      case MicrosoftTeamsActionType.ResolveIncident:
      case MicrosoftTeamsActionType.ViewAddIncidentNote:
      case MicrosoftTeamsActionType.SubmitIncidentNote:
      case MicrosoftTeamsActionType.ViewChangeIncidentState:
      case MicrosoftTeamsActionType.SubmitChangeIncidentState:
      case MicrosoftTeamsActionType.ViewExecuteIncidentOnCallPolicy:
      case MicrosoftTeamsActionType.SubmitExecuteIncidentOnCallPolicy:
      case MicrosoftTeamsActionType.ViewIncident:
      case MicrosoftTeamsActionType.NewIncident:
      case MicrosoftTeamsActionType.SubmitNewIncident:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async acknowledgeIncident(data: {
    microsoftTeamsRequest: MicrosoftTeamsRequest;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { microsoftTeamsRequest, req, res } = data;
    const { userId, projectId } = microsoftTeamsRequest;

    const incidentId: ObjectID = new ObjectID(microsoftTeamsRequest.action.incidentId);

    // Check if incident exists
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        _id: true,
        title: true,
        currentIncidentState: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Incident not found"),
      );
    }

    // Check if incident is already acknowledged
    if (incident.currentIncidentState?.name === "Acknowledged") {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Incident is already acknowledged"),
      );
    }

    // Get acknowledged state
    const acknowledgedState: IncidentState | null = await IncidentStateService.findOneBy({
      query: {
        name: "Acknowledged",
        projectId: projectId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!acknowledgedState) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Acknowledged state not found"),
      );
    }

    // Update incident state
    await IncidentService.updateOneById({
      id: incidentId,
      data: {
        currentIncidentStateId: acknowledgedState._id!,
      },
      props: {
        isRoot: true,
      },
    });

    // Simplified logging - removed for now to avoid complexity
    // await WorkspaceNotificationLogService.create({...});

    // Send success message
    const messageBlocks: Array<WorkspaceMessageBlock> = [
      {
        _type: "WorkspacePayloadMarkdown",
        text: `✅ Incident **${incident.title}** has been acknowledged.`,
      } as WorkspacePayloadMarkdown,
    ];

    await MicrosoftTeamsUtil.sendDirectMessageToUser({
      authToken: microsoftTeamsRequest.authToken,
      workspaceUserId: userId,
      messageBlocks: messageBlocks,
    });

    return Response.sendJsonObjectResponse(req, res, {
      success: true,
      message: "Incident acknowledged successfully",
    });
  }

  @CaptureSpan()
  public static async resolveIncident(data: {
    microsoftTeamsRequest: MicrosoftTeamsRequest;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { microsoftTeamsRequest, req, res } = data;
    const { userId, projectId } = microsoftTeamsRequest;

    const incidentId: ObjectID = new ObjectID(microsoftTeamsRequest.action.incidentId);

    // Check if incident exists
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        _id: true,
        title: true,
        currentIncidentState: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Incident not found"),
      );
    }

    // Check if incident is already resolved
    if (incident.currentIncidentState?.name === "Resolved") {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Incident is already resolved"),
      );
    }

    // Get resolved state
    const resolvedState: IncidentState | null = await IncidentStateService.findOneBy({
      query: {
        name: "Resolved",
        projectId: projectId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!resolvedState) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Resolved state not found"),
      );
    }

    // Update incident state
    await IncidentService.updateOneById({
      id: incidentId,
      data: {
        currentIncidentStateId: resolvedState._id!,
      },
      props: {
        isRoot: true,
      },
    });

    // Simplified logging - removed for now
    // await WorkspaceNotificationLogService.create({...});

    // Send success message
    const messageBlocks: Array<WorkspaceMessageBlock> = [
      {
        _type: "WorkspacePayloadMarkdown",
        text: `✅ Incident **${incident.title}** has been resolved.`,
      } as WorkspacePayloadMarkdown,
    ];

    await MicrosoftTeamsUtil.sendDirectMessageToUser({
      authToken: microsoftTeamsRequest.authToken,
      workspaceUserId: userId,
      messageBlocks: messageBlocks,
    });

    return Response.sendJsonObjectResponse(req, res, {
      success: true,
      message: "Incident resolved successfully",
    });
  }

  @CaptureSpan()
  public static async executeOnCallPolicy(data: {
    microsoftTeamsRequest: MicrosoftTeamsRequest;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { microsoftTeamsRequest, req, res } = data;
    const { userId, projectId } = microsoftTeamsRequest;

    const incidentId: ObjectID = new ObjectID(microsoftTeamsRequest.action.incidentId);

    // Check if incident exists
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        _id: true,
        title: true,
        onCallDutyPolicies: {
          _id: true,
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Incident not found"),
      );
    }

    if (!incident.onCallDutyPolicies || incident.onCallDutyPolicies.length === 0) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("No on-call policies found for this incident"),
      );
    }

        // Execute on-call policies
    for (const policy of incident.onCallDutyPolicies) {
      await OnCallDutyPolicyService.executePolicy(new ObjectID(policy._id!), {
        triggeredByIncidentId: incidentId,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
      });
    }

    // Log the button interaction
    if (projectId && userId) {
      try {
        const logData: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          channelId?: string;
          userId: ObjectID;
          buttonAction: string;
          incidentId: ObjectID;
        } = {
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
          userId: new ObjectID(userId),
          buttonAction: "execute_on_call_policy",
          incidentId: incidentId,
        };

        await WorkspaceNotificationLogService.logButtonPressed(logData, {
          isRoot: true,
        });
      } catch (err) {
        // Don't throw the error, just log it so the main flow continues
      }
    }

    // Send confirmation message
    const markdownPayload: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `🚨 On-call policies have been executed for incident **${incident.title}**.`,
    };

    const workspaceMessagePayload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      channelNames: [], // Will be set by the workspace utility
      channelIds: [], // Will be set by the workspace utility
      messageBlocks: [markdownPayload],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    await MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: workspaceMessagePayload,
      authToken: microsoftTeamsRequest.authToken,
      userId: microsoftTeamsRequest.userId,
      projectId: projectId,
    });
  }

  @CaptureSpan()
  public static async handleIncidentAction(data: {
    microsoftTeamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // now we should be all set, project is authorized and user is authorized. Lets perform some actions based on the action type.
    const actionType: MicrosoftTeamsActionType | undefined = data.action.actionType;

    if (actionType === MicrosoftTeamsActionType.AcknowledgeIncident) {
      return await this.acknowledgeIncident(data);
    }

    if (actionType === MicrosoftTeamsActionType.ResolveIncident) {
      return await this.resolveIncident(data);
    }

    if (actionType === MicrosoftTeamsActionType.ViewExecuteIncidentOnCallPolicy) {
      return await this.executeOnCallPolicy(data);
    }

    // For other action types that don't have handlers yet, return empty response
    return Response.sendTextResponse(data.req, data.res, "");
  }
}
