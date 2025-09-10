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

export default class MicrosoftTeamsMonitorMessages {
  @CaptureSpan()
  public static async getMonitorCreateMessageBlocks(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.monitorId) {
      throw new BadDataException("Monitor ID is required");
    }

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create monitor URL
    const monitorUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/monitors/${data.monitorId}`)
    );
    const monitorLink: string = monitorUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 📊 New Monitor Created\n\n[View Monitor Details](${monitorLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View monitor button
    const viewMonitorButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Monitor",
      url: monitorUrl,
      value: data.monitorId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewMonitor,
    };

    buttons.push(viewMonitorButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }

  @CaptureSpan()
  public static async getMonitorUpdateMessageBlocks(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.monitorId) {
      throw new BadDataException("Monitor ID is required");
    }

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create monitor URL
    const monitorUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/monitors/${data.monitorId}`)
    );
    const monitorLink: string = monitorUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 📝 Monitor Updated\n\n[View Monitor Details](${monitorLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View monitor button
    const viewMonitorButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Monitor",
      url: monitorUrl,
      value: data.monitorId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewMonitor,
    };

    buttons.push(viewMonitorButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }
}
