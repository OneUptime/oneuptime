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

    // execute on call - Assumed to be Action.Execute
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📞 Execute On Call",
      value: JSON.stringify({ 
        actionModule: "alert", 
        actionName: "executeOnCallPolicy", // Or map from MicrosoftTeamsActionType.ViewExecuteAlertOnCallPolicy string value
        alertId: data.alertId.toString(), 
        projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.ViewExecuteAlertOnCallPolicy,
    };
    buttons.push(executeOnCallButton);

    // acknowledge data - Action.Execute
    const acknowledgeAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge", 
      value: JSON.stringify({ 
        actionModule: "alert", 
        actionName: "acknowledge", // Or map from MicrosoftTeamsActionType.AcknowledgeAlert string value
        alertId: data.alertId.toString(), 
        projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.AcknowledgeAlert, 
    };
    buttons.push(acknowledgeAlertButton);

    // resolve data - Action.Execute
    const resolveAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve", 
      value: JSON.stringify({ 
        actionModule: "alert", 
        actionName: "resolve", // Or map from MicrosoftTeamsActionType.ResolveAlert string value
        alertId: data.alertId.toString(), 
        projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.ResolveAlert, 
    };
    buttons.push(resolveAlertButton);

    // change alert state - Assumed to be Action.Execute
    const changeAlertStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "➡️ Change Alert State",
      value: JSON.stringify({ 
        actionModule: "alert", 
        actionName: "changeAlertState", // Or map from MicrosoftTeamsActionType.ViewChangeAlertState string value
        alertId: data.alertId.toString(), 
        projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.ViewChangeAlertState,
    };
    buttons.push(changeAlertStateButton);

    // add note - Assumed to be Action.Execute
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: JSON.stringify({ 
        actionModule: "alert", 
        actionName: "addNote", // Or map from MicrosoftTeamsActionType.ViewAddAlertNote string value
        alertId: data.alertId.toString(), 
        projectId: data.projectId.toString() 
      }),
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
// Important Note for downstream Adaptive Card generator:
// The buttons intended for Action.Execute (Acknowledge, Resolve, etc.)
// are defined here with `actionId` and a JSON string in the `value` field.
// The service that converts these WorkspaceMessagePayloadButton objects into
// Microsoft Teams Adaptive Card actions needs to:
// 1. For buttons intended as Action.Execute:
//    - Set the Adaptive Card action `type` to "Action.Execute".
//    - Set the Adaptive Card action `id` to the string value of `WorkspaceMessagePayloadButton.actionId`.
//    - Parse the JSON string from `WorkspaceMessagePayloadButton.value` and use the resulting
//      object as the `data` field for the Adaptive Card `Action.Execute`. This data now includes
//      `actionModule` and `actionName` which can be used for routing in the backend.
// 2. For buttons intended as Action.OpenUrl (like View Alert):
//    - Set the Adaptive Card action `type` to "Action.OpenUrl".
//    - Set the Adaptive Card action `url` to `WorkspaceMessagePayloadButton.url`.
// Consider enhancing WorkspaceMessagePayloadButton for better type safety if this pattern is common.
