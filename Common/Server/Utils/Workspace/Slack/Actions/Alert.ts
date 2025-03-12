import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import AlertService from "../../../../Services/AlertService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import SlackUtil from "../Slack";
import SlackActionType from "./ActionTypes";
import { SlackAction, SlackRequest } from "./Auth";
import Response from "../../../Response";
import {
  WorkspaceDropdownBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import AlertInternalNoteService from "../../../../Services/AlertInternalNoteService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";
import AlertStateService from "../../../../Services/AlertStateService";
import logger from "../../../Logger";

export default class SlackAlertActions {
  public static isAlertAction(data: { actionType: SlackActionType }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case SlackActionType.AcknowledgeAlert:
      case SlackActionType.ResolveAlert:
      case SlackActionType.ViewAddAlertNote:
      case SlackActionType.SubmitAlertNote:
      case SlackActionType.ViewChangeAlertState:
      case SlackActionType.SubmitChangeAlertState:
      case SlackActionType.ViewExecuteAlertOnCallPolicy:
      case SlackActionType.SubmitExecuteAlertOnCallPolicy:
      case SlackActionType.ViewAlert:
        return true;
      default:
        return false;
    }
  }

  public static async acknowledgeAlert(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { botUserId, userId, projectAuthToken, slackUsername } = slackRequest;

    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Alert ID"),
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

    if (!botUserId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Bot User ID"),
      );
    }

    if (data.action.actionType === SlackActionType.AcknowledgeAlert) {
      const alertId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyAcknowledged: boolean =
        await AlertService.isAlertAcknowledged({
          alertId: alertId,
        });

      if (isAlreadyAcknowledged) {
        const alertNumber: number | null = await AlertService.getAlertNumber({
          alertId: alertId,
        });

        // send a message to the channel visible to user, that the alert has already been acknowledged.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot acknowledge the **[Alert ${alertNumber?.toString()}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been acknowledged.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await AlertService.acknowledgeAlert(alertId, userId);

      // Alert Feed will send a message to the channel that the alert has been Acknowledged.
      return;
    }

    // invlaid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  public static async resolveAlert(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { botUserId, userId, projectAuthToken, slackUsername } = slackRequest;

    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Alert ID"),
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

    if (!botUserId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Bot User ID"),
      );
    }

    if (data.action.actionType === SlackActionType.ResolveAlert) {
      const alertId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean = await AlertService.isAlertResolved({
        alertId: alertId,
      });

      if (isAlreadyResolved) {
        const alertNumber: number | null = await AlertService.getAlertNumber({
          alertId: alertId,
        });
        // send a message to the channel visible to user, that the alert has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot resolve the **[Alert ${alertNumber?.toString()}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been resolved.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await AlertService.resolveAlert(alertId, userId);

      return;
    }

    // invlaid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  public static async viewExecuteOnCallPolicy(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const alertId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    const onCallPolicies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {
          projectId: data.slackRequest.projectId!,
        },
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const dropdownOption: Array<DropdownOption> = onCallPolicies
      .map((policy: OnCallDutyPolicy) => {
        return {
          label: policy.name || "",
          value: policy._id?.toString() || "",
        };
      })
      .filter((option: DropdownOption) => {
        return option.label !== "" || option.value !== "";
      });

    const onCallPolicyDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "On Call Policy",
      blockId: "onCallPolicy",
      placeholder: "Select On Call Policy",
      options: dropdownOption,
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Execute On Call Policy",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitExecuteAlertOnCallPolicy,
      actionValue: actionValue,
      blocks: [onCallPolicyDropdown],
    };

    await SlackUtil.showModalToUser({
      authToken: data.slackRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.slackRequest.triggerId!,
    });
  }

  public static async viewChangeAlertState(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const alertId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    const alertStates: Array<AlertState> =
      await AlertStateService.getAllAlertStates({
        projectId: data.slackRequest.projectId!,
        props: {
          isRoot: true,
        },
      });

    logger.debug("Alert States: ");
    logger.debug(alertStates);

    const dropdownOptions: Array<DropdownOption> = alertStates
      .map((state: AlertState) => {
        return {
          label: state.name || "",
          value: state._id?.toString() || "",
        };
      })
      .filter((option: DropdownOption) => {
        return option.label !== "" || option.value !== "";
      });

    logger.debug("Dropdown Options: ");
    logger.debug(dropdownOptions);

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
      actionId: SlackActionType.SubmitChangeAlertState,
      actionValue: actionValue,
      blocks: [statePickerDropdown],
    };

    await SlackUtil.showModalToUser({
      authToken: data.slackRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.slackRequest.triggerId!,
    });
  }

  public static async submitChangeAlertState(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const alertId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    if (
      !data.slackRequest.viewValues ||
      !data.slackRequest.viewValues["alertState"]
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    const alertId: ObjectID = new ObjectID(actionValue);
    const stateString: string =
      data.slackRequest.viewValues["alertState"].toString();

    const stateId: ObjectID = new ObjectID(stateString);

    await AlertService.updateOneById({
      id: alertId,
      data: {
        currentAlertStateId: stateId,
      },
      props: {
        userId: data.slackRequest.userId!,
        isRoot: true,
        tenantId: data.slackRequest.projectId!
      },
    });
  }

  public static async executeOnCallPolicy(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { botUserId, userId, projectAuthToken, slackUsername } = slackRequest;

    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Alert ID"),
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

    if (!botUserId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Bot User ID"),
      );
    }

    if (
      data.action.actionType === SlackActionType.SubmitExecuteAlertOnCallPolicy
    ) {
      const alertId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean = await AlertService.isAlertResolved({
        alertId: alertId,
      });

      if (isAlreadyResolved) {
        const alertNumber: number | null = await AlertService.getAlertNumber({
          alertId: alertId,
        });
        // send a message to the channel visible to user, that the alert has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot execute the on call policy for **[Alert ${alertNumber?.toString()}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been resolved.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      if (
        !data.slackRequest.viewValues ||
        !data.slackRequest.viewValues["onCallPolicy"]
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid View Values"),
        );
      }

      const onCallPolicyString: string =
        data.slackRequest.viewValues["onCallPolicy"].toString();

      // get the on call policy id.
      const onCallPolicyId: ObjectID = new ObjectID(onCallPolicyString);

      await OnCallDutyPolicyService.executePolicy(onCallPolicyId, {
        triggeredByAlertId: alertId,
        userNotificationEventType: UserNotificationEventType.AlertCreated,
      });
    }
  }

  public static async submitAlertNote(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // const alertId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    // if view values is empty, then return error.

    if (!data.slackRequest.viewValues) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    if (!data.slackRequest.viewValues["note"]) {
      // return error.
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note"),
      );
    }

    const alertId: ObjectID = new ObjectID(actionValue);
    const note: string = data.slackRequest.viewValues["note"].toString();

    // send empty response.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    await AlertInternalNoteService.addNote({
      alertId: alertId!,
      note: note || "",
      projectId: data.slackRequest.projectId!,
      userId: data.slackRequest.userId!,
    });
  }

  public static async viewAddAlertNote(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const alertId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    const noteTextArea: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: "Note",
      blockId: "note",
      placeholder: "Note",
      description: "Please type in plain text or markdown.",
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Add Note",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitAlertNote,
      actionValue: actionValue,
      blocks: [noteTextArea],
    };

    await SlackUtil.showModalToUser({
      authToken: data.slackRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.slackRequest.triggerId!,
    });
  }

  public static async handleAlertAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // now we should be all set, project is authorized and user is authorized. Lets perform some actions based on the action type.
    const actionType: SlackActionType | undefined = data.action.actionType;

    if (actionType === SlackActionType.AcknowledgeAlert) {
      return await this.acknowledgeAlert(data);
    }

    if (actionType === SlackActionType.ResolveAlert) {
      return await this.resolveAlert(data);
    }

    if (actionType === SlackActionType.ViewAddAlertNote) {
      return await this.viewAddAlertNote(data);
    }

    if (actionType === SlackActionType.SubmitAlertNote) {
      return await this.submitAlertNote(data);
    }

    if (actionType === SlackActionType.ViewExecuteAlertOnCallPolicy) {
      return await this.viewExecuteOnCallPolicy(data);
    }

    if (actionType === SlackActionType.SubmitExecuteAlertOnCallPolicy) {
      return await this.executeOnCallPolicy(data);
    }

    if (actionType === SlackActionType.ViewChangeAlertState) {
      return await this.viewChangeAlertState(data);
    }

    if (actionType === SlackActionType.SubmitChangeAlertState) {
      return await this.submitChangeAlertState(data);
    }

    if (actionType === SlackActionType.ViewAlert) {
      // do nothing. This is just a view alert action.
      // clear response.
      return Response.sendJsonObjectResponse(data.req, data.res, {
        response_action: "clear",
      });
    }

    // invalid action type.
    return Response.sendErrorResponse(
      data.req,
      data.res,
      new BadDataException("Invalid Action Type"),
    );
  }
}
