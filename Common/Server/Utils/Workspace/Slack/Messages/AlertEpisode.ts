import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import AlertEpisodeService from "../../../../Services/AlertEpisodeService";
import SlackActionType from "../../../../Utils/Workspace/Slack/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class SlackAlertEpisodeMessages {
  @CaptureSpan()
  public static async getAlertEpisodeCreateMessageBlocks(data: {
    alertEpisodeId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.alertEpisodeId) {
      throw new BadDataException("Alert Episode ID is required");
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
     * Acknowledge alert episode
     * Resolve data.
     * Change Alert Episode State.
     * Add Note.
     */

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view data.
    const viewAlertEpisodeButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Episode",
      url: await AlertEpisodeService.getEpisodeLinkInDashboard(
        data.projectId!,
        data.alertEpisodeId!,
      ),
      value: data.alertEpisodeId?.toString() || "",
      actionId: SlackActionType.ViewAlertEpisode,
    };

    buttons.push(viewAlertEpisodeButton);

    // execute on call.
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📞 Execute On Call",
      value: data.alertEpisodeId?.toString() || "",
      actionId: SlackActionType.ViewExecuteAlertEpisodeOnCallPolicy,
    };

    buttons.push(executeOnCallButton);

    // acknowledge data.
    const acknowledgeAlertEpisodeButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge Episode",
      value: data.alertEpisodeId?.toString() || "",
      actionId: SlackActionType.AcknowledgeAlertEpisode,
    };

    buttons.push(acknowledgeAlertEpisodeButton);

    // resolve data.
    const resolveAlertEpisodeButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve Episode",
      value: data.alertEpisodeId?.toString() || "",
      actionId: SlackActionType.ResolveAlertEpisode,
    };

    buttons.push(resolveAlertEpisodeButton);

    // change alert episode state.
    const changeAlertEpisodeStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "➡️ Change Episode State",
      value: data.alertEpisodeId?.toString() || "",
      actionId: SlackActionType.ViewChangeAlertEpisodeState,
    };

    buttons.push(changeAlertEpisodeStateButton);

    // add note.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: data.alertEpisodeId?.toString() || "",
      actionId: SlackActionType.ViewAddAlertEpisodeNote,
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
