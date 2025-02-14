import CreateChannelNotificationRule from "../CreateChannelNotificationRule";

export default interface AlertNotificationRule
  extends CreateChannelNotificationRule {
  _type: "AlertNotificationRule";

  shouldAutomaticallyInviteOnCallUsersToNewChannel: boolean;
}
