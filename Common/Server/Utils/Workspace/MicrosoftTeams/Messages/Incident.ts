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

    // Microsoft Teams.

    const blockMicrosoftTeams: Array<WorkspaceMessageBlock> = [];

    // add divider.

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blockMicrosoftTeams.push(dividerBlock);

    // now add buttons.
    // View data.
    // Execute On Call
    // Acknowledge incident
    // Resolve data.
    // Change Incident State.
    // Add Note.

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view data.
    const viewIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Incident",
      url: await IncidentService.getIncidentLinkInDashboard(
        data.projectId!,
        data.incidentId!,
      ),
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.VIEW_INCIDENT,
    };

    buttons.push(viewIncidentButton);

    // execute on call.
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📞 Execute On Call",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.EXECUTE_INCIDENT_ON_CALL_POLICY,
    };

    buttons.push(executeOnCallButton);

    // acknowledge data.
    const acknowledgeIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge Incident",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ACKNOWLEDGE_INCIDENT,
    };

    buttons.push(acknowledgeIncidentButton);

    // resolve data.
    const resolveIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve Incident",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.RESOLVE_INCIDENT,
    };

    buttons.push(resolveIncidentButton);

    // change incident state.
    const changeIncidentStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "➡️ Change Incident State",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.VIEW_CHANGE_INCIDENT_STATE,
    };

    buttons.push(changeIncidentStateButton);

    // add note.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.CREATE_INCIDENT_NOTE,
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