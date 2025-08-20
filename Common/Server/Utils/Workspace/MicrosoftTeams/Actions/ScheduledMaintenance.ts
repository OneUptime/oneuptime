import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsActionType from "./ActionTypes";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import Response from "../../../Response";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateService from "../../../../Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceInternalNoteService from "../../../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Services/ScheduledMaintenancePublicNoteService";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsScheduledMaintenanceActions {
  @CaptureSpan()
  public static isScheduledMaintenanceAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.RESOLVE_SCHEDULED_MAINTENANCE:
      case MicrosoftTeamsActionType.CREATE_SCHEDULED_MAINTENANCE_NOTE:
      case MicrosoftTeamsActionType.CREATE_SCHEDULED_MAINTENANCE_PUBLIC_NOTE:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async handleScheduledMaintenanceAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action, req, res } = data;

    switch (action.actionType) {
      case MicrosoftTeamsActionType.RESOLVE_SCHEDULED_MAINTENANCE:
        return this.resolveScheduledMaintenance({
          teamsRequest: teamsRequest,
          action: action,
          req: req,
          res: res,
        });

      case MicrosoftTeamsActionType.CREATE_SCHEDULED_MAINTENANCE_NOTE:
        return this.createScheduledMaintenanceNote({
          teamsRequest: teamsRequest,
          action: action,
          req: req,
          res: res,
          isPublic: false,
        });

      case MicrosoftTeamsActionType.CREATE_SCHEDULED_MAINTENANCE_PUBLIC_NOTE:
        return this.createScheduledMaintenanceNote({
          teamsRequest: teamsRequest,
          action: action,
          req: req,
          res: res,
          isPublic: true,
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
  private static async resolveScheduledMaintenance(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action, req, res } = data;

    const scheduledMaintenanceId: ObjectID = new ObjectID(
      action.scheduledMaintenanceId as string,
    );

    // Get scheduled maintenance
    const scheduledMaintenance: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneById({
        id: scheduledMaintenanceId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          currentScheduledMaintenanceStateId: true,
        },
      });

    if (!scheduledMaintenance) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Scheduled maintenance not found"),
      );
    }

    // Get ended state
    const endedState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          projectId: teamsRequest.projectId,
          isEndedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (!endedState) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Ended state not found"),
      );
    }

    // Update scheduled maintenance state
    await ScheduledMaintenanceService.changeScheduledMaintenanceState({
      projectId: teamsRequest.projectId,
      scheduledMaintenanceId: scheduledMaintenanceId,
      scheduledMaintenanceStateId: endedState.id!,
      shouldNotifyStatusPageSubscribers: true,
      isUpdatedFromWorkspace: true,
      notifyOwners: true,
      rootCause: "Ended from Microsoft Teams",
    });

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `Scheduled maintenance ${scheduledMaintenance.title} has been ended.`,
    });
  }

  @CaptureSpan()
  private static async createScheduledMaintenanceNote(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
    isPublic: boolean;
  }): Promise<void> {
    const { teamsRequest, action, req, res, isPublic } = data;

    const scheduledMaintenanceId: ObjectID = new ObjectID(
      action.scheduledMaintenanceId as string,
    );
    const note: string = action.note as string;

    if (!note) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Note content is required"),
      );
    }

    // Get scheduled maintenance
    const scheduledMaintenance: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneById({
        id: scheduledMaintenanceId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
        },
      });

    if (!scheduledMaintenance) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Scheduled maintenance not found"),
      );
    }

    if (isPublic) {
      // Create public note
      await ScheduledMaintenancePublicNoteService.create({
        data: {
          scheduledMaintenanceId: scheduledMaintenanceId,
          projectId: teamsRequest.projectId,
          note: note,
          postedByName: "Microsoft Teams User",
        },
        props: {
          isRoot: true,
        },
      });
    } else {
      // Create internal note
      await ScheduledMaintenanceInternalNoteService.create({
        data: {
          scheduledMaintenanceId: scheduledMaintenanceId,
          projectId: teamsRequest.projectId,
          note: note,
          postedByName: "Microsoft Teams User",
        },
        props: {
          isRoot: true,
        },
      });
    }

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `${isPublic ? "Public" : "Internal"} note added to scheduled maintenance ${
        scheduledMaintenance.title
      }.`,
    });
  }
}