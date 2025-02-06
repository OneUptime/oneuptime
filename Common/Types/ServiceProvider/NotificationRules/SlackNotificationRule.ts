import FilterCondition from "../../Filter/FilterCondition";
import ObjectID from "../../ObjectID";
import BaseNotificationRule from "./BaseNotificationRule";
import NotificationRuleCondition from "./NotificationRuleCondition";

export default interface SlackNotificationRule extends BaseNotificationRule {
  _type: "SlackNotificationRule";
  filterCondition: FilterCondition; // and OR or. Default is AND
  filters: Array<NotificationRuleCondition>; // if this array is empty then it will be considered as all filters are matched.

  newSlackChannel: {
    // if filters match then do:
    shouldCreateSlackChannel: boolean;
    inviteTeamsToSlackChannel: Array<ObjectID>;
    inviteUsersToSlackChannel: Array<ObjectID>;

    // This only applies to incident and alerts.
    shouldInviteOnCallUsersToSlackChannel: boolean;
  };

  postToExistingSlackChannel: {
    // if filters match then do:
    shouldPostToExistingSlackChannel: boolean;
    slackChannelName: Array<string>;
  };
}
