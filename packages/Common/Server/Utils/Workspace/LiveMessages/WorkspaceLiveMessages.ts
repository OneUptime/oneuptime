import crypto from "crypto";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../../../Types/ObjectID";
import {
  WorkspaceLiveMessageData,
  WorkspaceLiveMessageDestinationType,
} from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import WorkspaceLiveMessageService from "../../../Services/WorkspaceLiveMessageService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceUtil from "../Workspace";
import WorkspaceRecordThreads from "../WorkspaceRecordThreads";
import WorkspaceBase, {
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";

// What an edit of a kept message came to.
export enum WorkspaceLiveMessageEdit {
  // It already said this: nothing was sent.
  Unchanged = "Unchanged",
  // Edited in place.
  Updated = "Updated",
  // It had been deleted, so it was posted again in the same place.
  Reposted = "Reposted",
  // The workspace refused the edit (logged); the next change tries again.
  Failed = "Failed",
}

/*
 * THE MESSAGES ONEUPTIME KEEPS UP TO DATE IN SLACK AND MICROSOFT TEAMS.
 *
 * Some things OneUptime tells a channel change as they go - an on-call
 * policy run escalating, the list of people it could not add to a channel.
 * Each of those is ONE message, posted the first time and edited after that
 * (Slack chat.update, Teams updateActivity), so the channel reads the latest
 * state in one place and nobody is notified again for a change. A row of
 * WorkspaceLiveMessage per message remembers where it is and what it last
 * said; this class posts, keeps and edits them.
 *
 * Two changes to one message at the same moment - two workers handling two
 * steps of one run - would both find no message and post two, or edit out
 * of order. So the work on one message key is done one at a time
 * (withLock): in this process always, and across processes whenever Valkey
 * is reachable. Without Valkey it goes ahead with the local hold only, as
 * OneUptime's other optional locks do (StateChangeLock): a message edited
 * twice is better than a message never edited.
 */
export default class WorkspaceLiveMessages {
  public static readonly LOCK_NAMESPACE: string = "WorkspaceLiveMessage";

  // How long one holder may keep a message's key, and wait for it.
  public static readonly LOCK_TIMEOUT_IN_MS: number = 30_000;

  // The tail of the work waiting for each key in this process.
  private static localHolds: Map<string, Promise<void>> = new Map<
    string,
    Promise<void>
  >();

  // Runs `work` with `key` held, after whatever already holds it.
  public static async withLock<T>(
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const before: Promise<void> =
      WorkspaceLiveMessages.localHolds.get(key) || Promise.resolve();

    let giveBackLocal: () => void = (): void => {};

    const held: Promise<void> = new Promise<void>((resolve: () => void) => {
      giveBackLocal = resolve;
    });

    const tail: Promise<void> = before.then((): Promise<void> => {
      return held;
    });

    WorkspaceLiveMessages.localHolds.set(key, tail);

    try {
      await before;

      let mutex: SemaphoreMutex | null = null;

      try {
        mutex = await Semaphore.lock({
          key: key,
          namespace: WorkspaceLiveMessages.LOCK_NAMESPACE,
          lockTimeout: WorkspaceLiveMessages.LOCK_TIMEOUT_IN_MS,
          acquireTimeout: WorkspaceLiveMessages.LOCK_TIMEOUT_IN_MS,
        });
      } catch (err) {
        logger.debug(
          `Editing workspace message ${key} without the shared lock: ${WorkspaceBase.getSendErrorMessage(err)}`,
        );
      }

      try {
        return await work();
      } finally {
        if (mutex) {
          try {
            await Semaphore.release(mutex);
          } catch (err) {
            logger.debug(
              `Could not give back the lock of workspace message ${key}: ${WorkspaceBase.getSendErrorMessage(err)}`,
            );
          }
        }
      }
    } finally {
      giveBackLocal();

      if (WorkspaceLiveMessages.localHolds.get(key) === tail) {
        WorkspaceLiveMessages.localHolds.delete(key);
      }
    }
  }

  // What a message says, as a short hash: equal when the blocks are.
  public static getContentHash(
    messageBlocks: Array<WorkspaceMessageBlock>,
  ): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(messageBlocks))
      .digest("hex");
  }

  /*
   * Posts the message in every place a message about the record goes - the
   * channels OneUptime created for it, the channels and chats its matching
   * rules name - in every workspace the project is connected to, and keeps
   * each post. A place it cannot be posted in is logged in Notification Logs
   * and left out.
   */
  @CaptureSpan()
  public static async postEverywhere(data: {
    projectId: ObjectID;
    messageKey: string;
    notificationFor: NotificationFor;
    messageBlocks: Array<WorkspaceMessageBlock>;
    // What its notification shows (WorkspaceMessagePayload.text).
    text?: string | undefined;
    messageData?: WorkspaceLiveMessageData | undefined;
    // Where it is a reply in a record's thread, shown in the channel too.
    alsoSendToChannel?: boolean | undefined;
  }): Promise<Array<WorkspaceLiveMessage>> {
    const kept: Array<WorkspaceLiveMessage> = [];

    const workspaceTypes: Array<WorkspaceType> =
      await this.getConnectedWorkspaceTypes(data.projectId);

    for (const workspaceType of workspaceTypes) {
      let destinations: Array<WorkspaceMessagePayload> = [];

      try {
        destinations =
          await WorkspaceNotificationRuleService.getMessageDestinations({
            projectId: data.projectId,
            notificationFor: data.notificationFor,
            workspaceType: workspaceType,
          });
      } catch (err) {
        logger.error(
          `Could not read where messages about this record go in ${workspaceType}.`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        logger.error(err, {
          projectId: data.projectId.toString(),
        } as LogAttributes);
        continue;
      }

      for (const destination of destinations) {
        const keptMessage: WorkspaceLiveMessage | null = await this.postAndKeep(
          {
            projectId: data.projectId,
            messageKey: data.messageKey,
            destination: {
              ...destination,
              messageBlocks: data.messageBlocks,
              ...(data.text ? { text: data.text } : {}),
              ...(data.alsoSendToChannel ? { alsoSendToChannel: true } : {}),
            },
            messageData: data.messageData,
            notificationFor: data.notificationFor,
          },
        );

        if (keptMessage) {
          kept.push(keptMessage);
        }
      }
    }

    return kept;
  }

  /*
   * Posts the message in the one place `destination` names and keeps it.
   * Null when it could not be posted; with `notificationFor`, the post (or
   * its failure) is logged in Notification Logs as any other message is.
   * In a channel that keeps the record's messages in one thread, it is a
   * reply there once the thread has started (WorkspaceRecordThreads).
   */
  @CaptureSpan()
  public static async postAndKeep(data: {
    projectId: ObjectID;
    messageKey: string;
    destination: WorkspaceMessagePayload;
    messageData?: WorkspaceLiveMessageData | undefined;
    notificationFor?: NotificationFor | undefined;
  }): Promise<WorkspaceLiveMessage | null> {
    const recordThreadKey: string | null =
      data.destination.isRecordThread && data.notificationFor
        ? WorkspaceRecordThreads.getKey(data.notificationFor)
        : null;

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: data.projectId,
        messagePayloadsByWorkspace: [
          recordThreadKey
            ? {
                ...data.destination,
                threadTsByChannelId:
                  await WorkspaceRecordThreads.getThreadTsByChannelId({
                    projectId: data.projectId,
                    key: recordThreadKey,
                  }),
              }
            : data.destination,
        ],
      });

    if (data.notificationFor) {
      try {
        await WorkspaceNotificationRuleService.logSendResponses({
          projectId: data.projectId,
          notificationFor: data.notificationFor,
          responses: responses,
          messageBlocksByWorkspaceTypes: [
            {
              workspaceType: data.destination.workspaceType,
              messageBlocks: data.destination.messageBlocks,
            },
          ],
        });
      } catch (err) {
        logger.error("Could not log a workspace message.", {
          projectId: data.projectId.toString(),
        } as LogAttributes);
        logger.error(err, {
          projectId: data.projectId.toString(),
        } as LogAttributes);
      }
    }

    const thread: WorkspaceThread | undefined = responses[0]?.threads[0];

    if (!thread || !thread.channel?.id) {
      return null;
    }

    const isChat: boolean = Boolean(data.destination.chatIds?.length);

    const keptMessage: WorkspaceLiveMessage = new WorkspaceLiveMessage();
    keptMessage.projectId = data.projectId;
    keptMessage.workspaceType = data.destination.workspaceType;
    keptMessage.messageKey = data.messageKey;
    keptMessage.destinationType = isChat
      ? WorkspaceLiveMessageDestinationType.Chat
      : WorkspaceLiveMessageDestinationType.Channel;
    keptMessage.channelId = thread.channel.id.substring(0, 100);
    keptMessage.channelName = (thread.channel.name || "").substring(0, 100);

    const teamId: string | undefined =
      data.destination.teamId || thread.channel.teamId;

    if (teamId) {
      keptMessage.teamId = teamId.substring(0, 100);
    }

    /*
     * Kept even without an id (Microsoft Teams can answer a send without
     * one): it cannot be edited then, but it is not posted a second time.
     */
    keptMessage.messageId = (thread.threadId || "").substring(0, 100);
    keptMessage.contentHash = this.getContentHash(
      data.destination.messageBlocks,
    );

    if (data.messageData) {
      keptMessage.messageData = data.messageData;
    }

    try {
      return await WorkspaceLiveMessageService.create({
        data: keptMessage,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        "A workspace message was posted, but OneUptime could not remember it to update it later.",
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
      return null;
    }
  }

  /*
   * Edits a kept message to say `messageBlocks`. Nothing is sent when it says
   * that already (its content hash). A message somebody deleted is posted
   * again in the same place, as the workspace tells it (isMessageGoneError);
   * any other refusal is logged and left for the next change to try again.
   *
   * `messageData` is saved with the edit. A refused edit saves nothing, so
   * the next change tries it all again - unless `rememberIfNotEdited`: data
   * that records what was done beside the message rather than what it says
   * (an alarm the run has raised) is saved whatever came of the edit, or it
   * would be done again on every change.
   */
  @CaptureSpan()
  public static async updateKept(data: {
    keptMessage: WorkspaceLiveMessage;
    messageBlocks: Array<WorkspaceMessageBlock>;
    text?: string | undefined;
    messageData?: WorkspaceLiveMessageData | undefined;
    rememberIfNotEdited?: boolean | undefined;
  }): Promise<WorkspaceLiveMessageEdit> {
    const keptMessage: WorkspaceLiveMessage = data.keptMessage;
    const contentHash: string = this.getContentHash(data.messageBlocks);
    const logAttributes: LogAttributes = {
      projectId: keptMessage.projectId?.toString(),
      channelId: keptMessage.channelId,
    } as LogAttributes;

    const messageDataChanged: boolean =
      data.messageData !== undefined &&
      JSON.stringify(data.messageData) !==
        JSON.stringify(keptMessage.messageData || {});

    if (contentHash === keptMessage.contentHash || !keptMessage.messageId) {
      if (messageDataChanged) {
        await this.saveKept(keptMessage, {
          messageData: data.messageData!,
        });
      }

      return WorkspaceLiveMessageEdit.Unchanged;
    }

    const workspaceType: WorkspaceType = keptMessage.workspaceType!;

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: keptMessage.projectId!,
        workspaceType: workspaceType,
      });

    if (!projectAuth || !projectAuth.authToken) {
      logger.debug(
        `${workspaceType} is no longer connected: a kept message was not updated.`,
        logAttributes,
      );
      await this.rememberOnly(
        keptMessage,
        data.rememberIfNotEdited ? data.messageData : undefined,
        messageDataChanged,
      );
      return WorkspaceLiveMessageEdit.Failed;
    }

    const isChat: boolean =
      keptMessage.destinationType === WorkspaceLiveMessageDestinationType.Chat;

    const workspaceUtil: typeof WorkspaceBase =
      WorkspaceUtil.getWorkspaceTypeUtil(workspaceType);

    try {
      await workspaceUtil.updateMessage({
        authToken: projectAuth.authToken,
        projectId: keptMessage.projectId!,
        location: {
          channelId: keptMessage.channelId!,
          teamId: keptMessage.teamId || undefined,
          isChat: isChat,
        },
        messageId: keptMessage.messageId!,
        messageBlocks: data.messageBlocks,
        text: data.text,
      });
    } catch (err) {
      if (!workspaceUtil.isMessageGoneError(err)) {
        logger.error(
          `Could not update a ${workspaceType} message in place: ${WorkspaceBase.getSendErrorMessage(err)}`,
          logAttributes,
        );
        await this.rememberOnly(
          keptMessage,
          data.rememberIfNotEdited ? data.messageData : undefined,
          messageDataChanged,
        );
        return WorkspaceLiveMessageEdit.Failed;
      }

      /*
       * Posted again as a message of its own, also where it had been a
       * reply in a record's thread (WorkspaceRecordThreads).
       */
      logger.debug(
        `A kept ${workspaceType} message was deleted; posting it again.`,
        logAttributes,
      );

      const responses: Array<WorkspaceSendMessageResponse> =
        await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
          projectId: keptMessage.projectId!,
          messagePayloadsByWorkspace: [
            {
              _type: "WorkspaceMessagePayload",
              workspaceType: workspaceType,
              messageBlocks: data.messageBlocks,
              channelNames: [],
              channelIds: isChat ? [] : [keptMessage.channelId!],
              chatIds: isChat ? [keptMessage.channelId!] : [],
              teamId: keptMessage.teamId || undefined,
              ...(data.text ? { text: data.text } : {}),
            },
          ],
        });

      const thread: WorkspaceThread | undefined = responses[0]?.threads[0];

      if (!thread) {
        await this.rememberOnly(
          keptMessage,
          data.rememberIfNotEdited ? data.messageData : undefined,
          messageDataChanged,
        );
        return WorkspaceLiveMessageEdit.Failed;
      }

      await this.saveKept(keptMessage, {
        messageId: (thread.threadId || "").substring(0, 100),
        contentHash: contentHash,
        ...(data.messageData ? { messageData: data.messageData } : {}),
      });

      return WorkspaceLiveMessageEdit.Reposted;
    }

    await this.saveKept(keptMessage, {
      contentHash: contentHash,
      ...(data.messageData ? { messageData: data.messageData } : {}),
    });

    return WorkspaceLiveMessageEdit.Updated;
  }

  // The workspaces the project is connected to, Slack first.
  @CaptureSpan()
  public static async getConnectedWorkspaceTypes(
    projectId: ObjectID,
  ): Promise<Array<WorkspaceType>> {
    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.getProjectAuths({
        projectId: projectId,
      });

    return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams].filter(
      (workspaceType: WorkspaceType): boolean => {
        return projectAuths.some(
          (projectAuth: WorkspaceProjectAuthToken): boolean => {
            return (
              projectAuth.workspaceType === workspaceType &&
              Boolean(projectAuth.authToken)
            );
          },
        );
      },
    );
  }

  /*
   * Saves what a message remembers - and only that - when its edit did not
   * go through: the next change still finds the message saying what it
   * said, and edits it.
   */
  private static async rememberOnly(
    keptMessage: WorkspaceLiveMessage,
    messageData: WorkspaceLiveMessageData | undefined,
    messageDataChanged: boolean,
  ): Promise<void> {
    if (!messageData || !messageDataChanged) {
      return;
    }

    try {
      await this.saveKept(keptMessage, { messageData: messageData });
    } catch (err) {
      logger.error(
        `Could not remember what a workspace message raised: ${WorkspaceBase.getSendErrorMessage(err)}`,
        {
          projectId: keptMessage.projectId?.toString(),
          channelId: keptMessage.channelId,
        } as LogAttributes,
      );
    }
  }

  private static async saveKept(
    keptMessage: WorkspaceLiveMessage,
    changes: {
      messageId?: string;
      contentHash?: string;
      messageData?: WorkspaceLiveMessageData;
    },
  ): Promise<void> {
    if (changes.messageId !== undefined) {
      keptMessage.messageId = changes.messageId;
    }

    if (changes.contentHash !== undefined) {
      keptMessage.contentHash = changes.contentHash;
    }

    if (changes.messageData !== undefined) {
      keptMessage.messageData = changes.messageData;
    }

    await WorkspaceLiveMessageService.updateOneById({
      id: keptMessage.id!,
      data: {
        ...(changes.messageId !== undefined
          ? { messageId: changes.messageId }
          : {}),
        ...(changes.contentHash !== undefined
          ? { contentHash: changes.contentHash }
          : {}),
        ...(changes.messageData !== undefined
          ? { messageData: changes.messageData }
          : {}),
      },
      props: {
        isRoot: true,
      },
    });
  }
}
