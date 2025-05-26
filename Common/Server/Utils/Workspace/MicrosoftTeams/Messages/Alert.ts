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
      value: data.alertId?.toString() || "", // For URL buttons, value might not be used or could be a fallback.
      actionId: MicrosoftTeamsActionType.ViewAlert, // This likely translates to an Action.OpenUrl
    };

    buttons.push(viewAlertButton);

    // execute on call.
    // This button's actionId suggests it might trigger another flow, possibly opening a task module or another card.
    // For Action.Execute, the 'data' payload would be crucial if it were handled by MicrosoftTeamsAlertActions.
    // For now, assuming it's handled differently based on its ActionType.
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📞 Execute On Call",
      value: JSON.stringify({ alertId: data.alertId.toString(), projectId: data.projectId.toString() }), // Example if it needed data
      actionId: MicrosoftTeamsActionType.ViewExecuteAlertOnCallPolicy,
    };

    buttons.push(executeOnCallButton);

    // acknowledge data.
    // For this to work with MicrosoftTeamsAlertActions, the downstream card generator must:
    // 1. Use "Action.Execute" as the type.
    // 2. Set the "id" of Action.Execute to "acknowledgeAlert" (or the string value of MicrosoftTeamsActionType.AcknowledgeAlert).
    // 3. Parse the JSON string in "value" and use it as the "data" object for Action.Execute.
    const acknowledgeAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge", // Keep title short for cards
      value: JSON.stringify({ alertId: data.alertId.toString(), projectId: data.projectId.toString() }),
      actionId: MicrosoftTeamsActionType.AcknowledgeAlert, // This should map to "acknowledgeAlert"
    };

    buttons.push(acknowledgeAlertButton);

    // resolve data.
    // Similar to Acknowledge, the card generator must ensure this becomes an Action.Execute
    // with id "resolveAlert" and the parsed 'value' as its 'data'.
    const resolveAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve", // Keep title short for cards
      value: JSON.stringify({ alertId: data.alertId.toString(), projectId: data.projectId.toString() }),
      actionId: MicrosoftTeamsActionType.ResolveAlert, // This should map to "resolveAlert"
    };

    buttons.push(resolveAlertButton);

    // change alert state.
    // Assuming this is handled differently, similar to executeOnCallButton.
    const changeAlertStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "➡️ Change Alert State",
      value: JSON.stringify({ alertId: data.alertId.toString(), projectId: data.projectId.toString() }), // Example if it needed data
      actionId: MicrosoftTeamsActionType.ViewChangeAlertState,
    };

    buttons.push(changeAlertStateButton);

    // add note.
    // Assuming this is handled differently.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: JSON.stringify({ alertId: data.alertId.toString(), projectId: data.projectId.toString() }), // Example if it needed data
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
// The 'Acknowledge' and 'Resolve' buttons (and potentially others if they use Action.Execute)
// are defined here with `actionId` and a JSON string in the `value` field.
// The service that converts these WorkspaceMessagePayloadButton objects into
// Microsoft Teams Adaptive Card actions needs to:
// 1. For buttons intended as Action.Execute (like Acknowledge, Resolve):
//    - Set the Adaptive Card action `type` to "Action.Execute".
//    - Set the Adaptive Card action `id` to the string value of `WorkspaceMessagePayloadButton.actionId`
//      (e.g., "acknowledgeAlert", "resolveAlert").
//    - Parse the JSON string from `WorkspaceMessagePayloadButton.value` and use the resulting
//      object as the `data` field for the Adaptive Card `Action.Execute`.
// 2. For buttons intended as Action.OpenUrl (like View Alert):
//    - Set the Adaptive Card action `type` to "Action.OpenUrl".
//    - Set the Adaptive Card action `url` to `WorkspaceMessagePayloadButton.url`.
// 3. Other action types (e.g., Action.Submit, Action.ShowCard) would need similar considerations
//    based on the properties of `WorkspaceMessagePayloadButton` and the desired Adaptive Card output.
// The current `WorkspaceMessagePayloadButton` type might need to be enhanced with a dedicated `data: JSONObject`
// field and a `buttonType: 'Action.Execute' | 'Action.OpenUrl'` field for clarity and type safety if this
// intermediate representation is heavily used for generating complex cards.
