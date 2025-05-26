import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import IncidentService from "../../../../Services/IncidentService";
import MicrosoftTeamsActionType from "../../../../Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsIncidentMessages {
  @CaptureSpan()
  public static async getIncidentCreateMessageBlocks(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.incidentId) {
      throw new BadDataException("Incident ID is required");
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
    const viewIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Incident",
      url: await IncidentService.getIncidentLinkInDashboard(
        data.projectId!,
        data.incidentId!,
      ),
      value: data.incidentId?.toString() || "", 
      actionId: MicrosoftTeamsActionType.ViewIncident, 
    };
    buttons.push(viewIncidentButton);

    // execute on call - Assumed to be Action.Execute
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📞 Execute On Call",
      value: JSON.stringify({ 
        actionModule: "incident", 
        actionName: "executeOnCallPolicy", // Or map from MicrosoftTeamsActionType.ViewExecuteIncidentOnCallPolicy
        incidentId: data.incidentId.toString(), 
        projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.ViewExecuteIncidentOnCallPolicy,
    };
    buttons.push(executeOnCallButton);

    // acknowledge data - Action.Execute
    const acknowledgeIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge", 
      value: JSON.stringify({ 
        actionModule: "incident", 
        actionName: "acknowledge", // Or map from MicrosoftTeamsActionType.AcknowledgeIncident
        incidentId: data.incidentId.toString(), 
        projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.AcknowledgeIncident, 
    };
    buttons.push(acknowledgeIncidentButton);

    // resolve data - Action.Execute
    const resolveIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve", 
      value: JSON.stringify({ 
        actionModule: "incident", 
        actionName: "resolve", // Or map from MicrosoftTeamsActionType.ResolveIncident
        incidentId: data.incidentId.toString(), 
        projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.ResolveIncident, 
    };
    buttons.push(resolveIncidentButton);

    // change incident state - Assumed to be Action.Execute
    const changeIncidentStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "➡️ Change Incident State",
      value: JSON.stringify({ 
        actionModule: "incident", 
        actionName: "changeIncidentState", // Or map from MicrosoftTeamsActionType.ViewChangeIncidentState
        incidentId: data.incidentId.toString(), 
        projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.ViewChangeIncidentState,
    };
    buttons.push(changeIncidentStateButton);

    // add note - Assumed to be Action.Execute
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: JSON.stringify({ 
        actionModule: "incident", 
        actionName: "addNote", // Or map from MicrosoftTeamsActionType.ViewAddIncidentNote
        incidentId: data.incidentId.toString(), 
        projectId: data.projectId.toString() 
      }),
      actionId: MicrosoftTeamsActionType.ViewAddIncidentNote,
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
// 2. For buttons intended as Action.OpenUrl (like View Incident):
//    - Set the Adaptive Card action `type` to "Action.OpenUrl".
//    - Set the Adaptive Card action `url` to `WorkspaceMessagePayloadButton.url`.
// Consider enhancing WorkspaceMessagePayloadButton for better type safety if this pattern is common.
