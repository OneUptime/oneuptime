import CreateChannelNotificationRule from "../CreateChannelNotificationRule";
import VideoCallNotificationRule from "../VideoCallNotificationRule";

export default interface AlertNotificationRule
  extends CreateChannelNotificationRule,
    VideoCallNotificationRule {
  _type: "AlertNotificationRule";

  shouldAutomaticallyInviteOnCallUsersToNewChannel: boolean;
}
