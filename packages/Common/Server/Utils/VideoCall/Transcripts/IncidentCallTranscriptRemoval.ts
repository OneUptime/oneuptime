import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import VideoCallConnection from "../../../../Models/DatabaseModels/VideoCallConnection";
import WorkspaceNotificationLog from "../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { Gray500 } from "../../../../Types/BrandColors";
import ObjectID from "../../../../Types/ObjectID";
import {
  CallSummary,
  CallSummaryStatus,
  readCallSummary,
} from "../../../../Types/VideoCall/CallSummary";
import CallSummaryPosts, {
  CallSummaryPost,
} from "../../../../Types/VideoCall/CallSummaryPosts";
import VideoCallProvider, {
  getVideoCallLabel,
  getVideoCallProviderDisplayName,
} from "../../../../Types/VideoCall/VideoCallProvider";
import WorkspaceNotificationActionType from "../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspacePostedMessage from "../../../../Types/Workspace/WorkspacePostedMessage";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentVideoCallService, {
  TakenTranscript,
} from "../../../Services/IncidentVideoCallService";
import VideoCallConnectionService from "../../../Services/VideoCallConnectionService";
import WorkspaceNotificationLogService from "../../../Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import IncidentCallSummaryFeed from "../../AI/CallSummary/IncidentCallSummaryFeed";
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceMentions from "../../Workspace/WorkspaceMentions";
import WorkspaceMessageTime from "../../Workspace/WorkspaceMessageTime";
import WorkspacePostedMessages, {
  WorkspaceMessageDeletion,
  WorkspaceMessageNotDeleted,
} from "../../Workspace/WorkspacePostedMessages";

/*
 * A CALL'S TRANSCRIPT REMOVED, WITH WHAT ONEUPTIME AI READ IN IT, EVERYWHERE
 * IT WENT (issues #9289 and #9290).
 *
 * What OneUptime AI read in a transcript is stored on the call, and also
 * posted: an item in the incident's feed, and from there a message in each
 * of the incident's Slack, Microsoft Teams and Mattermost channels. The call
 * keeps where each reading went (CallSummaryPosts), and a removal takes all
 * of it back:
 *
 *   - Remove transcript, by a person (removeByPerson): the transcript, every
 *     reading of it on the call, each reading's feed item and channel
 *     messages, and the text Notification Logs kept of them.
 *   - The account whose sign-in read it removing OneUptime at the provider
 *     (Zoom's app_deauthorized, which asks apps to delete a removed user's
 *     data): what was read through that sign-in, the same way
 *     (removeForRemovedSignIn), by the Workers job within minutes of the
 *     event. A transcript a person added stays, and so do its readings.
 *   - The call itself deleted (takeBackDeletedCall): its readings' posts,
 *     as the transcript goes with the row.
 *
 * What stays, and is said to stay: the incident's root cause, which a
 * person saved as their own edit; a postmortem drafted from the call; the
 * feed's line that a transcript was added, which says only how long it
 * was; and a channel message OneUptime cannot delete - its workspace
 * disconnected, its channel archived, the app removed from its team - whose
 * place the removal names, so a person can delete it there. Each removal
 * says itself in the feed, so the incident's history reads what happened.
 *
 * A reading posted before calls kept where their readings went is found by
 * what it said: its feed item by its exact text, its channel messages by
 * the text Notification Logs kept of them, for as long as they keep it.
 */

// What a person's removal came to, for the dialog to say what stayed.
export interface TranscriptRemovalOutcome {
  // Whether anything was removed: a second removal finds nothing.
  removed: boolean;
  /*
   * Where a message about the transcript stays, because OneUptime could not
   * delete it there: "#inc-42 (Slack)".
   */
  messagesLeftIn: Array<string>;
  /*
   * What OneUptime AI read was posted to the incident's channels before
   * OneUptime kept where it posted: a message of it may stay that OneUptime
   * could not find.
   */
  mayHaveMessagesLeft: boolean;
}

// What a removal took back of the posts it was given.
interface PostsTakenBack {
  deletion: WorkspaceMessageDeletion;
}

// Why a call's transcript went, as its line in the feed says it.
export enum TranscriptRemovalReason {
  Person = "Person",
  SignInRemoved = "SignInRemoved",
  CallDeleted = "CallDeleted",
}

// The most calls the Workers job takes on in one run.
export const REMOVED_SIGN_IN_CALLS_PER_RUN: number = 100;

// The most legacy feed items or log rows one reading is looked for in.
const LEGACY_LOOKUP_LIMIT: number = 50;

export default class IncidentCallTranscriptRemoval {
  // What Notification Logs keep of a deleted message instead of its text.
  public static readonly FORGOTTEN_MESSAGE_NOTE: string =
    "What OneUptime AI read in a call's transcript. Removed with the transcript.";

  /*
   * Remove transcript, by a person who may (IncidentVideoCallAPI checked):
   * the transcript, what OneUptime AI read in it on the call, its posts in
   * the incident's feed and channels, and a line in the feed that says who
   * removed it. Says where a message stays.
   */
  @CaptureSpan()
  public static async removeByPerson(data: {
    callId: ObjectID;
    userId?: ObjectID | undefined;
  }): Promise<TranscriptRemovalOutcome> {
    const taken: TakenTranscript | null =
      await IncidentVideoCallService.takeTranscriptForRemoval({
        callId: data.callId,
      });

    if (!taken || (!taken.removedTranscript && taken.posts.length === 0)) {
      return { removed: false, messagesLeftIn: [], mayHaveMessagesLeft: false };
    }

    const notDeleted: Array<WorkspaceMessageNotDeleted> =
      await IncidentCallTranscriptRemoval.takeBack(taken);

    await IncidentCallTranscriptRemoval.announce({
      call: taken.call,
      reason: TranscriptRemovalReason.Person,
      userId: data.userId,
      removedTranscript: taken.removedTranscript,
    });

    return {
      removed: true,
      messagesLeftIn: WorkspacePostedMessages.describePlaces(
        notDeleted.map(
          (message: WorkspaceMessageNotDeleted): WorkspacePostedMessage => {
            return message.message;
          },
        ),
      ),
      mayHaveMessagesLeft:
        taken.untrackedReading &&
        (await IncidentCallTranscriptRemoval.hasConnectedWorkspace(
          taken.call.projectId!,
        )),
    };
  }

  /*
   * What the Workers job does every minute: deletes what was read through
   * the sign-ins whose accounts removed OneUptime, call by call
   * (removeForRemovedSignIn), the longest waiting first. A call that fails
   * stays marked, and is tried again on the next run. How many it took on.
   */
  @CaptureSpan()
  public static async removeForRemovedSignIns(): Promise<number> {
    const calls: Array<IncidentVideoCall> =
      await IncidentVideoCallService.getCallsOfRemovedSignIns(
        REMOVED_SIGN_IN_CALLS_PER_RUN,
      );

    for (const call of calls) {
      try {
        await IncidentCallTranscriptRemoval.removeForRemovedSignIn({
          callId: call.id!,
          signInAccountId: call.transcriptSignInAccountId || "",
        });
      } catch (error) {
        logger.error(
          `Could not delete what was read through a removed sign-in from an incident call; trying again on the next run: ${error}`,
          { videoCallId: call.id?.toString() } as LogAttributes,
        );
      }
    }

    return calls.length;
  }

  /*
   * What was read through `signInAccountId`'s sign-in, deleted from one
   * call now that the account removed OneUptime: the transcript, when it is
   * one OneUptime read through that sign-in, what OneUptime AI read in such
   * transcripts and their posts, and a line in the feed that says why.
   */
  @CaptureSpan()
  public static async removeForRemovedSignIn(data: {
    callId: ObjectID;
    signInAccountId: string;
  }): Promise<void> {
    const taken: TakenTranscript | null =
      await IncidentVideoCallService.takeTranscriptForRemoval({
        callId: data.callId,
        signInAccountId: data.signInAccountId,
      });

    if (!taken || (!taken.removedTranscript && taken.posts.length === 0)) {
      return;
    }

    await IncidentCallTranscriptRemoval.takeBack(taken);

    await IncidentCallTranscriptRemoval.announce({
      call: taken.call,
      reason: TranscriptRemovalReason.SignInRemoved,
      removedTranscript: taken.removedTranscript,
    });
  }

  /*
   * A call deleted (IncidentVideoCallService): its transcript went with the
   * row, so its readings' posts go too - and a line in the feed says who
   * removed the call, with its transcript. Never throws: the call is gone
   * either way.
   */
  @CaptureSpan()
  public static async takeBackDeletedCall(data: {
    call: IncidentVideoCall;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    try {
      const call: IncidentVideoCall = data.call;
      const hadTranscript: boolean = Boolean(call.transcriptAddedAt);

      await IncidentCallTranscriptRemoval.takeBack({
        call,
        removedTranscript: hadTranscript,
        posts: CallSummaryPosts.read(call.callSummaryPosts),
        untrackedReading:
          hadTranscript &&
          call.callSummaryStatus === CallSummaryStatus.Ready &&
          !CallSummaryPosts.isKept(call.callSummaryPosts),
      });

      await IncidentCallTranscriptRemoval.announce({
        call,
        reason: TranscriptRemovalReason.CallDeleted,
        userId: data.userId,
        removedTranscript: Boolean(call.transcriptAddedAt),
      });
    } catch (error) {
      logger.error(
        `Could not take back what OneUptime AI read in a deleted incident call: ${error}`,
        {
          projectId: data.call.projectId?.toString(),
          incidentId: data.call.incidentId?.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * Deletes posts of what OneUptime AI read: each feed item, each channel
   * message, and the text Notification Logs kept of those messages. Never
   * throws. Says each message it could not delete, and why.
   */
  @CaptureSpan()
  public static async deletePosts(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    posts: Array<CallSummaryPost>;
  }): Promise<WorkspaceMessageDeletion> {
    const feedIds: Array<ObjectID> = [];
    const messages: Array<WorkspacePostedMessage> = [];

    for (const post of data.posts) {
      if (post.feedId && ObjectID.isValidUUID(post.feedId)) {
        feedIds.push(new ObjectID(post.feedId));
      }

      messages.push(...post.messages);
    }

    await IncidentCallTranscriptRemoval.deleteFeedItems({
      projectId: data.projectId,
      incidentId: data.incidentId,
      feedIds,
    });

    return (
      await IncidentCallTranscriptRemoval.deleteMessages({
        projectId: data.projectId,
        messages,
      })
    ).deletion;
  }

  /*
   * The line in the incident's feed that says the transcript went, kept to
   * the dashboard as the line that said it was added is. Written to follow
   * the name of the person who removed it ("Maya Chen removed the
   * transcript of the Zoom meeting ..."); OneUptime's own says why.
   */
  public static getRemovedFeedMarkdown(data: {
    callLabel: string;
    provider?: VideoCallProvider | undefined;
    reason: TranscriptRemovalReason;
    // Whether the transcript itself went, not only what was read in it.
    removedTranscript: boolean;
  }): string {
    switch (data.reason) {
      case TranscriptRemovalReason.CallDeleted:
        return mdText`🗑️ removed the **${data.callLabel}**, with its transcript and what OneUptime AI read in it.`.toString();
      case TranscriptRemovalReason.SignInRemoved:
        return data.removedTranscript
          ? mdText`🗑️ OneUptime deleted the transcript of the **${data.callLabel}**, and what OneUptime AI read in it, because OneUptime was removed from the ${getVideoCallProviderDisplayName(data.provider)} account it was read through.`.toString()
          : mdText`🗑️ OneUptime deleted what OneUptime AI read in the transcript of the **${data.callLabel}** it read from ${getVideoCallProviderDisplayName(data.provider)}, because OneUptime was removed from the ${getVideoCallProviderDisplayName(data.provider)} account it was read through. The transcript added since stays.`.toString();
      default:
        return data.removedTranscript
          ? mdText`🗑️ removed the transcript of the **${data.callLabel}** and what OneUptime AI read in it.`.toString()
          : mdText`🗑️ removed what OneUptime AI read in the transcript of the **${data.callLabel}**.`.toString();
    }
  }

  /*
   * Takes back what a removal took off the call: its posts, and - for a
   * reading posted before calls kept where readings went - the feed item
   * and messages found by what it said. Says each message it could not
   * delete.
   */
  private static async takeBack(
    taken: TakenTranscript,
  ): Promise<Array<WorkspaceMessageNotDeleted>> {
    const call: IncidentVideoCall = taken.call;

    const deletion: WorkspaceMessageDeletion =
      await IncidentCallTranscriptRemoval.deletePosts({
        projectId: call.projectId!,
        incidentId: call.incidentId!,
        posts: taken.posts,
      });

    const notDeleted: Array<WorkspaceMessageNotDeleted> = [
      ...deletion.notDeleted,
    ];

    if (taken.untrackedReading) {
      const legacy: PostsTakenBack | null =
        await IncidentCallTranscriptRemoval.takeBackUntrackedReading(call);

      if (legacy) {
        notDeleted.push(...legacy.deletion.notDeleted);
      }
    }

    return notDeleted;
  }

  /*
   * A reading posted before calls kept where readings went: its feed item
   * found by its exact text, which the same reading always has, and its
   * channel messages by the text Notification Logs kept of each - for as
   * long as the logs keep it. Never throws. Null when it could not be
   * looked for.
   */
  private static async takeBackUntrackedReading(
    call: IncidentVideoCall,
  ): Promise<PostsTakenBack | null> {
    try {
      const summary: CallSummary | null = readCallSummary(call.callSummary);

      if (!summary || !call.projectId || !call.incidentId) {
        return null;
      }

      const markdown: string = IncidentCallSummaryFeed.getFeedMarkdown({
        call,
        callLabel: await IncidentCallTranscriptRemoval.getCallLabel(call),
        summary,
      });

      const feedItems: Array<IncidentFeed> = await IncidentFeedService.findBy({
        query: {
          projectId: call.projectId,
          incidentId: call.incidentId,
          incidentFeedEventType: IncidentFeedEventType.VideoCallSummary,
          feedInfoInMarkdown: markdown,
        },
        select: { _id: true },
        limit: LEGACY_LOOKUP_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

      await IncidentCallTranscriptRemoval.deleteFeedItems({
        projectId: call.projectId,
        incidentId: call.incidentId,
        feedIds: feedItems
          .map((item: IncidentFeed): ObjectID | null => {
            return item.id;
          })
          .filter((id: ObjectID | null): id is ObjectID => {
            return Boolean(id);
          }),
      });

      // The text logSendResponses kept of the message: the feed item's own.
      const loggedText: string = WorkspaceMessageTime.toPlainText(
        WorkspaceMentions.toLogText(markdown, undefined).trim(),
      );

      const logs: Array<WorkspaceNotificationLog> =
        await WorkspaceNotificationLogService.findBy({
          query: {
            projectId: call.projectId,
            incidentId: call.incidentId,
            actionType: WorkspaceNotificationActionType.SendMessage,
            status: WorkspaceNotificationStatus.Success,
            message: loggedText,
            threadId: QueryHelper.notNull(),
          },
          select: {
            _id: true,
            workspaceType: true,
            channelId: true,
            channelName: true,
            threadId: true,
          },
          limit: LEGACY_LOOKUP_LIMIT,
          skip: 0,
          props: { isRoot: true },
        });

      const messages: Array<WorkspacePostedMessage> = [];

      for (const log of logs) {
        if (!log.workspaceType || !log.channelId || !log.threadId) {
          continue;
        }

        messages.push({
          workspaceType: log.workspaceType as WorkspaceType,
          channelId: log.channelId,
          ...(log.channelName ? { channelName: log.channelName } : {}),
          messageId: log.threadId,
        });
      }

      return await IncidentCallTranscriptRemoval.deleteMessages({
        projectId: call.projectId,
        messages,
      });
    } catch (error) {
      logger.error(
        `Could not look for what OneUptime AI read in a call before calls kept where it was posted: ${error}`,
        {
          projectId: call.projectId?.toString(),
          incidentId: call.incidentId?.toString(),
        } as LogAttributes,
      );
      return null;
    }
  }

  // Deletes the feed items of what was read, in the call's incident only.
  private static async deleteFeedItems(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    feedIds: Array<ObjectID>;
  }): Promise<void> {
    if (data.feedIds.length === 0) {
      return;
    }

    try {
      await IncidentFeedService.deleteBy({
        query: {
          _id: QueryHelper.any(data.feedIds),
          projectId: data.projectId,
          incidentId: data.incidentId,
          incidentFeedEventType: IncidentFeedEventType.VideoCallSummary,
        },
        limit: data.feedIds.length,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Could not delete what OneUptime AI read in a call from the incident's feed: ${error}`,
        {
          projectId: data.projectId.toString(),
          incidentId: data.incidentId.toString(),
        } as LogAttributes,
      );
    }
  }

  // Deletes channel messages, and forgets the text their logs kept.
  private static async deleteMessages(data: {
    projectId: ObjectID;
    messages: Array<WorkspacePostedMessage>;
  }): Promise<PostsTakenBack> {
    if (data.messages.length === 0) {
      return { deletion: { deleted: [], notDeleted: [] } };
    }

    const deletion: WorkspaceMessageDeletion =
      await WorkspacePostedMessages.deleteAll({
        projectId: data.projectId,
        messages: data.messages,
      });

    await WorkspacePostedMessages.forgetLoggedText({
      projectId: data.projectId,
      deletion,
      note: IncidentCallTranscriptRemoval.FORGOTTEN_MESSAGE_NOTE,
    });

    return { deletion };
  }

  // The line in the feed. Never throws: what was removed stays removed.
  private static async announce(data: {
    call: IncidentVideoCall;
    reason: TranscriptRemovalReason;
    userId?: ObjectID | undefined;
    removedTranscript: boolean;
  }): Promise<void> {
    try {
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: data.call.incidentId!,
        projectId: data.call.projectId!,
        incidentFeedEventType: IncidentFeedEventType.VideoCallTranscriptRemoved,
        displayColor: Gray500,
        feedInfoInMarkdown:
          IncidentCallTranscriptRemoval.getRemovedFeedMarkdown({
            callLabel: await IncidentCallTranscriptRemoval.getCallLabel(
              data.call,
            ),
            provider: data.call.provider,
            reason: data.reason,
            removedTranscript: data.removedTranscript,
          }),
        userId:
          data.reason === TranscriptRemovalReason.SignInRemoved
            ? undefined
            : data.userId,
      });
    } catch (error) {
      logger.error(`Could not record a removed call transcript: ${error}`, {
        projectId: data.call.projectId?.toString(),
        incidentId: data.call.incidentId?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * What the call is called, as its reading named it
   * (IncidentCallSummary.getCallLabel): a link of one's own by its title,
   * or by the name of the connection that holds it.
   */
  private static async getCallLabel(call: IncidentVideoCall): Promise<string> {
    let connectionName: string | undefined = call.videoCallConnection?.name;

    if (
      call.provider === VideoCallProvider.CustomLink &&
      !(call.title || "").trim() &&
      !connectionName &&
      call.videoCallConnectionId
    ) {
      try {
        const connection: VideoCallConnection | null =
          await VideoCallConnectionService.findOneById({
            id: call.videoCallConnectionId,
            select: { name: true },
            props: { isRoot: true },
          });

        connectionName = connection?.name || undefined;
      } catch {
        connectionName = undefined;
      }
    }

    return getVideoCallLabel({
      provider: call.provider,
      title: call.title,
      connectionName,
    });
  }

  private static async hasConnectedWorkspace(
    projectId: ObjectID,
  ): Promise<boolean> {
    try {
      const auths: Array<WorkspaceProjectAuthToken> =
        await WorkspaceProjectAuthTokenService.getProjectAuths({ projectId });

      return auths.some((auth: WorkspaceProjectAuthToken): boolean => {
        return Boolean(auth.authToken);
      });
    } catch {
      return true;
    }
  }
}
