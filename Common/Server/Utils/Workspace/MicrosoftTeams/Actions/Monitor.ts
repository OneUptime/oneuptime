import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import MonitorService from "../../../../Services/MonitorService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsActionType from "./ActionTypes";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import Response from "../../../Response";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import ProbeMonitorResponseService from "../../../../Services/ProbeMonitorResponseService";

export default class MicrosoftTeamsMonitorActions {
  @CaptureSpan()
  public static isMonitorAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.RUN_MONITOR:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async handleMonitorAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action, req, res } = data;

    switch (action.actionType) {
      case MicrosoftTeamsActionType.RUN_MONITOR:
        return this.runMonitor({
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
  private static async runMonitor(data: {
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action, req, res } = data;

    const monitorId: ObjectID = new ObjectID(action.monitorId as string);

    // Get monitor
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: monitorId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        name: true,
        monitorType: true,
      },
    });

    if (!monitor) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Monitor not found"),
      );
    }

    // Trigger monitor check
    await ProbeMonitorResponseService.checkProbeMonitor({
      monitorId: monitorId,
      isManualCheck: true,
    });

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `Monitor ${monitor.name} has been triggered for a manual check.`,
    });
  }
}