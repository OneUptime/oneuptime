import ObjectID from "../../ObjectID";
import BaseNotificationRule from "./BaseNotificationRule";

export default interface CreateChannelNotificationRule extends BaseNotificationRule {
  _type: string; 

  // if filters match then do:
  shouldCreateNewChannel: boolean;
  inviteTeamsToNewChannel: Array<ObjectID>;
  inviteUsersToNewChannel: Array<ObjectID>;
  shouldInviteOwnersToNewChannel: boolean;
  newChannelTemplateName: string;
}
