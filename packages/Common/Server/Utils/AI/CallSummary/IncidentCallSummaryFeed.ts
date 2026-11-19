import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { Indigo500 } from "../../../../Types/BrandColors";
import { CallSummary } from "../../../../Types/VideoCall/CallSummary";
import { CallSummaryPost } from "../../../../Types/VideoCall/CallSummaryPosts";
import CallSummaryFeedMarkdown from "../../../../Utils/VideoCall/CallSummaryFeedMarkdown";
import TranscriptText from "../../../../Utils/VideoCall/TranscriptText";
import IncidentFeedService, {
  IncidentFeedItemPosted,
} from "../../../Services/IncidentFeedService";
import logger, { LogAttributes } from "../../Logger";

/*
 * WHAT ONEUPTIME AI READ IN A CALL, POSTED TO THE INCIDENT'S FEED.
 *
 * Once OneUptime AI has read a call's transcript (IncidentCallSummary), what
 * it read is the incident's next feed item, written as
 * CallSummaryFeedMarkdown says it, and from the feed it goes to the
 * incident's Slack, Microsoft Teams and Mattermost channels like the
 * incident's other updates. It is OneUptime AI's, not a person's: no one is
 * named as its author.
 *
 * Where it went - the feed item, and each message in the channels - is
 * what post answers, for the call to keep (CallSummaryPosts): removing the
 * transcript takes all of it back (IncidentCallTranscriptRemoval).
 */
export default class IncidentCallSummaryFeed {
  /*
   * The feed item's text: what was read, said as the feed and the channels
   * say it. The same reading always says the same, which is how a reading
   * posted before OneUptime kept where it went is found again.
   */
  public static getFeedMarkdown(data: {
    call: Pick<IncidentVideoCall, "transcriptInfo">;
    callLabel: string;
    summary: CallSummary;
  }): string {
    const info: ReturnType<typeof TranscriptText.readInfo> =
      TranscriptText.readInfo(data.call.transcriptInfo);

    return CallSummaryFeedMarkdown.getFeedMarkdown({
      callLabel: data.callLabel,
      summary: data.summary,
      details: info ? TranscriptText.describeInfo(info) : undefined,
    }).toString();
  }

  /*
   * Posts what was read to the incident's feed and channels, and says where
   * it went. Never throws: the reading is stored either way, and the card
   * shows it. A post that could not be made is said as one with no feed
   * item and no messages.
   */
  public static async post(data: {
    call: Pick<
      IncidentVideoCall,
      "projectId" | "incidentId" | "transcriptInfo"
    >;
    callLabel: string;
    summary: CallSummary;
    /*
     * The account whose sign-in read the transcript, when one did: kept
     * with the post, so that account removing OneUptime takes it back.
     */
    signInAccountId?: string | undefined;
  }): Promise<CallSummaryPost> {
    const post: CallSummaryPost = {
      postedAt: new Date().toISOString(),
      ...(data.signInAccountId
        ? { signInAccountId: data.signInAccountId }
        : {}),
      messages: [],
    };

    try {
      const posted: IncidentFeedItemPosted | null =
        await IncidentFeedService.postIncidentFeedItem({
          incidentId: data.call.incidentId!,
          projectId: data.call.projectId!,
          incidentFeedEventType: IncidentFeedEventType.VideoCallSummary,
          displayColor: Indigo500,
          feedInfoInMarkdown: IncidentCallSummaryFeed.getFeedMarkdown(data),
          workspaceNotification: {
            sendWorkspaceNotification: true,
          },
        });

      if (posted) {
        post.feedId = posted.feedId.toString();
        post.messages = posted.messages;
      }
    } catch (error) {
      logger.error(
        `Could not post what OneUptime AI read in a call to the incident's feed: ${error}`,
        {
          projectId: data.call.projectId?.toString(),
          incidentId: data.call.incidentId?.toString(),
        } as LogAttributes,
      );
    }

    return post;
  }
}
