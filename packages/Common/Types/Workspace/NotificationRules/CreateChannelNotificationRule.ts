import ObjectID from "../../ObjectID";
import BaseNotificationRule from "./BaseNotificationRule";

export default interface CreateChannelNotificationRule
  extends BaseNotificationRule {
  _type: string;

  // if filters match then do:
  shouldCreateNewChannel: boolean;
  teamToCreateChannelIn?: string; // team to create new channel in (for MS Teams)
  inviteTeamsToNewChannel: Array<ObjectID>;
  inviteUsersToNewChannel: Array<ObjectID>;
  shouldInviteOwnersToNewChannel: boolean;
  /*
   * The prefix of the channels the rule creates (Channel Name Prefix in the
   * rule form): prod- names incident INC-42's channel prod-inc-42. Optional:
   * without one - empty, or only spaces - the channel is the record's own
   * name, inc-42 (Utils/Workspace/WorkspaceChannelName).
   */
  newChannelTemplateName?: string | undefined;

  /*
   * if selected this would archive channel when incident, alert, scheduled maintenance reaches the last state (is resolved)
   * This would only archive the channel which was created.
   */
  archiveChannelAutomatically: boolean;
}
