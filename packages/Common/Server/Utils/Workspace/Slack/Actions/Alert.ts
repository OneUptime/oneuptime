import SlackReactionNoteActions, { SlackReactionData } from "./ReactionNote";
import { WorkspaceNoteResourceType } from "../../WorkspaceReactionNote";
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
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import AlertStateTimeline from "../../../../../Models/DatabaseModels/AlertStateTimeline";
import AlertInternalNote from "../../../../../Models/DatabaseModels/AlertInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SlackActionAuthorization from "./Authorization";

export default class SlackAlertActions {
  @CaptureSpan()
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

  @CaptureSpan()
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

      if (
        !(await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: AlertStateTimeline,
          action: "acknowledge this alert",
          resources: [{ service: AlertService, id: alertId }],
        }))
      ) {
        return;
      }

      const isAlreadyAcknowledged: boolean =
        await AlertService.isAlertAcknowledged({
          alertId: alertId,
        });

      if (isAlreadyAcknowledged) {
        const alertNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await AlertService.getAlertNumber({
          alertId: alertId,
        });

        // send a message to the channel visible to user, that the alert has already been acknowledged.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot acknowledge the **[Alert ${alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been acknowledged.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await AlertService.acknowledgeAlert(alertId, userId);

      // Log the button interaction
      if (slackRequest.projectId) {
        try {
          const logData: {
            projectId: ObjectID;
            workspaceType: WorkspaceType;
            channelId?: string;
            userId: ObjectID;
            buttonAction: string;
            alertId?: ObjectID;
          } = {
            projectId: slackRequest.projectId,
            workspaceType: WorkspaceType.Slack,
            userId: userId,
            buttonAction: "acknowledge_alert",
          };

          if (slackRequest.slackChannelId) {
            logData.channelId = slackRequest.slackChannelId;
          }
          logData.alertId = alertId;

          await WorkspaceNotificationLogService.logButtonPressed(logData, {
            isRoot: true,
          });
        } catch (err) {
          logger.error("Error logging button interaction:", {
            projectId: slackRequest.projectId?.toString(),
          });
          logger.error(err);
          // Don't throw the error, just log it so the main flow continues
        }
      }

      // Alert Feed will send a message to the channel that the alert has been Acknowledged.
      return;
    }

    // invalid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  @CaptureSpan()
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

      if (
        !(await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: AlertStateTimeline,
          action: "resolve this alert",
          resources: [{ service: AlertService, id: alertId }],
        }))
      ) {
        return;
      }

      const isAlreadyResolved: boolean = await AlertService.isAlertResolved({
        alertId: alertId,
      });

      if (isAlreadyResolved) {
        const alertNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await AlertService.getAlertNumber({
          alertId: alertId,
        });
        // send a message to the channel visible to user, that the alert has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot resolve the **[Alert ${alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been resolved.`,
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

    // invalid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  @CaptureSpan()
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

    if (dropdownOption.length === 0) {
      if (data.slackRequest.slackChannelId) {
        await SlackUtil.sendEphemeralMessageToChannel({
          messageBlocks: [
            {
              _type: "WorkspacePayloadMarkdown",
              text: "No on-call policies have been configured for this project yet. Please add an on-call policy in the OneUptime Dashboard under On-Call Duty > Policies to use this feature.",
            } as WorkspacePayloadMarkdown,
          ],
          authToken: data.slackRequest.projectAuthToken!,
          channelId: data.slackRequest.slackChannelId,
          userId: data.slackRequest.slackUserId!,
        });
      }
      return;
    }

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

  @CaptureSpan()
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

    logger.debug("Alert States: ", {
      projectId: data.slackRequest.projectId?.toString(),
    });
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

  @CaptureSpan()
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

    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: AlertStateTimeline,
        action: "change the state of this alert",
        resources: [{ service: AlertService, id: alertId }],
      });

    if (!props) {
      return;
    }

    await AlertService.updateOneById({
      id: alertId,
      data: {
        currentAlertStateId: stateId,
      },
      props: props,
    });

    // Log the button interaction
    if (data.slackRequest.projectId && data.slackRequest.userId) {
      try {
        const logData: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          channelId?: string;
          userId: ObjectID;
          buttonAction: string;
          alertId?: ObjectID;
        } = {
          projectId: data.slackRequest.projectId,
          workspaceType: WorkspaceType.Slack,
          userId: data.slackRequest.userId,
          buttonAction: "change_alert_state",
        };

        if (data.slackRequest.slackChannelId) {
          logData.channelId = data.slackRequest.slackChannelId;
        }
        logData.alertId = alertId;

        await WorkspaceNotificationLogService.logButtonPressed(logData, {
          isRoot: true,
        });
      } catch (err) {
        logger.error("Error logging button interaction:", {
          projectId: data.slackRequest.projectId?.toString(),
          alertId: alertId.toString(),
        });
        logger.error(err);
        // Don't throw the error, just log it so the main flow continues
      }
    }
  }

  @CaptureSpan()
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

      // get the on-call policy id.
      const onCallPolicyId: ObjectID = new ObjectID(onCallPolicyString);

      if (
        !(await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: OnCallDutyPolicyExecutionLog,
          action: "execute an on-call policy for this alert",
          resources: [
            { service: AlertService, id: alertId },
            { service: OnCallDutyPolicyService, id: onCallPolicyId },
          ],
        }))
      ) {
        return;
      }

      const isAlreadyResolved: boolean = await AlertService.isAlertResolved({
        alertId: alertId,
      });

      if (isAlreadyResolved) {
        const alertNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await AlertService.getAlertNumber({
          alertId: alertId,
        });
        // send a message to the channel visible to user, that the alert has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot execute the on-call policy for **[Alert ${alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been resolved.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await OnCallDutyPolicyService.executePolicy(onCallPolicyId, {
        triggeredByAlertId: alertId,
        userNotificationEventType: UserNotificationEventType.AlertCreated,
      });
    }
  }

  @CaptureSpan()
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

    if (
      !(await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: AlertInternalNote,
        action: "add a private note to this alert",
        resources: [{ service: AlertService, id: alertId }],
      }))
    ) {
      return;
    }

    await AlertInternalNoteService.addNote({
      alertId: alertId!,
      note: note || "",
      projectId: data.slackRequest.projectId!,
      userId: data.slackRequest.userId!,
    });
  }

  @CaptureSpan()
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

  @CaptureSpan()
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
      /*
       * do nothing. This is just a view alert action.
       * clear response.
       */
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

  /*
   * A note emoji on a message, looked up among alert channels only.
   * Slack events go to SlackReactionNoteActions directly, which works out
   * what the channel belongs to first.
   */
  @CaptureSpan()
  public static async handleEmojiReaction(
    data: SlackReactionData,
  ): Promise<void> {
    await SlackReactionNoteActions.handleEmojiReaction({
      ...data,
      resourceTypes: [WorkspaceNoteResourceType.Alert],
    });
  }
}
