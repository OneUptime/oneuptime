import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import MicrosoftTeamsActionType from "../../../../Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsOnCallDutyPolicyMessages {
  @CaptureSpan()
  public static async getOnCallDutyPolicyCreateMessageBlocks(data: {
    onCallDutyPolicyId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.onCallDutyPolicyId) {
      throw new BadDataException("On Call Policy ID is required");
    }

    // Microsoft Teams.

    const blockMicrosoftTeams: Array<WorkspaceMessageBlock> = [];

    // add divider.

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blockMicrosoftTeams.push(dividerBlock);

    // now add buttons.

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view data.
    const viewOnCallDutyPolicyButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View On-Call Policy",
      url: await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
        data.projectId!,
        data.onCallDutyPolicyId!,
      ),
      value: data.onCallDutyPolicyId?.toString() || "",
      actionId: MicrosoftTeamsActionType.VIEW_ON_CALL_DUTY_POLICY,
    };

    buttons.push(viewOnCallDutyPolicyButton);

    // update on call duty policy.
    const updateOnCallDutyPolicyButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "✏️ Update Policy",
      value: data.onCallDutyPolicyId?.toString() || "",
      actionId: MicrosoftTeamsActionType.UPDATE_ON_CALL_DUTY_POLICY,
    };

    buttons.push(updateOnCallDutyPolicyButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blockMicrosoftTeams.push(workspacePayloadButtons);

    return blockMicrosoftTeams;
  }
}