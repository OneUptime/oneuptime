import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  CALL_SUMMARY_VERSION,
  CallSummary,
  CallSummaryRootCauseOutcome,
  CallSummaryStatus,
  RootCauseSuggestionStatus,
} from "../../../../Types/VideoCall/CallSummary";
import { CallSummaryPost } from "../../../../Types/VideoCall/CallSummaryPosts";
import { getVideoCallLabel } from "../../../../Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptSource } from "../../../../Types/VideoCall/VideoCallTranscript";
import TranscriptText, {
  TranscriptLine,
} from "../../../../Utils/VideoCall/TranscriptText";
import AIService, {
  AI_DISABLED_MESSAGE,
  AI_INCIDENT_CALL_SUMMARY_FEATURE,
  AILogResponse,
} from "../../../Services/AIService";
import IncidentService from "../../../Services/IncidentService";
import IncidentVideoCallService from "../../../Services/IncidentVideoCallService";
import { LLMMessage } from "../../LLM/LLMService";
import { redactLogString } from "../../LogRedaction";
import logger, { LogAttributes } from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import IncidentVideoCallTranscriptWrite from "../../VideoCall/Transcripts/IncidentVideoCallTranscriptWrite";
import IncidentCallTranscriptRemoval from "../../VideoCall/Transcripts/IncidentCallTranscriptRemoval";
import AIIncidentPostmortemRunner from "../SRE/IncidentPostmortemRunner";
import IncidentCallSummaryFeed from "./IncidentCallSummaryFeed";
import { CallSummaryIncident } from "./CallSummaryPrompt";
import CallSummaryReader, {
  CallSummaryCompletion,
  CallSummaryContent,
} from "./CallSummaryReader";

/*
 * ONEUPTIME AI READS AN INCIDENT CALL'S TRANSCRIPT (issue #4875).
 *
 * When a call's transcript is added - read from Zoom or Google Meet, or
 * added by a person - OneUptime AI reads it, stores what it found on the
 * call (CallSummary) and posts it to the incident's feed and channels
 * (IncidentCallSummaryFeed), keeping where it went, so removing the
 * transcript takes it back (CallSummaryPosts). The suggested root cause
 * waits on the call for
 * a person; nothing is written to the incident's root cause until someone
 * uses it (IncidentVideoCallAPI). A reading that ends lets a postmortem
 * draft that waited for it go on (AIIncidentPostmortemRunner).
 *
 * `start` decides, at once, whether the transcript is read: not when AI is
 * off for the project (Skipped, with the sentence that says where to turn
 * it on), otherwise Pending, and the reading runs in the background - a
 * long call is several requests to the model, longer than a person should
 * wait on a button. Each reading has its own id (the Pending summary holds
 * it), and only the reading whose id is still the call's writes what it
 * found, in the same UPDATE that checks it (writeReadingIfCurrent): a
 * reading replaced by a newer one - the transcript was replaced or
 * removed, or someone asked for it to be read again - is dropped when it
 * ends. Its post is kept only while the transcript it read is still the
 * call's (keepCallSummaryPost); one made while the transcript was being
 * removed is deleted again at once.
 *
 * A reading that never ends (the server restarted mid-way) stays Pending,
 * and the dashboard offers to read it again once it is stale
 * (CALL_SUMMARY_STALE_AFTER_MS).
 *
 * Every request goes through AIService.executeWithLogging, which refuses a
 * project with AI off, out of AI credits or at its daily AI limit, and logs
 * the request without its content: a call is private to the people who can
 * read the incident.
 */

// The longest a reason stored on the call may be: the column holds 500.
export const MAX_CALL_SUMMARY_STATUS_MESSAGE_LENGTH: number = 490;

// Enough for the longest summary the reader keeps.
const MAX_ANSWER_TOKENS: number = 4_096;

export interface CallSummaryStart {
  status: CallSummaryStatus;
  runId?: string | undefined;
  message?: string | undefined;
}

export default class IncidentCallSummary {
  @CaptureSpan()
  public static async start(data: {
    callId: ObjectID;
    // Who added the transcript or asked for the reading.
    userId?: ObjectID | undefined;
    // For tests: the model, in place of AIService.
    complete?: CallSummaryCompletion | undefined;
  }): Promise<CallSummaryStart> {
    const call: IncidentVideoCall | null =
      await IncidentVideoCallService.findOneById({
        id: data.callId,
        select: { _id: true, projectId: true, transcript: true },
        props: { isRoot: true },
      });

    if (!call || !call.projectId) {
      throw new BadDataException("Video call not found.");
    }

    if (!call.transcript || !call.transcript.trim()) {
      throw new BadDataException("This call has no transcript to read.");
    }

    if (!(await AIService.isProjectAIEnabled(call.projectId))) {
      const message: string =
        ProductBrandingText.brandText(AI_DISABLED_MESSAGE);

      await IncidentVideoCallTranscriptWrite.write(data.callId, {
        callSummary: null,
        callSummaryStatus: CallSummaryStatus.Skipped,
        callSummaryStatusMessage: message,
        callSummaryUpdatedAt: new Date(),
        ...IncidentVideoCallTranscriptWrite.noSuggestion(),
      });

      return { status: CallSummaryStatus.Skipped, message };
    }

    const runId: string = ObjectID.generate().toString();

    await IncidentVideoCallTranscriptWrite.write(data.callId, {
      callSummary: IncidentCallSummary.runMarker(runId),
      callSummaryStatus: CallSummaryStatus.Pending,
      callSummaryStatusMessage: null,
      callSummaryUpdatedAt: new Date(),
      ...IncidentVideoCallTranscriptWrite.noSuggestion(),
    });

    IncidentCallSummary.run({
      callId: data.callId,
      runId,
      userId: data.userId,
      complete: data.complete,
    }).catch((error: Error) => {
      logger.error(`Could not read an incident call's transcript: ${error}`, {
        projectId: call.projectId?.toString(),
      } as LogAttributes);
    });

    return { status: CallSummaryStatus.Pending, runId };
  }

  /*
   * The reading itself. Never throws for the transcript's sake: what went
   * wrong is stored on the call, for the people on the incident to read.
   */
  @CaptureSpan()
  public static async run(data: {
    callId: ObjectID;
    runId: string;
    userId?: ObjectID | undefined;
    complete?: CallSummaryCompletion | undefined;
  }): Promise<void> {
    const call: IncidentVideoCall | null =
      await IncidentVideoCallService.findOneById({
        id: data.callId,
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          provider: true,
          title: true,
          transcript: true,
          transcriptInfo: true,
          transcriptSource: true,
          transcriptAddedAt: true,
          transcriptSignInAccountId: true,
          callSummary: true,
          videoCallConnection: { name: true },
        },
        props: { isRoot: true },
      });

    if (
      !call ||
      !call.projectId ||
      !call.incidentId ||
      !IncidentCallSummary.isCurrentRun(call.callSummary, data.runId)
    ) {
      return;
    }

    const projectId: ObjectID = call.projectId;
    const incidentId: ObjectID = call.incidentId;

    try {
      const lines: Array<TranscriptLine> = TranscriptText.deserialize(
        call.transcript,
      );
      const incident: CallSummaryIncident =
        await IncidentCallSummary.getIncident(incidentId);

      const complete: CallSummaryCompletion =
        data.complete ||
        (async (request: { messages: Array<LLMMessage> }): Promise<string> => {
          const response: AILogResponse = await AIService.executeWithLogging({
            projectId,
            userId: data.userId,
            feature: AI_INCIDENT_CALL_SUMMARY_FEATURE,
            incidentId,
            messages: request.messages,
            maxTokens: MAX_ANSWER_TOKENS,
            temperature: 0.1,
            /*
             * What was said on the call is for the people who can read the
             * incident; the AI logs are read more widely.
             */
            storeContentPreviews: false,
          });

          return response.content;
        });

      const content: CallSummaryContent = await CallSummaryReader.read({
        lines,
        incident,
        callLabel: IncidentCallSummary.getCallLabel(call),
        complete,
      });

      const summary: CallSummary = {
        version: CALL_SUMMARY_VERSION,
        runId: data.runId,
        generatedAt: new Date().toISOString(),
        ...content,
      };

      const written: boolean =
        await IncidentVideoCallService.writeReadingIfCurrent({
          callId: data.callId,
          runId: data.runId,
          columns: {
            callSummary: summary as unknown as JSONObject,
            callSummaryStatus: CallSummaryStatus.Ready,
            callSummaryStatusMessage: null,
            callSummaryUpdatedAt: new Date(),
            rootCauseSuggestionStatus:
              content.rootCause.outcome ===
              CallSummaryRootCauseOutcome.Suggested
                ? RootCauseSuggestionStatus.Suggested
                : null,
            rootCauseSuggestionReviewedAt: null,
            rootCauseSuggestionReviewedByUserId: null,
          },
        });

      // A newer reading, or no transcript any more: nothing to say.
      if (!written) {
        return;
      }

      // What was read, where the incident's updates go, and where it went.
      await IncidentCallSummary.postAndKeep({ call, summary });

      await IncidentCallSummary.letPostmortemDraftGoOn(incidentId);
    } catch (error) {
      logger.warn(
        `OneUptime AI could not read an incident call's transcript: ${IncidentCallSummary.getErrorMessage(error)}`,
        {
          projectId: projectId.toString(),
          incidentId: incidentId.toString(),
        } as LogAttributes,
      );

      const written: boolean =
        await IncidentVideoCallService.writeReadingIfCurrent({
          callId: data.callId,
          runId: data.runId,
          columns: {
            callSummary: IncidentCallSummary.runMarker(data.runId),
            callSummaryStatus: CallSummaryStatus.Failed,
            callSummaryStatusMessage:
              IncidentCallSummary.getErrorMessage(error),
            callSummaryUpdatedAt: new Date(),
            ...IncidentVideoCallTranscriptWrite.noSuggestion(),
          },
        });

      if (!written) {
        return;
      }

      // The draft reads the transcript itself instead.
      await IncidentCallSummary.letPostmortemDraftGoOn(incidentId);
    }
  }

  /*
   * Posts what was read to the incident's feed and channels, and keeps where
   * it went on the call - while the transcript it read is still the call's.
   * One the transcript left meanwhile - removed, replaced, or its call
   * deleted - is deleted again at once, so nothing read in a transcript
   * outlives it. Never throws.
   */
  public static async postAndKeep(data: {
    call: IncidentVideoCall;
    summary: CallSummary;
  }): Promise<void> {
    const call: IncidentVideoCall = data.call;

    const post: CallSummaryPost = await IncidentCallSummaryFeed.post({
      call,
      callLabel: IncidentCallSummary.getCallLabel(call),
      summary: data.summary,
      // What was read in a transcript read through someone's sign-in goes with it.
      signInAccountId:
        call.transcriptSource === VideoCallTranscriptSource.Provider
          ? call.transcriptSignInAccountId || undefined
          : undefined,
    });

    try {
      const kept: boolean = call.transcriptAddedAt
        ? await IncidentVideoCallService.keepCallSummaryPost({
            callId: call.id!,
            transcriptAddedAt: call.transcriptAddedAt,
            post,
          })
        : false;

      if (kept) {
        return;
      }
    } catch (error) {
      logger.error(
        `Could not keep where what OneUptime AI read in a call was posted; deleting the post: ${error}`,
        {
          projectId: call.projectId?.toString(),
          incidentId: call.incidentId?.toString(),
        } as LogAttributes,
      );
    }

    await IncidentCallTranscriptRemoval.deletePosts({
      projectId: call.projectId!,
      incidentId: call.incidentId!,
      posts: [post],
    });
  }

  /*
   * A reading that ended - read, or failed - no longer holds back a
   * postmortem draft that waited for it (AIIncidentPostmortemRunner).
   * Never throws.
   */
  private static async letPostmortemDraftGoOn(
    incidentId: ObjectID,
  ): Promise<void> {
    try {
      await AIIncidentPostmortemRunner.draftWaitingPostmortem({ incidentId });
    } catch (error) {
      logger.error(
        `Could not draft a postmortem that waited for its calls: ${error}`,
        { incidentId: incidentId.toString() } as LogAttributes,
      );
    }
  }

  // What the call is called in the prompt: "Zoom meeting", or a link's own title.
  public static getCallLabel(call: IncidentVideoCall): string {
    return getVideoCallLabel({
      provider: call.provider,
      title: call.title,
      connectionName: call.videoCallConnection?.name,
    });
  }

  // The reason a reading stopped, as the people on the incident read it.
  public static getErrorMessage(error: unknown): string {
    const message: string =
      error instanceof Error && error.message
        ? error.message
        : "OneUptime AI could not read the transcript.";
    const redacted: string = ProductBrandingText.brandText(
      redactLogString(message),
    );

    return redacted.length > MAX_CALL_SUMMARY_STATUS_MESSAGE_LENGTH
      ? `${redacted.slice(0, MAX_CALL_SUMMARY_STATUS_MESSAGE_LENGTH - 1)}…`
      : redacted;
  }

  /*
   * What the call's summary holds while a reading has nothing to show - it
   * is running, or it failed: which reading it is.
   */
  public static runMarker(runId: string): JSONObject {
    const marker: JSONObject = {};
    marker["runId"] = runId;
    return marker;
  }

  public static isCurrentRun(
    callSummary: JSONObject | undefined | null,
    runId: string,
  ): boolean {
    return Boolean(callSummary) && callSummary!["runId"] === runId;
  }

  private static async getIncident(
    incidentId: ObjectID,
  ): Promise<CallSummaryIncident> {
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        _id: true,
        title: true,
        description: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        declaredAt: true,
        createdAt: true,
        incidentSeverity: { name: true },
        currentIncidentState: { name: true },
      },
      props: { isRoot: true },
    });

    if (!incident) {
      throw new BadDataException("Incident not found.");
    }

    return {
      numberDisplay:
        incident.incidentNumberWithPrefix ||
        `#${incident.incidentNumber?.toString() || ""}`,
      title: incident.title,
      description: incident.description,
      severity: incident.incidentSeverity?.name,
      state: incident.currentIncidentState?.name,
      declaredAt: incident.declaredAt || incident.createdAt,
    };
  }
}
