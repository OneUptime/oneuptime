import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import MonitorService from "../../../../Services/MonitorService";
import MicrosoftTeamsActionType from "../../../../Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
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

    // Microsoft Teams.

    const blockMicrosoftTeams: Array<WorkspaceMessageBlock> = [];

    // add divider.

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blockMicrosoftTeams.push(dividerBlock);

    // now add buttons.
    // View data.
    // Run Monitor

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
      actionId: MicrosoftTeamsActionType.VIEW_MONITOR,
    };

    buttons.push(viewMonitorButton);

    // run monitor.
    const runMonitorButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "▶️ Run Monitor",
      value: data.monitorId?.toString() || "",
      actionId: MicrosoftTeamsActionType.RUN_MONITOR,
    };

    buttons.push(runMonitorButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blockMicrosoftTeams.push(workspacePayloadButtons);

    return blockMicrosoftTeams;
  }
}