import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import IncidentService from "../../../../Services/IncidentService";
import SlackActionType from "../../../../Utils/Workspace/Slack/Actions/ActionTypes";

export default class SlackIncidentMessages {
  public static async getIncidentCreateMessageBlocks(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.incidentId) {
      throw new BadDataException("Incident ID is required");
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
        data.projectId!,
      ),
      value: data.projectId?.toString() || "",
      actionId: SlackActionType.ViewIncident,
    };

    buttons.push(viewIncidentButton);

    // execute on call.
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📞 Execute On Call",
      value: "execute_on_call",
      actionId: SlackActionType.ViewExecuteIncidentOnCallPolicy,
    };

    buttons.push(executeOnCallButton);

    // acknowledge data.
    const acknowledgeIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge Incident",
      value: data.projectId?.toString() || "",
      actionId: SlackActionType.AcknowledgeIncident,
    };

    buttons.push(acknowledgeIncidentButton);

    // resolve data.
    const resolveIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve Incident",
      value: data.projectId?.toString() || "",
      actionId: SlackActionType.ResolveIncident,
    };

    buttons.push(resolveIncidentButton);

    // change incident state.
    const changeIncidentStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "➡️ Change Incident State",
      value: data.projectId?.toString() || "",
      actionId: SlackActionType.ViewChangeIncidentState,
    };

    buttons.push(changeIncidentStateButton);

    // add note.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: data.projectId?.toString() || "",
      actionId: SlackActionType.ViewAddIncidentNote,
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
