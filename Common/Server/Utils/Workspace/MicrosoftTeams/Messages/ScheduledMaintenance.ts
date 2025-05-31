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

    if (!data.projectId) {
        throw new BadDataException("Project ID is required");
    }

    const blockMicrosoftTeams: Array<WorkspaceMessageBlock> = [];

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };
    blockMicrosoftTeams.push(dividerBlock);

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view data - This is an Action.OpenUrl
    const viewScheduledMaintenanceButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Scheduled Maintenance", 
      url: await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        data.projectId!,
        data.scheduledMaintenanceId!,
      ),
      value: data.scheduledMaintenanceId?.toString() || "", 
      actionId: MicrosoftTeamsActionType.ViewScheduledMaintenance,
    };
    buttons.push(viewScheduledMaintenanceButton);

    // acknowledge data. (Mark as Ongoing) - Action.Execute
    const acknowledgeScheduledMaintenanceButton: WorkspaceMessagePayloadButton =
      {
        _type: "WorkspaceMessagePayloadButton",
        title: "⌛ Mark as Ongoing",
        value: JSON.stringify({ 
            actionModule: "scheduledMaintenance", 
            actionName: "markOngoing", // Or map from MicrosoftTeamsActionType.MarkScheduledMaintenanceAsOngoing
            scheduledMaintenanceId: data.scheduledMaintenanceId.toString(), 
            projectId: data.projectId.toString() 
        }),
        actionId: MicrosoftTeamsActionType.MarkScheduledMaintenanceAsOngoing, 
      };
    buttons.push(acknowledgeScheduledMaintenanceButton);

    // resolve data. (Mark as Completed) - Action.Execute
    const resolveScheduledMaintenanceButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Mark as Completed",
      value: JSON.stringify({ 
            actionModule: "scheduledMaintenance", 
            actionName: "markCompleted", // Or map from MicrosoftTeamsActionType.MarkScheduledMaintenanceAsComplete
            scheduledMaintenanceId: data.scheduledMaintenanceId.toString(), 
            projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.MarkScheduledMaintenanceAsComplete, 
    };
    buttons.push(resolveScheduledMaintenanceButton);

    // change scheduledMaintenance state - Assumed to be Action.Execute
    const changeScheduledMaintenanceStateButton: WorkspaceMessagePayloadButton =
      {
        _type: "WorkspaceMessagePayloadButton",
        title: "➡️ Change Scheduled Maintenance State",
        value: JSON.stringify({ 
            actionModule: "scheduledMaintenance", 
            actionName: "changeState", // Or map from MicrosoftTeamsActionType.ViewChangeScheduledMaintenanceState
            scheduledMaintenanceId: data.scheduledMaintenanceId.toString(), 
            projectId: data.projectId.toString() 
        }),
        actionId: MicrosoftTeamsActionType.ViewChangeScheduledMaintenanceState,
      };
    buttons.push(changeScheduledMaintenanceStateButton);

    // add note - Assumed to be Action.Execute
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: JSON.stringify({ 
            actionModule: "scheduledMaintenance", 
            actionName: "addNote", // Or map from MicrosoftTeamsActionType.ViewAddScheduledMaintenanceNote
            scheduledMaintenanceId: data.scheduledMaintenanceId.toString(), 
            projectId: data.projectId.toString() 
      }),
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
// Important Note for downstream Adaptive Card generator:
// The buttons intended for Action.Execute
// are defined here with `actionId` and a JSON string in the `value` field.
// The service that converts these WorkspaceMessagePayloadButton objects into
// Microsoft Teams Adaptive Card actions needs to:
// 1. For Action.Execute:
//    - Set the Adaptive Card action `type` to "Action.Execute".
//    - Set the Adaptive Card action `id` to the string value of `WorkspaceMessagePayloadButton.actionId`.
//    - Parse the JSON string from `WorkspaceMessagePayloadButton.value` and use the resulting
//      object as the `data` field for the Adaptive Card `Action.Execute`. This data now includes
//      `actionModule` and `actionName` which can be used for routing in the backend.
// 2. For Action.OpenUrl (like View Scheduled Maintenance):
//    - Set the Adaptive Card action `type` to "Action.OpenUrl".
//    - Set the Adaptive Card action `url` to `WorkspaceMessagePayloadButton.url`.
// Consider enhancing WorkspaceMessagePayloadButton for better type safety if this pattern is common.
