import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import AlertService from "../../../../Services/AlertService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsActionType from "./ActionTypes";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import Response from "../../../Response";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";
import AlertStateService from "../../../../Services/AlertStateService";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertInternalNoteService from "../../../../Services/AlertInternalNoteService";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

export default class MicrosoftTeamsAlertActions {
  @CaptureSpan()
  public static isAlertAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.ACKNOWLEDGE_ALERT:
      case MicrosoftTeamsActionType.RESOLVE_ALERT:
      case MicrosoftTeamsActionType.CREATE_ALERT_NOTE:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async handleAlertAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action, req, res } = data;

    // Get project auth token
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          projectId: teamsRequest.projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        select: {
          authToken: true,
          miscData: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!projectAuth || !projectAuth.authToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Project not connected to Microsoft Teams"),
      );
    }

    switch (action.actionType) {
      case MicrosoftTeamsActionType.ACKNOWLEDGE_ALERT:
        return this.acknowledgeAlert({
          teamsRequest: teamsRequest,
          action: action,
          req: req,
          res: res,
        });

      case MicrosoftTeamsActionType.RESOLVE_ALERT:
        return this.resolveAlert({
          teamsRequest: teamsRequest,
          action: action,
          req: req,
          res: res,
        });

      case MicrosoftTeamsActionType.CREATE_ALERT_NOTE:
        return this.createAlertNote({
          teamsRequest: teamsRequest,
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
  private static async acknowledgeAlert(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action, req, res } = data;

    const alertId: ObjectID = new ObjectID(action.alertId as string);

    // Get alert
    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        title: true,
        description: true,
        currentAlertStateId: true,
      },
    });

    if (!alert) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Alert not found"),
      );
    }

    // Get acknowledged state
    const acknowledgedState: AlertState | null =
      await AlertStateService.findOneBy({
        query: {
          projectId: teamsRequest.projectId,
          isAcknowledgedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (!acknowledgedState) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Acknowledged state not found"),
      );
    }

    // Update alert state
    await AlertService.changeAlertState({
      projectId: teamsRequest.projectId,
      alertId: alertId,
      alertStateId: acknowledgedState.id!,
      isUpdatedFromWorkspace: true,
      notifyOwners: true,
      rootCause: "Acknowledged from Microsoft Teams",
    });

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `Alert ${alert.title} has been acknowledged.`,
    });
  }

  @CaptureSpan()
  private static async resolveAlert(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action, req, res } = data;

    const alertId: ObjectID = new ObjectID(action.alertId as string);

    // Get alert
    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        title: true,
        description: true,
        currentAlertStateId: true,
      },
    });

    if (!alert) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Alert not found"),
      );
    }

    // Get resolved state
    const resolvedState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: teamsRequest.projectId,
        isResolvedState: true,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
      },
    });

    if (!resolvedState) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Resolved state not found"),
      );
    }

    // Update alert state
    await AlertService.changeAlertState({
      projectId: teamsRequest.projectId,
      alertId: alertId,
      alertStateId: resolvedState.id!,
      isUpdatedFromWorkspace: true,
      notifyOwners: true,
      rootCause: "Resolved from Microsoft Teams",
    });

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `Alert ${alert.title} has been resolved.`,
    });
  }

  @CaptureSpan()
  private static async createAlertNote(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action, req, res } = data;

    const alertId: ObjectID = new ObjectID(action.alertId as string);
    const note: string = action.note as string;

    if (!note) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Note content is required"),
      );
    }

    // Get alert
    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        title: true,
      },
    });

    if (!alert) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Alert not found"),
      );
    }

    // Create internal note
    await AlertInternalNoteService.create({
      data: {
        alertId: alertId,
        projectId: teamsRequest.projectId,
        note: note,
        postedByName: "Microsoft Teams User",
      },
      props: {
        isRoot: true,
      },
    });

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `Note added to alert ${alert.title}.`,
    });
  }
}