import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import MonitorService from "../../../../Services/MonitorService";
import SlackActionType from "../../../../Utils/Workspace/Slack/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class SlackMonitorMessages {
  @CaptureSpan()
  public static async getMonitorCreateMessageBlocks(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.monitorId) {
      throw new BadDataException("Monitor ID is required");
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
    // Acknowledge Monitor
    // Resolve data.
    // Change Monitor State.
    // Add Note.

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view data.
    const viewMonitorButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View Monitor",
      url: await MonitorService.getMonitorLinkInDashboard(
        data.projectId!,
        data.monitorId!,
      ),
      value: data.monitorId?.toString() || "",
      actionId: SlackActionType.ViewMonitor,
    };

    buttons.push(viewMonitorButton);

    return blockSlack;
  }
}
