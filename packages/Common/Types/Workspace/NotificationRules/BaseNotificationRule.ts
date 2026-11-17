import FilterCondition from "../../Filter/FilterCondition";
import NotificationRuleCondition from "./NotificationRuleCondition";
import { NotificationRuleUpdateKind } from "./NotificationRuleUpdates";

export default interface BaseNotificationRule {
  _type: string;
  // filters for notification rule
  filterCondition: FilterCondition; // AND or OR. Default is AND
  filters: Array<NotificationRuleCondition>; // if this array is empty then it will be considered as all filters are matched.

  shouldPostToExistingChannel: boolean;
  existingChannelNames: string; // separate by comma
  /*
   * Where the existing channels are: a Microsoft Teams team, a workspace of
   * a Slack Enterprise organization, or a team of the Mattermost server.
   * Slack and Mattermost rules may leave it empty for the default one.
   */
  existingTeam?: string;

  // Post to group / personal chats (for MS Teams only).
  shouldPostToExistingChat?: boolean;
  existingChatIds?: Array<string>; // Teams chat ids the OneUptime app has been added to.

  /*
   * The updates the rule posts in its channels and chats, for the kinds of
   * rule that choose them (NotificationRuleUpdates): left out, or null,
   * every update. The record's first message and a video call's Join button
   * are posted whatever it lists.
   *
   * null says every update out loud. A new rule of a kind that starts on
   * chosen updates - an on-call policy's - gets them when its JSON leaves
   * the list out, and an edit that leaves it out keeps the rule's (#7971):
   * null is how the API, Terraform and the Dashboard's Every update ask for
   * every update there (NotificationRuleUpdates.withNewRuleUpdates,
   * withKeptUpdates).
   */
  updatesToPost?: Array<NotificationRuleUpdateKind> | null | undefined;

  /*
   * On-call policy rules only: whether a hand-off's line mentions - so
   * notifies - the person who comes on call, by the account they connected
   * in the workspace (issue #7968). Off unless it is true: a channel that
   * hears every hand-off is not pinged by each one. Who is next is never
   * mentioned.
   */
  shouldMentionWhoIsOnCall?: boolean | undefined;
}
