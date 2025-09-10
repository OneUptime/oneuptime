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

export default class MicrosoftTeamsScheduledMaintenanceMessages {
  @CaptureSpan()
  public static async getScheduledMaintenanceCreateMessageBlocks(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.scheduledMaintenanceId) {
      throw new BadDataException("Scheduled Maintenance ID is required");
    }

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create scheduled maintenance URL
    const scheduledMaintenanceUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/scheduled-maintenance-events/${data.scheduledMaintenanceId}`)
    );
    const scheduledMaintenanceLink: string = scheduledMaintenanceUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 🔧 Scheduled Maintenance Created\n\n[View Scheduled Maintenance Details](${scheduledMaintenanceLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View scheduled maintenance button
    const viewScheduledMaintenanceButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Scheduled Maintenance",
      url: scheduledMaintenanceUrl,
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewScheduledMaintenance,
    };

    buttons.push(viewScheduledMaintenanceButton);

    // Mark as ongoing button
    const markAsOngoingButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "▶️ Mark as Ongoing",
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: MicrosoftTeamsActionType.MarkScheduledMaintenanceAsOngoing,
    };

    buttons.push(markAsOngoingButton);

    // Mark as completed button
    const markAsCompletedButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Mark as Completed",
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: MicrosoftTeamsActionType.MarkScheduledMaintenanceAsComplete,
    };

    buttons.push(markAsCompletedButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }

  @CaptureSpan()
  public static async getScheduledMaintenanceUpdateMessageBlocks(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.scheduledMaintenanceId) {
      throw new BadDataException("Scheduled Maintenance ID is required");
    }

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create scheduled maintenance URL
    const scheduledMaintenanceUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/scheduled-maintenance-events/${data.scheduledMaintenanceId}`)
    );
    const scheduledMaintenanceLink: string = scheduledMaintenanceUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 📝 Scheduled Maintenance Updated\n\n[View Scheduled Maintenance Details](${scheduledMaintenanceLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons (same as create message)
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View scheduled maintenance button
    const viewScheduledMaintenanceButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Scheduled Maintenance",
      url: scheduledMaintenanceUrl,
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewScheduledMaintenance,
    };

    buttons.push(viewScheduledMaintenanceButton);

    // Mark as ongoing button
    const markAsOngoingButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "▶️ Mark as Ongoing",
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: MicrosoftTeamsActionType.MarkScheduledMaintenanceAsOngoing,
    };

    buttons.push(markAsOngoingButton);

    // Mark as completed button
    const markAsCompletedButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Mark as Completed",
      value: data.scheduledMaintenanceId?.toString() || "",
      actionId: MicrosoftTeamsActionType.MarkScheduledMaintenanceAsComplete,
    };

    buttons.push(markAsCompletedButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }
}
