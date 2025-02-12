import ObjectID from "../../../ObjectID";
import BaseNotificationRule from "../BaseNotificationRule";


export default interface IncidentNotificationRule extends BaseNotificationRule {
  _type: "IncidentNotificationRule";

  // if filters match then do:
  shouldCreateNewChannel: boolean;
  inviteTeamsToNewChannel: Array<ObjectID>;
  inviteUsersToNewChannel: Array<ObjectID>;


  inviteOwnersToNewChannel: boolean;

  shouldAutomaticallyInviteOnCallUsersToNewChannel: boolean;

}
