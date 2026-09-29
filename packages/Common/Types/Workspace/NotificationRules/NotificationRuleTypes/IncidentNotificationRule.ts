import CreateChannelNotificationRule from "../CreateChannelNotificationRule";

export default interface IncidentNotificationRule
  extends CreateChannelNotificationRule {
  _type: "IncidentNotificationRule";

  shouldAutomaticallyInviteOnCallUsersToNewChannel: boolean;
}
