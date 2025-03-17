import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import SlackActionType from "../../../../Utils/Workspace/Slack/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class SlackScheduledMaintenanceMessages {
  @CaptureSpan()
  public static async getScheduledMaintenanceCreateMessageBlocks(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.scheduledMaintenanceId) {
      throw new BadDataException("ScheduledMaintenance ID is required");
    }

    // Slack.

    const blockSlack: Array<WorkspaceMessageBlock> = [];

    // add divider.

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blockSlack.push(dividerBlock);

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
      title: "🔗 View Event",
      url: await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        data.projectId!,
        data.scheduledMaintenanceId!,
      ),
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: SlackActionType.ViewScheduledMaintenance,
    };

    buttons.push(viewScheduledMaintenanceButton);

    // acknowledge data.
    const acknowledgeScheduledMaintenanceButton: WorkspaceMessagePayloadButton =
      {
        _type: "WorkspaceMessagePayloadButton",
        title: "⌛ Mark as Ongoing",
        value: data.scheduledMaintenanceId?.toString() || "",
        actionId: SlackActionType.MarkScheduledMaintenanceAsOngoing,
      };

    buttons.push(acknowledgeScheduledMaintenanceButton);

    // resolve data.
    const resolveScheduledMaintenanceButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Mark as Completed",
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: SlackActionType.MarkScheduledMaintenanceAsComplete,
    };

    buttons.push(resolveScheduledMaintenanceButton);

    // change scheduledMaintenance state.
    const changeScheduledMaintenanceStateButton: WorkspaceMessagePayloadButton =
      {
        _type: "WorkspaceMessagePayloadButton",
        title: "➡️ Change State",
        value: data.scheduledMaintenanceId?.toString() || "",
        actionId: SlackActionType.ViewChangeScheduledMaintenanceState,
      };

    buttons.push(changeScheduledMaintenanceStateButton);

    // add note.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: SlackActionType.ViewAddScheduledMaintenanceNote,
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
