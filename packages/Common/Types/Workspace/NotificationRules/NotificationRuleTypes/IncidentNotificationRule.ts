import CreateChannelNotificationRule from "../CreateChannelNotificationRule";
import VideoCallNotificationRule from "../VideoCallNotificationRule";

export default interface IncidentNotificationRule
  extends CreateChannelNotificationRule,
    VideoCallNotificationRule {
  _type: "IncidentNotificationRule";

  shouldAutomaticallyInviteOnCallUsersToNewChannel: boolean;
}
