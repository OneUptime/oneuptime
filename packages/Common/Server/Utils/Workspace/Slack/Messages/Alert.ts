import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import AlertService from "../../../../Services/AlertService";
import SlackActionType from "../../../../Utils/Workspace/Slack/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class SlackAlertMessages {
  @CaptureSpan()
  public static async getAlertCreateMessageBlocks(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.alertId) {
      throw new BadDataException("Alert ID is required");
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
     * Execute On-Call Policy.
     * Acknowledge alert
     * Resolve data.
     * Change Alert State.
     * Add Note.
     */

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view data.
    const viewAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Alert",
      url: await AlertService.getAlertLinkInDashboard(
        data.projectId!,
        data.alertId!,
      ),
      value: data.alertId?.toString() || "",
      actionId: SlackActionType.ViewAlert,
    };

    buttons.push(viewAlertButton);

    /*
     * Execute On-Call Policy: named as the Actions menu of the record's feed
     * in the Dashboard names it, and as the form it opens is titled.
     */
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📞 Execute On-Call Policy",
      value: data.alertId?.toString() || "",
      actionId: SlackActionType.ViewExecuteAlertOnCallPolicy,
    };

    buttons.push(executeOnCallButton);

    // acknowledge data.
    const acknowledgeAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge Alert",
      value: data.alertId?.toString() || "",
      actionId: SlackActionType.AcknowledgeAlert,
    };

    buttons.push(acknowledgeAlertButton);

    // resolve data.
    const resolveAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve Alert",
      value: data.alertId?.toString() || "",
      actionId: SlackActionType.ResolveAlert,
    };

    buttons.push(resolveAlertButton);

    // change alert state.
    const changeAlertStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "➡️ Change Alert State",
      value: data.alertId?.toString() || "",
      actionId: SlackActionType.ViewChangeAlertState,
    };

    buttons.push(changeAlertStateButton);

    // add note.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: data.alertId?.toString() || "",
      actionId: SlackActionType.ViewAddAlertNote,
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
