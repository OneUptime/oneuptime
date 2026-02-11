import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentEpisodeService from "../../../../Services/IncidentEpisodeService";
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
import IncidentEpisodeInternalNoteService from "../../../../Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodePublicNoteService from "../../../../Services/IncidentEpisodePublicNoteService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import IncidentStateService from "../../../../Services/IncidentStateService";
import logger from "../../../Logger";
import AccessTokenService from "../../../../Services/AccessTokenService";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";

export default class SlackIncidentEpisodeActions {
  @CaptureSpan()
  public static isIncidentEpisodeAction(data: {
    actionType: SlackActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case SlackActionType.AcknowledgeIncidentEpisode:
      case SlackActionType.ResolveIncidentEpisode:
      case SlackActionType.ViewAddIncidentEpisodeNote:
      case SlackActionType.SubmitIncidentEpisodeNote:
      case SlackActionType.ViewChangeIncidentEpisodeState:
      case SlackActionType.SubmitChangeIncidentEpisodeState:
      case SlackActionType.ViewExecuteIncidentEpisodeOnCallPolicy:
      case SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy:
      case SlackActionType.ViewIncidentEpisode:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async acknowledgeIncidentEpisode(data: {
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
        new BadDataException("Invalid Incident Episode ID"),
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

    if (data.action.actionType === SlackActionType.AcknowledgeIncidentEpisode) {
      const episodeId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyAcknowledged: boolean =
        await IncidentEpisodeService.isEpisodeAcknowledged({
          episodeId: episodeId,
        });

      if (isAlreadyAcknowledged) {
        // send a message to the channel visible to user, that the episode has already been acknowledged.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot acknowledge the **[Incident Episode](${await IncidentEpisodeService.getEpisodeLinkInDashboard(slackRequest.projectId!, episodeId)})**. It has already been acknowledged.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await IncidentEpisodeService.acknowledgeEpisode(episodeId, userId);

      // Log the button interaction
      if (slackRequest.projectId) {
        try {
          const logData: {
            projectId: ObjectID;
            workspaceType: WorkspaceType;
            channelId?: string;
            userId: ObjectID;
            buttonAction: string;
            incidentEpisodeId?: ObjectID;
          } = {
            projectId: slackRequest.projectId,
            workspaceType: WorkspaceType.Slack,
            userId: userId,
            buttonAction: "acknowledge_incident_episode",
          };

          if (slackRequest.slackChannelId) {
            logData.channelId = slackRequest.slackChannelId;
          }
          logData.incidentEpisodeId = episodeId;

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
  public static async resolveIncidentEpisode(data: {
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
        new BadDataException("Invalid Incident Episode ID"),
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

    if (data.action.actionType === SlackActionType.ResolveIncidentEpisode) {
      const episodeId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean =
        await IncidentEpisodeService.isEpisodeResolved(episodeId);

      if (isAlreadyResolved) {
        // send a message to the channel visible to user, that the episode has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot resolve the **[Incident Episode](${await IncidentEpisodeService.getEpisodeLinkInDashboard(slackRequest.projectId!, episodeId)})**. It has already been resolved.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await IncidentEpisodeService.resolveEpisode(episodeId, userId);

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
        new BadDataException("Invalid Incident Episode ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendTextResponse(req, res, "");

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
      await SlackUtil.sendDirectMessageToUser({
        messageBlocks: [
          {
            _type: "WorkspacePayloadMarkdown",
            text: "No on-call policies found in this project.",
          } as WorkspacePayloadMarkdown,
        ],
        authToken: data.slackRequest.projectAuthToken!,
        workspaceUserId: data.slackRequest.slackUserId!,
      });
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
      actionId: SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
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
  public static async viewChangeIncidentEpisodeState(data: {
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
        new BadDataException("Invalid Incident Episode ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendTextResponse(req, res, "");

    // Incident Episodes use incident states
    const incidentStates: Array<IncidentState> =
      await IncidentStateService.getAllIncidentStates({
        projectId: data.slackRequest.projectId!,
        props: {
          isRoot: true,
        },
      });

    const dropdownOptions: Array<DropdownOption> = incidentStates
      .map((state: IncidentState) => {
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
      actionId: SlackActionType.SubmitChangeIncidentEpisodeState,
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
  public static async submitChangeIncidentEpisodeState(data: {
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
        new BadDataException("Invalid Incident Episode ID"),
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

    await IncidentEpisodeService.updateOneById({
      id: episodeId,
      data: {
        currentIncidentStateId: stateId,
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
          incidentEpisodeId?: ObjectID;
        } = {
          projectId: data.slackRequest.projectId,
          workspaceType: WorkspaceType.Slack,
          userId: data.slackRequest.userId,
          buttonAction: "change_incident_episode_state",
        };

        if (data.slackRequest.slackChannelId) {
          logData.channelId = data.slackRequest.slackChannelId;
        }
        logData.incidentEpisodeId = episodeId;

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
        new BadDataException("Invalid Incident Episode ID"),
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
      SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy
    ) {
      const episodeId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean =
        await IncidentEpisodeService.isEpisodeResolved(episodeId);

      if (isAlreadyResolved) {
        // send a message to the channel visible to user, that the episode has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot execute the on-call policy for **[Incident Episode](${await IncidentEpisodeService.getEpisodeLinkInDashboard(slackRequest.projectId!, episodeId)})**. It has already been resolved.`,
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
        triggeredByIncidentEpisodeId: episodeId,
        userNotificationEventType:
          UserNotificationEventType.IncidentEpisodeCreated,
      });
    }
  }

  @CaptureSpan()
  public static async submitIncidentEpisodeNote(data: {
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
        new BadDataException("Invalid Incident Episode ID"),
      );
    }

    if (!data.slackRequest.viewValues) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    if (!data.slackRequest.viewValues["noteType"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note Type"),
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
    const noteType: string =
      data.slackRequest.viewValues["noteType"].toString();

    if (noteType !== "public" && noteType !== "private") {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note Type"),
      );
    }

    // send empty response.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // if public note then, add a note.
    if (noteType === "public") {
      await IncidentEpisodePublicNoteService.addNote({
        incidentEpisodeId: episodeId!,
        note: note || "",
        projectId: data.slackRequest.projectId!,
        userId: data.slackRequest.userId!,
      });
    }

    // if private note then, add a note.
    if (noteType === "private") {
      await IncidentEpisodeInternalNoteService.addNote({
        incidentEpisodeId: episodeId!,
        note: note || "",
        projectId: data.slackRequest.projectId!,
        userId: data.slackRequest.userId!,
      });
    }
  }

  @CaptureSpan()
  public static async viewAddIncidentEpisodeNote(data: {
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
        new BadDataException("Invalid Incident Episode ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendTextResponse(req, res, "");

    const notePickerDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Note Type",
      blockId: "noteType",
      placeholder: "Select Note Type",
      options: [
        {
          label: "Public Note (Will be posted on Status Page)",
          value: "public",
        },
        {
          label: "Private Note (Only visible to team members)",
          value: "private",
        },
      ],
    };

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
      actionId: SlackActionType.SubmitIncidentEpisodeNote,
      actionValue: actionValue,
      blocks: [notePickerDropdown, noteTextArea],
    };

    await SlackUtil.showModalToUser({
      authToken: data.slackRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.slackRequest.triggerId!,
    });
  }

  @CaptureSpan()
  public static async handleIncidentEpisodeAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const actionType: SlackActionType | undefined = data.action.actionType;

    if (actionType === SlackActionType.AcknowledgeIncidentEpisode) {
      return await this.acknowledgeIncidentEpisode(data);
    }

    if (actionType === SlackActionType.ResolveIncidentEpisode) {
      return await this.resolveIncidentEpisode(data);
    }

    if (actionType === SlackActionType.ViewAddIncidentEpisodeNote) {
      return await this.viewAddIncidentEpisodeNote(data);
    }

    if (actionType === SlackActionType.SubmitIncidentEpisodeNote) {
      return await this.submitIncidentEpisodeNote(data);
    }

    if (actionType === SlackActionType.ViewExecuteIncidentEpisodeOnCallPolicy) {
      return await this.viewExecuteOnCallPolicy(data);
    }

    if (
      actionType === SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy
    ) {
      return await this.executeOnCallPolicy(data);
    }

    if (actionType === SlackActionType.ViewChangeIncidentEpisodeState) {
      return await this.viewChangeIncidentEpisodeState(data);
    }

    if (actionType === SlackActionType.SubmitChangeIncidentEpisodeState) {
      return await this.submitChangeIncidentEpisodeState(data);
    }

    if (actionType === SlackActionType.ViewIncidentEpisode) {
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
    logger.debug("Handling emoji reaction for Incident Episode with data:");
    logger.debug(data);

    const { teamId, reaction, userId, channelId, messageTs } = data;

    // Incident Episodes only support private notes
    const isPrivateNoteEmoji: boolean = PrivateNoteEmojis.includes(reaction);

    if (!isPrivateNoteEmoji) {
      logger.debug(
        `Emoji "${reaction}" is not a supported private note emoji for incident episodes. Ignoring.`,
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

    // Find the incident episode linked to this channel
    const workspaceLog: WorkspaceNotificationLog | null =
      await WorkspaceNotificationLogService.findOneBy({
        query: {
          channelId: channelId,
          workspaceType: WorkspaceType.Slack,
          projectId: projectId,
        },
        select: {
          incidentEpisodeId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!workspaceLog || !workspaceLog.incidentEpisodeId) {
      logger.debug(
        "No incident episode found linked to this channel. Ignoring emoji reaction.",
      );
      return;
    }

    const episodeId: ObjectID = workspaceLog.incidentEpisodeId;

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
      await IncidentEpisodeInternalNoteService.hasNoteFromSlackMessage({
        incidentEpisodeId: episodeId,
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
      await IncidentEpisodeInternalNoteService.addNote({
        incidentEpisodeId: episodeId,
        note: messageText,
        projectId: projectId,
        userId: oneUptimeUserId,
        postedFromSlackMessageId: postedFromSlackMessageId,
      });
      logger.debug("Private note added to incident episode successfully.");
    } catch (err) {
      logger.error("Error saving note:");
      logger.error(err);
      return;
    }

    // Send confirmation message as a reply to the original message thread
    try {
      const episodeLink: string = (
        await IncidentEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        )
      ).toString();

      const confirmationMessage: string = `Message saved as *private note* to <${episodeLink}|Incident Episode>.`;

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
