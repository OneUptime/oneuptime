import ProductBrandingText from "../ProductBrandingText";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../Types/Workspace/WorkspaceType";

// The "#" a Slack channel's name may be written with, once or more.
const SLACK_CHANNEL_PREFIX: RegExp = /^#+/;

/*
 * WHY A CHANNEL NAMED BY ITS NAME WAS NOT POSTED IN: IT COULD NOT BE FOUND.
 *
 * One sentence per workspace, said wherever the channel is left out - in
 * the Error row a rule's or a summary's Notification Logs get for it
 * (each workspace's sendMessage), and in what Test Rule refuses
 * (WorkspaceNotificationRuleService.testRule) - so a person meets the same
 * words for the same problem wherever they look.
 *
 * Slack said nothing of such a channel: its sendMessage left the channel
 * out, and the rule's Notification Logs showed nothing for it (#7115). A
 * Slack channel is named the way Slack writes it, with one "#" in front,
 * however the rule or summary wrote it; Mattermost's and Microsoft Teams'
 * are named as they were written, as before.
 */
export default class WorkspaceChannelNotFound {
  public static getReason(data: {
    workspaceType: WorkspaceType;
    // The channel's name, as the rule or summary names it.
    channelName: string;
  }): string {
    const channelName: string = (data.channelName || "").trim();
    const productName: string = ProductBrandingText.getProductName();

    if (data.workspaceType === WorkspaceType.Slack) {
      return `The Slack channel #${channelName.replace(SLACK_CHANNEL_PREFIX, "")} was not found. If it is a private channel, invite ${productName}'s bot to it in Slack.`;
    }

    if (data.workspaceType === WorkspaceType.Mattermost) {
      return `The Mattermost channel ${channelName} was not found. If it is a private channel, add ${productName}'s bot to it in Mattermost.`;
    }

    if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      return `Channel "${channelName}" was not found in this Microsoft Teams team. It may have been renamed or deleted.`;
    }

    return `The ${getWorkspaceTypeDisplayName(data.workspaceType)} channel ${channelName} was not found.`;
  }
}
