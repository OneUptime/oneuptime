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
  /*
   * Who else joins the channel, as they join the record
   * (NotificationRuleInvites): its owners, and for an incident or an
   * incident episode the people given an incident role - the Incident
   * Commander and the others. A rule that does not say about roles adds them
   * when it adds owners or on-call responders.
   */
  shouldInviteOwnersToNewChannel: boolean;
  shouldInviteIncidentRolesToNewChannel?: boolean | undefined;
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
