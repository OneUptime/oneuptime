import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import SlackUtil from "../Slack";
import SlackActionType from "./ActionTypes";
import { SlackRequest } from "./Auth";
import Response from "../../../Response";
import {
  WorkspaceDropdownBlock,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import { JSONObject } from "../../../../../Types/JSON";

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
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const {
      actionValue,
      slackChannelId,
      slackUserName,
      botUserId,
      userId,
      projectAuthToken,
    } = slackRequest;

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

    if (data.slackRequest.actionType === SlackActionType.AcknowledgeIncident) {
      const incidentId: ObjectID = new ObjectID(actionValue);

      await IncidentService.acknowledgeIncident(incidentId, userId);

      // send a message to the channel that the incident has been acknowledged.

      const markdwonPayload: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `${slackUserName} has acknowledged the incident.`,
      };

      await SlackUtil.sendMessage({
        workspaceMessagePayload: {
          _type: "WorkspaceMessagePayload",
          messageBlocks: [markdwonPayload],
          channelNames: [],
          channelIds: slackChannelId ? [slackChannelId] : [],
        },
        authToken: projectAuthToken,
        userId: botUserId,
      });

      // clear response.
      return Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });
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
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const {
      actionValue,
      slackChannelId,
      slackUserName,
      botUserId,
      userId,
      projectAuthToken,
    } = slackRequest;

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

    if (data.slackRequest.actionType === SlackActionType.ResolveIncident) {
      const incidentId: ObjectID = new ObjectID(actionValue);

      await IncidentService.resolveIncident(incidentId, userId);

      // send a message to the channel that the incident has been acknowledged.

      const markdwonPayload: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `${slackUserName} has resolved the incident.`,
      };

      await SlackUtil.sendMessage({
        workspaceMessagePayload: {
          _type: "WorkspaceMessagePayload",
          messageBlocks: [markdwonPayload],
          channelNames: [],
          channelIds: slackChannelId ? [slackChannelId] : [],
        },
        authToken: projectAuthToken,
        userId: botUserId,
      });

      // clear response.

      return Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });
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
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { actionValue } = slackRequest;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Incident ID"),
      );
    }

    const incidentId: ObjectID = new ObjectID(actionValue);

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

    const modal: JSONObject = SlackUtil.getModalBlock({
      payloadModalBlock: {
        _type: "WorkspaceModalBlock",
        title: "Add Note",
        submitButtonTitle: "Submit",
        submitButtonActionId: SlackActionType.SubmitIncidentNote,
        cancelButtonTitle: "Cancel",
        submitButtonValue: incidentId.toString(),
        blocks: [notePickerDropdown, noteTextArea],
      },
    });

    return Response.sendJsonObjectResponse(req, res, modal);
  }

  public static async handleIncidentAction(data: {
    slackRequest: SlackRequest;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // now we should be all set, project is authorized and user is authorized. Lets perform some actions based on the action type.
    const actionType: SlackActionType | undefined =
      data.slackRequest.actionType;

    if (actionType === SlackActionType.AcknowledgeIncident) {
      return await this.acknowledgeIncident(data);
    }

    if (actionType === SlackActionType.ResolveIncident) {
      return await this.resolveIncident(data);
    }

    if (actionType === SlackActionType.AddIncidentNote) {
      return await this.addIncidentNote(data);
    }

    if(actionType === SlackActionType.ViewIncident) {
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
