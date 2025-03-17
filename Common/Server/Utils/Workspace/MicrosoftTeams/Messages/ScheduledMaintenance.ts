import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import MicrosoftTeamsActionType from "../../../../Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsScheduledMaintenanceMessages {
  @CaptureSpan()
  public static async getScheduledMaintenanceCreateMessageBlocks(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.scheduledMaintenanceId) {
      throw new BadDataException("ScheduledMaintenance ID is required");
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
    // Acknowledge scheduledMaintenance
    // Resolve data.
    // Change ScheduledMaintenance State.
    // Add Note.

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view data.
    const viewScheduledMaintenanceButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View ScheduledMaintenance",
      url: await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        data.projectId!,
        data.scheduledMaintenanceId!,
      ),
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewScheduledMaintenance,
    };

    buttons.push(viewScheduledMaintenanceButton);

    // acknowledge data.
    const acknowledgeScheduledMaintenanceButton: WorkspaceMessagePayloadButton =
      {
        _type: "WorkspaceMessagePayloadButton",
        title: "⌛ Mark as Ongoing",
        value: data.scheduledMaintenanceId?.toString() || "",
        actionId: MicrosoftTeamsActionType.MarkScheduledMaintenanceAsOngoing,
      };

    buttons.push(acknowledgeScheduledMaintenanceButton);

    // resolve data.
    const resolveScheduledMaintenanceButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Mark as Completed",
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: MicrosoftTeamsActionType.MarkScheduledMaintenanceAsComplete,
    };

    buttons.push(resolveScheduledMaintenanceButton);

    // change scheduledMaintenance state.
    const changeScheduledMaintenanceStateButton: WorkspaceMessagePayloadButton =
      {
        _type: "WorkspaceMessagePayloadButton",
        title: "➡️ Change Scheduled Maintenance State",
        value: data.scheduledMaintenanceId?.toString() || "",
        actionId: MicrosoftTeamsActionType.ViewChangeScheduledMaintenanceState,
      };

    buttons.push(changeScheduledMaintenanceStateButton);

    // add note.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewAddScheduledMaintenanceNote,
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
