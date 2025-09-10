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

export default class MicrosoftTeamsAlertMessages {
  @CaptureSpan()
  public static async getAlertCreateMessageBlocks(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.alertId) {
      throw new BadDataException("Alert ID is required");
    }

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create alert URL
    const alertUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/alerts/${data.alertId}`)
    );
    const alertLink: string = alertUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 🚨 New Alert Created\n\n[View Alert Details](${alertLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View alert button
    const viewAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Alert",
      url: alertUrl,
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewAlert,
    };

    buttons.push(viewAlertButton);

    // Acknowledge alert button
    const acknowledgeAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge Alert",
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.AcknowledgeAlert,
    };

    buttons.push(acknowledgeAlertButton);

    // Resolve alert button
    const resolveAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve Alert",
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ResolveAlert,
    };

    buttons.push(resolveAlertButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }

  @CaptureSpan()
  public static async getAlertUpdateMessageBlocks(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.alertId) {
      throw new BadDataException("Alert ID is required");
    }

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create alert URL
    const alertUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/alerts/${data.alertId}`)
    );
    const alertLink: string = alertUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 📝 Alert Updated\n\n[View Alert Details](${alertLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons (same as create message)
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View alert button
    const viewAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Alert",
      url: alertUrl,
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewAlert,
    };

    buttons.push(viewAlertButton);

    // Acknowledge alert button
    const acknowledgeAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "👀 Acknowledge Alert",
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.AcknowledgeAlert,
    };

    buttons.push(acknowledgeAlertButton);

    // Resolve alert button
    const resolveAlertButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✅ Resolve Alert",
      value: data.alertId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ResolveAlert,
    };

    buttons.push(resolveAlertButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }
}
