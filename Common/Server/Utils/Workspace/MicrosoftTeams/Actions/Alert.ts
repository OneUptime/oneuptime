import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import AlertService from "../../../../Services/AlertService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsUtil from "../MicrosoftTeams";
import MicrosoftTeamsActionType from "./ActionTypes";
import Response from "../../../Response";
import {
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceMessagePayload from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

export interface MicrosoftTeamsAction {
  actionType: MicrosoftTeamsActionType;
  alertId: string;
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

export default class MicrosoftTeamsAlertActions {
  @CaptureSpan()
  public static isAlertAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.AcknowledgeAlert:
      case MicrosoftTeamsActionType.ResolveAlert:
      case MicrosoftTeamsActionType.ViewAlert:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async acknowledgeAlert(data: {
    microsoftTeamsRequest: MicrosoftTeamsRequest;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { microsoftTeamsRequest, req, res } = data;
    const { userId, projectId } = microsoftTeamsRequest;

    const alertId: ObjectID = new ObjectID(microsoftTeamsRequest.action.alertId);

    // Check if alert exists
    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      select: {
        _id: true,
        title: true,
        currentAlertState: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Alert not found"),
      );
    }

    // Check if alert is already acknowledged
    const isAlreadyAcknowledged: boolean =
      await AlertService.isAlertAcknowledged({
        alertId: alertId,
      });

    if (isAlreadyAcknowledged) {
      const alertNumber: number | null = await AlertService.getAlertNumber({
        alertId: alertId,
      });

      const markdownPayload: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `Alert **[Alert ${alertNumber?.toString()}](${await AlertService.getAlertLinkInDashboard(projectId, alertId)})** has already been acknowledged.`,
      };

      const workspaceMessagePayload: WorkspaceMessagePayload = {
        _type: "WorkspaceMessagePayload",
        channelNames: [],
        channelIds: [],
        messageBlocks: [markdownPayload],
        workspaceType: WorkspaceType.MicrosoftTeams,
      };

      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: workspaceMessagePayload,
        authToken: microsoftTeamsRequest.authToken,
        userId: microsoftTeamsRequest.userId,
        projectId: projectId,
      });

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        message: "Alert already acknowledged",
      });
    }

    // Acknowledge the alert
    await AlertService.acknowledgeAlert(alertId, new ObjectID(userId));

    // Log the button interaction
    if (projectId && userId) {
      try {
        const logData: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          userId: ObjectID;
          buttonAction: string;
          alertId: ObjectID;
        } = {
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
          userId: new ObjectID(userId),
          buttonAction: "acknowledge_alert",
          alertId: alertId,
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
      text: `✅ Alert **${alert.title}** has been acknowledged.`,
    };

    const workspaceMessagePayload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: [],
      messageBlocks: [markdownPayload],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    await MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: workspaceMessagePayload,
      authToken: microsoftTeamsRequest.authToken,
      userId: microsoftTeamsRequest.userId,
      projectId: projectId,
    });

    return Response.sendJsonObjectResponse(req, res, {
      success: true,
      message: "Alert acknowledged successfully",
    });
  }

  @CaptureSpan()
  public static async resolveAlert(data: {
    microsoftTeamsRequest: MicrosoftTeamsRequest;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { microsoftTeamsRequest, req, res } = data;
    const { userId, projectId } = microsoftTeamsRequest;

    const alertId: ObjectID = new ObjectID(microsoftTeamsRequest.action.alertId);

    // Check if alert exists
    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      select: {
        _id: true,
        title: true,
        currentAlertState: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Alert not found"),
      );
    }

    // Check if alert is already resolved
    const isAlreadyResolved: boolean = await AlertService.isAlertResolved({
      alertId: alertId,
    });

    if (isAlreadyResolved) {
      const alertNumber: number | null = await AlertService.getAlertNumber({
        alertId: alertId,
      });

      const markdownPayload: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `Alert **[Alert ${alertNumber?.toString()}](${await AlertService.getAlertLinkInDashboard(projectId, alertId)})** has already been resolved.`,
      };

      const workspaceMessagePayload: WorkspaceMessagePayload = {
        _type: "WorkspaceMessagePayload",
        channelNames: [],
        channelIds: [],
        messageBlocks: [markdownPayload],
        workspaceType: WorkspaceType.MicrosoftTeams,
      };

      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: workspaceMessagePayload,
        authToken: microsoftTeamsRequest.authToken,
        userId: microsoftTeamsRequest.userId,
        projectId: projectId,
      });

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        message: "Alert already resolved",
      });
    }

    // Resolve the alert
    await AlertService.resolveAlert(alertId, new ObjectID(userId));

    // Log the button interaction
    if (projectId && userId) {
      try {
        const logData: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          userId: ObjectID;
          buttonAction: string;
          alertId: ObjectID;
        } = {
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
          userId: new ObjectID(userId),
          buttonAction: "resolve_alert",
          alertId: alertId,
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
      text: `✅ Alert **${alert.title}** has been resolved.`,
    };

    const workspaceMessagePayload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: [],
      messageBlocks: [markdownPayload],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    await MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: workspaceMessagePayload,
      authToken: microsoftTeamsRequest.authToken,
      userId: microsoftTeamsRequest.userId,
      projectId: projectId,
    });

    return Response.sendJsonObjectResponse(req, res, {
      success: true,
      message: "Alert resolved successfully",
    });
  }

  @CaptureSpan()
  public static async handleAlertAction(data: {
    microsoftTeamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const actionType: MicrosoftTeamsActionType | undefined = data.action.actionType;

    if (actionType === MicrosoftTeamsActionType.AcknowledgeAlert) {
      return await this.acknowledgeAlert(data);
    }

    if (actionType === MicrosoftTeamsActionType.ResolveAlert) {
      return await this.resolveAlert(data);
    }

    if (actionType === MicrosoftTeamsActionType.ViewAlert) {
      // Do nothing for view action
      return Response.sendJsonObjectResponse(data.req, data.res, {
        response_action: "clear",
      });
    }

    // Invalid action type
    return Response.sendErrorResponse(
      data.req,
      data.res,
      new BadDataException("Invalid Action Type"),
    );
  }
}
