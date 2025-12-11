import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import AlertService from "../../../../Services/AlertService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import SlackUtil from "../Slack";
import SlackActionType, { PrivateNoteEmojis } from "./ActionTypes";
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
import AccessTokenService from "../../../../Services/AccessTokenService";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";

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
          logger.error("Error logging button interaction:");
          logger.error(err);
          // Don't throw the error, just log it so the main flow continues
        }
      }

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

    await AlertService.updateOneById({
      id: alertId,
      data: {
        currentAlertStateId: stateId,
      },
      props:
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: data.slackRequest.userId!,
            projectId: data.slackRequest.projectId!,
          },
        ),
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
        logger.error("Error logging button interaction:");
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
          text: `@${slackUsername}, unfortunately you cannot execute the on-call policy for **[Alert ${alertNumber?.toString()}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been resolved.`,
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

      // get the on-call policy id.
      const onCallPolicyId: ObjectID = new ObjectID(onCallPolicyString);

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

  @CaptureSpan()
  public static async handleEmojiReaction(data: {
    teamId: string;
    reaction: string;
    userId: string;
    channelId: string;
    messageTs: string;
  }): Promise<void> {
    logger.debug("Handling emoji reaction for Alert with data:");
    logger.debug(data);

    const { teamId, reaction, userId, channelId, messageTs } = data;

    // Alerts only support private notes, so only pushpin emojis work
    const isPrivateNoteEmoji: boolean = PrivateNoteEmojis.includes(reaction);

    if (!isPrivateNoteEmoji) {
      logger.debug(
        `Emoji "${reaction}" is not a supported private note emoji for alerts. Ignoring.`,
      );
      return;
    }

    // Get the project auth token using the team ID
    const projectAuth =
      await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          workspaceProjectId: teamId,
        },
        select: {
          projectId: true,
          authToken: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!projectAuth || !projectAuth.projectId || !projectAuth.authToken) {
      logger.debug("No project auth found for team ID. Ignoring emoji reaction.");
      return;
    }

    const projectId: ObjectID = projectAuth.projectId;
    const authToken: string = projectAuth.authToken;

    // Find the alert linked to this channel
    const workspaceLog: WorkspaceNotificationLog | null =
      await WorkspaceNotificationLogService.findOneBy({
        query: {
          channelId: channelId,
          workspaceType: WorkspaceType.Slack,
          projectId: projectId,
        },
        select: {
          alertId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!workspaceLog || !workspaceLog.alertId) {
      logger.debug(
        "No alert found linked to this channel. Ignoring emoji reaction.",
      );
      return;
    }

    const alertId: ObjectID = workspaceLog.alertId;

    // Get the alert number for the confirmation message
    const alertNumber: number | null =
      await AlertService.getAlertNumber({
        alertId: alertId,
      });

    // Get the user ID in OneUptime based on Slack user ID
    const userAuth = await WorkspaceUserAuthTokenService.findOneBy({
      query: {
        workspaceUserId: userId,
        workspaceType: WorkspaceType.Slack,
        projectId: projectId,
      },
      select: {
        userId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!userAuth || !userAuth.userId) {
      logger.debug(
        "No OneUptime user found for Slack user. Ignoring emoji reaction.",
      );
      return;
    }

    const oneUptimeUserId: ObjectID = userAuth.userId;

    // Fetch the message text using the timestamp
    let messageText: string | null = null;
    try {
      messageText = await SlackUtil.getMessageByTimestamp({
        authToken: authToken,
        channelId: channelId,
        messageTs: messageTs,
      });
    } catch (err) {
      logger.error("Error fetching message text:");
      logger.error(err);
      return;
    }

    if (!messageText) {
      logger.debug("No message text found. Ignoring emoji reaction.");
      return;
    }

    // Save as private note (Alerts only support private notes)
    try {
      await AlertInternalNoteService.addNote({
        alertId: alertId,
        note: messageText,
        projectId: projectId,
        userId: oneUptimeUserId,
      });
      logger.debug("Private note added to alert successfully.");
    } catch (err) {
      logger.error("Error saving note:");
      logger.error(err);
      return;
    }

    // Send confirmation message as a reply to the original message thread
    try {
      const alertLink: string = (
        await AlertService.getAlertLinkInDashboard(projectId, alertId)
      ).toString();

      const confirmationMessage: string =
        `✅ Message saved as *private note* to <${alertLink}|Alert #${alertNumber}>.`;

      await SlackUtil.sendMessageToThread({
        authToken: authToken,
        channelId: channelId,
        threadTs: messageTs,
        text: confirmationMessage,
      });

      logger.debug("Confirmation message sent successfully.");
    } catch (err) {
      logger.error("Error sending confirmation message:");
      logger.error(err);
      // Don't throw - note was saved successfully, confirmation is best effort
    }
  }
}
