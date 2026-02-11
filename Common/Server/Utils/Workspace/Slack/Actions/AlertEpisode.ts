import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import AlertEpisodeService from "../../../../Services/AlertEpisodeService";
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
import AlertEpisodeInternalNoteService from "../../../../Services/AlertEpisodeInternalNoteService";
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
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";

export default class SlackAlertEpisodeActions {
  @CaptureSpan()
  public static isAlertEpisodeAction(data: {
    actionType: SlackActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case SlackActionType.AcknowledgeAlertEpisode:
      case SlackActionType.ResolveAlertEpisode:
      case SlackActionType.ViewAddAlertEpisodeNote:
      case SlackActionType.SubmitAlertEpisodeNote:
      case SlackActionType.ViewChangeAlertEpisodeState:
      case SlackActionType.SubmitChangeAlertEpisodeState:
      case SlackActionType.ViewExecuteAlertEpisodeOnCallPolicy:
      case SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy:
      case SlackActionType.ViewAlertEpisode:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async acknowledgeAlertEpisode(data: {
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
        new BadDataException("Invalid Alert Episode ID"),
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

    if (data.action.actionType === SlackActionType.AcknowledgeAlertEpisode) {
      const episodeId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyAcknowledged: boolean =
        await AlertEpisodeService.isEpisodeAcknowledged({
          episodeId: episodeId,
        });

      if (isAlreadyAcknowledged) {
        // send a message to the channel visible to user, that the episode has already been acknowledged.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot acknowledge the **[Alert Episode](${await AlertEpisodeService.getEpisodeLinkInDashboard(slackRequest.projectId!, episodeId)})**. It has already been acknowledged.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await AlertEpisodeService.acknowledgeEpisode(episodeId, userId);

      // Log the button interaction
      if (slackRequest.projectId) {
        try {
          const logData: {
            projectId: ObjectID;
            workspaceType: WorkspaceType;
            channelId?: string;
            userId: ObjectID;
            buttonAction: string;
            alertEpisodeId?: ObjectID;
          } = {
            projectId: slackRequest.projectId,
            workspaceType: WorkspaceType.Slack,
            userId: userId,
            buttonAction: "acknowledge_alert_episode",
          };

          if (slackRequest.slackChannelId) {
            logData.channelId = slackRequest.slackChannelId;
          }
          logData.alertEpisodeId = episodeId;

          await WorkspaceNotificationLogService.logButtonPressed(logData, {
            isRoot: true,
          });
        } catch (err) {
          logger.error("Error logging button interaction:");
          logger.error(err);
          // Don't throw the error, just log it so the main flow continues
        }
      }

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
  public static async resolveAlertEpisode(data: {
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
        new BadDataException("Invalid Alert Episode ID"),
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

    if (data.action.actionType === SlackActionType.ResolveAlertEpisode) {
      const episodeId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean =
        await AlertEpisodeService.isEpisodeResolved(episodeId);

      if (isAlreadyResolved) {
        // send a message to the channel visible to user, that the episode has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot resolve the **[Alert Episode](${await AlertEpisodeService.getEpisodeLinkInDashboard(slackRequest.projectId!, episodeId)})**. It has already been resolved.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await AlertEpisodeService.resolveEpisode(episodeId, userId);

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
        new BadDataException("Invalid Alert Episode ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

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
      actionId: SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
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
  public static async viewChangeAlertEpisodeState(data: {
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
        new BadDataException("Invalid Alert Episode ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // Alert Episodes use the same alert states
    const alertStates: Array<AlertState> =
      await AlertStateService.getAllAlertStates({
        projectId: data.slackRequest.projectId!,
        props: {
          isRoot: true,
        },
      });

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

    const statePickerDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Episode State",
      blockId: "episodeState",
      placeholder: "Select Episode State",
      options: dropdownOptions,
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Change Episode State",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitChangeAlertEpisodeState,
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
  public static async submitChangeAlertEpisodeState(data: {
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
        new BadDataException("Invalid Alert Episode ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    if (
      !data.slackRequest.viewValues ||
      !data.slackRequest.viewValues["episodeState"]
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    const episodeId: ObjectID = new ObjectID(actionValue);
    const stateString: string =
      data.slackRequest.viewValues["episodeState"].toString();

    const stateId: ObjectID = new ObjectID(stateString);

    await AlertEpisodeService.changeEpisodeState({
      projectId: data.slackRequest.projectId!,
      episodeId: episodeId,
      alertStateId: stateId,
      notifyOwners: true,
      rootCause: "State changed via Slack.",
      props: {
        isRoot: true,
        userId: data.slackRequest.userId!,
      },
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
          alertEpisodeId?: ObjectID;
        } = {
          projectId: data.slackRequest.projectId,
          workspaceType: WorkspaceType.Slack,
          userId: data.slackRequest.userId,
          buttonAction: "change_alert_episode_state",
        };

        if (data.slackRequest.slackChannelId) {
          logData.channelId = data.slackRequest.slackChannelId;
        }
        logData.alertEpisodeId = episodeId;

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
        new BadDataException("Invalid Alert Episode ID"),
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
      data.action.actionType ===
      SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy
    ) {
      const episodeId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean =
        await AlertEpisodeService.isEpisodeResolved(episodeId);

      if (isAlreadyResolved) {
        // send a message to the channel visible to user, that the episode has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot execute the on-call policy for **[Alert Episode](${await AlertEpisodeService.getEpisodeLinkInDashboard(slackRequest.projectId!, episodeId)})**. It has already been resolved.`,
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
        triggeredByAlertEpisodeId: episodeId,
        userNotificationEventType: UserNotificationEventType.AlertCreated,
      });
    }
  }

  @CaptureSpan()
  public static async submitAlertEpisodeNote(data: {
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
        new BadDataException("Invalid Alert Episode ID"),
      );
    }

    if (!data.slackRequest.viewValues) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    if (!data.slackRequest.viewValues["note"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note"),
      );
    }

    const episodeId: ObjectID = new ObjectID(actionValue);
    const note: string = data.slackRequest.viewValues["note"].toString();

    // send empty response.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    await AlertEpisodeInternalNoteService.addNote({
      alertEpisodeId: episodeId!,
      note: note || "",
      projectId: data.slackRequest.projectId!,
      userId: data.slackRequest.userId!,
    });
  }

  @CaptureSpan()
  public static async viewAddAlertEpisodeNote(data: {
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
        new BadDataException("Invalid Alert Episode ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

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
      actionId: SlackActionType.SubmitAlertEpisodeNote,
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
  public static async handleAlertEpisodeAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const actionType: SlackActionType | undefined = data.action.actionType;

    if (actionType === SlackActionType.AcknowledgeAlertEpisode) {
      return await this.acknowledgeAlertEpisode(data);
    }

    if (actionType === SlackActionType.ResolveAlertEpisode) {
      return await this.resolveAlertEpisode(data);
    }

    if (actionType === SlackActionType.ViewAddAlertEpisodeNote) {
      return await this.viewAddAlertEpisodeNote(data);
    }

    if (actionType === SlackActionType.SubmitAlertEpisodeNote) {
      return await this.submitAlertEpisodeNote(data);
    }

    if (actionType === SlackActionType.ViewExecuteAlertEpisodeOnCallPolicy) {
      return await this.viewExecuteOnCallPolicy(data);
    }

    if (actionType === SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy) {
      return await this.executeOnCallPolicy(data);
    }

    if (actionType === SlackActionType.ViewChangeAlertEpisodeState) {
      return await this.viewChangeAlertEpisodeState(data);
    }

    if (actionType === SlackActionType.SubmitChangeAlertEpisodeState) {
      return await this.submitChangeAlertEpisodeState(data);
    }

    if (actionType === SlackActionType.ViewAlertEpisode) {
      // do nothing. This is just a view episode action.
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
    logger.debug("Handling emoji reaction for Alert Episode with data:");
    logger.debug(data);

    const { teamId, reaction, userId, channelId, messageTs } = data;

    // Alert Episodes only support private notes
    const isPrivateNoteEmoji: boolean = PrivateNoteEmojis.includes(reaction);

    if (!isPrivateNoteEmoji) {
      logger.debug(
        `Emoji "${reaction}" is not a supported private note emoji for alert episodes. Ignoring.`,
      );
      return;
    }

    // Get the project auth token using the team ID
    const projectAuth: WorkspaceProjectAuthToken | null =
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
      logger.debug(
        "No project auth found for team ID. Ignoring emoji reaction.",
      );
      return;
    }

    const projectId: ObjectID = projectAuth.projectId;
    const authToken: string = projectAuth.authToken;

    // Find the alert episode linked to this channel
    const workspaceLog: WorkspaceNotificationLog | null =
      await WorkspaceNotificationLogService.findOneBy({
        query: {
          channelId: channelId,
          workspaceType: WorkspaceType.Slack,
          projectId: projectId,
        },
        select: {
          alertEpisodeId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!workspaceLog || !workspaceLog.alertEpisodeId) {
      logger.debug(
        "No alert episode found linked to this channel. Ignoring emoji reaction.",
      );
      return;
    }

    const episodeId: ObjectID = workspaceLog.alertEpisodeId;

    // Get the user ID in OneUptime based on Slack user ID
    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
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

    // Create a unique identifier for this Slack message to prevent duplicate notes
    const postedFromSlackMessageId: string = `${channelId}:${messageTs}`;

    // Check if a note from this Slack message already exists
    const hasExistingNote: boolean =
      await AlertEpisodeInternalNoteService.hasNoteFromSlackMessage({
        alertEpisodeId: episodeId,
        postedFromSlackMessageId: postedFromSlackMessageId,
      });

    if (hasExistingNote) {
      logger.debug(
        "Private note from this Slack message already exists. Skipping duplicate.",
      );
      return;
    }

    // Save as private note
    try {
      await AlertEpisodeInternalNoteService.addNote({
        alertEpisodeId: episodeId,
        note: messageText,
        projectId: projectId,
        userId: oneUptimeUserId,
        postedFromSlackMessageId: postedFromSlackMessageId,
      });
      logger.debug("Private note added to alert episode successfully.");
    } catch (err) {
      logger.error("Error saving note:");
      logger.error(err);
      return;
    }

    // Send confirmation message as a reply to the original message thread
    try {
      const episodeLink: string = (
        await AlertEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        )
      ).toString();

      const confirmationMessage: string = `✅ Message saved as *private note* to <${episodeLink}|Alert Episode>.`;

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
