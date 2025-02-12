import ObjectID from "../../../ObjectID";
import BaseNotificationRule from "../BaseNotificationRule";


export default interface AlertNotificationRule extends BaseNotificationRule {
  _type: "AlertNotificationRule";

  // if filters match then do:
  shouldCreateNewChannel: boolean;
  inviteTeamsToNewChannel: Array<ObjectID>;
  inviteUsersToNewChannel: Array<ObjectID>;

  inviteOwnersToNewChannel: boolean;

  shouldAutomaticallyInviteOnCallUsersToNewChannel: boolean;

}
