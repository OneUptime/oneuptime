import FilterCondition from "../../Filter/FilterCondition";
import NotificationRuleCondition from "./NotificationRuleCondition";
import { NotificationRuleUpdateKind } from "./NotificationRuleUpdates";

export default interface BaseNotificationRule {
  _type: string;
  // filters for notification rule
  filterCondition: FilterCondition; // AND or OR. Default is AND
  filters: Array<NotificationRuleCondition>; // if this array is empty then it will be considered as all filters are matched.

  shouldPostToExistingChannel: boolean;
  existingChannelNames: string; // separate by comma
  /*
   * Where the existing channels are: a Microsoft Teams team, a workspace of
   * a Slack Enterprise organization, or a team of the Mattermost server.
   * Slack and Mattermost rules may leave it empty for the default one.
   */
  existingTeam?: string;

  // Post to group / personal chats (for MS Teams only).
  shouldPostToExistingChat?: boolean;
  existingChatIds?: Array<string>; // Teams chat ids the OneUptime app has been added to.

  /*
   * The updates the rule posts in its channels and chats, for the kinds of
   * rule that choose them (NotificationRuleUpdates): left out, every update.
   * The record's first message and a video call's Join button are posted
   * whatever it lists.
   */
  updatesToPost?: Array<NotificationRuleUpdateKind> | undefined;
}
