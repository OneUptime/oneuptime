import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "../../../../Types/BrandColors";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  getVideoCallNoun,
  getVideoCallProviderDisplayName,
} from "../../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallTranscriptInfo,
  VideoCallTranscriptSource,
} from "../../../../Types/VideoCall/VideoCallTranscript";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import TranscriptText, {
  PreparedTranscript,
} from "../../../../Utils/VideoCall/TranscriptText";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentCallSummary, {
  CallSummaryStart,
} from "../../AI/CallSummary/IncidentCallSummary";
import logger, { LogAttributes } from "../../Logger";
import IncidentVideoCallTranscriptWrite from "./IncidentVideoCallTranscriptWrite";

/*
 * A CALL'S TRANSCRIPT, STORED.
 *
 * The one way a transcript reaches an incident's call: added, or got from
 * the provider, by a person (IncidentVideoCallAPI), or got by OneUptime
 * itself once the call is over (IncidentCallTranscriptFetch). It replaces
 * any transcript the call had and what was read in it, ends any waiting
 * for one, has OneUptime AI read it, and says so in the incident's feed.
 */

// The call as saving a transcript needs it.
export type IncidentCallForTranscript = Pick<
  IncidentVideoCall,
  "id" | "projectId" | "incidentId" | "provider"
>;

export default class IncidentCallTranscriptSave {
  public static async save(data: {
    call: IncidentCallForTranscript;
    prepared: PreparedTranscript;
    source: VideoCallTranscriptSource;
    /*
     * The person who added the transcript or asked the provider for it;
     * none when OneUptime got it by itself, or an API key added it.
     */
    userId?: ObjectID | undefined;
    // OneUptime got it by itself, nobody asked (Record and transcribe incident calls).
    isAutomatic?: boolean | undefined;
  }): Promise<CallSummaryStart> {
    const callId: ObjectID = data.call.id!;
    const info: VideoCallTranscriptInfo = data.prepared.info;

    await IncidentVideoCallTranscriptWrite.write(callId, {
      transcript: data.prepared.stored,
      transcriptSource: data.source,
      transcriptInfo: info as unknown as JSONObject,
      transcriptAddedAt: new Date(),
      transcriptAddedByUserId: data.userId || null,
      ...IncidentVideoCallTranscriptWrite.noReading(),
      ...IncidentVideoCallTranscriptWrite.noFetch(),
    });

    const started: CallSummaryStart = await IncidentCallSummary.start({
      callId,
      userId: data.userId,
    });

    await IncidentCallTranscriptSave.announce({
      call: data.call,
      info,
      source: data.source,
      userId: data.userId,
      isAutomatic: data.isAutomatic === true,
    });

    return started;
  }

  /*
   * The line in the incident's feed, kept to the dashboard: never posted to
   * its channels. Written for someone's action it opens with "added", so the
   * feed puts the person first ("Maya Chen added the call's transcript from
   * Zoom: ..."), and an API key's reads "Added ..." (FeedEntryText). Got by
   * OneUptime itself, it says so.
   */
  public static getFeedMarkdown(data: {
    call: Pick<IncidentVideoCall, "provider">;
    info: VideoCallTranscriptInfo;
    source: VideoCallTranscriptSource;
    isAutomatic?: boolean | undefined;
  }): string {
    const details: string = TranscriptText.describeInfo(data.info);

    if (data.isAutomatic) {
      return mdText`📝 OneUptime added the call's transcript from **${getVideoCallProviderDisplayName(data.call.provider)}** once the call was over: ${details}.`.toString();
    }

    if (data.source === VideoCallTranscriptSource.Provider) {
      return mdText`📝 added the call's transcript from **${getVideoCallProviderDisplayName(data.call.provider)}**: ${details}.`.toString();
    }

    return mdText`📝 added a transcript of the **${getVideoCallNoun(data.call.provider)}**: ${details}.`.toString();
  }

  private static async announce(data: {
    call: IncidentCallForTranscript;
    info: VideoCallTranscriptInfo;
    source: VideoCallTranscriptSource;
    userId?: ObjectID | undefined;
    isAutomatic: boolean;
  }): Promise<void> {
    try {
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: data.call.incidentId!,
        projectId: data.call.projectId!,
        incidentFeedEventType: IncidentFeedEventType.VideoCallTranscriptAdded,
        displayColor: Blue500,
        feedInfoInMarkdown: IncidentCallTranscriptSave.getFeedMarkdown(data),
        userId: data.userId,
      });
    } catch (error) {
      logger.error(`Could not record an added call transcript: ${error}`, {
        projectId: data.call.projectId?.toString(),
        incidentId: data.call.incidentId?.toString(),
      } as LogAttributes);
    }
  }
}
