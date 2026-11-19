import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspacePostedMessage from "../../../Types/Workspace/WorkspacePostedMessage";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationLogService from "../../Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceUtil from "./Workspace";
import WorkspaceBase, {
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "./WorkspaceBase";
import WorkspaceInlineImages from "./WorkspaceInlineImages";

// A message OneUptime could not delete, and why, in OneUptime's words.
export interface WorkspaceMessageNotDeleted {
  message: WorkspacePostedMessage;
  reason: string;
}

// What deleting messages came to: each one deleted, or not and why.
export interface WorkspaceMessageDeletion {
  deleted: Array<WorkspacePostedMessage>;
  notDeleted: Array<WorkspaceMessageNotDeleted>;
}

/*
 * THE MESSAGES A SEND POSTED, AND TAKING THEM BACK.
 *
 * A record's feed entry goes to every Slack, Microsoft Teams and Mattermost
 * channel or chat its rules name (WorkspaceNotificationRuleService). Most
 * stay there for good. What OneUptime AI read in a call's transcript does
 * not: removing the transcript takes it back, so where each post went is
 * kept (fromSend), and deleted when the transcript goes (deleteAll), with
 * what Notification Logs kept of its text (forgetLoggedText).
 */
export default class WorkspacePostedMessages {
  /*
   * The most blocks a message goes out with as one post in every
   * workspace (WorkspaceLiveMessages.MAX_BLOCKS_IN_ONE_POST): a longer one
   * is several posts, and only the last one's id comes back, so OneUptime
   * cannot delete all of it.
   */
  public static readonly MAX_BLOCKS_IN_ONE_POST: number = 40;

  // Said of a message the workspace gave OneUptime no id for.
  public static readonly NO_MESSAGE_ID_REASON: string =
    "The workspace did not say which message it posted, so OneUptime cannot delete it.";

  /*
   * Where a send posted: one message for each channel or chat each payload
   * went to. Each response answers the payload at its place
   * (WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot). A message whose
   * id did not come back, or that went out as several posts, is kept with
   * no id: OneUptime cannot delete it, and says so when asked to.
   */
  public static fromSend(data: {
    payloads: Array<WorkspaceMessagePayload>;
    responses: Array<WorkspaceSendMessageResponse>;
  }): Array<WorkspacePostedMessage> {
    const posted: Array<WorkspacePostedMessage> = [];

    for (let index: number = 0; index < data.payloads.length; index++) {
      const payload: WorkspaceMessagePayload = data.payloads[index]!;
      const response: WorkspaceSendMessageResponse | undefined =
        data.responses[index];

      if (!response || response.workspaceType !== payload.workspaceType) {
        continue;
      }

      const isOnePost: boolean =
        WorkspaceInlineImages.splitMessageBlocks(payload.messageBlocks)
          .length <= WorkspacePostedMessages.MAX_BLOCKS_IN_ONE_POST;

      for (const thread of response.threads) {
        const message: WorkspacePostedMessage | null =
          WorkspacePostedMessages.fromThread({
            payload,
            thread,
            isOnePost,
          });

        if (message) {
          posted.push(message);
        }
      }
    }

    return posted;
  }

  /*
   * Deletes each message where it was posted, as the project's bot
   * (WorkspaceBase.deleteMessage). One already gone counts as deleted.
   * Never throws: a message that cannot be deleted - its workspace no
   * longer connected, its channel archived, the app removed from its team,
   * or no id to delete it by - is said, with why, and left where it is.
   */
  @CaptureSpan()
  public static async deleteAll(data: {
    projectId: ObjectID;
    messages: Array<WorkspacePostedMessage>;
  }): Promise<WorkspaceMessageDeletion> {
    const deletion: WorkspaceMessageDeletion = { deleted: [], notDeleted: [] };
    const authTokens: Map<WorkspaceType, string | null> = new Map<
      WorkspaceType,
      string | null
    >();
    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
    } as LogAttributes;

    for (const message of data.messages) {
      if (!message.messageId) {
        deletion.notDeleted.push({
          message,
          reason: WorkspacePostedMessages.NO_MESSAGE_ID_REASON,
        });
        continue;
      }

      let authToken: string | null | undefined = authTokens.get(
        message.workspaceType,
      );

      if (authToken === undefined) {
        authToken = await WorkspacePostedMessages.getAuthToken({
          projectId: data.projectId,
          workspaceType: message.workspaceType,
        });
        authTokens.set(message.workspaceType, authToken);
      }

      if (!authToken) {
        deletion.notDeleted.push({
          message,
          reason: `${getWorkspaceTypeDisplayName(message.workspaceType)} is no longer connected to this project, so OneUptime cannot delete its messages there.`,
        });
        continue;
      }

      try {
        const workspaceUtil: typeof WorkspaceBase =
          WorkspaceUtil.getWorkspaceTypeUtil(message.workspaceType);

        await workspaceUtil.deleteMessage({
          authToken,
          projectId: data.projectId,
          location: {
            channelId: message.channelId,
            ...(message.teamId ? { teamId: message.teamId } : {}),
            ...(message.isChat ? { isChat: true } : {}),
          },
          messageId: message.messageId,
        });

        deletion.deleted.push(message);
      } catch (error) {
        const reason: string = WorkspacePostedMessages.describeError(
          message.workspaceType,
          error,
        );

        logger.warn(
          `Could not delete a ${message.workspaceType} message: ${reason}`,
          logAttributes,
        );

        deletion.notDeleted.push({ message, reason });
      }
    }

    return deletion;
  }

  /*
   * What Notification Logs kept of each message - its text, which they
   * show to whoever reads the record's logs - replaced with `note`, and
   * what became of the message said beside it: deleted, or why not. Best
   * effort, never throws: a log row the retention has taken has nothing
   * left to forget.
   */
  @CaptureSpan()
  public static async forgetLoggedText(data: {
    projectId: ObjectID;
    deletion: WorkspaceMessageDeletion;
    // What the rows say instead of the message's text.
    note: string;
  }): Promise<void> {
    const rows: Array<{ message: WorkspacePostedMessage; status: string }> = [
      ...data.deletion.deleted.map(
        (
          message: WorkspacePostedMessage,
        ): { message: WorkspacePostedMessage; status: string } => {
          return {
            message,
            status: "Message posted to workspace channel, then deleted.",
          };
        },
      ),
      ...data.deletion.notDeleted.map(
        (
          notDeleted: WorkspaceMessageNotDeleted,
        ): { message: WorkspacePostedMessage; status: string } => {
          return {
            message: notDeleted.message,
            status:
              `Message posted to workspace channel. OneUptime could not delete it: ${notDeleted.reason}`.substring(
                0,
                500,
              ),
          };
        },
      ),
    ];

    for (const row of rows) {
      if (!row.message.messageId) {
        continue;
      }

      try {
        await WorkspaceNotificationLogService.updateBy({
          query: {
            projectId: data.projectId,
            workspaceType: row.message.workspaceType,
            channelId: row.message.channelId,
            threadId: row.message.messageId,
          },
          data: {
            message: data.note,
            statusMessage: row.status,
          },
          limit: 100,
          skip: 0,
          props: { isRoot: true, ignoreHooks: true },
        });
      } catch (error) {
        logger.error(
          `Could not forget what Notification Logs kept of a deleted ${row.message.workspaceType} message: ${error}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
      }
    }
  }

  /*
   * Where messages are, as a person finds them, each place once: "#inc-42
   * (Slack)", "Incidents (Microsoft Teams)". A Slack or Mattermost channel
   * reads with its "#"; a Teams channel and a chat by their name alone.
   */
  public static describePlaces(
    messages: Array<WorkspacePostedMessage>,
  ): Array<string> {
    const places: Array<string> = [];

    for (const message of messages) {
      const name: string = message.channelName || message.channelId;
      const isHashChannel: boolean =
        !message.isChat &&
        Boolean(message.channelName) &&
        !name.startsWith("#") &&
        message.workspaceType !== WorkspaceType.MicrosoftTeams;
      const place: string = `${isHashChannel ? `#${name}` : name} (${getWorkspaceTypeDisplayName(message.workspaceType)})`;

      if (!places.includes(place)) {
        places.push(place);
      }
    }

    return places;
  }

  private static fromThread(data: {
    payload: WorkspaceMessagePayload;
    thread: WorkspaceThread;
    isOnePost: boolean;
  }): WorkspacePostedMessage | null {
    const channelId: string | undefined = data.thread.channel?.id;

    if (!channelId) {
      return null;
    }

    const teamId: string | undefined =
      data.payload.teamId || data.thread.channel.teamId;
    const channelName: string | undefined = data.thread.channel.name;

    return {
      workspaceType: data.payload.workspaceType,
      channelId,
      ...(channelName ? { channelName } : {}),
      ...(teamId ? { teamId } : {}),
      ...((data.payload.chatIds || []).includes(channelId)
        ? { isChat: true }
        : {}),
      messageId: data.isOnePost ? data.thread.threadId || "" : "",
    };
  }

  private static async getAuthToken(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<string | null> {
    try {
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: data.workspaceType,
        });

      return projectAuth?.authToken || null;
    } catch (error) {
      logger.error(
        `Could not read the project's ${data.workspaceType} connection: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      return null;
    }
  }

  private static describeError(
    workspaceType: WorkspaceType,
    error: unknown,
  ): string {
    try {
      return WorkspaceUtil.getWorkspaceTypeUtil(workspaceType).describeError(
        error,
      );
    } catch {
      return WorkspaceBase.getSendErrorMessage(error);
    }
  }
}
