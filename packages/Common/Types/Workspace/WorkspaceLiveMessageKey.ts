import ObjectID from "../ObjectID";
import { WorkspaceMessageBlock } from "./WorkspaceMessagePayload";

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
   * A fix OneUptime AI proposes for approval: its message in every place it
   * was posted (with the record's feed entry above its changes and
   * buttons), edited as people act on it - the first of two approvals, the
   * approval that runs it, a dismissal - so its buttons and its note never
   * read as if nothing happened (RemediationChatMessage).
   */
  RemediationFix = "RemediationFix",
  /*
   * A playbook step that waits for a person's approval: its message in the
   * channels and chats a Security Case rule names, and in each approver's
   * direct messages, edited once somebody decides - here, in another copy,
   * in the Dashboard or the mobile app - and as the step goes, so every copy
   * says who decided and what came of it
   * (WorkspaceSecurityPlaybookApprovalMessages).
   */
  SecurityPlaybookApproval = "SecurityPlaybookApproval",
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
  /*
   * A message posted with a record's feed entry above what it is about (a
   * fix's changes and buttons): the entry's own blocks, as they were
   * posted, which an edit keeps while it rewrites what follows them.
   */
  leadBlocks?: Array<WorkspaceMessageBlock> | undefined;
  /*
   * The language the message is written in, to write it in again when it
   * is edited: an approver's own direct message in theirs (a playbook
   * step's approval).
   */
  language?: string | undefined;
  /*
   * A direct message to one person (a playbook step's approval): who, the
   * workspace it was sent through (WorkspaceProjectAuthToken
   * .workspaceProjectId) - an edit goes only through the project's
   * connection to that same workspace - and, for a Microsoft Teams personal
   * chat the bot opened itself, the Bot Framework service it is at.
   */
  directMessageUserId?: string | undefined;
  workspaceProjectId?: string | undefined;
  serviceUrl?: string | undefined;
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

  // The messages of a fix that waits for approval, by its suggestion's id.
  public static forRemediationFix(suggestionId: ObjectID): string {
    return `${WorkspaceLiveMessageKind.RemediationFix}:${suggestionId.toString().toLowerCase()}`;
  }

  /*
   * The messages of a playbook step's approval: the run, and the step's
   * place in it - a step is asked about once in a run.
   */
  public static forSecurityPlaybookApproval(
    runId: ObjectID,
    stepIndex: number,
  ): string {
    return `${WorkspaceLiveMessageKind.SecurityPlaybookApproval}:${runId.toString().toLowerCase()}:${stepIndex}`;
  }
}
