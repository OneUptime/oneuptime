import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsUtil from "../MicrosoftTeams";
import MicrosoftTeamsActionType from "./ActionTypes";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import Response from "../../../Response";
import {
  WorkspaceModalBlock,
  WorkspaceDropdownBlock,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import ScheduledMaintenancePublicNoteService from "../../../../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceInternalNoteService from "../../../../Services/ScheduledMaintenanceInternalNoteService";
import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";
import ScheduledMaintenanceState from "../../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateService from "../../../../Services/ScheduledMaintenanceStateService";
import AccessTokenService from "../../../../Services/AccessTokenService";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";

export default class MicrosoftTeamsScheduledMaintenanceActions {
  @CaptureSpan()
  public static isScheduledMaintenanceAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.MarkScheduledMaintenanceAsOngoing:
      case MicrosoftTeamsActionType.MarkScheduledMaintenanceAsComplete:
      case MicrosoftTeamsActionType.ViewAddScheduledMaintenanceNote:
      case MicrosoftTeamsActionType.SubmitScheduledMaintenanceNote:
      case MicrosoftTeamsActionType.ViewChangeScheduledMaintenanceState:
      case MicrosoftTeamsActionType.SubmitChangeScheduledMaintenanceState:
      case MicrosoftTeamsActionType.ViewScheduledMaintenance:
      case MicrosoftTeamsActionType.NewScheduledMaintenance:
      case MicrosoftTeamsActionType.SubmitNewScheduledMaintenance:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async submitNewScheduledMaintenance(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, req, res } = data;
    const { userId, projectAuthToken } = teamsRequest;

    if (!userId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User ID"),
      );
    }

    if (!projectAuthToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project Auth Token"),
      );
    }

    if (
      data.action.actionType ===
      MicrosoftTeamsActionType.SubmitNewScheduledMaintenance
    ) {
      // We send this early let Teams know we're ok. We'll do the rest in the background.
      Response.sendEmptySuccessResponse(req, res);

      try {
        // Implementation for creating new scheduled maintenance
        logger.debug(
          "Microsoft Teams scheduled maintenance submission implementation",
        );
      } catch (error) {
        logger.error(error);
      }
    }
  }

  @CaptureSpan()
  public static async viewNewScheduledMaintenanceModal(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const blocks: Array<WorkspaceMessageBlock> = [];

    // Send response to clear the action
    Response.sendTextResponse(data.req, data.res, "");

    const scheduledMaintenanceTitle: WorkspaceTextBoxBlock = {
      _type: "WorkspaceTextBoxBlock",
      label: "Event Title",
      blockId: "scheduledMaintenanceTitle",
      placeholder: "Scheduled Maintenance Title",
      initialValue: data.action.actionValue || "",
    };

    blocks.push(scheduledMaintenanceTitle);

    const scheduledMaintenanceDescription: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: "Event Description",
      blockId: "scheduledMaintenanceDescription",
      placeholder: "Scheduled Maintenance Description",
    };

    blocks.push(scheduledMaintenanceDescription);

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Create Scheduled Maintenance",
      submitButtonTitle: "Create",
      cancelButtonTitle: "Cancel",
      actionId: MicrosoftTeamsActionType.SubmitNewScheduledMaintenance,
      actionValue: "",
      blocks: blocks,
    };

    await MicrosoftTeamsUtil.showModalToUser({
      authToken: data.teamsRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.teamsRequest.triggerId!,
    });
  }

  @CaptureSpan()
  public static async markScheduledMaintenanceAsOngoing(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, req, res } = data;
    const { userId, projectAuthToken, teamsUsername } = teamsRequest;

    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    if (!userId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User ID"),
      );
    }

    if (!projectAuthToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project Auth Token"),
      );
    }

    if (
      data.action.actionType ===
      MicrosoftTeamsActionType.MarkScheduledMaintenanceAsOngoing
    ) {
      const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);

      // Send early response to Teams to acknowledge the action
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyOngoing: boolean =
        await ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
          scheduledMaintenanceId: scheduledMaintenanceId,
        });

      if (isAlreadyOngoing) {
        const scheduledMaintenanceNumber: number | null =
          await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
            scheduledMaintenanceId: scheduledMaintenanceId,
          });

        // Send a direct message to the user that the maintenance is already ongoing
        const markdownPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${teamsUsername}, unfortunately you cannot change the state to ongoing because the **[Scheduled Maintenance ${scheduledMaintenanceNumber?.toString()}](${await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(teamsRequest.projectId!, scheduledMaintenanceId)})** is already in ongoing state.`,
        };

        await MicrosoftTeamsUtil.sendDirectMessageToUser({
          messageBlocks: [markdownPayload],
          authToken: projectAuthToken,
          workspaceUserId: teamsRequest.teamsUserId!,
        });

        return;
      }

      await ScheduledMaintenanceService.markScheduledMaintenanceAsOngoing(
        scheduledMaintenanceId,
        userId,
      );

      // Log the button interaction
      if (teamsRequest.projectId) {
        try {
          const logData: {
            projectId: ObjectID;
            workspaceType: WorkspaceType;
            channelId?: string;
            userId: ObjectID;
            buttonAction: string;
            scheduledMaintenanceId?: ObjectID;
          } = {
            projectId: teamsRequest.projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
            userId: userId,
            buttonAction: "mark_scheduled_maintenance_as_ongoing",
          };

          if (teamsRequest.teamsChannelId) {
            logData.channelId = teamsRequest.teamsChannelId;
          }
          logData.scheduledMaintenanceId = scheduledMaintenanceId;

          await WorkspaceNotificationLogService.logButtonPressed(logData, {
            isRoot: true,
          });
        } catch (err) {
          logger.error("Error logging button interaction:");
          logger.error(err);
          // Don't throw the error, just log it so the main flow continues
        }
      }

      // Scheduled Maintenance Feed will send a message to the channel that the maintenance has been marked as ongoing.
      return;
    }

    // Invalid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  @CaptureSpan()
  public static async resolveScheduledMaintenance(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, req, res } = data;
    const { userId, projectAuthToken, teamsUsername } = teamsRequest;

    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    if (!userId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User ID"),
      );
    }

    if (!projectAuthToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project Auth Token"),
      );
    }

    if (
      data.action.actionType ===
      MicrosoftTeamsActionType.MarkScheduledMaintenanceAsComplete
    ) {
      const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);

      // Send early response to Teams to acknowledge the action
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean =
        await ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
          scheduledMaintenanceId: scheduledMaintenanceId,
        });

      if (isAlreadyResolved) {
        const scheduledMaintenanceNumber: number | null =
          await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
            scheduledMaintenanceId: scheduledMaintenanceId,
          });

        // Send a direct message to the user that the maintenance is already resolved
        const markdownPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${teamsUsername}, unfortunately you cannot resolve the **[Scheduled Maintenance ${scheduledMaintenanceNumber?.toString()}](${await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(teamsRequest.projectId!, scheduledMaintenanceId)})**. It has already been resolved.`,
        };

        await MicrosoftTeamsUtil.sendDirectMessageToUser({
          messageBlocks: [markdownPayload],
          authToken: projectAuthToken,
          workspaceUserId: teamsRequest.teamsUserId!,
        });

        return;
      }

      await ScheduledMaintenanceService.markScheduledMaintenanceAsComplete(
        scheduledMaintenanceId,
        userId,
      );

      // Log the button interaction
      if (teamsRequest.projectId) {
        try {
          const logData: {
            projectId: ObjectID;
            workspaceType: WorkspaceType;
            channelId?: string;
            userId: ObjectID;
            buttonAction: string;
            scheduledMaintenanceId?: ObjectID;
          } = {
            projectId: teamsRequest.projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
            userId: userId,
            buttonAction: "mark_scheduled_maintenance_as_complete",
          };

          if (teamsRequest.teamsChannelId) {
            logData.channelId = teamsRequest.teamsChannelId;
          }
          logData.scheduledMaintenanceId = scheduledMaintenanceId;

          await WorkspaceNotificationLogService.logButtonPressed(logData, {
            isRoot: true,
          });
        } catch (err) {
          logger.error("Error logging button interaction:");
          logger.error(err);
          // Don't throw the error, just log it so the main flow continues
        }
      }

      // Scheduled Maintenance Feed will send a message to the channel that the maintenance has been completed.
      return;
    }

    // Invalid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  @CaptureSpan()
  public static async viewChangeScheduledMaintenanceState(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { req, res } = data;
    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    const scheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
      await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates({
        projectId: data.teamsRequest.projectId!,
        props: {
          isRoot: true,
        },
      });

    const dropdownOptions: Array<DropdownOption> = scheduledMaintenanceStates
      .map((state: ScheduledMaintenanceState) => {
        return {
          label: state.name || "",
          value: state._id?.toString() || "",
        };
      })
      .filter((option: DropdownOption) => {
        return option.label !== "" || option.value !== "";
      });

    const statePickerDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Scheduled Maintenance State",
      blockId: "scheduledMaintenanceState",
      placeholder: "Select Scheduled Maintenance State",
      options: dropdownOptions,
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Change Event State",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: MicrosoftTeamsActionType.SubmitChangeScheduledMaintenanceState,
      actionValue: actionValue,
      blocks: [statePickerDropdown],
    };

    await MicrosoftTeamsUtil.showModalToUser({
      authToken: data.teamsRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.teamsRequest.triggerId!,
    });
  }

  @CaptureSpan()
  public static async submitChangeScheduledMaintenanceState(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { req, res } = data;
    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    if (
      !data.teamsRequest.viewValues ||
      !data.teamsRequest.viewValues["scheduledMaintenanceState"]
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);
    const stateString: string =
      data.teamsRequest.viewValues["scheduledMaintenanceState"].toString();

    const stateId: ObjectID = new ObjectID(stateString);

    await ScheduledMaintenanceService.updateOneById({
      id: scheduledMaintenanceId,
      data: {
        currentScheduledMaintenanceStateId: stateId,
      },
      props:
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: data.teamsRequest.userId!,
            projectId: data.teamsRequest.projectId!,
          },
        ),
    });
  }

  @CaptureSpan()
  public static async submitScheduledMaintenanceNote(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { req, res } = data;
    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    // If view values is empty, then return error
    if (!data.teamsRequest.viewValues) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    if (!data.teamsRequest.viewValues["noteType"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note Type"),
      );
    }

    if (!data.teamsRequest.viewValues["note"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note"),
      );
    }

    const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);
    const note: string = data.teamsRequest.viewValues["note"].toString();
    const noteType: string =
      data.teamsRequest.viewValues["noteType"].toString();

    if (noteType !== "public" && noteType !== "private") {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note Type"),
      );
    }

    // Send empty response
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // If public note then, add a note
    if (noteType === "public") {
      await ScheduledMaintenancePublicNoteService.addNote({
        scheduledMaintenanceId: scheduledMaintenanceId!,
        note: note || "",
        projectId: data.teamsRequest.projectId!,
        userId: data.teamsRequest.userId!,
      });
    }

    // If private note then, add a note
    if (noteType === "private") {
      await ScheduledMaintenanceInternalNoteService.addNote({
        scheduledMaintenanceId: scheduledMaintenanceId!,
        note: note || "",
        projectId: data.teamsRequest.projectId!,
        userId: data.teamsRequest.userId!,
      });
    }
  }

  @CaptureSpan()
  public static async viewAddScheduledMaintenanceNote(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { req, res } = data;
    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);

    const noteTypeOptions: Array<DropdownOption> = [
      {
        label: "Public Note",
        value: "public",
      },
      {
        label: "Private Note",
        value: "private",
      },
    ];

    const noteTypeDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      blockId: "noteType",
      label: "Note Type",
      placeholder: "Please select note type...",
      options: noteTypeOptions,
    };

    const noteTextArea: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      blockId: "note",
      label: "Note",
      placeholder: "Please add a note...",
    };

    const modal: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Add Note",
      actionId: MicrosoftTeamsActionType.SubmitScheduledMaintenanceNote,
      actionValue: scheduledMaintenanceId.toString(),
      submitButtonTitle: "Add Note",
      cancelButtonTitle: "Cancel",
      blocks: [noteTypeDropdown, noteTextArea],
    };

    Response.sendJsonObjectResponse(req, res, modal as any);
  }

  @CaptureSpan()
  public static async handleScheduledMaintenanceAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action } = data;

    switch (action.actionType) {
      case MicrosoftTeamsActionType.MarkScheduledMaintenanceAsOngoing:
        await this.markScheduledMaintenanceAsOngoing(data);
        break;

      case MicrosoftTeamsActionType.MarkScheduledMaintenanceAsComplete:
        await this.resolveScheduledMaintenance(data);
        break;

      case MicrosoftTeamsActionType.ViewAddScheduledMaintenanceNote:
        await this.viewAddScheduledMaintenanceNote(data);
        break;

      case MicrosoftTeamsActionType.SubmitScheduledMaintenanceNote:
        await this.submitScheduledMaintenanceNote(data);
        break;

      case MicrosoftTeamsActionType.ViewChangeScheduledMaintenanceState:
        await this.viewChangeScheduledMaintenanceState(data);
        break;

      case MicrosoftTeamsActionType.SubmitChangeScheduledMaintenanceState:
        await this.submitChangeScheduledMaintenanceState(data);
        break;

      case MicrosoftTeamsActionType.ViewScheduledMaintenance:
        // View action doesn't need implementation as it's handled by notification display
        Response.sendEmptySuccessResponse(data.req, data.res);
        break;

      case MicrosoftTeamsActionType.NewScheduledMaintenance:
        await this.viewNewScheduledMaintenanceModal(data);
        break;

      case MicrosoftTeamsActionType.SubmitNewScheduledMaintenance:
        await this.submitNewScheduledMaintenance(data);
        break;

      default:
        logger.debug(
          `Unhandled Microsoft Teams scheduled maintenance action: ${action.actionType}`,
        );
        Response.sendEmptySuccessResponse(data.req, data.res);
    }
  }
}
