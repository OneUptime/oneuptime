import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import AlertService from "../../../../Services/AlertService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsUtil from "../MicrosoftTeams";
import MicrosoftTeamsActionType from "./ActionTypes";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import Response from "../../../Response";
import {
  WorkspaceDropdownBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import AlertInternalNoteService from "../../../../Services/AlertInternalNoteService";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";
import AlertStateService from "../../../../Services/AlertStateService";
import AlertInternalNote from "../../../../../Models/DatabaseModels/AlertInternalNote";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsAlertActions {
  @CaptureSpan()
  public static isAlertAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.AcknowledgeAlert:
      case MicrosoftTeamsActionType.ResolveAlert:
      case MicrosoftTeamsActionType.ViewAddAlertNote:
      case MicrosoftTeamsActionType.SubmitAlertNote:
      case MicrosoftTeamsActionType.ViewChangeAlertState:
      case MicrosoftTeamsActionType.SubmitChangeAlertState:
      case MicrosoftTeamsActionType.ViewExecuteAlertOnCallPolicy:
      case MicrosoftTeamsActionType.SubmitExecuteAlertOnCallPolicy:
      case MicrosoftTeamsActionType.ViewAlert:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async acknowledgeAlert(data: {
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
        new BadDataException("Invalid Alert ID"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    const alertId: ObjectID = new ObjectID(actionValue);

    // Check if already acknowledged
    const isAlreadyAcknowledged: boolean =
      await AlertService.isAlertAcknowledged({
        alertId: alertId,
      });

    if (isAlreadyAcknowledged) {
      const markdownPayload: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `Alert has already been acknowledged.`,
      };

      await MicrosoftTeamsUtil.sendDirectMessageToUser({
        messageBlocks: [markdownPayload],
        authToken: data.teamsRequest.projectAuthToken!,
        workspaceUserId: data.teamsRequest.teamsUserId!,
      });
      return;
    }

    // Acknowledge the alert
    await AlertService.acknowledgeAlert(alertId, data.teamsRequest.userId!);
  }

  @CaptureSpan()
  public static async resolveAlert(data: {
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
        new BadDataException("Invalid Alert ID"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    const alertId: ObjectID = new ObjectID(actionValue);

    // Check if already resolved
    const isAlreadyResolved: boolean =
      await AlertService.isAlertResolved({
        alertId: alertId,
      });

    if (isAlreadyResolved) {
      const markdownPayload: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `Alert has already been resolved.`,
      };

      await MicrosoftTeamsUtil.sendDirectMessageToUser({
        messageBlocks: [markdownPayload],
        authToken: data.teamsRequest.projectAuthToken!,
        workspaceUserId: data.teamsRequest.teamsUserId!,
      });
      return;
    }

    // Resolve the alert
    await AlertService.resolveAlert(alertId, data.teamsRequest.userId!);
  }

  @CaptureSpan()
  public static async viewExecuteOnCallPolicy(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Implementation for viewing execute on-call policy modal
    logger.debug("Microsoft Teams view execute on-call policy implementation");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async viewChangeAlertState(data: {
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
        new BadDataException("Invalid Alert ID"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    const alertStates: Array<AlertState> = await AlertStateService.findBy({
      query: {
        projectId: data.teamsRequest.projectId!,
      },
      select: {
        name: true,
        color: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

    const dropdownOptions: Array<DropdownOption> = alertStates
      .map((state: AlertState) => {
        return {
          label: state.name || "",
          value: state._id?.toString() || "",
        };
      })
      .filter((option: DropdownOption) => {
        return option.label !== "" && option.value !== "";
      });

    const statePickerDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Alert State",
      blockId: "alertState",
      placeholder: "Select Alert State",
      options: dropdownOptions,
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Change Alert State",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: MicrosoftTeamsActionType.SubmitChangeAlertState,
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
  public static async submitChangeAlertState(data: {
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
        new BadDataException("Invalid Alert ID"),
      );
    }

    if (!data.teamsRequest.viewValues) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    const alertStateId: string | undefined = data.teamsRequest.viewValues["alertState"]?.toString();

    if (!alertStateId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Alert State is required"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    const alertId: ObjectID = new ObjectID(actionValue);
    const stateId: ObjectID = new ObjectID(alertStateId);

    // Update alert state
    await AlertService.updateOneById({
      id: alertId,
      data: {
        currentAlertStateId: stateId,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public static async executeOnCallPolicy(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Implementation for executing on-call policy
    logger.debug("Microsoft Teams execute on-call policy implementation");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async submitAlertNote(data: {
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
        new BadDataException("Invalid Alert ID"),
      );
    }

    if (!data.teamsRequest.viewValues) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    const noteContent: string | undefined = data.teamsRequest.viewValues["alertNote"]?.toString();

    if (!noteContent) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Note content is required"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    const alertId: ObjectID = new ObjectID(actionValue);

    // Create internal note for alert
    const internalNote: AlertInternalNote = new AlertInternalNote();
    internalNote.alertId = alertId;
    internalNote.note = noteContent;
    internalNote.projectId = data.teamsRequest.projectId!;
    internalNote.createdByUserId = data.teamsRequest.userId!;

    await AlertInternalNoteService.create({
      data: internalNote,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public static async viewAddAlertNote(data: {
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
        new BadDataException("Invalid Alert ID"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    const noteTextArea: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: "Note Content",
      blockId: "alertNote",
      placeholder: "Enter note content here...",
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Add Alert Note",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: MicrosoftTeamsActionType.SubmitAlertNote,
      actionValue: actionValue,
      blocks: [noteTextArea],
    };

    await MicrosoftTeamsUtil.showModalToUser({
      authToken: data.teamsRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.teamsRequest.triggerId!,
    });
  }

  @CaptureSpan()
  public static async handleAlertAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action } = data;

    switch (action.actionType) {
      case MicrosoftTeamsActionType.AcknowledgeAlert:
        await this.acknowledgeAlert(data);
        break;

      case MicrosoftTeamsActionType.ResolveAlert:
        await this.resolveAlert(data);
        break;

      case MicrosoftTeamsActionType.ViewExecuteAlertOnCallPolicy:
        await this.viewExecuteOnCallPolicy(data);
        break;

      case MicrosoftTeamsActionType.SubmitExecuteAlertOnCallPolicy:
        await this.executeOnCallPolicy(data);
        break;

      case MicrosoftTeamsActionType.ViewChangeAlertState:
        await this.viewChangeAlertState(data);
        break;

      case MicrosoftTeamsActionType.SubmitChangeAlertState:
        await this.submitChangeAlertState(data);
        break;

      case MicrosoftTeamsActionType.ViewAddAlertNote:
        await this.viewAddAlertNote(data);
        break;

      case MicrosoftTeamsActionType.SubmitAlertNote:
        await this.submitAlertNote(data);
        break;

      case MicrosoftTeamsActionType.ViewAlert:
        // View action doesn't need implementation as it's handled by notification display
        Response.sendEmptySuccessResponse(data.req, data.res);
        break;

      default:
        logger.debug(`Unhandled Microsoft Teams alert action: ${action.actionType}`);
        Response.sendEmptySuccessResponse(data.req, data.res);
    }
  }
}
