import ObjectID from "../../../ObjectID";
import BaseNotificationRule from "../BaseNotificationRule";


export default interface ScheduledMaintenanceNotificationRule extends BaseNotificationRule {
  _type: "ScheduledMaintenanceNotificationRule";

  // if filters match then do:
  shouldCreateNewChannel: boolean;
  inviteTeamsToNewChannel: Array<ObjectID>;
  inviteUsersToNewChannel: Array<ObjectID>;

  shouldInviteOwnersToNewChannel: boolean;

}
