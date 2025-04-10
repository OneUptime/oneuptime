import ObjectID from "../../ObjectID";
import BaseNotificationRule from "./BaseNotificationRule";

export default interface CreateChannelNotificationRule
  extends BaseNotificationRule {
  _type: string;

  // if filters match then do:
  shouldCreateNewChannel: boolean;
  inviteTeamsToNewChannel: Array<ObjectID>;
  inviteUsersToNewChannel: Array<ObjectID>;
  shouldInviteOwnersToNewChannel: boolean;
  newChannelTemplateName: string;

  // if selected this would archive channel when incident, alert, scheduled maintenance reaches the last state (is resolved)
  // This would only archive the channel which was created.
  archiveChannelAutomatically: boolean;
}
