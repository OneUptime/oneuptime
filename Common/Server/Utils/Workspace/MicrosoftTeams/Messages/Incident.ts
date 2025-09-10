import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import URL from "../../../../../Types/API/URL";
import MicrosoftTeamsActionType from "../Actions/ActionTypes";
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

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create incident URL
    const incidentUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/incidents/${data.incidentId}`)
    );
    const incidentLink: string = incidentUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 🚨 New Incident Created\n\n[View Incident Details](${incidentLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View incident button
    const viewIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Incident",
      url: incidentUrl,
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewIncident,
    };

    buttons.push(viewIncidentButton);

    // Execute on call policy button
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📞 Execute On Call",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewExecuteIncidentOnCallPolicy,
    };

    buttons.push(executeOnCallButton);

    // Acknowledge incident button
    const acknowledgeIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge Incident",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.AcknowledgeIncident,
    };

    buttons.push(acknowledgeIncidentButton);

    // Resolve incident button
    const resolveIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve Incident",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ResolveIncident,
    };

    buttons.push(resolveIncidentButton);

    // Change incident state button
    const changeIncidentStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "➡️ Change Incident State",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewChangeIncidentState,
    };

    buttons.push(changeIncidentStateButton);

    // Add note button
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "📄 Add Note",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewAddIncidentNote,
    };

    buttons.push(addNoteButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }

  @CaptureSpan()
  public static async getIncidentUpdateMessageBlocks(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.incidentId) {
      throw new BadDataException("Incident ID is required");
    }

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create incident URL
    const incidentUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/incidents/${data.incidentId}`)
    );
    const incidentLink: string = incidentUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 📝 Incident Updated\n\n[View Incident Details](${incidentLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons (same as create message)
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View incident button
    const viewIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Incident",
      url: incidentUrl,
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewIncident,
    };

    buttons.push(viewIncidentButton);

    // Acknowledge incident button
    const acknowledgeIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge Incident",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.AcknowledgeIncident,
    };

    buttons.push(acknowledgeIncidentButton);

    // Resolve incident button
    const resolveIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve Incident",
      value: data.incidentId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ResolveIncident,
    };

    buttons.push(resolveIncidentButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }
}
