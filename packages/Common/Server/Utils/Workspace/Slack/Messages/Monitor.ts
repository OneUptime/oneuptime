import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
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

    /*
     * now add buttons.
     * View Monitor.
     */

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

    /*
     * The buttons go on the message as a block of their own, as on every
     * other record's message. They were built and never added, so a new
     * monitor's message - in Slack, and in Microsoft Teams, whose card is
     * drawn from these blocks - showed a divider and nothing to press.
     */
    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blockSlack.push(workspacePayloadButtons);

    return blockSlack;
  }
}
