import ObjectID from "../ObjectID";

/*
 * What a message OneUptime keeps up to date in a Slack or Microsoft Teams
 * channel is about (WorkspaceLiveMessage.messageKey). A channel holds at most
 * one such message per key: the key is how a later change finds the message
 * to edit, instead of posting another one.
 */
export enum WorkspaceLiveMessageKind {
  // The progress of one on-call policy run, edited as the run goes.
  OnCallPolicyRun = "OnCallPolicyRun",
  /*
   * Who OneUptime could not add to a channel it created, because they have
   * not connected their Slack account: one note per channel, naming
   * everybody, edited when somebody else joins the list.
   */
  ChannelMembersNotAdded = "ChannelMembersNotAdded",
  /*
   * Where somebody paged people from a chat - `/oneuptime page` - about a
   * record: the channel or chat each on-call run of that record is shown in
   * too, as one message edited as the run goes, beside the places the
   * record's own messages go. A row of this kind is a place, not a message:
   * its message id is empty, and each run's message there is a row of the
   * run's own key (OnCallPolicyRunMessage).
   */
  OnCallPageRequest = "OnCallPageRequest",
  /*
   * The first message about a record in an existing channel whose rule
   * keeps the record's messages in one thread
   * (BaseNotificationRule.shouldPostUpdatesInThread): every later message
   * about the record there is a reply to it. Never edited; kept so the
   * next message finds the thread (WorkspaceRecordThreads).
   */
  RecordThread = "RecordThread",
}

// How an on-call policy run's message told the run's ending, the first time.
export interface WorkspaceLiveMessageRunEnding {
  outcome: string;
  detail?: string | undefined;
}

// What a live message remembers between edits (WorkspaceLiveMessage.messageData).
export interface WorkspaceLiveMessageData {
  // The alarms the messages of an on-call policy run already raised.
  alarms?: Array<string> | undefined;
  /*
   * How an on-call policy run ended, as its message first told it: kept as
   * it was, however the record moves on after.
   */
  endedAs?: WorkspaceLiveMessageRunEnding | undefined;
  // The people a "could not be added to this channel" note names.
  userIds?: Array<string> | undefined;
  /*
   * An on-call run's message posted where somebody paged from a chat
   * (WorkspaceLiveMessageKind.OnCallPageRequest), rather than where the
   * record's messages go: it names what the page is about too, and keeps
   * its own alarms.
   */
  isPageRequestPlace?: boolean | undefined;
  // A page request place: the OneUptime user who paged from there.
  pagedByUserId?: string | undefined;
}

// Where in a workspace a live message sits.
export enum WorkspaceLiveMessageDestinationType {
  // A Slack channel, or a channel of a Microsoft Teams team.
  Channel = "Channel",
  // A Microsoft Teams group or personal chat.
  Chat = "Chat",
}

// The kinds of record a page from a chat can be about.
export enum WorkspaceLiveMessagePageRecordType {
  Incident = "incident",
  Alert = "alert",
}

export default class WorkspaceLiveMessageKey {
  public static forOnCallPolicyRun(executionLogId: ObjectID): string {
    return `${WorkspaceLiveMessageKind.OnCallPolicyRun}:${executionLogId.toString()}`;
  }

  public static forChannelMembersNotAdded(): string {
    return WorkspaceLiveMessageKind.ChannelMembersNotAdded;
  }

  /*
   * The places somebody paged from a chat about a record: "alert" or
   * "incident", and the record's id.
   */
  public static forOnCallPageRequest(
    recordType: WorkspaceLiveMessagePageRecordType,
    recordId: ObjectID,
  ): string {
    return `${WorkspaceLiveMessageKind.OnCallPageRequest}:${recordType}:${recordId.toString()}`;
  }

  /*
   * The thread of one record in the existing channels its rules keep it in
   * one thread in: the kind of record ("Incident", "Alert",
   * "ScheduledMaintenance", "IncidentEpisode", "AlertEpisode") and its id.
   */
  public static forRecordThread(
    recordType: string,
    recordId: ObjectID,
  ): string {
    return `${WorkspaceLiveMessageKind.RecordThread}:${recordType}:${recordId.toString()}`;
  }
}
