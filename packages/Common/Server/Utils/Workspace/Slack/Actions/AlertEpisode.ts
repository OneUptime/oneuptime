import SlackReactionNoteActions, { SlackReactionData } from "./ReactionNote";
import { WorkspaceNoteResourceType } from "../../WorkspaceReactionNote";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import AlertEpisodeService from "../../../../Services/AlertEpisodeService";
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
import AlertEpisodeInternalNoteService from "../../../../Services/AlertEpisodeInternalNoteService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";
import logger from "../../../Logger";

import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import AlertEpisodeStateTimeline from "../../../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertEpisodeInternalNote from "../../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import SlackActionAuthorization, {
  SlackAuthorizedEvent,
} from "./Authorization";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventStateOption,
  WorkspaceEventStateOptions,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";

export default class SlackAlertEpisodeActions {
  // Changing an alert episode's state, as a refusal names it.
  public static readonly CHANGE_STATE_ACTION: string =
    "change the state of this alert episode";

  // What a change-state form says instead of opening with nothing to pick.
  public static readonly NO_STATES_MESSAGE: string =
    "No alert states are available to you in this project. Ask a project admin for access to them.";

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

      /*
       * The episode is read once, as the member, by the check - and that
       * read answers "already acknowledged" below and goes to the write.
       */
      const authorized: SlackAuthorizedEvent | null =
        await SlackActionAuthorization.authorizeEvent({
          requester: slackRequest,
          modelType: AlertEpisodeStateTimeline,
          action: "acknowledge this alert episode",
          event: { type: WorkspaceEventType.AlertEpisode, id: episodeId },
        });

      if (!authorized) {
        return;
      }

      const { props, event: episode } = authorized;

      if ((await WorkspaceMemberActions.getStanding(episode)).isAcknowledged) {
        // send a message to the channel visible to user, that the episode has already been acknowledged.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: mdText`@${slackUsername}, unfortunately you cannot acknowledge the **[Alert Episode](${await AlertEpisodeService.getEpisodeLinkInDashboard(slackRequest.projectId!, episodeId)})**. It has already been acknowledged.`.toString(),
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      /*
       * Acknowledged by the member, as the dashboard acknowledges it for
       * them (WorkspaceMemberActions); a refusal is told to them.
       */
      const isAcknowledged: boolean | null =
        await SlackActionAuthorization.runForRequester({
          requester: slackRequest,
          action: "acknowledge the alert episode",
          run: async (): Promise<boolean> => {
            await WorkspaceMemberActions.acknowledge({
              event: episode,
              props: props,
            });
            return true;
          },
        });

      if (!isAcknowledged) {
        return;
      }

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
          logger.error("Error logging button interaction:", {
            projectId: slackRequest.projectId?.toString(),
          });
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

      // Read once, by the check; that read answers "already resolved".
      const authorized: SlackAuthorizedEvent | null =
        await SlackActionAuthorization.authorizeEvent({
          requester: slackRequest,
          modelType: AlertEpisodeStateTimeline,
          action: "resolve this alert episode",
          event: { type: WorkspaceEventType.AlertEpisode, id: episodeId },
        });

      if (!authorized) {
        return;
      }

      const { props, event: episode } = authorized;

      if ((await WorkspaceMemberActions.getStanding(episode)).isResolved) {
        // send a message to the channel visible to user, that the episode has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: mdText`@${slackUsername}, unfortunately you cannot resolve the **[Alert Episode](${await AlertEpisodeService.getEpisodeLinkInDashboard(slackRequest.projectId!, episodeId)})**. It has already been resolved.`.toString(),
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      // Resolved by the member, as the dashboard resolves it for them.
      await SlackActionAuthorization.runForRequester({
        requester: slackRequest,
        action: "resolve the alert episode",
        run: async (): Promise<void> => {
          await WorkspaceMemberActions.resolve({
            event: episode,
            props: props,
          });
        },
      });

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

    /*
     * Asked as the submit asks it, before the form is shown: someone who may
     * not execute an on-call policy for this alert episode is told so now. The
     * form then offers the policies they may read, with their own
     * permissions (WorkspaceActionAuthorization.findReadable).
     */
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this alert episode",
        resources: [
          { service: AlertEpisodeService, id: new ObjectID(actionValue) },
        ],
      });

    if (!props) {
      return;
    }

    const onCallPolicies: Array<OnCallDutyPolicy> =
      await WorkspaceActionAuthorization.findReadable({
        service: OnCallDutyPolicyService,
        props: props,
        query: {
          projectId: data.slackRequest.projectId!,
          // Archived policies page no one, so they are not offered.
          isArchived: false,
        },
        select: {
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
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
              text: "No on-call policies are available to you in this project yet. Add one in the OneUptime Dashboard under On-Call Duty > Policies, or ask a project admin for access to one.",
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

    /*
     * Asked as the submit asks it, before the form is shown: someone who may
     * not change the state of this episode is told so now. The episode is read
     * as the submit reads it, with the state it is in, and the form offers
     * the states they may read that it may move into next - by the rule its
     * state timeline holds every move to (Common/Utils/StateMove) - so it
     * never offers a move the timeline would refuse.
     */
    const authorized: SlackAuthorizedEvent | null =
      await SlackActionAuthorization.authorizeEvent({
        requester: data.slackRequest,
        modelType: AlertEpisodeStateTimeline,
        action: SlackAlertEpisodeActions.CHANGE_STATE_ACTION,
        event: {
          type: WorkspaceEventType.AlertEpisode,
          id: new ObjectID(actionValue),
        },
      });

    if (!authorized) {
      return;
    }

    const stateOptions: WorkspaceEventStateOptions =
      await WorkspaceMemberActions.findStateOptions({
        event: authorized.event,
        props: authorized.props,
      });

    if (stateOptions.options.length === 0) {
      await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: stateOptions.hasNoLaterState
          ? WorkspaceMemberActions.getNoLaterStateMessage(
              WorkspaceEventType.AlertEpisode,
            )
          : SlackAlertEpisodeActions.NO_STATES_MESSAGE,
      });
      return;
    }

    const alertStates: Array<WorkspaceEventStateOption> = stateOptions.options;

    const dropdownOptions: Array<DropdownOption> = alertStates.map(
      (state: WorkspaceEventStateOption) => {
        return {
          label: state.name,
          value: state.id.toString(),
        };
      },
    );

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

    const authorized: SlackAuthorizedEvent | null =
      await SlackActionAuthorization.authorizeEvent({
        requester: data.slackRequest,
        modelType: AlertEpisodeStateTimeline,
        action: SlackAlertEpisodeActions.CHANGE_STATE_ACTION,
        event: { type: WorkspaceEventType.AlertEpisode, id: episodeId },
      });

    if (!authorized) {
      return;
    }

    /*
     * The state change the dashboard makes: a row in the episode's state
     * timeline, created by the member (WorkspaceMemberActions), from the
     * episode as the check read it.
     */
    const isStateChanged: boolean | null =
      await SlackActionAuthorization.runForRequester({
        requester: data.slackRequest,
        action: "change the state of the alert episode",
        run: async (): Promise<boolean> => {
          await WorkspaceMemberActions.changeState({
            event: authorized.event,
            stateId: stateId,
            props: authorized.props,
          });
          return true;
        },
      });

    if (!isStateChanged) {
      return;
    }

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
        logger.error("Error logging button interaction:", {
          projectId: data.slackRequest.projectId?.toString(),
          alertEpisodeId: episodeId.toString(),
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

      const authorized: SlackAuthorizedEvent | null =
        await SlackActionAuthorization.authorizeEvent({
          requester: slackRequest,
          modelType: OnCallDutyPolicyExecutionLog,
          action: "execute an on-call policy for this alert episode",
          event: { type: WorkspaceEventType.AlertEpisode, id: episodeId },
          resources: [{ service: OnCallDutyPolicyService, id: onCallPolicyId }],
        });

      if (!authorized) {
        return;
      }

      const { props, event: episode } = authorized;

      if ((await WorkspaceMemberActions.getStanding(episode)).isResolved) {
        // send a message to the channel visible to user, that the episode has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: mdText`@${slackUsername}, unfortunately you cannot execute the on-call policy for **[Alert Episode](${await AlertEpisodeService.getEpisodeLinkInDashboard(slackRequest.projectId!, episodeId)})**. It has already been resolved.`.toString(),
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      /*
       * Executed by the member, as the dashboard's Execute On-Call Policy
       * executes it for them: an execution log triggered by the episode.
       */
      await SlackActionAuthorization.runForRequester({
        requester: slackRequest,
        action: "execute the on-call policy",
        run: async (): Promise<void> => {
          await WorkspaceMemberActions.executeOnCallPolicy({
            event: episode,
            onCallDutyPolicyId: onCallPolicyId,
            props: props,
          });
        },
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

    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: AlertEpisodeInternalNote,
        action: "add a private note to this alert episode",
        resources: [{ service: AlertEpisodeService, id: episodeId }],
      });

    if (!props) {
      return;
    }

    // Posted by the member, as the dashboard posts it for them.
    await SlackActionAuthorization.runForRequester({
      requester: data.slackRequest,
      action: "add the note",
      run: async (): Promise<void> => {
        await AlertEpisodeInternalNoteService.addNote({
          alertEpisodeId: episodeId,
          note: note,
          projectId: data.slackRequest.projectId!,
          props: props,
        });
      },
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

  /*
   * A note emoji on a message, looked up among alert episode channels only.
   * Slack events go to SlackReactionNoteActions directly, which works out
   * what the channel belongs to first.
   */
  @CaptureSpan()
  public static async handleEmojiReaction(
    data: SlackReactionData,
  ): Promise<void> {
    await SlackReactionNoteActions.handleEmojiReaction({
      ...data,
      resourceTypes: [WorkspaceNoteResourceType.AlertEpisode],
    });
  }
}
