import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import AlertService from "../../../../Services/AlertService";
import MicrosoftTeamsActionType from "../../../../Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsAlertMessages {
  @CaptureSpan()
  public static async getAlertCreateMessageBlocks(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.alertId) {
      throw new BadDataException("Alert ID is required");
    }

    // MicrosoftTeams.

    const blockMicrosoftTeams: Array<WorkspaceMessageBlock> = [];

    // add divider.

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blockMicrosoftTeams.push(dividerBlock);

    // now add buttons.
    // View data.
    // Execute On Call
    // Acknowledge alert
    // Resolve data.
    // Change Alert State.
    // Add Note.

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
      actionId: MicrosoftTeamsActionType.ViewAlert,
    };

    buttons.push(viewAlertButton);

    // execute on call.
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📞 Execute On Call",
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewExecuteAlertOnCallPolicy,
    };

    buttons.push(executeOnCallButton);

    // acknowledge data.
    const acknowledgeAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge Alert",
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.AcknowledgeAlert,
    };

    buttons.push(acknowledgeAlertButton);

    // resolve data.
    const resolveAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve Alert",
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ResolveAlert,
    };

    buttons.push(resolveAlertButton);

    // change alert state.
    const changeAlertStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "➡️ Change Alert State",
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewChangeAlertState,
    };

    buttons.push(changeAlertStateButton);

    // add note.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewAddAlertNote,
    };

    buttons.push(addNoteButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blockMicrosoftTeams.push(workspacePayloadButtons);

    return blockMicrosoftTeams;
  }
}
