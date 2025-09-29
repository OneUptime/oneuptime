import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsMonitorActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from 'botbuilder';
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import MonitorService from "../../../../Services/MonitorService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";

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

  @CaptureSpan()
  public static async handleBotMonitorAction(data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    turnContext: TurnContext;
  }): Promise<void> {
    const { actionType, actionValue, projectId, turnContext } = data;

    if (actionType === MicrosoftTeamsMonitorActionType.ViewMonitor) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to view monitor: missing monitor id.");
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

      const message = `**Monitor Details**\n\n**Name:** ${monitor.name}\n**Description:** ${monitor.description || 'No description'}\n**Type:** ${monitor.monitorType}\n**Status:** ${monitor.currentMonitorStatus?.name || 'Unknown'}\n**Enabled:** ${monitor.disableActiveMonitoring ? 'No' : 'Yes'}\n**Created At:** ${monitor.createdAt ? new Date(monitor.createdAt).toLocaleString() : 'Unknown'}`;

      await turnContext.sendActivity(message);
      return;
    }

    if (actionType === MicrosoftTeamsMonitorActionType.EnableMonitor) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to enable monitor: missing monitor id.");
        return;
      }

      await MonitorService.updateOneById({
        id: new ObjectID(actionValue),
        data: {
          disableActiveMonitoring: false,
        },
        props: {
          isRoot: true,
        },
      });

      await turnContext.sendActivity("✅ Monitor enabled successfully.");
      return;
    }

    if (actionType === MicrosoftTeamsMonitorActionType.DisableMonitor) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to disable monitor: missing monitor id.");
        return;
      }

      await MonitorService.updateOneById({
        id: new ObjectID(actionValue),
        data: {
          disableActiveMonitoring: true,
        },
        props: {
          isRoot: true,
        },
      });

      await turnContext.sendActivity("✅ Monitor disabled successfully.");
      return;
    }

    // Default fallback for unimplemented actions
    await turnContext.sendActivity("Sorry, but the action " + actionType + " you requested is not implemented yet.");
  }
}
