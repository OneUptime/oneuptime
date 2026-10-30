import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Dictionary from "../../../Types/Dictionary";
import NotImplementedException from "../../../Types/Exception/NotImplementedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceChannelInvitationPayload from "../../../Types/Workspace/WorkspaceChannelInvitationPayload";
import WorkspaceMessagePayload, {
  WorkspaceCheckboxBlock,
  WorkspaceDatePickerBlock,
  WorkspaceDateTimePickerBlock,
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspaceModalBlock,
  WorkspaceNumberInputBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadContext,
  WorkspacePayloadHeader,
  WorkspacePayloadImage,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import logger from "../Logger";
import URL from "../../../Types/API/URL";
import CaptureSpan from "../Telemetry/CaptureSpan";

export interface WorkspaceThread {
  channel: WorkspaceChannel;
  threadId: string;
  /*
   * The message this one was posted as a reply to (Slack's thread_ts).
   * Not there for a message of its own in the channel.
   */
  parentThreadId?: string | undefined;
}

export interface WorkspaceSendMessageResponse {
  threads: Array<WorkspaceThread>;
  workspaceType: WorkspaceType;
  errors?: Array<{
    channel: WorkspaceChannel;
    error: string;
  }>;
}

export interface WorkspaceChannel {
  id: string;
  name: string;
  workspaceType: WorkspaceType;
  teamId?: string; // Required for Microsoft Teams
  /*
   * Microsoft Teams only: "standard" | "private" | "shared". Bots cannot post
   * to shared channels at all, and a private channel needs the app installed
   * into that channel specifically rather than into the parent team.
   */
  membershipType?: string | undefined;
  /*
   * An existing channel a matching rule keeps each record's messages in
   * one thread in (BaseNotificationRule.shouldPostUpdatesInThread).
   */
  postsUpdatesInThread?: boolean | undefined;
}

/*
 * A channel the workspace is asked to create (createChannel): its name and,
 * for Microsoft Teams, the team it is created in.
 */
export interface WorkspaceChannelToCreate {
  channelName: string;
  teamId?: string | undefined;
}

/*
 * Where a message OneUptime keeps up to date sits, as the workspace needs it
 * to edit the message: the channel (or Microsoft Teams chat) and, for a
 * Teams channel, its team.
 */
export interface WorkspaceMessageLocation {
  channelId: string;
  teamId?: string | undefined;
  // A Microsoft Teams group or personal chat, rather than a channel.
  isChat?: boolean | undefined;
}

export default class WorkspaceBase {
  /*
   * A readable, non-empty message for whatever a send path threw. The
   * providers do not only throw Errors: Slack's sendPayloadBlocksToChannel,
   * joinChannel and isUserInChannel `throw response`, an HTTPErrorResponse,
   * which is not an Error but exposes a `message` getter. Stringifying that
   * gave "[object Object]" in user-facing test errors and in Notification
   * Logs, so each shape is unwrapped here, and a response with no message
   * still reports its HTTP status rather than nothing.
   */
  public static getSendErrorMessage(err: unknown): string {
    const unknownErrorMessage: string = "Unknown error";

    if (err === null || err === undefined) {
      return unknownErrorMessage;
    }

    if (err instanceof Error) {
      return err.message || unknownErrorMessage;
    }

    if (err instanceof HTTPErrorResponse) {
      return err.message || `Request failed with HTTP status ${err.statusCode}`;
    }

    if (typeof err === "string") {
      return err || unknownErrorMessage;
    }

    if (typeof err === "object") {
      const message: unknown = (err as { message?: unknown }).message;

      if (typeof message === "string" && message) {
        return message;
      }
    }

    return String(err);
  }

  /*
   * Edits a message the bot posted, in place: it keeps its place in the
   * channel and nobody is notified again (Slack chat.update, Microsoft Teams
   * updateActivity). Throws what the workspace answered when it refuses.
   */
  @CaptureSpan()
  public static async updateMessage(_data: {
    authToken: string;
    projectId: ObjectID;
    location: WorkspaceMessageLocation;
    messageId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    // What a notification or a screen reader shows of the message.
    text?: string | undefined;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  /*
   * Whether an edit failed because the message is no longer there - somebody
   * deleted it - so a new one has to be posted instead. Any other failure
   * (the channel is archived, the app was removed, a network error) is not:
   * posting again would fail the same way, or post twice.
   */
  public static isMessageGoneError(_error: unknown): boolean {
    return false;
  }

  /*
   * Whether creating a channel failed because a channel has that name
   * already - one in use, an archived or deleted one the workspace keeps the
   * name of, another project's - so it can be created under another name
   * (WorkspaceNotificationRuleService tries name-2, name-3 and so on). Any
   * other refusal is not: another name would be refused the same way.
   */
  public static isChannelNameTakenError(_error: unknown): boolean {
    return false;
  }

  @CaptureSpan()
  public static async doesChannelExist(_data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
    teamId?: string;
  }): Promise<boolean> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async archiveChannels(_data: {
    channelIds: Array<string>;
    authToken: string;
    userId: string;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
    projectId: ObjectID;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async getUsernameFromUserId(_data: {
    authToken: string;
    userId: string;
    projectId: ObjectID;
  }): Promise<string | null> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async showModalToUser(_data: {
    authToken: string;
    triggerId: string;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getCheckboxBlock(_data: {
    payloadCheckboxBlock: WorkspaceCheckboxBlock;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static sendDirectMessageToUser(_data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async joinChannel(_data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async sendPayloadBlocksToChannel(_data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
    // What a notification or a screen reader shows of the message.
    text?: string | undefined;
    // Posted as a reply in the thread of this message (Slack's thread_ts).
    threadTs?: string | undefined;
    // A reply shown in the channel as well (Slack's reply_broadcast).
    replyBroadcast?: boolean | undefined;
  }): Promise<WorkspaceThread> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async inviteUsersToChannels(data: {
    authToken: string;
    workspaceChannelInvitationPayload: WorkspaceChannelInvitationPayload;
    projectId: ObjectID;
  }): Promise<void> {
    for (const channelName of data.workspaceChannelInvitationPayload
      .channelNames) {
      await this.inviteUsersToChannel({
        authToken: data.authToken,
        channelName: channelName,
        workspaceUserIds:
          data.workspaceChannelInvitationPayload.workspaceUserIds,
        projectId: data.projectId,
      });
    }
  }

  @CaptureSpan()
  public static async inviteUsersToChannel(data: {
    authToken: string;
    channelName: string;
    workspaceUserIds: Array<string>;
    projectId: ObjectID;
  }): Promise<void> {
    for (const userId of data.workspaceUserIds) {
      await this.inviteUserToChannelByChannelName({
        authToken: data.authToken,
        channelName: data.channelName,
        workspaceUserId: userId,
        projectId: data.projectId,
      });
    }
  }

  @CaptureSpan()
  public static async inviteUserToChannelByChannelName(_data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
    projectId: ObjectID;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getDateTimePickerBlock(_data: {
    payloadDateTimePickerBlock: WorkspaceDateTimePickerBlock;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getDatePickerBlock(_data: {
    payloadDatePickerBlock: WorkspaceDatePickerBlock;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getNumberInputBlock(_data: {
    payloadNumberInputBlock: WorkspaceNumberInputBlock;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async inviteUserToChannelByChannelId(_data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {}

  @CaptureSpan()
  public static async createChannelsIfDoesNotExist(_data: {
    authToken: string;
    channelNames: Array<string>;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceChannel>> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async getWorkspaceChannelFromChannelId(_data: {
    authToken: string;
    channelId: string;
    teamId?: string;
  }): Promise<WorkspaceChannel> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async sendMessage(_data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string; // which auth token should we use to send.
    userId: string;
    projectId: ObjectID;
    teamId?: string;
  }): Promise<WorkspaceSendMessageResponse> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async getAllWorkspaceChannels(_data: {
    authToken: string;
    projectId: ObjectID;
  }): Promise<Dictionary<WorkspaceChannel>> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async getWorkspaceChannelFromChannelName(_data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async createChannel(_data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
    isPrivate?: boolean;
  }): Promise<WorkspaceChannel> {
    throw new NotImplementedException();
  }

  /*
   * Whether the workspace creates two channels it is asked for as one
   * channel, and so refuses to create the second. Names are taken as they
   * are here; a workspace that changes the names it is given compares them
   * as it changes them.
   */
  public static isSameChannelToCreate(
    channel: WorkspaceChannelToCreate,
    otherChannel: WorkspaceChannelToCreate,
  ): boolean {
    return channel.channelName === otherChannel.channelName;
  }

  @CaptureSpan()
  public static getHeaderBlock(_data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getDividerBlock(): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getMarkdownBlock(_data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getButtonBlock(_data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    throw new NotImplementedException();
  }

  /*
   * Small, muted text under a message (WorkspacePayloadContext). A
   * workspace with no such block of its own draws it as plain Markdown.
   */
  @CaptureSpan()
  public static getContextBlock(data: {
    payloadContextBlock: WorkspacePayloadContext;
  }): JSONObject {
    return this.getMarkdownBlock({
      payloadMarkdownBlock: {
        _type: "WorkspacePayloadMarkdown",
        text: data.payloadContextBlock.text,
      },
    });
  }

  @CaptureSpan()
  public static getBlocksFromWorkspaceMessagePayload(data: {
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Array<JSONObject> {
    const { messageBlocks } = data;

    const blocks: Array<JSONObject> = [];
    for (const block of messageBlocks) {
      switch (block._type) {
        case "WorkspacePayloadHeader":
          blocks.push(
            this.getHeaderBlock({
              payloadHeaderBlock: block as WorkspacePayloadHeader,
            }),
          );
          break;
        case "WorkspacePayloadMarkdown":
          blocks.push(
            this.getMarkdownBlock({
              payloadMarkdownBlock: block as WorkspacePayloadMarkdown,
            }),
          );
          break;
        case "WorkspacePayloadDivider":
          blocks.push(this.getDividerBlock());
          break;
        case "WorkspacePayloadContext":
          blocks.push(
            this.getContextBlock({
              payloadContextBlock: block as WorkspacePayloadContext,
            }),
          );
          break;
        case "WorkspacePayloadButtons":
          blocks.push(
            this.getButtonsBlock({
              payloadButtonsBlock: block as WorkspacePayloadButtons,
            }),
          );
          break;
        case "WorkspaceTextAreaBlock":
          blocks.push(
            this.getTextAreaBlock({
              payloadTextAreaBlock: block as WorkspaceTextAreaBlock,
            }),
          );
          break;
        case "WorkspaceTextBoxBlock":
          blocks.push(
            this.getTextBoxBlock({
              payloadTextBoxBlock: block as WorkspaceTextBoxBlock,
            }),
          );
          break;
        case "WorkspacePayloadImage":
          blocks.push(
            this.getImageBlock({
              payloadImageBlock: block as WorkspacePayloadImage,
            }),
          );
          break;
        case "WorkspaceDropdownBlock":
          blocks.push(
            this.getDropdownBlock({
              payloadDropdownBlock: block as WorkspaceDropdownBlock,
            }),
          );
          break;
        case "WorkspaceModalBlock":
          blocks.push(
            this.getModalBlock({
              payloadModalBlock: block as WorkspaceModalBlock,
            }),
          );
          break;
        case "WorkspaceDateTimePickerBlock":
          blocks.push(
            this.getDateTimePickerBlock({
              payloadDateTimePickerBlock: block as WorkspaceDateTimePickerBlock,
            }),
          );
          break;
        case "WorkspaceDatePickerBlock":
          blocks.push(
            this.getDatePickerBlock({
              payloadDatePickerBlock: block as WorkspaceDatePickerBlock,
            }),
          );
          break;
        case "WorkspaceNumberInputBlock":
          blocks.push(
            this.getNumberInputBlock({
              payloadNumberInputBlock: block as WorkspaceNumberInputBlock,
            }),
          );
          break;
        default:
          logger.error("Unknown block type: " + block._type, {
            blockType: block._type,
          });
          break;
      }
    }
    return blocks;
  }

  @CaptureSpan()
  public static getTextAreaBlock(_data: {
    payloadTextAreaBlock: WorkspaceTextAreaBlock;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getTextBoxBlock(_data: {
    payloadTextBoxBlock: WorkspaceTextBoxBlock;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getImageBlock(_data: {
    payloadImageBlock: WorkspacePayloadImage;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getDropdownBlock(_data: {
    payloadDropdownBlock: WorkspaceDropdownBlock;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getModalBlock(_data: {
    payloadModalBlock: WorkspaceModalBlock;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static getButtonsBlock(_data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async sendMessageToChannelViaIncomingWebhook(_data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    throw new NotImplementedException();
  }

  @CaptureSpan()
  public static async isUserInChannel(_data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    throw new NotImplementedException();
  }
}
