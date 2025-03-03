import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
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

export default class SlackIncidentActions {
  public static isIncidentAction(data: {
    actionType: SlackActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case SlackActionType.AcknowledgeIncident:
      case SlackActionType.ResolveIncident:
      case SlackActionType.AddIncidentNote:
      case SlackActionType.SubmitIncidentNote:
      case SlackActionType.ChangeIncidentState:
      case SlackActionType.SubmitIncidentState:
      case SlackActionType.ExecuteIncidentOnCallPolicy:
      case SlackActionType.SubmitExecuteIncidentOnCallPolicy:
      case SlackActionType.ViewIncident:
        return true;
      default:
        return false;
    }
  }

  public static async acknowledgeIncident(data: {
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
        new BadDataException("Invalid Incident ID"),
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

    if (data.action.actionType === SlackActionType.AcknowledgeIncident) {
      const incidentId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyAcknowledged: boolean =
        await IncidentService.isIncidentAcknowledged({
          incidentId: incidentId,
        });

      if (isAlreadyAcknowledged) {
        const incidentNumber: number | null =
          await IncidentService.getIncidentNumber({
            incidentId: incidentId,
          });
          
        // send a message to the channel visible to user, that the incident has already been acknowledged.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot acknowledge the **[Incident ${incidentNumber?.toString()}](${await IncidentService.getIncidentLinkInDashboard(slackRequest.projectId!, incidentId)})**. It has already been acknowledged.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await IncidentService.acknowledgeIncident(
        incidentId,
        userId,
      );

      // Incident Feed will send a message to the channel that the incident has been Acknowledged.
      return;
    }

    // invlaid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  public static async resolveIncident(data: {
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
        new BadDataException("Invalid Incident ID"),
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

    if (data.action.actionType === SlackActionType.ResolveIncident) {
      const incidentId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean =
        await IncidentService.isIncidentResolved({
          incidentId: incidentId,
        });

      if (isAlreadyResolved) {
        const incidentNumber: number | null =
          await IncidentService.getIncidentNumber({
            incidentId: incidentId,
          });
        // send a message to the channel visible to user, that the incident has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot resolve the **[Incident ${incidentNumber?.toString()}](${await IncidentService.getIncidentLinkInDashboard(slackRequest.projectId!, incidentId)})**. It has already been resolved.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await IncidentService.resolveIncident(
        incidentId,
        userId,
      );

      return;
    }

    // invlaid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  public static async addIncidentNote(data: {
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
        new BadDataException("Invalid Incident ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const incidentId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    const notePickerDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Note Type",
      blockId: "note_type",
      placeholder: "Select Note Type",
      options: [
        {
          label: "Public Note",
          value: "public",
        },
        {
          label: "Private Note",
          value: "private",
        },
      ],
    };

    const noteTextArea: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: "Note",
      blockId: "note",
      placeholder: "Note",
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Add Note",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      callbackId: "add_incident_note",
      blocks: [notePickerDropdown, noteTextArea],
    };

    await SlackUtil.showModalToUser({
      authToken: data.slackRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.slackRequest.triggerId!,
    });
  }

  public static async handleIncidentAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // now we should be all set, project is authorized and user is authorized. Lets perform some actions based on the action type.
    const actionType: SlackActionType | undefined = data.action.actionType;

    if (actionType === SlackActionType.AcknowledgeIncident) {
      return await this.acknowledgeIncident(data);
    }

    if (actionType === SlackActionType.ResolveIncident) {
      return await this.resolveIncident(data);
    }

    if (actionType === SlackActionType.AddIncidentNote) {
      return await this.addIncidentNote(data);
    }

    if (actionType === SlackActionType.ViewIncident) {
      // do nothing. This is just a view incident action.
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
