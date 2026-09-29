import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsMonitorActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import MonitorService from "../../../../Services/MonitorService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";

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

    logger.debug("Handling Microsoft Teams monitor action:", {
      projectId: data.teamsRequest.projectId.toString(),
      actionType: action.actionType,
    });
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsMonitorActionType.ViewMonitor:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug("Unhandled monitor action: " + action.actionType, {
            projectId: data.teamsRequest.projectId.toString(),
            actionType: action.actionType,
          });
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams monitor action:", {
        projectId: data.teamsRequest.projectId.toString(),
        actionType: action.actionType,
      });
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }

  @CaptureSpan()
  public static async handleBotMonitorAction(data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const { actionType, actionValue, projectId, databaseProps, turnContext } =
      data;

    if (actionType === MicrosoftTeamsMonitorActionType.ViewMonitor) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to view monitor: missing monitor id.",
        );
        return;
      }

      const monitor: Monitor | null = await MonitorService.findOneBy({
        query: {
          _id: actionValue,
          projectId: projectId,
        },
        select: {
          _id: true,
          name: true,
          description: true,
          monitorType: true,
          currentMonitorStatus: {
            name: true,
          },
          disableActiveMonitoring: true,
          createdAt: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!monitor) {
        await turnContext.sendActivity("Monitor not found.");
        return;
      }

      const message: string = `**Monitor Details**\n\n**Name:** ${monitor.name}\n**Description:** ${monitor.description || "No description"}\n**Type:** ${monitor.monitorType}\n**Status:** ${monitor.currentMonitorStatus?.name || "Unknown"}\n**Enabled:** ${monitor.disableActiveMonitoring ? "No" : "Yes"}\n**Created At:** ${monitor.createdAt ? new Date(monitor.createdAt).toLocaleString() : "Unknown"}`;

      await turnContext.sendActivity(message);
      return;
    }

    if (actionType === MicrosoftTeamsMonitorActionType.EnableMonitor) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to enable monitor: missing monitor id.",
        );
        return;
      }

      await this.setActiveMonitoring({
        monitorId: new ObjectID(actionValue),
        disableActiveMonitoring: false,
        props: databaseProps,
        action: "enable this monitor",
      });

      await turnContext.sendActivity("✅ Monitor enabled successfully.");
      return;
    }

    if (actionType === MicrosoftTeamsMonitorActionType.DisableMonitor) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to disable monitor: missing monitor id.",
        );
        return;
      }

      await this.setActiveMonitoring({
        monitorId: new ObjectID(actionValue),
        disableActiveMonitoring: true,
        props: databaseProps,
        action: "disable this monitor",
      });

      await turnContext.sendActivity("✅ Monitor disabled successfully.");
      return;
    }

    // Default fallback for unimplemented actions
    await turnContext.sendActivity(
      "Sorry, but the action " +
        actionType +
        " you requested is not implemented yet.",
    );
  }

  /*
   * Enabling or disabling a monitor is an ordinary Monitor update, so it runs
   * with the user's own props: the permission layer then applies the same
   * role, label and project scoping the dashboard would. An update that
   * matched no row means the monitor is not one this user may change here.
   */
  private static async setActiveMonitoring(data: {
    monitorId: ObjectID;
    disableActiveMonitoring: boolean;
    props: DatabaseCommonInteractionProps;
    action: string;
  }): Promise<void> {
    let updatedCount: number = 0;

    try {
      updatedCount = await MonitorService.updateOneById({
        id: data.monitorId,
        data: {
          disableActiveMonitoring: data.disableActiveMonitoring,
        },
        props: data.props,
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(
          `You do not have permission to ${data.action}. ${err.message}`,
        );
      }

      throw err;
    }

    if (updatedCount === 0) {
      throw new NotAuthorizedException(
        `You do not have permission to ${data.action}: the monitor was not found in this project, or you do not have access to it.`,
      );
    }
  }
}
