import FilterCondition from "../../Filter/FilterCondition";
import NotificationRuleCondition from "./NotificationRuleCondition";

export default interface BaseNotificationRule {
  _type: string;
  // filters for notification rule
  filterCondition: FilterCondition; // AND or OR. Default is AND
  filters: Array<NotificationRuleCondition>; // if this array is empty then it will be considered as all filters are matched.

  shouldPostToExistingChannel: boolean;
  existingChannelNames: string; // separate by comma
  existingTeam?: string; // team to post to (for MS Teams only)

  /*
   * Slack only: what is posted about one incident, alert, scheduled
   * maintenance or episode in the existing channels above goes into one
   * thread there - its created message starts the thread, every later
   * message is a reply to it, and a state change shows in the channel too
   * (WorkspaceRecordThreads). Off - or missing, in a rule saved before it
   * was offered - every message is a message of its own in the channel.
   */
  shouldPostUpdatesInThread?: boolean | undefined;

  // Post to group / personal chats (for MS Teams only).
  shouldPostToExistingChat?: boolean;
  existingChatIds?: Array<string>; // Teams chat ids the OneUptime app has been added to.
}
