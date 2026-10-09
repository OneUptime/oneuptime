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
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import AlertStateTimeline from "../../../../../Models/DatabaseModels/AlertStateTimeline";
import AlertInternalNote from "../../../../../Models/DatabaseModels/AlertInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SlackActionAuthorization from "./Authorization";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventStateOption,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";

export default class SlackAlertActions {
  // Changing an alert's state, as a refusal names it.
  public static readonly CHANGE_STATE_ACTION: string =
    "change the state of this alert";

  // What a change-state form says instead of opening with nothing to pick.
  public static readonly NO_STATES_MESSAGE: string =
    "No alert states are available to you in this project. Ask a project admin for access to them.";

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

      const props: DatabaseCommonInteractionProps | null =
        await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: AlertStateTimeline,
          action: "acknowledge this alert",
          resources: [{ service: AlertService, id: alertId }],
        });

      if (!props) {
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
          text: mdText`@${slackUsername}, unfortunately you cannot acknowledge the **[Alert ${alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been acknowledged.`.toString(),
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
          action: "acknowledge the alert",
          run: async (): Promise<boolean> => {
            await WorkspaceMemberActions.acknowledge({
              event: {
                type: WorkspaceEventType.Alert,
                id: alertId,
              },
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

      const props: DatabaseCommonInteractionProps | null =
        await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: AlertStateTimeline,
          action: "resolve this alert",
          resources: [{ service: AlertService, id: alertId }],
        });

      if (!props) {
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
          text: mdText`@${slackUsername}, unfortunately you cannot resolve the **[Alert ${alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been resolved.`.toString(),
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
        action: "resolve the alert",
        run: async (): Promise<void> => {
          await WorkspaceMemberActions.resolve({
            event: {
              type: WorkspaceEventType.Alert,
              id: alertId,
            },
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
        new BadDataException("Invalid Alert ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const alertId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    /*
     * Asked as the submit asks it, before the form is shown: someone who may
     * not execute an on-call policy for this alert is told so now. The
     * form then offers the policies they may read, with their own
     * permissions (WorkspaceActionAuthorization.findReadable).
     */
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this alert",
        resources: [{ service: AlertService, id: new ObjectID(actionValue) }],
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

    /*
     * Asked as the submit asks it, before the form is shown: someone who may
     * not change the state of this alert is told so now. The form then
     * offers the states they may read, read with their own permissions, as
     * the dashboard's state panel lists them for them.
     */
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: AlertStateTimeline,
        action: SlackAlertActions.CHANGE_STATE_ACTION,
        resources: [{ service: AlertService, id: new ObjectID(actionValue) }],
      });

    if (!props) {
      return;
    }

    const alertStates: Array<WorkspaceEventStateOption> =
      await WorkspaceMemberActions.findStateOptions({
        type: WorkspaceEventType.Alert,
        projectId: data.slackRequest.projectId!,
        props: props,
      });

    if (alertStates.length === 0) {
      await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: SlackAlertActions.NO_STATES_MESSAGE,
      });
      return;
    }

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
        action: SlackAlertActions.CHANGE_STATE_ACTION,
        resources: [{ service: AlertService, id: alertId }],
      });

    if (!props) {
      return;
    }

    /*
     * The state change the dashboard makes: a row in the alert's state
     * timeline, created by the member (WorkspaceMemberActions).
     */
    const isStateChanged: boolean | null =
      await SlackActionAuthorization.runForRequester({
        requester: data.slackRequest,
        action: "change the state of the alert",
        run: async (): Promise<boolean> => {
          await WorkspaceMemberActions.changeState({
            event: {
              type: WorkspaceEventType.Alert,
              id: alertId,
            },
            stateId: stateId,
            props: props,
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

      const props: DatabaseCommonInteractionProps | null =
        await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: OnCallDutyPolicyExecutionLog,
          action: "execute an on-call policy for this alert",
          resources: [
            { service: AlertService, id: alertId },
            { service: OnCallDutyPolicyService, id: onCallPolicyId },
          ],
        });

      if (!props) {
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
          text: mdText`@${slackUsername}, unfortunately you cannot execute the on-call policy for **[Alert ${alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number}](${await AlertService.getAlertLinkInDashboard(slackRequest.projectId!, alertId)})**. It has already been resolved.`.toString(),
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
       * executes it for them: an execution log triggered by the alert.
       */
      await SlackActionAuthorization.runForRequester({
        requester: slackRequest,
        action: "execute the on-call policy",
        run: async (): Promise<void> => {
          await WorkspaceMemberActions.executeOnCallPolicy({
            event: {
              type: WorkspaceEventType.Alert,
              id: alertId,
            },
            onCallDutyPolicyId: onCallPolicyId,
            props: props,
          });
        },
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

    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: AlertInternalNote,
        action: "add a private note to this alert",
        resources: [{ service: AlertService, id: alertId }],
      });

    if (!props) {
      return;
    }

    // Posted by the member, as the dashboard posts it for them.
    await SlackActionAuthorization.runForRequester({
      requester: data.slackRequest,
      action: "add the note",
      run: async (): Promise<void> => {
        await AlertInternalNoteService.addNote({
          alertId: alertId,
          note: note,
          projectId: data.slackRequest.projectId!,
          props: props,
        });
      },
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
