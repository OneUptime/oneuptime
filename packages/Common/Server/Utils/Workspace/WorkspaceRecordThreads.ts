import WorkspaceLiveMessage from "../../../Models/DatabaseModels/WorkspaceLiveMessage";
import ObjectID from "../../../Types/ObjectID";
import Sleep from "../../../Types/Sleep";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageDestinationType,
  WorkspaceLiveMessageKind,
} from "../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import WorkspaceLiveMessageService from "../../Services/WorkspaceLiveMessageService";
import { NotificationFor } from "../../Services/WorkspaceNotificationRuleService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceLiveMessages from "./LiveMessages/WorkspaceLiveMessages";
import WorkspaceUtil from "./Workspace";
import { WorkspaceSendMessageResponse, WorkspaceThread } from "./WorkspaceBase";

/*
 * ONE THREAD PER RECORD IN A SHARED SLACK CHANNEL.
 *
 * A rule that posts to existing Slack channels can keep what it posts about
 * one incident, alert, scheduled maintenance or episode in one thread there
 * (BaseNotificationRule.shouldPostUpdatesInThread): the record's created
 * message starts the thread, every later message is a reply to it, and a
 * state change or an on-call alarm is shown in the channel too. Without the
 * switch nothing here runs.
 *
 * Each thread's first message is kept as a WorkspaceLiveMessage of the
 * record's key (WorkspaceLiveMessageKind.RecordThread), one row per channel.
 * Messages about one record are posted one at a time
 * (WorkspaceLiveMessages.withLock), so two at the same moment do not both
 * start a thread.
 *
 * The created message is not always the first: a monitor that raises an
 * incident adds its owners right away, and "owner added" is posted while
 * the incident's own message is still on its way. A message that finds no
 * thread waits for one (waitForThread) without holding up whoever posted
 * it - in this process only: a restart drops it. When none starts, it is
 * posted as a message of its own and starts the thread itself, as any
 * message does in a channel with no thread of the record: a record from
 * before the rule asked for threads, a rule that only started to match it,
 * a thread whose first message somebody deleted.
 */
export default class WorkspaceRecordThreads {
  // How long a message that finds no thread waits for one, and how often it looks.
  public static WAIT_FOR_THREAD_IN_MS: number = 60_000;
  public static WAIT_STEP_IN_MS: number = 2_000;

  /*
   * The key of the record's thread (WorkspaceLiveMessageKey.forRecordThread),
   * or null for what has no thread of its own: a monitor, an on-call policy.
   * The record types are WorkspaceNoteResourceType's.
   */
  public static getKey(notificationFor: NotificationFor): string | null {
    const records: Array<[string, ObjectID | undefined]> = [
      ["Incident", notificationFor.incidentId],
      ["Alert", notificationFor.alertId],
      ["ScheduledMaintenance", notificationFor.scheduledMaintenanceId],
      ["IncidentEpisode", notificationFor.incidentEpisodeId],
      ["AlertEpisode", notificationFor.alertEpisodeId],
    ];

    for (const [recordType, recordId] of records) {
      if (recordId) {
        return WorkspaceLiveMessageKey.forRecordThread(recordType, recordId);
      }
    }

    return null;
  }

  // The first message of the record's thread in each channel it has one in.
  @CaptureSpan()
  public static async getThreadTsByChannelId(data: {
    projectId: ObjectID;
    key: string;
  }): Promise<Record<string, string>> {
    return this.toThreadTsByChannelId(await this.findThreads(data));
  }

  /*
   * Waits until the record's thread has started in some channel, for at
   * most WAIT_FOR_THREAD_IN_MS. False when it did not.
   */
  @CaptureSpan()
  public static async waitForThread(data: {
    projectId: ObjectID;
    key: string;
  }): Promise<boolean> {
    const waitUntil: number = Date.now() + this.WAIT_FOR_THREAD_IN_MS;

    for (;;) {
      if ((await this.findThreads(data)).length > 0) {
        return true;
      }

      if (Date.now() >= waitUntil) {
        return false;
      }

      await Sleep.sleep(this.WAIT_STEP_IN_MS);
    }
  }

  /*
   * Posts the payloads - the existing Slack channels that keep the record's
   * messages in one thread (WorkspaceMessagePayload.isRecordThread) - as
   * replies in the record's thread in each channel. In a channel with no
   * thread, the message is one of its own and starts the thread there; so
   * does a reply Slack refused - the thread's first message deleted.
   */
  @CaptureSpan()
  public static async post(data: {
    projectId: ObjectID;
    key: string;
    payloads: Array<WorkspaceMessagePayload>;
    // Shown in the channel as well as in the thread.
    alsoSendToChannel?: boolean | undefined;
  }): Promise<Array<WorkspaceSendMessageResponse>> {
    return await WorkspaceLiveMessages.withLock(
      data.key,
      async (): Promise<Array<WorkspaceSendMessageResponse>> => {
        const threads: Array<WorkspaceLiveMessage> =
          await this.findThreads(data);

        const threadTsByChannelId: Record<string, string> =
          this.toThreadTsByChannelId(threads);

        let responses: Array<WorkspaceSendMessageResponse> =
          await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
            projectId: data.projectId,
            messagePayloadsByWorkspace: data.payloads.map(
              (payload: WorkspaceMessagePayload): WorkspaceMessagePayload => {
                return {
                  ...payload,
                  threadTsByChannelId: threadTsByChannelId,
                  alsoSendToChannel: data.alsoSendToChannel,
                };
              },
            ),
          });

        const refusedChannelIds: Array<string> = responses
          .flatMap((response: WorkspaceSendMessageResponse) => {
            return response.errors || [];
          })
          .map((error: { channel: { id: string } }): string => {
            return error.channel.id;
          })
          .filter((channelId: string): boolean => {
            return Boolean(threadTsByChannelId[channelId]);
          });

        if (refusedChannelIds.length > 0) {
          responses = [
            ...responses.map(
              (
                response: WorkspaceSendMessageResponse,
              ): WorkspaceSendMessageResponse => {
                return {
                  ...response,
                  errors: (response.errors || []).filter(
                    (error: { channel: { id: string } }): boolean => {
                      return !refusedChannelIds.includes(error.channel.id);
                    },
                  ),
                };
              },
            ),
            ...(await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
              projectId: data.projectId,
              messagePayloadsByWorkspace: [
                {
                  ...data.payloads[0]!,
                  channelNames: [],
                  channelIds: refusedChannelIds,
                },
              ],
            })),
          ];
        }

        await this.keepThreadsStarted({
          projectId: data.projectId,
          key: data.key,
          threads: threads,
          responses: responses,
        });

        return responses;
      },
    );
  }

  /*
   * The record whose thread a message in this channel is in: its type
   * (WorkspaceNoteResourceType) and id. The thread is asked for
   * (getThreadTs: Slack is read) only in a channel that keeps records'
   * messages in threads.
   */
  @CaptureSpan()
  public static async findRecordOfThread(data: {
    projectIdQuery: ObjectID | ReturnType<typeof QueryHelper.any>;
    channelId: string;
    getThreadTs: () => Promise<string | null>;
  }): Promise<{
    recordType: string;
    recordId: ObjectID;
    projectId: ObjectID;
  } | null> {
    const inThisChannel: Query<WorkspaceLiveMessage> = {
      projectId: data.projectIdQuery,
      workspaceType: WorkspaceType.Slack,
      channelId: data.channelId,
      messageKey: QueryHelper.startsWith(
        `${WorkspaceLiveMessageKind.RecordThread}:`,
      ),
    } as Query<WorkspaceLiveMessage>;

    const anyThread: WorkspaceLiveMessage | null =
      await WorkspaceLiveMessageService.findOneBy({
        query: inThisChannel,
        select: { _id: true },
        props: { isRoot: true },
      });

    if (!anyThread) {
      return null;
    }

    const threadTs: string | null = await data.getThreadTs();

    if (!threadTs) {
      return null;
    }

    const thread: WorkspaceLiveMessage | null =
      await WorkspaceLiveMessageService.findOneBy({
        query: {
          ...inThisChannel,
          messageId: threadTs,
        } as Query<WorkspaceLiveMessage>,
        select: { projectId: true, messageKey: true },
        props: { isRoot: true },
      });

    const [, recordType, recordId] = (thread?.messageKey || "").split(":");

    if (!thread?.projectId || !recordType || !recordId) {
      return null;
    }

    return {
      recordType: recordType,
      recordId: new ObjectID(recordId),
      projectId: thread.projectId,
    };
  }

  /*
   * A message posted as one of its own in a channel that keeps the record's
   * messages in one thread starts the thread there.
   */
  private static async keepThreadsStarted(data: {
    projectId: ObjectID;
    key: string;
    threads: Array<WorkspaceLiveMessage>;
    responses: Array<WorkspaceSendMessageResponse>;
  }): Promise<void> {
    for (const response of data.responses) {
      for (const sent of response.threads) {
        if (sent.parentThreadId || !sent.channel?.id || !sent.threadId) {
          continue;
        }

        try {
          await this.keepThreadStarted({
            projectId: data.projectId,
            key: data.key,
            sent: sent,
            kept: data.threads.find((thread: WorkspaceLiveMessage) => {
              return thread.channelId === sent.channel.id;
            }),
          });
        } catch (err) {
          logger.error(
            "A thread was started in a Slack channel, but OneUptime could not remember it: the next message starts another.",
            {
              projectId: data.projectId.toString(),
              channelId: sent.channel.id,
            } as LogAttributes,
          );
          logger.error(err, {
            projectId: data.projectId.toString(),
          } as LogAttributes);
        }
      }
    }
  }

  private static async keepThreadStarted(data: {
    projectId: ObjectID;
    key: string;
    sent: WorkspaceThread;
    kept: WorkspaceLiveMessage | undefined;
  }): Promise<void> {
    const messageId: string = data.sent.threadId.substring(0, 100);

    if (data.kept) {
      await WorkspaceLiveMessageService.updateOneById({
        id: data.kept.id!,
        data: {
          messageId: messageId,
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }

    const thread: WorkspaceLiveMessage = new WorkspaceLiveMessage();
    thread.projectId = data.projectId;
    thread.workspaceType = WorkspaceType.Slack;
    thread.messageKey = data.key;
    thread.destinationType = WorkspaceLiveMessageDestinationType.Channel;
    thread.channelId = data.sent.channel.id.substring(0, 100);
    thread.channelName = (data.sent.channel.name || "").substring(0, 100);
    thread.messageId = messageId;

    await WorkspaceLiveMessageService.create({
      data: thread,
      props: {
        isRoot: true,
      },
    });
  }

  private static toThreadTsByChannelId(
    threads: Array<WorkspaceLiveMessage>,
  ): Record<string, string> {
    const threadTsByChannelId: Record<string, string> = {};

    for (const thread of threads) {
      if (thread.channelId && thread.messageId) {
        threadTsByChannelId[thread.channelId] = thread.messageId;
      }
    }

    return threadTsByChannelId;
  }

  private static async findThreads(data: {
    projectId: ObjectID;
    key: string;
  }): Promise<Array<WorkspaceLiveMessage>> {
    return (
      await WorkspaceLiveMessageService.findByMessageKey({
        projectId: data.projectId,
        messageKey: data.key,
      })
    ).filter((row: WorkspaceLiveMessage): boolean => {
      return row.workspaceType === WorkspaceType.Slack;
    });
  }
}
