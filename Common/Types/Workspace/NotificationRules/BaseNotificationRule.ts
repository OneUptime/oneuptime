import FilterCondition from "../../Filter/FilterCondition";
import NotificationRuleCondition from "./NotificationRuleCondition";

export default interface BaseNotificationRule {
  _type: string;
  // filters for notification rule
  filterCondition: FilterCondition; // AND or OR. Default is AND
  filters: Array<NotificationRuleCondition>; // if this array is empty then it will be considered as all filters are matched.

  shouldPostToExistingChannel: boolean;
  existingChannelNames: string; // separate by comma
  existingTeam?: string; // team to post to (for MS Teams only)

  // Post to group / personal chats (for MS Teams only).
  shouldPostToExistingChat?: boolean;
  existingChatIds?: Array<string>; // Teams chat ids the OneUptime app has been added to.
}
