import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import SlackActionType from "../Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class SlackIncidentMessages {
  @CaptureSpan()
  public static async getOnCallDutyPolicyCreateMessageBlocks(data: {
    onCallDutyPolicyId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.onCallDutyPolicyId) {
      throw new BadDataException("On Call Policy ID is required");
    }

    // Slack.

    const blockSlack: Array<WorkspaceMessageBlock> = [];

    // add divider.

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blockSlack.push(dividerBlock);

    // now add buttons.

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view data.
    const viewIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View On-Call Policy",
      url: await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
        data.projectId!,
        data.onCallDutyPolicyId!,
      ),
      value: data.onCallDutyPolicyId?.toString() || "",
      actionId: SlackActionType.ViewOnCallPolicy,
    };

    buttons.push(viewIncidentButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blockSlack.push(workspacePayloadButtons);

    return blockSlack;
  }
}
