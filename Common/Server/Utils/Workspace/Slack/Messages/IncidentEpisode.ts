import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import IncidentEpisodeService from "../../../../Services/IncidentEpisodeService";
import SlackActionType from "../../../../Utils/Workspace/Slack/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class SlackIncidentEpisodeMessages {
  @CaptureSpan()
  public static async getIncidentEpisodeCreateMessageBlocks(data: {
    incidentEpisodeId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.incidentEpisodeId) {
      throw new BadDataException("Incident Episode ID is required");
    }

    // Slack.

    const blockSlack: Array<WorkspaceMessageBlock> = [];

    // add divider.

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blockSlack.push(dividerBlock);

    /*
     * now add buttons.
     * View data.
     * Execute On Call
     * Acknowledge incident episode
     * Resolve data.
     * Change Incident Episode State.
     * Add Note.
     */

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view data.
    const viewIncidentEpisodeButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "View Episode",
      url: await IncidentEpisodeService.getEpisodeLinkInDashboard(
        data.projectId!,
        data.incidentEpisodeId!,
      ),
      value: data.incidentEpisodeId?.toString() || "",
      actionId: SlackActionType.ViewIncidentEpisode,
    };

    buttons.push(viewIncidentEpisodeButton);

    // execute on call.
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "Execute On Call",
      value: data.incidentEpisodeId?.toString() || "",
      actionId: SlackActionType.ViewExecuteIncidentEpisodeOnCallPolicy,
    };

    buttons.push(executeOnCallButton);

    // acknowledge data.
    const acknowledgeIncidentEpisodeButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "Acknowledge Episode",
      value: data.incidentEpisodeId?.toString() || "",
      actionId: SlackActionType.AcknowledgeIncidentEpisode,
    };

    buttons.push(acknowledgeIncidentEpisodeButton);

    // resolve data.
    const resolveIncidentEpisodeButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "Resolve Episode",
      value: data.incidentEpisodeId?.toString() || "",
      actionId: SlackActionType.ResolveIncidentEpisode,
    };

    buttons.push(resolveIncidentEpisodeButton);

    // change incident episode state.
    const changeIncidentEpisodeStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "Change Episode State",
      value: data.incidentEpisodeId?.toString() || "",
      actionId: SlackActionType.ViewChangeIncidentEpisodeState,
    };

    buttons.push(changeIncidentEpisodeStateButton);

    // add note.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "Add Note",
      value: data.incidentEpisodeId?.toString() || "",
      actionId: SlackActionType.ViewAddIncidentEpisodeNote,
    };

    buttons.push(addNoteButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blockSlack.push(workspacePayloadButtons);

    return blockSlack;
  }
}
