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

export default class MicrosoftTeamsOnCallDutyPolicyMessages {
  @CaptureSpan()
  public static async getOnCallDutyPolicyCreateMessageBlocks(data: {
    onCallDutyPolicyId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.onCallDutyPolicyId) {
      throw new BadDataException("On Call Duty Policy ID is required");
    }

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create on call duty policy URL
    const onCallDutyPolicyUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/on-call-duty/${data.onCallDutyPolicyId}`)
    );
    const onCallDutyPolicyLink: string = onCallDutyPolicyUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 📞 New On Call Duty Policy Created\n\n[View On Call Duty Policy Details](${onCallDutyPolicyLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View on call duty policy button
    const viewOnCallDutyPolicyButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View On Call Duty Policy",
      url: onCallDutyPolicyUrl,
      value: data.onCallDutyPolicyId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewOnCallPolicy,
    };

    buttons.push(viewOnCallDutyPolicyButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }

  @CaptureSpan()
  public static async getOnCallDutyPolicyUpdateMessageBlocks(data: {
    onCallDutyPolicyId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.onCallDutyPolicyId) {
      throw new BadDataException("On Call Duty Policy ID is required");
    }

    const blocks: Array<WorkspaceMessageBlock> = [];

    // Create on call duty policy URL
    const onCallDutyPolicyUrl: URL = new URL(
      (await import("../../../../../Types/API/Protocol")).default.HTTPS,
      "app.oneuptime.com",
      new (await import("../../../../../Types/API/Route")).default(`/dashboard/${data.projectId}/on-call-duty/${data.onCallDutyPolicyId}`)
    );
    const onCallDutyPolicyLink: string = onCallDutyPolicyUrl.toString();

    const titleBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `## 📝 On Call Duty Policy Updated\n\n[View On Call Duty Policy Details](${onCallDutyPolicyLink})`,
    };

    blocks.push(titleBlock);

    // Add divider
    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blocks.push(dividerBlock);

    // Create action buttons
    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // View on call duty policy button
    const viewOnCallDutyPolicyButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "🔗 View On Call Duty Policy",
      url: onCallDutyPolicyUrl,
      value: data.onCallDutyPolicyId?.toString() || "",
      actionId: MicrosoftTeamsActionType.ViewOnCallPolicy,
    };

    buttons.push(viewOnCallDutyPolicyButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blocks.push(workspacePayloadButtons);

    return blocks;
  }
}
