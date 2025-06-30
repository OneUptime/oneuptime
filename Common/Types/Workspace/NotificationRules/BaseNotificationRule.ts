import FilterCondition from "../../Filter/FilterCondition";
import NotificationRuleCondition from "./NotificationRuleCondition";

export default interface BaseNotificationRule {
  _type: string;
  // filters for notification rule
  filterCondition: FilterCondition; // AND or OR. Default is AND
  filters: Array<NotificationRuleCondition>; // if this array is empty then it will be considered as all filters are matched.

  shouldPostToExistingChannel: boolean;
  existingChannelNames: string; // separate by comma
}
