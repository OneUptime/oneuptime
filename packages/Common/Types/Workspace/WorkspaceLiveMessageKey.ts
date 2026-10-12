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
}

// What a live message remembers between edits (WorkspaceLiveMessage.messageData).
export interface WorkspaceLiveMessageData {
  // The alarms the messages of an on-call policy run already raised.
  alarms?: Array<string> | undefined;
  // The people a "could not be added to this channel" note names.
  userIds?: Array<string> | undefined;
}

// Where in a workspace a live message sits.
export enum WorkspaceLiveMessageDestinationType {
  // A Slack channel, or a channel of a Microsoft Teams team.
  Channel = "Channel",
  // A Microsoft Teams group or personal chat.
  Chat = "Chat",
}

export default class WorkspaceLiveMessageKey {
  public static forOnCallPolicyRun(executionLogId: ObjectID): string {
    return `${WorkspaceLiveMessageKind.OnCallPolicyRun}:${executionLogId.toString()}`;
  }

  public static forChannelMembersNotAdded(): string {
    return WorkspaceLiveMessageKind.ChannelMembersNotAdded;
  }
}
