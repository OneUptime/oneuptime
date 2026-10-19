import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import PartialEntity from "../../../../Types/Database/PartialEntity";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  CallSummaryStatus,
  RootCauseSuggestionStatus,
} from "../../../../Types/VideoCall/CallSummary";
import { CallTranscriptFetchStatus } from "../../../../Types/VideoCall/CallTranscriptAutoFetch";
import {
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailableReason,
} from "../../../../Types/VideoCall/VideoCallTranscript";
import IncidentVideoCallService from "../../../Services/IncidentVideoCallService";

/*
 * The columns of an incident call that only OneUptime writes - its
 * transcript, what OneUptime AI read in it, what a person decided about
 * the suggested root cause, and where OneUptime stands in getting the
 * transcript by itself - and the one way they are written: as root and
 * past the call's hooks, once whoever asked has been checked
 * (IncidentVideoCallAPI), by the reading itself (IncidentCallSummary), or
 * by the job that asks the provider (IncidentCallTranscriptFetch). A
 * column set to null is cleared.
 */
export interface IncidentVideoCallTranscriptColumns {
  transcript?: string | null;
  transcriptSource?: VideoCallTranscriptSource | null;
  transcriptInfo?: JSONObject | null;
  transcriptAddedAt?: Date | null;
  transcriptAddedByUserId?: ObjectID | null;
  callSummary?: JSONObject | null;
  callSummaryStatus?: CallSummaryStatus | null;
  callSummaryStatusMessage?: string | null;
  callSummaryUpdatedAt?: Date | null;
  rootCauseSuggestionStatus?: RootCauseSuggestionStatus | null;
  rootCauseSuggestionReviewedAt?: Date | null;
  rootCauseSuggestionReviewedByUserId?: ObjectID | null;
  transcriptFetchStatus?: CallTranscriptFetchStatus | null;
  transcriptFetchReason?: VideoCallTranscriptUnavailableReason | null;
  transcriptFetchCheckedAt?: Date | null;
  transcriptFetchNextAttemptAt?: Date | null;
}

export default class IncidentVideoCallTranscriptWrite {
  public static async write(
    callId: ObjectID,
    data: IncidentVideoCallTranscriptColumns,
  ): Promise<void> {
    await IncidentVideoCallService.updateOneById({
      id: callId,
      data: data as unknown as PartialEntity<IncidentVideoCall>,
      props: { isRoot: true, ignoreHooks: true },
    });
  }

  // No suggested root cause, and nobody's decision about one.
  public static noSuggestion(): IncidentVideoCallTranscriptColumns {
    return {
      rootCauseSuggestionStatus: null,
      rootCauseSuggestionReviewedAt: null,
      rootCauseSuggestionReviewedByUserId: null,
    };
  }

  // Nothing read in the transcript yet, and nothing to review.
  public static noReading(): IncidentVideoCallTranscriptColumns {
    return {
      callSummary: null,
      callSummaryStatus: null,
      callSummaryStatusMessage: null,
      callSummaryUpdatedAt: null,
      ...IncidentVideoCallTranscriptWrite.noSuggestion(),
    };
  }

  /*
   * OneUptime no longer waits for the call's transcript: it has one, or a
   * person took it from here. When it last asked stays.
   */
  public static noFetch(): IncidentVideoCallTranscriptColumns {
    return {
      transcriptFetchStatus: null,
      transcriptFetchReason: null,
      transcriptFetchNextAttemptAt: null,
    };
  }

  // No transcript at all, nor anything read in one.
  public static noTranscript(): IncidentVideoCallTranscriptColumns {
    return {
      transcript: null,
      transcriptSource: null,
      transcriptInfo: null,
      transcriptAddedAt: null,
      transcriptAddedByUserId: null,
      ...IncidentVideoCallTranscriptWrite.noReading(),
    };
  }
}
